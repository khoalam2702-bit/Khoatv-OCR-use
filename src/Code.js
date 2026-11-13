/**
 * OCR đa tài liệu: Google Apps Script + Gemini Vision + Google Sheets + Google Drive
 *
 * Script Properties (Project Settings > Script Properties):
 *   GEMINI_API_KEY    (bắt buộc) Khoá Gemini API
 *   GEMINI_MODEL      (tuỳ chọn) Mặc định gemini-3.6-flash
 *   DRIVE_FOLDER_ID   (tuỳ chọn) Thư mục gốc trên Drive, mặc định như bên dưới
 *
 * Cấu trúc trong thư mục gốc (hệ thống tự tạo khi cần):
 *   ANH_GOC/2026/RAW_CCCD_20261112_083000_ab12cd.jpg      tệp gốc đối soát, chia theo năm
 *   DU_LIEU/2026/11/OCR_2026_11                           file Google Sheets của tháng, mỗi loại tài liệu 1 sheet
 *   OCR_USERS                                             file Google Sheets: sheet USERS (tài khoản, phân quyền) và NHAT_KY (nhật ký)
 *
 * Quy ước: hàm kết thúc bằng "_" là hàm nội bộ, trình duyệt không gọi được qua google.script.run.
 */

const DEFAULTS = {
  GEMINI_MODEL: 'gemini-3.6-flash',
  DRIVE_FOLDER_ID: '10H3azrz0_xObAmQsans_JYgI-acuK346'
};

const TZ = 'Asia/Ho_Chi_Minh';
const DIRS = { RAW: 'ANH_GOC', DATA: 'DU_LIEU', USERS_BOOK: 'OCR_USERS', BOOK_PREFIX: 'OCR_' };

const LIMITS = {
  MAX_FILE_BYTES: 14 * 1024 * 1024,   // mỗi tệp, sau khi giải mã base64
  MAX_TOTAL_BYTES: 24 * 1024 * 1024,  // tổng các tệp của một tài liệu
  MAX_LIST: 3000,                     // số bản ghi tối đa mỗi lần xem / xuất
  MAX_FILES: 6,                       // số tệp (mặt / trang) tối đa cho một tài liệu
  SESSION_SECONDS: 21600,             // 6 giờ (mức tối đa của CacheService)
  LOGIN_MAX_FAIL: 5,
  LOGIN_LOCK_SECONDS: 900,
  HASH_ROUNDS: 1000,
  MIN_PASSWORD: 8,
  SCAN_PER_10_MIN: 40
};

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
};

// Cột của các bảng chi tiết hàng hoá / vật tư (lưu jsonb)
const ITEM_FIELDS = [
  { k: 'ten_hang', label: 'Tên hàng / vật tư', type: 'string' },
  { k: 'don_vi', label: 'ĐVT', type: 'string' },
  { k: 'so_luong', label: 'Số lượng', type: 'number' },
  { k: 'don_gia', label: 'Đơn giá', type: 'number' },
  { k: 'thanh_tien', label: 'Thành tiền', type: 'number' }
];

function f_(k, label, type) { return { k: k, label: label, type: type || 'string' }; }

/**
 * Cấu hình 12 loại tài liệu.
 * Tên sheet = mã loại. uniqueKey: khoá nghiệp vụ để ghi đè chống trùng (null = chống trùng theo tệp gốc)
 */
