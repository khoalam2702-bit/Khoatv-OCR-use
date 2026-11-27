/**
 * Địa chỉ Web App Apps Script (chỉ chạy phía server). Cùng nguồn với Extension: dòng `var APP_URL = '...'`
 * trong public/index.html trên nhánh main (AutoSynCode tự cập nhật). Không đọc được thì dùng bản đã đọc gần nhất,
 * rồi mới đến biến GAS_WEB_APP_URL.
 * Lưu ý bảo mật: mật khẩu đăng nhập được gửi tới địa chỉ này, nên chỉ nhận đúng dạng script.google.com/.../exec
 * và ai ghi được vào nhánh main của repo là đổi được nơi nhận.
 */
const LINK_URL = 'https://raw.githubusercontent.com/khoalam2702-bit/Khoatv-OCR-use/main/public/index.html';
const GAS_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const TTL_MS = 60_000;

let cached = '';
let checkedAt = 0;

export async function getGasUrl(): Promise<string> {
  if (!checkedAt || Date.now() - checkedAt > TTL_MS) {
    try {
      const res = await fetch(LINK_URL, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      const m = res.ok ? /APP_URL\s*=\s*['"]([^'"]+)['"]/.exec(await res.text()) : null;
      if (m && GAS_RE.test(m[1])) cached = m[1];
    } catch { /* giữ bản đã đọc, hoặc dùng biến môi trường */ }
    checkedAt = Date.now();
  }
  return cached || (process.env.GAS_WEB_APP_URL || '').trim();
}
