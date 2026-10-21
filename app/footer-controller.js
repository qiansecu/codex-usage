(() => {
  'use strict';
  const key = '__codexUsageLayoutProbeV1';
  if (window[key]) return window[key].status();
  if (location.protocol !== 'app:') return { state: 'wrong-document' };
  const marker = 'data-usage-cdp-probe';
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const uuids = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/ig;
  const owned = new Map();
  let timestampTypography = { fontSize: '12px', lineHeight: '16px' };
  let observer, timer, ticker, disposed = false, nextSlot = 0, frame = null, lastBinding;
  let detail = null;
  const menuSurface = 'bg-surface-elevated-secondary/90 ring-(--color-border-overlay) ring-(length:--dropdown-overlay-ring-width) shadow-(--shadow-dropdown-overlay) backdrop-blur-sm';
  const interactionStyles = document.createElement('style');
  interactionStyles.setAttribute('data-usage-cdp-interactions', '');
  interactionStyles.textContent = `
    button[data-usage-cdp-probe] { position: relative; isolation: isolate; }
    button[data-usage-cdp-probe]::before {
      content: ''; position: absolute; z-index: -1; background-color: transparent;
      transition: background-color 120ms ease;
    }
    button[data-usage-cdp-probe]::before { inset: -3px -6px; border-radius: 6px; }
    button[data-usage-cdp-probe]:is(:hover, :focus-visible, [aria-expanded="true"])::before {
      background-color: var(--color-background-primary-ghost-hover, color-mix(in srgb, currentColor 8%, transparent));
    }
    button[data-usage-cdp-probe]:active::before {
      background-color: var(--color-background-primary-ghost-active, color-mix(in srgb, currentColor 12%, transparent));
    }
    button[data-usage-cdp-probe]:focus-visible { outline: none; }
    button[data-usage-cdp-probe]:focus-visible::before {
      outline: 1px solid var(--color-border-overlay, currentColor);
    }
    @media (prefers-reduced-motion: reduce) {
      button[data-usage-cdp-probe]::before { transition: none; }
    }
  `;
  (document.head ?? document.documentElement).append(interactionStyles);
  const visible = element => element.isConnected && element.getClientRects().length > 0;
  const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const style = (element, values) => {
    for (const [name, value] of Object.entries(values)) if (element.style[name] !== value) element.style[name] = value;
  };
  const fmt = value => Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—';
  const tok = value => !Number.isFinite(value) ? '—' : value >= 100000 ? `${(value / 1e6).toFixed(2)}M`
    : value >= 1000 ? `${(value / 1000).toFixed(2)}k` : fmt(value);
  const duration = value => {
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 60000) return `${(value / 1000).toFixed(1)} 秒`;
    const seconds = Math.floor(value / 1000), minutes = Math.floor(seconds / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分 ${seconds % 60} 秒` : `${minutes} 分 ${seconds % 60} 秒`;
  };

  function composers() {
    const roots = [...document.querySelectorAll('[data-codex-composer-root]')].filter(visible);
    return roots.length ? roots : [...document.querySelectorAll('form[data-chatgpt-composer]')].filter(visible);
  }

  function identity() {
    const candidates = new Set();
    const accept = value => { if (uuid.test(value ?? '')) candidates.add(value.toLowerCase()); };
    for (const root of composers()) {
      for (const node of [root, ...root.querySelectorAll('[data-conversation-id],[data-above-composer-conversation-id]')]) {
        accept(node.getAttribute('data-conversation-id'));
        accept(node.getAttribute('data-above-composer-conversation-id'));
      }
    }
    const route = location.pathname + location.hash;
    const routePattern = /\/(?:local|thread)\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:[/?#]|$)/ig;
    for (const match of route.matchAll(routePattern)) accept(match[1]);
    return { threadId: candidates.size === 1 ? [...candidates][0] : null, threadCandidates: [...candidates] };
  }

  function turnCandidates(anchor) {
    const candidates = new Set();
    for (let node = anchor, depth = 0; node && depth < 24; node = node.parentElement, depth++) {
      for (const name of ['data-content-search-turn-key', 'data-content-search-unit-key']) {
        const value = node.getAttribute(name) ?? '';
        for (const id of value.match(uuids) ?? []) candidates.add(id.toLowerCase());
      }
    }
    return [...candidates];
  }

  function create(kind) {
    const element = document.createElement(kind === 'reply' ? 'button' : 'div');
    element.setAttribute(marker, kind);
    element.className = 'text-text/50 tabular-nums';
    Object.assign(element.style, timestampTypography, { fontFamily: 'inherit', color: '#8e8f90' });
    const entry = { element, kind, slotId: String(++nextSlot) };
    if (kind === 'reply') {
      element.type = 'button'; element.setAttribute('aria-haspopup', 'dialog'); element.setAttribute('aria-expanded', 'false');
      Object.assign(element.style, { display: 'none', marginInlineStart: '8px', flexShrink: '0', whiteSpace: 'nowrap',
        background: 'transparent', border: '0', padding: '0', font: 'inherit', color: '#8e8f90', cursor: 'pointer', WebkitAppRegion: 'no-drag' });
      element.addEventListener('click', event => {
        if (!event.isTrusted) return;
        event.preventDefault(); event.stopPropagation();
        if (detail?.entry === entry && detail.kind === 'reply') closeDetail(); else openDetail(entry, 'reply');
      });
    } else {
      Object.assign(element.style, { display: 'none', position: 'fixed', bottom: '4px', zIndex: '40',
        alignItems: 'center', justifyContent: 'center', gap: '28px', boxSizing: 'border-box',
        padding: '0 4px', flexWrap: 'nowrap', whiteSpace: 'nowrap', overflow: 'visible', clipPath: 'inset(-4px 0)' });
      entry.text = document.createElement('span');
      Object.assign(entry.text.style, { display: 'inline-flex', alignItems: 'center', gap: '28px', minWidth: '0', overflow: 'visible', clipPath: 'inset(-4px -6px)' });
      entry.modules = [];
      let group;
      for (let index = 0; index < 4; index++) {
        if (index % 2 === 0) {
          group = document.createElement('button'); group.setAttribute(marker, index === 0 ? 'performance-group' : 'tokens-group');
          Object.assign(group.style, { display: 'inline-flex', alignItems: 'center', flexShrink: '0' });
          {
            const detailKind = index === 0 ? 'performance' : 'tokens';
            entry[`${detailKind}Trigger`] = group; group.type = 'button';
            group.setAttribute('aria-haspopup', 'dialog'); group.setAttribute('aria-expanded', 'false');
            group.title = index === 0 ? '点击查看会话统计' : '点击查看 Token 用量明细';
            Object.assign(group.style, { font: 'inherit', color: 'inherit', background: 'transparent', border: '0',
              padding: '0', cursor: 'pointer', WebkitAppRegion: 'no-drag' });
            group.addEventListener('click', event => {
              if (!event.isTrusted) return;
              event.preventDefault(); event.stopPropagation();
              if (detail?.entry === entry && detail.kind === detailKind) closeDetail(); else openDetail(entry, detailKind);
            });
          }
          entry.text.append(group);
        }
        const module = document.createElement('span');
        entry.modules.push(module);
        group.append(module);
        if (index % 2 === 0) {
          const separator = document.createElement('span'); separator.textContent = '·';
          Object.assign(separator.style, { marginInline: '4px', opacity: '0.65' }); group.append(separator);
        }
      }
      element.append(entry.text);
      entry.context = document.createElement('button'); entry.contextTrigger = entry.context; entry.context.type = 'button';
      entry.context.setAttribute(marker, 'context-group'); entry.context.setAttribute('aria-haspopup', 'dialog');
      entry.context.setAttribute('aria-expanded', 'false'); entry.context.title = '点击查看上下文用量';
      Object.assign(entry.context.style, { display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: '0',
        font: 'inherit', color: 'inherit', border: '0', background: 'transparent', padding: '0', cursor: 'pointer', WebkitAppRegion: 'no-drag' });
      entry.context.addEventListener('click', event => {
        if (!event.isTrusted) return;
        event.preventDefault(); event.stopPropagation();
        if (detail?.entry === entry && detail.kind === 'context') closeDetail(); else openDetail(entry, 'context');
      });
      element.append(entry.context);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [name, value] of Object.entries({ width: '14', height: '14', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
      svg.style.flexShrink = '0';
      for (const progress of [false, true]) {
        const circle = document.createElementNS(svg.namespaceURI, 'circle');
        const attrs = { cx: '8', cy: '8', r: '6', stroke: 'currentColor', 'stroke-width': '1.5' };
        Object.assign(attrs, progress ? { 'stroke-linecap': 'round', 'stroke-dasharray': '37.6991', transform: 'rotate(-90 8 8)' } : { opacity: '0.22' });
        for (const [name, value] of Object.entries(attrs)) circle.setAttribute(name, value);
        svg.append(circle);
        if (progress) entry.progress = circle;
      }
      entry.context.append(svg);
      entry.percent = document.createElement('span');
      entry.context.append(entry.percent);
    }
    return entry;
  }

  function render(entry, data, id) {
    if (entry.kind === 'reply') {
      const usage = data?.replies?.[entry.slotId];
      entry.usage = usage; entry.threadId = id;
      style(entry.element, { display: Number.isFinite(usage?.totalTokens) ? '' : 'none' });
      text(entry.element, `用量 ${tok(usage?.totalTokens)} tok${usage?.status === 'in_progress' ? '（生成中）' : ''}`);
      entry.element.title = Number.isFinite(usage?.totalTokens)
        ? '点击查看本轮用量详情'
        : '尚未匹配这一轮的有效用量记录';
    } else {
      const summary = data?.summary;
      entry.summary = summary; entry.threadId = id;
      style(entry.element, { display: Number.isFinite(summary?.totalTokens) ? 'flex' : 'none' });
      const speed = Number.isFinite(summary?.outputSpeed) ? `≈${summary.outputSpeed.toFixed(1)}` : '—';
      const cache = Number.isFinite(summary?.cachedPercent) ? `${summary.cachedPercent.toFixed(1)}%` : '—';
      const modules = [`${fmt(summary?.turns)} 轮 ${fmt(summary?.steps)} 步`, `${speed} tok/s`,
        `总计 ${tok(summary?.totalTokens)} tok`, `缓存命中 ${cache}`];
      entry.modules.forEach((module, index) => text(module, modules[index]));
      const percent = Number.isFinite(summary?.contextPercent) ? Math.max(0, Math.min(100, summary.contextPercent)) : null;
      text(entry.percent, percent == null ? '—%' : `${percent.toFixed(1)}%`);
      const offset = String(37.6991 * (1 - (percent ?? 0) / 100));
      if (entry.progress.getAttribute('stroke-dashoffset') !== offset) entry.progress.setAttribute('stroke-dashoffset', offset);
      const display = percent == null ? 'none' : '';
      if (entry.progress.style.display !== display) entry.progress.style.display = display;
      entry.element.title = summary
        ? `会话 ${id}\n${modules.join(' · ')} · 上下文 ${entry.percent.textContent}\n总计为输入加输出；缓存已包含在输入中。\n继承量 ${fmt(summary.inheritedTokens)} token。\n速度为 ${summary.outputSpeedSamples ?? 0} 个纯文本样本的估算。\n上下文 ${fmt(summary.contextTokens)} / ${fmt(summary.contextWindow)}，按本地最近请求计算，可能稍有延迟。`
        : '等待识别当前会话及其本地用量记录';
    }
  }

  function closeDetail(restoreFocus = false) {
    if (!detail) return;
    const { trigger, panel } = detail;
    trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-controls');
    panel.remove(); detail = null;
    if (restoreFocus && visible(trigger)) trigger.focus({ preventScroll: true });
  }

  function positionDetail() {
    if (!detail) return;
    const anchor = detail.trigger.getBoundingClientRect(), panel = detail.panel;
    const width = Math.max(0, Math.min(360, window.innerWidth - 16));
    style(panel, { width: `${width}px`, maxHeight: `${Math.max(0, window.innerHeight - 16)}px` });
    const height = panel.getBoundingClientRect().height;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left));
    const above = anchor.top - height - 8;
    const top = above >= 8 ? above : Math.max(8, Math.min(window.innerHeight - height - 8, anchor.bottom + 8));
    style(panel, { left: `${left}px`, top: `${top}px` });
  }

  function updateDetail() {
    if (!detail) return;
    if (detail.threadId !== identity().threadId || detail.entry.threadId !== detail.threadId
      || !visible(detail.entry.element) || !visible(detail.trigger)) { closeDetail(); return; }
    if (detail.kind === 'performance') {
      const summary = detail.entry.summary;
      if (!Number.isFinite(summary?.totalTokens)) { closeDetail(); return; }
      const stats = summary.performance;
      text(detail.total, `${fmt(summary.turns)} 轮 ${fmt(summary.steps)} 步`);
      const values = [duration(stats?.modelActiveMs), duration(stats?.toolTotalMs),
        Number.isFinite(stats?.ttftAverageMs) ? `${(stats.ttftAverageMs / 1000).toFixed(2)} 秒` : '—',
        Number.isFinite(summary.outputSpeed) ? `≈${summary.outputSpeed.toFixed(1)} tok/s` : '—'];
      detail.values.forEach((node, index) => text(node, values[index]));
      text(detail.note, `模型活动按已完成推理/回复区间去重估算；工具耗时含等待、长时进程及并行重叠。TTFT取 ${stats?.ttftSamples ?? 0} 个有效完成轮次平均；速度取 ${summary.outputSpeedSamples ?? 0} 个纯文本样本。${summary.inheritedTokens > 0 ? '耗时仅统计本地记录，不含继承部分。' : ''}`);
      positionDetail(); return;
    }
    if (detail.kind === 'tokens') {
      const summary = detail.entry.summary;
      if (!Number.isFinite(summary?.totalTokens)) { closeDetail(); return; }
      const input = summary.inputTokens, cached = summary.cachedInputTokens;
      const uncached = Number.isFinite(input) && Number.isFinite(cached) && cached >= 0 && cached <= input ? input - cached : null;
      const cache = uncached != null && input > 0 ? `${(cached / input * 100).toFixed(1)}%` : '—';
      const tokenText = value => Number.isFinite(value) ? `${fmt(value)} tok` : '—';
      text(detail.total, tokenText(summary.totalTokens));
      const values = [cache, tokenText(uncached), tokenText(cached), tokenText(summary.outputTokens)];
      detail.values.forEach((node, index) => text(node, values[index]));
      text(detail.note, `总计为输入加输出；缓存读取已包含在输入中。${summary.inheritedTokens > 0 ? `包含继承用量 ${fmt(summary.inheritedTokens)} tok。` : ''}`);
      positionDetail(); return;
    }
    if (detail.kind === 'context') {
      const summary = detail.entry.summary;
      if (!Number.isFinite(summary?.totalTokens)) { closeDetail(); return; }
      const used = Number.isFinite(summary.contextTokens) && summary.contextTokens >= 0 ? summary.contextTokens : null;
      const limit = Number.isFinite(summary.contextWindow) && summary.contextWindow > 0 ? summary.contextWindow : null;
      const percent = used != null && limit != null ? Math.min(100, used / limit * 100) : null;
      const remaining = percent != null ? Math.max(0, limit - used) : null;
      const tokenText = value => Number.isFinite(value) ? `${fmt(value)} tok` : '—';
      text(detail.total, percent == null ? '—%' : `${percent.toFixed(1)}%`);
      style(detail.fill, { width: `${percent ?? 0}%`, display: percent == null ? 'none' : 'block' });
      if (percent == null) detail.track.removeAttribute('aria-valuenow'); else detail.track.setAttribute('aria-valuenow', String(percent));
      detail.track.setAttribute('aria-valuetext', percent == null ? '未知' : `${percent.toFixed(1)}%`);
      const updated = typeof summary.contextAt === 'string' ? new Date(summary.contextAt) : null;
      const values = [tokenText(used), tokenText(limit), tokenText(remaining),
        updated && Number.isFinite(updated.getTime()) ? updated.toLocaleString('zh-CN', { hour12: false }) : '—'];
      detail.values.forEach((node, index) => text(node, values[index]));
      text(detail.note, '按最近一次模型请求的本地记录估算，生成中可能稍有延迟。系统提示词、工具定义和对话消息暂无可靠的分类用量。');
      positionDetail(); return;
    }
    const usage = detail.entry.usage;
    if (usage?.turnId !== detail.turnId || !Number.isFinite(usage?.totalTokens)) { closeDetail(); return; }
    const input = usage.inputTokens, cached = usage.cachedInputTokens;
    const uncached = Number.isFinite(input) && Number.isFinite(cached) && cached <= input ? input - cached : null;
    const cache = uncached != null && input > 0 ? `${(cached / input * 100).toFixed(1)}%` : '—';
    const tokenText = value => Number.isFinite(value) ? `${fmt(value)} tok` : '—';
    const provider = typeof usage.provider === 'string' ? usage.provider : '—';
    const models = Array.isArray(usage.models) ? usage.models.filter(model => typeof model === 'string').join('、') : '';
    text(detail.total, tokenText(usage.totalTokens));
    const values = [`${provider} / ${models || '—'}`, cache, tokenText(uncached), tokenText(cached),
      tokenText(usage.cacheWriteTokens), tokenText(usage.outputTokens), tokenText(usage.reasoningTokens)];
    detail.values.forEach((node, index) => text(node, values[index]));
    positionDetail();
  }

  function openDetail(entry, kind) {
    closeDetail();
    if (!entry.threadId || entry.threadId !== identity().threadId
      || !Number.isFinite(kind === 'reply' ? entry.usage?.totalTokens : entry.summary?.totalTokens)) return;
    const trigger = kind === 'reply' ? entry.element : entry[`${kind}Trigger`];
    const title = { reply: '本轮用量', performance: '会话统计', tokens: 'Token 用量', context: '上下文已用' }[kind];
    const panel = document.createElement('section'); panel.className = menuSurface;
    panel.setAttribute(marker, `${kind}-detail`); panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', title); panel.id = `codex-usage-${kind}-detail-${entry.slotId}`; panel.tabIndex = -1;
    style(panel, { position: 'fixed', zIndex: '100', boxSizing: 'border-box', border: '0', borderRadius: '16px',
      padding: '16px', overflowY: 'auto', fontFamily: 'inherit', fontSize: timestampTypography.fontSize, lineHeight: '1.6',
      color: 'var(--color-text, var(--color-text-primary, CanvasText))', WebkitAppRegion: 'no-drag' });
    const header = document.createElement('div');
    style(header, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
      paddingBottom: '10px', marginBottom: '10px', borderBottom: '1px solid var(--color-border)' });
    const heading = document.createElement('strong'); text(heading, title);
    const total = document.createElement('strong'); style(total, { fontVariantNumeric: 'tabular-nums' });
    header.append(heading); header.append(total); panel.append(header);
    let track, fill;
    if (kind === 'context') {
      track = document.createElement('div'); track.setAttribute(marker, 'context-detail-track');
      track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', '上下文已用');
      track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
      style(track, { height: '5px', borderRadius: '999px', overflow: 'hidden', marginBottom: '12px',
        background: 'color-mix(in srgb, currentColor 12%, transparent)' });
      fill = document.createElement('div');
      style(fill, { height: '100%', width: '0%', borderRadius: 'inherit', background: 'var(--color-accent, #5b8def)' });
      track.append(fill); panel.append(track);
    }
    const values = [];
    const labels = { reply: ['提供方 / 模型', '缓存命中', '未缓存输入', '缓存读取', '缓存写入', '输出', '其中推理输出'],
      performance: ['模型活动用时（估算）', '工具调用用时（累计）', '首 token 平均（TTFT）', '输出速度（TPS）'],
      tokens: ['缓存命中', '未缓存输入', '缓存读取', '输出'],
      context: ['已用（估算）', '上下文上限', '剩余（估算）', '最后更新'] }[kind];
    for (const label of labels) {
      const row = document.createElement('div'); style(row, { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '16px', padding: '3px 0' });
      const name = document.createElement('span'); text(name, label); style(name, { color: 'var(--color-text-secondary, #70747a)' });
      const value = document.createElement('span'); style(value, { textAlign: 'right', overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' });
      row.append(name); row.append(value); panel.append(row); values.push(value);
    }
    const note = document.createElement('div'); text(note, '包含本轮多次模型调用；缓存已计入输入，推理已计入输出。');
    style(note, { color: 'var(--color-text-secondary, #70747a)', fontSize: '11px', marginTop: '10px' }); panel.append(note);
    detail = { panel, entry, trigger, kind, note, track, fill, threadId: entry.threadId, turnId: entry.usage?.turnId, total, values };
    trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', panel.id);
    document.body.append(panel); updateDetail(); panel.focus({ preventScroll: true });
  }

  function onDetailPointer(event) {
    if (detail && !detail.panel.contains(event.target) && !detail.trigger.contains(event.target)) closeDetail();
  }

  function onDetailKey(event) {
    if (detail && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDetail(true); }
  }

  function onDetailScroll(event) {
    if (detail && !detail.panel.contains(event.target)) closeDetail();
  }

  function scan() {
    if (disposed || !document.body) return;
    window.__codexUsageHeaderV1?.scan?.();
    const id = identity().threadId;
    if (frame && frame.threadId !== id) frame = null;
    const fresh = frame && Date.now() - Date.parse(frame.sampledAt) < 8000;
    const data = id && frame?.threadId === id && fresh ? frame : null;
    const wanted = new Map();
    for (const timestamp of document.querySelectorAll('[data-assistant-message-sent-time]')) if (visible(timestamp)) wanted.set(timestamp, 'reply');
    const timestamp = wanted.keys().next().value;
    if (timestamp && typeof window.getComputedStyle === 'function') {
      const nativeText = [...timestamp.children].find(child => child.getAttribute(marker) === null) ?? timestamp;
      const nativeStyle = window.getComputedStyle(nativeText);
      if (nativeStyle.fontSize) timestampTypography = { fontSize: nativeStyle.fontSize, lineHeight: nativeStyle.lineHeight };
    }
    for (const composer of composers()) wanted.set(composer, 'composer');
    for (const [anchor, entry] of owned) if (!wanted.has(anchor)) { entry.element.remove(); owned.delete(anchor); }
    for (const [anchor, kind] of wanted) {
      let entry = owned.get(anchor);
      if (!entry || !entry.element.isConnected) {
        entry?.element.remove();
        entry = create(kind);
        if (kind === 'composer') document.body.append(entry.element);
        // Share the native timestamp's hover/focus visibility, including its opacity.
        else anchor.append(entry.element);
        owned.set(anchor, entry);
      } else if (kind === 'reply' && entry.element.parentElement !== anchor) anchor.append(entry.element);
      if (kind === 'composer') {
        const rect = anchor.getBoundingClientRect();
        const left = Math.max(8, rect.left);
        const right = Math.min(window.innerWidth - 8, rect.right);
        style(entry.element, { left: `${left}px`, width: `${Math.max(0, right - left)}px` });
      }
      style(entry.element, timestampTypography);
      render(entry, data, id);
    }
    updateDetail();
    const binding = JSON.stringify({ threadId: id, composers: [...owned.values()].filter(entry => entry.kind === 'composer').length,
      replies: [...owned.entries()].filter(([, entry]) => entry.kind === 'reply')
        .map(([anchor, entry]) => ({ slotId: entry.slotId, turnCandidates: turnCandidates(anchor) })) });
    if (binding !== lastBinding) {
      lastBinding = binding;
      try { window.__codexUsageWakeV1?.('changed'); } catch { /* Polling remains available. */ }
    }
  }

  function schedule() {
    if (!timer && !disposed) timer = setTimeout(() => { timer = null; scan(); }, 40);
  }

  function status() {
    scan();
    // Hidden loading labels must still supply turn IDs to the data reader.
    const rows = [...owned.entries()].filter(([anchor]) => visible(anchor));
    return { state: 'installed', header: window.__codexUsageHeaderV1?.status?.(), ...identity(), replyCount: rows.filter(([, entry]) => entry.kind === 'reply').length,
      composerCount: rows.filter(([, entry]) => entry.kind === 'composer').length,
      visibleReplyCount: rows.filter(([, entry]) => entry.kind === 'reply' && visible(entry.element)).length,
      visibleComposerCount: rows.filter(([, entry]) => entry.kind === 'composer' && visible(entry.element)).length,
      detailOpen: !!detail, detailKind: detail?.kind ?? null,
      replies: rows.filter(([, entry]) => entry.kind === 'reply').map(([anchor, entry]) => ({ slotId: entry.slotId, turnCandidates: turnCandidates(anchor) })) };
  }

  function setData(value) {
    const id = identity().threadId;
    if (!id || value.threadId !== id) { frame = null; scan(); return { state: 'stale-frame' }; }
    frame = value;
    scan();
    return { state: 'updated', threadId: id,
      matchedReplies: [...owned.values()].filter(entry => entry.kind === 'reply' && Number.isFinite(frame.replies?.[entry.slotId]?.totalTokens)).length,
      summaryReady: Number.isFinite(frame.summary?.totalTokens) };
  }

  function dispose() {
    disposed = true;
    closeDetail();
    observer?.disconnect();
    interactionStyles.remove();
    clearTimeout(timer);
    clearInterval(ticker);
    window.__codexUsageHeaderV1?.dispose?.();
    window.removeEventListener('resize', schedule);
    document.removeEventListener('pointerdown', onDetailPointer, true); document.removeEventListener('keydown', onDetailKey, true);
    document.removeEventListener('scroll', onDetailScroll, true);
    for (const entry of owned.values()) entry.element.remove();
    owned.clear();
    delete window[key];
    return { state: 'removed' };
  }

  window[key] = { status, setData, dispose, statusIdentity: () => identity().threadId };
  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-conversation-id', 'data-above-composer-conversation-id', 'data-content-search-turn-key', 'data-content-search-unit-key'] });
  ticker = setInterval(scan, 1000);
  window.addEventListener('resize', schedule);
  document.addEventListener('pointerdown', onDetailPointer, true); document.addEventListener('keydown', onDetailKey, true);
  document.addEventListener('scroll', onDetailScroll, true);
  return status();
})();
