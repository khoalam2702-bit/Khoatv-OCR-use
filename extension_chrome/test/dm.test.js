import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDm, lookupAddress, lookupNationality, enrichData, norm } from '../lib/dm.js';

const rd = (n) => JSON.parse(fs.readFileSync(new URL('../presets/dm/' + n, import.meta.url), 'utf8'));
const dm = buildDm({ tinh: rd('tinh.json'), xa: rd('xa.json'), quocTich: rd('quoc-tich.json') });

test('danh mục đóng gói đủ: 34 tỉnh/thành, 3320 phường/xã, 14 quốc tịch', () => {
  assert.equal(rd('tinh.json').length, 34);
  assert.equal(rd('xa.json').length, 3320);
  assert.equal(rd('quoc-tich.json').length, 14);
});

test('norm bỏ dấu, đ, ký tự lạ', () => {
  assert.equal(norm('Thành phố Hồ Chí Minh'), 'thanh pho ho chi minh');
  assert.equal(norm('  Đất-Mũi!! '), 'dat mui');
});

test('địa chỉ: tỉnh + phường/xã khớp danh mục -> mã', () => {
  const a = lookupAddress(dm, 'Phường Ba Đình, Thành phố Hà Nội');
  assert.deepEqual([a.tinh.ma, a.xa.ma], ['01', '00004']);
  const b = lookupAddress(dm, 'xã Đất Mũi, tỉnh Cà Mau');
  assert.deepEqual([b.tinh.ma, b.xa.ma], ['96', '32248']);
  const c = lookupAddress(dm, 'Phường Ngọc Hà, TP. Hà Nội');
  assert.equal(c.xa.ma, '00008');
});

test('địa chỉ: chỉ có tỉnh, tỉnh viết tắt hoặc không dấu phẩy', () => {
  assert.deepEqual(lookupAddress(dm, 'TP Hồ Chí Minh'), { tinh: { ma: '79', ten: 'Thành phố Hồ Chí Minh' }, xa: null });
  assert.equal(lookupAddress(dm, 'Cà Mau').tinh.ma, '96');
  assert.equal(lookupAddress(dm, 'Đất Mũi Cà Mau').tinh.ma, '96');
});

test('địa chỉ: tỉnh/xã không có trong danh mục thì để trống, không đoán', () => {
  const old = lookupAddress(dm, 'Phường Bến Nghé, Quận 1, Thành phố Hồ Chí Minh');
  assert.equal(old.tinh.ma, '79');
  assert.equal(old.xa, null); // đơn vị cũ không có trong danh mục mới
  assert.deepEqual(lookupAddress(dm, 'Quảng Bình'), { tinh: null, xa: null });
  assert.deepEqual(lookupAddress(dm, ''), { tinh: null, xa: null });
});

test('địa chỉ: xã loại khác (Xã/Phường) không bị nhận nhầm', () => {
  const w = rd('xa.json').find((r) => r[2].startsWith('Xã '));
  const tinh = rd('tinh.json').find((r) => r[0] === w[0]);
  const r = lookupAddress(dm, 'Phường ' + w[2].replace(/^Xã /, '') + ', ' + tinh[1]);
  assert.ok(!r.xa || r.xa.ma !== w[1]);
});

test('quốc tịch: tên, cách gọi khác, mã ISO; nước không có thì rỗng', () => {
  assert.equal(lookupNationality(dm, 'Việt Nam'), 'VN');
  assert.equal(lookupNationality(dm, 'VIETNAM'), 'VN');
  assert.equal(lookupNationality(dm, 'VNM'), 'VN');
  assert.equal(lookupNationality(dm, 'Hoa Kỳ'), 'USA');
  assert.equal(lookupNationality(dm, 'Nhật Bản'), 'JAP');
  assert.equal(lookupNationality(dm, 'Pháp'), 'FRA'); // trùng tên với QFRA: lấy mã không tiền tố Q
  assert.equal(lookupNationality(dm, 'Nga'), 'RUS');
  assert.equal(lookupNationality(dm, 'Singapore'), ''); // không khớp nhầm "Nga"
  assert.equal(lookupNationality(dm, 'Myanmar'), ''); // không khớp nhầm "Mỹ"
  assert.equal(lookupNationality(dm, ''), '');
});

test('enrichData: CCCD thêm mã tỉnh/xã, Hộ chiếu thêm mã nơi cấp; không sửa dữ liệu gốc', () => {
  const src = { noi_thuong_tru: 'Phường Ba Đình, Thành phố Hà Nội', que_quan: 'Cà Mau', noi_sinh: '' };
  const r = enrichData('CCCD', src, dm);
  assert.equal(r.thuong_tru_tinh_ma, '01'); assert.equal(r.thuong_tru_xa_ma, '00004');
  assert.equal(r.que_quan_tinh_ma, '96'); assert.equal(r.que_quan_xa_ma, '');
  assert.equal(r.noi_sinh, 'Cà Mau'); // thẻ không có Nơi sinh: lấy Quê quán
  assert.equal(enrichData('CCCD', { noi_sinh: 'Hà Nội', que_quan: 'Cà Mau' }, dm).noi_sinh, 'Hà Nội');
  assert.equal(src.thuong_tru_tinh_ma, undefined);
  const h = enrichData('HO_CHIEU', { noi_cap: 'Việt Nam', noi_cap_visa: 'Mỹ' }, dm);
  assert.deepEqual([h.noi_cap_ma, h.noi_cap_visa_ma], ['VN', 'USA']);
  assert.deepEqual(enrichData('GPLX', { a: 1 }, dm), { a: 1 });
});
