import { ENABLED_TYPES, DEFAULT_LIMITS } from './lib/config.js';
import { createGasClient, GasError } from './lib/gas.js';
import { getSettings, getAuth, setAuth, refreshRemoteConfig, getOcrLogin, saveOcrLogin, getOcrPassword, forgetOcrPassword, getDeviceId, getAnonMode, setAnonMode, getAnonDraft, setAnonDraft, getScanDraft, setScanDraft } from './lib/store.js';
import { prepareFile, shrinkBase64 } from './lib/image.js';
import { toFormValues, fromFormValues, missingRequired } from './lib/format.js';
import { DERIVED_LABELS } from './lib/dm.js';
import { normalizeJobs, jobFields } from './lib/jobs.js';
import { readCccdQr, mergeQr } from './lib/qr.js';
import { extractPhoto, PHOTO_FORMS } from './lib/photo.js';
import { fillActiveTab, loginFboActiveTab, inspectFormTab } from './lib/fbo.js';
import { formatInspect, countControls } from './lib/inspectfmt.js';
import { hasMapping } from './lib/mapping.js';
import { splitRetry, formatWait } from './lib/quota.js';
import { FORM_WAIT_MS, FillStopped } from './lib/formcheck.js';
import { pushDuration, expectedMs, estimatePercent, stageText } from './lib/scanprogress.js';

const $ = (id) => document.getElementById(id);
const call = createGasClient({ getUrl: async () => (await getSettings()).gasUrl });

const state = { auth: null, anon: false, config: null, type: null, files: [], scan: null, saved: null, photo: null, jobs: [], jobDone: [] };

/* ---------- Giao diện chung ---------- */
function show(view) {
  for (const v of ['login', 'scan', 'review']) $('view-' + v).hidden = v !== view;
  $('btn-logout').hidden = view === 'login';
}
function msg(text, kind) {
  const el = $('msg');
  text = splitRetry(text).text; // không bao giờ hiện dấu hiệu chờ thô
  el.hidden = !text; el.textContent = text || ''; el.className = 'msg' + (kind === 'info' ? ' info' : '');
}
function busy(btn, on, label) {
  if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Đang xử lý...'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; }
}

/** Đăng nhập lại bằng mật khẩu đã nhớ (nếu có). Trả true nếu thành công. */
async function tryAutoLogin() {
  const rec = await getOcrLogin();
  const pass = rec && rec.passEnc ? await getOcrPassword() : '';
  if (!rec || !pass) return false;
  try {
    const r = await call('login', [rec.username, pass]);
    state.auth = { token: r.token, me: r.me }; await setAuth(state.auth);
    return true;
  } catch { return false; }
}

/** Gọi API có token; hết phiên thì tự đăng nhập lại bằng mật khẩu đã nhớ rồi gọi lại một lần, không được thì về màn đăng nhập. */
async function api(action, args, retried) {
  try { return await call(action, [state.auth.token, ...args]); }
  catch (e) {
    if (e instanceof GasError && e.code === 'SESSION_EXPIRED') {
      if (!retried && await tryAutoLogin()) return api(action, args, true);
      await logout('Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.', true);
      throw new Error('Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.');
    }
    if (e instanceof GasError && e.code === 'MUST_CHANGE_PASSWORD') {
      throw new Error('Tài khoản phải đổi mật khẩu mặc định. Đăng nhập Web Admin để đổi mật khẩu, rồi đăng nhập lại ở đây.');
    }
    throw e;
  }
}

/** keepPassword: hết phiên thì giữ mật khẩu đã nhớ; người dùng bấm Đăng xuất thì xoá mật khẩu đã nhớ (giữ tên đăng nhập). */
async function logout(message, keepPassword) {
  try { if (state.auth) await call('logout', [state.auth.token]); } catch { /* bỏ qua */ }
  state.auth = null; await setAuth(null);
  $('btn-inspect').hidden = true; $('inspect-box').hidden = true;
  if (!keepPassword) await forgetOcrPassword();
  $('who').textContent = ''; $('btn-fbo-login').hidden = true;
  await showLogin(message);
}

async function showLogin(message) {
  const rec = await getOcrLogin();
  if (rec && rec.username && !$('in-user').value) $('in-user').value = rec.username;
  $('in-remember').checked = true;
  show('login'); msg(message || '', message ? 'info' : undefined);
  await renderAnonOption();
}

/** Nút "Dùng không cần tài khoản": chỉ hiện khi máy chủ còn bật chế độ này (hạn mức > 0). */
async function renderAnonOption() {
  const btn = $('btn-anon'), hint = $('anon-hint');
  btn.hidden = true; hint.hidden = true;
  try { await loadConfig(); } catch { return; }
  const n = state.config.limits.anonPerDay;
  if (!(n > 0)) return;
  btn.hidden = false; hint.hidden = false;
  hint.textContent = 'Không cần tài khoản: quét tối đa ' + n + ' lần mỗi ngày trên thiết bị này, kết quả không lưu lên hệ thống (đóng trình duyệt là mất), chỉ dùng để điền form FBO.';
}

/** Vào chế độ không cần tài khoản: không có phiên đăng nhập, không lưu lên Web Admin. */
async function enterAnon() {
  state.anon = true; state.auth = null;
  await setAnonMode(true);
  $('who').textContent = 'Không tài khoản (không lưu)';
  $('btn-inspect').hidden = true; $('btn-fbo-login').hidden = false;
  $('btn-logout').textContent = 'Đăng nhập';
  await loadConfig();
  checkFboPermission();
  resetScan();
  show('scan');
}
async function exitAnon() {
  state.anon = false; await setAnonMode(false);
  $('btn-logout').textContent = 'Đăng xuất'; $('who').textContent = ''; $('btn-fbo-login').hidden = true;
  state.scan = null; state.saved = null;
  await showLogin('');
}

/* ---------- Đăng nhập ---------- */
async function doLogin() {
  msg('');
  const btn = $('btn-login');
  busy(btn, true, 'Đang đăng nhập...');
  try {
    const username = $('in-user').value.trim().toLowerCase(), password = $('in-pass').value;
    const r = await call('login', [username, password]);
    state.auth = { token: r.token, me: r.me };
    await setAuth(state.auth);
    // Nhớ tên đăng nhập; chỉ lưu mật khẩu khi người dùng tích ghi nhớ và tài khoản không phải đổi mật khẩu mặc định
    await saveOcrLogin(username, password, $('in-remember').checked && !r.me.must_change);
    $('in-pass').value = '';
    await enter();
  } catch (e) { msg(e.message); }
  finally { busy(btn, false); }
}

