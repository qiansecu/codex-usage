import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UsageClient } from './usage-client.mjs';
import { bindUsage } from './data-binding.mjs';

export function validTarget(target, port) {
  if (target.type !== 'page') return false;
  try {
    const page = new URL(target.url);
    const socket = new URL(target.webSocketDebuggerUrl);
    return page.protocol === 'app:' && ['', '-'].includes(page.hostname)
      && !/\/assets\/|detached-window|avatar|popup/i.test(page.pathname)
      && socket.protocol === 'ws:' && socket.hostname === '127.0.0.1'
      && socket.port === String(port) && /^\/devtools\/page\//.test(socket.pathname);
  } catch { return false; }
}

export function launchKey(session) {
  return JSON.stringify([session.port, session.startedAt ?? null, session.ownerIdentity ?? null]);
}

export function previousTarget(session, saved, records = []) {
  const signature = launchKey(session);
  if (saved?.launchKey === signature && typeof saved.targetId === 'string' && saved.targetId) return saved.targetId;
  const started = Date.parse(session.startedAt);
  if (!Number.isFinite(started)) return null;
  // Migration for launches before page-target.json: only reuse this launch's successful connection.
  return records.filter(record => record.stage === 'connected' && typeof record.targetId === 'string' && record.targetId
    && Date.parse(record.at) >= started && (!record.launchKey || record.launchKey === signature)).at(-1)?.targetId ?? null;
}

export function selectTarget(all, port, preferredId = null) {
  const candidates = all.filter(target => validTarget(target, port));
  if (preferredId) {
    const previous = candidates.filter(target => target.id === preferredId);
    if (previous.length === 1) return previous[0];
    if (candidates.length) throw new Error('Previously selected application page is unavailable; no other page was selected');
    return null;
  }
  if (candidates.length > 1) throw new Error('Multiple application pages; target selection is ambiguous');
  return candidates[0] ?? null;
}

export class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
        return;
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('CDP disconnected'));
      }
      this.pending.clear();
    });
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method)?.delete(listener);
  }
  call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP command timed out')); }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  close() { this.socket.close(); }
}

// Preserve wake-ups arriving during a read, and coalesce a burst into one refresh.
export class RefreshSignal {
  pending = false;
  wake() { this.pending = true; this.finish?.(); }
  wait(timeoutMs) {
    if (this.pending) { this.pending = false; return Promise.resolve(); }
    return new Promise(resolve => {
      const timer = setTimeout(() => this.finish?.(), timeoutMs);
      this.finish = () => { clearTimeout(timer); this.finish = null; this.pending = false; resolve(); };
    });
  }
}

async function connect(url) {
  const socket = new WebSocket(url);
  const cdp = new CDP(socket);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('CDP socket timed out')); }, 8000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP socket failed')); }, { once: true });
  });
  return cdp;
}

