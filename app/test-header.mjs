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

function fixture(t, { autoWorkspace = true, rateResult, deferRates = false, nativeExport = 'fN', nativeIconAsset, storedVisibility, storageBlocked = false } = {}) {
  const document = new Element('document', true), toolbar = new Element('div'), nativeToolbar = new Element('div'), row = new Element('div'), action = new Element('button');
  document.head = new Element('head'); document.body = new Element('body'); document.append(document.head, document.body);
  document.getElementById = id => document.querySelectorAll('[id]').find(element => element.getAttribute('id') === id) ?? null;
  toolbar.setAttribute('role', 'toolbar'); nativeToolbar.className = '@container/app-shell-header-toolbar';
  row.className = 'ms-auto flex justify-end'; action.setAttribute('aria-label', '聊天操作');
  document.append(toolbar); toolbar.append(nativeToolbar); nativeToolbar.append(row); row.append(action);
  const sidebarPanel = new Element('aside'), sidebarContainer = new Element('div'), sidebar = new Element('nav'), sidebarHeader = new Element('div'), chatList = new Element('div');
  sidebarPanel.className = 'app-shell-left-panel'; sidebarPanel.width = 340;
  sidebarContainer.className = 'sidebar-navigation'; sidebar.width = 288;
  sidebar.setAttribute('role', 'navigation');
  document.append(sidebarPanel); sidebarPanel.append(sidebarContainer); sidebarContainer.append(sidebar); sidebar.append(sidebarHeader, chatList);
  const profile = new Element('button'), profileKeys = [];
  profile.setAttribute('aria-label', '打开个人资料菜单'); profile.setAttribute('aria-haspopup', 'menu'); profile.setAttribute('data-state', 'closed');
  profile.addEventListener('keydown', event => { profileKeys.push(event.key); if (event.key === 'ArrowDown') profile.setAttribute('data-state', 'open'); });
  const rail = new Element('div'), profileSlot = new Element('div');
  rail.className = 'group/sidebar-rail flex flex-col';
  document.append(rail); rail.append(profileSlot); profileSlot.append(profile);
  // Identically named reply buttons must not be mistaken for the title-bar control.
  const reply = new Element('button'); reply.setAttribute('aria-label', '聊天操作'); document.append(reply);
  document.createElement = tag => new Element(tag);
  document.createElementNS = (namespaceURI, tag) => Object.assign(new Element(tag), { namespaceURI });
  const listeners = new Map(), requests = [], opens = [];
  let current = A;
  const respond = (packet, result, hostId = 'local') => {
    queueMicrotask(() => { for (const callback of listeners.get('message') ?? []) callback({ data: { type: 'mcp-response', hostId, message: { id: packet.request.id, result } } }); });
  };
  const notify = (message, flat = false) => { for (const callback of listeners.get('message') ?? []) callback({ data: { type: 'mcp-notification', hostId: 'local', ...flat ? message : { message } } }); };
  const now = Math.floor(Date.now() / 1000);
  const initialRates = rateResult ?? { rateLimitsByLimitId: { codex: {
    primary: { usedPercent: 26, windowDurationMins: 300, resetsAt: now + 600 },
    secondary: { usedPercent: 4, windowDurationMins: 10080, resetsAt: now + 86400 }
  } } };
  const settings = new Map();
  if (storedVisibility !== undefined) settings.set('codex-usage-ui:quota-visible:v1', storedVisibility);
  const window = {
    localStorage: {
      getItem(key) { if (storageBlocked) throw new Error('Storage blocked'); return settings.get(key) ?? null; },
      setItem(key, value) { if (storageBlocked) throw new Error('Storage blocked'); settings.set(key, value); }
    },
    innerWidth: 1280, innerHeight: 900,
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} },
    ResizeObserver: class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} },
    KeyboardEvent: class { constructor(type, values) { this.type = type; Object.assign(this, values); } },
    __codexUsageLayoutProbeV1: { statusIdentity: () => current },
    getComputedStyle: () => ({ visibility: 'visible', display: 'flex', flexDirection: 'column', position: 'relative', backgroundColor: 'rgb(245, 246, 248)' }),
    addEventListener(name, callback) { const entries = listeners.get(name) ?? new Set(); entries.add(callback); listeners.set(name, entries); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    electronBridge: { sendMessageFromView(packet) {
      requests.push(packet);
      if (packet.request.method === 'account/rateLimits/read' && !deferRates) respond(packet, initialRates);
      if (packet.request.method === 'thread/read' && autoWorkspace) respond(packet, { thread: { id: packet.request.params.threadId, cwd: packet.request.params.threadId === A ? 'C:\\Work A' : 'D:\\Work B' } });
      return Promise.resolve();
    } }
  };
  let iconInitializations = 0;
  const nativeModule = { [nativeExport]: { openIn: {
    getTargets: () => Promise.resolve({ targets: [{ id: 'fileManager' }] }),
    open: args => { opens.push(args); return Promise.resolve({ success: true }); }
  } } };
  if (nativeIconAsset) nativeModule.oS = () => { iconInitializations++; nativeModule.aS = nativeIconAsset; };
  createHeader({ window, document, location: { protocol: 'app:', pathname: '', hash: '' }, loadNative: async () => nativeModule });
  const controller = window.__codexUsageHeaderV1;
  t.after(() => controller.dispose());
  return { controller, document, window, listeners, iconInitializations: () => iconInitializations, rail, profileSlot, settings, row, toolbar, nativeToolbar, sidebarPanel, sidebarContainer, sidebar, chatList, profile, profileKeys, requests, respond, notify, opens,
    setThread: id => { current = id; }, node: kind => document.querySelector(`[${marker}="${kind}"]`),
    settle: async () => { await new Promise(resolve => setImmediate(resolve)); controller.scan(); } };
}