async function loadConfig() {
  if (state.config) return;
  const cfg = await call('getAppConfig', []);
  const byCode = new Map(cfg.types.map((t) => [t.code, t]));
  state.config = {
    types: ENABLED_TYPES.map((c) => byCode.get(c)).filter(Boolean),
    limits: { maxFileBytes: cfg.maxFileBytes || DEFAULT_LIMITS.maxFileBytes, maxTotalBytes: cfg.maxTotalBytes || DEFAULT_LIMITS.maxTotalBytes, maxFiles: cfg.maxFiles || DEFAULT_LIMITS.maxFiles, scanPer10Min: cfg.scanPer10Min || DEFAULT_LIMITS.scanPer10Min, anonPerDay: Number(cfg.anonPerDay) || 0, sessionHours: cfg.sessionHours || DEFAULT_LIMITS.sessionHours }
  };
}

async function enter() {
  state.anon = false; await setAnonMode(false); $('btn-logout').textContent = 'Đăng xuất';
  $('who').textContent = state.auth.me.name + ' (' + state.auth.me.username + ')';
  $('btn-inspect').hidden = state.auth.me.role !== 'ADMIN'; // "Dò form" chỉ dành cho quản trị viên (người lập ánh xạ)
  $('btn-fbo-login').hidden = false;
  await loadConfig();
  checkFboPermission();
  resetScan();
  show('scan');
}

/* ---------- Bước 1-2: chọn loại, thêm tệp ---------- */
function renderTypes() {
  const box = $('types'); box.textContent = '';
  for (const t of state.config.types) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = t.label; b.className = state.type === t.code ? 'on' : '';
    b.onclick = () => { state.type = t.code; renderTypes(); updateScanBtn(); };
    box.appendChild(b);
  }
}

function renderFiles() {
  const ul = $('files'); ul.textContent = '';
  state.files.forEach((f, i) => {
    const li = document.createElement('li');
    if (f.mimeType.startsWith('image/')) { const img = document.createElement('img'); img.src = 'data:' + f.mimeType + ';base64,' + f.base64; li.appendChild(img); }
    const n = document.createElement('span'); n.className = 'name'; n.textContent = f.name + ' (' + Math.round(f.bytes / 1024) + ' KB)';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'link'; x.textContent = 'Xoá';
    x.onclick = () => { state.files.splice(i, 1); renderFiles(); updateScanBtn(); };
    li.append(n, x); ul.appendChild(li);
  });
}

/* ---------- Hết hạn mức Gemini: cảnh báo + đếm ngược, tự ẩn khi hết giờ chờ ---------- */
const QUOTA_KEY = 'ocrQuotaUntil2'; // đổi tên khoá nhớ: bỏ các bộ đếm cũ do backend một khoá tạo ra
const QUOTA_KEY_OLD = 'ocrQuotaUntil';
let quotaUntil = 0, quotaTimer = null;
function hhmm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function renderQuota() {
  const bar = $('quota-bar');
  const left = Math.ceil((quotaUntil - Date.now()) / 1000);
  if (left <= 0) {
    clearInterval(quotaTimer); quotaTimer = null; quotaUntil = 0;
    try { localStorage.removeItem(QUOTA_KEY); } catch (e) { /* bỏ qua */ }
    bar.hidden = true; bar.textContent = ''; delete bar.dataset.built; updateScanBtn(); return; // hết giờ chờ: ẩn thông báo, mở lại nút Quét
  }
  // Dựng khung một lần; mỗi giây chỉ cập nhật số đếm để nút "Ẩn thông báo" không bị vẽ lại giữa lúc bấm.
  if (!bar.dataset.built) {
    bar.textContent = '';
    const t = document.createElement('div'); t.textContent = '⚠ Các khóa AI (Gemini) đang tạm hết hạn mức. Hệ thống tự dùng khóa dự phòng; bạn vẫn có thể bấm Quét để thử lại.';
    const c = document.createElement('div'); c.append('Nếu vẫn báo lỗi, dự kiến dùng lại được sau: ');
    const b = document.createElement('b'); b.id = 'quota-left';
    const when = document.createElement('span'); when.id = 'quota-when'; c.append(b, when);
    const x = document.createElement('button'); x.type = 'button'; x.className = 'link'; x.textContent = 'Ẩn thông báo';
    x.onclick = clearQuotaWait;
    bar.append(t, c, x); bar.dataset.built = '1';
  }
  $('quota-left').textContent = formatWait(left);
  $('quota-when').textContent = ' (khoảng ' + hhmm(quotaUntil) + ' ' + (new Date(quotaUntil).toDateString() === new Date().toDateString() ? 'hôm nay' : 'ngày mai') + ').';
  bar.hidden = false;
}
function startQuotaWait(seconds) {
  quotaUntil = Date.now() + Math.max(1, seconds) * 1000;
  try { localStorage.setItem(QUOTA_KEY, String(quotaUntil)); } catch (e) { /* bỏ qua */ }
  clearInterval(quotaTimer); quotaTimer = setInterval(renderQuota, 1000);
  renderQuota(); updateScanBtn();
}
/** Quét AI thành công: xoá thông báo hết hạn mức còn sót lại (kể cả bản nhớ từ lần trước). */
function clearQuotaWait() {
  clearInterval(quotaTimer); quotaTimer = null; quotaUntil = 0;
  try { localStorage.removeItem(QUOTA_KEY); } catch (e) { /* bỏ qua */ }
  const bar = $('quota-bar'); bar.hidden = true; bar.textContent = ''; delete bar.dataset.built;
}
function restoreQuotaWait() {
  try { localStorage.removeItem(QUOTA_KEY_OLD); } catch (e) { /* bỏ qua */ }
  let v = 0; try { v = Number(localStorage.getItem(QUOTA_KEY)) || 0; } catch (e) { v = 0; }
  if (v > Date.now()) { quotaUntil = v; clearInterval(quotaTimer); quotaTimer = setInterval(renderQuota, 1000); renderQuota(); }
}

function updateScanBtn() {
  // Bộ đếm hạn mức chỉ là thông báo: không khoá nút Quét, vì máy chủ tự thử lần lượt các khoá dự phòng và báo lại thời gian chờ chính xác.
  $('btn-scan').disabled = !(state.type && state.files.length);
  $('row-qronly').hidden = state.type !== 'CCCD';
  $('row-relation').hidden = state.type !== 'KHAI_SINH';
}

