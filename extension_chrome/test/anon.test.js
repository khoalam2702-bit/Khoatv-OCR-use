import test from 'node:test';
import assert from 'node:assert/strict';

// storage giả: local và session tách biệt (session mất khi đóng trình duyệt)
function area() {
  const m = {};
  return {
    m,
    get: async (k) => (typeof k === 'string' ? (k in m ? { [k]: m[k] } : {}) : Object.fromEntries(Object.entries(k || {}).map(([a, d]) => [a, a in m ? m[a] : d]))),
    set: async (o) => { Object.assign(m, o); },
    remove: async (k) => { for (const x of [].concat(k)) delete m[x]; }
  };
}
const local = area(), session = area();
globalThis.chrome = { storage: { local, session }, runtime: { getURL: (p) => p } };
const store = await import('../lib/store.js');

test('mã thiết bị: sinh một lần, lưu ở local và giữ nguyên', async () => {
  const a = await store.getDeviceId(), b = await store.getDeviceId();
  assert.equal(a, b);
  assert.match(a, /^[A-Za-z0-9-]{16,64}$/); // đúng định dạng backend chấp nhận
  assert.equal(local.m.deviceId, a);
  assert.equal(session.m.deviceId, undefined);
});
test('chế độ và bản nháp không tài khoản chỉ nằm ở session, tắt chế độ thì xoá bản nháp', async () => {
  assert.equal(await store.getAnonMode(), false);
  await store.setAnonMode(true);
  await store.setAnonDraft({ type: 'CCCD', data: { so_cccd: '1' } });
  assert.equal(await store.getAnonMode(), true);
  assert.deepEqual(await store.getAnonDraft(), { type: 'CCCD', data: { so_cccd: '1' } });
  assert.equal(local.m.anonMode, undefined); assert.equal(local.m.anonDraft, undefined);
  await store.setAnonMode(false);
  assert.equal(await store.getAnonMode(), false);
  assert.equal(await store.getAnonDraft(), null);
});
test('gọi API: không tài khoản dùng scanAnonymous (không token); có tài khoản dùng scanDocument', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../sidepanel.js', import.meta.url), 'utf8');
  assert.match(src, /call\('scanAnonymous', \[await getDeviceId\(\)/);
  assert.match(src, /api\('scanDocument'/);
  // chế độ không tài khoản không bao giờ gọi saveRecord / updateSyncStatus
  const anonFill = src.slice(src.indexOf('async function doFill'), src.indexOf('Dò form: liệt kê'));
  assert.match(anonFill, /if \(!state\.saved\.anon\)/);
  assert.ok(!/saveRecord/.test(anonFill));
});
