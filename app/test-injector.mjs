import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CDP, validTarget, RefreshSignal, selectTarget, previousTarget, launchKey } from './injector.mjs';

const target = { type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/test' };
test('accepts application page only on the validated loopback port', () => {
  assert.equal(validTarget(target, 9333), true);
  for (const change of [
    { type: 'iframe' }, { url: 'https://example.com/' }, { url: 'codex-sandbox://example.com/' },
    { url: 'app://-/detached-window.html' }, { webSocketDebuggerUrl: 'ws://192.168.1.1:9333/devtools/page/test' },
    { webSocketDebuggerUrl: 'ws://127.0.0.1:9334/devtools/page/test' },
    { webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/browser/test' },
  ]) assert.equal(validTarget({ ...target, ...change }, 9333), false);
});

test('reload keeps the previously verified page amid extra app pages without guessing a replacement', () => {
  const main = { ...target, id: 'main' }, extra = { ...target, id: 'extra' };
  assert.equal(selectTarget([extra, main], 9333, 'main'), main);
  assert.throws(() => selectTarget([extra, main], 9333), /ambiguous/);
  assert.throws(() => selectTarget([extra], 9333, 'main'), /unavailable/);
  assert.throws(() => selectTarget([{ ...main, url: 'https://example.com' }, extra], 9333, 'main'), /unavailable/);
  assert.equal(selectTarget([], 9333, 'main'), null);
  assert.equal(selectTarget([main], 9333), main);
});

test('page identity migration is limited to the same launch and new launches ignore stale records', () => {
  const session = { port: 9333, startedAt: '2026-10-15T16:00:58Z', ownerIdentity: { pid: 42 } };
  const records = [
    { stage: 'connected', at: '2026-10-14T18:00:00Z', targetId: 'old' },
    { stage: 'connected', at: '2026-10-15T16:01:02Z', targetId: 'main' },
    { stage: 'error', at: '2026-10-16T17:27:44Z' },
  ];
  assert.equal(previousTarget(session, null, records), 'main');
  const saved = { launchKey: launchKey(session), targetId: 'main' };
  assert.equal(previousTarget(session, saved), 'main');
  assert.equal(previousTarget({ ...session, port: 9444 }, saved), null);
  assert.equal(previousTarget({ ...session, startedAt: '2026-10-17T00:00:00Z' }, saved, records), null);
  assert.equal(previousTarget({ port: 9333 }, null, records), null);
});

class FakeSocket extends EventTarget {
  sent = [];
  send(text) { this.sent.push(JSON.parse(text)); }
  reply(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
  close() { this.dispatchEvent(new Event('close')); }
}
test('correlates responses out of order and ignores unrelated events', async () => {
  const socket = new FakeSocket(), cdp = new CDP(socket);
  const first = cdp.call('Runtime.evaluate', { expression: '1' });
  const second = cdp.call('Runtime.evaluate', { expression: '2' });
  socket.reply({ method: 'Runtime.executionContextsCleared' });
  socket.reply({ id: socket.sent[1].id, result: { value: 2 } });
  socket.reply({ id: socket.sent[0].id, result: { value: 1 } });
  assert.deepEqual(await Promise.all([first, second]), [{ value: 1 }, { value: 2 }]);
  assert.equal(cdp.pending.size, 0);
});
test('reports protocol errors and disconnects without leaving requests pending', async () => {
  const socket = new FakeSocket(), cdp = new CDP(socket);
  const error = assert.rejects(cdp.call('Runtime.evaluate', {}), /denied/);
  socket.reply({ id: socket.sent[0].id, error: { message: 'denied' } });
  await error;
  const disconnected = assert.rejects(cdp.call('Runtime.evaluate', {}), /disconnected/);
  socket.close();
  await disconnected;
  assert.equal(cdp.pending.size, 0);
});
test('page payload rejects ordinary websites without reading their DOM', () => {
  const source = fs.readFileSync(new URL('./footer-page.js', import.meta.url), 'utf8');
  const result = vm.runInNewContext(source, { window: {}, location: { protocol: 'https:' } });
  assert.equal(result.state, 'wrong-document');
});
test('repeating the payload uses the existing controller', () => {
  const source = fs.readFileSync(new URL('./footer-page.js', import.meta.url), 'utf8');
  const result = vm.runInNewContext(source, { window: { __codexUsageLayoutProbeV1: { status: () => ({ state: 'installed', replyCount: 2 }) } } });
  assert.equal(result.replyCount, 2);
});

test('binding notifications can wake a refresh without consuming command replies', async () => {
  const socket = new FakeSocket(), cdp = new CDP(socket);
  const events = [];
  const off = cdp.on('Runtime.bindingCalled', event => events.push(event));
  const command = cdp.call('Runtime.evaluate', {});
  socket.reply({ method: 'Runtime.bindingCalled', params: { name: '__codexUsageWakeV1', payload: 'changed' } });
  assert.equal(events.length, 1);
  assert.equal(cdp.pending.size, 1);
  off();
  socket.reply({ method: 'Runtime.bindingCalled', params: { payload: 'ignored' } });
  assert.equal(events.length, 1);
  socket.reply({ id: socket.sent[0].id, result: {} });
  await command;
});

test('a switch arriving during a data read is retained and repeated switches coalesce', async () => {
  const refresh = new RefreshSignal();
  refresh.wake();
  refresh.wake();
  await refresh.wait(10000);
  assert.equal(refresh.pending, false);
  const waiting = refresh.wait(10000);
  refresh.wake();
  await waiting;
  assert.equal(refresh.pending, false);
});

test('polling remains available when there is no navigation notification', async () => {
  const refresh = new RefreshSignal();
  await refresh.wait(5);
  assert.equal(refresh.finish, null);
  refresh.wake();
  await refresh.wait(10000);
});
