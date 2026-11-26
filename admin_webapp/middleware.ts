export { default } from 'next-auth/middleware';

// Bảo vệ mọi trang trừ đăng nhập, quên mật khẩu, trang quét /app (có đăng nhập OCR riêng) và các API (API tự kiểm tra phiên và trả 401).
export const config = { matcher: ['/((?!api|login|forgot|app$|app/|_next|favicon.ico).*)'] };
