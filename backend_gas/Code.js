/**
 * OCR đa tài liệu: Google Apps Script + Gemini Vision + Google Sheets + Google Drive
 *
 * Script Properties (Project Settings > Script Properties):
 *   GEMINI_API_KEY    (bắt buộc) Khoá Gemini API chính. ADMIN đổi được ở trang quản trị > Cài đặt AI (không cần vào Script Properties)
 *   GEMINI_API_KEY_BACKUP, GEMINI_API_KEY_BACKUP_2, _3, _4 (tuỳ chọn) Khoá dự phòng 1 → 4: lần lượt dùng khi khoá trước hết hạn mức (429), bị từ chối (403) hoặc lỗi máy chủ (5xx). Khoá vừa lỗi được cho "nghỉ" (tối đa 30 phút) để các lần quét sau dùng thẳng khoá còn lại
 *   GEMINI_TIER       (tuỳ chọn) free | paid: nhãn hiển thị cho ADMIN
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
  { k: 'ma_hang', label: 'Mã hàng', type: 'string' },
  { k: 'ten_hang', label: 'Tên hàng / vật tư', type: 'string' },
  { k: 'don_vi', label: 'ĐVT', type: 'string' },
  { k: 'so_luong', label: 'Số lượng', type: 'number' },
  { k: 'don_gia', label: 'Đơn giá', type: 'number', money: true },
  { k: 'thanh_tien', label: 'Thành tiền', type: 'number', money: true }
];

function f_(k, label, type) { return { k: k, label: label, type: type || 'string' }; }
/** Trường hiển thị NGAY DƯỚI bảng chi tiết trên form (thứ tự cột dữ liệu trong Sheets không đổi). */
function a_(k, label) { return { k: k, label: label, type: 'string', afterItems: true }; }
/** Trường tiền: giao diện hiển thị dạng 1.234.567 (dấu chấm ngăn cách hàng nghìn). */
function m_(k, label) { return { k: k, label: label, type: 'number', money: true }; }

/**
 * Cấu hình 13 loại tài liệu.
 * Tên sheet = mã loại. uniqueKey: khoá nghiệp vụ để ghi đè chống trùng (null = chống trùng theo tệp gốc)
 */