async function main(sessionFile) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  if (!sessionFile) throw new Error('Launch session file is required');
  const runtime = path.dirname(path.resolve(sessionFile));
  const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8').replace(/^\uFEFF/, ''));
  if (!Number.isInteger(session.port) || session.port < 1024 || session.port > 65535 || !session.listenerValidated) throw new Error('Unverified launch session');
  const stopFile = path.join(runtime, 'stop');
  const log = (stage, values = {}) => {
    const record = { at: new Date().toISOString(), stage, ...values };
    fs.appendFileSync(path.join(runtime, 'events.jsonl'), JSON.stringify(record) + '\n');
    fs.writeFileSync(path.join(runtime, 'status.json'), JSON.stringify(record, null, 2));
    console.log(JSON.stringify(record));
  };
  log('discovering');
  const targetFile = path.join(runtime, 'page-target.json');
  const parseRecord = text => { try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return null; } };
  const savedTarget = fs.existsSync(targetFile) ? parseRecord(fs.readFileSync(targetFile, 'utf8')) : null;
  const historyFile = path.join(runtime, 'events.jsonl');
  const records = !savedTarget && fs.existsSync(historyFile) && fs.statSync(historyFile).size <= 32 * 1024 * 1024
    ? fs.readFileSync(historyFile, 'utf8').split('\n').map(parseRecord).filter(Boolean) : [];
  const preferredId = previousTarget(session, savedTarget, records);
  let target;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && !fs.existsSync(stopFile)) {
    const response = await fetch(`http://127.0.0.1:${session.port}/json/list`, { signal: AbortSignal.timeout(4000), redirect: 'error' });
    if (!response.ok) throw new Error(`CDP discovery HTTP ${response.status}`);
    const all = await response.json();
    if (!Array.isArray(all)) throw new Error('Invalid target list');
    target = selectTarget(all, session.port, preferredId);
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!target || fs.existsSync(stopFile)) { log('stopped-before-attach'); return; }
  const cdp = await connect(target.webSocketDebuggerUrl);
  const wakeName = '__codexUsageWakeV1';
  const refresh = new RefreshSignal();
  cdp.on('Runtime.bindingCalled', event => {
    if (event?.name === wakeName && event.payload === 'changed') refresh.wake();
  });
  const python = session.pythonExecutable;
  if (typeof python !== 'string' || !path.isAbsolute(python)) throw new Error('A verified Python executable is required in the launch session');
  const home = session.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  const backend = new UsageClient(python, path.join(root, 'usage_backend.py'), home);
  log('connected', { targetId: target.id, launchKey: launchKey(session) });
  let lastStatus, lastSource, lastUsage, targetRecorded = false;
  try {
    await cdp.call('Runtime.enable', {});
    await cdp.call('Runtime.addBinding', { name: wakeName });
    log('refresh-mode', { mode: 'navigation-event-and-poll', pollMs: 500, minimumRefreshMs: 150 });
    while (!fs.existsSync(stopFile)) {
      const refreshStarted = Date.now();
      const expression = fs.readFileSync(path.join(root, 'footer-page.js'), 'utf8');
      if (lastSource && lastSource !== expression) {
        await cdp.call('Runtime.evaluate', { expression: 'window.__codexUsageLayoutProbeV1?.dispose()', returnByValue: true });
      }
      lastSource = expression;
      const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
      if (result.exceptionDetails) throw new Error('Placeholder script raised an exception');
      const value = result.result?.value;
      if (!value || value.state !== 'installed') throw new Error('Selected document rejected the placeholder');
      if (!targetRecorded) {
        fs.writeFileSync(targetFile, JSON.stringify({ launchKey: launchKey(session), targetId: target.id }, null, 2));
        targetRecorded = true;
      }
      if (JSON.stringify(value) !== lastStatus) { lastStatus = JSON.stringify(value); log('binding-status', value); }
      const snapshot = await backend.read(value.threadId);
      const data = bindUsage(value, snapshot);
      const applied = await cdp.call('Runtime.evaluate', {
        expression: `window.__codexUsageLayoutProbeV1?.setData(${JSON.stringify(data)})`, returnByValue: true,
      });
      if (applied.exceptionDetails) throw new Error('Usage display update failed');
      fs.writeFileSync(path.join(runtime, 'usage-snapshot.json'), JSON.stringify(snapshot, null, 2));
      fs.writeFileSync(path.join(runtime, 'display-data.json'), JSON.stringify(data, null, 2));
      const report = { ...applied.result?.value, sourceState: data.sourceState, summary: data.summary };
      if (JSON.stringify(report) !== lastUsage) { lastUsage = JSON.stringify(report); log('usage-status', report); }
      const cooldown = Math.max(0, 150 - (Date.now() - refreshStarted));
      if (cooldown) await new Promise(resolve => setTimeout(resolve, cooldown));
      await refresh.wait(500);
    }
    await cdp.call('Runtime.evaluate', { expression: 'window.__codexUsageLayoutProbeV1?.dispose()', returnByValue: true });
    await cdp.call('Runtime.removeBinding', { name: wakeName });
    await cdp.call('Runtime.evaluate', { expression: `delete window.${wakeName}`, returnByValue: true });
    log('removed');
  } finally { backend.close(); cdp.close(); }
  // Reconnection to a different listener is intentionally not automatic.
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv[2]).catch(error => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const record = { at: new Date().toISOString(), stage: 'error', error: error.message };
    const runtime = process.argv[2] ? path.dirname(path.resolve(process.argv[2])) : path.join(root, 'runtime');
    fs.writeFileSync(path.join(runtime, 'status.json'), JSON.stringify(record, null, 2));
    fs.appendFileSync(path.join(runtime, 'events.jsonl'), JSON.stringify(record) + '\n');
    console.error(error.message);
    process.exitCode = 1;
  });
}
