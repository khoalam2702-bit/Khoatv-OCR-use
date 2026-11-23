import { getSettings } from './store.js';

/** Điền dữ liệu vào form FBO ở tab đang mở. Ánh xạ trường do người dùng khai ở trang Cài đặt (chưa có thì báo, không đoán). */
export async function fillActiveTab(docType, data) {
  const { fboMappings } = await getSettings();
  const mapping = fboMappings && fboMappings[docType];
  if (!mapping || !Object.keys(mapping).length) {
    return { status: 'NO_MAPPING', filled: [], notFound: [], empty: [] };
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) throw new Error('Không tìm thấy tab đang mở.');
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

/** Dò các ô nhập của tab đang mở (mọi frame) để lập ánh xạ. */
export async function inspectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) throw new Error('Không tìm thấy tab đang mở.');
  const target = { tabId: tab.id, allFrames: true };
  try {
    await chrome.scripting.executeScript({ target, files: ['content/page.js'] });
    const res = await chrome.scripting.executeScript({ target, func: () => globalThis.__KHOATV_INSPECT__() });
    return res.map((r) => r.result).filter((r) => r && r.controls.length);
  } catch (e) {
    throw new Error('Không truy cập được trang này. Cấp quyền cho địa chỉ FBO trong Cài đặt. (' + (e && e.message ? e.message : e) + ')');
  }
}