async function addFiles(list) {
  msg('');
  const { maxFiles, maxFileBytes, maxTotalBytes } = state.config.limits;
  for (const file of Array.from(list)) {
    if (state.files.length >= maxFiles) { msg('Tối đa ' + maxFiles + ' tệp cho một tài liệu.'); break; }
    try {
      const p = await prepareFile(file);
      if (p.bytes > maxFileBytes) throw new Error('Tệp "' + file.name + '" quá lớn (tối đa ' + Math.round(maxFileBytes / 1048576) + ' MB).');
      const total = state.files.reduce((s, f) => s + f.bytes, 0) + p.bytes;
      if (total > maxTotalBytes) throw new Error('Tổng dung lượng quá lớn (tối đa ' + Math.round(maxTotalBytes / 1048576) + ' MB).');
      state.files.push(p);
    } catch (e) { msg(e.message); }
  }
  renderFiles(); updateScanBtn();
}

const LIMIT_OPEN_KEY = 'ocrLimitOpen';
/** Ghi chú giới hạn dưới khu chọn tệp: tệp, dung lượng, số lần quét, thời gian, hạn mức AI. */
function renderLimits() {
  const L = state.config.limits, mb = (b) => Math.round(b / 1048576);
  const items = [
    'Tối đa ' + L.maxFiles + ' tệp mỗi tài liệu (ví dụ CCCD 2 mặt = 2 ảnh).',
    'Dung lượng: mỗi tệp tối đa ' + mb(L.maxFileBytes) + ' MB, tổng các tệp tối đa ' + mb(L.maxTotalBytes) + ' MB. Chỉ nhận JPG, PNG, WEBP, PDF; ảnh tự nén JPG, cạnh dài tối đa 2400 px.',
    state.anon ? 'Không cần tài khoản: tối đa ' + L.anonPerDay + ' lần quét mỗi ngày trên thiết bị này, kết quả không lưu lên hệ thống. Đăng nhập tài khoản OCR để lưu và không giới hạn theo ngày. PDF dài nên tách 5-10 trang mỗi lượt.'
      : 'Số lần quét: tối đa ' + L.scanPer10Min + ' lần mỗi 10 phút cho mỗi tài khoản. PDF dài nên tách 5-10 trang mỗi lượt.',
    'Mỗi lần quét xử lý tối đa khoảng 6 phút; quá thời gian sẽ báo lỗi, hãy quét lại với ít trang hơn.',
    state.anon ? 'Kết quả chỉ giữ trong phiên trình duyệt này; đóng trình duyệt là mất.' : 'Phiên đăng nhập kéo dài ' + L.sessionHours + ' giờ.',
    'Hạn mức AI (Gemini) tính theo khóa API, theo phút và theo ngày do Google quy định. Chạm hạn mức sẽ hiện đồng hồ đếm ngược; hạn mức ngày đặt lại lúc 0 giờ giờ Thái Bình Dương (khoảng 14-15 giờ giờ Việt Nam).'
  ];
  const box = $('limit-hint');
  box.textContent = '';
  // Thu gọn/mở rộng bằng <details>; trạng thái nhớ lại ở lần mở sau (mặc định thu gọn cho gọn màn hình).
  const det = document.createElement('details');
  det.className = 'limits-box';
  try { det.open = localStorage.getItem(LIMIT_OPEN_KEY) === '1'; } catch (e) { det.open = false; }
  const sum = document.createElement('summary');
  sum.textContent = 'Giới hạn và lưu ý khi quét';
  det.appendChild(sum);
  const ul = document.createElement('ul');
  ul.className = 'limits';
  for (const t of items) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
  det.appendChild(ul);
  det.addEventListener('toggle', () => { try { localStorage.setItem(LIMIT_OPEN_KEY, det.open ? '1' : '0'); } catch (e) { /* bỏ qua */ } });
  box.appendChild(det);
}

function resetScan() {
  state.files = []; state.scan = null; state.saved = null; setPhoto(null); setJobs([]); setScanDraft(null);
  renderTypes(); renderFiles(); updateScanBtn();
  renderLimits();
}

/* ---------- Quét ---------- */
// Tiến trình quét: % là ước lượng theo thời gian các lần quét trước (máy chủ chỉ trả kết quả một lần khi xong).
const SCAN_HIST_KEY = 'ocrScanMs';
const scanHist = () => { try { return JSON.parse(localStorage.getItem(SCAN_HIST_KEY) || '[]'); } catch (e) { return []; } };
const scanProg = { timer: null, t0: 0, stage: 'ai', expected: 0, n: 0, btn: null };
function tickScan() {
  const el = Date.now() - scanProg.t0;
  $('scan-progress').value = estimatePercent(el, scanProg.expected);
  const txt = stageText(scanProg.stage, el, scanProg.expected, scanProg.n);
  $('scan-info').textContent = txt;
  if (scanProg.btn) scanProg.btn.textContent = 'Đang quét... ' + Math.floor(el / 1000) + ' giây';
}
function startScanProgress(btn, n, stage) {
  scanProg.t0 = Date.now(); scanProg.stage = stage; scanProg.n = n; scanProg.btn = btn;
  scanProg.expected = stage === 'qr' ? 3000 : expectedMs(scanHist());
  $('scan-progress').hidden = false; $('scan-info').hidden = false;
  clearInterval(scanProg.timer); scanProg.timer = setInterval(tickScan, 250); tickScan();
}
function setScanStage(stage) {
  if (scanProg.stage === stage) return;
  scanProg.stage = stage;
  if (stage === 'save') scanProg.expected = 4000; // chỉ lưu ảnh lên Drive
  else if (stage === 'ai') { scanProg.t0 = Date.now(); scanProg.expected = expectedMs(scanHist()); } // bắt đầu đếm lại cho bước gọi AI
  tickScan();
}
function stopScanProgress(success, detail) {
  clearInterval(scanProg.timer); scanProg.timer = null; scanProg.btn = null;
  const bar = $('scan-progress'), info = $('scan-info');
  if (success) {
    const total = Date.now() - scanProg.t0;
    if (scanProg.stage === 'ai') { try { localStorage.setItem(SCAN_HIST_KEY, JSON.stringify(pushDuration(scanHist(), total))); } catch (e) { /* bỏ qua */ } }
    bar.value = 100; info.textContent = 'Quét xong sau ' + (total / 1000).toFixed(1) + ' giây.' + (detail ? ' ' + detail : '');
    setTimeout(() => { if (!scanProg.timer) { bar.hidden = true; info.hidden = true; } }, detail ? 6000 : 1500);
  } else { bar.hidden = true; info.hidden = true; }
}

