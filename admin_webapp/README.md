# Web Admin OCR (Next.js)

Đối soát bản ghi OCR, sửa / xoá, xem lại ảnh gốc, xuất Excel, quản lý tài khoản và phân quyền. Chạy độc lập với Apps Script nên chia sẻ cho nhiều người dùng qua một địa chỉ riêng.

## Kiến trúc
- **Đăng nhập:** NextAuth (Credentials) gọi `login` của Apps Script, dùng chính tài khoản trong file `OCR_USERS` (ADMIN tạo ở tab Tài khoản). Token phiên của Apps Script nằm trong cookie JWT đã mã hoá, **không** gửi xuống trình duyệt dưới dạng đọc được. Phiên 6 giờ, bằng thời hạn phiên Apps Script.
- **Dữ liệu:** trình duyệt gọi `/api/gas`; server thêm token rồi gọi cổng `doPost` của Apps Script (`GAS_WEB_APP_URL` chỉ nằm ở server). Mọi thao tác ghi đều do Apps Script thực hiện, nên luật chống trùng, phân quyền, khoá và nhật ký không bị nhân đôi.
- **Phân quyền:** Apps Script kiểm tra lại quyền ở mỗi lần gọi; giao diện chỉ ẩn / hiện nút theo quyền.
- **Service Account (Tier 2):** chưa cần. Chỉ thêm khi muốn Next.js đọc thẳng Google Sheets để thống kê cả năm.

## Chức năng
- **Bản ghi:** lọc theo loại tài liệu, khoảng ngày, trạng thái đồng bộ FBO, lọc chữ không dấu; mở bản ghi để xem ảnh / PDF gốc, sửa, xoá, đổi `fbo_sync_status`; xuất Excel (kèm sheet chi tiết hàng).
- **Tài khoản (ADMIN):** tạo, sửa, khoá, tick quyền, cấp mật khẩu tạm, xoá.
- **Mật khẩu:** đổi mật khẩu, quên mật khẩu qua mã 6 số gửi email (dùng lại chức năng của Apps Script).
- Chưa có màn **quét**: việc quét làm ở giao diện GAS hiện tại và ở Extension (Phase 2).

## Chạy thử
```bash
cd admin_webapp
cp .env.example .env.local     # điền GAS_WEB_APP_URL, NEXTAUTH_SECRET
npm install
npm run dev                    # http://localhost:3000
```
Điều kiện: đã deploy Apps Script bản có `doPost` (Web App, "Execute as: Me", "Who has access: Anyone").

## Triển khai trên Vercel
1. Import repo vào **một project Vercel mới**, đặt **Root Directory = `admin_webapp`** (project Vercel cũ bọc giao diện GAS vẫn giữ nguyên).
2. Environment Variables: `GAS_WEB_APP_URL`, `NEXTAUTH_URL` (địa chỉ công khai của project), `NEXTAUTH_SECRET` (`openssl rand -base64 32`).

## Giới hạn
- Vercel giới hạn thân phản hồi của hàm khoảng 4,5 MB: xem lại tệp gốc lớn hơn (thường là PDF dài) có thể lỗi; khi đó mở trực tiếp trên Drive.
- Apps Script tối đa 6 phút mỗi lượt và dữ liệu chia theo tháng, nên mỗi lần xem tối đa 24 tháng / 3000 bản ghi.
- Đổi mật khẩu xong phải đăng nhập lại (Apps Script huỷ phiên cũ).
