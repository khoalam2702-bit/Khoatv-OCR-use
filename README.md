# OCR tài liệu: Google Apps Script + Gemini Vision + Google Sheets + Google Drive

Web App quét và bóc tách 13 loại tài liệu (CCCD, hộ chiếu, GPLX, giấy khai sinh, CV ứng viên, CV nhân viên, sổ đỏ, đơn hàng, phiếu giao hàng, phiếu nhập/xuất kho, màn hình cân điện tử, biển số xe). Toàn bộ chạy trong hệ sinh thái Google, không cần cơ sở dữ liệu ngoài.

## Luồng xử lý

1. Người dùng đăng nhập bằng tài khoản do ADMIN tạo (lưu trong file `OCR_USERS`).
2. Chọn loại tài liệu, chụp ảnh / tải ảnh / tải PDF. Ảnh được thu về tối đa 2000px và nén JPEG chất lượng 0.92 ngay trên trình duyệt.
3. `scanDocument`: lưu tệp gốc vào `ANH_GOC/<năm>`, gọi Gemini với JSON Schema, trả kết quả về màn hình.
4. Người dùng **kiểm tra và sửa** kết quả (AI có thể đọc sai).
5. `saveRecord`: ghi vào sheet của loại tài liệu trong file của tháng hiện tại. Trùng khoá nghiệp vụ (số CCCD, mã đơn hàng...) thì ghi đè dòng cũ.

## Cấu trúc lưu trữ trên Drive

Thư mục gốc: `10H3azrz0_xObAmQsans_JYgI-acuK346`. Hệ thống tự tạo thư mục và file khi sang năm / tháng mới.

```
(thư mục gốc)/
├── ANH_GOC/
│   └── 2026/                     tệp ảnh, PDF gốc đối soát của cả năm
│       └── RAW_CCCD_20261112_083000_ab12cd.jpg
├── DU_LIEU/
│   └── 2026/
│       └── 11/
│           └── OCR_2026_11       file Google Sheets của tháng, 12 sheet theo loại tài liệu
└── OCR_USERS                     file Google Sheets: sheet USERS (tài khoản, phân quyền), NHAT_KY (nhật ký thao tác)
```

- Năm và tháng tính theo thời điểm bấm lưu, múi giờ Việt Nam.
- Trong file tháng, tên sheet = mã loại: `CCCD`, `HO_CHIEU`, `GPLX`, `KHAI_SINH`, `CV_UNGVIEN`, `CV_NHANVIEN`, `SO_DO`, `DON_HANG`, `GIAO_HANG`, `NHAP_KHO`, `XUAT_KHO`, `CAN_DIEN_TU`, `BIEN_SO_XE`.
- 7 cột hệ thống đầu mỗi sheet: `scan_timestamp`, `document_type`, `raw_file_url`, `raw_file_id`, `scanned_by`, `source` (`WEB_APP` hoặc `EXTENSION`), `fbo_sync_status` (`PENDING`, `FILLED`, `ERROR`); sau đó là các trường bóc tách. Sheet của các tháng cũ tự được chèn 2 cột mới ở lần ghi kế tiếp, dữ liệu cũ để trống 2 cột này (hiểu là `WEB_APP` / `PENDING`).
- Cột chữ được định dạng văn bản nên giữ được số 0 đầu (số CCCD, số điện thoại). Cột tiền, khối lượng là số.
- Chi tiết hàng hoá / vật tư lưu dạng JSON trong 1 ô.
- **Không đổi tên thư mục, tên file, tên sheet và không sửa dòng tiêu đề.** Đổi tên thư mục/file thì hệ thống tạo cái mới; sửa tiêu đề thì hệ thống báo lỗi để tránh ghi lệch cột.
- **Chống trùng chỉ trong phạm vi một tháng**: cùng số CCCD quét ở hai tháng khác nhau sẽ có một dòng ở mỗi file tháng.

| Loại | Khoá chống trùng |
|---|---|
| CCCD / HO_CHIEU / GPLX | `so_cccd` / `so_ho_chieu` / `so_gplx` |
| DON_HANG / GIAO_HANG | `ma_don_hang` / `ma_van_don` |
| NHAP_KHO / XUAT_KHO | `so_phieu_nhap` / `so_phieu_xuat` |
| Các loại còn lại | `raw_file_id` (bấm lưu 2 lần cùng một lượt quét không sinh 2 dòng) |

## Cấu trúc monorepo

