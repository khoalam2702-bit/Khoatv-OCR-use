const vm = require('vm'), fs = require('fs'), assert = require('assert');
const props = {}; const fetches = []; let plan = [];
const resp = (code, text) => ({ getResponseCode: () => code, getContentText: () => text });
const ctx = {
  console: { log() {}, error() {} },
  Utilities: { sleep() {}, formatDate: () => '00:00:00' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  UrlFetchApp: { fetch: (url, o) => { fetches.push({ url, key: o.headers['x-goog-api-key'] }); const r = plan.shift(); if (!r) throw new Error('hết kịch bản'); return r; } },
  __audit: []
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const run = c => vm.runInContext(c, ctx);
run("requireAdmin_ = function (t) { if (t !== 'adm') throw new Error('Chỉ quản trị viên (ADMIN) được thực hiện thao tác này.'); return { username: 'admin' }; }; audit_ = function (w, a, t, d) { __audit.push([w, a, t, d]); };");
const call = (fn, ...a) => { ctx.__a = a; return run(`${fn}(...__a)`); };
const OK = resp(200, '{}'), BAD = resp(400, '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}'), QUOTA = resp(429, '{}');
const K1 = 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1', K2 = 'AIzaSyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2';

// chỉ ADMIN
assert.throws(() => call('getAiConfig', 'x'), /ADMIN/);
assert.throws(() => call('setAiConfig', 'x', { apiKey: K1 }), /ADMIN/);
// định dạng khoá sai: không gọi mạng
assert.throws(() => call('setAiConfig', 'adm', { apiKey: 'có khoảng trắng' }), /định dạng/);
assert.strictEqual(fetches.length, 0);
// khoá sai bị Gemini từ chối: không lưu gì
plan = [BAD];
assert.throws(() => call('setAiConfig', 'adm', { apiKey: K1, tier: 'paid' }), /Chưa lưu thay đổi nào/);
assert.strictEqual(props.GEMINI_API_KEY, undefined); assert.strictEqual(props.GEMINI_TIER, undefined);
// khoá đúng: lưu, kèm gói; không lộ khoá, chỉ 4 ký tự cuối
plan = [OK];
let v = call('setAiConfig', 'adm', { apiKey: K1, tier: 'paid' });
assert.strictEqual(props.GEMINI_API_KEY, K1); assert.strictEqual(v.tier, 'paid');
assert.deepStrictEqual(JSON.parse(JSON.stringify(v.main)), { set: true, hint: '••••AAA1'.replace('AAA1', K1.slice(-4)) });
assert.ok(!JSON.stringify(v).includes(K1));
assert.ok(!JSON.stringify(ctx.__audit).includes(K1), 'nhật ký không được chứa khoá');
// 429 vẫn tính là khoá hợp lệ (cảnh báo)
plan = [QUOTA];
v = call('setAiConfig', 'adm', { backupKey: K2 });
assert.strictEqual(props.GEMINI_API_KEY_BACKUP, K2); assert.ok(v.tested[0].includes('hết hạn mức'));
// xoá khoá dự phòng không cần gọi mạng; model đổi được
fetches.length = 0;
v = call('setAiConfig', 'adm', { clearBackup: true, model: 'gemini-3.6-flash' });
assert.strictEqual(props.GEMINI_API_KEY_BACKUP, undefined); assert.strictEqual(fetches.length, 0);
assert.throws(() => call('setAiConfig', 'adm', { model: 'a b' }), /model/);

// callGemini_: khoá chính 429 -> chuyển ngay khoá dự phòng, không chờ thử lại
props.GEMINI_API_KEY_BACKUP = K2; fetches.length = 0;
const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"so_cccd":"1"}' }] } }] });
plan = [QUOTA, resp(200, body)];
const out = run("callGemini_(DOC_TYPES.CCCD, [{ mimeType: 'image/jpeg', b64: 'x' }])");
assert.strictEqual(out.so_cccd, '1');
assert.deepStrictEqual(fetches.map(f => f.key), [K1, K2]);
// chỉ có khoá chính: giữ cơ chế cũ (thử lại 4 lần rồi báo hết hạn mức)
delete props.GEMINI_API_KEY_BACKUP; fetches.length = 0;
plan = [QUOTA, QUOTA, QUOTA, QUOTA];
assert.throws(() => run("callGemini_(DOC_TYPES.CCCD, [{ mimeType: 'image/jpeg', b64: 'x' }])"), /hết hạn mức/);
assert.strictEqual(fetches.length, 4);
// khoá sai khi chạy: thông báo hướng dẫn quản trị viên
fetches.length = 0; plan = [BAD];
assert.throws(() => run("callGemini_(DOC_TYPES.CCCD, [{ mimeType: 'image/jpeg', b64: 'x' }])"), /Cài đặt AI/);
console.log('aiconfig.test OK');
