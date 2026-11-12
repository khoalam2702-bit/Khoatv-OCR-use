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
 *   OCR_USERS                                             file Google Sheets chứa tài khoản đăng nhập
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
  MAX_FILE_BYTES: 14 * 1024 * 1024,   // sau khi giải mã base64
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
    hint: 'Ảnh màn hình LED/LCD 7 đoạn của cân điện tử. Đọc từng chữ số và vị trí dấu thập phân thật cẩn thận; ' +
      'don_vi là kg, g, tấn hoặc lb; trang_thai là Gross, Net, Stable nếu màn hình có hiển thị. ' +
      'Nếu có chữ số bị chói hoặc đứt nét không chắc chắn, mô tả rõ trong ghi_chu_can.',
    fields: [f_('khoi_luong', 'Khối lượng', 'number'), f_('don_vi', 'Đơn vị'), f_('trang_thai', 'Trạng thái'), f_('ghi_chu_can', 'Ghi chú cân', 'long')]
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
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Cấu hình cho giao diện (không chứa bí mật). */
function getAppConfig() {
  const types = Object.keys(DOC_TYPES).map(function (code) {
    const t = DOC_TYPES[code];
    return { code: code, label: t.label, required: t.required, fields: t.fields };
  });
  return { types: types, itemFields: ITEM_FIELDS, maxFileBytes: LIMITS.MAX_FILE_BYTES };
}

/* ============================ ĐĂNG NHẬP ============================ */

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

  const found = verifyUser_(username, password);
  if (!found) {
    cache.put(failKey, String(fails + 1), LIMITS.LOGIN_LOCK_SECONDS);
    throw new Error('Sai tên đăng nhập hoặc mật khẩu.');
  }
  cache.remove(failKey);

  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const user = { u: found.username, name: found.full_name || found.username };
  cache.put('sess_' + token, JSON.stringify(user), LIMITS.SESSION_SECONDS);
  return { token: token, name: user.name };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + String(token));
  return true;
}

/* ---------- Sheet USERS ----------
 * Cột: username | full_name | active | new_password | salt | password_hash
 * Quản trị viên tạo / đổi mật khẩu bằng cách gõ mật khẩu vào cột new_password.
 * Lần đăng nhập kế tiếp (của bất kỳ ai) hệ thống băm mật khẩu và xoá ô đó.
 */
const USER_HEADERS = ['username', 'full_name', 'active', 'new_password', 'salt', 'password_hash'];

function hashPassword_(password, salt) {
  let d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8);
  for (let i = 0; i < LIMITS.HASH_ROUNDS; i++) d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d);
  return Utilities.base64Encode(d);
}

function verifyUser_(username, password) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let rows;
  try {
    const sh = sheet_(usersBook_(), 'USERS', USER_HEADERS);
    const last = sh.getLastRow();
    if (last < 2) return null;
    const rng = sh.getRange(2, 1, last - 1, USER_HEADERS.length);
    rows = rng.getValues();
    // Băm các mật khẩu mới do quản trị viên vừa nhập
    rows.forEach(function (r, i) {
      const pw = String(r[3] || '');
      if (pw.length < LIMITS.MIN_PASSWORD) return;
      const salt = Utilities.getUuid();
      r[3] = ''; r[4] = salt; r[5] = hashPassword_(pw, salt);
      sh.getRange(i + 2, 4, 1, 3).setValues([['', salt, r[5]]]);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]).trim().toLowerCase() !== username) continue;
    if (r[2] === false || String(r[2]).toUpperCase() === 'FALSE') return null;
    if (!r[4] || !r[5]) return null;
    return hashPassword_(password, String(r[4])) === String(r[5])
      ? { username: username, full_name: String(r[1] || '') } : null;
  }
  return null;
}

/** Giao diện gọi khi mở lại trang để kiểm tra phiên còn hạn. */
function checkSession(token) {
  const s = session_(token, true);
  return s ? { name: s.name } : null;
}

function session_(token, soft) {
  const raw = /^[a-f0-9]{64}$/.test(String(token || '')) ? CacheService.getScriptCache().get('sess_' + token) : null;
  if (!raw) {
    if (soft) return null;
    throw new Error('SESSION_EXPIRED');
  }
  return JSON.parse(raw);
}

/* ============================ BƯỚC 1: QUÉT ============================ */

/**
 * Lưu tệp gốc vào Drive rồi gọi Gemini bóc tách. CHƯA ghi Google Sheets:
 * người dùng xem và sửa kết quả trên giao diện, sau đó mới gọi saveRecord.
 * payload = { docType, mimeType, base64 }
 */
