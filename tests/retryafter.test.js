const vm = require('vm'), fs = require('fs'), assert = require('assert');
const ctx = { console: { log() {}, error() {} }, Utilities: { formatDate: () => '16:30:00' } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const run = (c) => vm.runInContext(c, ctx);
const body = (details) => JSON.stringify({ error: { code: 429, details } });

// RetryInfo -> dùng retryDelay (làm tròn lên)
assert.strictEqual(run(`retryAfterSec_(${JSON.stringify(body([{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34.2s' }]))}, 0)`), 35);
// PerDay -> đến 0h giờ Thái Bình Dương (16:30 -> còn 7h30 = 27000s)
assert.strictEqual(run(`retryAfterSec_(${JSON.stringify(body([{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel' }] }, { retryDelay: '10s' }]))}, 0)`), 27000);
// Không có thông tin / thân không phải JSON -> 60s
assert.strictEqual(run("retryAfterSec_('<html>', 0)"), 60);
assert.strictEqual(run(`retryAfterSec_(${JSON.stringify(body([]))}, 0)`), 60);
assert.strictEqual(run("retryMarker_(34.4)"), ' [[RETRY_AFTER:34]]');
console.log('retryafter.test OK');
