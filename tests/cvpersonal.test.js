const vm = require('vm'), fs = require('fs'), assert = require('assert');
const ctx = { console: { log() {}, error() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const run = (type, d) => JSON.parse(vm.runInContext('JSON.stringify(fillCvPersonal_(' + JSON.stringify(type) + ',' + JSON.stringify(d) + '))', ctx));
for (const t of ['CV_NHANVIEN', 'CV_UNGVIEN']) {
  let r = run(t, { ho_ten: 'Trần Thị Mai', gioi_tinh_doan: 'Nam' });
  assert.deepStrictEqual([r.gioi_tinh, r.gioi_tinh_nguon, r.quoc_tich, r.quoc_tich_nguon], ['Nữ', 'ten_dem', 'Việt Nam', 'mac_dinh']);
  r = run(t, { ho_ten: 'NGUYỄN VĂN AN' });
  assert.deepStrictEqual([r.gioi_tinh, r.gioi_tinh_nguon], ['Nam', 'ten_dem']);
  r = run(t, { ho_ten: 'Lê Khánh Linh', gioi_tinh_doan: 'Nữ', gioi_tinh_doan_theo: 'anh' });
  assert.deepStrictEqual([r.gioi_tinh, r.gioi_tinh_nguon], ['Nữ', 'anh']);
  r = run(t, { ho_ten: 'Lê Khánh Linh' });
  assert.strictEqual(r.gioi_tinh, undefined, 'không chắc thì để trống');
  r = run(t, { ho_ten: 'Trần Thị Mai', gioi_tinh: 'Male', quoc_tich: 'Vietnamese' });
  assert.deepStrictEqual([r.gioi_tinh, r.gioi_tinh_nguon, r.quoc_tich, r.quoc_tich_nguon], ['Nam', undefined, 'Việt Nam', undefined], 'CV ghi gì lấy đó');
  assert.strictEqual(run(t, { ho_ten: 'John Smith', quoc_tich: 'Mỹ' }).quoc_tich, 'Mỹ');
  assert.strictEqual(run(t, {}).quoc_tich, undefined, 'không đọc được CV thì không tự điền');
  const s = JSON.parse(vm.runInContext('JSON.stringify(buildSchema_(DOC_TYPES.' + t + '))', ctx));
  for (const k of ['gioi_tinh', 'quoc_tich', 'gioi_tinh_doan', 'gioi_tinh_doan_theo']) assert.ok(s.properties[k], t + ' thiếu ' + k);
}
assert.strictEqual(run('CCCD', { ho_ten: 'Trần Thị Mai' }).gioi_tinh, undefined);
console.log('cvpersonal ok');