```
backend_gas/       Apps Script: Code.js (logic + cổng doPost), index.html (giao diện GAS cũ), appsscript.json
admin_webapp/      Web Admin Next.js (NextAuth): đối soát bản ghi, quản lý tài khoản. Xem admin_webapp/README.md
extension_chrome/  Extension Chrome/Edge (MV3 Side Panel): quét 8 loại OCR, lưu về GAS, điền form FBO. Xem mục "Extension" bên dưới
.github/workflows/ deploy.yml (đẩy backend_gas lên GAS), admin-webapp.yml (build Next.js), extension.yml (test extension)
public/, vercel.json   khung Vercel bao quanh giao diện GAS cũ (giữ nguyên)
```

Mọi thao tác **ghi** dữ liệu đều đi qua Apps Script (luật chống trùng, khoá, phân quyền và nhật ký chỉ có một nơi). Web Admin Next.js và Extension chỉ gọi cổng API bên dưới.

## Extension Chrome/Edge (`extension_chrome/`)

Side Panel (Chrome / Edge 114+). Giai đoạn này hỗ trợ 8 loại: `CCCD`, `HO_CHIEU`, `GPLX`, `KHAI_SINH`, `CV_UNGVIEN`, `CV_NHANVIEN`, `CAN_DIEN_TU`, `BIEN_SO_XE` (danh sách ở `extension_chrome/lib/config.js`; nhãn và trường lấy từ `getAppConfig`).

Luồng: đăng nhập (tài khoản Web Admin) → chọn loại → thêm ảnh/PDF (chọn tệp, kéo thả, Ctrl+V; ảnh nén JPEG 0.92) → `scanDocument` → xem/sửa → `saveRecord` (ghi `source = EXTENSION`, `fbo_sync_status = PENDING`) → "Điền vào FBO" → `updateSyncStatus` (`FILLED` / `ERROR`).

Cài thử: `chrome://extensions` → bật Developer mode → Load unpacked → chọn thư mục `extension_chrome`. Mở **Cài đặt** của extension để:
1. Nhập URL Web App `/exec` và bấm "Lưu và kiểm tra kết nối".
2. Cấp quyền cho địa chỉ FBO (xin lúc chạy, không cố định trong manifest).
3. Khai ánh xạ `trường OCR → selector` (JSON) cho từng loại; có nút "Dò trang" để liệt kê ô nhập của form FBO đang mở.

Ánh xạ mẫu: `extension_chrome/presets/fbo-hrm.json` (FBO HRM: CCCD vào form Thông tin nhân viên, CV_UNGVIEN vào form Cập nhật hồ sơ ứng viên; GPLX và BIEN_SO_XE ở ERP khách hàng: form con Bằng lái, form Thông tin thiết bị). Một trường OCR có thể điền nhiều ô (mảng), `transform` tách họ tên (`name_head`/`name_last`), `format: "date"` chỉ điền khi đúng dd/MM/yyyy, `prefix` + `append` dồn nhiều trường vào một ô (Ghi chú).

Ánh xạ mẫu được đóng gói sẵn trong extension (không cần dán); chỉnh ở Cài đặt chỉ lưu phần khác mẫu. Chưa có ánh xạ cho loại nào thì nút "Điền vào FBO" chỉ báo thiếu cấu hình, extension không tự đoán selector.

### Cấu hình trung tâm và tài khoản đã lưu

- **Link bản triển khai Apps Script** nằm ở một nơi duy nhất: dòng `var APP_URL = '...'` trong `public/index.html` trên GitHub (AutoSynCode tự cập nhật sau mỗi lần deploy). Extension đọc tệp này (`linkUrl` trong `extension_chrome/config.json`) mỗi lần mở Side Panel; Web Admin (proxy `/api/gas`, trang Quét, `/api/extension-config`) cũng đọc đúng tệp này (đọc lại sau tối đa 60 giây); biến `GAS_WEB_APP_URL` trên Vercel chỉ là dự phòng khi không đọc được GitHub. Mật khẩu đăng nhập được gửi tới link này nên cần giữ quyền ghi nhánh `main`. Link **không** lưu trong extension, người dùng không nhập link. Lần đầu cần có mạng; sau đó extension giữ bản đã lấy khi mất mạng. Địa chỉ FBO mặc định (tuỳ chọn) lấy từ `EXTENSION_FBO_ORIGINS` trên Vercel; mặc định không có, người dùng tự thêm ở Cài đặt.
- **Nhớ tài khoản OCR:** tên đăng nhập, phiên (5,5 giờ) và, nếu tích "Ghi nhớ", mật khẩu mã hoá AES-GCM (khoá không xuất được trong IndexedDB, không đồng bộ). Hết phiên thì tự đăng nhập lại; bấm Đăng xuất sẽ xoá mật khẩu đã nhớ.
- **Đăng nhập FBO đã lưu** theo từng địa chỉ (Cài đặt, mục 3): nút "Đăng nhập FBO" ở Side Panel điền Công ty, Tên, Đơn vị, Mật khẩu và bấm Nhận ở tab hiện tại.
- Địa chỉ FBO trong cấu hình chỉ cần cấp quyền một lần (banner "Cấp quyền FBO" ở Side Panel).