const DOC_TYPES = {
  CCCD: {
    label: 'Căn cước công dân', uniqueKey: 'so_cccd', required: ['so_cccd', 'ho_ten'],
    hint: 'Thẻ căn cước / CCCD Việt Nam. Số định danh cá nhân gồm đúng 12 chữ số.',
    fields: [f_('so_cccd', 'Số CCCD'), f_('ho_ten', 'Họ và tên'), f_('ngay_sinh', 'Ngày sinh'), f_('gioi_tinh', 'Giới tính'),
      f_('quoc_tich', 'Quốc tịch'), f_('que_quan', 'Quê quán'), f_('noi_thuong_tru', 'Nơi thường trú'),
      f_('ngay_cap', 'Ngày cấp'), f_('ngay_het_han', 'Ngày hết hạn')]
  },
  HO_CHIEU: {
    label: 'Hộ chiếu', uniqueKey: 'so_ho_chieu', required: ['so_ho_chieu', 'ho_ten'],
    hint: 'Trang thông tin hộ chiếu. Đối chiếu vùng MRZ ở cuối trang để kiểm tra số hộ chiếu và ngày tháng.',
    fields: [f_('so_ho_chieu', 'Số hộ chiếu'), f_('ho_ten', 'Họ và tên'), f_('quoc_tich', 'Quốc tịch'), f_('ngay_sinh', 'Ngày sinh'),
      f_('noi_sinh', 'Nơi sinh'), f_('gioi_tinh', 'Giới tính'), f_('so_dinh_danh', 'Số định danh'), f_('ngay_cap', 'Ngày cấp'),
      f_('ngay_het_han', 'Ngày hết hạn'), f_('co_quan_cap', 'Cơ quan cấp')]
  },
  GPLX: {
    label: 'Giấy phép lái xe', uniqueKey: 'so_gplx', required: ['so_gplx', 'ho_ten', 'hang_gplx'],
    hint: 'Giấy phép lái xe Việt Nam. Nếu có nhiều hạng, ghi các hạng cách nhau bằng dấu phẩy.',
    fields: [f_('so_gplx', 'Số GPLX'), f_('ho_ten', 'Họ và tên'), f_('ngay_sinh', 'Ngày sinh'), f_('quoc_tich', 'Quốc tịch'),
      f_('noi_cu_tru', 'Nơi cư trú'), f_('hang_gplx', 'Hạng'), f_('thoi_han_den', 'Có giá trị đến'), f_('ngay_trung_tuyen', 'Ngày trúng tuyển')]
  },
  KHAI_SINH: {
    label: 'Giấy khai sinh', uniqueKey: null, required: ['ho_ten_khai_sinh', 'ngay_sinh'],
    hint: 'Giấy khai sinh Việt Nam, có thể có chữ viết tay.',
    fields: [f_('so_khai_sinh', 'Số khai sinh'), f_('ho_ten_khai_sinh', 'Họ tên người được khai sinh'), f_('gioi_tinh', 'Giới tính'),
      f_('ngay_sinh', 'Ngày sinh'), f_('noi_sinh', 'Nơi sinh'), f_('dan_toc', 'Dân tộc'), f_('quoc_tich', 'Quốc tịch'),
      f_('ho_ten_cha', 'Họ tên cha'), f_('ho_ten_me', 'Họ tên mẹ')]
  },
  CV_UNGVIEN: {
    label: 'CV ứng viên', uniqueKey: null, required: ['ho_ten'],
    hint: 'Hồ sơ ứng viên (CV). Tóm tắt học vấn, kỹ năng và kinh nghiệm gần nhất ngắn gọn, đúng theo nội dung CV.',
    fields: [f_('ho_ten', 'Họ và tên'), f_('email', 'Email'), f_('so_dien_thoai', 'Số điện thoại'), f_('vi_tri_ung_tuyen', 'Vị trí ứng tuyển'),
      f_('hoc_van', 'Học vấn', 'long'), f_('ky_nang', 'Kỹ năng', 'long'), f_('so_nam_kinh_nghiem', 'Số năm kinh nghiệm', 'number'),
      f_('kinh_nghiem_gan_nhat', 'Kinh nghiệm gần nhất', 'long')]
  },
  SO_DO: {
    label: 'Sổ đỏ / Sổ hồng', uniqueKey: null, required: ['thua_dat_so', 'dia_chi_thua_dat'],
    hint: 'Giấy chứng nhận quyền sử dụng đất. Diện tích là số, đơn vị mét vuông.',
    fields: [f_('so_phat_hanh', 'Số phát hành (seri)'), f_('so_vao_so', 'Số vào sổ'), f_('thua_dat_so', 'Thửa đất số'),
      f_('to_ban_do_so', 'Tờ bản đồ số'), f_('dia_chi_thua_dat', 'Địa chỉ thửa đất'), f_('dien_tich_m2', 'Diện tích (m²)', 'number'),
      f_('hinh_thuc_su_dung', 'Hình thức sử dụng'), f_('muc_dich_su_dung', 'Mục đích sử dụng'), f_('chu_so_huu', 'Chủ sở hữu')]
  },
  DON_HANG: {
    label: 'Đơn hàng bán', uniqueKey: 'ma_don_hang', required: ['ma_don_hang', 'thanh_toan'],
    hint: 'Đơn hàng bán. Liệt kê đủ từng dòng hàng. thanh_toan là số tiền khách phải trả cuối cùng.',
    fields: [f_('ma_don_hang', 'Mã đơn hàng'), f_('ngay_tao', 'Ngày đặt'), f_('ten_khach_hang', 'Khách hàng'), f_('so_dien_thoai', 'Số điện thoại'),
      f_('dia_chi_giao', 'Địa chỉ giao'), f_('danh_sach_hang_hoa', 'Danh sách hàng hoá', 'items'), f_('tong_tien_hang', 'Tổng tiền hàng', 'number'),
      f_('giam_gia', 'Giảm giá', 'number'), f_('thanh_toan', 'Thanh toán', 'number')]
  },
  GIAO_HANG: {
    label: 'Phiếu giao hàng', uniqueKey: 'ma_van_don', required: ['ma_van_don', 'nguoi_nhan'],
    hint: 'Phiếu giao hàng / vận đơn của hãng vận chuyển.',
    fields: [f_('ma_van_don', 'Mã vận đơn'), f_('don_vi_van_chuyen', 'Đơn vị vận chuyển'), f_('nguoi_gui', 'Người gửi'), f_('nguoi_nhan', 'Người nhận'),
      f_('sdt_nhan', 'SĐT người nhận'), f_('dia_chi_nhan', 'Địa chỉ nhận'), f_('tien_cod', 'Tiền thu hộ COD', 'number'),
      f_('cuoc_phi', 'Cước phí', 'number'), f_('ghi_chu_hang_hoa', 'Ghi chú hàng hoá', 'long')]
  },
  NHAP_KHO: {
    label: 'Phiếu nhập kho', uniqueKey: 'so_phieu_nhap', required: ['so_phieu_nhap'],
    hint: 'Phiếu nhập kho. Liệt kê đủ từng dòng vật tư.',
    fields: [f_('so_phieu_nhap', 'Số phiếu nhập'), f_('ngay_nhap', 'Ngày nhập'), f_('nha_cung_cap', 'Nhà cung cấp'), f_('kho_nhap', 'Kho nhập'),
      f_('nguoi_giao', 'Người giao'), f_('nguoi_nhan', 'Người nhận'), f_('chi_tiet_vat_tu', 'Chi tiết vật tư', 'items'),
      f_('tong_gia_tri', 'Tổng giá trị', 'number')]
  },
  XUAT_KHO: {
    label: 'Phiếu xuất kho', uniqueKey: 'so_phieu_xuat', required: ['so_phieu_xuat'],
    hint: 'Phiếu xuất kho. Liệt kê đủ từng dòng vật tư xuất.',
    fields: [f_('so_phieu_xuat', 'Số phiếu xuất'), f_('ngay_xuat', 'Ngày xuất'), f_('nguoi_nhan', 'Người nhận'), f_('bo_phan_nhan', 'Bộ phận / công trình nhận'),
      f_('kho_xuat', 'Kho xuất'), f_('ly_do_xuat', 'Lý do xuất'), f_('chi_tiet_hang_xuat', 'Chi tiết hàng xuất', 'items'), f_('ghi_chu', 'Ghi chú', 'long')]
  },
  CAN_DIEN_TU: {
    label: 'Màn hình cân điện tử', uniqueKey: null, required: ['khoi_luong', 'don_vi'],
    hint: 'Ảnh màn hình LED/LCD 7 đoạn của cân điện tử (có thể kèm phiếu cân). Đọc từng chữ số và vị trí dấu thập phân thật cẩn thận; ' +
      'khoi_luong là số kg (hoặc số theo don_vi); don_vi là kg, g, tấn hoặc lb; ' +
      'don_gia là giá tiền trên mỗi đơn vị và so_tien là thành tiền CHỈ khi ảnh / phiếu có ghi, nếu không có thì trả null, không tự tính; ' +
      'trang_thai là Gross, Net, Stable nếu màn hình có hiển thị. ' +
      'Nếu có chữ số bị chói hoặc đứt nét không chắc chắn, mô tả rõ trong ghi_chu_can.',
    fields: [f_('khoi_luong', 'Khối lượng (số kg)', 'number'), f_('don_vi', 'Đơn vị'), f_('don_gia', 'Đơn giá', 'number'), f_('so_tien', 'Số tiền', 'number'),
      f_('trang_thai', 'Trạng thái'), f_('ghi_chu_can', 'Ghi chú cân', 'long')]
  },
  BIEN_SO_XE: {
    label: 'Biển số xe', uniqueKey: null, required: ['bien_so_day_du'],
    hint: 'Biển số xe Việt Nam. ma_tinh_thanh là 2 chữ số đầu; seri_dang_ky là phần chữ/số seri sau mã tỉnh; ' +
      'loai_phuong_tien: ô tô, xe máy, xe tải...; mau_bien: trắng, vàng, xanh, đỏ.',
    fields: [f_('bien_so_day_du', 'Biển số đầy đủ'), f_('ma_tinh_thanh', 'Mã tỉnh/thành'), f_('seri_dang_ky', 'Seri đăng ký'),
      f_('loai_phuong_tien', 'Loại phương tiện'), f_('mau_bien', 'Màu biển')]
  }
};

/* ============================ WEB APP ============================ */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('OCR Tài liệu')
    // Cho phép nhúng trong khung của trang Vercel (khoatv-ocr-use.vercel.app) để giữ nguyên địa chỉ
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Cấu hình cho giao diện (không chứa bí mật). */
function getAppConfig() {
  const types = Object.keys(DOC_TYPES).map(function (code) {
    const t = DOC_TYPES[code];
    return { code: code, label: t.label, required: t.required, fields: t.fields };
  });
  return { types: types, itemFields: ITEM_FIELDS, maxFileBytes: LIMITS.MAX_FILE_BYTES, maxTotalBytes: LIMITS.MAX_TOTAL_BYTES, maxFiles: LIMITS.MAX_FILES };
}

/* ============================ TÀI KHOẢN & PHÂN QUYỀN ============================
 * File OCR_USERS, sheet USERS (một dòng / tài khoản) và sheet NHAT_KY (nhật ký thao tác).
 * Chỉ vai trò ADMIN được tạo / sửa / khoá / xoá tài khoản và tích quyền cho từng người dùng.
 * Quyền áp dụng cho BẢN GHI OCR đã quét: thêm, sửa / xoá bản ghi của chính mình, sửa / xoá bản ghi của người khác.
 * ADMIN luôn có toàn quyền. Tài khoản mặc định lần đầu: admin / khoatv@123 (bắt buộc đổi mật khẩu khi đăng nhập).
 */
const OLD_USER_HEADERS = ['username', 'full_name', 'active', 'new_password', 'salt', 'password_hash'];
const USER_HEADERS = [
  'username', 'full_name', 'role', 'active',
  'perm_add', 'perm_edit_own', 'perm_edit_other', 'perm_del_own', 'perm_del_other',
  'must_change', 'salt', 'password_hash', 'token_ver'
];
const AUDIT_HEADERS = ['time', 'user', 'action', 'target', 'detail'];
const ROLES = ['ADMIN', 'USER'];
const PERM_KEYS = ['perm_add', 'perm_edit_own', 'perm_edit_other', 'perm_del_own', 'perm_del_other'];
const PERM_DEFAULT = { perm_add: true, perm_edit_own: true, perm_edit_other: false, perm_del_own: false, perm_del_other: false };
const DEFAULT_ADMIN = { username: 'admin', full_name: 'Quản trị viên', password: 'khoatv@123' };

function toBool_(v) { return v === true || String(v).trim().toUpperCase() === 'TRUE'; }
function boolCell_(b) { return b ? 'TRUE' : 'FALSE'; }
function unesc_(s) { return /^'[=+\-@']/.test(s) ? s.slice(1) : s; }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function rowToUser_(r) {
  const u = {};
  USER_HEADERS.forEach(function (h, i) { u[h] = r[i]; });
  u.username = String(u.username || '').trim().toLowerCase();
  u.full_name = unesc_(String(u.full_name || ''));
  u.role = String(u.role).trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER';
  u.active = toBool_(u.active);
  u.must_change = toBool_(u.must_change);
  PERM_KEYS.forEach(function (k) { u[k] = u.role === 'ADMIN' ? true : toBool_(u[k]); });
  u.salt = String(u.salt || '');
  u.password_hash = String(u.password_hash || '');
  u.token_ver = Number(u.token_ver) || 1;
  return u;
}

