import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const first = '11111111-1111-7111-8111-111111111111';
const second = '22222222-2222-7222-8222-222222222222';
const turn = '33333333-3333-7333-8333-333333333333';
const source = fs.readFileSync(new URL('./footer-page.js', import.meta.url), 'utf8');

// Minimal DOM fixture: exercises the real controller, with no native app access.
class Element {
  children = []; parentElement = null; style = {}; attributes = new Map(); textContent = ''; listeners = new Map();
  constructor(name, connected = false) { this.name = name; this.connected = connected; }
  get isConnected() { return this.connected || !!this.parentElement?.isConnected; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  focus() { this.focused = true; }
  append(child) { child.remove(); child.parentElement = this; this.children.push(child); }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null; }
  insertAdjacentElement(position, child) {
    assert.equal(position, 'afterend');
    child.remove();
    child.parentElement = this.parentElement;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, child);
  }
  querySelectorAll(selector) {
    const names = selector.split(',').map(part => part.match(/\[([^\]]+)\]/)?.[1]);
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll(selector)]);
    return all.filter(child => names.some(name => child.attributes.has(name)));
  }
  getClientRects() { return this.isConnected && this.style.display !== 'none' ? [{}] : []; }
  getBoundingClientRect() { return { left: 180, right: 820, top: 650, width: 640, bottom: 680, height: 30 }; }
}

function fixture(t) {
  const html = new Element('html', true), body = new Element('body'); html.append(body);
  const layout = new Element('section'), composer = new Element('div'), textarea = new Element('textarea');
  const reply = new Element('article'), timestamp = new Element('span');
  body.append(layout); layout.append(composer); composer.append(textarea); layout.append(reply); reply.append(timestamp);
  composer.setAttribute('data-codex-composer-root', '');
  textarea.setAttribute('data-conversation-id', first);
  reply.setAttribute('data-content-search-turn-key', turn);
  timestamp.setAttribute('data-assistant-message-sent-time', '');
  const location = { protocol: 'app:', pathname: `/local/${first}`, hash: '' };
  let wakeCount = 0;
  const window = { innerWidth: 1000, innerHeight: 900, addEventListener() {}, removeEventListener() {},
    __codexUsageWakeV1: () => wakeCount++ };
  const listeners = new Map();
  const document = { body, documentElement: html, querySelectorAll: selector => html.querySelectorAll(selector),
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); },
    createElement: name => new Element(name), createElementNS: (uri, name) => Object.assign(new Element(name), { namespaceURI: uri }) };
  vm.runInNewContext(source, { window, location, document, Date, setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: class { observe() {} disconnect() {} } });
  const controller = window.__codexUsageLayoutProbeV1;
  t.after(() => controller.dispose());
  const label = kind => document.querySelectorAll('[data-usage-cdp-probe]').find(node => node.getAttribute('data-usage-cdp-probe') === kind);
  const apply = (threadId, replyExtra = {}, summaryExtra = {}) => {
    const slot = controller.status().replies[0].slotId;
    return controller.setData({ threadId, sampledAt: new Date().toISOString(),
      summary: { turns: 1, steps: 1, totalTokens: 200, contextPercent: 4, ...summaryExtra },
      replies: { [slot]: { turnId: turn, totalTokens: 200, status: 'completed', ...replyExtra } } });
  };
  return { controller, body, layout, composer, textarea, timestamp, reply, location, label, apply, listeners, wakes: () => wakeCount };
}

test('loading is hidden but still exposes IDs; switching immediately hides the old chat', t => {
  const ui = fixture(t);
  const waiting = ui.controller.status();
  assert.equal(waiting.replyCount, 1);
  assert.equal(waiting.visibleReplyCount, 0);
  assert.equal(waiting.visibleComposerCount, 0);
  assert.equal(waiting.replies[0].turnCandidates[0], turn);
  assert.equal(ui.apply(first).matchedReplies, 1);
  assert.equal(ui.label('reply').textContent, '用量 200 tok');
  assert.equal(ui.controller.status().visibleComposerCount, 1);
  const wakes = ui.wakes();
  ui.textarea.setAttribute('data-conversation-id', second);
  ui.location.pathname = `/local/${second}`;
  const switched = ui.controller.status();
  assert.equal(switched.visibleReplyCount, 0);
  assert.equal(switched.visibleComposerCount, 0);
  assert.equal(ui.apply(first).state, 'stale-frame');
  assert.ok(ui.wakes() > wakes);
});