const DOC_TYPES = {
  CCCD: {
    label: 'Căn cước công dân', uniqueKey: 'so_cccd', required: ['so_cccd', 'ho_ten'],
    hint: 'Thẻ căn cước / CCCD Việt Nam. Số định danh cá nhân gồm đúng 12 chữ số. ' +
      'Họ và tên lấy từ dòng "Họ và tên / Full name" ở mặt trước, giữ đủ dấu tiếng Việt, không lấy từ dòng MRZ ở mặt sau. Đọc cả hai mặt nếu có. Mặt trước: số, họ tên, ngày sinh, giới tính, quốc tịch, quê quán, nơi thường trú, nơi sinh (nếu thẻ có in), ' +
      'ngày hết hạn (mục "Có giá trị đến", nếu ghi "Không thời hạn" thì trả đúng chữ đó). ' +
      'Mặt sau: ngày cấp (ngày, tháng, năm cấp thẻ) và nơi cấp (cơ quan cấp, ví dụ Cục Cảnh sát quản lý hành chính về trật tự xã hội). ',
    fields: [f_('so_cccd', 'Số CCCD'), f_('ho_ten', 'Họ và tên'), f_('ngay_sinh', 'Ngày sinh'), f_('gioi_tinh', 'Giới tính'),
      f_('quoc_tich', 'Quốc tịch'), f_('que_quan', 'Quê quán'), f_('noi_thuong_tru', 'Nơi thường trú'),
      f_('ngay_cap', 'Ngày cấp'), f_('ngay_het_han', 'Ngày hết hạn'),
      f_('noi_sinh', 'Nơi sinh'), f_('noi_cap', 'Nơi cấp')]
  },
  HO_CHIEU: {
    label: 'Hộ chiếu', uniqueKey: 'so_ho_chieu', required: ['so_ho_chieu', 'ho_ten'],
    hint: 'Trang thông tin hộ chiếu. Đối chiếu vùng MRZ ở cuối trang để kiểm tra số hộ chiếu và ngày tháng. Nơi cấp (noi_cap) và Nơi cấp thị thực (noi_cap_visa): ghi TÊN NƯỚC cấp bằng tiếng Việt (ví dụ Việt Nam, Mỹ, Nhật Bản, Anh), lấy từ mã quốc gia cấp ở vùng MRZ hoặc từ trang; không ghi tên cơ quan. Các trường thị thực (visa) chỉ điền khi tệp có trang/tem visa; không có thì trả null, không lấy từ trang thông tin hộ chiếu.',
    fields: [f_('so_ho_chieu', 'Số hộ chiếu'), f_('ho_ten', 'Họ và tên'), f_('quoc_tich', 'Quốc tịch'), f_('ngay_sinh', 'Ngày sinh'),
      f_('noi_sinh', 'Nơi sinh'), f_('gioi_tinh', 'Giới tính'), f_('so_dinh_danh', 'Số định danh'), f_('ngay_cap', 'Ngày cấp'),
      f_('ngay_het_han', 'Ngày hết hạn'), f_('co_quan_cap', 'Cơ quan cấp'), f_('noi_cap', 'Nơi cấp (nước cấp)'),
      f_('so_visa', 'Số thị thực (Visa)'), f_('ngay_cap_visa', 'Ngày cấp thị thực'), f_('noi_cap_visa', 'Nơi cấp thị thực'), f_('ngay_het_han_visa', 'Ngày hết hạn thị thực')]
  },
  GPLX: {
    label: 'Giấy phép lái xe', uniqueKey: 'so_gplx', required: ['so_gplx', 'ho_ten', 'hang_gplx'],
    hint: 'Giấy phép lái xe Việt Nam. Nếu có nhiều hạng, ghi các hạng cách nhau bằng dấu phẩy.',
    fields: [f_('so_gplx', 'Số GPLX'), f_('ho_ten', 'Họ và tên'), f_('ngay_sinh', 'Ngày sinh'), f_('quoc_tich', 'Quốc tịch'),
      f_('noi_cu_tru', 'Nơi cư trú'), f_('hang_gplx', 'Hạng'), f_('thoi_han_den', 'Có giá trị đến'), f_('ngay_trung_tuyen', 'Ngày trúng tuyển')]
  },
  KHAI_SINH: {
    label: 'Giấy khai sinh', uniqueKey: null, required: ['ho_ten_khai_sinh', 'ngay_sinh'],
    hint: 'Giấy khai sinh Việt Nam, có thể có chữ viết tay. so_dinh_danh là Số định danh cá nhân (12 chữ số) của người được khai sinh, chỉ lấy khi giấy có in; không có thì để trống.',
    fields: [f_('so_khai_sinh', 'Số khai sinh'), f_('so_dinh_danh', 'Số định danh cá nhân'), f_('ho_ten_khai_sinh', 'Họ tên người được khai sinh'), f_('gioi_tinh', 'Giới tính'),
      f_('ngay_sinh', 'Ngày sinh'), f_('noi_sinh', 'Nơi sinh'), f_('dan_toc', 'Dân tộc'), f_('quoc_tich', 'Quốc tịch'),
      f_('ho_ten_cha', 'Họ tên cha'), f_('ho_ten_me', 'Họ tên mẹ')]
  },
  CV_UNGVIEN: {
    label: 'CV ứng viên', uniqueKey: null, required: ['ho_ten'],
    hint: 'Hồ sơ ứng viên (CV). Tóm tắt học vấn, kỹ năng và kinh nghiệm gần nhất ngắn gọn, đúng theo nội dung CV. ' +
      'Chỉ ghi thông tin cá nhân (ngày sinh, giới tính, địa chỉ) khi CV có ghi rõ. ' +
      'Học vấn: cap_dao_tao là trình độ cao nhất (ví dụ Đại học, Cao đẳng), truong_dao_tao là tên trường, chuyen_nganh là ngành học, xep_loai là xếp loại tốt nghiệp nếu có.',
    fields: [f_('ho_ten', 'Họ và tên'), f_('email', 'Email'), f_('so_dien_thoai', 'Số điện thoại'), f_('vi_tri_ung_tuyen', 'Vị trí ứng tuyển'),
      f_('hoc_van', 'Học vấn', 'long'), f_('ky_nang', 'Kỹ năng', 'long'), f_('so_nam_kinh_nghiem', 'Số năm kinh nghiệm', 'number'),
      f_('kinh_nghiem_gan_nhat', 'Kinh nghiệm gần nhất', 'long'),
      f_('ngay_sinh', 'Ngày sinh'), f_('gioi_tinh', 'Giới tính'), f_('dia_chi', 'Địa chỉ'),
      f_('cap_dao_tao', 'Trình độ'), f_('truong_dao_tao', 'Trường đào tạo'), f_('chuyen_nganh', 'Chuyên ngành'), f_('xep_loai', 'Xếp loại')]
  },
  CV_NHANVIEN: {
    label: 'CV nhân viên', uniqueKey: null, required: ['ho_ten'],
    hint: 'Hồ sơ (CV) của nhân viên, để điền vào form Thông tin nhân viên. Chỉ lấy đúng nội dung CV, không suy đoán; mục CV không ghi thì để trống (null). ' +
      'quoc_tich chỉ ghi khi CV có nêu. dia_chi là địa chỉ ghi trên CV (giữ nguyên cả quận/huyện, tỉnh). ' +
      'Học vấn (tab Trình độ học vấn): lấy bậc học cao nhất hoặc gần nhất; cap_dao_tao là trình độ (Đại học, Cao đẳng...), truong_dao_tao là tên trường, chuyen_nganh là ngành học, xep_loai là xếp loại tốt nghiệp nếu có, tu_nam và den_nam là năm bắt đầu và năm kết thúc (4 chữ số). ' +
      'ngoai_ngu là TÊN ngoại ngữ chính của người này (ví dụ "Tiếng Anh"), ngoai_ngu_diem là bằng/điểm/trình độ của ngoại ngữ đó (ví dụ "IELTS 6.5"), ngoai_ngu_khac là các ngoại ngữ còn lại kèm trình độ. Không thấy CV nêu ngoại ngữ thì để trống cả ba. ' +
      'Các mục sau viết thành văn bản gọn, mỗi ý một dòng, đúng nội dung CV: ky_nang (kỹ năng), so_thich (sở thích), chung_chi (chứng chỉ, kèm năm), ' +
      'kinh_nghiem (kinh nghiệm làm việc: mỗi vị trí một đoạn gồm thời gian, chức danh, công ty và 1-3 ý chính, mới nhất trước). ' +
      'ẢNH CHÂN DUNG: nếu CV có ảnh chân dung của người này, trả vị trí ảnh: anh_tep là số thứ tự tệp chứa ảnh (tệp đầu tiên là 1), anh_trang là số trang trong tệp (trang đầu là 1; tệp ảnh thì 1), ' +
      'anh_ymin, anh_xmin, anh_ymax, anh_xmax là khung chữ nhật ôm sát khuôn mặt và vai, chuẩn hóa 0-1000 theo chiều cao (y) và chiều rộng (x) của trang. Không có ảnh chân dung thì để trống cả sáu trường. ' +
      'cong_viec: danh sách TỪNG công việc trong mục kinh nghiệm làm việc, theo thứ tự trên CV, mỗi công việc một phần tử gồm cong_ty (tên công ty/đơn vị), chuc_danh, tu (thời điểm bắt đầu) và den (thời điểm kết thúc) CHÉP ĐÚNG như CV ghi (ví dụ "06/2023", "2019", "Nay"; không tự thêm tháng hoặc ngày), mo_ta (1-3 ý chính, ngắn). Không có mục kinh nghiệm thì trả danh sách rỗng.',
    fields: [f_('ho_ten', 'Họ và tên'), f_('gioi_tinh', 'Giới tính'), f_('ngay_sinh', 'Ngày sinh'), f_('quoc_tich', 'Quốc tịch'), f_('dia_chi', 'Địa chỉ'),
      f_('cap_dao_tao', 'Trình độ'), f_('truong_dao_tao', 'Trường đào tạo'), f_('chuyen_nganh', 'Chuyên ngành'), f_('xep_loai', 'Xếp loại'),
      f_('tu_nam', 'Học từ năm'), f_('den_nam', 'Học đến năm'), f_('ngoai_ngu', 'Ngoại ngữ'), f_('ngoai_ngu_diem', 'Bằng/điểm ngoại ngữ'), f_('ngoai_ngu_khac', 'Ngoại ngữ khác', 'long'),
      f_('ky_nang', 'Kỹ năng', 'long'), f_('so_thich', 'Sở thích', 'long'), f_('chung_chi', 'Chứng chỉ', 'long'), f_('kinh_nghiem', 'Kinh nghiệm làm việc', 'long')],
    aux: [f_('anh_tep', 'Số thứ tự tệp chứa ảnh chân dung', 'number'), f_('anh_trang', 'Trang chứa ảnh chân dung', 'number'), f_('anh_ymin', 'Khung ảnh: y trên (0-1000)', 'number'), f_('anh_xmin', 'Khung ảnh: x trái (0-1000)', 'number'),
      f_('anh_ymax', 'Khung ảnh: y dưới (0-1000)', 'number'), f_('anh_xmax', 'Khung ảnh: x phải (0-1000)', 'number'),
      f_('cong_viec', 'Danh sách công việc đã làm', 'jobs')]
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
    hint: 'Đơn hàng bán. Liệt kê đủ từng dòng hàng; ma_hang là mã hàng của dòng đó (null nếu không ghi). thanh_toan là số tiền khách phải trả cuối cùng.',
    fields: [f_('ma_don_hang', 'Mã đơn hàng'), f_('ngay_tao', 'Ngày đặt'), f_('ten_khach_hang', 'Khách hàng'), f_('so_dien_thoai', 'Số điện thoại'),
      f_('dia_chi_giao', 'Địa chỉ giao'), f_('danh_sach_hang_hoa', 'Danh sách hàng hoá', 'items'), m_('tong_tien_hang', 'Tổng tiền hàng'),
      m_('giam_gia', 'Giảm giá'), m_('thanh_toan', 'Thanh toán')]
  },
  GIAO_HANG: {
    label: 'Phiếu giao hàng', uniqueKey: 'ma_van_don', required: ['ma_van_don', 'nguoi_nhan'],
    hint: 'Phiếu giao hàng / vận đơn của hãng vận chuyển.',
    fields: [f_('ma_van_don', 'Mã vận đơn'), f_('don_vi_van_chuyen', 'Đơn vị vận chuyển'), f_('nguoi_gui', 'Người gửi'), f_('nguoi_nhan', 'Người nhận'),
      f_('sdt_nhan', 'SĐT người nhận'), f_('dia_chi_nhan', 'Địa chỉ nhận'), m_('tien_cod', 'Tiền thu hộ COD'),
      m_('cuoc_phi', 'Cước phí'), f_('ghi_chu_hang_hoa', 'Ghi chú hàng hoá', 'long')]
  },
  NHAP_KHO: {
    label: 'Phiếu nhập kho', uniqueKey: 'so_phieu_nhap', required: ['so_phieu_nhap'],
    hint: 'Phiếu nhập kho. Liệt kê đủ từng dòng vật tư; ma_hang là mã vật tư / mã hàng của dòng đó (để null nếu phiếu không ghi). kho_nhap là mã hoặc tên kho nhập.',
    fields: [f_('so_phieu_nhap', 'Số phiếu nhập'), f_('ngay_nhap', 'Ngày nhập'), f_('nha_cung_cap', 'Nhà cung cấp'), a_('kho_nhap', 'Kho nhập'),
      f_('nguoi_giao', 'Người giao'), f_('nguoi_nhan', 'Người nhận'), f_('chi_tiet_vat_tu', 'Chi tiết vật tư', 'items'),
      m_('tong_gia_tri', 'Tổng giá trị')]
  },
  XUAT_KHO: {
    label: 'Phiếu xuất kho', uniqueKey: 'so_phieu_xuat', required: ['so_phieu_xuat'],
    hint: 'Phiếu xuất kho. Liệt kê đủ từng dòng vật tư xuất; ma_hang là mã vật tư / mã hàng của dòng đó (để null nếu phiếu không ghi). kho_xuat là mã hoặc tên kho xuất.',
    fields: [f_('so_phieu_xuat', 'Số phiếu xuất'), f_('ngay_xuat', 'Ngày xuất'), f_('nguoi_nhan', 'Người nhận'), f_('bo_phan_nhan', 'Bộ phận / công trình nhận'),
      a_('kho_xuat', 'Kho xuất'), f_('ly_do_xuat', 'Lý do xuất'), f_('chi_tiet_hang_xuat', 'Chi tiết hàng xuất', 'items'), f_('ghi_chu', 'Ghi chú', 'long')]
  },
  CAN_DIEN_TU: {
    label: 'Màn hình cân điện tử', uniqueKey: null, required: ['khoi_luong', 'don_vi'],
    hint: 'Ảnh cân điện tử (cân siêu thị, cân tính tiền in tem, cân bàn), có thể là ảnh chụp cả máy kèm nền cửa hàng. ' +
      'CHỈ đọc các ô số trên màn hình LED/LCD của cân; bỏ qua logo, biển hiệu, tem nhãn, bàn phím và nền. ' +
      'Tự nhận diện bố cục (người dùng không chọn loại cân). Thường có 4 ô theo thứ tự: Trừ bì (Tare) · Khối lượng (Weight / Net / Trọng lượng) · Đơn giá (Unit price / Price / Change) · Thành tiền (Total / Total price). ' +
      'Nhãn có thể bằng tiếng Việt hoặc tiếng Anh, bị mờ hoặc lệch so với số: khi đó dựa vào VỊ TRÍ ô và ký hiệu đơn vị (số đi kèm "kg" là khối lượng). ' +
      'Không nhầm ô Trừ bì (Tare) với khối lượng; không lấy dòng ngày giờ hay số lượng (pcs) làm khối lượng. ' +
      'khoi_luong là số kg cân được (số thập phân; đọc thật cẩn thận từng chữ số và vị trí dấu chấm thập phân); don_vi là kg, g, tấn hoặc lb. ' +
      'don_gia là đơn giá và so_tien là thành tiền, đúng như màn hình hiển thị; nếu cân không có ô giá hoặc thành tiền thì trả null, không tự tính. ' +
      'Ba trường man_hinh_khoi_luong, man_hinh_don_gia, man_hinh_thanh_tien: chép NGUYÊN VĂN chuỗi ký tự đang hiện trong ô tương ứng, giữ cả dấu chấm/phẩy và số 0 (ví dụ "0.58", "260.000", "150.800"); null nếu ô đó không có. ' +
      'Kiểm tra chéo: khối lượng × đơn giá phải xấp xỉ thành tiền; nếu lệch thì đọc lại từng chữ số. ' +
      'trang_thai là Gross, Net, Stable nếu màn hình có hiển thị. Chữ số bị chói hoặc đứt nét không chắc chắn thì mô tả rõ trong ghi_chu_can.',
    fields: [f_('khoi_luong', 'Khối lượng (số kg)', 'number'), f_('don_vi', 'Đơn vị'), m_('don_gia', 'Đơn giá'), m_('so_tien', 'Thành tiền'),
      f_('trang_thai', 'Trạng thái'), f_('ghi_chu_can', 'Ghi chú cân', 'long')],
    // Trường phụ chỉ dùng để đối chiếu dấu chấm/phẩy: gửi cho AI nhưng không lưu và không hiện trên form.
    aux: [f_('man_hinh_khoi_luong', 'Chuỗi hiển thị ở ô khối lượng'), f_('man_hinh_don_gia', 'Chuỗi hiển thị ở ô đơn giá'), f_('man_hinh_thanh_tien', 'Chuỗi hiển thị ở ô thành tiền')]
  },
  BIEN_SO_XE: {
    label: 'Biển số xe', uniqueKey: null, required: ['bien_so_day_du'],
    hint: 'Biển số xe Việt Nam, chữ và số dập nổi. Nhận diện MÀU NỀN biển: nền trắng (cá nhân, tổ chức, chữ đen), nền vàng (kinh doanh vận tải, chữ đen), ' +
      'nền xanh dương (cơ quan nhà nước, chữ trắng), nền đỏ (quân đội, chữ trắng). Bỏ qua con dấu / quân hiệu chìm, họa tiết gợn sóng, viền, khung biển và nền ảnh. ' +
      'Có 2 kiểu: biển DÀI 1 dòng (ví dụ 51F-970.22) và biển VUÔNG 2 dòng (dòng trên 99-E1, dòng dưới 222.68). ' +
      'bien_so_day_du: ghép đủ các dòng thành một chuỗi, biển 1 dòng dạng "51F-970.22", biển 2 dòng dạng "99-E1 222.68". Giữ nguyên dấu gạch ngang và dấu chấm. ' +
      'Biển trắng / vàng / xanh: mã tỉnh (2 ký tự đầu) và dãy số cuối là CHỮ SỐ (không nhầm O với 0, I với 1, B với 8); ký tự sau mã tỉnh là chữ cái seri ' +
      '(có thể 2 chữ như LD, NG, NN, DA, KT, MĐ; xe máy có thêm một chữ số sau chữ, ví dụ E1, B1); dãy số cuối có 4 số hoặc 5 số (dạng 970.22). ' +
      'Biển đỏ quân đội: KHÔNG có mã tỉnh, gồm 2 chữ cái rồi 4 hoặc 5 chữ số (ví dụ "QH 12-34"), chép đúng như in trên biển. ' +
      'loai_phuong_tien: "Ô tô" hoặc "Xe máy". mau_bien: một trong "Trắng", "Vàng", "Xanh", "Đỏ".',
    fields: [f_('bien_so_day_du', 'Biển số đầy đủ'), f_('ma_tinh_thanh', 'Mã tỉnh/thành'), f_('ten_tinh_thanh', 'Tên tỉnh/thành'), f_('seri_dang_ky', 'Seri đăng ký'),
      f_('loai_phuong_tien', 'Loại phương tiện'), f_('mau_bien', 'Màu biển'), f_('doi_tuong_su_dung', 'Đối tượng sử dụng')],
    // Mã tỉnh, seri, tên tỉnh, đối tượng sử dụng do hệ thống tự tách / tra từ biển số và màu biển: không bắt AI sinh ra (ít chữ cần sinh hơn → nhanh hơn).
    aiSkip: ['ma_tinh_thanh', 'ten_tinh_thanh', 'seri_dang_ky', 'doi_tuong_su_dung'],
    // Chữ trên biển rất to: độ phân giải ảnh vừa là đủ, nhanh hơn mức cao; đầu ra ngắn.
    ai: { resolution: 'MEDIA_RESOLUTION_MEDIUM', maxTokens: 256 }
  }
};

