import test from 'node:test';
import assert from 'node:assert/strict';
import { mappingSelectors, classifyForm, withTimeout, importantOverwrites, FORM_WAIT_MS, FILL_TIMEOUT_MS } from '../lib/formcheck.js';

test('giới hạn thời gian đúng như đã báo', () => { assert.equal(FORM_WAIT_MS, 10000); assert.equal(FILL_TIMEOUT_MS, 20000); });
test('mappingSelectors: gộp mọi dạng, bỏ trùng', () => {
  assert.deepEqual(mappingSelectors({ a: '#x', b: { selector: '#y' }, c: ['#x', { selector: '#z' }], d: { fixed: '1' } }).sort(), ['#x', '#y', '#z']);
  assert.deepEqual(mappingSelectors(null), []);
});
test('classifyForm: đủ / chưa mở / sai form', () => {
  assert.equal(classifyForm(8, 10), 'READY');
  assert.equal(classifyForm(5, 10), 'READY');
  assert.equal(classifyForm(0, 10), 'NO_FORM');
  assert.equal(classifyForm(2, 10), 'WRONG_FORM');
  assert.equal(classifyForm(0, 0), 'READY');
});
test('withTimeout: quá hạn thì lỗi, kịp hạn thì trả kết quả', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50, 'x'), 7);
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'Hết thời gian chờ'), /Hết thời gian chờ/);
});
test('importantOverwrites chỉ giữ trường bắt buộc', () => {
  const l = [{ k: 'ho_ten', old: 'a', v: 'b' }, { k: 'dia_chi', old: 'c', v: 'd' }];
  assert.deepEqual(importantOverwrites(l, ['ho_ten', 'so_cccd']), [l[0]]);
  assert.deepEqual(importantOverwrites(l, []), []);
});
