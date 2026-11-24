import { getSettings, getFboProfile } from './store.js';

/** Tab FBO cần thao tác: tab đang xem nếu là trang web; nếu đang ở trang của extension (Cài đặt) hay trang trống thì lấy tab web dùng gần nhất. */
async function webTab() {
  const [cur] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (cur && cur.id != null && /^https?:/.test(cur.url || '')) return cur;
  const tab = await pickWebTab();
  if (!tab) throw new Error('Không thấy tab web nào đang mở. Mở trang FBO ở một tab rồi thử lại.');
  return tab;
}

/** Điền dữ liệu vào form FBO ở tab đang mở. Ánh xạ trường do người dùng khai ở trang Cài đặt (chưa có thì báo, không đoán). */
export async function fillActiveTab(docType, data) {
  const { fboMappings } = await getSettings();
  const mapping = fboMappings && fboMappings[docType];
  if (!mapping || !Object.keys(mapping).length) {
    return { status: 'NO_MAPPING', filled: [], notFound: [], empty: [] };
  }
  const tab = await webTab();
  const target = { tabId: tab.id, allFrames: true };
  let results;
  try {
    await chrome.scripting.executeScript({ target, files: ['content/page.js'] });
    results = await chrome.scripting.executeScript({
      target,
      func: (m, d) => globalThis.__KHOATV_FILL__(m, d),
      args: [mapping, data]
    });
  } catch (e) {
    throw new Error('Không truy cập được trang này. Mở form FBO ở tab hiện tại và cấp quyền cho địa chỉ FBO trong Cài đặt. (' + (e && e.message ? e.message : e) + ')');
  }
  const filled = new Set(), notFound = new Set(), empty = new Set();
  for (const r of results) {
    const v = r.result;
    if (!v) continue;
    v.filled.forEach((k) => filled.add(k));
    v.notFound.forEach((k) => notFound.add(k));
    v.empty.forEach((k) => empty.add(k));
  }
  filled.forEach((k) => notFound.delete(k)); // mỗi frame chỉ điền được ô của frame đó
  const status = filled.size > 0 && notFound.size === 0 ? 'FILLED' : 'ERROR';
  return { status, filled: [...filled], notFound: [...notFound], empty: [...empty] };
}

/** Tab web (http/https) vừa dùng gần nhất: trang Cài đặt tự nó là tab đang mở, nên không thể dùng "tab active". */
export async function pickWebTab() {
  const tabs = (await chrome.tabs.query({})).filter((t) => t.id != null && /^https?:/.test(t.url || ''));
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0] || null;
}

/** Dò các ô nhập của tab web vừa dùng (mọi frame) để lập ánh xạ. */
export async function inspectActiveTab() {
  const tab = await pickWebTab();
  if (!tab) throw new Error('Không thấy tab web nào đang mở. Mở form FBO ở một tab rồi thử lại.');
  const target = { tabId: tab.id, allFrames: true };
  try {
    await chrome.scripting.executeScript({ target, files: ['content/page.js'] });
    const res = await chrome.scripting.executeScript({ target, func: () => globalThis.__KHOATV_INSPECT__() });
    return res.map((r) => r.result).filter((r) => r && r.controls.length);
  } catch (e) {
    throw new Error('Không truy cập được tab ' + new URL(tab.url).origin + '. Cấp quyền cho địa chỉ này ở mục 2. (' + (e && e.message ? e.message : e) + ')');
  }
}

/** Đăng nhập FBO ở tab đang mở bằng tài khoản đã lưu cho địa chỉ của tab đó. */
export async function loginFboActiveTab() {
  const tab = await webTab();
  const origin = new URL(tab.url).origin;
  const profile = await getFboProfile(origin);
  if (!profile) throw new Error('Chưa lưu tài khoản FBO cho ' + origin + '. Mở Cài đặt, mục "Đăng nhập FBO", để lưu.');
  const target = { tabId: tab.id };
  let res;
  try {
    await chrome.scripting.executeScript({ target, files: ['content/page.js'] });
    res = await chrome.scripting.executeScript({ target, func: (p) => globalThis.__KHOATV_LOGIN__(p), args: [profile] });
  } catch (e) {
    throw new Error('Không truy cập được tab này. Cấp quyền cho ' + origin + ' (Cài đặt, mục 2). (' + (e && e.message ? e.message : e) + ')');
  }
  const r = res[0] && res[0].result;
  if (!r || !r.ok) throw new Error((r && r.reason) || 'Không đăng nhập được.');
  return r;
}