function userToRow_(u) {
  return USER_HEADERS.map(function (h) {
    const v = u[h];
    if (h === 'active' || h === 'must_change' || PERM_KEYS.indexOf(h) >= 0) return boolCell_(v);
    if (h === 'token_ver') return String(v || 1);
    if (h === 'full_name') return cell_(v, 'string');
    return String(v === undefined || v === null ? '' : v);
  });
}

function readUsers_() {
  const sh = sheet_(usersBook_(), 'USERS', USER_HEADERS);
  const last = sh.getLastRow();
  const list = [];
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, USER_HEADERS.length).getValues().forEach(function (r, i) {
      if (!String(r[0]).trim()) return;
      const u = rowToUser_(r);
      u._row = i + 2;
      list.push(u);
    });
  }
  return { sh: sh, list: list };
}

function findUser_(username) {
  username = String(username || '').trim().toLowerCase();
  const list = readUsers_().list;
  for (let i = 0; i < list.length; i++) if (list[i].username === username) return list[i];
  return null;
}

function writeUser_(sh, row, u) {
  sh.getRange(row, 1, 1, USER_HEADERS.length).setNumberFormat('@').setValues([userToRow_(u)]);
  SpreadsheetApp.flush();
}

function appendUser_(sh, u) {
  const row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowAfter(sh.getMaxRows());
  writeUser_(sh, row, u);
}

function newPasswordFields_(u, password) {
  u.salt = Utilities.getUuid();
  u.password_hash = hashPassword_(password, u.salt);
}

function hashPassword_(password, salt) {
  let d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8);
  for (let i = 0; i < LIMITS.HASH_ROUNDS; i++) d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d);
  return Utilities.base64Encode(d);
}

function checkPasswordRule_(pw) {
  if (pw.length < LIMITS.MIN_PASSWORD || pw.length > 200) {
    throw new Error('Mật khẩu phải từ ' + LIMITS.MIN_PASSWORD + ' đến 200 ký tự.');
  }
}

/** Chuyển sheet USERS cũ (6 cột) sang cấu trúc mới. Chỉ gọi khi đang giữ khoá. */
function migrateUsers_(book) {
  const sh = book.getSheetByName('USERS');
  if (!sh || sh.getLastRow() === 0) return;
  const cur = sh.getRange(1, 1, 1, OLD_USER_HEADERS.length).getDisplayValues()[0];
  if (cur.join('|') !== OLD_USER_HEADERS.join('|')) return;
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, OLD_USER_HEADERS.length).getValues() : [];
  const out = [];
  rows.forEach(function (r) {
    const name = String(r[0]).trim().toLowerCase();
    if (!name) return;
    const u = {
      username: name, full_name: String(r[1] || ''), role: 'USER',
      active: !(r[2] === false || String(r[2]).toUpperCase() === 'FALSE'),
      must_change: false, salt: String(r[4] || ''), password_hash: String(r[5] || ''), token_ver: 1
    };
    PERM_KEYS.forEach(function (k) { u[k] = PERM_DEFAULT[k]; });
    const pw = String(r[3] || '');
    if (pw.length >= LIMITS.MIN_PASSWORD) { newPasswordFields_(u, pw); u.must_change = true; }
    out.push(userToRow_(u));
  });
  sh.clear();
  sh.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), USER_HEADERS.length).setNumberFormat('@');
  if (out.length) sh.getRange(2, 1, out.length, USER_HEADERS.length).setValues(out);
  SpreadsheetApp.flush();
}

/** Bảo đảm luôn có ít nhất một ADMIN: nếu chưa có thì tạo tài khoản mặc định (bắt buộc đổi mật khẩu). */
function ensureAdmin_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('admin_ok')) return;
  let seeded = false;
  withLock_(function () {
    const book = usersBook_();
    migrateUsers_(book);
    const ctx = readUsers_();
    const hasAdmin = ctx.list.some(function (u) { return u.role === 'ADMIN'; });
    if (!hasAdmin) {
      const exist = ctx.list.filter(function (u) { return u.username === DEFAULT_ADMIN.username; })[0];
      const u = exist || { username: DEFAULT_ADMIN.username, token_ver: 0 };
      u.full_name = u.full_name || DEFAULT_ADMIN.full_name;
      u.role = 'ADMIN'; u.active = true; u.must_change = true;
      PERM_KEYS.forEach(function (k) { u[k] = true; });
      newPasswordFields_(u, DEFAULT_ADMIN.password);
      u.token_ver = (Number(u.token_ver) || 0) + 1;
      if (exist) writeUser_(ctx.sh, exist._row, u); else appendUser_(ctx.sh, u);
      seeded = true;
    }
    cache.put('admin_ok', '1', 300);
  });
  if (seeded) audit_('system', 'TAO_ADMIN_MAC_DINH', DEFAULT_ADMIN.username, 'Bắt buộc đổi mật khẩu khi đăng nhập lần đầu');
}

function me_(u) {
  const perms = {};
  PERM_KEYS.forEach(function (k) { perms[k] = !!u[k]; });
  return { username: u.username, name: u.full_name || u.username, role: u.role, perms: perms, must_change: !!u.must_change };
}

function newSession_(u) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify({ u: u.username, v: u.token_ver }), LIMITS.SESSION_SECONDS);
  return token;
}

/* ---------- Đăng nhập / phiên ---------- */

function login(username, password) {
  username = String(username || '').trim().toLowerCase();
  password = String(password || '');
  if (!username || !password || username.length > 64 || password.length > 200) {
    throw new Error('Vui lòng nhập tên đăng nhập và mật khẩu.');
  }
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + hash_(username);
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= LIMITS.LOGIN_MAX_FAIL) {
    throw new Error('Tài khoản tạm khoá do nhập sai nhiều lần. Thử lại sau 15 phút.');
  }

  ensureAdmin_();
  const u = findUser_(username);
  let ok = false;
  if (u && u.active && u.salt && u.password_hash) ok = hashPassword_(password, u.salt) === u.password_hash;
  else hashPassword_(password, 'x'); // cân bằng thời gian xử lý, không lộ tài khoản có tồn tại hay không
  if (!ok) {
    cache.put(failKey, String(fails + 1), LIMITS.LOGIN_LOCK_SECONDS);
    throw new Error('Sai tên đăng nhập hoặc mật khẩu.');
  }
  cache.remove(failKey);
  return { token: newSession_(u), me: me_(u) };
}

function logout(token) {
  if (/^[a-f0-9]{64}$/.test(String(token || ''))) CacheService.getScriptCache().remove('sess_' + token);
  return true;
}

/** Giao diện gọi khi mở lại trang để kiểm tra phiên còn hạn. */
function checkSession(token) {
  const me = auth_(token, { soft: true, allowMustChange: true });
  return me || null;
}

function getMe(token) { return auth_(token, { allowMustChange: true }); }

/**
 * Xác thực phiên và nạp quyền MỚI NHẤT từ sheet USERS ở mỗi lần gọi,
 * nên quản trị viên khoá tài khoản / đổi quyền là có hiệu lực ngay.
 */
function auth_(token, opt) {
  opt = opt || {};
  const raw = /^[a-f0-9]{64}$/.test(String(token || '')) ? CacheService.getScriptCache().get('sess_' + token) : null;
  let s = null;
  try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
  const u = s && s.v !== undefined ? findUser_(s.u) : null;
  if (!u || !u.active || u.token_ver !== Number(s.v)) {
    if (opt.soft) return null;
    throw new Error('SESSION_EXPIRED');
  }
  if (u.must_change && !opt.allowMustChange) throw new Error('MUST_CHANGE_PASSWORD');
  return me_(u);
}