**Không cần tài khoản OCR.** Màn hình đầu của Side Panel có nút "Dùng không cần tài khoản": quét qua action `scanAnonymous` (không token), **không** lưu Drive/Sheets/Web Admin, kết quả chỉ giữ ở `chrome.storage.session` (đóng trình duyệt là mất). Chế độ này không có bước Lưu: nút "Điền vào FBO" hiện ngay, không hỏi lưu. Lượt dùng thử tính theo thiết bị (mã là UUID extension tự sinh), hết thì tự cấp lại sau 48 giờ; khai báo ở Web Admin → Lượt quét (Script Properties `ANON_DAILY_LIMIT` = lượt mỗi thiết bị, `ANON_GLOBAL_DAILY` = trần chung số lần quét dùng thử mỗi ngày, mặc định 500; nhập 0 để tắt). Chi tiết ở mục "Lượt quét".

Kiểm thử: `cd extension_chrome && npm ci && npm test`.

### CV nhân viên (`CV_NHANVIEN`)

Quét CV rồi điền vào form **Thông tin nhân viên** (cùng form CCCD đã điền; không điền các ô trùng CCCD: họ tên, giới tính, ngày sinh, quốc tịch). Ánh xạ trong `presets/fbo-hrm.json`, đã đối chiếu với form thật:
- Tab Thông tin chung: Địa chỉ hiện tại (số nhà/tổ + tỉnh + phường/xã).
- Tab Trình độ học vấn: trình độ (mã 10 Phổ thông, 20 Trung học, 30 Trung cấp, 40 Cao đẳng, 50 Đại học, 60 Thạc sỹ, 70 Tiến sỹ), trường, xếp loại. Chuyên ngành và khoảng năm học đưa vào Ghi chú (ô chuyên ngành là danh mục mã riêng của từng khách hàng; ô ngày cần đủ ngày/tháng).
- Tab Ngoại ngữ: ngoại ngữ chính (mã 01 Anh ... 07 Hàn) và bằng/điểm; ngoại ngữ khác vào Ghi chú.
- Ô **Ghi chú nằm ở tab Khác** (tab "Ghi chú" trên form là khung bình luận): Kỹ năng, Sở thích, Chứng chỉ, Kinh nghiệm làm việc, mỗi mục một dòng có đầu mục.
Mã danh mục theo dữ liệu demo; khách hàng có danh mục khác thì chỉnh bảng `map` ở Cài đặt.
- **Ảnh chân dung (CV nhân viên và CV ứng viên):** AI trả khung ảnh trong CV (ảnh hoặc PDF), extension cắt (`lib/photo.js`, trang PDF vẽ bằng pdf.js đóng gói sẵn trong `lib/vendor/pdfjs/`, giấy phép Apache-2.0) và gắn vào ô chọn ảnh của form khi bấm Điền. Có xem trước và ô bỏ chọn; form đã có ảnh thì hỏi trước khi thay. Khung ảnh không có hoặc không hợp lệ thì bỏ qua, không đoán.

### Địa chỉ cũ → tỉnh/xã mới (sáp nhập 01/7/2025)

Thẻ CCCD cấp trước 2025 in địa chỉ 3 cấp cũ (xã/huyện/tỉnh). Extension quy đổi sang tỉnh + phường/xã mới của danh mục FBO bằng `extension_chrome/presets/dm/dia-chi-cu.json` (12.216 dòng nghị quyết; xã cũ nhập trọn vào 1 xã mới thì tự chọn, xã cũ bị chia cho nhiều xã mới thì để trống và ghi gợi ý, không đoán). Áp dụng cho mọi loại có địa chỉ tách ô: Thường trú/Quê quán của CCCD (cả form nhân viên lẫn ứng viên) và Địa chỉ của CV ứng viên. Sinh lại bảng: `node tools/build-dia-chi-cu.mjs <thư mục data của dorabot-io/sap-nhap-2025>`.

