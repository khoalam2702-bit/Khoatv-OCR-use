// Lượt quét: tặng 100 lượt, CV 2 lượt, chỉ trừ khi client báo đã điền (extension), thiết bị cấp lại sau 48h, gia hạn theo bậc.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), crypto = require('crypto');
const props = {}; let now = 1000000000000, uuid = 0; const tables = {};
const users = [{ username: 'admin', role: 'ADMIN', full_name: 'A' }, { username: 'cty', role: 'USER', full_name: 'Cty' }];
const ctx = {
  console: { log() {}, error() {} },
  Date: class extends Date { static now() { return now; } },
  Utilities: {
    formatDate: (d, tz, f) => (f === 'yyyy-MM-dd' ? '2026-10-28' : '2026-11-27 10:00:00'), getUuid: () => 'uuid-' + (++uuid),
    computeDigest: (_a, s) => Array.from(crypto.createHash('sha256').update(String(s)).digest()),
    base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url'), DigestAlgorithm: { SHA_256: 1 }
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) },
  __tables: tables, __users: users, __fail: false, __trial: []
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), ctx);
const run = (c) => vm.runInContext(c, ctx);
run(`
  tableRead_ = function (n) { return (__tables[n] || []).map(function (r, i) { const o = { _row: i + 2 }; CREDIT_SHEETS[n].forEach(function (h) { o[h] = r[h] === undefined || r[h] === null ? '' : String(r[h]); }); return o; }); };
  tableWrite_ = function (n, obj) { const t = __tables[n] = __tables[n] || []; const c = Object.assign({}, obj); delete c._row; if (obj._row) t[obj._row - 2] = c; else { t.push(c); obj._row = t.length + 1; } return obj; };
  readUsers_ = function () { return { list: __users }; };
  findUser_ = function (n) { return __users.filter(function (u) { return u.username === n; })[0] || null; };
  auth_ = function (t) { const u = findUser_(t); if (!u) throw new Error('SESSION_EXPIRED'); return { username: u.username, role: u.role, perms: { perm_add: true } }; };
  audit_ = function () {};
  scanCore_ = function (me, payload, anon, trial) { __trial.push(trial); if (__fail) throw new Error('Gemini lỗi'); return { data: {}, fileIds: [] }; };
  testGeminiKey_ = function () { return { ok: true }; };
  geminiKeysSafe_ = function () { return ['AIzaSy' + 'A'.repeat(33)]; };
`);
const call = (fn, ...a) => { ctx.__a = a; return JSON.parse(JSON.stringify(run(`${fn}(...__a)`) ?? null)); };
const left = () => call('myCredit', 'cty').remaining;

assert.strictEqual(left(), 100);
assert.deepStrictEqual(call('myCredit', 'admin'), { unlimited: true });
// extension: quét không trừ, điền (chargeScan) mới trừ, mỗi phiếu một lần
let r = call('scanDocument', 'cty', { docType: 'CV_UNGVIEN', deferCharge: true });
assert.strictEqual(r.charge.cost, 2); assert.strictEqual(r.credit.remaining, 100); assert.strictEqual(left(), 100);
assert.strictEqual(call('chargeScan', 'cty', r.charge.ticket).remaining, 98);
assert.strictEqual(call('chargeScan', 'cty', r.charge.ticket).remaining, 98, 'không trừ hai lần');
const parts = r.charge.ticket.split('.');
assert.throws(() => call('chargeScan', 'cty', parts[0] + '.1.' + parts[2]), /không hợp lệ/);
// web: trừ ngay khi quét thành công; lỗi Gemini không trừ; chỉ QR không trừ; ADMIN không trừ
assert.strictEqual(call('scanDocument', 'cty', { docType: 'CCCD' }).credit.remaining, 97);
ctx.__fail = true; assert.throws(() => call('scanDocument', 'cty', { docType: 'CCCD' }), /Gemini/); ctx.__fail = false;
assert.strictEqual(call('scanDocument', 'cty', { docType: 'CCCD', skipAi: true }).charge, undefined);
assert.strictEqual(left(), 97);
assert.strictEqual(call('scanDocument', 'admin', { docType: 'CCCD' }).credit, undefined);

// bậc thang + gia hạn
assert.throws(() => call('creditSaveTiers', 'cty', []), /ADMIN/);
const tiers = call('creditSaveTiers', 'admin', [{ amount: 500000, credits: 450 }, { amount: 120000, credits: 100 }]).tiers;
assert.deepStrictEqual(tiers.map((t) => t.credits), [100, 450]);
assert.deepStrictEqual(call('creditTopup', 'admin', 'u:cty', tiers[1].id, false), { paid: false, result: null });
assert.strictEqual(left(), 97, 'chờ thanh toán thì chưa cộng');
let adm = call('creditAdmin', 'admin');
assert.strictEqual(adm.pending.length, 1);
assert.deepStrictEqual(call('creditOrder', 'admin', adm.pending[0].code, 'PAY').result, { before: 97, added: 450, after: 547 });
assert.throws(() => call('creditOrder', 'admin', adm.pending[0].code, 'PAY'), /đã được xử lý/);
assert.strictEqual(call('creditAdmin', 'admin').accounts[0].status, 'DA_MUA');
assert.strictEqual(call('creditAdjust', 'admin', 'u:cty', -547, 'cộng nhầm').after, 0);
assert.throws(() => call('scanDocument', 'cty', { docType: 'CCCD' }), /OUT_OF_CREDIT/);
assert.strictEqual(call('creditAdmin', 'admin').accounts[0].status, 'HET');