function changeMyPassword(token, oldPassword, newPassword) {
  const me = auth_(token, { allowMustChange: true });
  oldPassword = String(oldPassword || '');
  newPassword = String(newPassword || '');
  checkPasswordRule_(newPassword);
  if (newPassword === oldPassword) throw new Error('Mật khẩu mới phải khác mật khẩu hiện tại.');
  if (newPassword === DEFAULT_ADMIN.password) throw new Error('Mật khẩu mới không được dùng mật khẩu mặc định.');
  let u2;
  withLock_(function () {
    const ctx = readUsers_();
    const u = ctx.list.filter(function (x) { return x.username === me.username; })[0];
    if (!u) throw new Error('SESSION_EXPIRED');
    if (hashPassword_(oldPassword, u.salt) !== u.password_hash) throw new Error('Mật khẩu hiện tại không đúng.');
    newPasswordFields_(u, newPassword);
    u.must_change = false;
    u.token_ver = u.token_ver + 1;
    writeUser_(ctx.sh, u._row, u);
    u2 = u;
  });
  logout(token);
  audit_(me.username, 'DOI_MAT_KHAU', me.username, '');
  return { token: newSession_(u2), me: me_(u2) };
}

/* ---------- Quản lý tài khoản (chỉ ADMIN) ---------- */

function requireAdmin_(token) {
  const me = auth_(token);
  if (me.role !== 'ADMIN') throw new Error('Chỉ quản trị viên (ADMIN) được thực hiện thao tác này.');
  return me;
}

function normPerms_(input) {
  const p = {};
  PERM_KEYS.forEach(function (k) { p[k] = !!(input && toBool_(input[k])); });
  return p;
}

function userLite_(u) {
  const perms = {};
  PERM_KEYS.forEach(function (k) { perms[k] = !!u[k]; });
  return { username: u.username, full_name: u.full_name, role: u.role, active: u.active, must_change: u.must_change, perms: perms };
}

function listUsers(token) {
  requireAdmin_(token);
  return readUsers_().list.map(userLite_);
}