Nguồn dữ liệu: Dorabot (dorabot.io/dia-chi/sap-nhap), chép từ nghị quyết của Ủy ban Thường vụ Quốc hội, giấy phép [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.vi).


#### Quá trình công tác (từng công việc)
- AI trả thêm danh sách `cong_viec` (đơn vị, chức danh, từ, đến, mô tả); danh sách chỉ dùng để điền form, không thành cột trong Sheet.
- Sau khi quét, panel hiện danh sách công việc. Mở form "Thêm thông tin quá trình công tác trước đây" ở FBO, bấm **Điền công việc tiếp theo**; mỗi lần điền một công việc, tool không tự bấm Lưu.
- Chống trùng/ghi đè: công việc đã điền được đánh dấu ✓ (điền lại phải xác nhận); form đang ở chế độ Sửa (tiêu đề không phải "Thêm") thì hỏi trước; form còn dữ liệu của bản ghi chưa Lưu thì hỏi trước khi ghi đè.
- Ngày theo quy ước khi CV thiếu: Từ không có → hôm nay; chỉ năm → 01/01; tháng/năm → đầu tháng. Đến không có → bằng ngày Từ; chỉ năm → 31/12; tháng/năm → cuối tháng; "Nay" → hôm nay (ô Đến của form bắt buộc). Thời gian gốc ghi vào Ghi chú. Ánh xạ nằm ở khóa `CV_NHANVIEN@CONGTAC` trong `presets/fbo-hrm.json`.

## Cổng API (`doPost`)

Dùng cho Web Admin Next.js và Extension. Gửi `POST` tới URL Web App, `Content-Type: text/plain` (tránh preflight CORS), thân JSON:

```json
{ "action": "listRecords", "args": ["<token>", "CCCD", "2026-11-01", "2026-11-21"], "client": "EXTENSION" }
```

Trả về `{ "ok": true, "data": ... }` hoặc `{ "ok": false, "error": "thông báo" }`. `error` có thể là mã `SESSION_EXPIRED` (đăng nhập lại) hoặc `MUST_CHANGE_PASSWORD`.

- Đăng nhập: `login` với `args: [username, password]`, nhận `token` 6 giờ (cùng hệ thống tài khoản, phân quyền của giao diện GAS). Các hành động còn lại nhận `token` ở `args[0]`.
- `client`: `WEB_APP` (mặc định) hoặc `EXTENSION`; được ghi vào cột `source` khi `saveRecord`.
- Hành động có sẵn: `getAppConfig`, `login`, `logout`, `checkSession`, `getMe`, `changeMyPassword`, `requestPasswordReset`, `resetPasswordWithCode`, `scanDocument`, `saveRecord`, `listRecords`, `getRawFile`, `updateRecord`, `deleteRecord`, `updateSyncStatus` (cập nhật `fbo_sync_status`), `logExport`, `listUsers`, `createUser`, `updateUser`, `resetUserPassword`, `deleteUser`. Hàm không có trong danh sách (`API_ACTIONS` trong `Code.js`) không gọi được.
- Sau khi sửa `Code.js` phải **tạo version mới** của deployment (hoặc để GitHub Actions làm) thì `doPost` mới có hiệu lực.

## Cài đặt (làm 1 lần)

1. Tạo dự án Apps Script bằng tài khoản Google có quyền chỉnh sửa thư mục gốc trên Drive.
2. Project Settings > Script Properties, thêm:

   | Khoá | Giá trị |
   |---|---|
   | `GEMINI_API_KEY` | Khoá từ Google AI Studio |
   | `GEMINI_MODEL` (tuỳ chọn) | Mặc định `gemini-3.6-flash` |
   | `DRIVE_FOLDER_ID` (tuỳ chọn) | Thư mục gốc, mặc định `10H3azrz0_xObAmQsans_JYgI-acuK346` |

3. Đẩy code lần đầu từ máy:
   ```bash
   npm install
   npx clasp login
   npx clasp push -f
   ```
4. Trong trình soạn thảo, chạy hàm `setup` một lần: cấp quyền, tạo thư mục ảnh năm nay, file dữ liệu tháng này và file `OCR_USERS`. Link các file hiện trong nhật ký thực thi.
5. Đăng nhập lần đầu bằng tài khoản mặc định `admin` / `khoatv@123`. Hệ thống **bắt buộc đổi mật khẩu ngay** trước khi dùng bất kỳ chức năng nào. Kho mã này là **public** nên mật khẩu mặc định ai cũng đọc được: hãy đăng nhập và đổi ngay sau khi triển khai (hoặc chuyển repo sang private).
6. Vào tab **Tài khoản** (chỉ ADMIN thấy) để tạo người dùng. Người dùng mới phải đổi mật khẩu ở lần đăng nhập đầu tiên.