async function doScan() {
  msg('');
  const btn = $('btn-scan');
  busy(btn, true, 'Đang quét...');
  try {
    // CCCD: đọc mã QR; dữ liệu QR (số CCCD, họ tên đủ dấu, ngày sinh, giới tính, thường trú, ngày cấp) ghi đè kết quả OCR.
    // Chế độ "chỉ QR": QR hợp lệ thì không gọi AI (nhanh); QR không đọc được thì tự quay về OCR như thường.
    // Biển số: chữ rất to, thu ảnh về 1280px cho gửi nhanh hơn (không đổi ảnh gốc đang hiển thị)
    const toSend = state.type === 'BIEN_SO_XE' ? await Promise.all(state.files.map((f) => shrinkBase64(f, 1280))) : state.files;
    const files = toSend.map((f) => ({ mimeType: f.mimeType, base64: f.base64 }));
    const qrFirst = state.type === 'CCCD' && $('in-qronly').checked;
    startScanProgress(btn, files.length, qrFirst ? 'qr' : 'ai');
    let qr = null, qrTask = Promise.resolve(null);
    if (qrFirst) {
      qr = await readCccdQr(state.files).catch(() => null);
    } else if (state.type === 'CCCD') {
      qrTask = readCccdQr(state.files).catch(() => null);
    }
    const skipAiUsed = !!qr; // chỉ true ở chế độ chỉ QR khi QR hợp lệ: backend không gọi AI
    if (qrFirst) setScanStage(skipAiUsed ? 'save' : 'ai');
    const [r, qr2] = await Promise.all([
      state.anon
        ? call('scanAnonymous', [await getDeviceId(), { docType: state.type, files, skipAi: skipAiUsed }])
        : api('scanDocument', [{ docType: state.type, files, skipAi: skipAiUsed }]),
      qrTask
    ]);
    stopScanProgress(true); // quét xong: dừng bộ đếm ngay (trước đây không dừng nên giây vẫn chạy tiếp)
    qr = qr || qr2;
    if (!skipAiUsed) clearQuotaWait(); // AI trả kết quả được thì hạn mức không còn là vấn đề
    r.data = r.data || {};
    const used = mergeQr(r.data, qr);
    if (qr && skipAiUsed) r.data.quoc_tich = r.data.quoc_tich || 'Việt Nam'; // thẻ CCCD chỉ cấp cho công dân Việt Nam
    state.scan = r;
    renderReview(r.data);
    setJobs(r.data.cong_viec);
    persistDraft();
    cropPhoto(r.data).then(persistDraft); // ảnh chân dung của CV (nếu loại này có): cắt nền, xong thì hiện xem trước
    show('review');
    if (skipAiUsed) msg('Chế độ chỉ QR: không dùng AI. Đã lấy số CCCD, họ tên, ngày sinh, giới tính, thường trú, ngày cấp từ mã QR. Quê quán, nơi sinh, ngày hết hạn hãy tự nhập.', 'info');
    else if (used.length) msg('Đã đọc mã QR trên CCCD và dùng cho ' + used.length + ' trường (số CCCD, họ tên, ngày sinh, giới tính, thường trú, ngày cấp). Các trường còn lại lấy từ OCR.', 'info');
    else if (qrFirst) msg('Không đọc được mã QR, đã quét bằng OCR như thường.', 'info');
    const tm = r && r.timing;
    const left = state.anon && r.anon ? 'Còn ' + Math.max(0, r.anon.limit - r.anon.used) + '/' + r.anon.limit + ' lượt quét không cần tài khoản hôm nay.' : '';
    stopScanProgress(true, ((tm ? '(lưu tệp ' + (tm.driveMs / 1000).toFixed(1) + 's, AI ' + (tm.aiMs / 1000).toFixed(1) + 's' + (tm.retries ? ', thử lại ' + tm.retries + ' lần' : '') + ') ' : '') + left).trim());
  } catch (e) {
    stopScanProgress(false);
    const r = splitRetry(e.message);
    if (r.seconds) { startQuotaWait(r.seconds); msg(''); } // hết hạn mức: banner đếm ngược thay cho thông báo lỗi
    else msg(r.text);
  }
  finally { if (scanProg.timer) stopScanProgress(false); busy(btn, false); updateScanBtn(); }
}

/* ---------- Bước 3: xem, sửa, lưu ---------- */
const typeDef = () => state.config.types.find((t) => t.code === state.type);

function renderReview(data) {
  const t = typeDef();
  $('review-title').textContent = 'Kiểm tra: ' + t.label;
  const vals = toFormValues(t.fields, data);
  const form = $('form'); form.textContent = '';
  for (const f of t.fields) {
    const label = document.createElement('label');
    label.textContent = f.label;
    if (t.required.includes(f.k)) label.className = 'req';
    const el = document.createElement(f.type === 'long' ? 'textarea' : 'input');
    el.name = f.k; el.value = vals[f.k];
    if (f.type === 'number') el.inputMode = 'decimal';
    label.appendChild(el); form.appendChild(label);
  }
  $('fill-info').textContent = ''; $('fill-progress').hidden = true;
  $('review-actions').hidden = false;
  if (state.anon) {
    // Không tài khoản: không có bước Lưu; nút Điền vào FBO hiện ngay, không hỏi lưu. Bản nháp chỉ giữ trong phiên trình duyệt.
    $('btn-save').hidden = true; $('btn-next').hidden = false;
    $('after-save').hidden = false;
    $('save-info').textContent = 'Không lưu lên hệ thống (chế độ không cần tài khoản). Kiểm tra, sửa nếu cần rồi bấm Điền vào FBO.';
    getSettings().then(({ fboMappings }) => { $('btn-fill').hidden = !hasMapping(fboMappings, state.type); });
    form.oninput = () => { setAnonDraft({ type: state.type, data: readForm().data }); };
    setAnonDraft({ type: state.type, data });
  } else {
    $('btn-save').hidden = false; form.oninput = null;
    $('after-save').hidden = true;
  }
  setFormDisabled(false);
}

function setFormDisabled(on) { for (const el of $('form').elements) el.disabled = on; }

