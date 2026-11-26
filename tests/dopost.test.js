const vm = require('vm'), fs = require('fs'), assert = require('assert');
const ctx = { console, PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }, ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const post = (b, raw) => JSON.parse(vm.runInContext('doPost', ctx)({ postData: { contents: raw !== undefined ? raw : JSON.stringify(b) } }).text);
let calls = [];
vm.runInContext(`saveRecord = function(){ __calls.push(Array.from(arguments)); return {row:7}; }; login = function(u,p){ if(p!=='ok') throw new Error('Sai'); return {token:'t'}; };`, Object.assign(ctx, { __calls: calls }));

assert.deepStrictEqual(post(null, ''), { ok: false, error: 'Thiếu nội dung yêu cầu.' });
assert.strictEqual(post(null, '{x').ok, false);
assert.strictEqual(post({ action: 'constructor' }).error, 'Hành động không hợp lệ.');
assert.strictEqual(post({ action: 'setup' }).error, 'Hành động không hợp lệ.');
assert.strictEqual(post({ action: 'doGet' }).ok, false);
assert.strictEqual(post({ action: 'getAppConfig' }).data.types.length, 13);
assert.strictEqual(post({ action: 'getAppConfig' }).data.anonPerDay, 10); // chưa khai báo: mặc định 10 lượt / ngày / thiết bị
assert.strictEqual(post({ action: 'scanAnonymous', args: [] }).ok, false); // quét không tài khoản chỉ lỗi nghiệp vụ, không lộ hàm nội bộ
assert.deepStrictEqual(post({ action: 'login', args: ['a', 'ok'] }), { ok: true, data: { token: 't' } });
assert.deepStrictEqual(post({ action: 'login', args: ['a', 'bad'] }), { ok: false, error: 'Sai' });
// saveRecord chạy đúng MỘT lần và nhận source từ client
let r = post({ action: 'saveRecord', args: ['tok', 'CCCD', { so_cccd: '1' }, ['id']], client: 'EXTENSION' });
assert.strictEqual(r.ok, true); assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0][4].source, 'EXTENSION');
post({ action: 'saveRecord', args: ['tok', 'CCCD', {}, ['id']], client: 'HACK' });
assert.strictEqual(calls[1][4].source, 'WEB_APP');
// SYS_COLS: 5 cột cũ giữ nguyên thứ tự, 2 cột mới nối sau và là opt
const keys = vm.runInContext('SYS_COLS.map(c=>c.k).join()', ctx);
assert.strictEqual(keys, 'scan_timestamp,document_type,raw_file_url,raw_file_id,scanned_by,source,fbo_sync_status');
// Extension bỏ qua must_change chỉ với thao tác OCR; web app và quản lý tài khoản vẫn bị ép
vm.runInContext(`listRecords = function(){ return skipMustChange_; }; listUsers = function(){ return skipMustChange_; };`, ctx);
assert.strictEqual(post({ action: 'listRecords', args: ['t'], client: 'EXTENSION' }).data, true);
assert.strictEqual(post({ action: 'listRecords', args: ['t'], client: 'WEB_APP' }).data, false);
assert.strictEqual(post({ action: 'listUsers', args: ['t'], client: 'EXTENSION' }).data, false);
console.log('doPost OK');
