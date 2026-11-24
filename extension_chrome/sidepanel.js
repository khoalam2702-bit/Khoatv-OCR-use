import { ENABLED_TYPES, DEFAULT_LIMITS } from './lib/config.js';
import { createGasClient, GasError } from './lib/gas.js';
import { getSettings, getAuth, setAuth, refreshRemoteConfig, getOcrLogin, saveOcrLogin, getOcrPassword, forgetOcrPassword } from './lib/store.js';
import { prepareFile } from './lib/image.js';
import { toFormValues, fromFormValues, missingRequired } from './lib/format.js';
import { DERIVED_LABELS } from './lib/dm.js';
import { readCccdQr, mergeQr } from './lib/qr.js';
import { fillActiveTab, loginFboActiveTab } from './lib/fbo.js';
import { hasMapping } from './lib/mapping.js';
import { splitRetry, formatWait } from './lib/quota.js';
import { FORM_WAIT_MS } from './lib/formcheck.js';

const $ = (id) => document.getElementById(id);
const call = createGasClient({ getUrl: async () => (await getSettings()).gasUrl });

const state = { auth: null, config: null, type: null, files: [], scan: null, saved: null };

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
  if (!keepPassword) await forgetOcrPassword();
  $('who').textContent = ''; $('btn-fbo-login').hidden = true;
  await showLogin(message);
}

async function showLogin(message) {
  const rec = await getOcrLogin();
  if (rec && rec.username && !$('in-user').value) $('in-user').value = rec.username;
  $('in-remember').checked = true;
  show('login'); msg(message || '', message ? 'info' : undefined);
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
    limits: { maxFileBytes: cfg.maxFileBytes || DEFAULT_LIMITS.maxFileBytes, maxTotalBytes: cfg.maxTotalBytes || DEFAULT_LIMITS.maxTotalBytes, maxFiles: cfg.maxFiles || DEFAULT_LIMITS.maxFiles }
  };
}