function createUser(token, d) {
  const admin = requireAdmin_(token);
  d = d || {};
  const username = String(d.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('Tên đăng nhập gồm 3-32 ký tự: chữ thường không dấu, số, dấu . _ -');
  const password = String(d.password || '');
  checkPasswordRule_(password);
  const role = ROLES.indexOf(d.role) >= 0 ? d.role : 'USER';
  const perms = normPerms_(d.perms);
  withLock_(function () {
    const ctx = readUsers_();
    if (ctx.list.some(function (x) { return x.username === username; })) throw new Error('Tên đăng nhập "' + username + '" đã tồn tại.');
    const u = { username: username, full_name: String(d.full_name || '').trim().slice(0, 100), role: role, active: true, must_change: true, token_ver: 1 };
    PERM_KEYS.forEach(function (k) { u[k] = role === 'ADMIN' ? true : perms[k]; });
    newPasswordFields_(u, password);
    appendUser_(ctx.sh, u);
  });
  audit_(admin.username, 'TAO_USER', username, 'role=' + role + '; ' + permText_(perms));
  return true;
}

function updateUser(token, username, patch) {
  const admin = requireAdmin_(token);
  username = String(username || '').trim().toLowerCase();
  patch = patch || {};
  const self = username === admin.username;
  const changed = [];
  withLock_(function () {
    const ctx = readUsers_();
    const u = ctx.list.filter(function (x) { return x.username === username; })[0];
    if (!u) throw new Error('Không tìm thấy tài khoản.');
    if (patch.full_name !== undefined) { u.full_name = String(patch.full_name || '').trim().slice(0, 100); changed.push('full_name'); }
    if (patch.role !== undefined && patch.role !== u.role) {
      if (ROLES.indexOf(patch.role) < 0) throw new Error('Vai trò không hợp lệ.');
      if (self) throw new Error('Không thể tự đổi vai trò của chính mình.');
      u.role = patch.role; changed.push('role=' + u.role);
    }
    if (patch.active !== undefined && toBool_(patch.active) !== u.active) {
      if (self) throw new Error('Không thể tự khoá tài khoản của chính mình.');
      u.active = toBool_(patch.active); changed.push(u.active ? 'mo_khoa' : 'khoa');
    }
    if (patch.perms) {
      PERM_KEYS.forEach(function (k) { if (k in patch.perms) u[k] = toBool_(patch.perms[k]); });
      changed.push('quyen: ' + permText_(u));
    }
    if (patch.password) {
      if (self) throw new Error('Hãy dùng chức năng "Mật khẩu" để đổi mật khẩu của chính bạn.');
      const pw = String(patch.password);
      checkPasswordRule_(pw);
      newPasswordFields_(u, pw);
      u.must_change = true;
      u.token_ver = u.token_ver + 1;
      changed.push('dat_lai_mat_khau');
    }
    if (u.role === 'ADMIN') PERM_KEYS.forEach(function (k) { u[k] = true; });
    const admins = ctx.list.filter(function (x) { return x.username !== u.username && x.role === 'ADMIN' && x.active; }).length +
      (u.role === 'ADMIN' && u.active ? 1 : 0);
    if (admins < 1) throw new Error('Phải còn ít nhất một quản trị viên đang hoạt động.');
    writeUser_(ctx.sh, u._row, u);
  });
  audit_(admin.username, 'SUA_USER', username, changed.join('; '));
  return true;
}

function deleteUser(token, username) {
  const admin = requireAdmin_(token);
  username = String(username || '').trim().toLowerCase();
  if (username === admin.username) throw new Error('Không thể tự xoá tài khoản của chính mình.');
  withLock_(function () {
    const ctx = readUsers_();
    const u = ctx.list.filter(function (x) { return x.username === username; })[0];
    if (!u) throw new Error('Không tìm thấy tài khoản.');
    const others = ctx.list.filter(function (x) { return x.username !== username && x.role === 'ADMIN' && x.active; }).length;
    if (u.role === 'ADMIN' && others < 1) throw new Error('Phải còn ít nhất một quản trị viên đang hoạt động.');
    ctx.sh.deleteRow(u._row);
  });
  audit_(admin.username, 'XOA_USER', username, 'Các bản ghi OCR do tài khoản này quét vẫn được giữ nguyên');
  return true;
}

function permText_(p) {
  const on = PERM_KEYS.filter(function (k) { return p[k]; });
  return on.length ? on.join(',') : 'khong_co_quyen';
}

/** Nhật ký thao tác (sheet NHAT_KY trong OCR_USERS). Lỗi ghi nhật ký không làm hỏng thao tác chính. Không gọi khi đang giữ khoá. */
function audit_(who, action, target, detail) {
  try {
    withLock_(function () {
      const sh = sheet_(usersBook_(), 'NHAT_KY', AUDIT_HEADERS);
      const row = sh.getLastRow() + 1;
      if (row > sh.getMaxRows()) sh.insertRowAfter(sh.getMaxRows());
      sh.getRange(row, 1, 1, AUDIT_HEADERS.length).setNumberFormat('@').setValues([[
        Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'),
        cell_(who, 'string'), cell_(action, 'string'), cell_(target, 'string'), cell_(String(detail || '').slice(0, 1000), 'string')
      ]]);
    });
  } catch (e) {
    console.error('Không ghi được nhật ký: ' + e.message);
  }
}

/* ---------- Quyền trên bản ghi OCR ---------- */

function canEdit_(me, owner) {
  return me.role === 'ADMIN' || (owner === me.username ? me.perms.perm_edit_own : me.perms.perm_edit_other);
}
function canDelete_(me, owner) {
  return me.role === 'ADMIN' || (owner === me.username ? me.perms.perm_del_own : me.perms.perm_del_other);
}
/** Xem bản ghi của người khác: ADMIN hoặc người có quyền sửa / xoá bản ghi của người khác. Còn lại chỉ thấy bản ghi của mình. */
function canViewAll_(me) {
  return me.role === 'ADMIN' || me.perms.perm_edit_other || me.perms.perm_del_other;
}

/* ============================ BƯỚC 1: QUÉT ============================ */

/**
 * Lưu các tệp gốc vào Drive rồi gọi Gemini MỘT lần cho cả bộ tệp (ví dụ CCCD 2 mặt = 2 ảnh, 1 bản ghi).
 * CHƯA ghi Google Sheets: người dùng xem và sửa kết quả trên giao diện, sau đó mới gọi saveRecord.
 * payload = { docType, files: [{ mimeType, base64 }, ...] }  (tối đa LIMITS.MAX_FILES tệp)
 */
function scanDocument(token, payload) {
  const started = Date.now();
  const me = auth_(token);
  if (!me.perms.perm_add) throw new Error('Tài khoản của bạn không có quyền thêm bản ghi.');
  payload = payload || {};
  const type = DOC_TYPES[payload.docType];
  if (!type) throw new Error('Loại tài liệu không hợp lệ.');
  const input = Array.isArray(payload.files) ? payload.files : [];
  if (!input.length) throw new Error('Chưa có tệp để quét.');
  if (input.length > LIMITS.MAX_FILES) throw new Error('Tối đa ' + LIMITS.MAX_FILES + ' tệp cho một tài liệu.');
  let total = 0;
  const items = input.map(function (f) {
    f = f || {};
    const ext = MIME_EXT[f.mimeType];
    if (!ext) throw new Error('Chỉ hỗ trợ ảnh JPG, PNG, WEBP hoặc tệp PDF.');
    const b64 = String(f.base64 || '');
    if (!b64) throw new Error('Có tệp rỗng, hãy chọn lại.');
    const size = b64.length * 0.75;
    if (size > LIMITS.MAX_FILE_BYTES) throw new Error('Có tệp quá lớn (tối đa 14 MB mỗi tệp). Với PDF dài, hãy tách 5-10 trang mỗi lượt.');
    total += size;
    return { mimeType: f.mimeType, ext: ext, b64: b64 };
  });
  if (total > LIMITS.MAX_TOTAL_BYTES) throw new Error('Tổng dung lượng các tệp quá lớn (tối đa 24 MB).');
  rateLimit_(me.username);

  const blobs = items.map(function (it) {
    try { return Utilities.base64Decode(it.b64); } catch (e) { throw new Error('Dữ liệu tệp không hợp lệ.'); }
  });

  const now = new Date();
  const stamp = Utilities.formatDate(now, TZ, 'yyyyMMdd_HHmmss') + '_' + Utilities.getUuid().slice(0, 6);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let folder;
  try { folder = pathFolder_([DIRS.RAW, Utilities.formatDate(now, TZ, 'yyyy')]); } finally { lock.releaseLock(); }
  const fileIds = items.map(function (it, i) {
    const name = 'RAW_' + payload.docType + '_' + stamp + (items.length > 1 ? '_' + (i + 1) : '') + '.' + it.ext;
    const file = folder.createFile(Utilities.newBlob(blobs[i], it.mimeType, name));
    file.setDescription('Quét bởi ' + me.username);
    return file.getId();
  });

  const data = callGemini_(type, items.map(function (it) { return { mimeType: it.mimeType, b64: it.b64 }; }));
  return { data: data, fileIds: fileIds, ms: Date.now() - started };
}

function rateLimit_(username) {
  const cache = CacheService.getScriptCache();
  const key = 'rate_' + hash_(username) + '_' + Math.floor(Date.now() / 600000);
  const n = Number(cache.get(key) || 0);
  if (n >= LIMITS.SCAN_PER_10_MIN) throw new Error('Bạn quét quá nhanh. Vui lòng thử lại sau ít phút.');
  cache.put(key, String(n + 1), 700);
}

/* ============================ GEMINI ============================ */

function buildSchema_(type) {
  const props = {};
  type.fields.forEach(function (f) {
    if (f.type === 'items') {
      const itemProps = {};
      ITEM_FIELDS.forEach(function (c) {
        itemProps[c.k] = { type: c.type === 'number' ? 'NUMBER' : 'STRING', nullable: true };
      });
      props[f.k] = { type: 'ARRAY', nullable: true, description: f.label, items: { type: 'OBJECT', properties: itemProps } };
    } else {
      props[f.k] = { type: f.type === 'number' ? 'NUMBER' : 'STRING', nullable: true, description: f.label };
    }
  });
  return { type: 'OBJECT', properties: props, required: type.fields.map(function (f) { return f.k; }) };
}

function callGemini_(type, files) {
  const model = prop_('GEMINI_MODEL', DEFAULTS.GEMINI_MODEL);
  const system =
    'Bạn là bộ máy OCR bóc tách dữ liệu từ tài liệu tiếng Việt. Quy tắc bắt buộc:\n' +
    '1. Chỉ ghi những gì NHÌN THẤY trong tài liệu. Trường nào không có, bị che, mờ không đọc được thì trả null. Tuyệt đối không suy đoán hay tự điền.\n' +
    '2. Giữ nguyên dấu tiếng Việt và chính tả như trên tài liệu; không tự viết hoa/thường lại.\n' +
    '3. Ngày tháng ghi dạng dd/MM/yyyy.\n' +
    '4. Trường kiểu số: chỉ trả số thuần (không dấu phân cách hàng nghìn, không ký hiệu tiền tệ hay đơn vị).\n' +
    '5. Mã số, số giấy tờ: giữ đủ mọi ký tự kể cả số 0 ở đầu.\n' +
    '6. Nếu tệp không phải đúng loại tài liệu được yêu cầu, trả null cho tất cả các trường.';
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{
      role: 'user',
      parts: files.map(function (f) { return { inlineData: { mimeType: f.mimeType, data: f.b64 } }; }).concat([
        { text: 'Loại tài liệu: ' + type.label + '. ' + type.hint +
          (files.length > 1 ? '\nCó ' + files.length + ' tệp: đây là các mặt / trang khác nhau của CÙNG MỘT tài liệu. Hãy gộp thông tin từ tất cả các tệp vào MỘT kết quả duy nhất.' : '') +
          '\nHãy bóc tách dữ liệu theo đúng schema.' }
      ])
    }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: buildSchema_(type) }
  };
  const resp = fetchRetry_('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': prop_('GEMINI_API_KEY') },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code !== 200) {
    console.error('Gemini ' + code + ': ' + resp.getContentText().slice(0, 800));
    if (code === 404) throw new Error('Model Gemini "' + model + '" không tồn tại hoặc đã ngừng. Kiểm tra Script Property GEMINI_MODEL.');
    if (code === 429) throw new Error('Gemini đang quá tải hoặc hết hạn mức. Vui lòng thử lại sau.');
    throw new Error('Gemini trả lỗi ' + code + '. Xem nhật ký Apps Script để biết chi tiết.');
  }
  const json = JSON.parse(resp.getContentText());
  const cand = json.candidates && json.candidates[0];
  const text = cand && cand.content && cand.content.parts
    ? cand.content.parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('')
    : '';
  if (!text) {
    console.error('Gemini không trả nội dung: ' + JSON.stringify(json).slice(0, 800));
    throw new Error('AI không đọc được tài liệu này. Hãy chụp lại rõ hơn.');
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Kết quả AI bị cắt giữa chừng (tài liệu quá dài?). Hãy thử lại với ít trang hơn.');
  }
}

/* ============================ BƯỚC 2: LƯU & QUẢN LÝ BẢN GHI ============================ */

function typeCols_(type) { return SYS_COLS.concat(type.fields); }
function typeHeaders_(type) { return typeCols_(type).map(function (c) { return c.k; }); }
function colFormat_(c) { return c.type === 'date' ? 'yyyy-mm-dd hh:mm:ss' : (c.type === 'number' ? '#,##0.###' : '@'); }

/** Làm sạch dữ liệu người dùng gửi lên và kiểm tra trường bắt buộc. */
function buildRecord_(type, data) {
  data = data || {};
  const record = {};
  type.fields.forEach(function (f) { record[f.k] = clean_(data[f.k], f.type); });
  const missing = type.fields.filter(function (f) {
    return type.required.indexOf(f.k) >= 0 && (record[f.k] === null || record[f.k] === '');
  });
  if (missing.length) throw new Error('Thiếu trường bắt buộc: ' + missing.map(function (f) { return f.label; }).join(', '));
  return record;
}

function parsePeriod_(period) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period || ''));
  if (!m) throw new Error('Tháng không hợp lệ (định dạng yyyy-MM).');
  return { y: m[1], m: m[2] };
}

function checkType_(docType) {
  const type = DOC_TYPES[docType];
  if (!type) throw new Error('Loại tài liệu không hợp lệ.');
  return type;
}

function checkFileId_(fileId) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(String(fileId || ''))) throw new Error('Mã bản ghi không hợp lệ.');
  return String(fileId);
}

