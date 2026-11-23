import { GAS_URL_RE } from './lib/config.js';
import { createGasClient } from './lib/gas.js';
import { getSettings, setSettings, getPreset } from './lib/store.js';
import { inspectActiveTab } from './lib/fbo.js';
import { validateMapping, diffFromPreset } from './lib/mapping.js';

const $ = (id) => document.getElementById(id);
const say = (t, err) => { const m = $('msg'); m.hidden = !t; m.textContent = t || ''; m.className = 'msg' + (err ? '' : ' info'); };

(async function init() {
  const s = await getSettings();
  $('gas').value = s.gasUrl;
  $('mapping').value = JSON.stringify(s.fboMappings || {}, null, 2);
})();

$('save-gas').onclick = async () => {
  const url = $('gas').value.trim();
  if (!GAS_URL_RE.test(url)) return say('Địa chỉ phải có dạng https://script.google.com/macros/s/.../exec', true);
  await setSettings({ gasUrl: url });
  try {
    const cfg = await createGasClient({ getUrl: async () => url })('getAppConfig', []);
    say('Kết nối được. Backend có ' + cfg.types.length + ' loại tài liệu.');
  } catch (e) { say('Đã lưu nhưng chưa kết nối được: ' + e.message, true); }
};

$('grant').onclick = async () => {
  let origin;
  try { origin = new URL($('fbo-origin').value.trim()).origin; } catch { return say('Địa chỉ FBO không hợp lệ.', true); }
  const ok = await chrome.permissions.request({ origins: [origin + '/*'] });
  say(ok ? 'Đã cấp quyền cho ' + origin : 'Chưa được cấp quyền.', !ok);
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

$('reset-map').onclick = async () => {
  await setSettings({ fboMappingsUser: {} });
  $('mapping').value = JSON.stringify(await getPreset(), null, 2);
  say('Đã khôi phục ánh xạ mặc định đi kèm extension.');
};