// thiết bị không đăng nhập: 3 lượt, hết thì đếm 48h; đề nghị gia hạn
props.ANON_DAILY_LIMIT = '3';
const D = 'device-aaaaaaaaaaaaaaaa';
assert.strictEqual(call('anonCredit', D, 1).remaining, 3);
r = call('scanAnonymous', D, { docType: 'CV_UNGVIEN', deferCharge: true });
assert.strictEqual(r.anon.remaining, 3, 'chưa điền thì chưa trừ');
assert.strictEqual(call('anonCharge', D, r.charge.ticket).remaining, 1);
assert.throws(() => call('chargeScan', 'cty', r.charge.ticket), /không hợp lệ/, 'phiếu của thiết bị không dùng cho tài khoản');
assert.throws(() => call('scanAnonymous', D, { docType: 'CV_UNGVIEN' }), /OUT_OF_CREDIT/);
let v = call('anonCredit', D, 2);
assert.strictEqual(v.resetAt, now + 48 * 3600000);
assert.throws(() => call('anonRequestTopup', D, '', '0905123456'), /công ty/);
assert.throws(() => call('anonRequestTopup', D, 'Cty X', '12'), /điện thoại/);
assert.strictEqual(call('anonRequestTopup', D, 'Cty X', '0905 123 456').requested, true);
call('anonRequestTopup', D, 'Cty X', '0905123456');
assert.strictEqual(tables.LUOT_DENGHI.length, 1, 'mỗi thiết bị một đề nghị chờ');
let dev = call('creditAdmin', 'admin').accounts.filter((a) => a.type === 'DEVICE')[0];
assert.strictEqual(dev.request.company, 'Cty X');
// từ chối: vẫn đợi 48h
call('creditReject', 'admin', dev.request.id);
assert.strictEqual(call('anonCredit', D, 2).resetAt, v.resetAt);
now += 48 * 3600000 + 1;
v = call('anonCredit', D, 2);
assert.strictEqual(v.remaining, 3); assert.strictEqual(v.resetAt, 0);
// gia hạn cho thiết bị: lượt mua không mất, xoá đồng hồ chờ, đóng đề nghị
r = call('scanAnonymous', D, { docType: 'CV_UNGVIEN' });
assert.strictEqual(r.anon.remaining, 1);
call('anonRequestTopup', D, 'Cty X', '0905123456');
call('creditTopup', 'admin', dev.id, tiers[0].id, true);
v = call('anonCredit', D, 2);
assert.strictEqual(v.remaining, 101); assert.strictEqual(v.requested, false); assert.strictEqual(v.resetAt, 0);
// chuyển lượt đã mua sang tài khoản
assert.strictEqual(call('creditTransfer', 'admin', dev.id, 'u:cty').moved, 100);
assert.strictEqual(left(), 100);
assert.ok(call('creditHistory', 'admin', 'u:cty').orders.length === 1);
// khoá dùng thử, token, chặn dùng thử trên máy đã đăng nhập, báo cáo
users.push({ username: 'moi', role: 'USER', full_name: 'Mới' });
call('scanDocument', 'moi', { docType: 'CCCD' }); assert.strictEqual(ctx.__trial.pop(), true, 'chưa mua = dùng thử');
call('scanDocument', 'cty', { docType: 'CCCD' }); assert.strictEqual(ctx.__trial.pop(), false);
const KEY = 'AIzaSy' + 'B'.repeat(33);
assert.throws(() => call('creditSaveSettings', 'admin', { trialKey: 'free' }), /Chưa khai khoá/);
assert.throws(() => call('creditSaveSettings', 'admin', { trialApiKey: 'AIzaSy' + 'A'.repeat(33) }), /khoá chung/);
assert.strictEqual(run('trialKey_()'), '');
let set = call('creditSaveSettings', 'admin', { trialKey: 'free', trialApiKey: KEY, priceIn: '0.75', priceOut: '3.75', usdRate: '26000' }).settings;
assert.strictEqual(set.trialKeyHint, '••••BBBB'); assert.ok(!JSON.stringify(set).includes(KEY));
assert.strictEqual(run('trialKey_()'), KEY);
call('creditSaveSettings', 'admin', { trialKey: 'paid' }); assert.strictEqual(run('trialKey_()'), '');

