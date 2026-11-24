const vm = require('vm'), fs = require('fs'), assert = require('assert');
const ctx = { console: { log() {}, error() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);

assert.strictEqual(run("stripDiacritics_('Nguyễn Đặng Thị Ánh')"), 'Nguyen Dang Thi Anh');
assert.strictEqual(run("hasViDiacritics_('NGUYEN VAN AN')"), false);
assert.strictEqual(run("hasViDiacritics_('Nguyễn Văn An')"), true);
assert.strictEqual(run("hasViDiacritics_('')"), false);

let calls = [];
ctx.__calls = calls;
// callGemini_ giả: trả tên có dấu cho lần đọc lại
run("callGemini_ = function (type, files, opts) { __calls.push({ keys: type.fields.map(function (f) { return f.k; }), slow: !!(opts && opts.slow) }); return __reply; };");
const fix = (docType, data, reply) => { calls.length = 0; ctx.__reply = reply; return JSON.parse(run(`JSON.stringify(fixNameDiacritics_(${JSON.stringify(docType)}, DOC_TYPES[${JSON.stringify(docType)}], ${JSON.stringify(data)}, [{mimeType:'image/jpeg',b64:'x'}]))`)); };

// CCCD mất dấu -> đọc lại, thêm dấu, đọc chậm
let r = fix('CCCD', { ho_ten: 'NGUYEN VAN AN', so_cccd: '1' }, { ho_ten: 'NGUYỄN VĂN AN' });
assert.strictEqual(r.ho_ten, 'NGUYỄN VĂN AN'); assert.strictEqual(JSON.stringify(calls[0].keys), JSON.stringify(['ho_ten'])); assert.strictEqual(calls[0].slow, true);
// đã có dấu -> không gọi lại
r = fix('CCCD', { ho_ten: 'Nguyễn Văn An' }, { ho_ten: 'X' });
assert.strictEqual(calls.length, 0); assert.strictEqual(r.ho_ten, 'Nguyễn Văn An');
// kết quả đọc lại đổi chữ (không chỉ thêm dấu) -> bỏ, giữ bản cũ
r = fix('CCCD', { ho_ten: 'NGUYEN VAN AN' }, { ho_ten: 'TRẦN VĂN BÌNH' });
assert.strictEqual(r.ho_ten, 'NGUYEN VAN AN');
// đọc lại vẫn không dấu -> giữ bản cũ
r = fix('CCCD', { ho_ten: 'NGUYEN VAN AN' }, { ho_ten: 'NGUYEN VAN AN' });
assert.strictEqual(r.ho_ten, 'NGUYEN VAN AN');
// lỗi khi đọc lại -> giữ bản cũ, không ném lỗi
run("callGemini_ = function () { throw new Error('boom'); };");
r = fix('CCCD', { ho_ten: 'NGUYEN VAN AN' }, null);
assert.strictEqual(r.ho_ten, 'NGUYEN VAN AN');
run("callGemini_ = function (type, files, opts) { __calls.push({ keys: type.fields.map(function (f) { return f.k; }) }); return __reply; };");
// khai sinh: cả tên cha, mẹ
r = fix('KHAI_SINH', { ho_ten_khai_sinh: 'Le Thi Hoa', ho_ten_cha: 'Le Van Nam', ho_ten_me: 'Trần Thị Lan' }, { ho_ten_khai_sinh: 'Lê Thị Hoa', ho_ten_cha: 'Lê Văn Nam' });
assert.strictEqual(JSON.stringify(calls[0].keys), JSON.stringify(['ho_ten_khai_sinh', 'ho_ten_cha']));
assert.strictEqual(r.ho_ten_khai_sinh, 'Lê Thị Hoa'); assert.strictEqual(r.ho_ten_cha, 'Lê Văn Nam'); assert.strictEqual(r.ho_ten_me, 'Trần Thị Lan');
// hộ chiếu: người Việt đọc lại; người nước ngoài không đụng
r = fix('HO_CHIEU', { ho_ten: 'NGUYEN VAN AN', quoc_tich: 'Việt Nam' }, { ho_ten: 'NGUYỄN VĂN AN' });
assert.strictEqual(r.ho_ten, 'NGUYỄN VĂN AN');
fix('HO_CHIEU', { ho_ten: 'JOHN SMITH', quoc_tich: 'United States' }, { ho_ten: 'X' });
assert.strictEqual(calls.length, 0);
// loại không có trường tên (biển số) -> không làm gì
fix('BIEN_SO_XE', { bien_so_day_du: '51F-123.45' }, {});
assert.strictEqual(calls.length, 0);
console.log('diacritics OK');
