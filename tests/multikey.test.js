const vm = require('vm'), fs = require('fs'), assert = require('assert');
const props = {}; const fetches = []; let plan = []; const store = {}; let nowMs = 5000000;
const resp = (code, text) => ({ getResponseCode: () => code, getContentText: () => text });
const ctx = {
  console: { log() {}, error() {} },
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [nowMs])); } static now() { return nowMs; } },
  Utilities: { sleep() {}, formatDate: () => '00:00:00', base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'), computeDigest: (a, s) => Array.from(require('crypto').createHash('sha256').update(String(s)).digest()), DigestAlgorithm: { SHA_256: 1 } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: k => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; } }) },
  UrlFetchApp: { fetch: (url, o) => { fetches.push(o.headers['x-goog-api-key']); const r = plan.shift(); if (!r) throw new Error('hết kịch bản'); return r; } },
  __audit: []
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const run = c => vm.runInContext(c, ctx);
run("requireAdmin_ = function () { return { username: 'admin' }; }; audit_ = function (w, a, t, d) { __audit.push(d); };");
const set = patch => { ctx.__p = patch; return run('setAiConfig("t", __p)'); };
const CALL = "callGemini_(DOC_TYPES.CCCD, [{ mimeType: 'image/jpeg', b64: 'x' }])";
const K = ['M', 'B1', 'B2', 'B3', 'B4'].map((n, i) => 'AIzaSy' + String(n).padEnd(30, String.fromCharCode(65 + i)) + i);
const OK = resp(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"so_cccd":"9"}' }] } }] })), QUOTA = resp(429, '{}');
const J = x => JSON.parse(JSON.stringify(x));
const reset = () => { fetches.length = 0; Object.keys(store).forEach(k => delete store[k]); };

// khai báo đủ 5 khoá một lần (mỗi khoá mới được thử 1 lần)
plan = [OK, OK, OK, OK, OK];
let v = set({ apiKey: K[0], backupKeys: [K[1], K[2], K[3], K[4]] });
assert.deepStrictEqual(fetches, K);
assert.strictEqual(props.GEMINI_API_KEY_BACKUP_4, K[4]);
assert.strictEqual(v.backups.length, 4);
assert.ok(v.backups.every((b, i) => b.set && b.hint === '••••' + K[i + 1].slice(-4)));
assert.strictEqual(v.backup.hint, v.backups[0].hint);
assert.ok(!JSON.stringify(v).includes(K[1]) && !JSON.stringify(ctx.__audit).includes(K[4]), 'không lộ khoá');

// chuỗi: chính, DP1, DP2, DP3 hết hạn mức -> DP4 trả kết quả
reset(); plan = [QUOTA, QUOTA, QUOTA, QUOTA, OK];
assert.strictEqual(run(CALL).so_cccd, '9');
assert.deepStrictEqual(fetches, K);
// ADMIN thấy khoá nào đang nghỉ; khoá đang dùng được thì không có waitSec
v = run('getAiConfig("t")');
assert.ok(v.main.waitSec > 0 && v.backups[2].waitSec > 0 && v.backups[3].waitSec === undefined);
// lần sau: các khoá đang nghỉ bị bỏ qua, dùng thẳng DP4
fetches.length = 0; plan = [OK];
run(CALL);
assert.deepStrictEqual(fetches, [K[4]]);
// cả 5 đều nghỉ: báo ngay, không gọi mạng
reset(); plan = [QUOTA, QUOTA, QUOTA, QUOTA, QUOTA];
assert.throws(() => run(CALL), /hết hạn mức/);
fetches.length = 0;
assert.throws(() => run(CALL), /RETRY_AFTER/);
assert.strictEqual(fetches.length, 0);

// khoá trùng nhau bị từ chối, không lưu gì, không gọi mạng
reset(); plan = [];
assert.throws(() => set({ backupKeys: ['', K[1]] }), /trùng/); // DP2 = K1 trùng DP1
assert.throws(() => set({ backupKeys: [K[0]] }), /trùng với khoá chính/);
assert.strictEqual(fetches.length, 0);
assert.strictEqual(props.GEMINI_API_KEY_BACKUP_2, K[2]);

// xoá DP2, DP3; giữ nguyên phần tử rỗng; tên cũ backupKey/clearBackup vẫn chạy
v = set({ clearBackups: [2, 3] });
assert.strictEqual(props.GEMINI_API_KEY_BACKUP_2, undefined); assert.strictEqual(props.GEMINI_API_KEY_BACKUP_3, undefined);
assert.strictEqual(props.GEMINI_API_KEY_BACKUP, K[1]); assert.strictEqual(props.GEMINI_API_KEY_BACKUP_4, K[4]);
assert.deepStrictEqual(J(v.backups.map(b => b.set)), [true, false, false, true]);
v = set({ clearBackup: true });
assert.strictEqual(props.GEMINI_API_KEY_BACKUP, undefined);
reset(); nowMs += 7200 * 1000; plan = [OK];
run(CALL);
assert.deepStrictEqual(fetches, [K[0]]);

// testAiConfig liệt kê đủ 5 ô
reset(); plan = [OK, OK];
const rows = run('testAiConfig("t")');
assert.deepStrictEqual(J(rows.map(r => r.slot)), ['main', 'backup1', 'backup2', 'backup3', 'backup4']);
assert.deepStrictEqual(J(rows.map(r => r.set)), [true, false, false, false, true]);
console.log('multikey.test OK');
