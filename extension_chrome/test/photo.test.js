import test from 'node:test';
import assert from 'node:assert/strict';
import { boxToRect, pickTarget } from '../lib/photo.js';

const box = (ymin, xmin, ymax, xmax) => ({ anh_ymin: ymin, anh_xmin: xmin, anh_ymax: ymax, anh_xmax: xmax });

test('boxToRect: đổi khung 0-1000 sang điểm ảnh, nới viền và kẹp trong trang', () => {
  const r = boxToRect(box(50, 50, 250, 250), 1000, 2000, 0);
  assert.deepEqual(r, { x: 50, y: 100, w: 200, h: 400 });
  const p = boxToRect(box(0, 0, 200, 200), 1000, 1000, 0.1); // viền tràn ra ngoài trang thì kẹp lại
  assert.equal(p.x, 0); assert.equal(p.y, 0); assert.equal(p.w, 220); assert.equal(p.h, 220);
});
test('boxToRect: khung sai thì null, không đoán', () => {
  assert.equal(boxToRect({}, 1000, 1000), null);
  assert.equal(boxToRect(box(null, 50, 250, 250), 1000, 1000), null);
  assert.equal(boxToRect(box(250, 50, 50, 250), 1000, 1000), null);   // ngược
  assert.equal(boxToRect(box(0, 0, 1000, 1000), 1000, 1000), null);   // cả trang: AI khoanh nhầm
  assert.equal(boxToRect(box(10, 10, 20, 20), 1000, 1000), null);     // quá nhỏ
  assert.equal(boxToRect(box(-5, 0, 200, 200), 1000, 1000), null);    // ngoài miền 0-1000
  assert.equal(boxToRect(box('a', 'b', 'c', 'd'), 1000, 1000), null);
});
test('pickTarget: tệp/trang AI chỉ, ngoài phạm vi thì về tệp 1 trang 1', () => {
  assert.deepEqual(pickTarget({ anh_tep: 2, anh_trang: 3 }, 2), { file: 2, page: 3 });
  assert.deepEqual(pickTarget({ anh_tep: 5, anh_trang: 0 }, 2), { file: 1, page: 1 });
  assert.deepEqual(pickTarget({}, 1), { file: 1, page: 1 });
});
