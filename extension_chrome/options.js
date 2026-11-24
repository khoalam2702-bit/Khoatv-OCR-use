import { getSettings, setSettings, getPreset, getFboLogins, saveFboLogin, deleteFboLogin } from './lib/store.js';
import { inspectActiveTab } from './lib/fbo.js';
import { validateMapping, diffFromPreset } from './lib/mapping.js';
import { normalizeOrigin } from './lib/appconfig.js';

const $ = (id) => document.getElementById(id);
const say = (t, err) => { const m = $('msg'); m.hidden = !t; m.textContent = t || ''; m.className = 'msg' + (err ? '' : ' info'); window.scrollTo(0, 0); };

function cell(tr, text) { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); return td; }
function btn(text, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = text; b.onclick = fn; return b; }

async function render() {
  const s = await getSettings();

  const t = $('origins'); t.textContent = '';
  for (const o of s.fboOrigins) {
    const tr = document.createElement('tr'); cell(tr, o);
    const st = cell(tr, '...');
    chrome.permissions.contains({ origins: [o + '/*'] }).then((ok) => { st.textContent = ok ? 'Đã cấp quyền' : 'Chưa cấp quyền'; });
    const act = cell(tr, '');
    if (s.userFboOrigins.includes(o)) act.appendChild(btn('Xoá', async () => { await setSettings({ userFboOrigins: s.userFboOrigins.filter((x) => x !== o) }); render(); }));
    t.appendChild(tr);
  }
  $('origin-list').textContent = '';
  for (const o of s.fboOrigins) { const op = document.createElement('option'); op.value = o; $('origin-list').appendChild(op); }

  const logins = await getFboLogins();
  const lt = $('logins'); lt.textContent = '';
  for (const [o, r] of Object.entries(logins)) {
    const tr = document.createElement('tr');
    cell(tr, o); cell(tr, r.user || ''); cell(tr, r.passEnc ? 'Có mật khẩu (mã hoá)' : 'Chưa có mật khẩu');
    const act = cell(tr, '');
    act.appendChild(btn('Sửa', () => { $('lg-origin').value = o; $('lg-user').value = r.user; $('lg-pass').value = ''; }));
    act.appendChild(btn('Xoá', async () => { await deleteFboLogin(o); render(); }));
    lt.appendChild(tr);
  }
  $('mapping').value = JSON.stringify(s.fboMappings, null, 2);
}

render();

async function grant(origins) {
  const ok = await chrome.permissions.request({ origins: origins.map((o) => o + '/*') });
  say(ok ? 'Đã cấp quyền.' : 'Chưa được cấp quyền.', !ok);
  render();
}
$('add-origin').onclick = async () => {
  const o = normalizeOrigin($('fbo-origin').value);
  if (!o) return say('Địa chỉ FBO không hợp lệ.', true);
  const s = await getSettings();
  if (!s.userFboOrigins.includes(o) && !s.fboOrigins.includes(o)) await setSettings({ userFboOrigins: [...s.userFboOrigins, o] });
  $('fbo-origin').value = '';
  await grant([o]);
};
$('grant-all').onclick = async () => grant((await getSettings()).fboOrigins);

$('save-login').onclick = async () => {
  try {
    await saveFboLogin($('lg-origin').value, { user: $('lg-user').value.trim(), password: $('lg-pass').value });
    $('lg-pass').value = '';
    say('Đã lưu đăng nhập FBO.');
    render();
  } catch (e) { say(e.message, true); }
};

$('save-map').onclick = async () => {
  let obj;
  try { obj = JSON.parse($('mapping').value || '{}'); } catch (e) { return say('JSON sai cú pháp: ' + e.message, true); }
  const err = validateMapping(obj);
  if (err) return say(err, true);
  const user = diffFromPreset(await getPreset(), obj);
  await setSettings({ fboMappingsUser: user });
  say('Đã lưu. ' + Object.keys(user).length + ' loại được chỉnh khác mẫu, các loại còn lại dùng mẫu đi kèm extension.');
};
$('reset-map').onclick = async () => {
  await setSettings({ fboMappingsUser: {} });
  $('mapping').value = JSON.stringify(await getPreset(), null, 2);
  say('Đã khôi phục ánh xạ mặc định đi kèm extension.');
};

let last = '';
$('inspect').onclick = async () => {
  try {
    const r = await inspectActiveTab();
    last = JSON.stringify(r, null, 2);
    $('out').hidden = false; $('out').textContent = last; $('copy').disabled = !r.length;
    say(r.length ? 'Tìm thấy ô nhập ở ' + r.length + ' khung trang.' : 'Không thấy ô nhập nào ở tab đang mở.');
  } catch (e) { say(e.message, true); }
};
$('copy').onclick = async () => { await navigator.clipboard.writeText(last); say('Đã sao chép.'); };
