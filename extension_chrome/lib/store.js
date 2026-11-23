// Cài đặt (bền) ở storage.local; phiên đăng nhập (token) ở storage.session, tự xoá khi đóng trình duyệt.
import { effectiveMappings } from './mapping.js';

/** Mẫu ánh xạ FBO đi kèm extension (presets/fbo-hrm.json). */
export async function getPreset() {
  try { return await (await fetch(chrome.runtime.getURL('presets/fbo-hrm.json'))).json(); } catch { return {}; }
}

/** fboMappings trả về là ánh xạ hiệu lực (mẫu đi kèm + phần người dùng tự sửa), nên cài xong là dùng được ngay. */
export async function getSettings() {
  const s = await chrome.storage.local.get({ gasUrl: '', adminUrl: '', fboMappingsUser: {} });
  const preset = await getPreset();
  return { gasUrl: s.gasUrl, adminUrl: s.adminUrl, fboMappingsUser: s.fboMappingsUser, fboMappings: effectiveMappings(preset, s.fboMappingsUser) };
}
export async function setSettings(patch) { await chrome.storage.local.set(patch); }

export async function getAuth() {
  const { auth } = await chrome.storage.session.get('auth');
  return auth || null;
}
export async function setAuth(auth) {
  if (auth) await chrome.storage.session.set({ auth });
  else await chrome.storage.session.remove('auth');
}