## Quét nhiều tệp trong một lần

- Tab **Quét tài liệu** gom mọi thứ trên một màn hình: bên trái chọn loại tài liệu và thêm tệp, bên phải hiện ngay kết quả để kiểm tra, sửa và lưu (điện thoại thì xếp dọc, tự cuộn tới kết quả).
- Một tài liệu có thể có tối đa 6 tệp (ví dụ CCCD 2 mặt = 2 ảnh): chụp liên tiếp (camera giữ mở đến khi bấm Xong) hoặc chọn nhiều ảnh / PDF một lượt. Tất cả được gửi cho Gemini **trong một lần gọi** và gộp thành **một bản ghi**. Mỗi tệp tối đa 14 MB, tổng tối đa 24 MB.
- Mọi tệp được lưu trong `ANH_GOC/<năm>`; `raw_file_id` là mã của tệp đầu tiên, cột `raw_file_url` chứa link của tất cả các tệp (mỗi dòng một link). Chỉ gắn được các tệp chính người dùng vừa quét.

## Bản ghi đã lưu: lọc, xem ảnh, xuất Excel

- Lọc theo **từ ngày / đến ngày lưu** (mặc định từ mùng 1 tháng này đến hôm nay) và theo **loại tài liệu**.
- Ô **lọc chữ** gợi ý sẵn các giá trị có trong loại tài liệu đó (tên, nơi, số...); không phân biệt hoa thường và dấu.
- Bảng hiển thị **đầy đủ mọi trường** của loại tài liệu. Cột **Ảnh** (cố định bên trái) có nút "Xem (n)" mở ngay ảnh / PDF đã upload của bản ghi; mở một bản ghi để sửa cũng tự hiện ảnh.
- **Xuất Excel** tạo ngay trên trình duyệt: đúng các bản ghi đang lọc, không kèm ảnh / PDF; loại có bảng chi tiết (nhập kho, đơn hàng...) có thêm một sheet chi tiết.
- Màn quét: chọn loại tài liệu là hiện sẵn các trường (để trống), quét xong mới điền thông tin vào.

## Phiếu nhập / xuất kho

Trên form, ô **Kho nhập / Kho xuất** nằm ngay dưới bảng chi tiết hàng. Bảng chi tiết có cột **Mã hàng** đứng đầu (dùng chung cho đơn hàng, nhập kho, xuất kho; lưu trong cùng ô JSON nên không cần đổi cấu trúc sheet). Thứ tự cột trong Google Sheets không đổi.

## Định dạng tiền

Các ô tiền (đơn giá, số tiền, thành tiền, tổng tiền hàng, giảm giá, thanh toán, tiền COD, cước phí, tổng giá trị, kể cả các dòng chi tiết) hiển thị dạng `1.234.567` ngay khi gõ (chấm ngăn hàng nghìn, phẩy cho số lẻ). Dữ liệu lưu vào Sheets vẫn là số thuần. Khối lượng, số lượng, diện tích không định dạng kiểu tiền.

## Cân điện tử

Các trường: `khoi_luong` (số kg), `don_vi`, `don_gia`, `so_tien`, `trang_thai`, `ghi_chu_can`. Khi nhập khối lượng và đơn giá, `so_tien` tự tính = khối lượng × đơn giá, vẫn sửa tay được. AI chỉ điền đơn giá / số tiền nếu ảnh hoặc phiếu có ghi, không tự tính. Sheet `CAN_DIEN_TU` của các tháng đã có sẽ tự được chèn thêm 2 cột mới, dữ liệu cũ giữ nguyên.

## Biển số xe

Có thêm cột `ten_tinh_thanh` (ngay sau `ma_tinh_thanh`). Tên tỉnh/thành do hệ thống tự tra theo 2 số đầu của biển (bảng `PLATE_PROVINCES` trong `Code.js`), không để AI đoán; sửa mã tỉnh trên form thì tên tỉnh đổi theo. Tên theo mã biển kiểm soát vốn có (chưa gộp tỉnh 2025); mã không có trong bảng thì để trống và nhập tay được. Sheet `BIEN_SO_XE` các tháng cũ tự được chèn thêm cột.