function readForm() {
  const t = typeDef();
  const values = {};
  for (const el of $('form').elements) values[el.name] = el.value;
  const { data, errors } = fromFormValues(t.fields, values);
  for (const el of $('form').elements) el.classList.toggle('bad', errors.includes(el.name));
  return { data, errors, t };
}

async function doSave() {
  msg('');
  const { data, errors, t } = readForm();
  if (errors.length) { msg('Có trường số sai định dạng (tô đỏ). Nhập lại bằng số.'); return; }
  const miss = missingRequired(t.required, data);
  if (miss.length) {
    const names = miss.map((k) => t.fields.find((f) => f.k === k).label).join(', ');
    msg('Còn thiếu trường bắt buộc: ' + names + '.'); return;
  }
  const btn = $('btn-save');
  busy(btn, true, 'Đang lưu...');
  try {
    const r = await api('saveRecord', [state.type, data, state.scan.fileIds]);
    state.saved = { data, period: r.period || thisPeriod(), fileId: r.fileId || state.scan.fileIds[0], updated: !!r.updated };
    persistDraft();
    setFormDisabled(true); $('review-actions').hidden = true; $('after-save').hidden = false;
    $('save-info').textContent = r.updated ? 'Đã lưu (ghi đè bản ghi trùng).' : 'Đã lưu bản ghi.';
    // Loại chưa có form FBO: chỉ lưu, trạng thái đồng bộ giữ PENDING để điền sau khi bổ sung ánh xạ
    const { fboMappings } = await getSettings();
    const mapped = hasMapping(fboMappings, state.type);
    $('btn-fill').hidden = !mapped;
    $('fill-info').className = 'hint';
    $('fill-info').textContent = mapped ? '' : 'Loại này chưa có form FBO nên chỉ lưu. Bản ghi giữ trạng thái chờ điền (PENDING) cho đến khi bổ sung ánh xạ.';
  } catch (e) { msg(e.message); }
  finally { busy(btn, false); }
}

function thisPeriod() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/* ---------- Giữ kết quả quét: tắt/mở lại panel hay form FBO vẫn điền tiếp được, không phải quét lại ---------- */
function persistDraft() {
  if (!state.scan || !state.type) return setScanDraft(null);
  return setScanDraft({ type: state.type, data: state.scan.data, fileIds: state.scan.fileIds || [], photo: state.photo, jobDone: state.jobDone, saved: state.saved });
}
async function restoreDraft() {
  const d = await getScanDraft();
  if (!d || !state.config || !state.config.types.some((x) => x.code === d.type)) return false;
  state.type = d.type; state.scan = { data: d.data, fileIds: d.fileIds || [] };
  renderTypes(); renderReview(d.data);
  setJobs(d.data.cong_viec); state.jobDone = d.jobDone || []; renderJobs();
  setPhoto(d.photo || null, PHOTO_FORMS[d.type] ? PHOTO_NONE_NOTE : '');
  show('review');
  if (d.saved) { // đã Lưu/đã sẵn sàng điền: hiện luôn nút điền
    state.saved = d.saved; setFormDisabled(true); $('review-actions').hidden = true; $('after-save').hidden = false;
    $('save-info').textContent = d.saved.anon ? 'Kết quả quét đang giữ lại (chưa lưu lên hệ thống).' : 'Đã lưu bản ghi.';
    const { fboMappings } = await getSettings(); $('btn-fill').hidden = !hasMapping(fboMappings, d.type);
  }
  msg('Đã khôi phục kết quả quét trước. Không cần quét lại.');
  return true;
}

/* ---------- Quá trình công tác: mỗi công việc một bản ghi, điền lần lượt, chống điền trùng ---------- */
const jobKey = (j) => [j.cong_ty, j.chuc_danh, j.tu, j.den].join('|');
function setJobs(list) {
  state.jobs = normalizeJobs(list);
  state.jobDone = []; // theo khóa nội dung, không theo số thứ tự: quét lại CV khác thì không dính trạng thái cũ
  renderJobs();
}
function renderJobs() {
  const box = $('jobs-box'), ol = $('jobs-list');
  box.hidden = !state.jobs.length;
  ol.textContent = '';
  state.jobs.forEach((j, i) => {
    const done = state.jobDone.includes(jobKey(j));
    const f = jobFields(j), m = f.meta;
    const li = document.createElement('li'); if (done) li.className = 'done';
    const t = document.createElement('div'); t.className = 'jt'; t.textContent = (done ? '✓ ' : '') + (j.cong_ty || '(không rõ đơn vị)') + (j.chuc_danh ? ' – ' + j.chuc_danh : '');
    const mm = document.createElement('div'); mm.className = 'jm';
    mm.textContent = 'Theo CV: ' + ([j.tu, j.den].filter(Boolean).join(' → ') || 'không ghi thời gian') +
      ' | Điền: ' + f.fields.ct_tu_ngay + ' → ' + f.fields.ct_den_ngay +
      (m.fromDefault || m.toDefault ? ' (CV thiếu ngày: dùng ngày mặc định)' : m.approx ? ' (ngày ước lượng)' : '') + (done ? ' | Đã điền' : '');
    const b = document.createElement('button'); b.type = 'button'; b.textContent = done ? 'Điền lại' : 'Điền';
    b.onclick = () => fillJob(i);
    li.append(t, mm, b); ol.appendChild(li);
  });
  const left = state.jobs.filter((j) => !state.jobDone.includes(jobKey(j))).length;
  $('btn-job-next').disabled = !left;
  $('btn-job-next').textContent = left ? 'Điền công việc tiếp theo (' + (state.jobs.length - left + 1) + '/' + state.jobs.length + ')' : 'Đã điền hết ' + state.jobs.length + ' công việc';
}
async function fillJob(i) {
  const j = state.jobs[i]; if (!j) return;
  const key = jobKey(j);
  const info = $('job-info');
  if (state.jobDone.includes(key) && !confirm('Công việc "' + (j.cong_ty || i + 1) + '" đã điền rồi.\n\nĐiền lại sẽ tạo trùng nếu bạn đã bấm Lưu ở FBO. Chỉ nên điền lại khi bản ghi đó chưa lưu hoặc đã bị xóa.\n\nVẫn điền lại?')) return;
  info.textContent = 'Đang điền công việc ' + (i + 1) + '/' + state.jobs.length + '...'; info.className = 'hint';
  const btns = Array.from(document.querySelectorAll('#jobs-box button')); btns.forEach((b) => { b.disabled = true; });
  const cut = (v) => { v = String(v); return v.length > 40 ? v.slice(0, 40) + '…' : v; };
  try {
    const r = await fillActiveTab('CV_NHANVIEN', state.scan ? state.scan.data : {}, {
      job: i,
      required: ['ct_don_vi', 'ct_tu_ngay', 'ct_den_ngay'], // form đang có bản ghi khác (chưa Lưu) thì hỏi trước khi đè
      confirmEditMode: async (title) => confirm('Form đang ở chế độ: "' + cut(title) + '" (không phải thêm mới).\n\nĐiền tiếp sẽ GHI ĐÈ lên bản ghi đang mở. Vẫn điền?'),
      confirmPartial: async (x) => confirm('Form đang mở chỉ có ' + x.found + '/' + x.total + ' ô khớp với form Quá trình công tác.\n\nVẫn điền?'),
      confirmOverwrite: async (over) => confirm('Form đang có dữ liệu khác (có thể là công việc trước chưa Lưu):\n\n' + over.map((o) => '• ' + (DERIVED_LABELS[o.k] || o.k) + ': "' + cut(o.old) + '" → "' + cut(o.v) + '"').join('\n') + '\n\nGhi đè?')
    });
    if (r.status === 'NO_FORM' || r.status === 'NO_MAPPING') { info.textContent = 'Chưa thấy form "Thêm thông tin quá trình công tác trước đây" ở tab hiện tại. Mở form đó rồi bấm Điền lại.'; info.className = 'warn'; }
    else if (r.status === 'READ_ONLY') { info.textContent = 'Form đang ở chế độ "' + cut(r.title) + '" (chỉ xem). Bấm Mới trên form FBO rồi điền lại.'; info.className = 'warn'; }
    else if (r.status === 'CANCELLED') { info.textContent = 'Đã hủy, không ghi gì vào form.'; info.className = 'warn'; }
    else {
      if (r.filled.length) { state.jobDone.push(key); }
      const next = state.jobs.findIndex((x) => !state.jobDone.includes(jobKey(x)));
      info.textContent = 'Đã điền ' + r.filled.length + '/' + r.total + ' trường của công việc ' + (i + 1) + '. Kiểm tra rồi bấm Lưu trên FBO' + (next >= 0 ? ', sau đó mở lại form thêm mới và bấm "Điền công việc tiếp theo".' : '. Đã hết công việc.');
      info.className = r.filled.length ? 'ok' : 'warn';
    }
  } catch (e) { info.textContent = e instanceof FillStopped ? 'Đã dừng.' : e.message; info.className = 'warn'; }
  finally { btns.forEach((b) => { b.disabled = false; }); renderJobs(); persistDraft(); }
}
$('btn-job-next').onclick = () => { const i = state.jobs.findIndex((x) => !state.jobDone.includes(jobKey(x))); if (i >= 0) fillJob(i); };

