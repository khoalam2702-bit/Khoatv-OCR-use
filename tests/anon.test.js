// Quét không cần tài khoản: hạn mức theo ngày / thiết bị, giới hạn chung, tắt bằng 0, hoàn lượt khi lỗi, chỉ ADMIN đổi cấu hình.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), crypto = require('crypto');
const props = {}; let day = '20261125'; const audit = [];
const ctx = {
  console: { log() {}, error() {} },
  Utilities: {
    formatDate: () => day,
    computeDigest: (_a, s) => Array.from(crypto.createHash('sha256').update(String(s)).digest()),
    base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url'),
    DigestAlgorithm: { SHA_256: 1 }
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) },
  __audit: audit, __fail: false, __calls: 0
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const run = (c) => vm.runInContext(c, ctx);
run("requireAdmin_ = function (t) { if (t !== 'adm') throw new Error('Chỉ quản trị viên (ADMIN) được thực hiện thao tác này.'); return { username: 'admin' }; }; audit_ = function (w, a, t, d) { __audit.push([w, a, t, d]); };" +
    "scanCore_ = function (me, payload, anon) { __calls++; if (__fail) throw new Error('Gemini lỗi'); if (!anon) throw new Error('phải là chế độ anon'); if (!/^anon_/.test(me.username)) throw new Error('username sai'); return { data: {}, fileIds: [] }; };");
const call = (fn, ...a) => { ctx.__a = a; return run(`${fn}(...__a)`); };
const D1 = 'device-aaaaaaaaaaaaaaaa', D2 = 'device-bbbbbbbbbbbbbbbb';

// mặc định 10 lượt / ngày / thiết bị
assert.strictEqual(call('getAppConfig').anonPerDay, 10);
for (let i = 1; i <= 10; i++) { const r = call('scanAnonymous', D1, {}); assert.strictEqual(r.anon.used, i); assert.strictEqual(r.anon.limit, 10); assert.deepStrictEqual(Array.from(r.fileIds), []); }
assert.throws(() => call('scanAnonymous', D1, {}), /hết 10 lượt/);
assert.strictEqual(ctx.__calls, 10, 'lượt thứ 11 không được gọi quét');
// thiết bị khác vẫn quét được
assert.strictEqual(call('scanAnonymous', D2, {}).anon.used, 1);
// sang ngày mới: đặt lại
day = '20261126';
assert.strictEqual(call('scanAnonymous', D1, {}).anon.used, 1);
// mã thiết bị sai định dạng
assert.throws(() => call('scanAnonymous', 'x', {}), /Mã thiết bị/);
assert.throws(() => call('scanAnonymous', '', {}), /Mã thiết bị/);
// quét lỗi thì hoàn lượt
ctx.__fail = true;
assert.throws(() => call('scanAnonymous', D2, {}), /Gemini lỗi/);
ctx.__fail = false;
assert.strictEqual(call('scanAnonymous', D2, {}).anon.used, 1, 'lượt lỗi không bị tính');
// chỉ ADMIN xem / đổi cấu hình
assert.throws(() => call('getAnonConfig', 'x'), /ADMIN/);
assert.throws(() => call('setAnonConfig', 'x', { perDevice: 3 }), /ADMIN/);
// đổi hạn mức: 2 lượt / thiết bị
let v = call('setAnonConfig', 'adm', { perDevice: 2 });
assert.strictEqual(v.perDevice, 2); assert.strictEqual(call('getAppConfig').anonPerDay, 2);
assert.ok(audit.some((a) => a[1] === 'DOI_HAN_MUC_AN_DANH'));
assert.strictEqual(call('scanAnonymous', D1, {}).anon.used, 2); // D1 đã dùng 1 hôm nay, còn 1 lượt
assert.throws(() => call('scanAnonymous', D1, {}), /hết 2 lượt/);
// giới hạn chung chặn cả thiết bị mới; 0 = tắt
call('setAnonConfig', 'adm', { perDevice: 10, global: 0 });
assert.throws(() => call('scanAnonymous', 'device-cccccccccccccccc', {}), /đang tắt/);
call('setAnonConfig', 'adm', { global: 3 });
assert.throws(() => call('scanAnonymous', 'device-cccccccccccccccc', {}), /giới hạn chung/);
assert.throws(() => call('setAnonConfig', 'adm', { perDevice: -1 }), /số nguyên/);
assert.throws(() => call('setAnonConfig', 'adm', { perDevice: 1.5 }), /số nguyên/);
console.log('anon test ok');
