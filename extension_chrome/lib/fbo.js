import { getSettings, getFboProfile, getDm } from './store.js';
import { enrichData } from './dm.js';
import { FORM_WAIT_MS, POLL_MS, FILL_TIMEOUT_MS, mappingSelectors, classifyForm, withTimeout, importantOverwrites } from './formcheck.js';

/** Tab FBO cần thao tác: tab đang xem nếu là trang web; nếu đang ở trang của extension (Cài đặt) hay trang trống thì lấy tab web dùng gần nhất. */
async function webTab() {
  const [cur] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (cur && cur.id != null && /^https?:/.test(cur.url || '')) return cur;
  const tab = await pickWebTab();
  if (!tab) throw new Error('Không thấy tab web nào đang mở. Mở trang FBO ở một tab rồi thử lại.');
  return tab;
}

/** Tab đang hiện form đăng nhập FBO (ở bất kỳ frame nào) = chưa đăng nhập. Không thấy form đăng nhập = coi như đã đăng nhập. */
async function needsLogin(tabId) {
  const target = { tabId, allFrames: true };
  await chrome.scripting.executeScript({ target, files: ['content/page.js'] });
  const res = await chrome.scripting.executeScript({ target, func: () => globalThis.__KHOATV_LOGIN_STATE__() });
  return res.some((r) => r.result && r.result.loginPage);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dò (mọi frame) cho tới khi form hiện đủ ô hoặc hết FORM_WAIT_MS. Trả { state, found, total }. */
async function waitForForm(target, mapping, onProgress) {
  const total = mappingSelectors(mapping).length;
  const t0 = Date.now();
  let found = 0, state = 'NO_FORM';
  for (;;) {
    const res = await chrome.scripting.executeScript({ target, func: (m) => globalThis.__KHOATV_PROBE__(m), args: [mapping] });
    const seen = new Set();
    res.forEach((r) => r.result && r.result.found.forEach((x) => seen.add(x))); // mỗi frame chỉ thấy ô của frame đó
    found = seen.size;
    state = classifyForm(found, total);
    const elapsed = Date.now() - t0;
    if (state === 'READY' || elapsed >= FORM_WAIT_MS) break;
    if (onProgress) onProgress({ phase: 'wait', elapsed, limit: FORM_WAIT_MS });
    await sleep(POLL_MS);
  }
  return { state, found, total };
}

/**
 * Điền dữ liệu vào form FBO ở tab đang mở (dùng chung mọi loại tài liệu). Ánh xạ cố định trong presets/fbo-hrm.json.
 * opts: { required: [mã trường bắt buộc], onProgress({phase,...}), confirmOverwrite(list) -> Promise<boolean> }
 * status: FILLED | ERROR | NOT_LOGGED_IN | NO_MAPPING | NO_FORM | WRONG_FORM | CANCELLED
 */
export async function fillActiveTab(docType, data, opts) {
  opts = opts || {};
  const { fboMappings } = await getSettings();
  const mapping = fboMappings && fboMappings[docType];
  const blank = { filled: [], notFound: [], empty: [], total: 0 };
  if (!mapping || !Object.keys(mapping).length) return { ...blank, status: 'NO_MAPPING' };
  const total = Object.keys(mapping).length;
  const tab = await webTab();
  const target = { tabId: tab.id, allFrames: true };
  const progress = (p) => { if (opts.onProgress) opts.onProgress(p); };
  let results;
  try {
    if (await needsLogin(tab.id)) return { ...blank, total, status: 'NOT_LOGGED_IN' };
    await chrome.scripting.executeScript({ target, files: ['content/page.js'] });
    const form = await waitForForm(target, mapping, progress);
    if (form.state !== 'READY') return { ...blank, total, status: form.state, found: form.found, selectors: form.total };

    const run = async () => {
      const enriched = enrichData(docType, data, await getDm());
      const call = (extra) => chrome.scripting.executeScript({ target, func: (m, d, o) => globalThis.__KHOATV_FILL__(m, d, o), args: [mapping, enriched, extra] });
      // 1) tính thử: ô trường bắt buộc đang có giá trị khác thì hỏi trước khi ghi đè
      const dry = await call({ dry: true });
      const over = importantOverwrites(dry.flatMap((r) => (r.result && r.result.overwrite) || []), opts.required);
      if (over.length && opts.confirmOverwrite && !(await opts.confirmOverwrite(over))) return { cancelled: true };
      // 2) điền thật
      progress({ phase: 'fill' });
      return { results: await call(null) };
    };
    const out = await withTimeout(run(), FILL_TIMEOUT_MS, 'Hết thời gian chờ (' + FILL_TIMEOUT_MS / 1000 + ' giây) khi điền form FBO. Kiểm tra tab FBO có đang treo hoặc tải chậm không rồi thử lại.');
    if (out.cancelled) return { ...blank, total, status: 'CANCELLED' };
    results = out.results;
  } catch (e) {
    if (e && /Hết thời gian chờ/.test(e.message)) throw e;
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
  return { status, total, filled: [...filled], notFound: [...notFound], empty: [...empty] };
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

/** Đăng nhập FBO ở tab đang mở. Chỉ đăng nhập khi tab đang hiện form đăng nhập; đã đăng nhập rồi thì bỏ qua (không cần tài khoản đã lưu). */
export async function loginFboActiveTab() {
  const tab = await webTab();
  const origin = new URL(tab.url).origin;
  try {
    if (!(await needsLogin(tab.id))) return { ok: true, skipped: true, submitted: false, notes: [] };
  } catch (e) {
    throw new Error('Không truy cập được tab này. Cấp quyền cho ' + origin + ' (Cài đặt, mục 2). (' + (e && e.message ? e.message : e) + ')');
  }
  const profile = await getFboProfile(origin);
  if (!profile) throw new Error('Chưa lưu tài khoản FBO cho ' + origin + '. Mở Cài đặt, mục "Đăng nhập FBO", để lưu.');
  const target = { tabId: tab.id, allFrames: true };
  let res;
  try {
    res = await chrome.scripting.executeScript({ target, func: (p) => globalThis.__KHOATV_LOGIN__(p), args: [profile] });
  } catch (e) {
    throw new Error('Không đăng nhập được: ' + (e && e.message ? e.message : e));
  }
  const ok = res.map((x) => x.result).find((r) => r && r.ok);
  if (!ok) {
    const bad = res.map((x) => x.result).find((r) => r && r.reason);
    throw new Error((bad && bad.reason) || 'Không đăng nhập được.');
  }
  return ok;
}
