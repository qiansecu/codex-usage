export function createHeader(options) {
  'use strict';
  const { window, document, location, loadNative = () => import('/assets/app-shared-bbfeca5e5737.js')
    .catch(() => import('/assets/app-shared-30671c57ec82.js')) } = options;
  const key = '__codexUsageHeaderV1';
  if (window[key]) return window[key].status();
  if (typeof window.electronBridge?.sendMessageFromView !== 'function' || location.protocol !== 'app:') return;
  // Discard a short-lived layout snapshot left by the previous composer-aligned version.
  delete window.__codexUsageQuotaLayoutHandoffV1;
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const marker = 'data-usage-cdp-header';
  const pending = new Map();
  const rows = new Map();
  const state = { rates: null, sampledAt: 0, quotaState: 'loading', threadId: null, workspace: null, workspaceState: 'unbound', lastOpen: null };
  let disposed = false, epoch = 0, quotaRevision = 0, refreshing = false, workspaceEpoch = 0, opening = false;
  let root, quota, quotaRoot, folder, service, servicePromise, nativeModulePromise, folderReady = false, lastTargetPath = null, anchorState = 'pending', sidebarState = 'pending';
  let profileTrigger = null, bottomGuard = null, quotaToggle = null, toggleStyles = null;
  let quotaIconState = 'fallback';
  const visibilityKey = 'codex-usage-ui:quota-visible:v1';
  let quotaEnabled = true;
  try { quotaEnabled = window.localStorage?.getItem(visibilityKey) !== '0'; } catch { /* Storage may be unavailable; toggling still works for this window. */ }
  const style = (element, values) => {
    for (const [name, value] of Object.entries(values)) if (element.style[name] !== value) element.style[name] = value;
  };
  const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const shown = element => element.isConnected && element.getClientRects().length > 0
    && window.getComputedStyle(element).visibility !== 'hidden';
  const currentThread = () => typeof window.__codexUsageLayoutProbeV1?.statusIdentity === 'function'
    ? window.__codexUsageLayoutProbeV1.statusIdentity() : (() => {
    const candidates = new Set();
    const accept = value => { if (uuid.test(value ?? '')) candidates.add(value.toLowerCase()); };
    for (const composer of document.querySelectorAll('[data-codex-composer-root],form[data-chatgpt-composer]')) if (shown(composer)) {
      accept(composer.getAttribute('data-conversation-id'));
      accept(composer.getAttribute('data-above-composer-conversation-id'));
      for (const node of composer.querySelectorAll('[data-conversation-id],[data-above-composer-conversation-id]')) {
        accept(node.getAttribute('data-conversation-id'));
        accept(node.getAttribute('data-above-composer-conversation-id'));
      }
    }
    for (const match of (location.pathname + location.hash).matchAll(/\/(?:local|thread)\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:[/?#]|$)/ig)) accept(match[1]);
    return candidates.size === 1 ? [...candidates][0] : null;
  })();

  function rpc(method, params) {
    if (disposed || !['account/rateLimits/read', 'thread/read'].includes(method)) return Promise.reject(new Error('Unsupported request'));
    const id = 'codex-usage-header-' + crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Request timed out')); }, 12000);
      pending.set(id, { resolve, reject, timer });
      window.electronBridge.sendMessageFromView({ type: 'mcp-request', hostId: 'local',
        request: { id, method, ...params === undefined ? {} : { params } }, timeoutMs: 10000 })
        .catch(() => { const request = pending.get(id); if (request) { clearTimeout(timer); pending.delete(id); reject(new Error('Native request failed')); } });
    });
  }

  function bucket(result) {
    if (result?.rateLimitsByLimitId != null) return result.rateLimitsByLimitId.codex ?? null;
    const legacy = result?.rateLimits;
    return legacy && (legacy.limitId == null || legacy.limitId === 'codex') ? legacy : null;
  }

  function updateQuota(result) {
    quotaRevision++;
    state.rates = bucket(result);
    state.sampledAt = Date.now();
    state.quotaState = state.rates ? 'ready' : 'unavailable';
    render();
  }

  async function refreshQuota() {
    if (disposed || refreshing) return;
    refreshing = true;
    const requestedEpoch = epoch;
    const requestedRevision = quotaRevision;
    try { const result = await rpc('account/rateLimits/read'); if (!disposed && epoch === requestedEpoch && quotaRevision === requestedRevision) updateQuota(result); }
    catch { if (!disposed && epoch === requestedEpoch && quotaRevision === requestedRevision) { state.quotaState = 'error'; render(); } }
    finally { refreshing = false; if (!disposed && epoch !== requestedEpoch) refreshQuota(); }
  }

  async function nativeService() {
    if (service) return service;
    // Audited exports: Kat in 26.1013.4894.0, fN in 26.1007.9446.0. A mismatch fails closed.
    servicePromise ??= (nativeModulePromise ??= loadNative()).then(module => {
      const api = module.Kat ?? module.fN;
      if (typeof api?.openIn?.open !== 'function' || typeof api?.openIn?.getTargets !== 'function') throw new Error('Native file manager unavailable');
      return api;
    });
    service = await servicePromise;
    return service;
  }

  async function useNativeQuotaIcon(icon) {
    try {
      const module = await (nativeModulePromise ??= loadNative());
      if (disposed) return;
      // Audited gauge-light-16 asset and initializer in 26.1013.4894.0; never call an unknown version's initializer.
      if (typeof module.Kat?.openIn?.open !== 'function' || typeof module.oS !== 'function') return;
      module.oS();
      const asset = module.aS;
      if (asset?.name !== 'gauge-light-16' || typeof asset.body !== 'string' || asset.canvas?.viewBox !== '0 0 16 16') return;
      const paths = [];
      for (const match of asset.body.matchAll(/<path\b[^>]*>/g)) {
        const d = match[0].match(/\bd="([^"]+)"/)?.[1];
        if (!d || !/^[\d\s.,+eE\-AaCcHhLlMmQqSsTtVvZz]+$/.test(d)) return;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d); path.setAttribute('fill', 'currentColor');
        for (const name of ['fill-rule', 'clip-rule']) {
          const rule = match[0].match(new RegExp(`${name}="(evenodd|nonzero)"`))?.[1];
          if (rule) path.setAttribute(name, rule);
        }
        paths.push(path);
      }
      if (!paths.length || disposed || !quotaToggle?.contains(icon)) return;
      while (icon.firstChild) icon.firstChild.remove();
      icon.setAttribute('viewBox', asset.canvas.viewBox); icon.setAttribute('stroke', 'none');
      icon.append(...paths); quotaIconState = 'native-gauge';
    } catch { /* Keep the local gauge fallback when this native asset is unavailable. */ }
  }

  async function nativeCall(request) {
    try { return await request; } finally { request[Symbol.dispose]?.(); }
  }

  function localDirectory(value) {
    return typeof value === 'string' && /^[a-z]:[\\/]/i.test(value) && !/[\x00-\x1f]/.test(value) && !/[<>|"?*]/.test(value.slice(2));
  }

  async function readWorkspace(threadId) {
    const result = await rpc('thread/read', { threadId, includeTurns: false });
    const thread = result?.thread;
    if (thread?.id !== threadId || !localDirectory(thread.cwd)) throw new Error('No local workspace for this chat');
    return thread.cwd;
  }

  async function refreshWorkspace() {
    const threadId = state.threadId;
    if (!threadId || disposed) return;
    const requestEpoch = ++workspaceEpoch;
    try {
      const path = await readWorkspace(threadId);
      if (disposed || requestEpoch !== workspaceEpoch || currentThread() !== threadId) return;
      state.workspace = path;
      state.workspaceState = 'ready';
      if (lastTargetPath !== path) {
        folderReady = false;
        const api = await nativeService();
        if (disposed || requestEpoch !== workspaceEpoch) return;
        const targets = await nativeCall(api.openIn.getTargets({ hostId: 'local', cwd: path }));
        if (disposed || requestEpoch !== workspaceEpoch || currentThread() !== threadId) return;
        folderReady = targets?.targets?.some(target => target.id === 'fileManager') === true;
        lastTargetPath = folderReady ? path : null;
      }
    } catch {
      if (disposed || requestEpoch !== workspaceEpoch) return;
      state.workspaceState = 'unavailable'; state.workspace = null; folderReady = false; lastTargetPath = null;
    }
    if (!disposed) render();
  }

  async function openWorkspace(event) {
    if (!event.isTrusted || opening || !folderReady || disposed) return;
    const threadId = currentThread();
    if (!threadId || threadId !== state.threadId) return;
    opening = true; render();
    try {
      // Re-read on click; never accept a DOM-supplied path or an old chat's path.
      const path = await readWorkspace(threadId);
      const api = await nativeService();
      if (disposed || currentThread() !== threadId) return;
      const result = await nativeCall(api.openIn.open({ hostId: 'local', cwd: path, path, target: 'fileManager', openMode: 'workspace' }));
      if (!result?.success) throw new Error('Open failed');
      state.lastOpen = { state: 'opened', threadId, at: Date.now() };
    } catch { if (!disposed) state.lastOpen = { state: 'error', threadId, at: Date.now() }; }
    finally { opening = false; if (!disposed) render(); }
  }

  function onMessage(event) {
    const packet = event.data;
    if (disposed || packet?.hostId !== 'local') return;
    if (packet.type === 'mcp-response') {
      const request = pending.get(packet.message?.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(packet.message.id);
      packet.message.error ? request.reject(new Error('Native RPC error')) : request.resolve(packet.message.result);
    } else if (packet.type === 'mcp-notification') {
      const message = packet.message ?? packet.notification ?? packet;
      if (message?.method === 'account/rateLimits/updated') updateQuota(message.params);
      if (message?.method === 'account/updated') {
        epoch++; workspaceEpoch++; state.rates = null; state.sampledAt = 0; state.quotaState = 'loading';
        state.workspace = null; state.workspaceState = 'loading'; folderReady = false; lastTargetPath = null;
        render(); refreshQuota(); refreshWorkspace();
      }
    }
  }

  function findActions() {
    const matches = [...document.querySelectorAll('button[aria-label]')].filter(button =>
      /^(聊天操作|会话操作|Chat actions|Conversation actions|Thread actions)$/i.test(button.getAttribute('aria-label') ?? '') && shown(button)
      && button.closest('[role="toolbar"]')?.querySelector('[class*="app-shell-header-toolbar"]'));
    if (matches.length !== 1) { anchorState = `actions-${matches.length}`; return null; }
    const button = matches[0], toolbar = button.closest('[role="toolbar"]');
    if (!toolbar) { anchorState = 'no-toolbar'; return null; }
    for (let row = button.parentElement; row && row !== toolbar; row = row.parentElement) {
      if (row.classList.contains('ms-auto') && row.classList.contains('justify-end')) { anchorState = 'ready'; return { row, button, toolbar }; }
    }
    anchorState = 'no-actions-row'; return null;
  }

  function findSidebar() {
    const valid = node => {
      const panel = node.closest('.app-shell-left-panel');
      const container = node.closest('.sidebar-navigation');
      if (!panel || !container || !shown(node) || !shown(panel)) return false;
      if (node.closest('[inert]') || node.getAttribute('aria-hidden') === 'true') return false;
      if (!['relative', 'absolute', 'fixed', 'sticky'].includes(window.getComputedStyle(container).position)) return false;
      if (panel.getBoundingClientRect().width < 160 || node.getBoundingClientRect().width < 160) return false;
      const layout = window.getComputedStyle(node);
      return layout.display === 'flex' && layout.flexDirection === 'column';
    };
    // Newer clients identify the contextual sidebar itself; their nav may only wrap top-level links.
    const modern = [...document.querySelectorAll('[data-sidebar-navigation-root]')].filter(valid);
    const matches = modern.length ? modern : [...document.querySelectorAll('nav[role="navigation"]')].filter(valid);
    sidebarState = matches.length === 1 ? 'ready' : 'hidden-or-ambiguous';
    return matches.length === 1 ? matches[0] : null;
  }

  function createQuota() {
    bottomGuard = document.createElement('div'); bottomGuard.setAttribute(marker, 'bottom-guard');
    bottomGuard.setAttribute('aria-hidden', 'true');
    style(bottomGuard, { position: 'absolute', left: '0', right: '0', bottom: '0', height: '12px', zIndex: '9',
      background: 'transparent', pointerEvents: 'auto', cursor: 'default', WebkitAppRegion: 'no-drag' });
    for (const type of ['pointerdown', 'click', 'dblclick', 'auxclick', 'contextmenu']) {
      bottomGuard.addEventListener(type, event => { event.preventDefault(); event.stopPropagation(); });
    }
    quotaRoot = document.createElement('div'); quotaRoot.setAttribute(marker, 'sidebar');
    // Same surface utilities as the native account dropdown (DAi's default menu surface).
    quotaRoot.className = 'bg-surface-elevated-secondary/90 ring-(--color-border-overlay) ring-(length:--dropdown-overlay-ring-width) shadow-(--shadow-dropdown-overlay) backdrop-blur-sm';
    quotaRoot.setAttribute('role', 'region');
    quotaRoot.setAttribute('aria-label', '账号剩余额度');
    style(quotaRoot, { position: 'absolute', left: '12px', right: '12px', bottom: '12px', height: '76px', zIndex: '10', minWidth: '0', boxSizing: 'border-box', padding: '9px 15px',
      border: '0', borderRadius: '16px', color: '#8e8f90', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'inherit', fontSize: '12px', lineHeight: '14px', fontVariantNumeric: 'tabular-nums', WebkitAppRegion: 'no-drag' });
    quota = document.createElement('div'); quota.setAttribute(marker, 'quota');
    style(quota, { display: 'grid', gap: '11px', width: '100%', flexShrink: '0' });
    for (const [minutes, labelText] of [[300, '5 小时'], [10080, '1 周']]) {
      const block = document.createElement('div'); block.setAttribute('data-quota-window', String(minutes));
      style(block, { display: 'grid', gap: '3px', minWidth: '0' });
      if (minutes === 10080) style(block, { transform: 'translateY(-1px)' });
      const heading = document.createElement('div');
      style(heading, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' });
      const label = document.createElement('span'); label.textContent = labelText;
      style(label, { color: 'var(--color-text, #2b2b30)', fontWeight: '600' });
      const number = document.createElement('span'); number.setAttribute(marker, 'quota-remaining');
      style(number, { display: 'inline-flex', alignItems: 'baseline', gap: '4px', textAlign: 'right', color: 'var(--color-text-secondary, #70747a)', whiteSpace: 'nowrap' });
      const prefix = document.createElement('span'); prefix.textContent = '剩余';
      const percent = document.createElement('span'); percent.setAttribute(marker, 'quota-percent');
      number.append(prefix, percent);
      heading.append(label, number);
      const track = document.createElement('span');
      track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', `${labelText} 剩余额度`);
      track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
      style(track, { display: 'block', width: '100%', height: '6px', borderRadius: '999px', overflow: 'hidden', background: 'light-dark(#e7e7eb, #44444b)' });
      const fill = document.createElement('span');
      style(fill, { display: 'block', height: '100%', width: '0%', borderRadius: 'inherit', background: 'light-dark(#2b2b30, #ededed)', transition: 'width 180ms ease, background-color 120ms ease' });
      track.append(fill);
      rows.set(minutes, { label, track, fill, number, percent }); block.append(heading, track); quota.append(block);
    }
    quotaRoot.append(quota);
  }

  function findProfileTrigger() {
    const matches = [...document.querySelectorAll('button[aria-haspopup="menu"]')].filter(button =>
      /^(打开个人资料菜单|Open profile menu)$/i.test(button.getAttribute('aria-label') ?? '') && shown(button) && !button.disabled);
    return matches.length === 1 ? matches[0] : null;
  }

  function isProfileMenuOpen(trigger) {
    return !!trigger && (trigger.getAttribute('data-state') === 'open' || trigger.getAttribute('aria-expanded') === 'true');
  }

  function createQuotaToggle() {
    quotaToggle = document.createElement('button'); quotaToggle.type = 'button';
    quotaToggle.setAttribute(marker, 'quota-toggle');
    quotaToggle.setAttribute('aria-label', '显示账号额度');
    style(quotaToggle, { display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '36px', height: '36px', padding: '8px', flexShrink: '0', boxSizing: 'border-box',
      border: '0', borderRadius: '12px', cursor: 'pointer', WebkitAppRegion: 'no-drag' });
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ width: '20', height: '20', viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(name, value);
    const dial = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    dial.setAttribute('d', 'M4.9 19.1a9 9 0 1 1 14.2 0M12 12l4-4M7 5l1 1M4 11h1M19 11h1');
    const hub = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hub.setAttribute('cx', '12'); hub.setAttribute('cy', '12'); hub.setAttribute('r', '1.5');
    icon.append(dial, hub); quotaToggle.append(icon);
    useNativeQuotaIcon(icon);
    quotaToggle.addEventListener('click', event => {
      if (!event.isTrusted || disposed) return;
      event.preventDefault(); event.stopPropagation();
      quotaEnabled = !quotaEnabled;
      try { window.localStorage?.setItem(visibilityKey, quotaEnabled ? '1' : '0'); } catch { /* Keep the in-memory choice if storage is blocked. */ }
      scan();
    });
    toggleStyles = document.createElement('style'); toggleStyles.setAttribute('data-usage-quota-toggle-styles', '');
    toggleStyles.textContent = `
      [data-usage-cdp-header="quota-toggle"] { color: var(--color-text-tertiary, #8f8f8f); background: transparent; transition: background-color 120ms ease; }
      [data-usage-cdp-header="quota-toggle"]:is(:hover, [aria-pressed="true"]) { color: var(--color-text, #202123); background: var(--color-background-primary-ghost-hover, color-mix(in srgb, currentColor 8%, transparent)); }
      [data-usage-cdp-header="quota-toggle"]:active { background: var(--color-background-primary-ghost-active, color-mix(in srgb, currentColor 12%, transparent)); }
      [data-usage-cdp-header="quota-toggle"]:focus-visible { outline: 1px solid var(--color-border-overlay, currentColor); outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { [data-usage-cdp-header="quota-toggle"] { transition: none; } }
    `;
    (document.head ?? document.documentElement).append(toggleStyles);
  }

  function syncQuotaToggle() {
    const rail = profileTrigger?.closest('[class*="group/sidebar-rail"]');
    if (!rail || !shown(rail)) { quotaToggle?.remove(); return; }
    let slot = profileTrigger;
    while (slot.parentElement && slot.parentElement !== rail) slot = slot.parentElement;
    if (slot.parentElement !== rail) { quotaToggle?.remove(); return; }
    if (!quotaToggle) createQuotaToggle();
    const order = [...rail.children];
    if (quotaToggle.parentElement !== rail || order[order.indexOf(slot) - 1] !== quotaToggle) rail.insertBefore(quotaToggle, slot);
    const pressed = String(quotaEnabled);
    if (quotaToggle.getAttribute('aria-pressed') !== pressed) quotaToggle.setAttribute('aria-pressed', pressed);
    const title = quotaEnabled ? '隐藏账号额度' : '显示账号额度';
    quotaToggle.title = title;
    if (quotaToggle.getAttribute('aria-label') !== title) quotaToggle.setAttribute('aria-label', title);
  }

  function onVisibilityStorage(event) {
    if (event.key !== visibilityKey && event.key !== null) return;
    quotaEnabled = event.key === null || event.newValue !== '0';
    scan();
  }

  function create(actions) {
    root = document.createElement('div'); root.setAttribute(marker, 'root');
    style(root, { display: 'flex', alignItems: 'center', flexShrink: '0', marginInlineEnd: '4px', color: '#8e8f90', WebkitAppRegion: 'no-drag' });
    folder = document.createElement('button'); folder.type = 'button'; folder.className = actions.button.className;
    folder.setAttribute(marker, 'folder'); folder.setAttribute('aria-label', '打开当前会话工作区');
    style(folder, { width: '28px', height: '28px', padding: '0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'inherit', flexShrink: '0', WebkitAppRegion: 'no-drag' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ width: '17', height: '17', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10H3Z'); svg.append(path); folder.append(svg);
    folder.addEventListener('click', openWorkspace);
    root.append(folder);
  }

  function remaining(minutes) {
    const rate = [state.rates?.primary, state.rates?.secondary].find(value => value?.windowDurationMins === minutes);
    const fresh = state.sampledAt > 0 && Date.now() - state.sampledAt < 90000 && (rate?.resetsAt == null || Date.now() < rate.resetsAt * 1000);
    return { rate, value: fresh && typeof rate?.usedPercent === 'number' && Number.isFinite(rate.usedPercent) ? Math.max(0, Math.min(100, 100 - rate.usedPercent)) : null };
  }

  function render() {
    if (disposed) return;
    for (const [minutes, row] of rows) {
      const { value } = remaining(minutes);
      const number = value == null ? '—' : `${Number(value.toFixed(1))}%`;
      const low = value != null && value < 10;
      text(row.percent, number);
      style(row.percent, { color: low ? '#cf3d43' : value == null ? 'var(--color-text-secondary, #70747a)' : 'light-dark(#2b2b30, #ededed)' });
      style(row.fill, { width: `${value ?? 0}%`, background: low ? '#cf3d43' : 'light-dark(#2b2b30, #ededed)' });
      if (row.track.getAttribute('data-quota-low') !== String(low)) row.track.setAttribute('data-quota-low', String(low));
      if (value == null) row.track.removeAttribute('aria-valuenow'); else row.track.setAttribute('aria-valuenow', String(value));
      const updated = state.sampledAt ? new Date(state.sampledAt).toLocaleTimeString('zh-CN') : '尚未取得';
      const title = `${minutes === 300 ? '5 小时' : '1 周'}账号剩余额度：${number}\n最后更新：${updated}${state.quotaState === 'error' ? '\n刷新暂时失败' : ''}`;
      row.label.title = row.track.title = row.number.title = title;
    }
    if (!folder) return;
    folder.disabled = opening || !folderReady || !state.workspace || state.workspaceState !== 'ready';
    style(folder, { opacity: folder.disabled ? '0.4' : '1', cursor: folder.disabled ? 'default' : 'pointer' });
    folder.title = opening ? '正在打开工作区…' : state.lastOpen?.state === 'error' && state.lastOpen.threadId === state.threadId
      ? '打开失败，请重试' : state.workspace ? `在资源管理器中打开\n${state.workspace}` : '当前会话尚无可用的本地工作区';
  }

  function scan() {
    if (disposed) return;
    const threadId = currentThread();
    if (threadId !== state.threadId) {
      workspaceEpoch++; state.threadId = threadId; state.workspace = null; folderReady = false; lastTargetPath = null;
      state.workspaceState = threadId ? 'loading' : 'unbound';
      state.lastOpen = null;
      if (threadId) refreshWorkspace();
    }
    const sidebar = findSidebar();
    if (sidebar && quotaEnabled) {
      if (!quotaRoot) createQuota();
      // Use the native positioned sidebar, outside its flex navigation and scrolling list.
      const container = sidebar.closest('.sidebar-navigation');
      if (bottomGuard.parentElement !== container) container.append(bottomGuard);
      if (quotaRoot.parentElement !== container) container.append(quotaRoot);
    } else { quotaRoot?.remove(); bottomGuard?.remove(); }
    profileTrigger = findProfileTrigger();
    syncQuotaToggle();
    const actions = threadId ? findActions() : null;
    if (actions) {
      if (!root) create(actions);
      if (root.parentElement !== actions.row || actions.row.firstElementChild !== root) actions.row.insertBefore(root, actions.row.firstChild);
    } else root?.remove();
    render();
  }

  function status() {
    const menuId = profileTrigger?.getAttribute('aria-controls');
    const nativeMenu = menuId ? document.getElementById(menuId) : null;
    const cardSurface = quotaRoot?.isConnected ? window.getComputedStyle(quotaRoot) : null;
    const menuSurface = nativeMenu?.getAttribute('role') === 'menu' ? window.getComputedStyle(nativeMenu) : null;
    return { state: disposed ? 'removed' : root?.isConnected || quotaRoot?.isConnected || quotaToggle?.isConnected ? 'installed' : 'waiting-layout', anchorState, sidebarState,
      accountMenuReady: !!profileTrigger, accountMenuOpen: isProfileMenuOpen(profileTrigger),
      accountAvatarBlocked: false, bottomClickGuardVisible: !!bottomGuard?.isConnected,
      accountMenuPlacement: 'native',
      quotaEnabled, quotaToggleVisible: !!quotaToggle?.isConnected, quotaIcon: quotaIconState,
      quotaLocation: 'sidebar', quotaPresentation: 'floating-glass', quotaVisible: !!quotaRoot?.isConnected, folderVisible: !!root?.isConnected, quotaState: state.quotaState,
      quotaSurface: 'native-menu',
      quotaAlignment: 'bottom', quotaSizing: 'fixed-compact',
      quotaSurfaceMatchesMenu: cardSurface && menuSurface ? ['backgroundColor', 'boxShadow', 'backdropFilter'].every(name => cardSurface[name] === menuSurface[name]) : null,
      fiveHourRemaining: remaining(300).value, weeklyRemaining: remaining(10080).value, sampledAt: state.sampledAt,
      workspaceState: state.workspaceState, workspaceReady: folderReady && state.workspaceState === 'ready', threadId: state.threadId,
      lastOpen: state.lastOpen };
  }

  function dispose() {
    if (disposed) return { state: 'removed' };
    disposed = true; clearInterval(poller); window.removeEventListener('message', onMessage);
    bottomGuard?.remove(); quotaToggle?.remove(); toggleStyles?.remove();
    window.removeEventListener('storage', onVisibilityStorage);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Disposed')); }
    pending.clear(); root?.remove(); quotaRoot?.remove(); delete window[key];
    return { state: 'removed' };
  }

  window[key] = { scan, status, dispose };
  window.addEventListener('message', onMessage);
  window.addEventListener('storage', onVisibilityStorage);
  const poller = setInterval(() => { refreshQuota(); refreshWorkspace(); }, 30000);
  scan(); refreshQuota();
  return status();
}
