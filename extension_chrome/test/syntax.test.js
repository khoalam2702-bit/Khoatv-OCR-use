import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function* jsFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'test' || e.name === 'vendor') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsFiles(p); else if (e.name.endsWith('.js')) yield p;
  }
}
test('mọi tệp JS của extension đúng cú pháp', () => {
  for (const f of jsFiles(root)) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, path.relative(root, f) + ': ' + r.stderr);
  }
});
