const vm = require('vm'), fs = require('fs'), assert = require('assert');
const ctx = { console: { log() {}, error() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const schema = JSON.parse(vm.runInContext("JSON.stringify(buildSchema_(DOC_TYPES.CV_NHANVIEN))", ctx));
for (const k of ['anh_tep', 'anh_trang', 'anh_ymin', 'anh_xmin', 'anh_ymax', 'anh_xmax']) assert.strictEqual(schema.properties[k].type, 'NUMBER', k);
const fields = JSON.parse(vm.runInContext("JSON.stringify(DOC_TYPES.CV_NHANVIEN.fields.map(function(f){return f.k}))", ctx));
assert.ok(!fields.some((k) => /^anh_/.test(k)), 'khung ảnh chỉ để cắt ảnh, không lưu thành cột');
console.log('cvphoto ok');