test('reply detail binds the clicked turn, updates values, toggles and dismisses on Escape/outside', t => {
  const ui = fixture(t);
  ui.apply(first, { inputTokens: 160, cachedInputTokens: 100, outputTokens: 40, cacheWriteTokens: 0,
    reasoningTokens: 20, provider: 'openai_http', models: ['test-model'] });
  const trigger = ui.label('reply');
  const click = isTrusted => trigger.listeners.get('click')({ isTrusted, preventDefault() {}, stopPropagation() {} });
  click(false); assert.equal(ui.label('reply-detail'), undefined);
  click(true);
  let panel = ui.label('reply-detail');
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.parentElement, ui.body);
  assert.equal(panel.children[1].children[1].textContent, 'openai_http / test-model');
  assert.equal(panel.children[2].children[1].textContent, '62.5%');
  assert.equal(panel.children[3].children[1].textContent, '60 tok');
  assert.equal(panel.children[5].children[1].textContent, '0 tok');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  ui.apply(first, { totalTokens: 300, turnId: turn });
  assert.equal(ui.label('reply-detail'), panel);
  assert.equal(panel.children[0].children[1].textContent, '300 tok');
  assert.equal(panel.children[5].children[1].textContent, '—');
  ui.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(ui.label('reply-detail'), undefined);
  assert.equal(trigger.focused, true);
  click(true); click(true); assert.equal(ui.label('reply-detail'), undefined);
  click(true); panel = ui.label('reply-detail');
  ui.listeners.get('pointerdown')({ target: panel }); assert.equal(ui.label('reply-detail'), panel);
  ui.listeners.get('pointerdown')({ target: ui.composer }); assert.equal(ui.label('reply-detail'), undefined);
});

