import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function fixture(t) {
  const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/runtime-public-tests');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'usage-public-'));
  t.after(() => {
    const expected = base + path.sep;
    if (!path.resolve(root).startsWith(expected) || !path.basename(root).startsWith('usage-public-')) throw new Error('Unexpected fixture path');
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(new URL('./check-public.mjs', import.meta.url), path.join(root, 'scripts/check-public.mjs'));
  execFileSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  fs.writeFileSync(path.join(root, 'README.md'), 'Synthetic public project\n');
  return { root, run: () => spawnSync(process.execPath, [path.join(root, 'scripts/check-public.mjs')], { cwd: root, encoding: 'utf8', windowsHide: true }) };
}

test('public source checker accepts clean sources and excludes ignored runtime files', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.gitignore'), 'runtime/\n');
  fs.mkdirSync(path.join(f.root, 'runtime'));
  fs.writeFileSync(path.join(f.root, 'runtime/session.json'), '{"synthetic":true}');
  assert.equal(f.run().status, 0);
});

test('forcing an ignored runtime file into Git is rejected', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.gitignore'), 'runtime/\n');
  fs.mkdirSync(path.join(f.root, 'runtime'));
  fs.writeFileSync(path.join(f.root, 'runtime/session.json'), '{}');
  execFileSync('git', ['add', '--force', 'runtime/session.json'], { cwd: f.root, windowsHide: true });
  const run = f.run();
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /private\/generated file type/);
});

test('personal home paths are rejected without printing their contents', t => {
  const f = fixture(t);
  const example = ['C:', 'Users', 'SyntheticUser', 'private'].join('\\');
  for (const text of [example, JSON.stringify(example)]) {
    fs.writeFileSync(path.join(f.root, 'bad.txt'), text);
    const run = f.run();
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /personal absolute home path/);
    assert.equal(run.stderr.includes(example), false);
  }
});

test('forcing local launch settings into Git is rejected even without personal paths', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.gitignore'), '*.local.json\n');
  fs.writeFileSync(path.join(f.root, 'settings.local.json'), '{}');
  execFileSync('git', ['add', '--force', 'settings.local.json'], { cwd: f.root, windowsHide: true });
  const run = f.run();
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /private\/generated file type/);
});
