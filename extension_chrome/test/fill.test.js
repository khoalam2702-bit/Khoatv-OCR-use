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

test('một trường OCR điền nhiều ô: tách họ tên (name_head / name_last)', () => {
  const w = page('<input id="ho"><input id="ten">');
  const r = w.__KHOATV_FILL__({ ho_ten: [{ selector: '#ho', transform: 'name_head' }, { selector: '#ten', transform: 'name_last' }] }, { ho_ten: 'Nguyễn Văn An' });
  assert.equal(w.document.getElementById('ho').value, 'Nguyễn Văn');
  assert.equal(w.document.getElementById('ten').value, 'An');
  assert.deepEqual(plain(r.filled), ['ho_ten']);
});
test('tên một từ: ô họ để trống, ô tên có giá trị', () => {
  const w = page('<input id="ho"><input id="ten">');
  w.__KHOATV_FILL__({ ho_ten: [{ selector: '#ho', transform: 'name_head' }, { selector: '#ten', transform: 'name_last' }] }, { ho_ten: 'An' });
  assert.equal(w.document.getElementById('ho').value, ''); assert.equal(w.document.getElementById('ten').value, 'An');
});
test('format date: giá trị không phải ngày thì bỏ qua; map tra không phân biệt dấu/hoa thường', () => {
  const w = page('<input id="d"><input id="qt">');
  const r = w.__KHOATV_FILL__({ het: { selector: '#d', format: 'date' }, qt: { selector: '#qt', map: { 'Việt Nam': 'VN' } } }, { het: 'Không thời hạn', qt: 'VIET NAM' });
  assert.equal(w.document.getElementById('d').value, '');
  assert.equal(w.document.getElementById('qt').value, 'VN');
  assert.deepEqual(plain(r.empty), ['het']); assert.deepEqual(plain(r.filled), ['qt']);
});

test('append + prefix dồn nhiều trường vào một ô và cắt theo maxlength', () => {
  const w = page('<input id="gc" maxlength="40">');
  const m = { a: { selector: '#gc', prefix: 'Vị trí: ', append: true }, b: { selector: '#gc', prefix: 'Kỹ năng: ', append: true } };
  const r = w.__KHOATV_FILL__(m, { a: 'Kế toán', b: 'Excel, SQL, Power BI, tiếng Anh giao tiếp' });
  assert.equal(w.document.getElementById('gc').value, 'Vị trí: Kế toán; Kỹ năng: Excel, SQL, Po');
  assert.equal(w.document.getElementById('gc').value.length, 40);
  assert.deepEqual(plain(r.filled), ['a', 'b']);
});
test('append: trường rỗng không để lại tiền tố', () => {
  const w = page('<input id="gc">');
  w.__KHOATV_FILL__({ a: { selector: '#gc', prefix: 'A: ', append: true }, b: { selector: '#gc', prefix: 'B: ', append: true } }, { a: '', b: 'x' });
  assert.equal(w.document.getElementById('gc').value, 'B: x');
});

const LOGIN = `<select id="LoginExtender_cboEntity"><option value="">--</option><option value="C1">Công ty A</option></select>
<input id="LoginExtender_txtUserName"><select id="LoginExtender_cboUnit"><option value="">--</option><option value="U1">Đơn vị 1</option></select>
<input type="password" id="LoginExtender_txtPassword"><button id="ok">Nhận</button><button id="no">Hủy</button>`;

test('đăng nhập FBO: điền công ty, tên, đơn vị, mật khẩu và bấm Nhận', async () => {
  const w = page(LOGIN);
  w.document.getElementById('ok').getClientRects = () => [1]; // jsdom không có layout
  Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { get() { return 10; }, configurable: true });
  let clicked = '';
  w.document.getElementById('ok').addEventListener('click', () => { clicked = 'ok'; });
  w.document.getElementById('no').addEventListener('click', () => { clicked = 'no'; });
  const r = await w.__KHOATV_LOGIN__({ company: 'Công ty A', unit: 'Đơn vị 1', user: 'khoa', password: 'S3cret!' });
  const d = w.document;
  assert.equal(d.getElementById('LoginExtender_cboEntity').value, 'C1');
  assert.equal(d.getElementById('LoginExtender_txtUserName').value, 'khoa');
  assert.equal(d.getElementById('LoginExtender_cboUnit').value, 'U1');
  assert.equal(d.getElementById('LoginExtender_txtPassword').value, 'S3cret!');
  assert.equal(clicked, 'ok');
  assert.equal(r.submitted, true);
});
test('đăng nhập FBO: submit=false chỉ điền, trang không phải đăng nhập thì báo', async () => {
  const w = page(LOGIN);
  assert.equal((await w.__KHOATV_LOGIN__({ user: 'a', password: 'b', submit: false })).submitted, false);
  const w2 = page('<input id="x">');
  assert.equal((await w2.__KHOATV_LOGIN__({ user: 'a' })).ok, false);
});
