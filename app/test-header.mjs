import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeader } from './header-controller.mjs';

const A = '11111111-1111-7111-8111-111111111111';
const B = '22222222-2222-7222-8222-222222222222';
const marker = 'data-usage-cdp-header';
class Element {
  children = []; parentElement = null; style = { getPropertyValue(name) { return this[name] ?? ''; }, setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } }; attributes = new Map(); textContent = ''; className = ''; listeners = new Map();
  constructor(tag, connected = false) { this.tag = tag; this.connected = connected; }
  get isConnected() { return this.connected || !!this.parentElement?.isConnected; }
  get classList() { return { contains: name => this.className.split(/\s+/).includes(name) }; }
  get firstChild() { return this.children[0] ?? null; }
  get firstElementChild() { return this.firstChild; }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { for (const child of nodes) { child.remove(); child.parentElement = this; this.children.push(child); } }
  insertBefore(child, before) { child.remove(); child.parentElement = this; const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  matches(selector) {
    const classContains = selector.match(/^\[class\*="([^"]+)"\]$/);
    if (classContains) return this.className.includes(classContains[1]);
    if (selector === 'button[aria-label]') return this.tag === 'button' && this.attributes.has('aria-label');
    if (selector === 'button[aria-haspopup="menu"]') return this.tag === 'button' && this.getAttribute('aria-haspopup') === 'menu';
    if (selector === 'nav[role="navigation"]') return this.tag === 'nav' && this.getAttribute('role') === 'navigation';
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    return match ? this.attributes.has(match[1]) && (match[2] === undefined || this.attributes.get(match[1]) === match[2]) : false;
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  getClientRects() { return this.isConnected && this.style.display !== 'none' ? [{}] : []; }
  getBoundingClientRect() { return this.rect ?? { x: 400, y: 40, left: 400, top: 40, width: this.width ?? 1000, height: 40 }; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
  contains(target) { return target === this || this.children.some(child => child.contains(target)); }
  focus() { this.focused = true; }
  dispatchEvent(event) { this.listeners.get(event.type)?.(event); return true; }
}

function fixture(t, { autoWorkspace = true, nativeExport = 'fN', nativeFailures = 0 } = {}) {
  const document = new Element('document', true), toolbar = new Element('div'), nativeToolbar = new Element('div'), row = new Element('div'), action = new Element('button');
  document.head = new Element('head'); document.body = new Element('body'); document.append(document.head, document.body);
  toolbar.setAttribute('role', 'toolbar'); nativeToolbar.className = '@container/app-shell-header-toolbar';
  row.className = 'ms-auto flex justify-end'; action.setAttribute('aria-label', '聊天操作');
  document.append(toolbar); toolbar.append(nativeToolbar); nativeToolbar.append(row); row.append(action);
  const sidebar = new Element('aside'), rail = new Element('div'), nativeUsage = new Element('button'), profile = new Element('button');
  nativeUsage.setAttribute('data-native-usage', ''); profile.setAttribute('aria-label', '打开个人资料菜单');
  nativeUsage.addEventListener('click', () => {}); profile.addEventListener('click', () => {});
  document.append(sidebar, rail); rail.append(nativeUsage, profile);
  document.createElement = tag => new Element(tag);
  document.createElementNS = (namespaceURI, tag) => Object.assign(new Element(tag), { namespaceURI });
  const listeners = new Map(), requests = [], opens = [];
  const settings = new Map([['codex-usage-ui:quota-visible:v1', '0'], ['native-preference', 'keep']]);
  let current = A;
  const respond = (packet, result, hostId = 'local') => {
    queueMicrotask(() => { for (const callback of listeners.get('message') ?? []) callback({ data: { type: 'mcp-response', hostId, message: { id: packet.request.id, result } } }); });
  };
  const notify = message => { for (const callback of listeners.get('message') ?? []) callback({ data: { type: 'mcp-notification', hostId: 'local', message } }); };
  const window = {
    localStorage: { removeItem(key) { settings.delete(key); } },
    __codexUsageLayoutProbeV1: { statusIdentity: () => current },
    getComputedStyle: () => ({ visibility: 'visible' }),
    addEventListener(name, callback) { const entries = listeners.get(name) ?? new Set(); entries.add(callback); listeners.set(name, entries); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    electronBridge: { sendMessageFromView(packet) {
      requests.push(packet);
      if (autoWorkspace && packet.request.method === 'thread/read') respond(packet, { thread: { id: packet.request.params.threadId, cwd: packet.request.params.threadId === A ? 'C:\\Work A' : 'D:\\Work B' } });
      return Promise.resolve();
    } }
  };
  const nativeModule = { [nativeExport]: { openIn: {
    getTargets: () => Promise.resolve({ targets: [{ id: 'fileManager' }] }),
    open: args => { opens.push(args); return Promise.resolve({ success: true }); }
  } } };
  createHeader({ window, document, location: { protocol: 'app:', pathname: '', hash: '' }, loadNative: async () => {
    if (nativeFailures-- > 0) throw new Error('Native module temporarily unavailable');
    return nativeModule;
  } });
  const controller = window.__codexUsageHeaderV1;
  t.after(() => controller.dispose());
  return { controller, document, window, listeners, row, toolbar, sidebar, rail, nativeUsage, profile, settings, requests, respond, notify, opens,
    setThread: id => { current = id; }, node: kind => document.querySelector(`[${marker}="${kind}"]`),
    settle: async () => { await new Promise(resolve => setImmediate(resolve)); controller.scan(); } };
}

test('only the workspace control is injected; native quota and avatar remain untouched', async t => {
  const ui = fixture(t); const nativeClick = ui.nativeUsage.listeners.get('click'); const avatarClick = ui.profile.listeners.get('click');
  await ui.settle();
  assert.deepEqual(ui.node('root').children, [ui.node('folder')]);
  assert.deepEqual(ui.rail.children, [ui.nativeUsage, ui.profile]);
  assert.equal(ui.sidebar.children.length, 0);
  assert.equal(ui.nativeUsage.listeners.get('click'), nativeClick); assert.equal(ui.profile.listeners.get('click'), avatarClick);
  assert.ok(ui.requests.length > 0 && ui.requests.every(request => request.request.method === 'thread/read'));
  ui.notify({ method: 'account/rateLimits/updated', params: {} }); await ui.settle();
  assert.ok(ui.requests.every(request => request.request.method === 'thread/read'));
});

test('retired tool preference is removed without touching native preferences', async t => {
  const ui = fixture(t); await ui.settle();
  assert.equal(ui.settings.has('codex-usage-ui:quota-visible:v1'), false);
  assert.equal(ui.settings.get('native-preference'), 'keep');
  assert.equal(ui.listeners.has('storage'), false);
});

test('a transient native module failure can recover on refresh instead of caching rejection forever', async t => {
  const ui = fixture(t, { nativeExport: 'Vct', nativeFailures: 1 }); await ui.settle();
  assert.equal(ui.controller.status().workspaceState, 'unavailable');
  assert.equal(ui.node('folder').disabled, true);
  ui.notify({ method: 'account/updated', params: {} }); await ui.settle();
  assert.equal(ui.controller.status().workspaceReady, true);
  await ui.node('folder').listeners.get('click')({ isTrusted: true });
  assert.equal(ui.opens.length, 1);
});

for (const nativeExport of ['fN', 'Kat', 'Qot', 'Vct']) test(`audited ${nativeExport} bridge opens only the current workspace`, async t => {
  const ui = fixture(t, { nativeExport }); await ui.settle();
  assert.equal(ui.node('folder').disabled, false);
  await ui.node('folder').listeners.get('click')({ isTrusted: true });
  assert.equal(ui.opens.length, 1); assert.equal(ui.opens[0].cwd, 'C:\\Work A'); assert.equal(ui.opens[0].target, 'fileManager');
});

test('repeated scans and disposal leave native UI in place and no duplicated workspace entry', async t => {
  const ui = fixture(t); await ui.settle();
  for (let i = 0; i < 5; i++) ui.controller.scan();
  assert.equal(ui.document.querySelectorAll(`[${marker}="root"]`).length, 1);
  ui.setThread(null); ui.controller.scan(); assert.equal(ui.node('root'), null);
  ui.controller.dispose(); assert.deepEqual(ui.rail.children, [ui.nativeUsage, ui.profile]);
  assert.equal(ui.listeners.get('message').size, 0);
});

test('account changes invalidate pending workspace metadata without requesting quota', async t => {
  const ui = fixture(t, { autoWorkspace: false }); const old = ui.requests[0];
  ui.notify({ method: 'account/updated', params: {} }); const current = ui.requests.at(-1);
  ui.respond(old, { thread: { id: A, cwd: 'C:\\Previous account' } }); await ui.settle();
  assert.equal(ui.controller.status().workspaceReady, false);
  ui.respond(current, { thread: { id: A, cwd: 'D:\\Current account' } }); await ui.settle();
  assert.equal(ui.controller.status().workspaceReady, true);
  assert.ok(ui.requests.every(request => request.request.method === 'thread/read'));
});

test('old chat metadata and responses from another host never enable the current folder button', async t => {
  const ui = fixture(t, { autoWorkspace: false });
  const old = ui.requests.find(request => request.request.method === 'thread/read');
  ui.setThread(B); ui.controller.scan();
  const latest = ui.requests.find(request => request.request.params?.threadId === B);
  ui.respond(old, { thread: { id: A, cwd: 'C:\\Old' } });
  ui.respond(latest, { thread: { id: B, cwd: 'D:\\Wrong host' } }, 'remote');
  await ui.settle();
  assert.equal(ui.controller.status().workspaceReady, false);
  assert.equal(ui.node('folder').disabled, true);
  ui.respond(latest, { thread: { id: B, cwd: 'D:\\Current' } }); await ui.settle();
  assert.equal(ui.controller.status().workspaceReady, true);
  assert.match(ui.node('folder').title, /D:\\Current/);
});

test('trusted click re-reads workspace and opens it through the file manager target', async t => {
  const ui = fixture(t); await ui.settle();
  await ui.node('folder').listeners.get('click')({ isTrusted: false });
  assert.equal(ui.opens.length, 0);
  const before = ui.requests.length;
  await ui.node('folder').listeners.get('click')({ isTrusted: true });
  assert.ok(ui.requests.length > before);
  assert.deepEqual(ui.opens, [{ hostId: 'local', path: 'C:\\Work A', cwd: 'C:\\Work A', target: 'fileManager', openMode: 'workspace' }]);
  assert.equal(ui.controller.status().lastOpen.state, 'opened');
});

test('chat switch during a click prevents opening the previous directory', async t => {
  const ui = fixture(t, { autoWorkspace: false });
  ui.respond(ui.requests[0], { thread: { id: A, cwd: 'C:\\Work A' } }); await ui.settle();
  const opening = ui.node('folder').listeners.get('click')({ isTrusted: true });
  const request = ui.requests.at(-1);
  ui.setThread(B); ui.controller.scan();
  ui.respond(request, { thread: { id: A, cwd: 'C:\\Work A' } });
  await opening;
  assert.equal(ui.opens.length, 0);
});

test('non-local paths and mismatched thread IDs do not enable a workspace action', async t => {
  const ui = fixture(t, { autoWorkspace: false });
  ui.respond(ui.requests[0], { thread: { id: A, cwd: 'https://example.com' } }); await ui.settle();
  assert.equal(ui.controller.status().workspaceReady, false);
  ui.setThread(B); ui.controller.scan();
  const request = ui.requests.find(request => request.request.params?.threadId === B);
  ui.respond(request, { thread: { id: A, cwd: 'D:\\Wrong chat' } }); await ui.settle();
  assert.equal(ui.controller.status().workspaceReady, false);
});
