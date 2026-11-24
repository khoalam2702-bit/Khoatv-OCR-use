import { getSettings, getFboProfile, getDm } from './store.js';
import { enrichData } from './dm.js';
import { FORM_WAIT_MS, POLL_MS, STEP_TIMEOUT_MS, STABLE_POLLS, mappingSelectors, classifyForm, withTimeout, importantOverwrites, abortable, FillStopped, mappingVariants, pickVariant, formLabel } from './formcheck.js';

/** Chạy script trong tab NGAY, không chờ khung phụ tải xong (document_idle). Trang FBO có khung phụ không bao giờ tải xong thì lệnh mặc định treo mãi. */
const run = (target, spec) => chrome.scripting.executeScript({ target, injectImmediately: true, ...spec });

/** Tab FBO cần thao tác: tab đang xem nếu là trang web; nếu đang ở trang của extension (Cài đặt) hay trang trống thì lấy tab web dùng gần nhất. */
async function webTab() {
  const [cur] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (cur && cur.id != null && /^https?:/.test(cur.url || '')) return cur;
  const tab = await pickWebTab();
  if (!tab) throw new Error('Không thấy tab web nào đang mở. Mở trang FBO ở một tab rồi thử lại.');
  return tab;
}

/** Tab đang hiện form đăng nhập FBO (ở bất kỳ frame nào) = chưa đăng nhập. Không thấy form đăng nhập = coi như đã đăng nhập. */
async function needsLogin(tabId, target) {
  target = target || { tabId, allFrames: true };
  await run(target, { files: ['content/page.js'] });
  const res = await run(target, { func: () => globalThis.__KHOATV_LOGIN_STATE__() });
  return res.some((r) => r.result && r.result.loginPage);
}