/** Mã biển số xe (2 chữ số đầu) → tên tỉnh/thành theo mã biển kiểm soát. Hệ thống tự tra, không để AI đoán. */
const PLATE_PROVINCES = (function () {
  const m = {};
  function s(name, codes) { codes.forEach(function (c) { m[String(c)] = name; }); }
  s('Cao Bằng', [11]); s('Lạng Sơn', [12]); s('Quảng Ninh', [14]); s('Hải Phòng', [15, 16]); s('Thái Bình', [17]);
  s('Nam Định', [18]); s('Phú Thọ', [19]); s('Thái Nguyên', [20]); s('Yên Bái', [21]); s('Tuyên Quang', [22]);
  s('Hà Giang', [23]); s('Lào Cai', [24]); s('Lai Châu', [25]); s('Sơn La', [26]); s('Điện Biên', [27]);
  s('Hòa Bình', [28]); s('Hà Nội', [29, 30, 31, 32, 33, 40]); s('Hải Dương', [34]); s('Ninh Bình', [35]);
  s('Thanh Hóa', [36]); s('Nghệ An', [37]); s('Hà Tĩnh', [38]); s('Đồng Nai', [39, 60]); s('Đà Nẵng', [43]);
  s('Đắk Lắk', [47]); s('Đắk Nông', [48]); s('Lâm Đồng', [49]); s('TP. Hồ Chí Minh', [41, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
  s('Bình Dương', [61]); s('Long An', [62]); s('Tiền Giang', [63]); s('Vĩnh Long', [64]); s('Cần Thơ', [65]);
  s('Đồng Tháp', [66]); s('An Giang', [67]); s('Kiên Giang', [68]); s('Cà Mau', [69]); s('Tây Ninh', [70]);
  s('Bến Tre', [71]); s('Bà Rịa - Vũng Tàu', [72]); s('Quảng Bình', [73]); s('Quảng Trị', [74]); s('Thừa Thiên Huế', [75]);
  s('Quảng Ngãi', [76]); s('Bình Định', [77]); s('Phú Yên', [78]); s('Khánh Hòa', [79]); s('Gia Lai', [81]);
  s('Kon Tum', [82]); s('Sóc Trăng', [83]); s('Trà Vinh', [84]); s('Ninh Thuận', [85]); s('Bình Thuận', [86]);
  s('Vĩnh Phúc', [88]); s('Hưng Yên', [89]); s('Hà Nam', [90]); s('Quảng Nam', [92]); s('Bình Phước', [93]);
  s('Bạc Liêu', [94]); s('Hậu Giang', [95]); s('Bắc Kạn', [97]); s('Bắc Giang', [98]); s('Bắc Ninh', [99]);
  return m;
})();

/** Tên tỉnh từ mã biển ("43", "43A") hoặc từ biển số đầy đủ ("43A-123.45"). Trả '' nếu không tra được. */
function plateProvince_(code, plate) {
  let m = /^\s*(\d{2})/.exec(String(code == null ? '' : code));
  if (!m) m = /^\s*(\d{2})/.exec(String(plate == null ? '' : plate));
  return m && PLATE_PROVINCES[m[1]] ? PLATE_PROVINCES[m[1]] : '';
}

/* ============================ WEB APP ============================ */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('OCR Tài liệu')
    // Cho phép nhúng trong khung của trang Vercel (khoatv-ocr-use.vercel.app) để giữ nguyên địa chỉ
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ============================ CỔNG API (doPost) ============================
 * Dùng cho Extension và Web Admin Next.js. Mọi thao tác ghi vẫn nằm trong các hàm bên dưới, nên luật chống trùng,
 * khoá, phân quyền và nhật ký chỉ có MỘT nơi duy nhất.
 *
 * Gửi: POST, Content-Type: text/plain (để trình duyệt không gửi preflight CORS), thân là JSON:
 *   { "action": "listRecords", "args": ["<token>", "CCCD", "2026-11-01", "2026-11-21"], "client": "EXTENSION" }
 * Nhận: { "ok": true, "data": ... }  hoặc  { "ok": false, "error": "thông báo" }
 * Phiên đăng nhập dùng lại đúng token của login() (6 giờ, phân quyền kiểm tra lại mỗi lần gọi).
 * Chỉ các hàm có tên trong API_ACTIONS mới gọi được; hàm nội bộ (kết thúc bằng "_") không bao giờ gọi được.
 */
const API_ACTIONS = {
  // không cần token
  getAppConfig: { fn: function () { return getAppConfig(); } },
  login: { fn: function (a) { return login(a[0], a[1]); } },
  requestPasswordReset: { fn: function (a) { return requestPasswordReset(a[0]); } },
  resetPasswordWithCode: { fn: function (a) { return resetPasswordWithCode(a[0], a[1], a[2]); } },
  // phiên đăng nhập
  logout: { fn: function (a) { return logout(a[0]); } },
  checkSession: { fn: function (a) { return checkSession(a[0]); } },
  getMe: { fn: function (a) { return getMe(a[0]); } },
  changeMyPassword: { fn: function (a) { return changeMyPassword(a[0], a[1], a[2]); } },
  // bản ghi OCR
  scanDocument: { fn: function (a) { return scanDocument(a[0], a[1]); } },
  // quét không cần tài khoản (Extension): không token, có hạn mức theo ngày / thiết bị
  scanAnonymous: { fn: function (a) { return scanAnonymous(a[0], a[1]); } },
  saveRecord: { fn: function (a, client) { return saveRecord(a[0], a[1], a[2], a[3], { source: client }); } },
  listRecords: { fn: function (a) { return listRecords(a[0], a[1], a[2], a[3]); } },
  getRawFile: { fn: function (a) { return getRawFile(a[0], a[1], a[2], a[3]); } },
  updateRecord: { fn: function (a) { return updateRecord(a[0], a[1], a[2], a[3], a[4]); } },
  deleteRecord: { fn: function (a) { return deleteRecord(a[0], a[1], a[2], a[3]); } },
  updateSyncStatus: { fn: function (a) { return updateSyncStatus(a[0], a[1], a[2], a[3], a[4]); } },
  logExport: { fn: function (a) { return logExport(a[0], a[1], a[2], a[3], a[4]); } },
  // quản lý tài khoản (chỉ ADMIN, kiểm tra trong từng hàm)
  listUsers: { fn: function (a) { return listUsers(a[0]); } },
  createUser: { fn: function (a) { return createUser(a[0], a[1]); } },
  updateUser: { fn: function (a) { return updateUser(a[0], a[1], a[2]); } },
  resetUserPassword: { fn: function (a) { return resetUserPassword(a[0], a[1]); } },
  deleteUser: { fn: function (a) { return deleteUser(a[0], a[1]); } },
  // cấu hình AI (chỉ ADMIN)
  getAiConfig: { fn: function (a) { return getAiConfig(a[0]); } },
  setAiConfig: { fn: function (a) { return setAiConfig(a[0], a[1]); } },
  testAiConfig: { fn: function (a) { return testAiConfig(a[0]); } },
  // hạn mức quét không cần tài khoản (chỉ ADMIN)
  getAnonConfig: { fn: function (a) { return getAnonConfig(a[0]); } },
  setAnonConfig: { fn: function (a) { return setAnonConfig(a[0], a[1]); } }
};

/** Extension không bắt đổi mật khẩu mặc định: chỉ các thao tác OCR dưới đây được bỏ qua must_change khi client = EXTENSION.
 *  Quản lý tài khoản và đổi mật khẩu vẫn giữ nguyên quy tắc. Cờ chỉ sống trong một lần thực thi doPost. */
const EXT_NO_FORCE_ACTIONS = ['scanDocument', 'saveRecord', 'listRecords', 'getRawFile', 'updateRecord', 'deleteRecord', 'updateSyncStatus', 'logExport'];
let skipMustChange_ = false;

function apiJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (!raw) return apiJson_({ ok: false, error: 'Thiếu nội dung yêu cầu.' });
    let body;
    try { body = JSON.parse(raw); } catch (err) { return apiJson_({ ok: false, error: 'Nội dung yêu cầu không phải JSON.' }); }
    const action = String((body && body.action) || '');
    const def = Object.prototype.hasOwnProperty.call(API_ACTIONS, action) ? API_ACTIONS[action] : null;
    if (!def) return apiJson_({ ok: false, error: 'Hành động không hợp lệ.' });
    const args = Array.isArray(body.args) ? body.args : [];
    const client = SOURCES.indexOf(body.client) >= 0 ? body.client : 'WEB_APP';
    skipMustChange_ = client === 'EXTENSION' && EXT_NO_FORCE_ACTIONS.indexOf(action) >= 0;
    const result = def.fn(args, client);
    return apiJson_({ ok: true, data: result === undefined ? null : result });
  } catch (err) {
    // Lỗi nghiệp vụ (throw new Error) trả về nguyên thông báo; SESSION_EXPIRED / MUST_CHANGE_PASSWORD là mã để client xử lý
    return apiJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** Cấu hình cho giao diện (không chứa bí mật). */
function getAppConfig() {
  const types = Object.keys(DOC_TYPES).map(function (code) {
    const t = DOC_TYPES[code];
    return { code: code, label: t.label, required: t.required, fields: t.fields };
  });
  return { types: types, itemFields: ITEM_FIELDS, maxFileBytes: LIMITS.MAX_FILE_BYTES, maxTotalBytes: LIMITS.MAX_TOTAL_BYTES, maxFiles: LIMITS.MAX_FILES, scanPer10Min: LIMITS.SCAN_PER_10_MIN, sessionHours: Math.round(LIMITS.SESSION_SECONDS / 3600), anonPerDay: anonSettings_().perDevice, plateProvinces: PLATE_PROVINCES };
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
  'must_change', 'salt', 'password_hash', 'token_ver', 'email'
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
  u.email = String(u.email || '').trim().toLowerCase();
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
  if (u.must_change && !opt.allowMustChange && !skipMustChange_) throw new Error('MUST_CHANGE_PASSWORD');
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
  return { username: u.username, full_name: u.full_name, email: u.email || '', role: u.role, active: u.active, must_change: u.must_change, perms: perms };
}

/** Email khai báo cho tài khoản (dùng để gửi mã đặt lại mật khẩu). Để trống = không dùng được chức năng quên mật khẩu. */
function normEmail_(v) {
  const e = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  if (!e) return '';
  if (e.length > 100 || !/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)) throw new Error('Email không hợp lệ.');
  return e;
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
  const email = normEmail_(d.email);
  withLock_(function () {
    const ctx = readUsers_();
    if (ctx.list.some(function (x) { return x.username === username; })) throw new Error('Tên đăng nhập "' + username + '" đã tồn tại.');
    const u = { username: username, full_name: String(d.full_name || '').trim().slice(0, 100), email: email, role: role, active: true, must_change: true, token_ver: 1 };
    PERM_KEYS.forEach(function (k) { u[k] = role === 'ADMIN' ? true : perms[k]; });
    newPasswordFields_(u, password);
    appendUser_(ctx.sh, u);
  });
  audit_(admin.username, 'TAO_USER', username, 'role=' + role + '; ' + permText_(perms) + (email ? '; co_email' : ''));
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
    if (patch.email !== undefined) { u.email = normEmail_(patch.email); changed.push(u.email ? 'cap_nhat_email' : 'xoa_email'); }
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

/** Mật khẩu tạm ngẫu nhiên 10 ký tự (bỏ các ký tự dễ nhầm 0/O, 1/l/I). */
function tempPassword_() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + Date.now(), Utilities.Charset.UTF_8);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet.charAt(((d[i] % 256) + 256) % 256 % alphabet.length);
  return out;
}

