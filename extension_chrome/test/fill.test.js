import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const src = fs.readFileSync(new URL('../content/page.js', import.meta.url), 'utf8');
function page(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.globalThis = dom.window;
  dom.window.eval(src);
  return dom.window;
}
const plain = (x) => JSON.parse(JSON.stringify(x));
const HTML = `<form>
  <label for="ten">Họ tên</label><input id="ten">
  <input id="ns" type="date">
  <input name="cccd">
  <select id="gt"><option value="">--</option><option value="1">Nam</option><option value="0">Nữ</option></select>
  <textarea id="dc"></textarea>
  <input type="radio" name="q" id="q1" value="VN"><input type="radio" name="q" id="q2" value="US">
  <input type="checkbox" id="vip">
</form>`;

test('điền ô văn bản, ngày, select (map + không dấu), textarea, radio, checkbox', () => {
  const w = page(HTML);
  const events = [];
  w.document.getElementById('ten').addEventListener('input', () => events.push('input'));
  w.document.getElementById('ten').addEventListener('change', () => events.push('change'));
  const r = w.__KHOATV_FILL__({
    ho_ten: '#ten', ngay_sinh: '#ns', so: { selector: '[name=cccd]' },
    gioi_tinh: { selector: '#gt', map: { Nam: '1' } }, dia_chi: '#dc', quoc_tich: { selector: '[name=q]', map: { 'Việt Nam': 'VN' } },
    vip: '#vip', thieu: '#khong-co', trong: '#dc'
  }, { ho_ten: 'Nguyễn A', ngay_sinh: '05/03/1990', so: '012345678901', gioi_tinh: 'Nam', dia_chi: 'Đà Nẵng', quoc_tich: 'Việt Nam', vip: 'có', thieu: 'x', trong: '' });
  const d = w.document;
  assert.equal(d.getElementById('ten').value, 'Nguyễn A');
  assert.equal(d.getElementById('ns').value, '1990-03-05');
  assert.equal(d.querySelector('[name=cccd]').value, '012345678901');
  assert.equal(d.getElementById('gt').value, '1');
  assert.equal(d.getElementById('dc').value, 'Đà Nẵng');
  assert.equal(d.getElementById('q1').checked, true);
  assert.equal(d.getElementById('vip').checked, true);
  assert.deepEqual(events, ['input', 'change']);
  assert.deepEqual(plain(r).filled.sort(), ['dia_chi', 'gioi_tinh', 'ho_ten', 'ngay_sinh', 'quoc_tich', 'so', 'vip']);
  assert.deepEqual(plain(r).notFound, ['thieu']);
  assert.deepEqual(plain(r).empty, ['trong']);
});
test('select khớp theo chữ hiển thị không phân biệt dấu', () => {
  const w = page(HTML);
  const r = w.__KHOATV_FILL__({ g: '#gt' }, { g: 'nu' });
  assert.equal(w.document.getElementById('gt').value, '0');
  assert.deepEqual(plain(r).filled, ['g']);
});
test('select không có giá trị phù hợp -> notFound', () => {
  const w = page(HTML);
  assert.deepEqual(plain(w.__KHOATV_FILL__({ g: '#gt' }, { g: 'khác' }).notFound), ['g']);
});
test('selector sai cú pháp không làm hỏng cả lượt', () => {
  const w = page(HTML);
  const r = w.__KHOATV_FILL__({ a: '##bad', b: '#ten' }, { a: '1', b: 'ok' });
  assert.deepEqual(plain(r.notFound), ['a']); assert.deepEqual(plain(r.filled), ['b']);
});
test('dò ô nhập: có nhãn, selector gợi ý, bỏ qua nút/hidden', () => {
  const w = page(HTML + '<input type="hidden" id="h"><input type="submit">');
  const r = w.__KHOATV_INSPECT__();
  const ten = r.controls.find((c) => c.id === 'ten');
  assert.equal(ten.label, 'Họ tên'); assert.equal(ten.selector, '#ten');
  assert.equal(r.controls.find((c) => c.name === 'cccd').selector, 'input[name="cccd"]');
  assert.ok(!r.controls.some((c) => c.id === 'h'));
  assert.ok(r.controls.find((c) => c.id === 'gt').options.includes('1|Nam'));
});
