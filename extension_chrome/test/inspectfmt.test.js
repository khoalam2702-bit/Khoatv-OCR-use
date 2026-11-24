import test from 'node:test';
import assert from 'node:assert/strict';
import { formatInspect, countControls } from '../lib/inspectfmt.js';

const frames = [{ url: 'https://x/y', title: 'Form', controls: [
  { tag: 'input', type: 'text', id: 'a_dirExtender_form_cmnd_so', name: '', label: 'Số CCCD', visible: true },
  { tag: 'select', type: 'select-one', id: 'b_gt', label: 'Giới tính', visible: false, options: ['1|Nam', '2|Nữ'] },
  { tag: 'textarea', type: 'textarea', id: '', name: 'ghi_chu', placeholder: 'Ghi chú', visible: true }
] }];
test('formatInspect: mỗi ô một dòng, đánh dấu ô ẩn và liệt kê lựa chọn', () => {
  const t = formatInspect(frames).split('\n');
  assert.equal(t[0], '# Khung 1: Form https://x/y');
  assert.equal(t[1], 'a_dirExtender_form_cmnd_so | input/text | Số CCCD');
  assert.equal(t[2], 'b_gt | select/select-one | Giới tính | ẩn | chọn: 1|Nam; 2|Nữ');
  assert.equal(t[3], 'ghi_chu | textarea | Ghi chú');
  assert.equal(countControls(frames), 3);
  assert.equal(formatInspect(null), '');
});