function scanDocument(token, payload) {
  const started = Date.now();
  const user = session_(token);
  payload = payload || {};
  const type = DOC_TYPES[payload.docType];
  if (!type) throw new Error('Loại tài liệu không hợp lệ.');
  const ext = MIME_EXT[payload.mimeType];
  if (!ext) throw new Error('Chỉ hỗ trợ ảnh JPG, PNG, WEBP hoặc tệp PDF.');
  const b64 = String(payload.base64 || '');
  if (!b64) throw new Error('Chưa có tệp để quét.');
  if (b64.length * 0.75 > LIMITS.MAX_FILE_BYTES) throw new Error('Tệp quá lớn (tối đa 14 MB). Với PDF dài, hãy tách 5-10 trang mỗi lượt.');
  rateLimit_(user.u);

  let bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (e) { throw new Error('Dữ liệu tệp không hợp lệ.'); }

  const now = new Date();
  const stamp = Utilities.formatDate(now, TZ, 'yyyyMMdd_HHmmss');
  const name = 'RAW_' + payload.docType + '_' + stamp + '_' + Utilities.getUuid().slice(0, 6) + '.' + ext;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let folder;
  try { folder = pathFolder_([DIRS.RAW, Utilities.formatDate(now, TZ, 'yyyy')]); } finally { lock.releaseLock(); }
  const file = folder.createFile(Utilities.newBlob(bytes, payload.mimeType, name));
  file.setDescription('Quét bởi ' + user.u);

  const data = callGemini_(type, payload.mimeType, b64);
  return { data: data, fileId: file.getId(), fileUrl: file.getUrl(), ms: Date.now() - started };
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

function callGemini_(type, mimeType, b64) {
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
      parts: [
        { inlineData: { mimeType: mimeType, data: b64 } },
        { text: 'Loại tài liệu: ' + type.label + '. ' + type.hint + '\nHãy bóc tách dữ liệu theo đúng schema.' }
      ]
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

/* ============================ BƯỚC 2: LƯU ============================ */

/** Ghi bản ghi đã được người dùng kiểm tra vào Google Sheets (ghi đè theo khoá để chống trùng). */
function saveRecord(token, docType, data, fileId) {
  const user = session_(token);
  const type = DOC_TYPES[docType];
  if (!type) throw new Error('Loại tài liệu không hợp lệ.');
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(String(fileId || ''))) throw new Error('Thiếu tệp gốc đối soát. Hãy quét lại.');
  data = data || {};

  const record = {};
  type.fields.forEach(function (f) {
    record[f.k] = clean_(data[f.k], f.type);
  });
  const missing = type.fields.filter(function (f) {
    return type.required.indexOf(f.k) >= 0 && (record[f.k] === null || record[f.k] === '');
  });
  if (missing.length) {
    throw new Error('Thiếu trường bắt buộc: ' + missing.map(function (f) { return f.label; }).join(', '));
  }

  record.scan_timestamp = new Date();
  record.document_type = docType;
  record.raw_file_url = 'https://drive.google.com/file/d/' + fileId + '/view';
  record.raw_file_id = fileId;
  record.scanned_by = user.u;

  const cols = SYS_COLS.concat(type.fields);
  const headers = cols.map(function (c) { return c.k; });
  const formats = cols.map(function (c) {
    return c.type === 'date' ? 'yyyy-mm-dd hh:mm:ss' : (c.type === 'number' ? '#,##0.###' : '@');
  });
  const values = cols.map(function (c) { return cell_(record[c.k], c.type); });
  const keyName = type.uniqueKey || 'raw_file_id';
  const keyVal = String(record[keyName]);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let row = 0, updated = false, book;
  try {
    book = monthBook_(record.scan_timestamp);
    const sh = sheet_(book, docType, headers);
    const last = sh.getLastRow();
    if (last > 1) {
      const keys = sh.getRange(2, headers.indexOf(keyName) + 1, last - 1, 1).getDisplayValues();
      for (let i = 0; i < keys.length; i++) {
        if (keys[i][0] === keyVal) { row = i + 2; updated = true; break; }
      }
    }
    if (!row) {
      row = last + 1;
      if (row > sh.getMaxRows()) sh.insertRowAfter(sh.getMaxRows());
    }
    sh.getRange(row, 1, 1, headers.length).setNumberFormats([formats]).setValues([values]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { book: book.getName(), sheet: docType, row: row, updated: updated };
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
    const cur = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (cur.join('|') !== headers.join('|')) {
      throw new Error('Dòng tiêu đề sheet ' + name + ' đã bị sửa, không khớp cấu trúc. Vui lòng khôi phục.');
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
    console.log('Thư mục gốc: ' + pathFolder_([]).getName() +
      '\nThư mục ảnh năm nay: ' + raw.getName() +
      '\nFile dữ liệu tháng này: ' + data.getUrl() +
      '\nFile tài khoản: ' + users.getUrl() +
      '\nModel Gemini: ' + prop_('GEMINI_MODEL', DEFAULTS.GEMINI_MODEL) +
      '\nBước tiếp: mở file tài khoản, sheet USERS, nhập username và new_password.');
  } finally {
    lock.releaseLock();
  }
  return true;
}
