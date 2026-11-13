# OCR tài liệu: Google Apps Script + Gemini Vision + Google Sheets + Google Drive

Web App quét và bóc tách 12 loại tài liệu (CCCD, hộ chiếu, GPLX, giấy khai sinh, CV, sổ đỏ, đơn hàng, phiếu giao hàng, phiếu nhập/xuất kho, màn hình cân điện tử, biển số xe). Toàn bộ chạy trong hệ sinh thái Google, không cần cơ sở dữ liệu ngoài.

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
- Trong file tháng, tên sheet = mã loại: `CCCD`, `HO_CHIEU`, `GPLX`, `KHAI_SINH`, `CV_UNGVIEN`, `SO_DO`, `DON_HANG`, `GIAO_HANG`, `NHAP_KHO`, `XUAT_KHO`, `CAN_DIEN_TU`, `BIEN_SO_XE`.
- 5 cột hệ thống đầu mỗi sheet: `scan_timestamp`, `document_type`, `raw_file_url`, `raw_file_id`, `scanned_by`; sau đó là các trường bóc tách.
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

## Cân điện tử

Các trường: `khoi_luong` (số kg), `don_vi`, `don_gia`, `so_tien`, `trang_thai`, `ghi_chu_can`. Khi nhập khối lượng và đơn giá, `so_tien` tự tính = khối lượng × đơn giá, vẫn sửa tay được. AI chỉ điền đơn giá / số tiền nếu ảnh hoặc phiếu có ghi, không tự tính. Sheet `CAN_DIEN_TU` của các tháng đã có sẽ tự được chèn thêm 2 cột mới, dữ liệu cũ giữ nguyên.

## Biển số xe

Có thêm cột `ten_tinh_thanh` (ngay sau `ma_tinh_thanh`). Tên tỉnh/thành do hệ thống tự tra theo 2 số đầu của biển (bảng `PLATE_PROVINCES` trong `Code.js`), không để AI đoán; sửa mã tỉnh trên form thì tên tỉnh đổi theo. Tên theo mã biển kiểm soát vốn có (chưa gộp tỉnh 2025); mã không có trong bảng thì để trống và nhập tay được. Sheet `BIEN_SO_XE` các tháng cũ tự được chèn thêm cột.

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
- Quét xong nhưng không bấm lưu thì tệp gốc vẫn nằm trên Drive, không có dòng tương ứng.

## Hosting trên Vercel (khung bao quanh ứng dụng)

- Vercel không build mã nguồn: `vercel.json` đặt `outputDirectory` là `public`, không có lệnh build. `src/` (mã Apps Script) không được phát tán.
- `public/index.html` mở ứng dụng Apps Script trong một khung toàn màn hình (iframe), nên thanh địa chỉ vẫn là `khoatv-ocr-use.vercel.app` và **không bị chuyển sang `script.google.com`**. Góc phải dưới có nút "Mở tab mới"; nếu khung tải chậm quá 8 giây sẽ hiện nút mở trực tiếp.
- Để Apps Script cho phép nhúng, `doGet` dùng `setXFrameOptionsMode(ALLOWALL)`. Sau khi cập nhật mã phải **tạo version mới** của deployment thì Vercel mới hiển thị được.
- Sau khi deploy Web App, điền URL vào biến `APP_URL` trong `public/index.html` rồi push (ASC-BOT tự cập nhật dòng này); Vercel tự cập nhật.
- Ứng dụng thực sự chạy trên Apps Script (backend dùng `DriveApp`, `SpreadsheetApp`, giao diện dùng `google.script.run`), nên không chạy được nếu chép nguyên `src/index.html` lên Vercel.
- Cấu hình trên Vercel: Application Preset = Other, Root Directory = `./`.
- Lưu ý: vì cho phép nhúng, trang khác cũng có thể nhúng ứng dụng này; ứng dụng vẫn yêu cầu đăng nhập.
