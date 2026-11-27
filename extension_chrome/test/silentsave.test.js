import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSilentSaver } from '../lib/silentsave.js';

test('cùng dữ liệu chỉ ghi một lần, sửa dữ liệu thì ghi lại', async () => {
  const calls = [];
  const save = createSilentSaver(async (type, data) => { calls.push(data.a); return { period: '2026-11', fileId: 'f1' }; });
  assert.deepEqual(await save('CCCD', { a: 1 }, ['f1']), { period: '2026-11', fileId: 'f1' });
  await save('CCCD', { a: 1 }, ['f1']);
  await save('CCCD', { a: 2 }, ['f1']);
  assert.deepEqual(calls, [1, 2]);
});
test('ghi lỗi thì trả null (không ném lỗi) và lần sau thử lại', async () => {
  let n = 0;
  const save = createSilentSaver(async () => { if (++n === 1) throw new Error('mạng'); return {}; });
  assert.equal(await save('CCCD', {}, ['f1']), null);
  assert.equal((await save('CCCD', {}, ['f1'])).fileId, 'f1');
  assert.equal(n, 2);
});
test('không có tệp gốc (quét không đăng nhập) thì không ghi', async () => {
  const save = createSilentSaver(async () => { throw new Error('không được gọi'); });
  assert.equal(await save('CCCD', {}, []), null);
});
test('giao diện không còn nút Lưu hay thông báo đã lưu', () => {
  const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.ok(!/btn-save/.test(read('sidepanel.html') + read('sidepanel.js')));
  assert.ok(!/['`][^'`\n]*(Đã lưu|chỉ lưu|Đang lưu)/.test(read('sidepanel.js')));
});
