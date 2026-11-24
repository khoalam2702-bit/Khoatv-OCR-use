const vm = require('vm'), fs = require('fs'), assert = require('assert');
const props = {}; const fetches = []; let plan = []; let nowMs = 1000000;
const store = {};
const resp = (code, text) => ({ getResponseCode: () => code, getContentText: () => text });
const ctx = {
  console: { log() {}, error() {} },
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [nowMs])); } static now() { return nowMs; } },
  Utilities: {
    sleep() {}, formatDate: () => '00:00:00',
    base64EncodeWebSafe: s => Buffer.from(String(s)).toString('base64'),
    computeDigest: (a, s) => Array.from(Buffer.from(String(s))), DigestAlgorithm: { SHA_256: 1 }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: k => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; } }) },
  UrlFetchApp: { fetch: (url, o) => { fetches.push(o.headers['x-goog-api-key']); const r = plan.shift(); if (!r) throw new Error('hết kịch bản'); return r; } },
  __audit: []
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const run = c => vm.runInContext(c, ctx);
const CALL = "callGemini_(DOC_TYPES.CCCD, [{ mimeType: 'image/jpeg', b64: 'x' }])";
const K1 = 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1', K2 = 'AIzaSyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2';
const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"so_cccd":"1"}' }] } }] });
const OK = resp(200, body), QUOTA = resp(429, '{}');
const reset = () => { fetches.length = 0; Object.keys(store).forEach(k => delete store[k]); };
props.GEMINI_API_KEY = K1; props.GEMINI_API_KEY_BACKUP = K2;

// 1) Khoá chính 429 -> chuyển dự phòng ngay; lần quét sau dùng thẳng dự phòng, KHÔNG gọi lại khoá chính
reset(); plan = [QUOTA, OK, OK];
assert.strictEqual(run(CALL).so_cccd, '1');
assert.deepStrictEqual(fetches, [K1, K2]);
assert.strictEqual(run(CALL).so_cccd, '1');
assert.deepStrictEqual(fetches, [K1, K2, K2]);

// 2) Hết thời gian nghỉ: khoá chính được thử lại và quay về làm khoá đầu tiên
nowMs += 61 * 1000; plan = [OK];
run(CALL);
assert.deepStrictEqual(fetches.slice(3), [K1]);

// 3) Cả hai khoá đều hết hạn mức: lần sau báo ngay (không gọi mạng) kèm đồng hồ đếm ngược
reset(); plan = [QUOTA, QUOTA];
assert.throws(() => run(CALL), /hết hạn mức.*RETRY_AFTER/);
assert.deepStrictEqual(fetches, [K1, K2]);
fetches.length = 0;
assert.throws(() => run(CALL), /hết hạn mức.*RETRY_AFTER:\d+/);
assert.strictEqual(fetches.length, 0, 'mọi khoá đang nghỉ thì không được gọi mạng');

// 4) Lỗi 5xx cũng chuyển khoá dự phòng
reset(); nowMs += 3600 * 1000; plan = [resp(503, '{}'), OK]; // còn khoá khác: gặp 503 chuyển khoá ngay, không chờ thử lại cùng khoá
assert.strictEqual(run(CALL).so_cccd, '1');
assert.strictEqual(fetches[fetches.length - 1], K2);

// 5) ADMIN đổi khoá/gói: trạng thái nghỉ được xoá
reset(); nowMs += 3600 * 1000; plan = [QUOTA, QUOTA];
assert.throws(() => run(CALL), /hết hạn mức/);
run("requireAdmin_ = function () { return { username: 'admin' }; }; audit_ = function () {};");
plan = [OK]; // testGeminiKey_ cho khoá mới
ctx.__p = { apiKey: K1, tier: 'paid' };
run('setAiConfig("t", __p)');
fetches.length = 0; plan = [OK];
assert.strictEqual(run(CALL).so_cccd, '1');
assert.deepStrictEqual(fetches, [K1], 'sau khi ADMIN đổi cấu hình, khoá chính được dùng lại ngay');

console.log('keycooldown.test OK');