## Quên / đặt lại mật khẩu

- **Người dùng quên mật khẩu:** liên hệ ADMIN. ADMIN vào tab Tài khoản, mở tài khoản đó, bấm **Cấp mật khẩu tạm**. Hệ thống sinh mật khẩu ngẫu nhiên 10 ký tự (hiện một lần để sao chép), vô hiệu mật khẩu cũ, đăng xuất các phiên đang mở và bắt người dùng đổi mật khẩu khi đăng nhập. (Vẫn có thể gõ mật khẩu cụ thể ở ô "Đặt lại mật khẩu".)
- **Tự đặt lại qua email:** ADMIN khai báo **Email** trong tài khoản (tab Tài khoản). Ở màn đăng nhập, người dùng bấm **Quên mật khẩu?**, nhập tên đăng nhập, nhận **mã 6 số** qua email, rồi nhập mã + mật khẩu mới. Mã hiệu lực 15 phút, dùng một lần, sai 5 lần là huỷ, tối đa 3 mã mỗi giờ cho mỗi tài khoản. Phản hồi luôn giống nhau dù tài khoản có tồn tại hay có email hay không. Đặt lại xong thì đăng xuất mọi phiên cũ và gỡ khoá đăng nhập tạm. Tài khoản chưa có email thì liên hệ ADMIN như trên.
  - Thư gửi bằng `MailApp` từ tài khoản Google chủ dự án (Gmail thường ~100 thư/ngày, Workspace ~1500). Lần đầu sau khi có bản này, chủ dự án phải **cấp lại quyền** (thêm phạm vi gửi email `script.send_mail`): mở trình soạn thảo Apps Script, chạy thử một hàm bất kỳ (ví dụ `getAppConfig`), bấm Cho phép, rồi Deploy bản mới.
- **Người dùng muốn đổi mật khẩu:** nút **Mật khẩu** trên thanh trên cùng.
- **ADMIN quên mật khẩu của chính mình** (không còn ADMIN nào đăng nhập được): chỉ chủ dự án Apps Script làm được.
  1. Project Settings > Script properties > thêm `ALLOW_ADMIN_RESET` = tên đăng nhập ADMIN cần cấp lại (ví dụ `admin`).
  2. Trong trình soạn thảo chọn hàm `resetAdminPassword` rồi Run.
  3. Xem mật khẩu tạm trong Execution log, đăng nhập và đổi mật khẩu. Thuộc tính tự bị xoá sau khi chạy; không đặt thuộc tính thì hàm không làm gì.

## Phân quyền

Chỉ ADMIN được tạo / sửa / khoá / xoá tài khoản, đặt lại mật khẩu và tick quyền riêng cho từng người. ADMIN luôn có toàn quyền. Quyền áp dụng cho **bản ghi OCR đã quét**:

| Quyền | Ý nghĩa |
|---|---|
| `perm_add` | Quét và lưu bản ghi mới |
| `perm_edit_own` / `perm_del_own` | Sửa / xoá bản ghi do chính mình quét |
| `perm_edit_other` / `perm_del_other` | Sửa / xoá bản ghi do người khác quét |

- Người dùng chỉ thấy bản ghi của mình, trừ khi được cấp quyền sửa hoặc xoá bản ghi của người khác (khi đó thấy tất cả).
- Tab **Bản ghi đã lưu**: lọc theo loại tài liệu và tháng, mở từng bản ghi để xem, sửa, xoá và **xem lại ảnh / PDF đã upload** (xem ngay trên giao diện, không cần quyền vào Drive; bản ghi nhiều tệp có nút chuyển Tệp 1/2, 2/2).
- Quyền được kiểm tra lại ở mỗi lần gọi, nên khoá tài khoản hoặc đổi quyền có hiệu lực ngay. Đặt lại mật khẩu vô hiệu hoá các phiên đang mở.
- Xoá bản ghi chỉ xoá dòng trong Google Sheets; tệp gốc trên Drive được giữ lại để đối soát. Lưu trùng khoá nghiệp vụ (ví dụ số CCCD) là ghi đè nên cần quyền sửa bản ghi đó; chủ sở hữu giữ nguyên.
- Luôn còn ít nhất một ADMIN hoạt động; ADMIN không thể tự khoá, tự hạ quyền hay tự xoá.
- Sheet `NHAT_KY` ghi mọi thao tác (thêm, ghi đè, sửa, xoá, quản lý tài khoản), không ghi mật khẩu.
- Nâng cấp từ bản cũ: sheet `USERS` 6 cột được tự chuyển sang cấu trúc mới ở lần đăng nhập đầu; người cũ thành USER với quyền thêm và sửa của mình.

