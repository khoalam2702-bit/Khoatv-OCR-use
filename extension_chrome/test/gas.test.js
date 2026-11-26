import test from 'node:test';
import assert from 'node:assert/strict';
import { createGasClient, GasError } from '../lib/gas.js';

const resp = (obj, raw) => ({ text: async () => raw ?? JSON.stringify(obj) });

test('gửi POST text/plain kèm client=EXTENSION và trả data', async () => {
  let seen;
  const call = createGasClient({ getUrl: async () => 'https://x/exec', fetchImpl: async (u, o) => { seen = { u, o }; return resp({ ok: true, data: { a: 1 } }); } });
  assert.deepEqual(await call('listRecords', ['t', 'CCCD']), { a: 1 });
  assert.equal(seen.o.method, 'POST');
  assert.match(seen.o.headers['Content-Type'], /^text\/plain/);
  assert.deepEqual(JSON.parse(seen.o.body), { action: 'listRecords', args: ['t', 'CCCD'], client: 'EXTENSION' });
});
test('chưa có URL', async () => {
  const call = createGasClient({ getUrl: async () => '', fetchImpl: async () => resp({}) });
  await assert.rejects(call('x'), (e) => e instanceof GasError && e.code === 'NO_URL');
});
test('mã lỗi SESSION_EXPIRED / MUST_CHANGE_PASSWORD', async () => {
  for (const code of ['SESSION_EXPIRED', 'MUST_CHANGE_PASSWORD']) {
    const call = createGasClient({ getUrl: async () => 'u', fetchImpl: async () => resp({ ok: false, error: code }) });
    await assert.rejects(call('x'), (e) => e.code === code);
  }
});
test('lỗi nghiệp vụ giữ nguyên thông báo, không có code', async () => {
  const call = createGasClient({ getUrl: async () => 'u', fetchImpl: async () => resp({ ok: false, error: 'Sai tên đăng nhập hoặc mật khẩu.' }) });
  await assert.rejects(call('login'), (e) => e.message === 'Sai tên đăng nhập hoặc mật khẩu.' && e.code === '');
});
test('phản hồi không phải JSON và lỗi mạng', async () => {
  const a = createGasClient({ getUrl: async () => 'u', fetchImpl: async () => resp(null, '<html>') });
  await assert.rejects(a('x'), (e) => e.code === 'BAD_RESPONSE');
  const b = createGasClient({ getUrl: async () => 'u', fetchImpl: async () => { throw new Error('down'); } });
  await assert.rejects(b('x'), (e) => e.code === 'NETWORK');
});

test('hết thời gian chờ báo TIMEOUT, không báo lỗi mạng', async () => {
  const call = createGasClient({ getUrl: async () => 'u', fetchImpl: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; } });
  await assert.rejects(call('scanDocument'), (e) => e.code === 'TIMEOUT' && /120 giây/.test(e.message));
  await assert.rejects(call('saveRecord'), (e) => e.code === 'TIMEOUT' && /110 giây/.test(e.message));
});

test('rớt mạng: thao tác chỉ đọc tự thử lại một lần, quét thì không', async () => {
  let n = 0;
  const call = createGasClient({ getUrl: async () => 'u', retryWaitMs: 0, fetchImpl: async () => { n++; if (n === 1) throw new TypeError('Failed to fetch'); return resp({ ok: true, data: 1 }); } });
  assert.equal(await call('getAppConfig'), 1);
  assert.equal(n, 2);
  n = 0;
  await assert.rejects(call('scanAnonymous'), (e) => e.code === 'NETWORK');
  assert.equal(n, 1);
});

test('bấm Dừng: huỷ yêu cầu đang chạy và báo CANCELLED', async () => {
  const stop = new AbortController();
  const call = createGasClient({ getUrl: async () => 'u', fetchImpl: (u, o) => new Promise((_, reject) => {
    o.signal.addEventListener('abort', () => reject(o.signal.reason), { once: true });
    setTimeout(() => stop.abort(), 5);
  }) });
  await assert.rejects(call('scanAnonymous', [], { signal: stop.signal }), (e) => e.code === 'CANCELLED');
});
