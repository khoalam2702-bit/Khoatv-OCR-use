const vm = require('vm'), fs = require('fs'), assert = require('assert');
const ctx = { console: { log() {}, error() {} }, __seq: [], __slept: [] };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
vm.runInContext("UrlFetchApp = { fetch: function () { var c = __seq.shift(); return { getResponseCode: function () { return c; } }; } }; Utilities = { sleep: function (ms) { __slept.push(ms); } };", ctx);
const run = (seq, failover) => { ctx.__seq = seq.slice(); ctx.__slept.length = 0; vm.runInContext('resetFetchStats_()', ctx); const code = vm.runInContext('fetchRetry_("u", {}, ' + !!failover + ').getResponseCode()', ctx); return { code, stats: JSON.parse(vm.runInContext('JSON.stringify(FETCH_STATS_)', ctx)), slept: ctx.__slept.length }; };

// 503 liên tiếp, không có khoá khác: thử lại 4 lần, có chờ
let r = run([503, 503, 503, 503]);
assert.strictEqual(r.code, 503); assert.strictEqual(r.stats.calls, 4); assert.strictEqual(r.slept, 3);
// Còn khoá khác: trả về ngay để chuyển khoá, không chờ
r = run([503, 200], true);
assert.strictEqual(r.code, 503); assert.strictEqual(r.stats.calls, 1); assert.strictEqual(r.slept, 0);
r = run([429], true);
assert.strictEqual(r.code, 429); assert.strictEqual(r.slept, 0);
// Lỗi tạm rồi thành công
r = run([503, 200]);
assert.strictEqual(r.code, 200); assert.strictEqual(r.stats.retries, 1);
console.log('fetchstats ok');
