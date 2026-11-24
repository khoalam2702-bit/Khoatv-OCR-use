import test from 'node:test';
import assert from 'node:assert/strict';
import { mappingSelectors, classifyForm, withTimeout, importantOverwrites, FORM_WAIT_MS, STEP_TIMEOUT_MS, STABLE_POLLS } from '../lib/formcheck.js';

test('giới hạn thời gian đúng như đã báo', () => { assert.equal(FORM_WAIT_MS, 10000); assert.equal(STEP_TIMEOUT_MS, 15000); assert.equal(STABLE_POLLS, 2); });
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

import { abortable, FillStopped } from '../lib/formcheck.js';
test('abortable: dừng ngay khi bấm Dừng, kể cả promise chưa xong', async () => {
  const c = new AbortController();
  const p = abortable(new Promise(() => {}), c.signal);
  c.abort();
  await assert.rejects(p, (e) => e instanceof FillStopped);
  await assert.rejects(abortable(Promise.resolve(1), c.signal), (e) => e instanceof FillStopped); // đã abort từ trước
  assert.equal(await abortable(Promise.resolve(5), new AbortController().signal), 5);
  assert.equal(await abortable(Promise.resolve(6), undefined), 6);
});

import { mappingVariants, pickVariant, formLabel } from '../lib/formcheck.js';
import fs from 'node:fs';
const PRESET = JSON.parse(fs.readFileSync(new URL('../presets/fbo-hrm.json', import.meta.url), 'utf8'));
test('mappingVariants: bản mặc định đứng đầu, gom biến thể theo hậu tố', () => {
  const v = mappingVariants(PRESET, 'CCCD');
  assert.deepEqual(v.map((x) => x.variant), ['', 'UNGVIEN']);
  assert.deepEqual(mappingVariants(PRESET, 'GPLX').map((x) => x.variant), ['']);
  assert.deepEqual(mappingVariants(PRESET, 'KHONG_CO'), []);
});
test('pickVariant: nhận diện form nhân viên và form ứng viên từ ô thấy được', () => {
  const v = mappingVariants(PRESET, 'CCCD');
  const common = mappingSelectors(v[0].mapping).filter((s) => !/_ho_nv"|_ten_nv"/.test(s));
  const nv = pickVariant(v, [...common, '[id$="_dirExtender_form_ho_nv"]', '[id$="_dirExtender_form_ten_nv"]']);
  const uv = pickVariant(v, [...common, '[id$="_dirExtender_form_ho_uv"]', '[id$="_dirExtender_form_ten_uv"]']);
  assert.equal(nv.variant, ''); assert.equal(uv.variant, 'UNGVIEN');
  assert.equal(pickVariant(v, common).variant, ''); // hòa điểm: chọn bản mặc định
});
test('formLabel', () => { assert.equal(formLabel('UNGVIEN'), 'Hồ sơ ứng viên'); assert.equal(formLabel(''), 'Hồ sơ nhân viên'); });
