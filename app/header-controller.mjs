export function createHeader(options) {
  'use strict';
  const { window, document, location, loadNative = () => import('/assets/app-shared-955d52676f9c.js')
    .catch(() => import('/assets/app-shared-bbfeca5e5737.js'))
    .catch(() => import('/assets/app-shared-30671c57ec82.js')) } = options;
  const key = '__codexUsageHeaderV1';
  if (window[key]) return window[key].status();
  if (typeof window.electronBridge?.sendMessageFromView !== 'function' || location.protocol !== 'app:') return;
  // Remove only the retired tool preference; native account UI and its settings are untouched.
  try { window.localStorage?.removeItem?.('codex-usage-ui:quota-visible:v1'); } catch { }
  delete window.__codexUsageQuotaLayoutHandoffV1;
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const marker = 'data-usage-cdp-header';
  const pending = new Map();
  const state = { threadId: null, workspace: null, workspaceState: 'unbound', lastOpen: null };
  let disposed = false, workspaceEpoch = 0, opening = false;
  let root, folder, service, servicePromise, folderReady = false, lastTargetPath = null, anchorState = 'pending';
  const style = (element, values) => {
    for (const [name, value] of Object.entries(values)) if (element.style[name] !== value) element.style[name] = value;
  };
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
    if (disposed || method !== 'thread/read') return Promise.reject(new Error('Unsupported request'));
    const id = 'codex-usage-header-' + crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Request timed out')); }, 12000);
      pending.set(id, { resolve, reject, timer });
      window.electronBridge.sendMessageFromView({ type: 'mcp-request', hostId: 'local',
        request: { id, method, ...params === undefined ? {} : { params } }, timeoutMs: 10000 })
        .catch(() => { const request = pending.get(id); if (request) { clearTimeout(timer); pending.delete(id); reject(new Error('Native request failed')); } });
    });
  }

  async function nativeService() {
    if (service) return service;
    // Audited exports: Qot in 26.1021.3705.0, Kat in 26.1013.4894.0, fN in 26.1007.9446.0. A mismatch fails closed.
    servicePromise ??= loadNative().then(module => {
      const api = module.Qot ?? module.Kat ?? module.fN;
      if (typeof api?.openIn?.open !== 'function' || typeof api?.openIn?.getTargets !== 'function') throw new Error('Native file manager unavailable');
      return api;
    });
    service = await servicePromise;
    return service;
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
      if (message?.method === 'account/updated') {
        workspaceEpoch++; state.workspace = null; state.workspaceState = 'loading';
        folderReady = false; lastTargetPath = null;
        render(); refreshWorkspace();
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

  function render() {
    if (disposed) return;
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
    const actions = threadId ? findActions() : null;
    if (actions) {
      if (!root) create(actions);
      if (root.parentElement !== actions.row || actions.row.firstElementChild !== root) actions.row.insertBefore(root, actions.row.firstChild);
    } else root?.remove();
    render();
  }

  function status() {
    return { state: disposed ? 'removed' : root?.isConnected ? 'installed' : 'waiting-layout', anchorState,
      folderVisible: !!root?.isConnected, workspaceState: state.workspaceState,
      workspaceReady: folderReady && state.workspaceState === 'ready', threadId: state.threadId, lastOpen: state.lastOpen };
  }

  function dispose() {
    if (disposed) return { state: 'removed' };
    disposed = true; clearInterval(poller); window.removeEventListener('message', onMessage);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Disposed')); }
    pending.clear(); root?.remove(); delete window[key];
    return { state: 'removed' };
  }

  window[key] = { scan, status, dispose };
  window.addEventListener('message', onMessage);
  const poller = setInterval(refreshWorkspace, 30000);
  scan();
  return status();
}