/** Tab đã chọn vẫn còn và vẫn ở cùng trang (bỏ phần #). Khác thì dừng, không điền nhầm. */
async function assertSameTab(info) {
  let t;
  try { t = await chrome.tabs.get(info.id); } catch (e) { throw new Error('Tab FBO đã bị đóng trong lúc điền. Mở lại form FBO rồi bấm Điền vào FBO.'); }
  const base = (u) => String(u || '').split('#')[0];
  if (info.url && t.url && base(t.url) !== base(info.url)) throw new Error('Tab FBO đã chuyển sang trang khác trong lúc điền, đã dừng để tránh điền nhầm. Mở lại form rồi bấm Điền vào FBO.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STEP_MSG = (what) => 'Tab FBO không phản hồi sau ' + STEP_TIMEOUT_MS / 1000 + ' giây khi ' + what + '. Trang có thể đang tải hoặc treo; đợi trang xong rồi bấm lại.';
const step = (p, what, signal) => abortable(withTimeout(p, STEP_TIMEOUT_MS, STEP_MSG(what)), signal);

/**
 * Dò (mọi frame) cho tới khi form hiện đủ ô, hoặc số ô thấy được đã ổn định (không tăng thêm), hoặc hết FORM_WAIT_MS.
 * Số ô ổn định > 0 nghĩa là form đã vẽ xong phần có sẵn; các ô ở tab chưa mở có thể chưa có trong trang, không chờ thêm vô ích.
 */
async function waitForForm(target, variants, onProgress, signal) {
  // Dò một lần cho hợp của mọi biến thể rồi chọn biến thể khớp nhất với form đang mở (nhận diện form)
  const union = {};
  variants.forEach((c) => Object.keys(c.mapping).forEach((k) => { union[c.key + '|' + k] = c.mapping[k]; }));
  const t0 = Date.now();
  let best = null, state = 'NO_FORM', last = -1, stable = 0;
  for (;;) {
    const res = await step(run(target, { func: (m) => globalThis.__KHOATV_PROBE__(m), args: [union] }), 'dò các ô của form', signal);
    const seen = new Set();
    res.forEach((r) => r.result && r.result.found.forEach((x) => seen.add(x))); // mỗi frame chỉ thấy ô của frame đó
    best = pickVariant(variants, [...seen]);
    state = classifyForm(best.found, best.total);
    stable = best.found === last ? stable + 1 : 0; last = best.found;
    const elapsed = Date.now() - t0;
    if (state === 'READY' || elapsed >= FORM_WAIT_MS || (best.found > 0 && stable >= STABLE_POLLS)) break;
    if (onProgress) onProgress({ phase: 'wait', elapsed, limit: FORM_WAIT_MS, found: best.found, total: best.total });
    await abortable(sleep(POLL_MS), signal);
  }
  return { state, found: best.found, total: best.total, variant: best.variant, mapping: best.mapping };
}

/**
 * Điền dữ liệu vào form FBO ở tab đang mở (dùng chung mọi loại tài liệu). Ánh xạ cố định trong presets/fbo-hrm.json.
 * opts: { signal (AbortSignal: nút Dừng), required: [mã trường bắt buộc], onProgress({phase,...}), confirmOverwrite(list) -> Promise<boolean>, confirmPartial({found,total}) -> Promise<boolean> }
 * status: FILLED | ERROR | NOT_LOGGED_IN | NO_MAPPING | NO_FORM | CANCELLED   (+ partial/wrongForm: cờ khi form chỉ khớp một phần)
 * Mỗi bước gọi vào tab có giới hạn STEP_TIMEOUT_MS; thời gian người dùng đọc hộp xác nhận không bị tính.
 */
export async function fillActiveTab(docType, data, opts) {
  opts = opts || {};
  const { fboMappings } = await getSettings();
  const variants = mappingVariants(fboMappings, docType);
  let mapping = variants.length ? variants[0].mapping : null;
  const blank = { filled: [], notFound: [], empty: [], total: 0 };
  if (!mapping || !Object.keys(mapping).length) return { ...blank, status: 'NO_MAPPING' };
  let total = Object.keys(mapping).length;
  const progress = (p) => { if (opts.onProgress) opts.onProgress(p); };
  const tab = await webTab();
  let target = { tabId: tab.id, allFrames: true };
  let mainOnly = false;
  const tabInfo = { id: tab.id, title: tab.title || tab.url || '', url: tab.url || '' };
  progress({ phase: 'tab', title: tabInfo.title });
  // Khoá vào đúng tab đã chọn lúc bấm: chuyển sang tab khác không làm điền nhầm sang tab đó; đóng tab hoặc chuyển trang thì dừng.
  const sig = opts.signal;
  const guard = async () => { if (sig && sig.aborted) throw new FillStopped(); await assertSameTab(tabInfo); };
  let results, form;
  try {
    progress({ phase: 'login' });
    await guard();
    // Khung phụ treo làm lệnh vào mọi khung quá hạn: thử lại một lần chỉ với khung chính (form FBO nằm ở khung chính)
    const frames = async (fn, what) => {
      try { return await step(fn(target), what, sig); }
      catch (e) {
        if (mainOnly || !/Tab FBO không phản hồi/.test(e.message)) throw e;
        mainOnly = true; target = { tabId: tab.id };
        return await step(fn(target), what, sig);
      }
    };
    // Kiểm tra đăng nhập chỉ là bước phụ (không bấm gì): không kiểm tra được thì coi như đã đăng nhập, bước dò form sẽ báo nếu không thấy form
    let loginPage = false;
    try { loginPage = await frames((t) => needsLogin(tab.id, t), 'kiểm tra đăng nhập'); }
    catch (e) { if (e instanceof FillStopped || !/Tab FBO không phản hồi/.test(e.message)) throw e; }
    if (loginPage) return { ...blank, total, status: 'NOT_LOGGED_IN' };
    await frames((t) => run(t, { files: ['content/page.js'] }), 'nạp công cụ điền');
    form = await waitForForm(target, variants, progress, sig);
    mapping = form.mapping; // ánh xạ của form đã nhận diện
    total = Object.keys(mapping).length;
    progress({ phase: 'form', variant: form.variant, label: variants.length > 1 ? formLabel(form.variant) : '' });
    if (form.state === 'NO_FORM') return { ...blank, total, status: 'NO_FORM', found: form.found, selectors: form.total };
    const partial = form.state !== 'READY'; // thấy một phần ô: có thể là form khác loại, hoặc tab chưa mở nên chưa có ô
    if (partial && opts.confirmPartial && !(await opts.confirmPartial({ found: form.found, total: form.total }))) {
      return { ...blank, total, status: 'CANCELLED', found: form.found, selectors: form.total, wrongForm: true };
    }
    await guard();
    const enriched = enrichData(docType, data, await getDm());
    const call = (extra, what, abortSig) => step(run(target, { func: (m, d, o) => globalThis.__KHOATV_FILL__(m, d, o), args: [mapping, enriched, extra] }), what, abortSig);
    // 1) tính thử: ô trường bắt buộc đang có giá trị khác thì hỏi trước khi ghi đè
    progress({ phase: 'check' });
    const dry = await call({ dry: true }, 'kiểm tra dữ liệu có sẵn trên form', sig);
    const over = importantOverwrites(dry.flatMap((r) => (r.result && r.result.overwrite) || []), opts.required);
    if (over.length && opts.confirmOverwrite && !(await opts.confirmOverwrite(over))) return { ...blank, total, status: 'CANCELLED', found: form.found, selectors: form.total };
    // 2) điền thật
    await guard(); // người dùng có thể đã chuyển trang trong lúc đọc hộp xác nhận
    progress({ phase: 'fill' });
    results = await call(null, 'điền form'); // lệnh điền thật chạy tức thì trong trang, không hủy giữa chừng
  } catch (e) {
    if (e instanceof FillStopped || (e && /Tab FBO không phản hồi|Tab FBO đã/.test(e.message))) throw e;
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
  // Người dùng đang xem tab khác lúc điền xong: kết quả vẫn ở tab cũ, báo rõ để không tưởng đã điền vào tab đang xem
  let away = false;
  try { const [cur] = await chrome.tabs.query({ active: true, currentWindow: true }); away = !!cur && cur.id !== tabInfo.id; } catch (e) { away = false; }
  return { status, total, filled: [...filled], notFound: [...notFound], empty: [...empty], found: form.found, selectors: form.total, tabTitle: tabInfo.title, away, mainOnly, formName: variants.length > 1 ? formLabel(form.variant) : '' };
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
    await run(target, { files: ['content/page.js'] });
    const res = await run(target, { func: () => globalThis.__KHOATV_INSPECT__() });
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
    res = await run(target, { func: (p) => globalThis.__KHOATV_LOGIN__(p), args: [profile] });
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
