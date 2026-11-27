const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const cache = new Map(); let n = 0;
const ctx = { console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
  Utilities: { getUuid: () => (++n).toString(16).padStart(32, '0') } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
vm.runInContext(`withLock_ = function (f) { return f(); };
  auth_ = function (t) { if (t !== 'ok') throw new Error('SESSION_EXPIRED'); return { username: 'an' }; };
  findUser_ = function (u) { return u === 'an' ? { username: 'an', active: true, role: 'USER', token_ver: 1 } : null; };`, ctx);
const f = (name) => vm.runInContext(name, ctx);
assert.throws(() => f('createWebHandoff')('sai'), /SESSION_EXPIRED/);
const { code } = f('createWebHandoff')('ok');
assert.match(code, /^[a-f0-9]{64}$/);
assert.strictEqual(f('redeemWebHandoff')('x'), null);
const r = f('redeemWebHandoff')(code);
assert.strictEqual(r.me.username, 'an'); assert.match(r.token, /^[a-f0-9]{64}$/);
assert.strictEqual(f('redeemWebHandoff')(code), null); // chỉ dùng một lần
// bậc thang: chưa lưu thì có 6 bậc đề xuất, đơn giá giảm dần
const tiers = f('creditTiers_')();
assert.strictEqual(tiers.length, 6);
const unit = Array.from(tiers, t => t.amount / t.credits);
assert.deepStrictEqual(unit, [...unit].sort((a, b) => b - a));
assert.ok(Array.from(tiers).every(t => /^[A-Za-z0-9-]{4,40}$/.test(t.id)));
console.log('handoff OK');