/** ADMIN cấp lại mật khẩu cho tài khoản khác: sinh mật khẩu tạm, bắt đổi ở lần đăng nhập kế tiếp, đăng xuất mọi phiên cũ. */
function resetUserPassword(token, username) {
  const admin = requireAdmin_(token);
  username = String(username || '').trim().toLowerCase();
  if (username === admin.username) throw new Error('Hãy dùng chức năng "Mật khẩu" để đổi mật khẩu của chính bạn.');
  const pw = tempPassword_();
  withLock_(function () {
    const ctx = readUsers_();
    const u = ctx.list.filter(function (x) { return x.username === username; })[0];
    if (!u) throw new Error('Không tìm thấy tài khoản.');
    newPasswordFields_(u, pw);
    u.must_change = true;
    u.token_ver = (Number(u.token_ver) || 0) + 1;
    writeUser_(ctx.sh, u._row, u);
  });
  audit_(admin.username, 'CAP_LAI_MAT_KHAU', username, 'Cấp mật khẩu tạm, bắt buộc đổi khi đăng nhập');
  return { username: username, password: pw };
}

/* ---------- Quên mật khẩu: gửi mã xác nhận 6 số về email đã khai báo trong tài khoản ----------
 * Phản hồi luôn giống nhau dù tài khoản có tồn tại / có email hay không (không lộ danh sách tài khoản).
 * Mã có hiệu lực 15 phút, sai quá 5 lần là huỷ mã; mỗi tài khoản xin tối đa 3 mã mỗi giờ. Thư gửi từ tài khoản Google chủ dự án (MailApp).
 */
const RESET = { CODE_SECONDS: 900, MAX_TRIES: 5, MAX_REQ_PER_HOUR: 3 };

function maskEmail_(e) {
  const m = /^(.)(.*)@(.*)$/.exec(e);
  return m ? m[1] + '***@' + m[3] : '';
}

function requestPasswordReset(username) {
  username = String(username || '').trim().toLowerCase();
  const generic = { sent: true, message: 'Nếu tài khoản có khai báo email, mã xác nhận đã được gửi. Kiểm tra cả thư mục Spam. Mã có hiệu lực 15 phút.' };
  if (!username || username.length > 64) throw new Error('Vui lòng nhập tên đăng nhập.');
  const cache = CacheService.getScriptCache();
  const reqKey = 'rstq_' + hash_(username) + '_' + Math.floor(Date.now() / 3600000);
  const n = Number(cache.get(reqKey) || 0);
  if (n >= RESET.MAX_REQ_PER_HOUR) throw new Error('Đã xin mã quá nhiều lần. Vui lòng thử lại sau 1 giờ hoặc liên hệ quản trị viên.');
  cache.put(reqKey, String(n + 1), 3600);

  ensureAdmin_();
  const u = findUser_(username);
  if (!u || !u.active || !u.email) {
    audit_('system', 'QUEN_MK_KHONG_GUI', username, !u ? 'khong_ton_tai' : (!u.active ? 'bi_khoa' : 'chua_co_email'));
    return generic;
  }
  if (MailApp.getRemainingDailyQuota() < 1) {
    audit_('system', 'QUEN_MK_HET_HAN_NGACH', username, '');
    throw new Error('Hệ thống đã hết hạn mức gửi email trong ngày. Vui lòng liên hệ quản trị viên.');
  }
  const code = randomCode_();
  const salt = Utilities.getUuid();
  cache.put('rst_' + hash_(username), JSON.stringify({ s: salt, h: hashPassword_(code, salt), t: 0 }), RESET.CODE_SECONDS);
  MailApp.sendEmail({
    to: u.email,
    subject: 'Mã đặt lại mật khẩu OCR: ' + code,
    body: 'Xin chào ' + (u.full_name || u.username) + ',\n\n' +
      'Mã xác nhận đặt lại mật khẩu cho tài khoản "' + u.username + '" là: ' + code + '\n' +
      'Mã có hiệu lực trong 15 phút và chỉ dùng được cho tài khoản này.\n\n' +
      'Nếu bạn không yêu cầu, hãy bỏ qua thư này; mật khẩu hiện tại không bị thay đổi.',
    name: 'OCR tài liệu'
  });
  audit_('system', 'QUEN_MK_GUI_MA', username, 'Gui ma toi ' + maskEmail_(u.email));
  return generic;
}

function randomCode_() {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + Date.now(), Utilities.Charset.UTF_8);
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + (((d[i] % 256) + 256) % 256);
  return ('000000' + (n % 1000000)).slice(-6);
}

function resetPasswordWithCode(username, code, newPassword) {
  username = String(username || '').trim().toLowerCase();
  code = String(code || '').replace(/\s+/g, '');
  newPassword = String(newPassword || '');
  const bad = new Error('Mã không đúng hoặc đã hết hạn. Hãy xin mã mới.');
  if (!username || !/^\d{6}$/.test(code)) throw bad;
  checkPasswordRule_(newPassword);
  if (newPassword === DEFAULT_ADMIN.password) throw new Error('Mật khẩu mới không được dùng mật khẩu mặc định.');
  const cache = CacheService.getScriptCache();
  const key = 'rst_' + hash_(username);
  let rec = null;
  try { rec = JSON.parse(cache.get(key) || 'null'); } catch (e) { rec = null; }
  if (!rec) throw bad;
  if (hashPassword_(code, rec.s) !== rec.h) {
    rec.t = (rec.t || 0) + 1;
    if (rec.t >= RESET.MAX_TRIES) cache.remove(key); else cache.put(key, JSON.stringify(rec), RESET.CODE_SECONDS);
    throw bad;
  }
  let done = false;
  withLock_(function () {
    const ctx = readUsers_();
    const u = ctx.list.filter(function (x) { return x.username === username; })[0];
    if (!u || !u.active) return;
    newPasswordFields_(u, newPassword);
    u.must_change = false;
    u.token_ver = (Number(u.token_ver) || 0) + 1; // đăng xuất mọi phiên cũ
    writeUser_(ctx.sh, u._row, u);
    done = true;
  });
  cache.remove(key);
  cache.remove('fail_' + hash_(username)); // gỡ khoá đăng nhập do nhập sai trước đó
  if (!done) throw bad;
  audit_(username, 'DAT_LAI_MK_QUA_EMAIL', username, '');
  return true;
}

/**
 * KHÔI PHỤC khi quản trị viên quên mật khẩu (không còn ADMIN nào đăng nhập được). Chỉ chủ dự án Apps Script làm được:
 *   1. Project Settings > Script properties > thêm ALLOW_ADMIN_RESET = tên đăng nhập ADMIN cần cấp lại (ví dụ admin).
 *   2. Mở trình soạn thảo, chọn hàm resetAdminPassword rồi Run.
 *   3. Xem mật khẩu tạm trong Execution log. Thuộc tính tự bị xoá sau khi chạy; đăng nhập xong sẽ bị bắt đổi mật khẩu.
 * Không đặt thuộc tính thì hàm không làm gì, kể cả khi bị gọi từ trang web.
 */
function resetAdminPassword() {
  const props = PropertiesService.getScriptProperties();
  const name = String(props.getProperty('ALLOW_ADMIN_RESET') || '').trim().toLowerCase();
  if (!name) throw new Error('Chưa bật khôi phục: thêm Script property ALLOW_ADMIN_RESET = tên đăng nhập ADMIN rồi chạy lại.');
  props.deleteProperty('ALLOW_ADMIN_RESET');
  const pw = tempPassword_();
  withLock_(function () {
    const ctx = readUsers_();
    const u = ctx.list.filter(function (x) { return x.username === name; })[0];
    if (!u || u.role !== 'ADMIN') throw new Error('"' + name + '" không phải tài khoản ADMIN.');
    newPasswordFields_(u, pw);
    u.active = true; u.must_change = true;
    u.token_ver = (Number(u.token_ver) || 0) + 1;
    writeUser_(ctx.sh, u._row, u);
  });
  audit_('system', 'KHOI_PHUC_ADMIN', name, 'Cấp mật khẩu tạm qua trình soạn thảo Apps Script');
  Logger.log('Tài khoản: ' + name + ' | Mật khẩu tạm: ' + pw + ' (bắt buộc đổi khi đăng nhập)');
  return 'Xong. Xem mật khẩu tạm trong Execution log.';
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
  const me = auth_(token);
  if (!me.perms.perm_add) throw new Error('Tài khoản của bạn không có quyền thêm bản ghi.');
  return scanCore_(me, payload, false);
}

/**
 * Lõi quét dùng chung cho tài khoản đăng nhập và quét không cần tài khoản (anon = true).
 * anon: KHÔNG lưu tệp gốc lên Drive và không ghi Sheets; chỉ gọi Gemini rồi trả kết quả (fileIds = []).
 */
