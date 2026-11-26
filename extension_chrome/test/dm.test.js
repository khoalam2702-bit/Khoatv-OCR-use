import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lookupMajor, buildDm, addressDetail, lookupAddress, lookupNationality, enrichData, norm } from '../lib/dm.js';

const rd = (n) => JSON.parse(fs.readFileSync(new URL('../presets/dm/' + n, import.meta.url), 'utf8'));
const dm = buildDm({ tinh: rd('tinh.json'), xa: rd('xa.json'), quocTich: rd('quoc-tich.json') }); // không có bảng đơn vị cũ
const dmCn = buildDm({ chuyenNganh: rd('chuyen-nganh.json') });
const dmOld = buildDm({ tinh: rd('tinh.json'), xa: rd('xa.json'), quocTich: rd('quoc-tich.json'), diaChiCu: rd('dia-chi-cu.json') });

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
  assert.deepEqual(lookupAddress(dm, 'TP Hồ Chí Minh'), { tinh: { ma: '79', ten: 'Thành phố Hồ Chí Minh' }, xa: null, cu: false, provKey: 'ho chi minh', used: [0], candidates: [] });
  assert.equal(lookupAddress(dm, 'Cà Mau').tinh.ma, '96');
  assert.equal(lookupAddress(dm, 'Đất Mũi Cà Mau').tinh.ma, '96');
});