test('quota lives at the sidebar bottom while the workspace button stays in the toolbar', async t => {
  const ui = fixture(t); await ui.settle();
  assert.equal(ui.controller.status().fiveHourRemaining, 74);
  assert.equal(ui.controller.status().weeklyRemaining, 96);
  assert.equal(ui.row.firstChild, ui.node('root'));
  assert.equal(ui.node('quota').querySelectorAll('[role="progressbar"]').length, 2);
  assert.equal(ui.node('sidebar').parentElement, ui.sidebarContainer);
  assert.equal(ui.sidebar.children.length, 2);
  assert.equal(ui.sidebar.lastElementChild, ui.chatList);
  assert.equal(ui.node('quota').parentElement, ui.node('sidebar'));
  assert.deepEqual(ui.node('root').children, [ui.node('folder')]);
  assert.equal(ui.node('folder').disabled, false);
  assert.ok(ui.requests.every(request => ['thread/read', 'account/rateLimits/read'].includes(request.request.method)));
  assert.ok(ui.requests.filter(request => request.request.method === 'thread/read').every(request => request.request.params.includeTurns === false));
});

test('modern contextual sidebar root mounts the quota without a navigation landmark and rejects hidden or ambiguous roots', async t => {
  const ui = fixture(t); await ui.settle();
  ui.sidebar.remove(); ui.sidebarContainer.append(ui.chatList);
  ui.sidebarContainer.setAttribute('data-sidebar-navigation-root', '');
  ui.controller.scan();
  assert.equal(ui.controller.status().sidebarState, 'ready');
  assert.equal(ui.node('sidebar').parentElement, ui.sidebarContainer);
  assert.equal(ui.node('sidebar').style.height, '76px');
  ui.sidebarContainer.setAttribute('inert', ''); ui.controller.scan();
  assert.equal(ui.node('sidebar'), null);
  ui.sidebarContainer.removeAttribute('inert'); ui.controller.scan();
  assert.ok(ui.node('sidebar'));
  const extra = new Element('div'); extra.className = 'sidebar-navigation'; extra.setAttribute('data-sidebar-navigation-root', '');
  ui.sidebarPanel.append(extra); ui.controller.scan();
  assert.equal(ui.node('sidebar'), null);
  extra.remove(); ui.controller.scan(); ui.controller.scan();
  assert.equal(ui.document.querySelectorAll(`[${marker}="sidebar"]`).length, 1);
});

