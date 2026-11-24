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