function scanCore_(me, payload, anon) {
  const started = Date.now();
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
  resetFetchStats_();

  const blobs = items.map(function (it) {
    try { return Utilities.base64Decode(it.b64); } catch (e) { throw new Error('Dữ liệu tệp không hợp lệ.'); }
  });

  const tDrive = Date.now();
  const now = new Date();
  const stamp = Utilities.formatDate(now, TZ, 'yyyyMMdd_HHmmss') + '_' + Utilities.getUuid().slice(0, 6);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let folder;
  try { folder = pathFolder_([DIRS.RAW, Utilities.formatDate(now, TZ, 'yyyy')]); } finally { lock.releaseLock(); }
  const t0 = Date.now();
  const fileIds = items.map(function (it, i) {
    const name = 'RAW_' + payload.docType + '_' + stamp + (items.length > 1 ? '_' + (i + 1) : '') + '.' + it.ext;
    const file = folder.createFile(Utilities.newBlob(blobs[i], it.mimeType, name));
    file.setDescription('Quét bởi ' + me.username);
    return file.getId();
  });

  const t1 = Date.now();
  const data = callGemini_(type, items.map(function (it) { return { mimeType: it.mimeType, b64: it.b64 }; })) || {};
  const t2 = Date.now();
  if (type.fields.some(function (f) { return f.k === 'ten_tinh_thanh'; })) data.ten_tinh_thanh = plateProvince_(data.ma_tinh_thanh, data.bien_so_day_du) || null;
  console.log('scan ' + payload.docType + ' drive=' + (t1 - t0) + 'ms ai=' + (t2 - t1) + 'ms total=' + (Date.now() - started) + 'ms');
  return { data: data, fileIds: fileIds, ms: Date.now() - started, msDrive: t1 - t0, msAi: t2 - t1 };
}

/* ---------- Quét không cần tài khoản (Extension) ----------
 * Không đăng nhập, không lưu Drive, không ghi Sheets: chỉ OCR rồi trả kết quả cho extension tự giữ trong phiên.
 * Hạn mức khai báo ở Web Admin (Cài đặt): ANON_DAILY_LIMIT = số lần / ngày / thiết bị (mặc định 10, 0 = tắt),
 * ANON_GLOBAL_DAILY = tổng số lần / ngày của mọi thiết bị (mặc định 500, chặn việc tự đổi mã thiết bị để lách hạn mức).
 * Bộ đếm lưu ở Script Property ANON_USAGE (JSON), tự đặt lại khi sang ngày (giờ Việt Nam).
 */
const ANON_DEFAULTS = { PER_DEVICE: 10, GLOBAL: 500, MAX_DEVICES: 400 };

function anonNum_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (v === null || v === undefined || String(v).trim() === '') return fallback;
  const n = Math.floor(Number(v));
  return isFinite(n) && n >= 0 ? n : fallback;
}
function anonSettings_() {
  return { perDevice: anonNum_('ANON_DAILY_LIMIT', ANON_DEFAULTS.PER_DEVICE), global: anonNum_('ANON_GLOBAL_DAILY', ANON_DEFAULTS.GLOBAL) };
}
function anonToday_() { return Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'); }
function anonReadUsage_() {
  const day = anonToday_();
  let u = null;
  try { u = JSON.parse(PropertiesService.getScriptProperties().getProperty('ANON_USAGE') || 'null'); } catch (e) { u = null; }
  if (!u || u.day !== day || typeof u.dev !== 'object' || !u.dev) u = { day: day, total: 0, dev: {} };
  return u;
}
/** Giữ chỗ một lượt quét cho thiết bị. Trả { used, limit }; hết hạn mức thì throw. Gọi trong khoá. */
function anonReserve_(deviceKey, st) {
  const u = anonReadUsage_();
  const used = Number(u.dev[deviceKey] || 0);
  if (used >= st.perDevice) throw new Error('Thiết bị này đã dùng hết ' + st.perDevice + ' lượt quét không cần tài khoản trong ngày. Hãy đăng nhập tài khoản OCR hoặc quay lại vào ngày mai.');
  if (u.total >= st.global) throw new Error('Quét không cần tài khoản đã đạt giới hạn chung của hệ thống trong ngày. Hãy đăng nhập tài khoản OCR hoặc quay lại vào ngày mai.');
  if (used === 0 && Object.keys(u.dev).length >= ANON_DEFAULTS.MAX_DEVICES) throw new Error('Quét không cần tài khoản đang quá tải trong ngày. Hãy đăng nhập tài khoản OCR hoặc quay lại vào ngày mai.');
  u.dev[deviceKey] = used + 1; u.total += 1;
  PropertiesService.getScriptProperties().setProperty('ANON_USAGE', JSON.stringify(u));
  return { used: used + 1, limit: st.perDevice };
}
function anonRelease_(deviceKey) {
  const u = anonReadUsage_();
  if (u.dev[deviceKey]) { u.dev[deviceKey] -= 1; if (u.dev[deviceKey] <= 0) delete u.dev[deviceKey]; u.total = Math.max(0, u.total - 1); }
  PropertiesService.getScriptProperties().setProperty('ANON_USAGE', JSON.stringify(u));
}

/** deviceId do extension tự sinh (UUID). Không có tài khoản nên chỉ dùng để đếm hạn mức. */
function scanAnonymous(deviceId, payload) {
  const st = anonSettings_();
  if (st.perDevice <= 0 || st.global <= 0) throw new Error('Quét không cần tài khoản đang tắt. Hãy đăng nhập tài khoản OCR.');
  const id = String(deviceId || '');
  if (!/^[A-Za-z0-9-]{16,64}$/.test(id)) throw new Error('Mã thiết bị không hợp lệ. Tải lại extension rồi thử lại.');
  const key = hash_('anon|' + id).slice(0, 12);
  let quota;
  withLock_(function () { quota = anonReserve_(key, st); });
  try {
    const r = scanCore_({ username: 'anon_' + key, perms: {} }, payload, true); // scanCore_ đã áp rateLimit_ theo username
    r.anon = quota;
    return r;
  } catch (e) {
    withLock_(function () { anonRelease_(key); }); // quét lỗi thì không tính lượt
    throw e;
  }
}

function getAnonConfig(token) {
  requireAdmin_(token);
  const st = anonSettings_(), u = anonReadUsage_();
  return { perDevice: st.perDevice, global: st.global, defaults: { perDevice: ANON_DEFAULTS.PER_DEVICE, global: ANON_DEFAULTS.GLOBAL }, today: { total: u.total, devices: Object.keys(u.dev).length } };
}
/** patch: { perDevice?, global? } số nguyên >= 0. perDevice = 0 hoặc global = 0 tắt quét không cần tài khoản. */
function setAnonConfig(token, patch) {
  const admin = requireAdmin_(token);
  patch = patch || {};
  const p = PropertiesService.getScriptProperties();
  const changed = [];
  [['perDevice', 'ANON_DAILY_LIMIT', 1000], ['global', 'ANON_GLOBAL_DAILY', 100000]].forEach(function (x) {
    if (patch[x[0]] === undefined || patch[x[0]] === null || patch[x[0]] === '') return;
    const n = Number(patch[x[0]]);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n || n > x[2]) throw new Error('Giá trị phải là số nguyên từ 0 đến ' + x[2] + '.');
    p.setProperty(x[1], String(n)); changed.push(x[0] + '=' + n);
  });
  if (changed.length) audit_(admin.username, 'DOI_HAN_MUC_AN_DANH', 'ANON', changed.join('; '));
  return getAnonConfig(token);
}

/* ---------- Biển số xe: tự tách mã tỉnh / seri / loại xe / đối tượng từ chuỗi biển số và màu biển ---------- */
const PLATE_COLORS = { 'trắng': 'Trắng', 'vàng': 'Vàng', 'xanh': 'Xanh', 'đỏ': 'Đỏ' };
const PLATE_OWNER = { 'Trắng': 'Cá nhân, tổ chức', 'Vàng': 'Kinh doanh vận tải', 'Xanh': 'Cơ quan nhà nước', 'Đỏ': 'Quân đội' };
function plateColor_(v) {
  const t = String(v == null ? '' : v).toLowerCase();
  const keys = Object.keys(PLATE_COLORS);
  for (let i = 0; i < keys.length; i++) if (t.indexOf(keys[i]) >= 0) return PLATE_COLORS[keys[i]];
  return null;
}
function fixPlateReading_(data) {
  data.mau_bien = plateColor_(data.mau_bien) || (data.mau_bien ? String(data.mau_bien).trim() : null);
  const raw = data.bien_so_day_du;
  if (typeof raw === 'string' && raw.trim()) {
    const s = raw.toUpperCase().replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
    const m = /^(\d{2})\s*-?\s*([A-ZĐ]{1,2}\d?)\s*[-.\s]\s*(\d{3}[.\s]?\d{2}|\d{4})$/.exec(s);
    const army = /^([A-Z]{2})\s*[-\s]?\s*(\d{2})\s*[-.\s]?\s*(\d{2,3})$/.exec(s);
    if (m) {
      const digits = m[3].replace(/\D/g, '');
      const num = digits.length === 5 ? digits.slice(0, 3) + '.' + digits.slice(3) : digits;
      const moto = /\d$/.test(m[2]);
      data.bien_so_day_du = moto ? m[1] + '-' + m[2] + ' ' + num : m[1] + m[2] + '-' + num;
      data.ma_tinh_thanh = m[1];
      data.seri_dang_ky = m[2];
      if (!data.loai_phuong_tien) data.loai_phuong_tien = moto ? 'Xe máy' : 'Ô tô';
    } else if (army && (data.mau_bien === 'Đỏ' || !data.mau_bien)) {
      // Biển quân đội: 2 chữ cái + 4-5 số, không có mã tỉnh
      data.bien_so_day_du = army[1] + ' ' + army[2] + '-' + army[3];
      data.ma_tinh_thanh = null;
      data.seri_dang_ky = army[1];
      data.mau_bien = 'Đỏ';
    } else {
      const p = /^(\d{2})/.exec(s);
      if (p && !data.ma_tinh_thanh) data.ma_tinh_thanh = p[1];
    }
  }
  if (!data.mau_bien && data.bien_so_day_du) data.mau_bien = 'Trắng';
  data.doi_tuong_su_dung = PLATE_OWNER[data.mau_bien] || null;
  return data;
}

/* ---------- Cân điện tử: đối chiếu khối lượng × đơn giá = thành tiền ----------
 * Màn hình cân dùng dấu chấm cho cả số thập phân (0.58 kg) lẫn phân cách hàng nghìn (260.000 đ), tuỳ hãng, nên chỉ đọc số là không đủ.
 * Hệ thống thử các cách hiểu của chuỗi AI chép nguyên văn và chọn cách khiến khối lượng × đơn giá khớp thành tiền.
 */
