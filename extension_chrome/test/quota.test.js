import test from 'node:test';
import assert from 'node:assert/strict';
import { splitRetry, formatWait } from '../lib/quota.js';

test('splitRetry tách dấu hiệu chờ', () => {
  assert.deepEqual(splitRetry('Gemini hết hạn mức. [[RETRY_AFTER:34]]'), { text: 'Gemini hết hạn mức.', seconds: 34 });
  assert.deepEqual(splitRetry('Lỗi khác'), { text: 'Lỗi khác', seconds: null });
  assert.deepEqual(splitRetry(null), { text: '', seconds: null });
});
test('formatWait', () => {
  assert.equal(formatWait(95), '01:35');
  assert.equal(formatWait(0), '00:00');
  assert.equal(formatWait(0.2), '00:01');
  assert.equal(formatWait(27000), '7 giờ 30 phút 00 giây');
});

test('giờ đặt lại hạn mức ngày theo giờ Việt Nam: mùa đông 15:00, mùa hè 14:00', async () => {
  const { dailyResetTime } = await import('../lib/quota.js');
  assert.equal(dailyResetTime(new Date('2026-11-26T08:56:00Z'), 'Asia/Ho_Chi_Minh'), '15:00');
  assert.equal(dailyResetTime(new Date('2026-07-10T03:00:00Z'), 'Asia/Ho_Chi_Minh'), '14:00');
});

test('splitRetry: nhận ra hết hạn mức khoá riêng và bỏ dấu hiệu khỏi thông báo', () => {
  assert.deepEqual(splitRetry('Hết hạn mức. [[OWN_QUOTA]] [[RETRY_AFTER:60]]'), { text: 'Hết hạn mức.', seconds: 60, ownQuota: true });
  assert.equal(splitRetry('Lỗi khác [[RETRY_AFTER:5]]').ownQuota, undefined);
});