/* ---------- Bước 4: điền FBO ---------- */
/* ---------- Ảnh chân dung trên CV: cắt theo khung AI trả về, hiện xem trước, gắn vào form khi điền ---------- */
const PHOTO_NONE_NOTE = 'Chưa có ảnh chân dung: CV không có ảnh, không cắt được, hoặc Apps Script chưa triển khai bản mới (có khung ảnh). Bạn có thể chọn ảnh từ máy.';
/** p = ảnh (hoặc null); note = lời nhắc khi chưa có ảnh. Loại có ô ảnh trên form thì luôn hiện khung, kể cả khi chưa có ảnh, để chọn bằng tay. */
function setPhoto(p, note) {
  state.photo = p;
  $('photo-box').hidden = !p && !note;
  $('photo-img').hidden = !p; $('photo-row').hidden = !p; $('photo-hint').hidden = !p;
  $('photo-note').textContent = p ? '' : (note || '');
  $('btn-photo-pick').textContent = p ? 'Chọn ảnh khác từ máy...' : 'Chọn ảnh từ máy...';
  if (p) { $('photo-img').src = p.dataUrl; $('in-photo').checked = true; } else $('photo-img').removeAttribute('src');
}
async function cropPhoto(data) {
  setPhoto(null);
  if (!PHOTO_FORMS[state.type]) return;
  const files = state.files.map((f) => ({ mimeType: f.mimeType, base64: f.base64 }));
  const type = state.type, scan = state.scan;
  let p = null;
  try { p = await extractPhoto(files, data); } catch (e) { p = null; } // không cắt được thì thôi, các trường khác vẫn điền
  if (state.type === type && state.scan === scan) setPhoto(p, PHOTO_NONE_NOTE); // người dùng đã quét lại/đổi loại trong lúc cắt thì bỏ
}
/** Chọn ảnh chân dung từ máy: thu nhỏ về cỡ chân dung rồi dùng như ảnh cắt tự động. */
$('btn-photo-pick').onclick = () => $('photo-file').click();
$('photo-file').onchange = async (ev) => {
  const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  try {
    const url = URL.createObjectURL(f);
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Không đọc được ảnh')); i.src = url; });
    const k = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    setPhoto({ dataUrl: c.toDataURL('image/jpeg', 0.9), name: 'anh_chan_dung.jpg' }); persistDraft();
  } catch (e) { $('photo-note').textContent = e.message; }
};