function scaleCandidates_(raw, thousandsFirst) {
  const s = String(raw == null ? '' : raw).replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return [];
  const t = s.replace(/,/g, '.');
  const lastDot = t.lastIndexOf('.');
  const decStr = lastDot < 0 ? t : t.slice(0, lastDot).replace(/\./g, '') + '.' + t.slice(lastDot + 1);
  const dec = { v: Number(decStr), d: lastDot < 0 ? 0 : t.length - lastDot - 1 };
  const out = [dec];
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
    const thou = { v: Number(s.replace(/[.,]/g, '')), d: 0 };
    if (thousandsFirst) out.unshift(thou); else out.push(thou);
  }
  return out.filter(function (c) { return isFinite(c.v); });
}

function scaleConsistent_(w, p, t) {
  // Sai số cho phép: làm tròn thành tiền, làm tròn khối lượng, và ~0,6% do cân làm tròn theo từng bước
  const tol = Math.abs(t.v) * 0.006 + 0.5 * Math.pow(10, -t.d) + Math.abs(p.v) * 0.5 * Math.pow(10, -w.d);
  return Math.abs(w.v * p.v - t.v) <= tol;
}

function scaleNote_(data, note) {
  const cur = typeof data.ghi_chu_can === 'string' ? data.ghi_chu_can.trim() : '';
  if (cur.indexOf(note) < 0) data.ghi_chu_can = cur ? cur + ' ' + note : note;
}

function fixScaleReading_(data) {
  const rawW = data.man_hinh_khoi_luong, rawP = data.man_hinh_don_gia, rawT = data.man_hinh_thanh_tien;
  delete data.man_hinh_khoi_luong; delete data.man_hinh_don_gia; delete data.man_hinh_thanh_tien;
  const num = function (v) { return v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v); };
  // Không có chuỗi nguyên văn thì dùng số AI đã đọc
  const wc = scaleCandidates_(rawW, false), pc = scaleCandidates_(rawP, true), tc = scaleCandidates_(rawT, true);
  const asCand = function (v) { return v === null ? [] : [{ v: v, d: (String(v).split('.')[1] || '').length }]; };
  const W = wc.length ? wc : asCand(num(data.khoi_luong));
  const P = pc.length ? pc : asCand(num(data.don_gia));
  const T = tc.length ? tc : asCand(num(data.so_tien));
  if (W.length) data.khoi_luong = W[0].v;
  if (!P.length && !T.length) return data;
  if (W.length && P.length && T.length) {
    const unitKg = !data.don_vi || /^kg$/i.test(String(data.don_vi).trim());
    for (let i = 0; i < P.length; i++) {
      for (let j = 0; j < T.length; j++) {
        if (scaleConsistent_(W[0], P[i], T[j])) {
          data.don_gia = P[i].v; data.so_tien = T[j].v;
          if (data.don_gia === 0 && data.so_tien === 0) scaleNote_(data, 'Màn hình đang hiện đơn giá 0 (cân chưa nhập giá).');
          return data;
        }
      }
    }
    // Không cách hiểu nào khớp: giữ số AI đọc và báo người dùng đối chiếu (đơn vị khác kg thì bỏ qua cảnh báo vì giá có thể tính theo đơn vị khác)
    if (unitKg) scaleNote_(data, 'Cảnh báo: khối lượng × đơn giá khác thành tiền, hãy đối chiếu lại với màn hình cân.');
    return data;
  }
  // Chỉ có một trong hai ô giá: lấy cách hiểu ưu tiên của chuỗi hiển thị
  if (P.length && pc.length) data.don_gia = P[0].v;
  if (T.length && tc.length) data.so_tien = T[0].v;
  return data;
}

/* ---------- Họ tên mất dấu tiếng Việt ----------
 * Nếu họ tên (giấy tờ Việt Nam) trả về không có một dấu nào (thường do lấy từ dòng MRZ in hoa không dấu), đọc lại RIÊNG các trường đó
 * và chỉ nhận kết quả khi bỏ dấu đi thì trùng khít với bản cũ (chỉ thêm dấu, không đổi chữ).
 */
const NAME_FIELDS = {
  CCCD: ['ho_ten'], GPLX: ['ho_ten'], KHAI_SINH: ['ho_ten_khai_sinh', 'ho_ten_cha', 'ho_ten_me'], HO_CHIEU: ['ho_ten']
};
function stripDiacritics_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}
function hasViDiacritics_(s) {
  s = String(s == null ? '' : s);
  return s.length > 0 && stripDiacritics_(s) !== s;
}
function fixNameDiacritics_(docType, type, data, files) {
  const keys = (NAME_FIELDS[docType] || []).filter(function (k) {
    const v = data[k];
    if (typeof v !== 'string' || !v.trim() || hasViDiacritics_(v)) return false;
    if (docType === 'HO_CHIEU') return /viet/.test(stripDiacritics_(data.quoc_tich).toLowerCase()); // hộ chiếu nước ngoài: tên không dấu là bình thường
    return true;
  });
  if (!keys.length) return data;
  const sub = {
    label: type.label,
    hint: 'CHỈ đọc lại các trường sau và giữ ĐỦ dấu tiếng Việt (ă â ê ô ơ ư đ và dấu thanh sắc huyền hỏi ngã nặng). ' +
      'Lấy họ tên từ dòng chữ "Họ và tên" in/viết trên giấy tờ (có dấu), KHÔNG lấy từ vùng mã máy đọc MRZ hay mã vạch (in hoa không dấu). ' +
      'Đây là tên người Việt: không được bỏ dấu, không đổi chữ cái nào ngoài việc thêm dấu.',
    fields: type.fields.filter(function (f) { return keys.indexOf(f.k) >= 0; })
  };
  try {
    const re = callGemini_(sub, files, { slow: true }) || {};
    keys.forEach(function (k) {
      const nv = re[k];
      if (typeof nv === 'string' && hasViDiacritics_(nv) && stripDiacritics_(nv).toLowerCase().replace(/\s+/g, ' ').trim() === stripDiacritics_(data[k]).toLowerCase().replace(/\s+/g, ' ').trim()) {
        console.log('Khôi phục dấu ' + k + ': "' + data[k] + '" -> "' + nv + '"');
        data[k] = nv.trim();
      }
    });
  } catch (e) {
    console.error('Đọc lại dấu họ tên lỗi, giữ kết quả ban đầu: ' + e.message);
  }
  return data;
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
  const skip = type.aiSkip || [];
  const all = type.fields.filter(function (f) { return skip.indexOf(f.k) < 0; }).concat(type.aux || []);
  all.forEach(function (f) {
    if (f.type === 'items') {
      const itemProps = {};
      ITEM_FIELDS.forEach(function (c) {
        itemProps[c.k] = { type: c.type === 'number' ? 'NUMBER' : 'STRING', nullable: true };
      });
      props[f.k] = { type: 'ARRAY', nullable: true, description: f.label, items: { type: 'OBJECT', properties: itemProps } };
    } else if (f.type === 'jobs') {
      props[f.k] = { type: 'ARRAY', nullable: true, description: f.label, items: { type: 'OBJECT', properties: {
        cong_ty: { type: 'STRING', nullable: true }, chuc_danh: { type: 'STRING', nullable: true }, tu: { type: 'STRING', nullable: true }, den: { type: 'STRING', nullable: true }, mo_ta: { type: 'STRING', nullable: true } } } };
    } else {
      props[f.k] = { type: f.type === 'number' ? 'NUMBER' : 'STRING', nullable: true, description: f.label };
    }
  });
  return { type: 'OBJECT', properties: props, required: all.map(function (f) { return f.k; }) };
}

function callGemini_(type, files, opts) {
  opts = opts || {};
  const model = prop_('GEMINI_MODEL', DEFAULTS.GEMINI_MODEL);
  const system =
    'Bạn là bộ máy OCR bóc tách dữ liệu từ tài liệu tiếng Việt. Quy tắc bắt buộc:\n' +
    '1. Chỉ ghi những gì NHÌN THẤY trong tài liệu. Trường nào không có, bị che, mờ không đọc được thì trả null. Tuyệt đối không suy đoán hay tự điền.\n' +
    '2. Giữ nguyên dấu tiếng Việt và chính tả như trên tài liệu; không tự viết hoa/thường lại. Họ tên, địa chỉ, quê quán, nơi sinh phải có ĐỦ dấu (ă â ê ô ơ ư đ và dấu thanh). ' +
    'Tuyệt đối không bỏ dấu; không lấy chữ từ dòng mã máy đọc (MRZ, chữ in hoa không dấu) khi trên tài liệu đã có dòng viết đủ dấu.\n' +
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
    generationConfig: { responseMimeType: 'application/json', responseSchema: buildSchema_(type), temperature: 0 }
  };
  // Đọc giấy tờ không cần suy luận sâu: mặc định thinking mức thấp cho nhanh. GEMINI_THINKING = off để tắt, hoặc minimal/low/medium/high.
  const think = String(prop_('GEMINI_THINKING', 'low') || '').toLowerCase();
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const post = function (b) {
    return fetchRetry_(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': prop_('GEMINI_API_KEY') },
      payload: JSON.stringify(b),
      muteHttpExceptions: true
    });
  };
  let resp;
  if (think && think !== 'off') {
    body.generationConfig.thinkingConfig = { thinkingLevel: think };
    resp = post(body);
    if (resp.getResponseCode() === 400) { // model không hỗ trợ cấu hình này: bỏ đi và gọi lại
      console.error('Gemini từ chối thinkingConfig: ' + resp.getContentText().slice(0, 300));
      delete body.generationConfig.thinkingConfig;
      resp = post(body);
    }
  } else {
    resp = post(body);
  }
  const code = resp.getResponseCode();
  if (code !== 200) {
    console.error('Gemini ' + code + ' (khoá ' + (keyIdx === 0 ? 'chính' : 'dự phòng') + '): ' + resp.getContentText().slice(0, 800));
    if (isBadKey_(resp)) throw new Error('Khoá Gemini API không hợp lệ hoặc đã bị thu hồi. Quản trị viên vào Cài đặt AI để cập nhật khoá.');
    if (code === 403) throw new Error('Khoá Gemini API bị từ chối (403): chưa bật API hoặc khoá bị giới hạn. Quản trị viên kiểm tra khoá ở Cài đặt AI.');
    if (code === 404) throw new Error('Model Gemini "' + model + '" không tồn tại hoặc đã ngừng. Kiểm tra Script Property GEMINI_MODEL.');
    if (code === 429) throw new Error('Gemini đang quá tải hoặc hết hạn mức. Vui lòng thử lại sau.' + retryMarker_(retryAfterSec_(resp.getContentText(), Date.now())));
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

/* ============================ CẤU HÌNH AI (chỉ ADMIN) ============================
 * Khoá lưu trong Script Properties, không bao giờ trả về giao diện: chỉ trả 4 ký tự cuối để nhận biết.
 * Khoá mới được thử gọi Gemini 1 lần trước khi lưu; thử thất bại thì không lưu gì. */

const AI_TIERS = ['free', 'paid'];

function keyHint_(k) { k = String(k || ''); return k ? '••••' + k.slice(-4) : ''; }

function checkKeyFormat_(k) {
  k = String(k || '').trim();
  if (!/^[A-Za-z0-9_\-]{20,120}$/.test(k)) throw new Error('Khoá API không đúng định dạng (20–120 ký tự chữ, số, gạch, không có khoảng trắng).');
  return k;
}

function checkModelName_(m) {
  m = String(m || '').trim();
  if (!/^[A-Za-z0-9._\-]{3,60}$/.test(m)) throw new Error('Tên model không hợp lệ.');
  return m;
}

/** Thử 1 yêu cầu nhỏ (chỉ văn bản). Trả { ok, warn, message }: 429 = khoá hợp lệ nhưng đang hết hạn mức. */
function testGeminiKey_(key, model) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const resp = fetchRetry_(url, {
    method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 8 } }),
    muteHttpExceptions: true
  }, true);
  const code = resp.getResponseCode();
  if (code === 200) return { ok: true, warn: false, message: 'Khoá dùng được.' };
  if (code === 429) return { ok: true, warn: true, message: 'Khoá hợp lệ nhưng đang hết hạn mức (429). Gói miễn phí thường bị như vậy; bật thanh toán để dùng khoá trả phí.' };
  if (isBadKey_(resp)) return { ok: false, warn: false, message: 'Khoá không hợp lệ hoặc đã bị thu hồi.' };
  if (code === 403) return { ok: false, warn: false, message: 'Khoá bị từ chối (403): chưa bật Generative Language API hoặc khoá bị giới hạn.' };
  if (code === 404) return { ok: false, warn: false, message: 'Model "' + model + '" không tồn tại hoặc khoá không được dùng model này.' };
  return { ok: false, warn: false, message: 'Gemini trả lỗi ' + code + '.' };
}

