// Cài đặt và tài khoản đã lưu, tất cả ở storage.local của extension (không đồng bộ lên tài khoản Chrome).
import { mergeConfig, sanitizeConfig, fetchRemoteConfig, fetchLinkFromIndex, normalizeOrigin } from './appconfig.js';
import { createVault, idbKeyProvider } from './vault.js';
import { buildDm } from './dm.js';

const vault = createVault({ getKey: idbKeyProvider() });
const memo = {};
async function packaged(name) {
  if (memo[name]) return memo[name];
  try { memo[name] = await (await fetch(chrome.runtime.getURL(name))).json(); } catch { memo[name] = {}; }
  return memo[name];
}

/** Mẫu ánh xạ FBO đi kèm extension (presets/fbo-hrm.json). */
export const getPreset = () => packaged('presets/fbo-hrm.json');

/** Danh mục tỉnh/thành, phường/xã, quốc tịch của FBO đi kèm extension (presets/dm/*.json). */
export async function getDm() {
  const [tinh, xa, quocTich, diaChiCu, chuyenNganh] = await Promise.all([packaged('presets/dm/tinh.json'), packaged('presets/dm/xa.json'), packaged('presets/dm/quoc-tich.json'), packaged('presets/dm/dia-chi-cu.json'), packaged('presets/dm/chuyen-nganh.json')]);
  return buildDm({ tinh: Array.isArray(tinh) ? tinh : [], xa: Array.isArray(xa) ? xa : [], quocTich: Array.isArray(quocTich) ? quocTich : [], diaChiCu, chuyenNganh: Array.isArray(chuyenNganh) ? chuyenNganh : [] });
}

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
export async function saveFboLogin(origin, { user, password }) {
  const o = normalizeOrigin(origin);
  if (!o) throw new Error('Địa chỉ FBO không hợp lệ.');
  const all = await getFboLogins();
  const old = all[o] || {};
  all[o] = { user: user || '', passEnc: password ? await vault.encrypt(password) : old.passEnc || '' };
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
  return { user: rec.user, password };
}

/* ---------- Chế độ không cần tài khoản OCR ----------
 * Mã thiết bị ngẫu nhiên (storage.local) chỉ dùng để máy chủ đếm hạn mức quét theo ngày.
 * Chế độ và bản nháp kết quả nằm ở storage.session: đóng trình duyệt là mất, không gửi lên máy chủ. */
export async function getDeviceId() {
  const { deviceId } = await chrome.storage.local.get('deviceId');
  if (deviceId) return deviceId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: id });
  return id;
}
export async function getAnonMode() { return !!(await chrome.storage.session.get('anonMode')).anonMode; }
export async function setAnonMode(on) {
  if (on) await chrome.storage.session.set({ anonMode: true });
  else await chrome.storage.session.remove(['anonMode', 'anonDraft']);
}
/** Kết quả quét đang làm dở (kể cả đã mở lại panel): quét 1 lần, điền nhiều lần. Chỉ giữ trong phiên trình duyệt (storage.session). */
export async function getScanDraft() { return (await chrome.storage.session.get('scanDraft')).scanDraft || null; }
export async function setScanDraft(draft) {
  try {
    if (draft) await chrome.storage.session.set({ scanDraft: draft });
    else await chrome.storage.session.remove('scanDraft');
  } catch (e) { /* quá hạn mức lưu: bỏ qua, chỉ mất khả năng khôi phục */ }
}
export async function getAnonDraft() { return (await chrome.storage.session.get('anonDraft')).anonDraft || null; }
export async function setAnonDraft(draft) {
  if (draft) await chrome.storage.session.set({ anonDraft: draft });
  else await chrome.storage.session.remove('anonDraft');
}