## GitHub Actions

Settings > Secrets and variables > Actions, thêm:

| Secret | Giá trị |
|---|---|
| `CLASPRC_JSON` | Toàn bộ nội dung `~/.clasprc.json` sau khi `clasp login` |
| `DEPLOYMENT_ID` | ID bản triển khai Web App (để URL không đổi mỗi lần deploy) |

`scriptId` của dự án Apps Script đã khai sẵn trong `.clasp.json` (không phải bí mật).

Mỗi lần push lên `main`, pipeline kiểm tra cú pháp, `clasp push -f` và cập nhật bản triển khai. Khi chưa có secret `CLASPRC_JSON`, pipeline chỉ kiểm tra cú pháp rồi bỏ qua bước triển khai.
Nếu pipeline báo lỗi xác thực, chạy lại `clasp login` trên máy và cập nhật secret `CLASPRC_JSON`.

## Bảo mật

- **Thư mục gốc phải để riêng tư.** Ai có quyền trên thư mục đều xem được ảnh giấy tờ, dữ liệu, và (nếu có quyền sửa) sửa được quyền và mật khẩu trong `OCR_USERS`; chỉ chia sẻ cho người quản trị.
- Khoá Gemini chỉ nằm trong Script Properties; trình duyệt không bao giờ nhận được.
- Mật khẩu lưu dạng băm SHA-256 có salt, lặp 1000 vòng; mật khẩu không bao giờ nằm dạng rõ trong sheet.
- Phiên đăng nhập 6 giờ; khoá 15 phút sau 5 lần nhập sai.
- Giá trị bắt đầu bằng `= + - @` được ép thành văn bản để không bị Sheets chạy như công thức.
- Hàm backend kết thúc bằng `_` không gọi được từ trình duyệt.

## Giới hạn đã biết

- Lượt lưu đầu tiên của mỗi tháng chậm hơn vài giây vì phải tạo thư mục và file mới.
- Muốn thống kê cả năm phải gộp 12 file tháng (ví dụ bằng `IMPORTRANGE`).
- Các lượt lưu được xếp hàng bằng khoá (LockService), nhiều người lưu cùng lúc sẽ chờ nhau vài giây.
- Phiên đăng nhập lưu trong CacheService: tối đa 6 giờ, có thể mất sớm hơn.
- Tệp tối đa 14 MB; PDF dài nên tách 5-10 trang mỗi lượt.
- Một số trình duyệt chặn camera trực tiếp trong khung Apps Script; khi đó nút "Chụp ảnh" tự chuyển sang ứng dụng camera của máy.
- Quét xong nhưng không bấm lưu (Web) hoặc không bấm Điền vào FBO (Extension) thì tệp gốc vẫn nằm trên Drive, không có dòng tương ứng.
- Extension không có nút Lưu: tài khoản đăng nhập được ghi bản ghi ngầm khi bấm Điền vào FBO (loại chưa có form FBO: khi bấm Quét tiếp); ghi lỗi không báo trên Extension và không chặn việc điền.

## Gộp về một domain (Web Admin + giao diện quét)

- Một link duy nhất: `https://khoatv-ocr-extensions.vercel.app` (dự án `admin_webapp`). Đăng nhập Web Admin xong vào thẳng **Quét OCR**; thanh menu cùng trang có **Bản ghi**, **Tài khoản**, **Cài đặt AI**.
- **Quét OCR** (`/scan`) nhúng ứng dụng Apps Script ngay trong khung nội dung, dưới thanh menu. Địa chỉ Apps Script đọc từ dòng `APP_URL` trong `public/index.html` trên GitHub; biến `GAS_WEB_APP_URL` chỉ là dự phòng. Đổi link Web App không cần Redeploy.
- `/app` là bản **toàn màn hình, không cần đăng nhập Web Admin** (ứng dụng có đăng nhập OCR riêng), dùng cho người chỉ cần quét. Link cũ `khoatv-ocr-use.vercel.app` tự chuyển hướng sang `/app` (`vercel.json` ở thư mục gốc).
- `public/index.html` giữ nguyên vì AutoSynCode cập nhật `APP_URL` trong đó và extension đọc `APP_URL` từ tệp này trên GitHub.

## Hosting trên Vercel (khung bao quanh ứng dụng)