/** Tìm dòng theo raw_file_id (duy nhất cho mỗi bản ghi). Trả 0 nếu không thấy. */
function locateRow_(sh, headers, fileId) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, headers.indexOf('raw_file_id') + 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === fileId) return i + 2;
  return 0;
}

/** Ghi bản ghi MỚI đã được người dùng kiểm tra vào Google Sheets (ghi đè theo khoá nghiệp vụ để chống trùng). */
function saveRecord(token, docType, data, fileIds) {
  const me = auth_(token);
  if (!me.perms.perm_add) throw new Error('Tài khoản của bạn không có quyền thêm bản ghi.');
  const type = checkType_(docType);
  const ids = (Array.isArray(fileIds) ? fileIds : [fileIds]).map(String);
  if (!ids.length || ids.length > LIMITS.MAX_FILES || ids.some(function (id) { return !/^[A-Za-z0-9_-]{20,80}$/.test(id); })) {
    throw new Error('Thiếu tệp gốc đối soát. Hãy quét lại.');
  }
  // Chỉ nhận các tệp chính người này vừa quét (do scanDocument tạo), không cho gắn tệp Drive tuỳ ý vào bản ghi
  ids.forEach(function (id) {
    let f = null;
    try { f = DriveApp.getFileById(id); } catch (e) { f = null; }
    if (!f || f.isTrashed() || f.getName().indexOf('RAW_') !== 0 || f.getDescription() !== 'Quét bởi ' + me.username) {
      throw new Error('Tệp gốc không hợp lệ hoặc không phải do bạn quét. Hãy quét lại.');
    }
  });
  const fileId = ids[0]; // tệp đầu tiên là mã định danh của bản ghi; mọi tệp được ghi trong raw_file_url (mỗi dòng một link)
  const record = buildRecord_(type, data);

  record.scan_timestamp = new Date();
  record.document_type = docType;
  record.raw_file_url = ids.map(function (id) { return 'https://drive.google.com/file/d/' + id + '/view'; }).join('\n');
  record.raw_file_id = fileId;
  record.scanned_by = me.username;

  const cols = typeCols_(type);
  const headers = typeHeaders_(type);
  const formats = cols.map(colFormat_);
  const values = cols.map(function (c) { return cell_(record[c.k], c.type); });
  const keyName = type.uniqueKey || 'raw_file_id';
  const keyVal = String(record[keyName]);
  const ownerIdx = headers.indexOf('scanned_by');

  let row = 0, updated = false, book;
  withLock_(function () {
    book = monthBook_(record.scan_timestamp);
    const sh = sheet_(book, docType, headers);
    const last = sh.getLastRow();
    if (last > 1) {
      const keys = sh.getRange(2, headers.indexOf(keyName) + 1, last - 1, 1).getDisplayValues();
      for (let i = 0; i < keys.length; i++) {
        if (keys[i][0] === keyVal) { row = i + 2; updated = true; break; }
      }
    }
    if (updated) {
      // Trùng khoá nghiệp vụ: ghi đè bản ghi cũ, nên phải có quyền sửa bản ghi đó; người sở hữu giữ nguyên
      const owner = String(sh.getRange(row, ownerIdx + 1).getDisplayValue());
      if (!canEdit_(me, owner)) {
        throw new Error('Đã có bản ghi trùng (' + keyName + ' = ' + keyVal + ') do ' + (owner || 'người khác') +
          ' quét. Bạn không có quyền ghi đè bản ghi này.');
      }
      values[ownerIdx] = owner;
    } else {
      row = last + 1;
      if (row > sh.getMaxRows()) sh.insertRowAfter(sh.getMaxRows());
    }
    sh.getRange(row, 1, 1, headers.length).setNumberFormats([formats]).setValues([values]);
    SpreadsheetApp.flush();
  });
  audit_(me.username, updated ? 'GHI_DE' : 'THEM', docType, keyName + '=' + keyVal + '; ' + book.getName() + ' dòng ' + row);
  return { book: book.getName(), sheet: docType, row: row, updated: updated };
}

/** Danh sách các tháng (yyyy, MM) từ ngày `from` đến ngày `to` (yyyy-MM-dd). */
function monthsBetween_(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push({ y: String(y), m: ('0' + m).slice(-2) });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function parseRange_(from, to) {
  const re = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  if (!to && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(from || ''))) { // tương thích: chỉ truyền tháng yyyy-MM
    const p = parsePeriod_(from);
    const last = new Date(Number(p.y), Number(p.m), 0).getDate();
    return { from: p.y + '-' + p.m + '-01', to: p.y + '-' + p.m + '-' + ('0' + last).slice(-2) };
  }
  from = String(from || ''); to = String(to || '');
  if (!re.test(from) || !re.test(to)) throw new Error('Ngày không hợp lệ (định dạng yyyy-MM-dd).');
  if (from > to) throw new Error('"Từ ngày" phải trước hoặc bằng "Đến ngày".');
  return { from: from, to: to };
}

/**
 * Danh sách bản ghi của một loại tài liệu có ngày lưu từ `from` đến `to` (yyyy-MM-dd, gồm cả hai đầu).
 * Dữ liệu chia theo tháng nên đọc lần lượt các file tháng trong khoảng (tối đa 24 tháng).
 * Mới nhất ở trên, tối đa LIMITS.MAX_LIST dòng. Mỗi dòng có _period (yyyy-MM) để sửa / xoá / xem tệp.
 */
function listRecords(token, docType, from, to) {
  const me = auth_(token);
  const type = checkType_(docType);
  const range = parseRange_(from, to);
  const months = monthsBetween_(range.from, range.to);
  if (months.length > 24) throw new Error('Khoảng thời gian tối đa 24 tháng.');
  const viewAll = canViewAll_(me);
  const out = { rows: [], viewAll: viewAll, truncated: false, total: 0, from: range.from, to: range.to };

  const cols = typeCols_(type), headers = typeHeaders_(type);
  const all = [];
  months.forEach(function (mo) {
    const book = findMonthBook_(mo.y, mo.m);
    const sh = book ? book.getSheetByName(docType) : null;
    if (!sh || sh.getLastRow() < 2) return;
    const width = Math.max(headers.length, sh.getLastColumn());
    const cur = sh.getRange(1, 1, 1, width).getDisplayValues()[0].map(String);
    const pos = {};
    cur.forEach(function (h, i) { if (h !== '') pos[h] = i; });
    if (headers.some(function (h) { return SYS_COLS.some(function (c) { return c.k === h; }) && pos[h] === undefined; })) {
      throw new Error('Dòng tiêu đề sheet ' + docType + ' (' + mo.y + '-' + mo.m + ') đã bị sửa, không khớp cấu trúc.');
    }
    const raw = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
    raw.forEach(function (r) {
      const o = {};
      cols.forEach(function (c) {
        let v = pos[c.k] === undefined ? '' : r[pos[c.k]];
        if (v instanceof Date) v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
        else if (c.type === 'items') {
          try { v = v === '' ? null : JSON.parse(unesc_(String(v))); } catch (e) { v = null; }
        } else if (c.type === 'number') v = v === '' ? null : Number(v);
        else v = unesc_(String(v === null || v === undefined ? '' : v));
        o[c.k] = v;
      });
      if (!o.raw_file_id) return;
      if (!viewAll && o.scanned_by !== me.username) return;
      const day = String(o.scan_timestamp).slice(0, 10);
      if (day < range.from || day > range.to) return;
      o._period = mo.y + '-' + mo.m;
      all.push(o);
    });
  });
  all.sort(function (a, b) { return a.scan_timestamp < b.scan_timestamp ? 1 : (a.scan_timestamp > b.scan_timestamp ? -1 : 0); });
  out.total = all.length;
  if (all.length > LIMITS.MAX_LIST) { out.truncated = true; all.length = LIMITS.MAX_LIST; }
  all.forEach(function (o) {
    o._edit = canEdit_(me, o.scanned_by);
    o._del = canDelete_(me, o.scanned_by);
  });
  out.rows = all;
  return out;
}

/** Ghi nhật ký việc kết xuất Excel (file được tạo ở trình duyệt từ dữ liệu người dùng được phép xem). */
function logExport(token, docType, from, to, count) {
  const me = auth_(token);
  checkType_(docType);
  audit_(me.username, 'XUAT_EXCEL', docType, String(from || '').slice(0, 10) + ' đến ' + String(to || '').slice(0, 10) + '; ' + Number(count || 0) + ' bản ghi');
  return true;
}