test('địa chỉ: tỉnh/xã không có trong danh mục thì để trống, không đoán', () => {
  const old = lookupAddress(dm, 'Phường Bến Nghé, Quận 1, Thành phố Hồ Chí Minh');
  assert.equal(old.tinh.ma, '79');
  assert.equal(old.xa, null); // đơn vị cũ không có trong danh mục mới
  assert.deepEqual(lookupAddress(dm, 'Abc, Xyz'), { tinh: null, xa: null, cu: false, provKey: '', used: [], candidates: [] });
  assert.deepEqual(lookupAddress(dm, ''), { tinh: null, xa: null, cu: false, provKey: '', used: [], candidates: [] });
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

test('địa chỉ chi tiết: bỏ tỉnh và phường/xã đã tra được, giữ số nhà/tổ; không tra được thì giữ nguyên', () => {
  assert.equal(addressDetail(dm, 'Tổ 15 Bình Hiên, Phường Hải Châu, Thành phố Đà Nẵng'), 'Tổ 15 Bình Hiên');
  assert.equal(addressDetail(dm, 'Tổ 15 Bình Hiên, Hải Châu, Đà Nẵng'), 'Tổ 15 Bình Hiên');
  assert.equal(addressDetail(dm, 'Thành phố Hà Nội'), '');
  assert.equal(addressDetail(dm, '12 Nguyễn Trãi, Nơi lạ'), '12 Nguyễn Trãi, Nơi lạ');
  assert.equal(addressDetail(dm, ''), '');
});

test('enrichData: CCCD thêm thuong_tru_chi_tiet và que_quan_chi_tiet', () => {
  const o = enrichData('CCCD', { noi_thuong_tru: 'Tổ 15 Bình Hiên, Phường Hải Châu, Thành phố Đà Nẵng', que_quan: 'Phường Hải Châu, Thành phố Đà Nẵng' }, dm);
  assert.equal(o.thuong_tru_chi_tiet, 'Tổ 15 Bình Hiên');
  assert.equal(o.que_quan_chi_tiet, '');
});

test('enrichData: CV ứng viên tách địa chỉ thành chi tiết + tỉnh + phường/xã; loại khác không thêm khóa địa chỉ', () => {
  const o = enrichData('CV_UNGVIEN', { dia_chi: '12 Lê Duẩn, Phường Hải Châu, Thành phố Đà Nẵng' }, dm);
  assert.equal(o.dia_chi_chi_tiet, '12 Lê Duẩn');
  assert.ok(o.dia_chi_tinh_ma && o.dia_chi_xa_ma);
  assert.equal(o.dia_chi, '12 Lê Duẩn, Phường Hải Châu, Thành phố Đà Nẵng');
  assert.equal('dia_chi_tinh_ma' in enrichData('GPLX', { dia_chi: 'x' }, dm), false);
});

test('enrichData: Giấy khai sinh thêm loại quan hệ (Con 01, Cha/Mẹ 03) và ngày hiệu lực = ngày quét', () => {
  assert.equal(enrichData('KHAI_SINH', {}, dm, { today: '24/11/2026' }).loai_qh, '01');
  const o = enrichData('KHAI_SINH', { so_dinh_danh: '079123456789' }, dm, { relation: 'CHA_ME', today: '24/11/2026' });
  assert.equal(o.loai_qh, '03');
  assert.equal(o.ngay_hl_tu, '24/11/2026');
  assert.equal(o.so_dinh_danh, '079123456789');
});

test('tỉnh cũ đã sáp nhập: quy đổi sang tỉnh mới, xã/phường cũ để trống, phần còn lại vào ô chữ', () => {
  for (const [addr, ma] of [['Thôn 2, Tiên Lộc, Tiên Phước, Quảng Nam', '48'], ['Thôn Quang Bình, Xã Hải Ninh, Huyện Quảng Ninh, Tỉnh Quảng Bình', '44'], ['Tổ 5, Ấp 3, Xã A, Huyện B, Tỉnh Bến Tre', '86'], ['Xóm 1, Xã A, Huyện B, Bạc Liêu', '96']]) {
    const r = lookupAddress(dm, addr);
    assert.equal(r.tinh && r.tinh.ma, ma, addr);
    assert.equal(r.xa, null, 'không đoán xã/phường theo đơn vị cũ');
    assert.ok(!/(quang nam|quang binh|ben tre|bac lieu)$/i.test(norm(addressDetail(dm, addr))), 'phần tên tỉnh cũ bị bỏ khỏi ô chữ');
  }
  assert.equal(addressDetail(dm, 'Thôn 2, Tiên Lộc, Tiên Phước, Quảng Nam'), 'Thôn 2, Tiên Lộc, Tiên Phước');
  const e = enrichData('CCCD', { noi_thuong_tru: 'Thôn 2, Tiên Lộc, Tiên Phước, Quảng Nam', que_quan: 'Tiên Lộc, Tiên Phước, Quảng Nam' }, dm, {});
  assert.equal(e.thuong_tru_tinh_ma, '48'); assert.equal(e.thuong_tru_xa_ma, '');
  assert.equal(e.que_quan_tinh_ma, '48'); assert.equal(e.que_quan_chi_tiet, 'Tiên Lộc, Tiên Phước');
});
test('tên tỉnh còn trong danh mục thì khớp như cũ, không bị quy đổi nhầm', () => {
  const r = lookupAddress(dm, 'Tổ 15 Bình Hiên, Hải Châu, Đà Nẵng');
  assert.equal(r.tinh.ma, '48'); assert.equal(r.cu, false);
  const q = lookupAddress(dm, 'Xã X, Huyện Hòa Bình, Hà Nội'); // huyện Hòa Bình không phải tỉnh Hòa Bình
  assert.equal(q.tinh.ma, '01'); assert.equal(q.cu, false);
  assert.equal(lookupAddress(dm, 'Abc, Xyz').tinh, null);
});

test('bảng đơn vị cũ: xã/huyện/tỉnh cũ -> tỉnh + xã mới (đúng mã danh mục FBO), cắt phần còn lại vào ô chữ', () => {
  const w = (ma) => dmOld.wardsBy[ma];
  const cases = [
    ['Thôn 3, Xã Đại Hồng, Huyện Đại Lộc, Tỉnh Quảng Nam', '48', 'Xã Hà Nha', 'Thôn 3'],
    ['Tổ 5, Thị trấn Ba Đồn, Thị xã Ba Đồn, Quảng Bình', '44', 'Phường Ba Đồn', 'Tổ 5'],
    ['12 Lê Duẩn, Phường Hải Châu 1, Quận Hải Châu, Thành phố Đà Nẵng', '48', 'Phường Hải Châu', '12 Lê Duẩn'], // số La Mã/số thường
    ['Phường 5, Quận 3, TP Hồ Chí Minh', '79', 'Phường Bàn Cờ', '']
  ];
  for (const [addr, tinh, xa, detail] of cases) {
    const r = lookupAddress(dmOld, addr);
    assert.equal(r.tinh && r.tinh.ma, tinh, addr);
    assert.equal(r.xa && r.xa.ten, xa, addr);
    assert.ok(r.cu, addr);
    assert.ok(w(tinh).some((x) => x.ma === r.xa.ma && x.ten === xa), 'mã xã nằm trong danh mục của đúng tỉnh mới');
    assert.equal(addressDetail(dmOld, addr), detail, addr);
  }
});
test('bảng đơn vị cũ: xã cũ bị chia cho nhiều xã mới -> không chọn, chỉ gợi ý; xã không có trong bảng -> chỉ tỉnh', () => {
  const r = lookupAddress(dmOld, 'Xã Cam Hiệp Bắc, Huyện Cam Lâm, Tỉnh Khánh Hòa');
  assert.equal(r.tinh.ma, '56'); assert.equal(r.xa, null);
  assert.ok(r.candidates.length >= 2);
  const e = enrichData('CCCD', { noi_thuong_tru: 'Xã Cam Hiệp Bắc, Huyện Cam Lâm, Tỉnh Khánh Hòa' }, dmOld, {});
  assert.equal(e.thuong_tru_xa_ma, ''); assert.ok(e.thuong_tru_xa_goi_y.includes(' / '));
  const z = lookupAddress(dmOld, 'Xóm 1, Xã Zzz, Huyện Đại Lộc, Quảng Nam');
  assert.equal(z.tinh.ma, '48'); assert.equal(z.xa, null); assert.deepEqual(z.candidates, []);
  assert.equal(addressDetail(dmOld, 'Xóm 1, Xã Zzz, Huyện Đại Lộc, Quảng Nam'), 'Xóm 1, Xã Zzz, Huyện Đại Lộc');
});
test('bảng đơn vị cũ: địa chỉ 2 cấp theo danh mục mới vẫn khớp như cũ; tên tỉnh trùng (Khánh Hòa) có huyện -> theo đơn vị cũ', () => {
  const r = lookupAddress(dmOld, 'Phường Hải Châu, Đà Nẵng');
  assert.equal(r.xa.ten, 'Phường Hải Châu'); assert.equal(r.cu, false);
  const k = lookupAddress(dmOld, 'Xã Cam Lâm, Tỉnh Khánh Hòa');
  assert.equal(k.cu, false); assert.equal(k.tinh.ma, '56');
});
test('bảng đơn vị cũ: "Bà Rịa - Vũng Tàu" có gạch ngang trong tên không bị cắt đôi', () => {
  const r = lookupAddress(dmOld, 'Xã Bình Ba, Huyện Châu Đức, Bà Rịa - Vũng Tàu');
  assert.equal(r.tinh.ma, '79'); assert.ok(r.cu);
  assert.equal(addressDetail(dmOld, 'Số 1, Xã Bình Ba, Huyện Châu Đức, Bà Rịa - Vũng Tàu'), 'Số 1');
});

test('CV nhân viên: Địa chỉ hiện tại tách thành số nhà/tổ + tỉnh + xã (địa chỉ cũ chỉ có quận thì chỉ ra tỉnh)', () => {
  const o = enrichData('CV_NHANVIEN', { dia_chi: 'Quận Đống Đa, Hà Nội' }, dmOld);
  assert.equal(o.hien_tai_tinh_ma, '01'); assert.equal(o.hien_tai_xa_ma, '');
  const p = enrichData('CV_NHANVIEN', { dia_chi: '12 Lê Duẩn, Phường Hải Châu 1, Quận Hải Châu, Đà Nẵng' }, dmOld);
  assert.equal(p.hien_tai_tinh_ma, '48'); assert.ok(p.hien_tai_xa_ma); assert.equal(p.hien_tai_chi_tiet, '12 Lê Duẩn');
});

test('CV nhân viên: ánh xạ ra đúng ô của form Thông tin nhân viên (đã dò), họ tên/giới tính/ngày sinh/quốc tịch dùng cùng ô với CCCD', () => {
  const preset = rd('../fbo-hrm.json');
  const m = preset.CV_NHANVIEN;
  for (const k of ['ho_ten', 'gioi_tinh', 'ngay_sinh', 'quoc_tich']) assert.deepEqual(m[k], preset.CCCD[k], k + ' phải trùng ô với CCCD (cùng form nhân viên)');
  const sel = (k) => [].concat(m[k]).map((x) => (typeof x === 'string' ? x : x.selector))[0];
  assert.match(sel('hien_tai_chi_tiet'), /dia_chi_ht_so"\]$/); assert.match(sel('hien_tai_tinh_ma'), /dia_chi_ht_tinh"\]$/); assert.match(sel('hien_tai_xa_ma'), /dia_chi_ht_xa"\]$/);
  assert.match(sel('cap_dao_tao'), /ma_tdhv"\]$/); assert.equal(m.cap_dao_tao.map['Đại học'], '50');
  assert.match(sel('ky_nang'), /_ghi_chu"\]$/);
  const e = enrichData('CV_NHANVIEN', { tu_nam: '2014', den_nam: '2017' }, dmOld);
  assert.equal(e.thoi_gian_hoc, '2014 - 2017');
  // CCCD: Số nhà/tổ điền vào ô nhập thật (…_so), không phải ô địa chỉ ghép ẩn
  assert.match(preset.CCCD.thuong_tru_chi_tiet, /dia_chi_th_tru_so"\]$/); assert.match(preset.CCCD.que_quan_chi_tiet, /que_quan_so"\]$/);
});

test('chuyên ngành: khớp danh mục FBO (trùng tên, chứa tên, không khớp → KHÁC)', () => {
  const ma = (t) => { const r = lookupMajor(t, dmCn); return r && r.ma; };
  assert.equal(ma('Kế toán'), '10');
  assert.equal(ma('Chuyên ngành Kế Toán'), '10');
  assert.equal(ma('Kế toán doanh nghiệp'), '10');          // tên danh mục nằm trong chuyên ngành ghi trên CV
  assert.equal(ma('Luật'), '41');
  assert.equal(ma('Ngôn ngữ Anh'), '51');
  assert.equal(ma('Hệ thống thông tin quản lý'), 'HTTTQL');
  assert.equal(ma('Chăm sóc sắc đẹp'), '21');             // không có trong danh mục → mục Khác
  assert.equal(ma('Công nghệ thông tin'), '02');          // trùng tên với QCNTT/T.CNTT: ưu tiên mã số
  assert.equal(ma('Kế toán tài chính'), 'KTTC');
  assert.equal(ma('Quản trị kinh doanh'), 'QQTKD');
  assert.equal(ma('Marketing'), 'QMARKET');
  assert.equal(lookupMajor('', dmCn), null);
  assert.equal(lookupMajor('Kế toán', buildDm({})), null); // danh mục trống thì không điền
  assert.equal(enrichData('CV_NHANVIEN', { chuyen_nganh: 'Tài chính - Ngân hàng' }, dmCn).chuyen_nganh_ma, '46');
  assert.match(rd('../fbo-hrm.json').CV_NHANVIEN.chuyen_nganh_ma.selector, /_form_ma_cn"\]$/);
});

test('CV nhân viên: ngày tốt nghiệp = 30/09 của năm kết thúc học; không có năm thì không điền', () => {
  assert.equal(enrichData('CV_NHANVIEN', { den_nam: '2022' }, null).ngay_tot_nghiep, '30/09/2022');
  assert.equal(enrichData('CV_NHANVIEN', { den_nam: 'Nay' }, null).ngay_tot_nghiep, undefined);
  assert.equal(enrichData('CV_NHANVIEN', {}, null).ngay_tot_nghiep, undefined);
  assert.deepEqual(rd('../fbo-hrm.json').CV_NHANVIEN.ngay_tot_nghiep.format, 'date');
});
