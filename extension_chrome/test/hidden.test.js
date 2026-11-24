import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
test('CSS ép [hidden] ẩn thật (label có display riêng sẽ ghi đè thuộc tính hidden)', () => {
  const css = fs.readFileSync(path.join(root, 'sidepanel.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
});
test('các dòng chỉ hiện theo loại tài liệu mặc định ẩn trong HTML', () => {
  const html = fs.readFileSync(path.join(root, 'sidepanel.html'), 'utf8');
  for (const id of ['row-relation', 'row-qronly']) {
    assert.match(html, new RegExp('<label[^>]*id="' + id + '"[^>]*\\shidden'), id + ' phải có thuộc tính hidden');
  }
});