function aiConfigView_() {
  const p = PropertiesService.getScriptProperties();
  const main = String(p.getProperty('GEMINI_API_KEY') || '').trim();
  const baks = AI_BACKUP_PROPS.map(function (n) { return String(p.getProperty(n) || '').trim(); });
  const tier = String(p.getProperty('GEMINI_TIER') || '').trim();
  return {
    model: prop_('GEMINI_MODEL', DEFAULTS.GEMINI_MODEL),
    defaultModel: DEFAULTS.GEMINI_MODEL,
    tier: AI_TIERS.indexOf(tier) >= 0 ? tier : '',
    main: slotView_(main),
    backup: slotView_(baks[0]), // giữ cho giao diện cũ: = dự phòng 1
    backups: baks.map(slotView_) // dự phòng 1..4
  };
}

function getAiConfig(token) {
  requireAdmin_(token);
  return aiConfigView_();
}

/**
 * patch: { apiKey?, backupKeys?: [k1..k4], backupKey? (= dự phòng 1), clearBackups?: [1..4], clearBackup? (= xoá dự phòng 1), model?, tier? }.
 * Chỉ trường có mặt mới đổi; phần tử rỗng trong backupKeys = giữ nguyên.
 * Khoá mới được thử trước; chỉ lưu khi mọi khoá mới đều dùng được (hết hạn mức 429 vẫn tính là hợp lệ).
 */
function setAiConfig(token, patch) {
  const admin = requireAdmin_(token);
  patch = patch || {};
  const model = patch.model !== undefined && String(patch.model).trim() !== '' ? checkModelName_(patch.model) : prop_('GEMINI_MODEL', DEFAULTS.GEMINI_MODEL);
  const newMain = patch.apiKey !== undefined && String(patch.apiKey).trim() !== '' ? checkKeyFormat_(patch.apiKey) : '';
  const rawBaks = Array.isArray(patch.backupKeys) ? patch.backupKeys.slice(0, AI_BACKUP_PROPS.length) : [];
  if (patch.backupKey !== undefined && String(patch.backupKey).trim() !== '' && !String(rawBaks[0] || '').trim()) rawBaks[0] = patch.backupKey;
  const newBaks = AI_BACKUP_PROPS.map(function (n, i) {
    return rawBaks[i] !== undefined && String(rawBaks[i] || '').trim() !== '' ? checkKeyFormat_(rawBaks[i]) : '';
  });
  const clears = {};
  (Array.isArray(patch.clearBackups) ? patch.clearBackups : []).forEach(function (n) {
    n = Number(n); if (n >= 1 && n <= AI_BACKUP_PROPS.length) clears[n - 1] = true;
  });
  if (patch.clearBackup === true) clears[0] = true;
  if (patch.tier !== undefined && patch.tier !== '' && AI_TIERS.indexOf(patch.tier) < 0) throw new Error('Gói không hợp lệ (free hoặc paid).');
  const p = PropertiesService.getScriptProperties();
  // Không cho hai ô cùng một khoá: dùng chung khoá thì chung hạn mức, dự phòng không có tác dụng.
  const finalKeys = ['GEMINI_API_KEY'].concat(AI_BACKUP_PROPS).map(function (n, i) {
    if (i === 0) return newMain || String(p.getProperty(n) || '').trim();
    if (newBaks[i - 1]) return newBaks[i - 1];
    if (clears[i - 1]) return '';
    return String(p.getProperty(n) || '').trim();
  });
  const seen = {};
  finalKeys.forEach(function (k, i) {
    if (!k) return;
    if (seen[k] !== undefined) throw new Error((i === 0 ? 'Khoá chính' : 'Khoá dự phòng ' + i) + ' trùng với ' + (seen[k] === 0 ? 'khoá chính' : 'khoá dự phòng ' + seen[k]) + '. Mỗi ô phải là một khoá khác nhau (tạo ở dự án Google khác). Chưa lưu thay đổi nào.');
    seen[k] = i;
  });
  const tested = [];
  [['Khoá chính', newMain]].concat(newBaks.map(function (k, i) { return ['Khoá dự phòng ' + (i + 1), k]; })).forEach(function (x) {
    if (!x[1]) return;
    const r = testGeminiKey_(x[1], model);
    if (!r.ok) throw new Error(x[0] + ': ' + r.message + ' Chưa lưu thay đổi nào.');
    tested.push(x[0] + (r.warn ? ' (hết hạn mức tạm thời)' : ''));
  });
  const changed = [];
  if (newMain) { p.setProperty('GEMINI_API_KEY', newMain); changed.push('khoa_chinh ' + keyHint_(newMain)); }
  AI_BACKUP_PROPS.forEach(function (n, i) {
    if (newBaks[i]) { p.setProperty(n, newBaks[i]); changed.push('khoa_du_phong_' + (i + 1) + ' ' + keyHint_(newBaks[i])); }
    else if (clears[i]) { p.deleteProperty(n); changed.push('xoa_khoa_du_phong_' + (i + 1)); }
  });
  if (model !== prop_('GEMINI_MODEL', DEFAULTS.GEMINI_MODEL)) { p.setProperty('GEMINI_MODEL', model); changed.push('model=' + model); }
  if (patch.tier !== undefined) {
    if (patch.tier) p.setProperty('GEMINI_TIER', patch.tier); else p.deleteProperty('GEMINI_TIER');
    changed.push('goi=' + (patch.tier || 'chua_chon'));
  }
  if (changed.length) clearKeyCooldowns_();
  if (changed.length) audit_(admin.username, 'DOI_CAU_HINH_AI', 'GEMINI', changed.join('; ')); // chỉ ghi 4 ký tự cuối, không ghi khoá
  const view = aiConfigView_();
  view.tested = tested;
  return view;
}