async function doFill() {
  msg('');
  const btn = $('btn-fill'), info = $('fill-info'), bar = $('fill-progress');
  if (state.anon) {
    // Không tài khoản: lấy dữ liệu đang hiển thị trên form, không lưu, không hỏi lưu
    const { data, errors, t: tt } = readForm();
    if (errors.length) { msg('Có trường số sai định dạng (tô đỏ). Nhập lại bằng số.'); return; }
    const miss = missingRequired(tt.required, data);
    if (miss.length) { msg('Còn thiếu trường bắt buộc: ' + miss.map((k) => tt.fields.find((f) => f.k === k).label).join(', ') + '.'); return; }
    state.saved = { data, anon: true };
    setAnonDraft({ type: state.type, data });
    persistDraft();
  }
  busy(btn, true, 'Đang chuẩn bị...');
  info.textContent = ''; info.className = 'hint';
  bar.hidden = false; bar.removeAttribute('value'); // thanh chạy không xác định trong lúc chờ form
  const t = state.config && state.config.types.find((x) => x.code === state.type);
  const label = (k) => { const f = t && t.fields.find((x) => x.k === k); return f ? f.label : (DERIVED_LABELS[k] || k); };
  const list = (a) => a.map(label).join(', ');
  const typeName = (code) => { const x = state.config && state.config.types.find((y) => y.code === code); return x ? x.label : code; };
  const cut = (v) => { v = String(v); return v.length > 40 ? v.slice(0, 40) + '…' : v; };
  const ctl = new AbortController(), stop = $('btn-stop');
  stop.hidden = false; stop.disabled = false; stop.onclick = () => { stop.disabled = true; ctl.abort(); };
  const opts = {
    signal: ctl.signal,
    required: t ? t.required : [],
    relation: $('in-relation').value,
    photo: state.photo && $('in-photo').checked ? state.photo : null,
    confirmPhotoOverwrite: async () => confirm('Form FBO đang có ảnh chân dung.\n\nThay bằng ảnh cắt từ CV?'),
    onProgress: (p) => {
      const sec = p.elapsed != null ? ' ' + Math.floor(p.elapsed / 1000) + 's' : '';
      if (p.phase === 'tab') { btn.textContent = 'Đang chọn tab FBO...'; info.textContent = 'Điền vào tab: "' + cut(p.title) + '". Hãy giữ nguyên tab này đến khi xong.'; }
      else if (p.phase === 'prepare') btn.textContent = 'Chuẩn bị điền...';
      else if (p.phase === 'form') { if (p.label) info.textContent += ' Nhận diện form: ' + p.label + '.'; }
      else if (p.phase === 'wait') btn.textContent = 'Chờ form FBO...' + sec + ' (thấy ' + p.found + '/' + p.total + ' ô)';
      else if (p.phase === 'check') btn.textContent = 'Kiểm tra dữ liệu có sẵn...';
      else if (p.phase === 'fill') btn.textContent = 'Đang điền...';
    },
    // Form chỉ khớp một phần số ô (có thể là form khác loại, hoặc tab con chưa mở): để người dùng quyết định
    confirmPartial: async (x) => confirm('Form FBO đang mở chỉ có ' + x.found + '/' + x.total + ' ô khớp với loại "' + (t ? t.label : state.type) + '".\n\nCó thể bạn đang mở nhầm form, hoặc một số ô nằm ở tab con chưa mở.\n\nVẫn điền các ô tìm thấy?'),
    // Form đang có dữ liệu khác ở trường bắt buộc (vd mở hồ sơ người khác): hỏi trước khi ghi đè
    confirmOverwrite: async (over) => confirm('Form FBO đang có dữ liệu khác:\n\n' +
      over.map((o) => '• ' + label(o.k) + ': "' + cut(o.old) + '" → "' + cut(o.v) + '"' + (o.foreign ? ' (đang là dữ liệu do tool ' + typeName(o.src) + ' điền)' : '')).join('\n') +
      '\n\nGhi đè bằng dữ liệu vừa quét?')
  };
  let done = false;
  try {
    const r = await fillActiveTab(state.type, state.saved.data, opts);
    if (r.status === 'NO_MAPPING') {
      info.textContent = 'Chưa khai báo ánh xạ trường FBO cho loại này. Mở Cài đặt để khai báo.';
      return;
    }
    if (r.status === 'NO_FORM') {
      info.textContent = 'Bạn chưa mở form cần điền ở tab hiện tại (đã chờ ' + FORM_WAIT_MS / 1000 + ' giây, không thấy ô nào của form "' + (t ? t.label : state.type) + '"). Đăng nhập FBO và mở đúng form (nếu form có nhiều tab, mở tab cần điền), rồi bấm Điền vào FBO lại.';
      info.className = 'warn'; return;
    }
    if (r.status === 'READ_ONLY') {
      info.textContent = 'Form đang ở chế độ "' + cut(r.title) + '" (chỉ xem) nên không điền được. Bấm Mới (thêm) hoặc Sửa trên form FBO rồi bấm Điền vào FBO lại. Kết quả quét vẫn còn.'; info.className = 'warn'; return;
    }
    if (r.status === 'CANCELLED') {
      info.textContent = r.wrongForm ? 'Đã hủy: form đang mở chỉ khớp ' + r.found + '/' + r.selectors + ' ô. Mở đúng form rồi bấm Điền vào FBO lại.' : 'Đã hủy: không ghi đè dữ liệu đang có trên form FBO.';
      info.className = 'warn'; return;
    }
    const parts = ['Đã điền ' + r.filled.length + '/' + r.total + ' trường (' + Math.round(r.filled.length * 100 / (r.total || 1)) + '%)' + (r.filled.length ? ': ' + list(r.filled) : '') + '.'];
    if (r.notFound.length) parts.push('Không thấy ô trên form: ' + list(r.notFound) + '.');
    if (r.empty.length) parts.push('Bỏ qua (OCR không có giá trị, sai định dạng ngày hoặc không khớp mã): ' + list(r.empty) + '.');
    parts.push((r.formName ? 'Form nhận diện: ' + r.formName + '. ' : '') + 'Thấy ' + r.found + '/' + r.selectors + ' ô của form.');
    if (PHOTO_FORMS[state.type]) {
      const ph = { ok: 'Đã gắn ảnh chân dung.', kept: 'Giữ ảnh đang có trên form.', notFound: 'Không thấy ô chọn ảnh trên form.', error: 'Không gắn được ảnh chân dung (chọn ảnh bằng tay).', noPreview: 'Đã chọn ảnh vào ô chọn tệp nhưng form chưa hiện ảnh xem trước. Kiểm tra khung ảnh trước khi Lưu; nếu trống thì bấm Chọn... và chọn ảnh bằng tay.' }[r.photo];
      parts.push(ph || (state.photo ? 'Chưa gắn ảnh chân dung (đã bỏ chọn).' : 'Không có ảnh chân dung để gắn (CV không có ảnh hoặc không cắt được).'));
    }
    if (r.diag) parts.push('Chẩn đoán ô địa chỉ (gửi lại cho người hỗ trợ): ' + r.diag + '.');
    if (r.mainOnly) parts.push('(Trang có khung phụ không phản hồi nên chỉ điền ở khung chính.)');
    if (r.away) parts.push('Lưu ý: đã điền vào tab "' + cut(r.tabTitle) + '", không phải tab bạn đang xem. Quay lại tab đó để kiểm tra.');
    info.textContent = parts.join('\n'); // mỗi ý một dòng
    info.className = r.status === 'FILLED' && !r.away ? 'ok' : 'warn';
    bar.max = r.total || 1; bar.value = r.filled.length; done = true; // thanh hiện tỉ lệ đã điền, giữ lại để NSD xem
    if (!state.saved.anon) {
      try { await api('updateSyncStatus', [state.type, state.saved.period, state.saved.fileId, r.status]); }
      catch (e) { info.textContent += ' (Chưa cập nhật được trạng thái đồng bộ: ' + e.message + ')'; }
    }
  } catch (e) {
    if (e instanceof FillStopped) { // bấm Dừng: không đánh dấu lỗi, cho điền lại
      info.textContent = 'Đã dừng. Mở lại tab và form FBO cần điền, rồi bấm "Điền vào FBO" để điền lại.'; info.className = 'warn';
    } else {
      info.textContent = e.message; info.className = 'warn';
      if (!state.saved.anon) { try { await api('updateSyncStatus', [state.type, state.saved.period, state.saved.fileId, 'ERROR']); } catch { /* bỏ qua */ } }
    }
  } finally { stop.hidden = true; stop.onclick = null; if (!done) bar.hidden = true; busy(btn, false); }
}

