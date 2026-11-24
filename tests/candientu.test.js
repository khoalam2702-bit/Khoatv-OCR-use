const vm = require('vm'), fs = require('fs'), assert = require('assert');
const ctx = { console: { log() {}, error() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const fix = (d) => { ctx.__d = d; return JSON.parse(vm.runInContext('JSON.stringify(fixScaleReading_(__d))', ctx)); };

// Việt Phát: 0.58 kg × 260.000 = 150.800 (dấu chấm = hàng nghìn)
let r = fix({ khoi_luong: 0.58, don_vi: 'kg', don_gia: 260, so_tien: 150.8, man_hinh_khoi_luong: '0.58', man_hinh_don_gia: '260.000', man_hinh_thanh_tien: '150.800' });
assert.strictEqual(r.khoi_luong, 0.58); assert.strictEqual(r.don_gia, 260000); assert.strictEqual(r.so_tien, 150800);
assert.ok(!('man_hinh_don_gia' in r));
// Việt Phát, AI đã đọc đúng số
r = fix({ khoi_luong: 0.58, don_vi: 'kg', don_gia: 260000, so_tien: 150800, man_hinh_khoi_luong: '0.58', man_hinh_don_gia: '260,000', man_hinh_thanh_tien: '150,800' });
assert.strictEqual(r.don_gia, 260000); assert.strictEqual(r.so_tien, 150800);
// CAS: 0.278 × 11.00 = 3.06 (đơn giá thập phân)
r = fix({ khoi_luong: 0.278, don_vi: 'kg', don_gia: 11, so_tien: 3.06, man_hinh_khoi_luong: '0.278', man_hinh_don_gia: '11.00', man_hinh_thanh_tien: '3.06' });
assert.strictEqual(r.don_gia, 11); assert.strictEqual(r.so_tien, 3.06); assert.ok(!r.ghi_chu_can);
// Giá hiện 11.000 và thành tiền 3.058: hiểu theo hàng nghìn (11.000 đ × 0.278 = 3.058 đ)
r = fix({ khoi_luong: 0.278, don_vi: 'kg', man_hinh_khoi_luong: '0.278', man_hinh_don_gia: '11.000', man_hinh_thanh_tien: '3.058' });
assert.strictEqual(r.don_gia, 11000);
assert.strictEqual(r.so_tien, 3058);
// Lehuy: chỉ có khối lượng, giá 0
r = fix({ khoi_luong: 2.185, don_vi: 'kg', don_gia: 0, so_tien: 0, man_hinh_khoi_luong: '2.185', man_hinh_don_gia: '0.000', man_hinh_thanh_tien: '0.000' });
assert.strictEqual(r.khoi_luong, 2.185); assert.strictEqual(r.don_gia, 0); assert.ok(/đơn giá 0/.test(r.ghi_chu_can));
// Cân chỉ có khối lượng
r = fix({ khoi_luong: 12.5, don_vi: 'kg', don_gia: null, so_tien: null, man_hinh_khoi_luong: '12.5', man_hinh_don_gia: null, man_hinh_thanh_tien: null });
assert.strictEqual(r.khoi_luong, 12.5); assert.strictEqual(r.don_gia, null); assert.strictEqual(r.so_tien, null);
// Lệch: giữ số AI và cảnh báo
r = fix({ khoi_luong: 1.5, don_vi: 'kg', don_gia: 10000, so_tien: 99999, man_hinh_khoi_luong: '1.5', man_hinh_don_gia: '10000', man_hinh_thanh_tien: '99999' });
assert.strictEqual(r.so_tien, 99999); assert.ok(/Cảnh báo/.test(r.ghi_chu_can));
// Không có chuỗi nguyên văn: dùng số AI
r = fix({ khoi_luong: 2, don_vi: 'kg', don_gia: 5000, so_tien: 10000 });
assert.strictEqual(r.don_gia, 5000); assert.strictEqual(r.so_tien, 10000);
// Schema gửi AI có trường phụ, nhưng form/lưu trữ thì không
const schema = JSON.parse(vm.runInContext("JSON.stringify(buildSchema_(DOC_TYPES.CAN_DIEN_TU))", ctx));
assert.ok(schema.properties.man_hinh_don_gia && schema.properties.so_tien);
const keys = JSON.parse(vm.runInContext("JSON.stringify(DOC_TYPES.CAN_DIEN_TU.fields.map(function(f){return f.k}))", ctx));
assert.ok(!keys.some((k) => /^man_hinh/.test(k)));
console.log('candientu ok');