test('open reply detail closes on chat/turn replacement and all popup handlers are disposed', t => {
  const ui = fixture(t); ui.apply(first);
  const click = () => ui.label('reply').listeners.get('click')({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  click(); assert.equal(ui.controller.status().detailOpen, true);
  ui.apply(first, { turnId: '44444444-4444-7444-8444-444444444444' });
  assert.equal(ui.controller.status().detailOpen, false);
  click(); ui.textarea.setAttribute('data-conversation-id', second); ui.location.pathname = `/local/${second}`;
  assert.equal(ui.controller.status().detailOpen, false);
  ui.controller.dispose();
  assert.equal(ui.label('reply-detail'), undefined);
  assert.equal(ui.listeners.size, 0);
});

test('summary is outside composer layout and replacement reply IDs remain readable while hidden', t => {
  const ui = fixture(t);
  ui.apply(first);
  assert.equal(ui.label('composer').parentElement, ui.body);
  assert.deepEqual(ui.layout.children, [ui.composer, ui.reply]);
  const oldSlot = ui.controller.status().replies[0].slotId;
  ui.timestamp.remove();
  const replacement = new Element('span');
  replacement.setAttribute('data-assistant-message-sent-time', '');
  ui.reply.append(replacement);
  const changed = ui.controller.status();
  assert.equal(changed.visibleReplyCount, 0);
  assert.notEqual(changed.replies[0].slotId, oldSlot);
  assert.equal(changed.replies[0].turnCandidates[0], turn);
  assert.equal(ui.apply(first).matchedReplies, 1);
  assert.equal(ui.controller.status().visibleReplyCount, 1);
});

test('performance module shares popup dismissal but stays bound to the current summary', t => {
  const ui = fixture(t);
  ui.apply(first, {}, { outputSpeed: 25.5, outputSpeedSamples: 4,
    performance: { modelActiveMs: 61000, toolTotalMs: 125000, ttftAverageMs: 1600, ttftSamples: 3 } });
  const trigger = ui.label('performance-group');
  assert.equal(trigger.name, 'button');
  const click = () => trigger.listeners.get('click')({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  click(); let panel = ui.label('performance-detail');
  assert.equal(ui.controller.status().detailKind, 'performance');
  assert.equal(panel.getAttribute('aria-label'), '会话统计');
  assert.equal(panel.children[1].children[1].textContent, '1 分 1 秒');
  assert.equal(panel.children[2].children[1].textContent, '2 分 5 秒');
  assert.equal(panel.children[3].children[1].textContent, '1.60 秒');
  assert.equal(panel.children[4].children[1].textContent, '≈25.5 tok/s');
  ui.apply(first, {}, { performance: null });
  assert.equal(panel.children[1].children[1].textContent, '—');
  click(); assert.equal(ui.label('performance-detail'), undefined);
  click(); ui.label('reply').listeners.get('click')({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(ui.label('performance-detail'), undefined);
  assert.equal(ui.controller.status().detailKind, 'reply');
  click(); ui.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(trigger.focused, true);
  click(); ui.textarea.setAttribute('data-conversation-id', second); ui.location.pathname = `/local/${second}`;
  assert.equal(ui.controller.status().detailOpen, false);
});

test('tokens module uses cumulative input/output including inheritance, refreshes and closes with chat', t => {
  const ui = fixture(t);
  ui.apply(first, {}, { totalTokens: 1000, inputTokens: 900, cachedInputTokens: 800, outputTokens: 100, inheritedTokens: 500 });
  const trigger = ui.label('tokens-group');
  assert.equal(trigger.name, 'button');
  const click = () => trigger.listeners.get('click')({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  click(); const panel = ui.label('tokens-detail');
  assert.equal(panel.getAttribute('aria-label'), 'Token 用量');
  assert.equal(panel.children[0].children[1].textContent, '1,000 tok');
  assert.equal(panel.children[1].children[1].textContent, '88.9%');
  assert.equal(panel.children[2].children[1].textContent, '100 tok');
  assert.equal(panel.children[3].children[1].textContent, '800 tok');
  assert.equal(panel.children[4].children[1].textContent, '100 tok');
  assert.match(panel.children[5].textContent, /继承用量 500 tok/);
  ui.apply(first, {}, { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
  assert.equal(panel.children[1].children[1].textContent, '—');
  assert.equal(panel.children[2].children[1].textContent, '0 tok');
  ui.apply(first); assert.equal(panel.children[2].children[1].textContent, '—');
  click(); assert.equal(ui.label('tokens-detail'), undefined);
  click(); ui.label('performance-group').listeners.get('click')({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(ui.label('tokens-detail'), undefined);
  assert.equal(ui.controller.status().detailKind, 'performance');
  click(); ui.textarea.setAttribute('data-conversation-id', second); ui.location.pathname = `/local/${second}`;
  assert.equal(ui.controller.status().detailOpen, false);
});

test('context detail shows estimate, capacity, remaining and timestamp without fabricated categories', t => {
  const ui = fixture(t);
  ui.apply(first, {}, { contextTokens: 250, contextWindow: 1000, contextPercent: 25, contextAt: '2026-10-17T01:02:03Z' });
  const trigger = ui.label('context-group');
  assert.equal(trigger.name, 'button');
  const click = () => trigger.listeners.get('click')({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  click(); const panel = ui.label('context-detail'), track = ui.label('context-detail-track');
  assert.equal(ui.controller.status().detailKind, 'context');
  assert.equal(panel.children[0].children[1].textContent, '25.0%');
  assert.equal(track.getAttribute('aria-valuenow'), '25');
  assert.equal(track.children[0].style.width, '25%');
  assert.equal(panel.children[2].children[1].textContent, '250 tok');
  assert.equal(panel.children[3].children[1].textContent, '1,000 tok');
  assert.equal(panel.children[4].children[1].textContent, '750 tok');
  assert.notEqual(panel.children[5].children[1].textContent, '—');
  assert.match(panel.children[6].textContent, /暂无可靠的分类用量/);
  ui.apply(first, {}, { contextTokens: 1500, contextWindow: 1000 });
  assert.equal(track.getAttribute('aria-valuenow'), '100');
  assert.equal(panel.children[2].children[1].textContent, '1,500 tok');
  assert.equal(panel.children[4].children[1].textContent, '0 tok');
  click(); assert.equal(ui.label('context-detail'), undefined);
  click(); ui.label('tokens-group').listeners.get('click')({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(ui.label('context-detail'), undefined);
  assert.equal(ui.controller.status().detailKind, 'tokens');
  click(); ui.textarea.setAttribute('data-conversation-id', second); ui.location.pathname = `/local/${second}`;
  assert.equal(ui.controller.status().detailOpen, false);
});

test('context unknown differs from a real empty context and never treats invalid capacity as free space', t => {
  const ui = fixture(t); ui.apply(first, {}, { contextTokens: null, contextWindow: 1000 });
  ui.label('context-group').listeners.get('click')({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  const panel = ui.label('context-detail'), track = ui.label('context-detail-track');
  assert.equal(track.getAttribute('aria-valuenow'), null);
  assert.equal(track.children[0].style.display, 'none');
  assert.equal(panel.children[2].children[1].textContent, '—');
  assert.equal(panel.children[4].children[1].textContent, '—');
  assert.equal(panel.children[5].children[1].textContent, '—');
  ui.apply(first, {}, { contextTokens: 0, contextWindow: 1000 });
  assert.equal(track.getAttribute('aria-valuenow'), '0');
  assert.equal(track.children[0].style.display, 'block');
  assert.equal(panel.children[4].children[1].textContent, '1,000 tok');
  ui.apply(first, {}, { contextTokens: 10, contextWindow: 0, contextAt: 'invalid' });
  assert.equal(panel.children[0].children[1].textContent, '—%');
  assert.equal(panel.children[4].children[1].textContent, '—');
  assert.equal(panel.children[5].children[1].textContent, '—');
});
