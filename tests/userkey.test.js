// Khoá API riêng theo tài khoản: chỉ dùng khoá đó, không mượn khoá chung; ADMIN khai/xoá.
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const SHARED = 'AIzaSy' + 'A'.repeat(33), OWN = 'AIzaSy' + 'C'.repeat(33);
const props = { GEMINI_API_KEY: SHARED, GEMINI_FALLBACK_MODEL: 'off' };
const store = {}; let plan = []; const sent = [];
const resp = (c, t) => ({ getResponseCode: () => c, getContentText: () => t || '{}' });
const OK = resp(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"so_cccd":"9"}' }] } }] }));
const ctx = {
  console: { log() {}, error() {} },
  Utilities: { sleep() {}, formatDate: () => '00:00:00', computeDigest: (a, s) => Array.from(require('crypto').createHash('sha256').update(String(s)).digest()), base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'), DigestAlgorithm: { SHA_256: 1 } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; }, getProperties: () => Object.assign({}, props) }) },
  CacheService: { getScriptCache: () => ({ get: k => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; } }) },
  UrlFetchApp: { fetch: (u, o) => { sent.push(o.headers['x-goog-api-key']); const r = plan.shift(); if (!r) throw new Error('hết kịch bản'); return r; } }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const js = s => vm.runInContext(s, ctx);
js("requireAdmin_ = () => ({ username: 'admin' }); readUsers_ = () => ({ list: [{ username: 'ctya' }, { username: 'ctyb' }] }); audit_ = () => {};");
const set = (u, p) => js(`setUserAiKey('t', '${u}', ${JSON.stringify(p)})`);
const scan = () => js("callGemini_(DOC_TYPES.CCCD, [{ mimeType: 'image/jpeg', b64: 'x' }])");

assert.throws(() => set('khac', { apiKey: OWN }), /Không tìm thấy/);
assert.throws(() => set('ctya', { apiKey: SHARED }), /khoá chung/);
plan = [resp(400, '{"error":{"message":"API key not valid"}}')];
assert.throws(() => set('ctya', { apiKey: OWN }), /Chưa lưu/);
assert.strictEqual(props.USER_GEMINI_KEY_ctya, undefined);
plan = [OK];
const r = set('ctya', { apiKey: OWN });
assert.strictEqual(r.hint, '••••CCCC');
assert.ok(!JSON.stringify(r).includes(OWN));
assert.throws(() => set('ctyb', { apiKey: OWN }), /ctya/);

js("USER_AI_ = { user: 'ctya', key: userKeyOf_('ctya') }");
sent.length = 0; plan = [OK];
assert.strictEqual(scan().so_cccd, '9');
assert.deepStrictEqual(sent, [OWN]);
sent.length = 0; plan = [resp(429)];     // hết hạn mức khoá riêng: báo lỗi, KHÔNG dùng khoá chung
assert.throws(scan, /Khoá API riêng.*hết hạn mức.*\[\[OWN_QUOTA\]\] \[\[RETRY_AFTER:\d+\]\]$/);
assert.deepStrictEqual(sent, [OWN]);

js('USER_AI_ = null'); sent.length = 0; plan = [OK]; // tài khoản chưa khai khoá: khoá chung
scan();
assert.deepStrictEqual(sent, [SHARED]);

set('ctya', { clear: true });
assert.strictEqual(props.USER_GEMINI_KEY_ctya, undefined);
// khoá dùng thử: chỉ dùng khoá đó, báo lỗi như khoá chung (không nhắc khoá riêng); ghi lại token của lần gọi
const TRIAL = 'AIzaSy' + 'D'.repeat(33);
Object.keys(store).forEach((k) => delete store[k]);
js(`USER_AI_ = { user: '_dung_thu', key: '${TRIAL}', trial: true }; USAGE_ = [];`);
sent.length = 0; plan = [resp(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"so_cccd":"9"}' }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 50 } }))];
scan();
assert.deepStrictEqual(sent, [TRIAL]);
assert.deepStrictEqual(JSON.parse(js('JSON.stringify(USAGE_.map((u) => [u.vao, u.ra]))')), [[1000, 250]]);
plan = [resp(429)];
assert.throws(scan, (e) => /hết hạn mức/.test(e.message) && !/riêng|OWN_QUOTA/.test(e.message));
console.log('userkey.test OK');