test('new audited native service export still opens the exact current workspace', async t => {
  const ui = fixture(t, { nativeExport: 'Kat' }); await ui.settle();
  assert.equal(ui.node('folder').disabled, false);
  await ui.node('folder').listeners.get('click')({ isTrusted: true });
  assert.equal(ui.opens.length, 1);
  assert.equal(ui.opens[0].cwd, 'C:\\Work A');
  assert.equal(ui.opens[0].target, 'fileManager');
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

test('unknown buckets, invalid percentages and expired quotas do not appear as free capacity', async t => {
  const ui = fixture(t, { rateResult: { rateLimits: { primary: { usedPercent: 0, windowDurationMins: 300 } }, rateLimitsByLimitId: { other: {} } } });
  await ui.settle();
  assert.equal(ui.controller.status().fiveHourRemaining, null);
  ui.notify({ method: 'account/rateLimits/updated', params: { rateLimits: {
    primary: { usedPercent: '0', windowDurationMins: 300 }, secondary: { usedPercent: 4, windowDurationMins: 10080, resetsAt: 1 }
  } } });
  assert.equal(ui.controller.status().fiveHourRemaining, null);
  assert.equal(ui.controller.status().weeklyRemaining, null);
});

test('stale data becomes unknown and repeated scans never duplicate the header', async t => {
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  const ui = fixture(t); await ui.settle();
  for (let i = 0; i < 5; i++) ui.controller.scan();
  assert.equal(ui.document.querySelectorAll(`[${marker}="root"]`).length, 1);
  t.mock.method(Date, 'now', () => now + 90001); ui.controller.scan();
  assert.equal(ui.controller.status().fiveHourRemaining, null);
  assert.equal(ui.node('quota').querySelector(`[${marker}="quota-percent"]`).textContent, '—');
  ui.toolbar.width = 500; ui.controller.scan();
  assert.equal(ui.node('sidebar').parentElement, ui.sidebarContainer);
  ui.setThread(null); ui.controller.scan();
  assert.equal(ui.node('root'), null);
  assert.equal(ui.controller.status().quotaVisible, true);
});

test('collapsing and reopening restores one floating quota outside the chat list layout', async t => {
  const ui = fixture(t); await ui.settle();
  const footer = ui.node('sidebar');
  ui.sidebarPanel.width = 0; ui.controller.scan();
  assert.equal(ui.node('sidebar'), null);
  assert.equal(ui.controller.status().quotaVisible, false);
  assert.equal(ui.node('folder').disabled, false);
  ui.sidebarPanel.width = 340;
  for (let i = 0; i < 3; i++) ui.controller.scan();
  assert.equal(ui.node('sidebar'), footer);
  assert.equal(ui.document.querySelectorAll(`[${marker}="sidebar"]`).length, 1);
  assert.equal(ui.sidebarContainer.lastElementChild, footer);
  assert.equal(ui.sidebar.children.includes(footer), false);
  assert.equal(ui.sidebar.lastElementChild, ui.chatList);
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

test('account switch discards an in-flight old-account quota response and fetches again', async t => {
  const ui = fixture(t, { deferRates: true });
  const first = ui.requests.find(request => request.request.method === 'account/rateLimits/read');
  ui.notify({ method: 'account/updated', params: {} }, true);
  ui.respond(first, { rateLimits: { primary: { usedPercent: 2, windowDurationMins: 300 } } });
  await ui.settle();
  assert.equal(ui.controller.status().fiveHourRemaining, null);
  const requests = ui.requests.filter(request => request.request.method === 'account/rateLimits/read');
  assert.equal(requests.length, 2);
  ui.respond(requests[1], { rateLimits: { primary: { usedPercent: 60, windowDurationMins: 300 } } });
  await ui.settle();
  assert.equal(ui.controller.status().fiveHourRemaining, 40);
});

test('a newer quota notification is not overwritten by an already-pending read', async t => {
  const ui = fixture(t, { deferRates: true });
  const request = ui.requests.find(request => request.request.method === 'account/rateLimits/read');
  ui.notify({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 55, windowDurationMins: 300 } } } }, true);
  ui.respond(request, { rateLimits: { primary: { usedPercent: 50, windowDurationMins: 300 } } });
  await ui.settle();
  assert.equal(ui.controller.status().fiveHourRemaining, 45);
});

test('quota is passive and the avatar retains its native menu handling and placement', async t => {
  const ui = fixture(t); await ui.settle();
  const card = ui.node('sidebar');
  assert.equal(card.getAttribute('role'), 'region');
  assert.equal(card.getAttribute('aria-haspopup'), null);
  assert.equal(card.listeners.has('click'), false);
  assert.equal(card.listeners.has('keydown'), false);
  assert.equal(ui.profile.getAttribute('tabindex'), null);
  assert.equal(ui.profile.getAttribute('aria-disabled'), null);
  assert.equal(ui.controller.status().accountAvatarBlocked, false);
  ui.profile.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  assert.deepEqual(ui.profileKeys, ['ArrowDown']);
  assert.equal(ui.controller.status().accountMenuOpen, true);
  assert.equal(ui.controller.status().accountMenuPlacement, 'native');
  for (const type of ['pointerdown', 'click', 'keydown']) assert.equal(ui.document.listeners.has(type), false);
});

test('rail toggle sits immediately above the avatar and switches both card and guard without duplicate entries', async t => {
  const ui = fixture(t); await ui.settle();
  const button = ui.node('quota-toggle');
  assert.equal(button.parentElement, ui.rail);
  assert.equal(ui.rail.children[ui.rail.children.indexOf(ui.profileSlot) - 1], button);
  assert.equal(button.type, 'button'); assert.equal(button.getAttribute('aria-pressed'), 'true');
  const click = trusted => button.listeners.get('click')({ isTrusted: trusted, preventDefault() {}, stopPropagation() {} });
  click(false); assert.ok(ui.node('sidebar'));
  click(true);
  assert.equal(ui.node('sidebar'), null); assert.equal(ui.node('bottom-guard'), null);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(ui.settings.get('codex-usage-ui:quota-visible:v1'), '0');
  ui.setThread(B); ui.controller.scan(); assert.equal(ui.node('sidebar'), null);
  click(true); ui.controller.scan(); ui.controller.scan();
  assert.equal(ui.document.querySelectorAll(`[${marker}="sidebar"]`).length, 1);
  assert.equal(ui.document.querySelectorAll(`[${marker}="quota-toggle"]`).length, 1);
  assert.ok(ui.node('bottom-guard')); assert.deepEqual(ui.profileKeys, []);
});

test('toggle reuses the audited native remaining-usage asset without copying native handlers or markup', async t => {
  const ui = fixture(t, { nativeExport: 'Kat', nativeIconAsset: {
    name: 'gauge-light-16', canvas: { viewBox: '0 0 16 16' },
    body: '<path d="M1 2L3 4Z" fill-rule="evenodd" onclick="ignored"/><script>ignored</script>'
  } }); await ui.settle();
  const icon = ui.node('quota-toggle').firstChild;
  assert.equal(ui.iconInitializations(), 1);
  assert.equal(ui.controller.status().quotaIcon, 'native-gauge');
  assert.equal(icon.getAttribute('viewBox'), '0 0 16 16');
  assert.equal(icon.children.length, 1);
  assert.equal(icon.firstChild.getAttribute('d'), 'M1 2L3 4Z');
  assert.equal(icon.firstChild.getAttribute('fill-rule'), 'evenodd');
  assert.equal(icon.firstChild.getAttribute('onclick'), null);
});

test('an unrecognized asset or old native module keeps the safe local gauge fallback', async t => {
  const asset = { name: 'gauge-light-16', canvas: { viewBox: '0 0 16 16' }, body: '<path d="not-a-path"/>' };
  const modern = fixture(t, { nativeExport: 'Kat', nativeIconAsset: asset }); await modern.settle();
  assert.equal(modern.controller.status().quotaIcon, 'fallback');
  assert.equal(modern.node('quota-toggle').firstChild.children.length, 2);
  const old = fixture(t, { nativeIconAsset: asset }); await old.settle();
  assert.equal(old.iconInitializations(), 0);
  assert.equal(old.controller.status().quotaIcon, 'fallback');
});

test('a saved hidden preference survives controller reload and storage events synchronize only our key', async t => {
  const ui = fixture(t, { storedVisibility: '0' }); await ui.settle();
  assert.equal(ui.node('sidebar'), null); assert.ok(ui.node('quota-toggle'));
  ui.controller.dispose();
  createHeader({ window: ui.window, document: ui.document, location: { protocol: 'app:', pathname: '', hash: '' } });
  const reloaded = ui.window.__codexUsageHeaderV1; t.after(() => reloaded.dispose());
  assert.equal(reloaded.status().quotaEnabled, false); assert.equal(ui.node('sidebar'), null);
  for (const callback of ui.listeners.get('storage')) callback({ key: 'other-setting', newValue: '1' });
  assert.equal(ui.node('sidebar'), null);
  for (const callback of ui.listeners.get('storage')) callback({ key: 'codex-usage-ui:quota-visible:v1', newValue: '1' });
  assert.ok(ui.node('sidebar')); assert.equal(ui.node('quota-toggle').getAttribute('aria-pressed'), 'true');
  reloaded.dispose();
  assert.equal(ui.node('quota-toggle'), null); assert.equal(ui.document.head.children.length, 0);
  assert.equal(ui.listeners.get('storage').size, 0);
});

test('blocked preference storage still permits toggling in the current window', async t => {
  const ui = fixture(t, { storageBlocked: true }); await ui.settle();
  const button = ui.node('quota-toggle');
  button.listeners.get('click')({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(ui.controller.status().quotaEnabled, false); assert.equal(ui.node('sidebar'), null);
  ui.setThread(B); ui.controller.scan(); assert.equal(ui.node('sidebar'), null);
  button.listeners.get('click')({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  assert.ok(ui.node('sidebar'));
});

test('native avatar or rail replacement reanchors one toggle without modifying native attributes', async t => {
  const ui = fixture(t); await ui.settle();
  const oldToggle = ui.node('quota-toggle');
  ui.profile.remove(); ui.controller.scan(); assert.equal(ui.node('quota-toggle'), null);
  const rail = new Element('div'), slot = new Element('div'); rail.className = 'group/sidebar-rail';
  ui.document.append(rail); rail.append(slot); slot.append(ui.profile);
  ui.profile.setAttribute('tabindex', '0'); ui.profile.setAttribute('aria-disabled', 'false');
  ui.controller.scan();
  assert.equal(ui.node('quota-toggle'), oldToggle); assert.equal(oldToggle.parentElement, rail);
  assert.equal(rail.children[0], oldToggle); assert.equal(rail.children[1], slot);
  assert.equal(ui.profile.getAttribute('tabindex'), '0'); assert.equal(ui.profile.getAttribute('aria-disabled'), 'false');
  ui.sidebarPanel.width = 0; ui.controller.scan();
  assert.equal(ui.node('sidebar'), null); assert.ok(ui.node('quota-toggle'));
  ui.controller.dispose(); assert.equal(ui.node('quota-toggle'), null);
});

test('bottom gap intercepts clicks outside the chat list and is removed with the quota', async t => {
  const ui = fixture(t); await ui.settle();
  const guard = ui.node('bottom-guard');
  assert.equal(guard.parentElement, ui.sidebarContainer);
  assert.equal(ui.sidebar.children.includes(guard), false);
  let prevented = false, stopped = false;
  guard.listeners.get('click')({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented && stopped, true);
  assert.equal(ui.profileKeys.length, 0);
  ui.sidebarPanel.width = 0; ui.controller.scan();
  assert.equal(ui.node('bottom-guard'), null);
  ui.sidebarPanel.width = 340; ui.controller.scan(); ui.controller.scan();
  assert.equal(ui.document.querySelectorAll(`[${marker}="bottom-guard"]`).length, 1);
  ui.controller.dispose();
  assert.equal(ui.node('bottom-guard'), null);
});

test('compact quota stays at the sidebar bottom as the composer grows, disappears or changes chats', async t => {
  const ui = fixture(t); await ui.settle();
  const composer = new Element('div'), surface = new Element('div');
  composer.setAttribute('data-codex-composer-root', ''); surface.setAttribute('data-composer-surface-variant', 'default');
  composer.append(surface); ui.document.body.append(composer);
  ui.sidebarContainer.rect = { top: 40, bottom: 900, height: 860, width: 288 }; ui.sidebarContainer.offsetHeight = 860;
  const frame = () => Object.fromEntries(['top', 'bottom', 'height', 'padding', 'left', 'right'].map(key => [key, ui.node('sidebar').style[key]]));
  const initial = frame();
  assert.equal(initial.height, '76px'); assert.equal(initial.bottom, '12px');
  for (const rect of [
    { top: 720, bottom: 840, height: 120, width: 600 },
    { top: 420, bottom: 850, height: 430, width: 600 },
    { top: -10, bottom: 700, height: 710, width: 600 }
  ]) {
    surface.rect = rect; ui.controller.scan(); assert.deepEqual(frame(), initial);
  }
  surface.remove(); ui.controller.scan(); assert.deepEqual(frame(), initial);
  for (const thread of [B, null, A]) {
    ui.setThread(thread); ui.controller.scan(); assert.deepEqual(frame(), initial);
    assert.equal(ui.node('bottom-guard').style.height, '12px');
  }
  ui.sidebarContainer.rect = { top: 40, bottom: 1040, height: 1000, width: 360 }; ui.sidebarContainer.offsetHeight = 800;
  ui.controller.scan(); assert.deepEqual(frame(), initial);
  assert.equal(ui.controller.status().quotaSizing, 'fixed-compact');
});

test('remaining below ten percent turns red, exactly ten stays normal, and unknown clears warning', async t => {
  const ui = fixture(t); await ui.settle();
  const track = ui.node('quota').querySelector('[role="progressbar"]');
  const percent = ui.node('quota').querySelector(`[${marker}="quota-percent"]`);
  const update = usedPercent => ui.notify({ method: 'account/rateLimits/updated', params: { rateLimits: {
    primary: { usedPercent, windowDurationMins: 300 }
  } } }, true);
  update(90);
  assert.equal(percent.textContent, '10%'); assert.equal(track.getAttribute('data-quota-low'), 'false');
  const normal = track.children[0].style.background;
  update(90.1);
  assert.equal(percent.textContent, '9.9%'); assert.equal(track.getAttribute('data-quota-low'), 'true');
  assert.equal(track.children[0].style.background, '#cf3d43');
  assert.equal(percent.style.color, '#cf3d43');
  update(89);
  assert.equal(track.children[0].style.background, normal);
  update('90');
  assert.equal(percent.textContent, '—'); assert.equal(track.getAttribute('data-quota-low'), 'false');
  assert.equal(track.children[0].style.width, '0%');
});

test('attachment preview, surface replacement and UI reload cannot resize or move the compact quota', async t => {
  const ui = fixture(t); await ui.settle();
  const composer = new Element('div'), surface = new Element('div'), attachment = new Element('div');
  composer.setAttribute('data-codex-composer-root', ''); surface.setAttribute('data-composer-surface-variant', 'default');
  attachment.setAttribute('data-visible-attachments', '');
  ui.document.body.append(composer); composer.append(surface);
  const frame = () => Object.fromEntries(['top', 'height', 'bottom', 'padding', 'left', 'right'].map(key => [key, ui.node('sidebar').style[key]]));
  const initial = frame();
  surface.setAttribute('data-composer-drag-active', '');
  surface.rect = { top: 400, bottom: 840, height: 440, width: 600 }; surface.append(attachment);
  ui.controller.scan(); assert.deepEqual(frame(), initial);
  surface.removeAttribute('data-composer-drag-active'); surface.remove(); ui.controller.scan();
  assert.deepEqual(frame(), initial);
  const replacement = new Element('div'); replacement.setAttribute('data-composer-surface-variant', 'default');
  replacement.append(attachment); composer.append(replacement); ui.controller.scan();
  assert.deepEqual(frame(), initial);
  ui.controller.dispose();
  createHeader({ window: ui.window, document: ui.document, location: { protocol: 'app:', pathname: '', hash: '' } });
  const reloaded = ui.window.__codexUsageHeaderV1;
  t.after(() => reloaded.dispose());
  assert.deepEqual(frame(), initial);
  attachment.remove(); reloaded.scan(); assert.deepEqual(frame(), initial);
  for (const type of ['dragenter', 'dragover', 'drop', 'dragend']) assert.equal(ui.document.listeners.has(type), false);
});