run("logTokens_('u:moi', [{ model: 'm', vao: 1000000, ra: 100000 }, { model: 'm', vao: 0, ra: 100000 }], 'chung')");
run("logTokens_('u:moi', [{ model: 'm', vao: 1000000, ra: 0 }], 'chung')");
run("logTokens_('d:zz', [{ model: 'm', vao: 5000000, ra: 0 }], 'thu_free')");
assert.strictEqual(tables.LUOT_TOKEN.length, 2, 'cộng dồn theo ngày/khách/model/khoá');
assert.deepStrictEqual([Number(tables.LUOT_TOKEN[0].so_lan), Number(tables.LUOT_TOKEN[0].token_vao), Number(tables.LUOT_TOKEN[0].token_ra)], [2, 2000000, 200000]);

const E = 'device-eeeeeeeeeeeeeeee';
r = call('scanAnonymous', E, { docType: 'CCCD' }); assert.strictEqual(r.anon.remaining, 2);
assert.strictEqual(call('bindDevice', 'admin', E), false, 'ADMIN đăng nhập không khoá máy');
assert.strictEqual(call('anonCredit', E, 1).blocked, false);
assert.strictEqual(call('bindDevice', 'moi', E), true);
v = call('anonCredit', E, 1);
assert.deepStrictEqual([v.blocked, v.remaining, v.resetAt], [true, 0, 0]);
assert.throws(() => call('scanAnonymous', E, { docType: 'CCCD' }), /đã đăng nhập tài khoản OCR.*OUT_OF_CREDIT/);
assert.throws(() => call('anonRequestTopup', E, 'Cty', '0905123456'), /đã đăng nhập/);
call('creditSaveSettings', 'admin', { blockTrial: false });
assert.strictEqual(call('anonCredit', E, 1).remaining, 2);
call('creditSaveSettings', 'admin', { blockTrial: true });

const rep = call('creditReport', 'admin');
assert.strictEqual(rep.customers.users, 2);
assert.strictEqual(rep.customers.devicesBlocked, 1);
const nov = rep.months.filter((m) => m.month === '2026-11')[0];
// token vào 2 triệu * 0,75 + ra 0,2 triệu * 3,75 = 2,25 USD * 26000; khoá miễn phí tính 0 đồng
assert.strictEqual(nov.cost, 58500);
assert.strictEqual(nov.collected, 620000); // 500.000 (chờ thu rồi đã thu) + 120.000
assert.strictEqual(rep.totals.pendingCount, 0);
assert.ok(rep.totals.owed > 0);
assert.throws(() => call('creditReport', 'cty'), /ADMIN/);

// tableRead_ / tableWrite_ thật trên sheet giả: giữ số 0 đầu, số âm, cập nhật đúng dòng
{
  const books = {};
  const sheet = () => {
    const rows = []; let max = 2;
    return {
      rows,
      getLastRow: () => rows.length, getLastColumn: () => (rows[0] || []).length, getMaxRows: () => max, insertRowAfter() { max++; }, setFrozenRows() {},
      getRange(r, c, n = 1, m = 1) {
        const api = {
          setValues(v) { v.forEach((line, i) => { const row = rows[r - 1 + i] = rows[r - 1 + i] || []; line.forEach((x, j) => { row[c - 1 + j] = String(x); }); }); return api; },
          getDisplayValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => String((rows[r - 1 + i] || [])[c - 1 + j] || '').replace(/^'/, ''))),
          setFontWeight: () => api, setNumberFormat: () => api
        };
        return api;
      }
    };
  };
  const c2 = { console, SpreadsheetApp: { flush() {} } };
  vm.createContext(c2);
  vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'backend_gas', 'Code.js'), 'utf8'), c2);
  c2.__ss = { getSheetByName: (n) => books[n] || null, insertSheet: (n) => (books[n] = sheet()) };
  vm.runInContext('usersBook_ = function () { return __ss; };', c2);
  const go = (code) => JSON.parse(vm.runInContext('JSON.stringify(' + code + ')', c2));
  go("tableWrite_('LUOT_DENGHI', { ma: 'a', sdt: '0905123456', cong_ty: '=HYPERLINK(1)', trang_thai: 'CHO' })._row");
  go("tableWrite_('LUOT_DENGHI', { ma: 'b', sdt: '+84905123456', trang_thai: 'CHO' })._row");
  let rows = go("tableRead_('LUOT_DENGHI')");
  assert.deepStrictEqual(rows.map((r) => [r._row, r.sdt]), [[2, '0905123456'], [3, '+84905123456']]);
  assert.strictEqual(rows[0].cong_ty, '=HYPERLINK(1)');
  assert.strictEqual(books.LUOT_DENGHI.rows[1][3].charAt(0), "'", 'chuỗi giống công thức được thoát');
  go("(function () { const r = tableRead_('LUOT_DENGHI')[0]; r.trang_thai = 'TU_CHOI'; tableWrite_('LUOT_DENGHI', r); return 1; })()");
  rows = go("tableRead_('LUOT_DENGHI')");
  assert.deepStrictEqual(rows.map((r) => r.trang_thai), ['TU_CHOI', 'CHO']);
}
console.log('credit test ok');
