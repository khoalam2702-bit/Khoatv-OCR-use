import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Cấu hình trung tâm cho Extension: quản trị viên chỉ nhập MỘT lần ở biến môi trường, mọi người dùng extension tự lấy.
 *  - GAS_WEB_APP_URL: địa chỉ Web App Apps Script (đã dùng cho proxy /api/gas)
 *  - EXTENSION_FBO_ORIGINS: (tuỳ chọn) các địa chỉ gốc của FBO, cách nhau bằng dấu phẩy
 * Không chứa bí mật: Web App Apps Script vốn công khai (xác thực bằng token đăng nhập).
 */
export async function GET() {
  const gasUrl = process.env.GAS_WEB_APP_URL || '';
  const fboOrigins = (process.env.EXTENSION_FBO_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return NextResponse.json({ gasUrl, fboOrigins }, {
    headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
  });
}
