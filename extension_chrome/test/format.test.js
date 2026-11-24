import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, parseNumber, numberToText, dmyToIso, toFormValues, fromFormValues, missingRequired } from '../lib/format.js';
import { validateMapping, hasMapping, effectiveMappings, diffFromPreset } from '../lib/mapping.js';

test('normalizeText bỏ dấu và đ', () => { assert.equal(normalizeText('  Đà  Nẵng '), 'da nang'); });
test('parseNumber: tiền dùng dấu chấm ngăn nghìn', () => {
  assert.equal(parseNumber('1.234.567', true), 1234567);
  assert.equal(parseNumber('12,5', false), 12.5);
  assert.equal(parseNumber('', false), null);
  assert.ok(Number.isNaN(parseNumber('abc', false)));
});
test('numberToText', () => { assert.equal(numberToText(12.5, false), '12.5'); assert.equal(numberToText(null, true), ''); });
test('dmyToIso', () => { assert.equal(dmyToIso('5/3/2026'), '2026-03-05'); assert.equal(dmyToIso('abc'), 'abc'); });
const fields = [{ k: 'ho_ten', type: 'string' }, { k: 'khoi_luong', type: 'number' }, { k: 'tien', type: 'number', money: true }];
test('toFormValues / fromFormValues khứ hồi', () => {
  const v = toFormValues(fields, { ho_ten: 'A', khoi_luong: 12.5, tien: null });
  assert.deepEqual(v, { ho_ten: 'A', khoi_luong: '12.5', tien: '' });
  const r = fromFormValues(fields, { ho_ten: ' B ', khoi_luong: '12,5', tien: '1.000' });
  assert.deepEqual(r.data, { ho_ten: 'B', khoi_luong: 12.5, tien: 1000 });
  assert.deepEqual(r.errors, []);
});
test('fromFormValues báo trường số sai', () => {
  const r = fromFormValues(fields, { ho_ten: '', khoi_luong: 'x', tien: '' });
  assert.deepEqual(r.errors, ['khoi_luong']);
  assert.equal(r.data.ho_ten, null); assert.equal(r.data.tien, null);
});
test('missingRequired', () => { assert.deepEqual(missingRequired(['a', 'b'], { a: 1, b: null }), ['b']); });
test('validateMapping', () => {
  const ok = () => true, bad = () => false;
  assert.equal(validateMapping({ CCCD: { so_cccd: '#a', gt: { selector: '#b', map: {} } } }, ok), '');
  assert.match(validateMapping([], ok), /đối tượng/);
  assert.match(validateMapping({ CCCD: { x: {} } }, ok), /thiếu selector/);
  assert.equal(validateMapping({ CCCD: { ho_ten: [{ selector: '#a', transform: 'name_head' }, '#b'] } }, ok), '');
  assert.match(validateMapping({ CCCD: { ho_ten: [{ selector: '#a' }, {}] } }, ok), /thiếu selector/);
  assert.match(validateMapping({ CCCD: { x: '#a' } }, bad), /không hợp lệ/);
});

test('preset FBO HRM nhân viên hợp lệ', async () => {
  const fs = await import('node:fs');
  const preset = JSON.parse(fs.readFileSync(new URL('../presets/fbo-hrm.json', import.meta.url), 'utf8'));
  assert.equal(validateMapping(preset, () => true), '');
  assert.ok(Array.isArray(preset.CCCD.ho_ten) && preset.CCCD.ho_ten.length === 2);
});

test('preset có GPLX, mỗi mục có ít nhất một selector', async () => {
  const fs = await import('node:fs');
  const preset = JSON.parse(fs.readFileSync(new URL('../presets/fbo-hrm.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(preset).sort(), ['BIEN_SO_XE', 'CCCD', 'CV_UNGVIEN', 'GPLX', 'HO_CHIEU']);
  assert.equal(validateMapping(preset, () => true), '');
});

test('hasMapping', () => {
  assert.equal(hasMapping({ CCCD: { a: '#x' } }, 'CCCD'), true);
  assert.equal(hasMapping({ CCCD: {} }, 'CCCD'), false);
  assert.equal(hasMapping({}, 'HO_CHIEU'), false);
  assert.equal(hasMapping(undefined, 'HO_CHIEU'), false);
});

test('effectiveMappings / diffFromPreset', () => {
  const preset = { CCCD: { a: '#1' }, GPLX: { b: '#2' } };
  assert.deepEqual(effectiveMappings(preset, { GPLX: { b: '#9' }, HO_CHIEU: { c: '#3' } }), { CCCD: { a: '#1' }, GPLX: { b: '#9' }, HO_CHIEU: { c: '#3' } });
  assert.deepEqual(effectiveMappings(preset, undefined), preset);
  assert.deepEqual(diffFromPreset(preset, { CCCD: { a: '#1' }, GPLX: { b: '#9' } }), { GPLX: { b: '#9' } });
});
