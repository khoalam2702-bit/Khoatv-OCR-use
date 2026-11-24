import test from 'node:test';
import assert from 'node:assert/strict';
import { pushDuration, expectedMs, estimatePercent, stageText, DEFAULT_EXPECTED_MS } from '../lib/scanprogress.js';

test('lịch sử giữ 5 lần gần nhất, bỏ giá trị lỗi', () => {
  let h = [];
  for (const x of [1000, 2000, 3000, 4000, 5000, 6000]) h = pushDuration(h, x);
  assert.deepEqual(h, [2000, 3000, 4000, 5000, 6000]);
  assert.deepEqual(pushDuration(['x', null, 500], NaN), [500]);
});
test('expectedMs: trung bình hoặc mặc định', () => {
  assert.equal(expectedMs([]), DEFAULT_EXPECTED_MS);
  assert.equal(expectedMs([10000, 20000]), 15000);
});
test('estimatePercent tối đa 95 cho tới khi xong', () => {
  assert.equal(estimatePercent(0, 20000), 0);
  assert.equal(estimatePercent(10000, 20000), 50);
  assert.equal(estimatePercent(60000, 20000), 95);
  assert.equal(estimatePercent(5, 0), 0);
});
test('stageText: bước, số giây, cảnh báo khi lâu', () => {
  assert.match(stageText('qr', 3200, 20000, 2), /Bước 1\/2.*QR.*3 giây/);
  assert.match(stageText('ai', 5000, 20000, 2), /Bước 2\/2.*2 tệp.*5 giây.*khoảng 20 giây/);
  assert.match(stageText('ai', 40000, 20000, 1), /Lâu hơn thường lệ/);
  assert.doesNotMatch(stageText('ai', 5000, 20000, 1), /Lâu hơn/);
  assert.match(stageText('save', 1000, 3000, 1), /không dùng AI/);
  assert.match(stageText('x', 1000, 20000, 1), /Bước 1\/1/);
});