- Vercel không build mã nguồn: `vercel.json` đặt `outputDirectory` là `public`, không có lệnh build. `backend_gas/` (mã Apps Script) không được phát tán.
- `public/index.html` mở ứng dụng Apps Script trong một khung toàn màn hình (iframe), nên thanh địa chỉ vẫn là `khoatv-ocr-use.vercel.app` và **không bị chuyển sang `script.google.com`**. Góc phải dưới có nút "Mở tab mới"; nếu khung tải chậm quá 8 giây sẽ hiện nút mở trực tiếp.
- Để Apps Script cho phép nhúng, `doGet` dùng `setXFrameOptionsMode(ALLOWALL)`. Sau khi cập nhật mã phải **tạo version mới** của deployment thì Vercel mới hiển thị được.
- Sau khi deploy Web App, điền URL vào biến `APP_URL` trong `public/index.html` rồi push (ASC-BOT tự cập nhật dòng này); Vercel tự cập nhật.
- Ứng dụng thực sự chạy trên Apps Script (backend dùng `DriveApp`, `SpreadsheetApp`, giao diện dùng `google.script.run`), nên không chạy được nếu chép nguyên `src/index.html` lên Vercel.
- Cấu hình trên Vercel: Application Preset = Other, Root Directory = `./`.
- Lưu ý: vì cho phép nhúng, trang khác cũng có thể nhúng ứng dụng này; ứng dụng vẫn yêu cầu đăng nhập.

#### Quét 1 lần, điền nhiều lần
Kết quả quét (kể cả ảnh chân dung và danh sách công việc) được giữ trong phiên trình duyệt: tắt/mở lại side panel hoặc form FBO vẫn bấm Điền tiếp được, không phải quét lại. Bấm "Quét tiếp" mới xóa. Khi tab FBO không phản hồi, tool báo rõ tab nào, trạng thái gì thay vì chỉ báo hết giờ.

#### Chuyên ngành (CV nhân viên)
Chuyên ngành trên CV được đối chiếu với danh mục chuyên ngành của FBO (`presets/dm/chuyen-nganh.json`, dạng `[["mã","tên"],...]`) để điền mã vào ô `ma_cn`: trùng tên > tên danh mục nằm trong chuyên ngành trên CV > giống từ >= 70%; không khớp thì dùng mã `99` (KHÁC). Danh mục này chép từ site demo; khách hàng khác có danh mục riêng thì thay file này bằng danh mục của họ (mã sai sẽ điền nhầm chuyên ngành).

## Lượt quét (bán theo gói)

- Mỗi tài khoản OCR được tặng 100 lượt (một lần, không hết hạn); ADMIN không giới hạn. CV tính 2 lượt, loại khác 1 lượt; chỉ đọc QR CCCD không tính.
- Extension chỉ trừ lượt khi điền được ít nhất một ô lên FBO. Quét trên web và loại chưa có form FBO trừ khi quét xong. Quét lỗi không trừ.
- Không đăng nhập: lượt dùng thử theo thiết bị, hết thì tự cấp lại sau 48 giờ; có nút "Đề nghị gia hạn số lượt" (tên công ty, số điện thoại).
- Web Admin > Lượt quét: bậc thang số tiền / số lượt, gia hạn (đã thu / chờ thanh toán), điều chỉnh, chuyển lượt, danh sách cần gia hạn, cài đặt.
- Dữ liệu nằm trong file `OCR_USERS`: các sheet `LUOT_VI`, `LUOT_NHATKY`, `LUOT_DOT`, `LUOT_DENGHI` (tự tạo). Không sửa tay.
- Khoá dùng thử: chọn khoá chung (trả phí) hoặc khoá miễn phí riêng (Script Property `GEMINI_TRIAL_KEY`, khai ở Cài đặt lượt), áp cho máy không đăng nhập và tài khoản chưa mua đợt nào.
- Máy đã đăng nhập tài khoản OCR (không phải ADMIN) không còn dùng thử; có công tắc ở Cài đặt lượt.
- Token mỗi lần gọi Gemini được cộng dồn theo ngày ở sheet `LUOT_TOKEN`; Web Admin có mục Khách hàng và Doanh thu - chi phí (chi phí là ước tính theo đơn giá khai báo).
- Trang Quét trong Web Admin dùng mã đăng nhập một lần (`createWebHandoff` / `redeemWebHandoff`, 90 giây) nên không phải đăng nhập lần hai.
- Chưa lưu bậc thang lần nào thì dùng 6 bậc đề xuất trong `DEFAULT_TIERS`.