/**
 * Trả tệp gốc (ảnh / PDF) của một bản ghi để xem lại trên giao diện, kể cả với người dùng bên ngoài
 * không có quyền vào Drive. Chỉ xem được tệp của bản ghi mà chính người đó được phép xem.
 */
function getRawFile(token, docType, period, fileId) {
  const me = auth_(token);
  const type = checkType_(docType);
  const p = parsePeriod_(period);
  fileId = checkFileId_(fileId);
  const headers = typeHeaders_(type);
  const book = findMonthBook_(p.y, p.m);
  const sh = book ? book.getSheetByName(docType) : null;
  const row = sh ? locateRow_(sh, headers, fileId) : 0;
  if (!row) throw new Error('Không tìm thấy bản ghi (có thể đã bị xoá).');
  const owner = String(sh.getRange(row, headers.indexOf('scanned_by') + 1).getDisplayValue());
  if (!canViewAll_(me) && owner !== me.username) throw new Error('Bạn không có quyền xem tệp của bản ghi này.');
  // Chỉ trả các tệp được ghi trong chính dòng này (raw_file_url), không đọc tệp Drive tuỳ ý
  const urls = String(sh.getRange(row, headers.indexOf('raw_file_url') + 1).getDisplayValue());
  const ids = [];
  const re = /file\/d\/([A-Za-z0-9_-]{20,80})/g;
  let m;
  while ((m = re.exec(urls)) !== null && ids.length < LIMITS.MAX_FILES) ids.push(m[1]);
  if (!ids.length) ids.push(fileId);

  let total = 0, firstErr = null;
  const files = ids.map(function (id, i) {
    try {
      const file = DriveApp.getFileById(id);
      if (file.isTrashed()) throw new Error('Tệp gốc đã bị chuyển vào thùng rác trên Drive.');
      const blob = file.getBlob();
      const mime = blob.getContentType();
      if (!MIME_EXT[mime]) throw new Error('Định dạng tệp gốc không được hỗ trợ xem.');
      const bytes = blob.getBytes();
      total += bytes.length;
      if (total > LIMITS.MAX_TOTAL_BYTES) throw new Error('Tệp quá lớn để xem trên giao diện. Hãy mở trực tiếp trên Drive.');
      return { mimeType: mime, name: file.getName(), base64: Utilities.base64Encode(bytes) };
    } catch (e) {
      const msg = e.message && /^(Tệp|Định dạng)/.test(e.message) ? e.message : 'Không tìm thấy tệp gốc trên Drive (có thể đã bị xoá).';
      if (!firstErr) firstErr = msg;
      return { error: msg, name: 'Tệp ' + (i + 1) };
    }
  });
  if (files.every(function (f) { return f.error; })) throw new Error(firstErr);
  return { files: files };
}

/** Sửa một bản ghi đã lưu. Cần quyền sửa của chính mình / của người khác tuỳ chủ sở hữu. */
function updateRecord(token, docType, period, fileId, data) {
  const me = auth_(token);
  const type = checkType_(docType);
  const p = parsePeriod_(period);
  fileId = checkFileId_(fileId);
  const record = buildRecord_(type, data);
  const headers = typeHeaders_(type);
  const start = SYS_COLS.length + 1;
  const values = type.fields.map(function (f) { return cell_(record[f.k], f.type); });
  const formats = type.fields.map(colFormat_);

  let keyDesc = '';
  withLock_(function () {
    const book = findMonthBook_(p.y, p.m);
    if (!book) throw new Error('Không tìm thấy bản ghi (có thể đã bị xoá).');
    const sh = sheet_(book, docType, headers);
    const row = locateRow_(sh, headers, fileId);
    if (!row) throw new Error('Không tìm thấy bản ghi (có thể đã bị xoá).');
    const owner = String(sh.getRange(row, headers.indexOf('scanned_by') + 1).getDisplayValue());
    if (!canEdit_(me, owner)) {
      throw new Error(owner === me.username ? 'Bạn không có quyền sửa bản ghi của chính mình.' : 'Bạn không có quyền sửa bản ghi của người khác.');
    }
    const keyName = type.uniqueKey;
    if (keyName && record[keyName] !== null) {
      const kv = String(record[keyName]);
      const last = sh.getLastRow();
      const keys = sh.getRange(2, headers.indexOf(keyName) + 1, last - 1, 1).getDisplayValues();
      for (let i = 0; i < keys.length; i++) {
        if (i + 2 !== row && keys[i][0] === kv) throw new Error('Đã có bản ghi khác trong tháng này trùng ' + keyName + ' = ' + kv + '.');
      }
      keyDesc = keyName + '=' + kv;
    }
    sh.getRange(row, start, 1, type.fields.length).setNumberFormats([formats]).setValues([values]);
    SpreadsheetApp.flush();
    keyDesc += (keyDesc ? '; ' : '') + book.getName() + ' dòng ' + row + '; chủ sở hữu ' + owner;
  });
  audit_(me.username, 'SUA', docType, keyDesc);
  return true;
}

/** Xoá dòng dữ liệu của bản ghi. Tệp ảnh gốc trên Drive được giữ lại để đối soát. */
function deleteRecord(token, docType, period, fileId) {
  const me = auth_(token);
  const type = checkType_(docType);
  const p = parsePeriod_(period);
  fileId = checkFileId_(fileId);
  const headers = typeHeaders_(type);

  let desc = '';
  withLock_(function () {
    const book = findMonthBook_(p.y, p.m);
    if (!book) throw new Error('Không tìm thấy bản ghi (có thể đã bị xoá).');
    const sh = sheet_(book, docType, headers);
    const row = locateRow_(sh, headers, fileId);
    if (!row) throw new Error('Không tìm thấy bản ghi (có thể đã bị xoá).');
    const owner = String(sh.getRange(row, headers.indexOf('scanned_by') + 1).getDisplayValue());
    if (!canDelete_(me, owner)) {
      throw new Error(owner === me.username ? 'Bạn không có quyền xoá bản ghi của chính mình.' : 'Bạn không có quyền xoá bản ghi của người khác.');
    }
    const keyName = type.uniqueKey || 'raw_file_id';
    desc = keyName + '=' + sh.getRange(row, headers.indexOf(keyName) + 1).getDisplayValue() +
      '; ' + book.getName() + '; chủ sở hữu ' + owner + '; tệp gốc ' + fileId;
    if (sh.getMaxRows() - sh.getFrozenRows() <= 1) sh.getRange(row, 1, 1, headers.length).clearContent();
    else sh.deleteRow(row);
    SpreadsheetApp.flush();
  });
  audit_(me.username, 'XOA', docType, desc);
  return true;
}

const SYS_COLS = [
  { k: 'scan_timestamp', type: 'date' }, { k: 'document_type', type: 'string' }, { k: 'raw_file_url', type: 'string' },
  { k: 'raw_file_id', type: 'string' }, { k: 'scanned_by', type: 'string' }
];

/** Chuyển giá trị thành nội dung ô. Chuỗi bắt đầu bằng = + - @ được ép thành văn bản để không bị hiểu là công thức. */
function cell_(v, type) {
  if (v === null || v === undefined) return '';
  if (type === 'date' || type === 'number') return v;
  let s = type === 'items' ? JSON.stringify(v) : String(v);
  if (s.length > 49000) throw new Error('Nội dung quá dài cho một ô Google Sheets. Hãy quét ít trang hơn.');
  if (/^[=+\-@']/.test(s)) s = "'" + s;
  return s;
}

/** Lấy sheet theo tên trong file ss; tự tạo kèm dòng tiêu đề nếu chưa có. */
function sheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (name === 'USERS') sh.getRange(2, 1, sh.getMaxRows() - 1, headers.length).setNumberFormat('@');
  } else {
    const width = Math.max(headers.length, sh.getLastColumn ? sh.getLastColumn() : headers.length);
    const cur = sh.getRange(1, 1, 1, width).getDisplayValues()[0].map(function (h) { return String(h); });
    while (cur.length && cur[cur.length - 1] === '') cur.pop();
    if (cur.join('|') !== headers.join('|')) {
      // Cấu trúc được bổ sung cột mới (ví dụ thêm đơn giá, số tiền cho cân điện tử): chèn thêm cột đúng vị trí,
      // dữ liệu cũ giữ nguyên. Chỉ làm khi mọi cột cũ vẫn còn và đúng thứ tự; ngược lại coi là tiêu đề bị sửa.
      let j = 0;
      const isSub = cur.every(function (h) { while (j < headers.length && headers[j] !== h) j++; return j++ < headers.length; });
      if (!isSub) throw new Error('Dòng tiêu đề sheet ' + name + ' đã bị sửa, không khớp cấu trúc. Vui lòng khôi phục.');
      for (let i = 0; i < headers.length; i++) {
        if (cur[i] !== headers[i]) {
          sh.insertColumnBefore(i + 1);
          sh.getRange(1, i + 1).setValue(headers[i]).setFontWeight('bold');
          cur.splice(i, 0, headers[i]);
        }
      }
    }
  }
  return sh;
}

