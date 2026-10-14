(()=>{
/* Own heuristic, deliberately not a model tokenizer. Runs only in the renderer. */
function estimateTokens(text) {
  let units = 0;
  for (const char of text) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)) units += 1.3;
    else if (/\p{Extended_Pictographic}/u.test(char)) units += 2;
    else if (/[\x00-\x7f]/.test(char)) units += 0.25;
    else units += 0.7;
  }
  return units;
}

class SpeedWindow {
  constructor({ windowMs = 3000, idleMs = 1400 } = {}) {
    this.windowMs = windowMs;
    this.idleMs = idleMs;
    this.reset();
  }
  reset(now = 0) { this.samples = []; this.started = now; this.last = -Infinity; }
  add(text, now) {
    if (!text) return;
    if (now - this.last > this.idleMs) this.reset(now);
    this.samples.push({ time: now, tokens: estimateTokens(text) });
    this.last = now;
  }
  speed(now) {
    if (now - this.last >= this.idleMs) return null;
    this.samples = this.samples.filter(s => now - s.time < this.windowMs);
    const elapsed = Math.min(this.windowMs, now - this.started);
    if (elapsed < 500 || !this.samples.length) return null;
    return this.samples.reduce((sum, s) => sum + s.tokens, 0) / (elapsed / 1000);
  }
}

/* Replacements, contractions and formatting changes are baselined, never charged. */
function appendedText(before, after) {
  return after.startsWith(before) ? after.slice(before.length) : '';
}

class AppendTracker {
  constructor() { this.values = new Map(); }
  reset() { this.values.clear(); }
  baseline(entries) { for (const { key, text } of entries) this.values.set(key, text); }
  update(entries, active) {
    let delta = '';
    for (const { key, text } of entries) {
      const previous = this.values.get(key);
      // A newly mounted message may be history or the first chunk: baseline it.
      if (active && previous !== undefined) delta += appendedText(previous, text);
      this.values.set(key, text);
    }
    if (this.values.size > 1000) {
      const keep = new Set(entries.map(e => e.key));
      for (const key of this.values.keys()) if (!keep.has(key)) this.values.delete(key);
    }
    return delta;
  }
}

/* Loaded as a self-contained IIFE by build.mjs; no network calls, no IPC text export. */