async function enter() {
  $('who').textContent = state.auth.me.name + ' (' + state.auth.me.username + ')';
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
const QUOTA_KEY = 'ocrQuotaUntil';
let quotaUntil = 0, quotaTimer = null;
const quotaActive = () => quotaUntil > Date.now();
function hhmm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function renderQuota() {
  const bar = $('quota-bar');
  const left = Math.ceil((quotaUntil - Date.now()) / 1000);
  if (left <= 0) {
    clearInterval(quotaTimer); quotaTimer = null; quotaUntil = 0;
    try { localStorage.removeItem(QUOTA_KEY); } catch (e) { /* bỏ qua */ }
    bar.hidden = true; bar.textContent = ''; updateScanBtn(); return; // hết giờ chờ: ẩn thông báo, mở lại nút Quét
  }
  bar.textContent = '';
  const t = document.createElement('div'); t.textContent = '⚠ Gemini đã hết hạn mức quét. Chưa thể quét bằng AI cho đến khi hạn mức được đặt lại.';
  const c = document.createElement('div'); c.append('Còn phải chờ: ');
  const b = document.createElement('b'); b.textContent = formatWait(left); c.append(b, ' (khoảng ' + hhmm(quotaUntil) + ' ' + (new Date(quotaUntil).toDateString() === new Date().toDateString() ? 'hôm nay' : 'ngày mai') + ').');
  bar.append(t, c); bar.hidden = false;
}
function startQuotaWait(seconds) {
  quotaUntil = Date.now() + Math.max(1, seconds) * 1000;
  try { localStorage.setItem(QUOTA_KEY, String(quotaUntil)); } catch (e) { /* bỏ qua */ }
  clearInterval(quotaTimer); quotaTimer = setInterval(renderQuota, 1000);
  renderQuota(); updateScanBtn();
}
function restoreQuotaWait() {
  let v = 0; try { v = Number(localStorage.getItem(QUOTA_KEY)) || 0; } catch (e) { v = 0; }
  if (v > Date.now()) { quotaUntil = v; clearInterval(quotaTimer); quotaTimer = setInterval(renderQuota, 1000); renderQuota(); }
}

function updateScanBtn() {
  $('btn-scan').disabled = !(state.type && state.files.length) || quotaActive();
  $('row-qronly').hidden = state.type !== 'CCCD';
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

function resetScan() {
  state.files = []; state.scan = null; state.saved = null;
  renderTypes(); renderFiles(); updateScanBtn();
  $('limit-hint').textContent = 'Tối đa ' + state.config.limits.maxFiles + ' tệp mỗi tài liệu (ví dụ CCCD 2 mặt = 2 ảnh).';
}

/* ---------- Quét ---------- */
async function doScan() {
  msg('');
  const btn = $('btn-scan');
  busy(btn, true, 'Đang quét...');
  try {
    // CCCD: đọc mã QR; dữ liệu QR (số CCCD, họ tên đủ dấu, ngày sinh, giới tính, thường trú, ngày cấp) ghi đè kết quả OCR.
    // Chế độ "chỉ QR": QR hợp lệ thì không gọi AI (nhanh); QR không đọc được thì tự quay về OCR như thường.
    const files = state.files.map((f) => ({ mimeType: f.mimeType, base64: f.base64 }));
    const qrFirst = state.type === 'CCCD' && $('in-qronly').checked;
    let qr = null, qrTask = Promise.resolve(null);
    if (qrFirst) {
      qr = await readCccdQr(state.files).catch(() => null);
    } else if (state.type === 'CCCD') {
      qrTask = readCccdQr(state.files).catch(() => null);
    }
    const skipAiUsed = !!qr; // chỉ true ở chế độ chỉ QR khi QR hợp lệ: backend không gọi AI
    const [r, qr2] = await Promise.all([
      api('scanDocument', [{ docType: state.type, files, skipAi: skipAiUsed }]),
      qrTask
    ]);
    qr = qr || qr2;
    r.data = r.data || {};
    const used = mergeQr(r.data, qr);
    if (qr && skipAiUsed) r.data.quoc_tich = r.data.quoc_tich || 'Việt Nam'; // thẻ CCCD chỉ cấp cho công dân Việt Nam
    state.scan = r;
    renderReview(r.data);
    show('review');
    if (skipAiUsed) msg('Chế độ chỉ QR: không dùng AI. Đã lấy số CCCD, họ tên, ngày sinh, giới tính, thường trú, ngày cấp từ mã QR. Quê quán, nơi sinh, ngày hết hạn hãy tự nhập.', 'info');
    else if (used.length) msg('Đã đọc mã QR trên CCCD và dùng cho ' + used.length + ' trường (số CCCD, họ tên, ngày sinh, giới tính, thường trú, ngày cấp). Các trường còn lại lấy từ OCR.', 'info');
    else if (qrFirst) msg('Không đọc được mã QR, đã quét bằng OCR như thường.', 'info');
  } catch (e) {
    const r = splitRetry(e.message);
    if (r.seconds) { startQuotaWait(r.seconds); msg(''); } // hết hạn mức: banner đếm ngược thay cho thông báo lỗi
    else msg(r.text);
  }
  finally { busy(btn, false); updateScanBtn(); }
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
  $('after-save').hidden = true; $('review-actions').hidden = false; $('fill-info').textContent = ''; $('fill-progress').hidden = true;
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

/* ---------- Bước 4: điền FBO ---------- */
async function doFill() {
  msg('');
  const btn = $('btn-fill'), info = $('fill-info'), bar = $('fill-progress');
  busy(btn, true, 'Đang kiểm tra form FBO...');
  info.textContent = ''; info.className = 'hint';
  bar.hidden = false; bar.removeAttribute('value'); // thanh chạy không xác định trong lúc chờ form
  const t = state.config && state.config.types.find((x) => x.code === state.type);
  const label = (k) => { const f = t && t.fields.find((x) => x.k === k); return f ? f.label : (DERIVED_LABELS[k] || k); };
  const list = (a) => a.map(label).join(', ');
  const cut = (v) => { v = String(v); return v.length > 40 ? v.slice(0, 40) + '…' : v; };
  const opts = {
    required: t ? t.required : [],
    onProgress: (p) => {
      if (p.phase === 'wait') btn.textContent = 'Chờ form FBO... ' + Math.floor(p.elapsed / 1000) + '/' + p.limit / 1000 + ' giây';
      else if (p.phase === 'fill') btn.textContent = 'Đang điền...';
    },
    // Form đang có dữ liệu khác ở trường bắt buộc (vd mở hồ sơ người khác): hỏi trước khi ghi đè
    confirmOverwrite: async (over) => confirm('Form FBO đang có dữ liệu khác:\n\n' +
      over.map((o) => '• ' + label(o.k) + ': "' + cut(o.old) + '" → "' + cut(o.v) + '"').join('\n') +
      '\n\nGhi đè bằng dữ liệu vừa quét?')
  };
  let done = false;
  try {
    const r = await fillActiveTab(state.type, state.saved.data, opts);
    if (r.status === 'NOT_LOGGED_IN') {
      info.textContent = 'Tab FBO đang ở trang đăng nhập. Bấm "Đăng nhập FBO" (hoặc tự đăng nhập), rồi bấm Điền vào FBO lại.';
      info.className = 'warn'; return;
    }
    if (r.status === 'NO_MAPPING') {
      info.textContent = 'Chưa khai báo ánh xạ trường FBO cho loại này. Mở Cài đặt để khai báo.';
      return;
    }
    if (r.status === 'NO_FORM') {
      info.textContent = 'Chưa thấy form FBO ở tab hiện tại (đã chờ ' + FORM_WAIT_MS / 1000 + ' giây). Mở đúng form (ví dụ Thêm nhân viên) hoặc chờ trang tải xong, rồi bấm Điền vào FBO lại.';
      info.className = 'warn'; return;
    }
    if (r.status === 'WRONG_FORM') {
      info.textContent = 'Form đang mở không khớp loại "' + (t ? t.label : state.type) + '" (chỉ thấy ' + r.found + '/' + r.selectors + ' ô cần điền). Mở đúng form rồi bấm lại. Chưa điền gì.';
      info.className = 'warn'; return;
    }
    if (r.status === 'CANCELLED') {
      info.textContent = 'Đã hủy: không ghi đè dữ liệu đang có trên form FBO.';
      info.className = 'warn'; return;
    }
    const parts = ['Đã điền ' + r.filled.length + '/' + r.total + ' trường (' + Math.round(r.filled.length * 100 / (r.total || 1)) + '%)' + (r.filled.length ? ': ' + list(r.filled) : '') + '.'];
    if (r.notFound.length) parts.push('Không thấy ô trên form: ' + list(r.notFound) + '.');
    if (r.empty.length) parts.push('Bỏ qua (OCR không có giá trị, sai định dạng ngày hoặc không khớp mã): ' + list(r.empty) + '.');
    info.textContent = parts.join(' ');
    info.className = r.status === 'FILLED' ? 'ok' : 'warn';
    bar.max = r.total || 1; bar.value = r.filled.length; done = true; // thanh hiện tỉ lệ đã điền, giữ lại để NSD xem
    try { await api('updateSyncStatus', [state.type, state.saved.period, state.saved.fileId, r.status]); }
    catch (e) { info.textContent += ' (Chưa cập nhật được trạng thái đồng bộ: ' + e.message + ')'; }
  } catch (e) {
    info.textContent = e.message; info.className = 'warn';
    try { await api('updateSyncStatus', [state.type, state.saved.period, state.saved.fileId, 'ERROR']); } catch { /* bỏ qua */ }
  } finally { if (!done) bar.hidden = true; busy(btn, false); }
}

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
$('btn-logout').onclick = () => logout('', false);
$('btn-settings').onclick = () => chrome.runtime.openOptionsPage();
$('btn-pick').onclick = () => $('in-files').click();
$('in-files').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
$('btn-scan').onclick = doScan;
$('btn-back').onclick = () => { state.scan = null; show('scan'); };
$('btn-save').onclick = doSave;
$('btn-fill').onclick = doFill;
$('btn-next').onclick = () => { resetScan(); msg(''); show('scan'); };

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
  const auth = await getAuth();
  if (auth) {
    try {
      const me = await call('checkSession', [auth.token]);
      if (me) { state.auth = { token: auth.token, me }; await enter(); return; }
    } catch (e) { msg(e.message); }
  }
  if (await tryAutoLogin()) { await enter(); return; }
  await showLogin();
})();
