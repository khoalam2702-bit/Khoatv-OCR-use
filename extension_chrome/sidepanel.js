import { ENABLED_TYPES, DEFAULT_LIMITS } from './lib/config.js';
import { createGasClient, GasError } from './lib/gas.js';
import { getSettings, getAuth, setAuth, refreshRemoteConfig, getOcrLogin, saveOcrLogin, getOcrPassword, forgetOcrPassword } from './lib/store.js';
import { prepareFile } from './lib/image.js';
import { toFormValues, fromFormValues, missingRequired } from './lib/format.js';
import { fillActiveTab, loginFboActiveTab } from './lib/fbo.js';
import { hasMapping } from './lib/mapping.js';

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

function updateScanBtn() { $('btn-scan').disabled = !(state.type && state.files.length); }

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
    const r = await api('scanDocument', [{ docType: state.type, files: state.files.map((f) => ({ mimeType: f.mimeType, base64: f.base64 })) }]);
    state.scan = r;
    renderReview(r.data || {});
    show('review');
  } catch (e) { msg(e.message); }
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
  $('after-save').hidden = true; $('review-actions').hidden = false; $('fill-info').textContent = '';
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
  const btn = $('btn-fill'), info = $('fill-info');
  busy(btn, true, 'Đang điền...');
  info.textContent = '';
  try {
    const r = await fillActiveTab(state.type, state.saved.data);
    if (r.status === 'NO_MAPPING') {
      info.textContent = 'Chưa khai báo ánh xạ trường FBO cho loại này. Mở Cài đặt để khai báo.';
      return;
    }
    const parts = ['Đã điền ' + r.filled.length + ' trường.'];
    if (r.notFound.length) parts.push('Không tìm thấy ô: ' + r.notFound.join(', ') + '.');
    info.textContent = parts.join(' ');
    info.className = r.status === 'FILLED' ? 'ok' : 'warn';
    try { await api('updateSyncStatus', [state.type, state.saved.period, state.saved.fileId, r.status]); }
    catch (e) { info.textContent += ' (Chưa cập nhật được trạng thái đồng bộ: ' + e.message + ')'; }
  } catch (e) {
    info.textContent = e.message; info.className = 'warn';
    try { await api('updateSyncStatus', [state.type, state.saved.period, state.saved.fileId, 'ERROR']); } catch { /* bỏ qua */ }
  } finally { busy(btn, false); }
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
  refreshRemoteConfig(); // cập nhật link do admin cấu hình, dùng cho lần mở sau
  const { gasUrl } = await getSettings();
  if (!gasUrl) { show('login'); msg('Chưa có địa chỉ Apps Script. Liên hệ quản trị viên để cấu hình ở Web Admin.'); return; }
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