function installTokenSpeed() {
  if (window.__chatgptTokenSpeed) return;
  if (!document.head) {
    document.addEventListener('DOMContentLoaded', installTokenSpeed, { once:true });
    return;
  }
  const tracker = new AppendTracker();
  const speed = new SpeedWindow();
  let bar, host, composer, observer, timer, queued = false, disposed = false;
  let scope, identity = '', wasActive = false, lastRoot;
  let retainedValue = null, measuredThisRun = false;
  const lastSpeeds = new Map(); // Numeric results only, per conversation in this renderer.
  const ids = new WeakMap();
  let serial = 0;
  const style = document.createElement('style');
  style.id = 'chatgpt-token-speed-style';
  style.textContent = `
    [data-token-speed-bar] { position:static!important; inset:auto!important;
      display:flex!important; align-items:center!important; justify-content:flex-end!important;
      flex:0 0 auto!important; grid-column:1 / -1!important; box-sizing:border-box!important;
      width:100%!important; min-width:0!important; height:18px!important; min-height:18px!important;
      margin:0!important; padding:0 4px!important; border:0!important; background:transparent!important;
      color:var(--color-text-tertiary, color-mix(in srgb, currentColor 60%, transparent))!important;
      font:11px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;
      font-variant-numeric:tabular-nums!important; white-space:nowrap!important;
      pointer-events:none!important; user-select:none!important; overflow:hidden!important;
    }
  `;
  document.head.append(style);
  function visible(e) {
    return e instanceof HTMLElement && !e.closest('[hidden],[inert],[aria-hidden="true"]') && e.getClientRects().length > 0;
  }
  function findComposer() {
    return [...document.querySelectorAll('[data-composer-surface-variant]')]
      .find(e => visible(e) && e.querySelector('[contenteditable="true"],textarea'))
      ?? [...document.querySelectorAll('[data-testid="v4-composer"] .chat-composer-input-surface')]
        .find(e => visible(e) && e.querySelector('[contenteditable="true"][data-lexical-editor="true"]'));
  }
  function findHost(e) {
    if (!e) return null;
    const container = e.closest('form[data-chatgpt-composer],form[data-thread-find-composer],[data-codex-composer-root],[data-testid="v4-composer"]');
    if (!container || !visible(container)) return null;
    const s = getComputedStyle(container);
    // Only known normal-flow layouts. Never wrap/reparent native elements.
    if (s.display === 'block' || s.display === 'grid' || s.display === 'flex' && s.flexDirection === 'column') return container;
    return null;
  }
  function findScope(e) {
    const session = e?.closest('[data-testid^="v4-session-pane-"][data-session-id]');
    if (session) return session;
    for (let p = e?.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.querySelector('[data-thread-user-message-navigation-content],[data-content-search-turn-key],[data-chatgpt-conversation-turn],[data-virtualized-turn-content]')) return p;
    }
    return null;
  }
  function routeIdentity(e, root) {
    if (root?.hasAttribute('data-session-id')) return location.href + '|zcode:' + root.getAttribute('data-session-id') + '|' + root.getAttribute('data-testid');
    const mark = e?.querySelector('[data-above-composer-conversation-id]')
      ?? root?.querySelector('[data-chatgpt-selection-conversation-id],[data-above-composer-conversation-id],[data-map-composer-conversation]');
    const conversation = mark?.getAttribute('data-chatgpt-selection-conversation-id') ?? mark?.getAttribute('data-above-composer-conversation-id') ?? mark?.getAttribute('data-map-composer-conversation');
    const firstTurn = root?.querySelector('[data-content-search-turn-key],[data-turn-key]');
    return location.href + '|' + (conversation ?? firstTurn?.getAttribute('data-content-search-turn-key') ?? firstTurn?.getAttribute('data-turn-key') ?? '');
  }
  function active() {
    if (!composer) return false;
    if (host.matches('[data-testid="v4-composer"]')) return [...host.querySelectorAll('button[data-testid="v4-stop"]')].some(e => visible(e) && !e.disabled);
    // Exact localized composer labels; tool/audio "Stop" controls outside composer never arm the monitor.
    return [...host.querySelectorAll('button[aria-label]')].some(e => visible(e) && !e.disabled && /^(Stop|Stop generation|Stop generating|停止|停止生成|停止响应|停止回答)$/i.test(e.getAttribute('aria-label').trim()));
  }
  function entries() {
    if (!scope) return [];
    if (scope.hasAttribute('data-session-id')) {
      const row = [...scope.querySelectorAll('[data-row-id][class~="group/assistant-row"]')]
        .reverse().find(e => visible(e) && e.closest('[data-session-id]') === scope);
      const body = row?.querySelector(':scope > [data-conversation-selectable="true"]');
      return body ? [{ key:row.getAttribute('data-row-id'), text:outputText(body) }] : [];
    }
    const leaf = [...scope.querySelectorAll('[data-markdown-text-style="assistant-message"], [data-content-search-unit-key]')]
      .reverse().find(e => {
        if (!visible(e) || host.contains(e) || e.closest('[data-user-message-bubble],[data-local-conversation-user-anchor],aside,[role="dialog"]')) return false;
        if (e.matches('[data-markdown-text-style="assistant-message"]')) return e.getAttribute('data-markdown-text-tone') !== 'tertiary';
        // Codex item owns an assistant heading; the heading itself has no output text.
        return !!e.querySelector('[data-conversation-role="assistant"]') && !e.querySelector('[data-markdown-text-style="assistant-message"]');
      });
    // Reverse document order selects the last innermost assistant output once.
    if (!leaf) return [];
    const state = leaf.closest('[data-talvt-turn-state]')?.getAttribute('data-talvt-turn-state');
    if (state && !['in_progress', 'running'].includes(state)) return [];
    const keyNode = leaf.closest('[data-chatgpt-selection-message-id],[data-content-search-unit-key],[data-dil-message-id]');
    let key = keyNode?.getAttribute('data-chatgpt-selection-message-id') ?? keyNode?.getAttribute('data-content-search-unit-key') ?? keyNode?.getAttribute('data-dil-message-id');
    if (!key) { if (!ids.has(leaf)) ids.set(leaf, ++serial); key = 'node:' + ids.get(leaf); }
    return [{ key, text:outputText(leaf) }];
  }
  function outputText(leaf) {
    const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT, { acceptNode(n) {
      const p = n.parentElement;
      return p?.closest('[data-conversation-role],[data-markdown-copy="exclude"],button,script,style,[contenteditable="true"],[hidden],[aria-hidden="true"],.sr-only,[data-streamdown="code-block-header"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    } });
    let text = '', node;
    while ((node = walker.nextNode())) text += node.textContent;
    return text;
  }
  function reset(now) { tracker.reset(); speed.reset(now); wasActive = false; measuredThisRun = false; }
  function tick() {
    if (disposed) return;
    const now = performance.now();
    const nextComposer = findComposer(), nextHost = findHost(nextComposer);
    if (nextHost !== host || nextComposer !== composer) {
      bar?.remove(); bar = null; host = nextHost; composer = nextComposer; reset(now);
    }
    if (!host) return;
    if (!bar?.isConnected) {
      bar = document.createElement('div');
      bar.dataset.tokenSpeedBar = '';
      bar.title = '可见助手文字的估算 Token 输出速度；3 秒滑动窗口，非 API 精确值';
      bar.setAttribute('aria-label', '估算 Token 输出速度');
      bar.textContent = '— tok/s';
      host.append(bar);
    }
    scope = findScope(host);
    const id = routeIdentity(host, scope);
    if (id !== identity || lastRoot !== scope) {
      reset(now); identity = id; lastRoot = scope;
      retainedValue = lastSpeeds.get(id) ?? null;
    }
    const list = entries(), running = active();
    if (running && !wasActive) { tracker.baseline(list); speed.reset(now); measuredThisRun = false; }
    const delta = tracker.update(list, running && wasActive);
    if (delta) speed.add(delta, now);
    // Electron may report hidden=true for a visibly mounted chat pane.
    // Actual composer/DOM visibility already gates this monitor; Page Visibility must not erase samples.
    if (!running) speed.reset(now);
    wasActive = running;
    const value = running ? speed.speed(now) : null;
    // Keep the last measured window, without decaying it during a pause or after Stop.
    // A new response replaces it once fresh samples yield a valid rate.
    if (value !== null && (delta || !measuredThisRun)) {
      retainedValue = value; measuredThisRun = true;
      lastSpeeds.set(identity, value);
      if (lastSpeeds.size > 64) lastSpeeds.delete(lastSpeeds.keys().next().value);
    }
    const state = retainedValue === null ? 'empty' : value !== null ? 'live' : 'retained';
    bar.dataset.tokenSpeedState = state;
    bar.title = state === 'retained'
      ? '最近一次测得的估算输出速度；下一次有可测输出时更新，非整段平均或 API 精确值'
      : '可见助手文字的估算 Token 输出速度；3 秒滑动窗口，非 API 精确值';
    const label = retainedValue === null ? '— tok/s' : `≈ ${retainedValue.toFixed(1)} tok/s`;
    if (bar.textContent !== label) bar.textContent = label;
  }
  function schedule(records) {
    if (queued || records.every(r => bar?.contains(r.target) || r.target === bar)) return;
    queued = true;
    queueMicrotask(() => { queued = false; tick(); });
  }
  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList:true, subtree:true, characterData:true, attributes:true,
    attributeFilter:['aria-label','disabled','hidden','inert','data-talvt-turn-state','data-session-id','data-testid'] });
  timer = setInterval(tick, 250);
  tick();
  window.__chatgptTokenSpeed = {
    version:'0.2.0',
    status:() => ({ mounted:!!bar?.isConnected, active:wasActive, adapter:host?.matches('[data-testid="v4-composer"]')?'zcode':scope?.querySelector('[data-talvt-turn-state]')?'chatgpt':'codex', label:bar?.textContent ?? null, state:bar?.dataset.tokenSpeedState ?? null }),
    dispose() { disposed = true; observer.disconnect(); clearInterval(timer); bar?.remove(); style.remove(); tracker.reset(); lastSpeeds.clear(); delete window.__chatgptTokenSpeed; }
  };
}

installTokenSpeed();
})();