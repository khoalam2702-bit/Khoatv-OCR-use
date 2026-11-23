import { GAS_URL_RE } from './config.js';

/** "https://a.b/c?d" -> "https://a.b"; không hợp lệ thì ''. */
export function normalizeOrigin(s) {
  try {
    const u = new URL(String(s).trim());
    return /^https?:$/.test(u.protocol) ? u.origin : '';
  } catch { return ''; }
}

/** Chỉ giữ các trường hợp lệ, bỏ mọi thứ khác (cấu hình từ xa là dữ liệu không tin cậy). */
export function sanitizeConfig(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.gasUrl === 'string' && GAS_URL_RE.test(raw.gasUrl.trim())) out.gasUrl = raw.gasUrl.trim();
  if (Array.isArray(raw.fboOrigins)) {
    const o = [...new Set(raw.fboOrigins.map(normalizeOrigin).filter(Boolean))];
    if (o.length) out.fboOrigins = o;
  }
  if (typeof raw.configUrl === 'string' && /^https:\/\//.test(raw.configUrl)) out.configUrl = raw.configUrl;
  if (typeof raw.linkUrl === 'string' && /^https:\/\//.test(raw.linkUrl)) out.linkUrl = raw.linkUrl;
  return out;
}

/** Thứ tự ưu tiên link Apps Script: người dùng tự nhập > Web Admin (từ xa) > đóng gói sẵn. Địa chỉ FBO: gộp. */
export function mergeConfig({ shipped, remote, user }) {
  shipped = sanitizeConfig(shipped); remote = sanitizeConfig(remote); user = sanitizeConfig(user);
  const gasUrl = user.gasUrl || remote.gasUrl || shipped.gasUrl || '';
  const source = user.gasUrl ? 'user' : remote.gasUrl ? 'remote' : shipped.gasUrl ? 'shipped' : 'none';
  const fboOrigins = [...new Set([...(remote.fboOrigins || shipped.fboOrigins || []), ...(user.fboOrigins || [])])];
  return { gasUrl, source, fboOrigins, configUrl: shipped.configUrl || '' };
}

/** Tải cấu hình trung tâm từ Web Admin. Lỗi hoặc dữ liệu không hợp lệ thì trả null (giữ bản cũ). */
export async function fetchRemoteConfig(url, fetchImpl, timeoutMs = 4000) {
  if (!url) return null;
  try {
    const res = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const c = sanitizeConfig(await res.json());
    return c.gasUrl || c.fboOrigins ? c : null;
  } catch { return null; }
}

/** Lấy link Web App từ dòng `var APP_URL = '...'` trong index.html (tệp AutoSynCode tự cập nhật trên GitHub). Không thấy thì ''. */
export function parseAppUrl(html) {
  const m = /APP_URL\s*=\s*['"](https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec)['"]/.exec(String(html || ''));
  return m ? m[1] : '';
}

/** Tải index.html chứa link bản triển khai. Lỗi hoặc không có link hợp lệ thì trả '' (giữ bản cũ). */
export async function fetchLinkFromIndex(url, fetchImpl, timeoutMs = 4000) {
  if (!url) return '';
  try {
    const res = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return '';
    return parseAppUrl(await res.text());
  } catch { return ''; }
}
