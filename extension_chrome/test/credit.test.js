import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scanCost, creditStatus, createCharger } from '../lib/credit.js';
import { splitRetry } from '../lib/quota.js';

test('CV 2 lượt, loại khác 1, chỉ đọc QR không tính', () => {
  assert.equal(scanCost('CV_UNGVIEN'), 2); assert.equal(scanCost('CV_NHANVIEN'), 2);
  assert.equal(scanCost('CCCD'), 1); assert.equal(scanCost('CCCD', true), 0);
});
test('hiển thị lượt và khoá nút Quét', () => {
  assert.equal(creditStatus(null).line, '');
  assert.equal(creditStatus({ unlimited: true }).blocked, false);
  assert.equal(creditStatus({ remaining: 148, low: 20 }).line, 'Còn 148 lượt');
  assert.match(creditStatus({ remaining: 12, low: 20 }).line, /sắp hết/);
  assert.deepEqual([creditStatus({ remaining: 0, low: 20 }).blocked, creditStatus({ remaining: 0, low: 20 }).line], [true, 'Đã hết lượt, liên hệ quản trị viên.']);
  assert.equal(creditStatus({ remaining: 1, low: 0 }, 2).blocked, true);
  assert.equal(creditStatus({ remaining: 1, low: 0 }, 1).blocked, false);
  assert.equal(creditStatus({ remaining: 0, resetAt: 0 }, 0).blocked, false); // chỉ đọc QR
  assert.equal(creditStatus({ remaining: 0, resetAt: 5 }).line, 'Đã hết lượt dùng thử.');
  assert.match(creditStatus({ remaining: 0, resetAt: 0, blocked: true }).line, /đã đăng nhập/);
});
test('báo trừ lượt: lỗi mạng thì giữ phiếu gửi lại, đúng chủ phiếu, phiếu hỏng thì bỏ', async () => {
  let list = [], fail = true; const sent = [], got = [];
  const c = createCharger({
    load: async () => list.slice(), save: async (l) => { list = l; },
    send: async (o, t) => { if (t === 'bad') throw new Error('Phiếu trừ lượt không hợp lệ.'); if (fail) throw new Error('mạng'); sent.push([o, t]); return { remaining: 9 }; },
    onUpdate: (o, v) => got.push(v.remaining)
  });
  await c.charge('u:a', 't1');
  assert.equal(list.length, 1);
  fail = false;
  await c.flush('u:b');
  assert.equal(sent.length, 0);
  await c.flush('u:a');
  assert.deepEqual(sent, [['u:a', 't1']]); assert.equal(list.length, 0); assert.deepEqual(got, [9]);
  await c.charge('u:a', 'bad');
  assert.equal(list.length, 0);
});
test('giao diện: chỉ trừ khi có ô điền được; dấu hiệu hết lượt không hiện ra', () => {
  const src = fs.readFileSync(new URL('../sidepanel.js', import.meta.url), 'utf8');
  assert.match(src, /if \(r\.filled\.length\) chargeNow\(\)/);
  assert.match(src, /deferCharge/);
  assert.deepEqual(splitRetry('Bạn còn 0 lượt. [[OUT_OF_CREDIT]]'), { text: 'Bạn còn 0 lượt.', seconds: null, outOfCredit: true });
});
