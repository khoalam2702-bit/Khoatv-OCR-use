import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const m = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
const exists = (p) => fs.existsSync(new URL(p, root));

test('manifest MV3 và mọi tệp được khai báo đều tồn tại', () => {
  assert.equal(m.manifest_version, 3);
  for (const p of [m.side_panel.default_path, m.options_page, m.background.service_worker, ...Object.values(m.icons)]) assert.ok(exists(p), p);
});
test('quyền tối thiểu: chỉ Apps Script là host cố định, địa chỉ FBO xin lúc chạy', () => {
  assert.deepEqual(m.host_permissions.sort(), ['https://script.google.com/*', 'https://script.googleusercontent.com/*']);
  assert.ok(m.optional_host_permissions.length > 0);
  assert.ok(m.permissions.includes('sidePanel') && m.permissions.includes('scripting'));
});
test('HTML trỏ đúng tệp script/style có thật', () => {
  for (const f of ['sidepanel.html', 'options.html']) {
    const html = fs.readFileSync(new URL(f, root), 'utf8');
    for (const [, p] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) assert.ok(exists(p), f + ' -> ' + p);
  }
});