/* ---------- Dò form: liệt kê ô của tab đang xem, tự sao chép để dán cho người lập ánh xạ ---------- */
async function doInspect() {
  msg('');
  const b = $('btn-inspect'); b.disabled = true;
  try {
    const frames = await inspectFormTab();
    const text = formatInspect(frames), n = countControls(frames);
    $('inspect-out').value = text; $('inspect-box').hidden = !n;
    if (!n) { msg('Không thấy ô nhập nào ở tab đang xem. Mở form FBO ở tab này rồi bấm Dò form lại.'); return; }
    let copied = true;
    try { await navigator.clipboard.writeText(text); } catch (e) { copied = false; }
    msg('Đã dò ' + n + ' ô của form' + (copied ? ' và sao chép vào bộ nhớ tạm. Dán (Ctrl+V) cho Claude.' : '. Chưa tự sao chép được: mở "Kết quả dò form", chọn hết rồi sao chép.'), 'info');
  } catch (e) { msg(e.message); }
  finally { b.disabled = false; }
}
$('btn-inspect').onclick = doInspect;

/* ---------- Quyền FBO và đăng nhập FBO ---------- */
async function checkFboPermission() {
  const { fboOrigins } = await getSettings();
  const origins = fboOrigins.map((o) => o + '/*');
  const bar = $('perm-bar');
  bar.dataset.empty = origins.length ? '' : '1';
  $('perm-text').textContent = origins.length ? 'Cần cấp quyền để điền form FBO. ' : 'Chưa có địa chỉ FBO. Thêm địa chỉ ở Cài đặt để điền form. ';
  $('btn-perm').textContent = origins.length ? 'Cấp quyền FBO' : 'Mở Cài đặt';
  bar.hidden = origins.length ? await chrome.permissions.contains({ origins }) : false;
}
async function doFboLogin() {
  msg('');
  const btn = $('btn-fbo-login');
  busy(btn, true, 'Đang điền...');
  try {
    const r = await loginFboActiveTab();
    if (r.skipped) { msg('Tab FBO đã đăng nhập, không cần đăng nhập lại.', 'info'); return; }
    const parts = [r.submitted ? 'Đã điền và bấm Nhận.' : 'Đã điền thông tin đăng nhập.'].concat(r.notes || []);
    msg(parts.join(' '), 'info');
  } catch (e) { msg(e.message); }
  finally { busy(btn, false); }
}

/* ---------- Gắn sự kiện ---------- */
$('btn-perm').onclick = async () => {
  const { fboOrigins } = await getSettings();
  if (!fboOrigins.length) { chrome.runtime.openOptionsPage(); return; }
  const ok = await chrome.permissions.request({ origins: fboOrigins.map((o) => o + '/*') });
  if (ok) $('perm-bar').hidden = true; else msg('Chưa được cấp quyền, nút Điền vào FBO sẽ không hoạt động.');
};
$('btn-fbo-login').onclick = doFboLogin;
$('btn-login').onclick = doLogin;
$('in-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('btn-logout').onclick = () => (state.anon ? exitAnon() : logout('', false));
$('btn-anon').onclick = async () => { msg(''); try { await enterAnon(); } catch (e) { msg(e.message); } };
$('btn-settings').onclick = () => chrome.runtime.openOptionsPage();
$('btn-pick').onclick = () => $('in-files').click();
$('in-files').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
$('btn-scan').onclick = doScan;
$('btn-back').onclick = () => { state.scan = null; if (state.anon) setAnonDraft(null); show('scan'); };
$('btn-save').onclick = doSave;
$('btn-fill').onclick = doFill;
$('btn-next').onclick = () => { if (state.anon) setAnonDraft(null); resetScan(); msg(''); show('scan'); };

const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (state.config) addFiles(e.dataTransfer.files); });
document.addEventListener('paste', (e) => {
  if (!state.config || $('view-scan').hidden) return;
  const files = Array.from(e.clipboardData?.files || []);
  if (files.length) { e.preventDefault(); addFiles(files); }
});

/* ---------- Khởi động ---------- */
(async function init() {
  restoreQuotaWait();
  await refreshRemoteConfig(); // link Apps Script nằm ở Web Admin (Vercel); lấy mới mỗi lần mở, lỗi mạng thì dùng bản đã lưu
  const { gasUrl } = await getSettings();
  if (!gasUrl) { show('login'); msg('Chưa lấy được địa chỉ máy chủ OCR từ Web Admin. Kiểm tra mạng, hoặc liên hệ quản trị viên (biến GAS_WEB_APP_URL trên Vercel).'); return; }
  if (await getAnonMode()) { // còn trong phiên trình duyệt đang dùng chế độ không tài khoản
    try {
      await enterAnon();
      const d = await getAnonDraft();
      if (d && state.config.types.some((x) => x.code === d.type)) { state.type = d.type; state.scan = { data: d.data, fileIds: [] }; renderTypes(); renderReview(d.data); show('review'); }
      await restoreDraft(); // bản đầy đủ (ảnh, danh sách công việc, trạng thái) nếu có
      return;
    } catch (e) { await setAnonMode(false); state.anon = false; msg(e.message); }
  }
  const auth = await getAuth();
  if (auth) {
    try {
      const me = await call('checkSession', [auth.token]);
      if (me) { state.auth = { token: auth.token, me }; await enter(); await restoreDraft(); return; }
    } catch (e) { msg(e.message); }
  }
  if (await tryAutoLogin()) { await enter(); await restoreDraft(); return; }
  await showLogin();
})();
