import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('an invalid installed launch writes errors to its supplied runtime, separate from copy runtime', t => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const fixtureRoot = path.join(root, 'runtime-tests');
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(fixtureRoot, 'routing-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(fixtureRoot) + path.sep)) throw new Error('Fixture cleanup escaped its root');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  for (const name of ['installed', 'copy']) {
    const runtime = path.join(directory, name);
    fs.mkdirSync(runtime);
    const session = path.join(runtime, 'session.json');
    fs.writeFileSync(session, JSON.stringify({ port: 80, listenerValidated: false }));
    const run = spawnSync(process.execPath, [path.join(root, 'injector.mjs'), session], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 1);
    const status = JSON.parse(fs.readFileSync(path.join(runtime, 'status.json'), 'utf8'));
    assert.equal(status.stage, 'error');
    assert.match(status.error, /Unverified launch session/);
    assert.equal(fs.readFileSync(path.join(runtime, 'events.jsonl'), 'utf8').trim().split('\n').length, 1);
  }
});
