import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeOrigin, sanitizeConfig, mergeConfig, fetchRemoteConfig } from '../lib/appconfig.js';
import { createVault } from '../lib/vault.js';

const G1 = 'https://script.google.com/macros/s/AAA111/exec';
const G2 = 'https://script.google.com/macros/s/BBB222/exec';

test('normalizeOrigin', () => {
  assert.equal(normalizeOrigin('https://erp.x.vn/Main/Login.aspx?a=1'), 'https://erp.x.vn');
  assert.equal(normalizeOrigin('http://localhost/FBO/'), 'http://localhost');
  assert.equal(normalizeOrigin('javascript:alert(1)'), '');
  assert.equal(normalizeOrigin('abc'), '');
});
test('sanitizeConfig bỏ link lạ và địa chỉ sai', () => {
  const c = sanitizeConfig({ gasUrl: 'https://evil.example/exec', fboOrigins: ['ftp://x', 'https://a.vn/p'], configUrl: 'http://insecure' });
  assert.deepEqual(c, { fboOrigins: ['https://a.vn'] });
  assert.deepEqual(sanitizeConfig(null), {});
});
test('mergeConfig: ưu tiên user > remote > shipped, địa chỉ FBO gộp', () => {
  const shipped = { gasUrl: G1, fboOrigins: ['http://localhost'], configUrl: 'https://w/api/extension-config' };
  assert.equal(mergeConfig({ shipped, remote: {}, user: {} }).source, 'shipped');
  const r = mergeConfig({ shipped, remote: { gasUrl: G2, fboOrigins: ['https://erp.a.vn'] }, user: { fboOrigins: ['https://b.vn'] } });
  assert.equal(r.gasUrl, G2); assert.equal(r.source, 'remote');
  assert.deepEqual(r.fboOrigins, ['https://erp.a.vn', 'https://b.vn']);
  assert.equal(mergeConfig({ shipped, remote: { gasUrl: G2 }, user: { gasUrl: G1 } }).source, 'user');
  assert.equal(r.configUrl, 'https://w/api/extension-config');
});
test('fetchRemoteConfig: lỗi mạng, HTTP lỗi, dữ liệu rác đều trả null', async () => {
  const ok = async () => ({ ok: true, json: async () => ({ gasUrl: G2, fboOrigins: [] }) });
  assert.deepEqual(await fetchRemoteConfig('https://w/x', ok), { gasUrl: G2 });
  assert.equal(await fetchRemoteConfig('https://w/x', async () => { throw new Error('down'); }), null);
  assert.equal(await fetchRemoteConfig('https://w/x', async () => ({ ok: false })), null);
  assert.equal(await fetchRemoteConfig('https://w/x', async () => ({ ok: true, json: async () => ({ gasUrl: 'x' }) })), null);
  assert.equal(await fetchRemoteConfig('', ok), null);
});
test('config.json đóng gói sẵn hợp lệ', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
  const c = sanitizeConfig(raw);
  assert.ok(c.gasUrl && c.configUrl);
  assert.equal(c.fboOrigins, undefined, 'không có địa chỉ FBO mặc định, người dùng tự thêm');
});
test('vault: mã hoá khứ hồi, mỗi lần một IV, sai khoá không giải mã được', async () => {
  const mk = async () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const k1 = await mk(), k2 = await mk();
  const v1 = createVault({ getKey: async () => k1 }), v2 = createVault({ getKey: async () => k2 });
  const a = await v1.encrypt('Mật khẩu 123!'), b = await v1.encrypt('Mật khẩu 123!');
  assert.notEqual(a, b);
  assert.ok(!a.includes('Mật khẩu'));
  assert.equal(await v1.decrypt(a), 'Mật khẩu 123!');
  await assert.rejects(v2.decrypt(a));
  await assert.rejects(v1.decrypt('rác'));
});