/** Kiểm tra khoá đang dùng (chính và dự phòng) với model hiện tại. */
function testAiConfig(token) {
  requireAdmin_(token);
  const model = prop_('GEMINI_MODEL', DEFAULTS.GEMINI_MODEL);
  const p = PropertiesService.getScriptProperties();
  const out = [];
  [['main', 'Khoá chính', 'GEMINI_API_KEY']].concat(AI_BACKUP_PROPS.map(function (n, i) { return ['backup' + (i + 1), 'Khoá dự phòng ' + (i + 1), n]; })).forEach(function (x) {
    const k = String(p.getProperty(x[2]) || '').trim();
    if (!k) { out.push({ slot: x[0], label: x[1], set: false }); return; }
    const r = testGeminiKey_(k, model);
    out.push({ slot: x[0], label: x[1], set: true, hint: keyHint_(k), ok: r.ok, warn: r.warn, message: r.message });
  });
  return out;
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
  if (type.fields.some(function (f) { return f.k === 'ten_tinh_thanh'; })) {
    // tên tỉnh luôn tra theo mã biển; chỉ giữ giá trị nhập tay khi mã không tra được
    const pn = plateProvince_(record.ma_tinh_thanh, record.bien_so_day_du);
    if (pn) record.ten_tinh_thanh = pn;
  }
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
function saveRecord(token, docType, data, fileIds, meta) {
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
  // meta.source do cổng doPost gán (WEB_APP / EXTENSION); gọi từ giao diện GAS cũ qua google.script.run không có meta -> WEB_APP
  record.source = meta && SOURCES.indexOf(meta.source) >= 0 ? meta.source : 'WEB_APP';
  record.fbo_sync_status = 'PENDING';

  const cols = typeCols_(type);
  const headers = typeHeaders_(type);
  const formats = cols.map(colFormat_);
  const values = cols.map(function (c) { return cell_(record[c.k], c.type); });
  const keyName = type.uniqueKey || 'raw_file_id';
  const keyVal = String(record[keyName]);
  const ownerIdx = headers.indexOf('scanned_by');
  const sourceIdx = headers.indexOf('source');
  const statusIdx = headers.indexOf('fbo_sync_status');

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
      // Ghi đè: giữ nguồn và trạng thái đồng bộ FBO đã có (chỉ thay khi ô cũ trống)
      const oldSource = String(sh.getRange(row, sourceIdx + 1).getDisplayValue());
      const oldStatus = String(sh.getRange(row, statusIdx + 1).getDisplayValue());
      if (oldSource) values[sourceIdx] = oldSource;
      if (oldStatus) values[statusIdx] = oldStatus;
    } else {
      row = last + 1;
      if (row > sh.getMaxRows()) sh.insertRowAfter(sh.getMaxRows());
    }
    sh.getRange(row, 1, 1, headers.length).setNumberFormats([formats]).setValues([values]);
    SpreadsheetApp.flush();
  });
  audit_(me.username, updated ? 'GHI_DE' : 'THEM', docType, keyName + '=' + keyVal + '; ' + book.getName() + ' dòng ' + row);
  // period + fileId: client (Extension) cần để gọi updateSyncStatus sau khi điền form FBO
  return { book: book.getName(), sheet: docType, row: row, updated: updated, period: Utilities.formatDate(record.scan_timestamp, TZ, 'yyyy-MM'), fileId: fileId };
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
    if (headers.some(function (h) { return SYS_COLS.some(function (c) { return c.k === h && !c.opt; }) && pos[h] === undefined; })) {
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

/**
 * Cập nhật trạng thái đồng bộ sang FBO của một bản ghi (PENDING / FILLED / ERROR).
 * Extension gọi sau khi bơm dữ liệu vào form FBO. Cho phép chủ sở hữu bản ghi hoặc người có quyền sửa bản ghi đó.
 */
function updateSyncStatus(token, docType, period, fileId, status) {
  const me = auth_(token);
  const type = checkType_(docType);
  const p = parsePeriod_(period);
  fileId = checkFileId_(fileId);
  status = String(status || '').toUpperCase();
  if (SYNC_STATUSES.indexOf(status) < 0) throw new Error('Trạng thái đồng bộ không hợp lệ (PENDING, FILLED hoặc ERROR).');
  const headers = typeHeaders_(type);

  let desc = '';
  withLock_(function () {
    const book = findMonthBook_(p.y, p.m);
    if (!book) throw new Error('Không tìm thấy bản ghi (có thể đã bị xoá).');
    const sh = sheet_(book, docType, headers);
    const row = locateRow_(sh, headers, fileId);
    if (!row) throw new Error('Không tìm thấy bản ghi (có thể đã bị xoá).');
    const owner = String(sh.getRange(row, headers.indexOf('scanned_by') + 1).getDisplayValue());
    if (owner !== me.username && !canEdit_(me, owner)) throw new Error('Bạn không có quyền cập nhật bản ghi của người khác.');
    sh.getRange(row, headers.indexOf('fbo_sync_status') + 1).setNumberFormat('@').setValue(status);
    SpreadsheetApp.flush();
    desc = book.getName() + ' dòng ' + row + '; tệp gốc ' + fileId + '; trạng thái ' + status;
  });
  audit_(me.username, 'FBO_SYNC', docType, desc);
  return true;
}

const SYS_COLS = [
  { k: 'scan_timestamp', type: 'date' }, { k: 'document_type', type: 'string' }, { k: 'raw_file_url', type: 'string' },
  { k: 'raw_file_id', type: 'string' }, { k: 'scanned_by', type: 'string' },
  // Hai cột thêm ở Phase 1 (nguồn quét và trạng thái đồng bộ sang FBO). opt: sheet cũ chưa có cột này vẫn đọc được,
  // cột được chèn tự động ở lần ghi kế tiếp vào sheet đó (xem sheet_).
  { k: 'source', type: 'string', opt: true }, { k: 'fbo_sync_status', type: 'string', opt: true }
];

const SOURCES = ['WEB_APP', 'EXTENSION'];
const SYNC_STATUSES = ['PENDING', 'FILLED', 'ERROR'];

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
          if (i < cur.length) sh.insertColumnBefore(i + 1); // cột mới ở cuối thì chỉ cần ghi tiêu đề
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

/** Thuộc tính lưu khoá dự phòng, theo thứ tự thử: dự phòng 1 (tên cũ GEMINI_API_KEY_BACKUP), 2, 3, 4. */
const AI_BACKUP_PROPS = ['GEMINI_API_KEY_BACKUP', 'GEMINI_API_KEY_BACKUP_2', 'GEMINI_API_KEY_BACKUP_3', 'GEMINI_API_KEY_BACKUP_4'];

/** Khoá Gemini theo thứ tự thử: khoá chính, rồi dự phòng 1 → 4 (bỏ khoá trống và khoá trùng khoá đứng trước). */
function geminiKeys_() {
  const p = PropertiesService.getScriptProperties();
  const out = [];
  ['GEMINI_API_KEY'].concat(AI_BACKUP_PROPS).forEach(function (name) {
    const k = String(p.getProperty(name) || '').trim();
    if (k && out.indexOf(k) < 0) out.push(k);
  });
  if (!out.length) throw new Error('Chưa cấu hình Script Property: GEMINI_API_KEY');
  return out;
}

/* ---- Khoá Gemini "nghỉ" (cooldown): nhớ khoá vừa lỗi để lần quét sau dùng thẳng khoá còn dùng được ---- */
const KEY_COOLDOWN_MAX_SEC = 1800; // tối đa 30 phút: lỡ hạn mức đã được nâng/đặt lại sớm thì tối đa 30 phút sau tự thử lại

function cooldownCacheKey_(key) { return 'gkcd_' + hash_(key); }

/** Số giây khoá nên nghỉ theo mã lỗi: 429 theo thời gian Gemini báo; 403/khoá sai 10 phút; 5xx 30 giây. */
function cooldownSecFor_(resp, code) {
  let sec;
  if (code === 429) sec = retryAfterSec_(resp.getContentText(), Date.now());
  else if (code >= 500) sec = 30;
  else sec = 600;
  return Math.max(5, Math.min(KEY_COOLDOWN_MAX_SEC, Math.round(sec)));
}

/** Số giây khoá còn phải nghỉ (0 nếu đang dùng được hoặc không có cache). */
function keyCooldownLeft_(key) {
  if (!key) return 0;
  try {
    const until = Number(CacheService.getScriptCache().get(cooldownCacheKey_(key)) || 0);
    return until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
  } catch (e) { return 0; }
}

function slotView_(key) {
  const v = { set: !!key, hint: keyHint_(key) };
  const w = keyCooldownLeft_(key);
  if (w > 0) v.waitSec = w; // chỉ ADMIN thấy: khoá đang nghỉ do hết hạn mức / lỗi
  return v;
}

function markKeyCooldown_(key, sec) {
  try {
    CacheService.getScriptCache().put(cooldownCacheKey_(key), String(Date.now() + sec * 1000), Math.max(5, Math.min(21600, Math.round(sec))));
  } catch (e) { /* không có cache: bỏ qua, vẫn chạy như cũ */ }
}

/** Xoá trạng thái nghỉ của mọi khoá (gọi khi ADMIN đổi khoá/gói ở Cài đặt AI). */
function clearKeyCooldowns_() {
  try {
    const cache = CacheService.getScriptCache();
    geminiKeysSafe_().forEach(function (k) { cache.remove(cooldownCacheKey_(k)); });
  } catch (e) { /* bỏ qua */ }
}

function geminiKeysSafe_() {
  try { return geminiKeys_(); } catch (e) { return []; }
}

/** Tách khoá thành nhóm sẵn sàng (giữ thứ tự chính -> dự phòng) và nhóm đang nghỉ; minWaitSec = thời gian chờ ngắn nhất nếu mọi khoá đều nghỉ. */
function splitKeysByCooldown_(keys) {
  const now = Date.now();
  const ready = [];
  let minWait = 0;
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  keys.forEach(function (k) {
    let until = 0;
    if (cache) { try { until = Number(cache.get(cooldownCacheKey_(k)) || 0); } catch (e) { until = 0; } }
    if (until > now) {
      const w = Math.ceil((until - now) / 1000);
      minWait = minWait === 0 ? w : Math.min(minWait, w);
    } else {
      ready.push(k);
    }
  });
  return { ready: ready, minWaitSec: Math.max(1, minWait) };
}

/** Phản hồi Gemini cho biết khoá sai / bị thu hồi (HTTP 400 API_KEY_INVALID hoặc 'API key not valid'). */
function isBadKey_(resp) {
  if (resp.getResponseCode() !== 400) return false;
  const t = resp.getContentText();
  return t.indexOf('API_KEY_INVALID') >= 0 || /API key not valid|API key expired/i.test(t);
}

function prop_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (v) return v.trim();
  if (fallback !== undefined) return fallback;
  throw new Error('Chưa cấu hình Script Property: ' + key);
}

function hash_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)).slice(0, 32);
}

/** Số giây còn lại đến 0h giờ Thái Bình Dương: lúc Gemini đặt lại hạn mức theo ngày (RPD). */
function secondsToPacificMidnight_(nowMs) {
  const t = Utilities.formatDate(new Date(nowMs), 'America/Los_Angeles', 'H:m:s').split(':');
  return 86400 - (Number(t[0]) * 3600 + Number(t[1]) * 60 + Number(t[2]));
}

/**
 * Đọc thời gian phải chờ từ thân lỗi 429 của Gemini (giây).
 * Ưu tiên RetryInfo.retryDelay; hết hạn mức theo ngày (PerDay) thì chờ đến 0h giờ Thái Bình Dương;
 * không có thông tin thì mặc định 60 giây (hạn mức theo phút).
 */
function retryAfterSec_(bodyText, nowMs) {
  let info = null;
  try { info = JSON.parse(bodyText); } catch (e) { info = null; }
  const details = (info && info.error && info.error.details) || [];
  let delay = 0, daily = false;
  details.forEach(function (d) {
    if (d && d.retryDelay) {
      const m = /^(\d+(?:\.\d+)?)s$/.exec(String(d.retryDelay));
      if (m) delay = Math.max(delay, Math.ceil(Number(m[1])));
    }
    (d && d.violations || []).forEach(function (v) {
      if (/PerDay/i.test(String(v.quotaId || '') + ' ' + String(v.quotaMetric || ''))) daily = true;
    });
  });
  if (daily) return secondsToPacificMidnight_(nowMs);
  return delay > 0 ? delay : 60;
}

/** Dấu hiệu gắn cuối thông báo lỗi để giao diện đếm ngược; giao diện sẽ cắt dấu hiệu này khi hiển thị. */
function retryMarker_(sec) { return ' [[RETRY_AFTER:' + Math.max(1, Math.round(sec)) + ']]'; }

/** Thống kê một lượt quét (số lần gọi, số lần thử lại, thời gian chờ) để biết chậm ở đâu. */
let FETCH_STATS_ = { calls: 0, retries: 0, waitMs: 0, fetchMs: 0, codes: [] };
function resetFetchStats_() { FETCH_STATS_ = { calls: 0, retries: 0, waitMs: 0, fetchMs: 0, codes: [] }; }

/** UrlFetch có thử lại luỹ thừa cho lỗi 429 / 5xx / lỗi mạng. failover: còn khoá khác để thử thì gặp 429/5xx trả về ngay, không chờ thử lại cùng khoá. */
function fetchRetry_(url, options, failover) {
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    try {
      const resp = UrlFetchApp.fetch(url, options);
      const code = resp.getResponseCode();
      FETCH_STATS_.calls++; FETCH_STATS_.fetchMs += Date.now() - t0; FETCH_STATS_.codes.push(code);
      if (code !== 429 && code < 500) return resp;
      if (failover) return resp;
      if (i === 3) return resp;
    } catch (e) {
      FETCH_STATS_.calls++; FETCH_STATS_.fetchMs += Date.now() - t0; FETCH_STATS_.codes.push('err');
      lastErr = e;
      if (i === 3 || (failover && i >= 1)) throw new Error('Không kết nối được dịch vụ ngoài: ' + e.message);
    }
    const wait = Math.pow(2, i) * 1000 + Math.floor(Math.random() * 500);
    FETCH_STATS_.retries++; FETCH_STATS_.waitMs += wait;
    Utilities.sleep(wait);
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
