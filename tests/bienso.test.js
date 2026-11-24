const vm = require('vm'), fs = require('fs'), assert = require('assert');
const ctx = { console: { log() {}, error() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const fix = (d) => { ctx.__d = d; return JSON.parse(vm.runInContext('JSON.stringify(fixPlateReading_(__d))', ctx)); };

// Ô tô 1 dòng
let r = fix({ bien_so_day_du: '51F-970.22' });
assert.deepStrictEqual([r.bien_so_day_du, r.ma_tinh_thanh, r.seri_dang_ky, r.loai_phuong_tien, r.mau_bien, r.doi_tuong_su_dung], ['51F-970.22', '51', 'F', 'Ô tô', 'Trắng', 'Cá nhân, tổ chức']);
// Xe máy 2 dòng, AI ghép bằng khoảng trắng / xuống dòng / thiếu dấu chấm
for (const v of ['99-E1 222.68', '99-E1\n222.68', '99 - E1 22268', '99-e1  222.68']) {
  r = fix({ bien_so_day_du: v });
  assert.deepStrictEqual([r.bien_so_day_du, r.ma_tinh_thanh, r.seri_dang_ky, r.loai_phuong_tien], ['99-E1 222.68', '99', 'E1', 'Xe máy'], v);
}
r = fix({ bien_so_day_du: '12-B1 168.88', loai_phuong_tien: 'Xe máy', mau_bien: 'Trắng' });
assert.strictEqual(r.seri_dang_ky, 'B1'); assert.strictEqual(r.ma_tinh_thanh, '12');
// Ô tô không dấu gạch, số 5 liền: 51F97022 phải hiểu seri là F, không nuốt chữ số 9
r = fix({ bien_so_day_du: '51F 97022' });
assert.strictEqual(r.bien_so_day_du, '51F-970.22'); assert.strictEqual(r.seri_dang_ky, 'F');
// Biển 4 số cũ
r = fix({ bien_so_day_du: '29A-1234' });
assert.strictEqual(r.bien_so_day_du, '29A-1234'); assert.strictEqual(r.ma_tinh_thanh, '29');
// Không khớp mẫu: giữ nguyên, vẫn lấy mã tỉnh
r = fix({ bien_so_day_du: '30LD 12345 ?' });
assert.strictEqual(r.bien_so_day_du, '30LD 12345 ?'); assert.strictEqual(r.ma_tinh_thanh, '30');
// Màu: giữ màu AI đọc được, chuẩn hoá chữ, suy ra đối tượng sử dụng
r = fix({ bien_so_day_du: '51C-123.45', mau_bien: 'nền vàng' });
assert.strictEqual(r.mau_bien, 'Vàng'); assert.strictEqual(r.doi_tuong_su_dung, 'Kinh doanh vận tải'); assert.strictEqual(r.seri_dang_ky, 'C'); assert.strictEqual(r.ma_tinh_thanh, '51');
r = fix({ bien_so_day_du: '80A-123.45', mau_bien: 'Xanh dương' });
assert.strictEqual(r.mau_bien, 'Xanh'); assert.strictEqual(r.doi_tuong_su_dung, 'Cơ quan nhà nước'); assert.strictEqual(r.ma_tinh_thanh, '80');
r = fix({ bien_so_day_du: '51F-970.22' });
assert.strictEqual(r.mau_bien, 'Trắng'); assert.strictEqual(r.doi_tuong_su_dung, 'Cá nhân, tổ chức');
// Biển xe máy điện MĐ (seri 2 chữ có Đ) và biển LD
r = fix({ bien_so_day_du: '29-MĐ1 123.45' });
assert.strictEqual(r.seri_dang_ky, 'MĐ1'); assert.strictEqual(r.loai_phuong_tien, 'Xe máy');
r = fix({ bien_so_day_du: '30LD-123.45', mau_bien: 'Trắng' });
assert.strictEqual(r.seri_dang_ky, 'LD'); assert.strictEqual(r.loai_phuong_tien, 'Ô tô');
// Biển đỏ quân đội: không có mã tỉnh
for (const v of ['QH 12-34', 'QH-1234', 'QH 1234']) {
  r = fix({ bien_so_day_du: v, mau_bien: 'Đỏ' });
  assert.deepStrictEqual([r.bien_so_day_du, r.ma_tinh_thanh, r.seri_dang_ky, r.mau_bien, r.doi_tuong_su_dung], ['QH 12-34', null, 'QH', 'Đỏ', 'Quân đội'], v);
}
assert.strictEqual(vm.runInContext("plateProvince_(null, 'QH 12-34')", ctx), '');
// Trống
r = fix({ bien_so_day_du: null }); assert.strictEqual(r.bien_so_day_du, null);

// Schema gửi AI không còn mã tỉnh / tên tỉnh / seri
const keys = JSON.parse(vm.runInContext("JSON.stringify(Object.keys(buildSchema_(DOC_TYPES.BIEN_SO_XE).properties))", ctx));
assert.deepStrictEqual(keys, ['bien_so_day_du', 'loai_phuong_tien', 'mau_bien']);
// Form/lưu trữ vẫn đủ 6 trường
assert.strictEqual(vm.runInContext('DOC_TYPES.BIEN_SO_XE.fields.length', ctx), 7);
// Tra tên tỉnh
assert.strictEqual(vm.runInContext("plateProvince_('51', '')", ctx), 'TP. Hồ Chí Minh');
console.log('bienso ok');
