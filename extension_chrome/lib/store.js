// Cài đặt và tài khoản đã lưu, tất cả ở storage.local của extension (không đồng bộ lên tài khoản Chrome).
import { mergeConfig, sanitizeConfig, fetchRemoteConfig, fetchLinkFromIndex, normalizeOrigin } from './appconfig.js';
import { createVault, idbKeyProvider } from './vault.js';

const vault = createVault({ getKey: idbKeyProvider() });
const memo = {};
async function packaged(name) {
  if (memo[name]) return memo[name];
  try { memo[name] = await (await fetch(chrome.runtime.getURL(name))).json(); } catch { memo[name] = {}; }
  return memo[name];
}

/** Mẫu ánh xạ FBO đi kèm extension (presets/fbo-hrm.json). */
export const getPreset = () => packaged('presets/fbo-hrm.json');

/** Cấu hình trung tâm: lấy từ Web Admin (admin nhập 1 lần ở Vercel), lưu đệm để mở panel là dùng ngay. */
export async function refreshRemoteConfig() {
  const shipped = sanitizeConfig(await packaged('config.json'));
  const f = (...a) => fetch(...a);
  // Link bản triển khai: index.html trên GitHub (AutoSynCode tự cập nhật) được ưu tiên; Web Admin (Vercel) cấp địa chỉ FBO và link dự phòng.
  const [remote, link] = await Promise.all([fetchRemoteConfig(shipped.configUrl, f), fetchLinkFromIndex(shipped.linkUrl, f)]);
  const fresh = { ...(remote || {}), ...(link ? { gasUrl: link } : {}) };
  if (!Object.keys(fresh).length) return null;
  const { remoteConfig } = await chrome.storage.local.get({ remoteConfig: {} });
  const merged = { ...remoteConfig, ...fresh };
  await chrome.storage.local.set({ remoteConfig: merged });
  return merged;
}

export async function getSettings() {
  const s = await chrome.storage.local.get({ gasUrl: '', userFboOrigins: [], remoteConfig: {} });
  const cfg = mergeConfig({ shipped: await packaged('config.json'), remote: s.remoteConfig, user: { fboOrigins: s.userFboOrigins } });
  return {
    gasUrl: cfg.gasUrl, gasSource: cfg.source,
    fboOrigins: cfg.fboOrigins, userFboOrigins: s.userFboOrigins,
    fboMappings: await getPreset() // ánh xạ cố định trong source, không cho người dùng sửa
  };
}
export async function setSettings(patch) { await chrome.storage.local.set(patch); }

/* ---------- Phiên đăng nhập OCR (token 6 giờ của GAS) ---------- */
const SESSION_MS = 5.5 * 3600 * 1000;
export async function getAuth() {
  const { auth } = await chrome.storage.local.get('auth');
  return auth && auth.exp > Date.now() ? auth : null;
}
export async function setAuth(auth) {
  if (auth) await chrome.storage.local.set({ auth: { ...auth, exp: Date.now() + SESSION_MS } });
  else await chrome.storage.local.remove('auth');
}

/* ---------- Tài khoản OCR đã nhớ ---------- */
export async function getOcrLogin() { return (await chrome.storage.local.get('ocrLogin')).ocrLogin || null; }
export async function saveOcrLogin(username, password, remember) {
  const rec = { username };
  if (remember && password) rec.passEnc = await vault.encrypt(password);
  await chrome.storage.local.set({ ocrLogin: rec });
}
export async function getOcrPassword() {
  const rec = await getOcrLogin();
  if (!rec || !rec.passEnc) return '';
  try { return await vault.decrypt(rec.passEnc); } catch { return ''; }
}
export async function forgetOcrPassword() {
  const rec = await getOcrLogin();
  if (rec) { delete rec.passEnc; await chrome.storage.local.set({ ocrLogin: rec }); }
}

/* ---------- Đăng nhập FBO đã lưu, theo từng địa chỉ ---------- */
export async function getFboLogins() { return (await chrome.storage.local.get({ fboLogins: {} })).fboLogins; }
export async function saveFboLogin(origin, { company, unit, user, password }) {
  const o = normalizeOrigin(origin);
  if (!o) throw new Error('Địa chỉ FBO không hợp lệ.');
  const all = await getFboLogins();
  const old = all[o] || {};
  all[o] = { company: company || '', unit: unit || '', user: user || '', passEnc: password ? await vault.encrypt(password) : old.passEnc || '' };
  await chrome.storage.local.set({ fboLogins: all });
}
export async function deleteFboLogin(origin) {
  const all = await getFboLogins(); delete all[origin]; await chrome.storage.local.set({ fboLogins: all });
}
export async function getFboProfile(origin) {
  const rec = (await getFboLogins())[origin];
  if (!rec) return null;
  let password = '';
  try { password = rec.passEnc ? await vault.decrypt(rec.passEnc) : ''; } catch { /* khoá mất: nhập lại */ }
  return { company: rec.company, unit: rec.unit, user: rec.user, password };
}
