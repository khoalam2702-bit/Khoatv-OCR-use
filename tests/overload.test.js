// Gemini quá tải (503): thử hết khoá rồi chờ và thử lại; vẫn lỗi thì báo rõ là lỗi tạm thời.
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const props = { GEMINI_API_KEY: 'AIzaSy' + 'A'.repeat(33), GEMINI_API_KEY_BACKUP: 'AIzaSy' + 'B'.repeat(33) };
const store = {}, sleeps = []; let plan = [], calls = 0;
const resp = (c, t) => ({ getResponseCode: () => c, getContentText: () => t || '{}' });
const OK = resp(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"so_cccd":"9"}' }] } }] })), BUSY = resp(503);
const ctx = {
  console: { log() {}, error() {} },
  Utilities: { sleep: ms => sleeps.push(ms), formatDate: () => '00:00:00', base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'), computeDigest: (a, s) => Array.from(require('crypto').createHash('sha256').update(String(s)).digest()), DigestAlgorithm: { SHA_256: 1 } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
  CacheService: { getScriptCache: () => ({ get: k => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; } }) },
  UrlFetchApp: { fetch: () => { calls++; const r = plan.shift(); if (!r) throw new Error('hết kịch bản'); return r; } }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const run = () => vm.runInContext("callGemini_(DOC_TYPES.CCCD, [{ mimeType: 'image/jpeg', b64: 'x' }])", ctx);
const reset = p => { plan = p; calls = 0; sleeps.length = 0; Object.keys(store).forEach(k => delete store[k]); };

reset([BUSY, BUSY, BUSY, OK]);          // 2 khoá đều 503, thử lại lần 2 thì được
assert.strictEqual(run().so_cccd, '9');
assert.strictEqual(calls, 4);
assert.deepStrictEqual(sleeps, [3000, 8000]);

reset([BUSY, BUSY, BUSY, BUSY, BUSY]);   // quá tải suốt: dừng sau 3 lần chờ, báo lỗi dễ hiểu
assert.throws(run, /quá tải \(lỗi 503\)/);
assert.strictEqual(calls, 5);
assert.deepStrictEqual(sleeps, [3000, 8000, 15000]);
console.log('overload.test OK');
