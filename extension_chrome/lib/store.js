// Cài đặt (bền) ở storage.local; phiên đăng nhập (token) ở storage.session, tự xoá khi đóng trình duyệt.
export async function getSettings() {
  const s = await chrome.storage.local.get({ gasUrl: '', adminUrl: '', fboMappings: {} });
  return s;
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