/* ---------- Thư mục và file trên Drive ----------
 * Các hàm dưới đây có thể tạo mới thư mục/file nên PHẢI được gọi khi đang giữ LockService,
 * để hai người dùng cùng lúc không tạo ra hai thư mục hoặc hai file trùng tên.
 */

/** Tìm (hoặc tạo) thư mục con theo đường dẫn tính từ thư mục gốc. Ví dụ ['DU_LIEU','2026','11']. */
function pathFolder_(names) {
  const cache = CacheService.getScriptCache();
  const key = 'fd_' + names.join('/');
  const hit = cache.get(key);
  if (hit) {
    try {
      const f = DriveApp.getFolderById(hit);
      if (!f.isTrashed()) return f;
    } catch (e) { /* thư mục đã bị xoá: tìm lại bên dưới */ }
  }
  let folder = DriveApp.getFolderById(prop_('DRIVE_FOLDER_ID', DEFAULTS.DRIVE_FOLDER_ID));
  names.forEach(function (n) {
    let next = null;
    const it = folder.getFoldersByName(n);
    while (it.hasNext() && !next) {
      const c = it.next();
      if (!c.isTrashed()) next = c;
    }
    folder = next || folder.createFolder(n);
  });
  cache.put(key, folder.getId(), 21600);
  return folder;
}

/** Tìm (hoặc tạo) file Google Sheets tên `name` trong `folder`. onCreate(ss) chạy 1 lần khi file vừa được tạo. */
function book_(folder, name, onCreate) {
  const cache = CacheService.getScriptCache();
  const key = 'ss_' + folder.getId() + '_' + name;
  const hit = cache.get(key);
  if (hit) {
    try {
      if (!DriveApp.getFileById(hit).isTrashed()) return SpreadsheetApp.openById(hit);
    } catch (e) { /* file đã bị xoá: tìm lại bên dưới */ }
  }
  let id = null;
  const it = folder.getFilesByName(name);
  while (it.hasNext() && !id) {
    const f = it.next();
    if (!f.isTrashed() && f.getMimeType() === 'application/vnd.google-apps.spreadsheet') id = f.getId();
  }
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create(name);
    ss.setSpreadsheetTimeZone(TZ);
    id = ss.getId();
    DriveApp.getFileById(id).moveTo(folder);
    const first = ss.getSheets()[0];
    onCreate(ss);
    if (ss.getSheets().length > 1) ss.deleteSheet(first);
  }
  cache.put(key, id, 21600);
  return ss;
}

/** File dữ liệu của tháng chứa thời điểm `date`: DU_LIEU/yyyy/MM/OCR_yyyy_MM, đủ 12 sheet. */
function monthBook_(date) {
  const y = Utilities.formatDate(date, TZ, 'yyyy'), m = Utilities.formatDate(date, TZ, 'MM');
  return book_(pathFolder_([DIRS.DATA, y, m]), DIRS.BOOK_PREFIX + y + '_' + m, function (ss) {
    Object.keys(DOC_TYPES).forEach(function (code) {
      sheet_(ss, code, SYS_COLS.concat(DOC_TYPES[code].fields).map(function (c) { return c.k; }));
    });
  });
}

/** Như monthBook_ nhưng KHÔNG tạo mới: trả null nếu tháng đó chưa có dữ liệu. Dùng cho thao tác chỉ đọc / sửa / xoá. */
function findMonthBook_(y, m) {
  let folder = DriveApp.getFolderById(prop_('DRIVE_FOLDER_ID', DEFAULTS.DRIVE_FOLDER_ID));
  const path = [DIRS.DATA, y, m];
  for (let i = 0; i < path.length; i++) {
    let next = null;
    const it = folder.getFoldersByName(path[i]);
    while (it.hasNext() && !next) { const c = it.next(); if (!c.isTrashed()) next = c; }
    if (!next) return null;
    folder = next;
  }
  const name = DIRS.BOOK_PREFIX + y + '_' + m;
  const files = folder.getFilesByName(name);
  while (files.hasNext()) {
    const f = files.next();
    if (!f.isTrashed() && f.getMimeType() === 'application/vnd.google-apps.spreadsheet') return SpreadsheetApp.openById(f.getId());
  }
  return null;
}

/** File tài khoản đăng nhập, nằm ngay trong thư mục gốc. */
function usersBook_() {
  return book_(pathFolder_([]), DIRS.USERS_BOOK, function (ss) { sheet_(ss, 'USERS', USER_HEADERS); });
}

function clean_(v, type) {
  if (v === undefined || v === null) return null;
  if (type === 'items') {
    if (!Array.isArray(v)) return null;
    const rows = v.slice(0, 500).map(function (row) {
      const o = {};
      ITEM_FIELDS.forEach(function (c) { o[c.k] = clean_(row ? row[c.k] : null, c.type); });
      return o;
    }).filter(function (o) {
      return ITEM_FIELDS.some(function (c) { return o[c.k] !== null; });
    });
    return rows.length ? rows : null;
  }
  if (type === 'number') {
    if (v === '') return null;
    const n = Number(v);
    if (!isFinite(n)) throw new Error('Giá trị số không hợp lệ: ' + v);
    return n;
  }
  const s = String(v).trim().slice(0, 4000);
  return s === '' ? null : s;
}

/* ============================ TIỆN ÍCH ============================ */

function prop_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (v) return v.trim();
  if (fallback !== undefined) return fallback;
  throw new Error('Chưa cấu hình Script Property: ' + key);
}

function hash_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)).slice(0, 32);
}

/** UrlFetch có thử lại luỹ thừa cho lỗi 429 / 5xx / lỗi mạng. */
function fetchRetry_(url, options) {
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    try {
      const resp = UrlFetchApp.fetch(url, options);
      const code = resp.getResponseCode();
      if (code !== 429 && code < 500) return resp;
      if (i === 3) return resp;
    } catch (e) {
      lastErr = e;
      if (i === 3) throw new Error('Không kết nối được dịch vụ ngoài: ' + e.message);
    }
    Utilities.sleep(Math.pow(2, i) * 1000 + Math.floor(Math.random() * 500));
  }
  throw lastErr || new Error('Lỗi kết nối.');
}

/**
 * Chạy thủ công 1 lần trong trình soạn thảo: cấp quyền, tạo thư mục ảnh của năm nay,
 * file dữ liệu của tháng này và file OCR_USERS. Chạy lại bao nhiêu lần cũng an toàn.
 */
function setup() {
  prop_('GEMINI_API_KEY');
  const now = new Date();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const raw = pathFolder_([DIRS.RAW, Utilities.formatDate(now, TZ, 'yyyy')]);
    const data = monthBook_(now);
    const users = usersBook_();
    migrateUsers_(users);
    console.log('Thư mục gốc: ' + pathFolder_([]).getName() +
      '\nThư mục ảnh năm nay: ' + raw.getName() +
      '\nFile dữ liệu tháng này: ' + data.getUrl() +
      '\nFile tài khoản: ' + users.getUrl() +
      '\nModel Gemini: ' + prop_('GEMINI_MODEL', DEFAULTS.GEMINI_MODEL) +
      '\nBước tiếp: đăng nhập admin / khoatv@123 (hệ thống bắt buộc đổi mật khẩu ngay), rồi tạo tài khoản ở tab Tài khoản.');
  } finally {
    lock.releaseLock();
  }
  ensureAdmin_();
  return true;
}
