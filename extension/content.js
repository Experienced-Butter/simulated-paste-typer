/**
 * 超星粘贴助手 · 内容脚本（Content Script）
 * ==================================================================
 * 运行在 *.chaoxing.com 的每个框架里（含子框架），负责：
 *
 *  1) 在页面右下角渲染一个可拖动的悬浮按钮（只在顶层框架渲染 UI）；
 *  2) 在触发时向后台申请“读取剪贴板 → 倒计时 → 输入”；
 *  3) 倒计时结束后把文本输入到“当前光标处”：
 *     - trusted 模式：请求后台通过 CDP 派发真实的键盘事件（需要“调试”权限）
 *     - dom 模式：使用 document.execCommand('insertText') 等 DOM 插入方式
 *  4) 通过“候选帧”机制确定该由哪个框架执行输入（比如输入框在内嵌框架里）。
 *
 * 设计要点：
 *  - 所有用户可见 UI 都放在 Shadow DOM 里，避免被页面样式污染、也避免污染页面；
 *  - 悬浮按钮按下时阻止 mousedown 默认行为，避免把页面输入框的焦点抢走；
 *  - 输入开始前会再次确认“光标仍在可编辑元素里”，防止把内容打到搜索框等位置。
 *
 * 本文件不发送任何网络请求，也不收集任何数据。
 */
;(function () {
  'use strict';

  /* ------------------------------------------------------------------
   * 0. 基础守卫与运行状态
   * ------------------------------------------------------------------ */
  const CFG = globalThis.HXPT_CONFIG;
  if (!CFG) return;                              // 共享配置未加载（理论上不会发生）
  if (globalThis.__HXPT_CONTENT__) return;        // 防止重复注入
  globalThis.__HXPT_CONTENT__ = true;

  const state = {
    settings: CFG.normalize(CFG.DEFAULTS), // 当前设置（后台在触发时会重新读取）
    lastEl: null,                          // 最近一次获得焦点的可编辑元素
    lastCaret: null,                       // 最近一次记录的光标位置
    activeRun: null,                       // 正在进行的输入任务（同一框架内最多一个）
    fabDrag: null                          // 悬浮按钮拖动状态
  };

  const ui = {
    host: null,         // Shadow DOM 宿主
    shadow: null,
    fab: null,          // 悬浮按钮
    overlay: null,      // 倒计时 / 进行中的状态条
    overlayText: null,
    overlayBtn: null,
    toast: null,        // 轻提示
    overlayActive: false,
    overlayStartAt: 0,
    overlayChars: 0,
    overlayTimer: null,
    toastTimer: null
  };

  const isTopFrame = () => {
    try { return window.top === window; } catch (e) { return false; }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** 与后台通信的小封装：永远 resolve，失败时返回 { ok:false, error } */
  function sendBg(payload, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: '与后台通信超时' });
      }, typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 20000);
      try {
        chrome.runtime.sendMessage(payload, (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const lastError = chrome.runtime.lastError;
          if (lastError) { resolve({ ok: false, error: lastError.message || '后台无响应' }); return; }
          resolve(resp || { ok: false, error: '后台没有返回内容' });
        });
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: String((e && e.message) || e) });
      }
    });
  }

  /* ------------------------------------------------------------------
   * 1. 可编辑元素 / 光标相关的工具函数
   * ------------------------------------------------------------------ */

  // 这些 input type 不是文本输入框，跳过
  const IGNORED_INPUT_TYPES = {
    hidden: 1, file: 1, checkbox: 1, radio: 1, range: 1, color: 1,
    date: 1, 'datetime-local': 1, month: 1, week: 1, time: 1,
    button: 1, submit: 1, reset: 1, image: 1
  };

  /** 判断元素是否是可写入文本的目标（input/textarea/contenteditable） */
  function isEditable(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (tag === 'INPUT') {
      if (el.disabled || el.readOnly) return false;
      const type = String(el.type || 'text').toLowerCase();
      return !IGNORED_INPUT_TYPES[type];
    }
    if (el.isContentEditable) return true;
    return false;
  }

  /** 焦点是否落在一个 iframe/frame/object 里（用于跨域编辑器场景） */
  function isFrameElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    return tag === 'IFRAME' || tag === 'FRAME' || tag === 'OBJECT' || tag === 'EMBED';
  }

  /** 获取真正持有焦点的元素（会穿透页面自己实现的 shadow DOM） */
  function deepActiveElement() {
    let el = document.activeElement;
    let guard = 0;
    while (el && el.shadowRoot && el.shadowRoot.activeElement && guard < 10) {
      el = el.shadowRoot.activeElement;
      guard += 1;
    }
    return el;
  }

  /** 元素是否可见（display:none、零尺寸等都算不可用） */
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    try {
      if (!el.getClientRects || el.getClientRects().length === 0) return false;
      const style = window.getComputedStyle(el);
      if (!style || style.visibility === 'hidden' || style.display === 'none') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (e) {
      return false;
    }
  }

  /** 记录光标位置：文本框存偏移量，富文本框存 Range */
  function captureCaret(el) {
    if (!el) return null;
    try {
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (typeof el.selectionStart !== 'number') return null;
        return {
          kind: 'text',
          start: el.selectionStart,
          end: typeof el.selectionEnd === 'number' ? el.selectionEnd : el.selectionStart,
          dir: el.selectionDirection || 'none'
        };
      }
      if (el.isContentEditable) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) return { kind: 'rich', range: sel.getRangeAt(0).cloneRange() };
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /** 把之前记录的光标位置恢复回去（仅在该元素仍然可编辑时有效） */
  function restoreCaret(el, caret) {
    if (!el || !caret) return;
    try {
      if (caret.kind === 'text' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        const max = el.value.length;
        const start = CFG.clampInt(caret.start, 0, max, max);
        const end = CFG.clampInt(caret.end, start, max, start);
        el.setSelectionRange(start, end, caret.dir || 'none');
        return;
      }
      if (caret.kind === 'rich' && caret.range && el.isContentEditable) {
        if (!el.contains(caret.range.startContainer) || !el.contains(caret.range.endContainer)) return;
        const sel = window.getSelection();
        if (!sel) return;
        sel.removeAllRanges();
        sel.addRange(caret.range);
      }
    } catch (e) { /* 忽略 */ }
  }

  /** 记录一次“可编辑焦点”，供之后恢复光标使用 */
  function noteEditable(el) {
    if (!isEditable(el)) return;
    state.lastEl = el;
    // 延迟一拍读取 selection，保证拿到的不是上一次的旧值
    state.lastCaret = captureCaret(el);
  }

  function refreshLastCaret() {
    if (!state.lastEl) return;
    if (deepActiveElement() === state.lastEl) state.lastCaret = captureCaret(state.lastEl);
  }

  // 监听焦点与光标变化，随时保存“最后一次编辑位置”
  document.addEventListener('focusin', (event) => {
    if (isEditable(event.target)) noteEditable(event.target);
  }, true);

  document.addEventListener('selectionchange', () => {
    refreshLastCaret();
  }, true);

  ['keyup', 'mouseup', 'pointerup', 'input'].forEach((type) => {
    document.addEventListener(type, () => {
      refreshLastCaret();
    }, true);
  });

  /* ------------------------------------------------------------------
   * 2. Shadow DOM UI：悬浮按钮 + 倒计时状态条 + 轻提示
   * ------------------------------------------------------------------ */

  const UI_CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }

    .hxpt-fab {
      position: fixed;
      right: 18px;
      bottom: 96px;
      width: 46px;
      height: 46px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      cursor: pointer;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      box-shadow: 0 6px 18px rgba(59, 130, 246, .45), inset 0 1px 0 rgba(255, 255, 255, .35);
      opacity: .92;
      transition: transform .12s ease, box-shadow .12s ease, opacity .12s ease;
      pointer-events: auto;
      touch-action: none;
      z-index: 1;
    }
    .hxpt-fab:hover { transform: scale(1.06); opacity: 1; }
    .hxpt-fab:active { transform: scale(.97); }
    .hxpt-fab[hidden] { display: none !important; }
    .hxpt-fab.busy { animation: hxpt-pulse 1.2s ease-in-out infinite; }
    @keyframes hxpt-pulse {
      0%, 100% { box-shadow: 0 6px 18px rgba(139, 92, 246, .5); }
      50% { box-shadow: 0 6px 30px rgba(139, 92, 246, .95); }
    }

    .hxpt-overlay {
      position: fixed;
      left: 50%;
      bottom: 28px;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: min(580px, 92vw);
      padding: 10px 12px 10px 16px;
      border-radius: 14px;
      background: rgba(17, 24, 39, .95);
      color: #f8fafc;
      font: 13px/1.5 -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
      box-shadow: 0 10px 32px rgba(0, 0, 0, .35);
      pointer-events: auto;
      z-index: 2;
    }
    .hxpt-overlay[hidden] { display: none !important; }
    .hxpt-overlay .hxpt-text {
      flex: 0 1 auto;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-variant-numeric: tabular-nums;
    }
    .hxpt-overlay button {
      flex: none;
      border: 1px solid rgba(248, 250, 252, .3);
      background: transparent;
      color: inherit;
      border-radius: 9px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
    }
    .hxpt-overlay button:hover { background: rgba(248, 250, 252, .12); }

    .hxpt-toast {
      position: fixed;
      left: 50%;
      bottom: 88px;
      transform: translateX(-50%);
      max-width: min(580px, 92vw);
      padding: 9px 14px;
      border-radius: 10px;
      background: rgba(17, 24, 39, .95);
      color: #f8fafc;
      font: 13px/1.5 -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
      box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
      pointer-events: none;
      opacity: 0;
      transition: opacity .18s ease;
      z-index: 3;
    }
    .hxpt-toast[hidden] { display: none !important; }
    .hxpt-toast.show { opacity: 1; }
    .hxpt-toast.ok { background: rgba(6, 78, 59, .96); }
    .hxpt-toast.err { background: rgba(127, 29, 29, .96); }
    .hxpt-toast.muted { background: rgba(51, 65, 85, .96); }
  `;

  const FAB_ICON_SVG = `
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#ffffff"
         stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 4.2h8a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5.2a1 1 0 0 1 1-1z"/>
      <path d="M9.6 3.3h4.8a.6.6 0 0 1 .6.6v1.3H9v-1.3a.6.6 0 0 1 .6-.6z" fill="#ffffff" stroke="none"/>
      <path d="M9.7 9.2h4.6M9.7 12h3.1"/>
    </svg>
  `;

  /** 创建（或复用）Shadow DOM 宿主，并缓存各个 UI 元素引用 */
  function buildUi() {
    if (!isTopFrame()) return;
    if (ui.host) {
      // 页面可能把宿主节点删掉了（SPA 重渲染），重新挂回去即可
      if (!ui.host.isConnected) {
        try { (document.body || document.documentElement).appendChild(ui.host); } catch (e) { /* 忽略 */ }
      }
      return;
    }
    const host = document.createElement('div');
    host.id = '__hxpt_host__';
    // pointer-events: none 让这一层不挡页面操作，只有里面的按钮自己可点
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'left: 0',
      'top: 0',
      'right: 0',
      'bottom: 0',
      'z-index: 2147483647',
      'pointer-events: none'
    ].join(';') + ';';

    let shadow;
    try { shadow = host.attachShadow({ mode: 'open' }); } catch (e) { return; }

    // 样式优先用 adoptedStyleSheets（不受页面 CSP 限制），失败时退回 <style>
    let styled = false;
    try {
      if (typeof CSSStyleSheet === 'function') {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(UI_CSS);
        shadow.adoptedStyleSheets = [sheet];
        styled = true;
      }
    } catch (e) { styled = false; }
    if (!styled) {
      const style = document.createElement('style');
      style.textContent = UI_CSS;
      shadow.appendChild(style);
    }

    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'hxpt-fab';
    fab.title = '超星粘贴助手：点击后等待几秒，把剪贴板内容以键盘输入方式写入光标处（可拖动）';
    fab.setAttribute('aria-label', '超星粘贴助手');
    fab.innerHTML = FAB_ICON_SVG;
    fab.hidden = true;

    const overlay = document.createElement('div');
    overlay.className = 'hxpt-overlay';
    overlay.hidden = true;
    const overlayText = document.createElement('span');
    overlayText.className = 'hxpt-text';
    const overlayBtn = document.createElement('button');
    overlayBtn.type = 'button';
    overlayBtn.textContent = '取消 (Esc)';
    overlay.appendChild(overlayText);
    overlay.appendChild(overlayBtn);

    const toastEl = document.createElement('div');
    toastEl.className = 'hxpt-toast';
    toastEl.hidden = true;

    shadow.appendChild(fab);
    shadow.appendChild(overlay);
    shadow.appendChild(toastEl);
    try { (document.body || document.documentElement).appendChild(host); } catch (e) { return; }

    ui.host = host;
    ui.shadow = shadow;
    ui.fab = fab;
    ui.overlay = overlay;
    ui.overlayText = overlayText;
    ui.overlayBtn = overlayBtn;
    ui.toast = toastEl;

    overlayBtn.addEventListener('click', () => requestCancel());
    bindFabEvents();
    // 恢复上次拖动的按钮位置
    restoreFabPosition();
    updateFabVisibility();
    watchHostAttached();
  }

  function bindFabEvents() {
    const fab = ui.fab;
    if (!fab) return;

    // 关键：阻止 mousedown 默认行为，避免点按钮时把输入框的焦点和光标抢走
    fab.addEventListener('mousedown', (event) => { event.preventDefault(); });

    fab.addEventListener('pointerdown', (event) => {
      if (typeof event.button === 'number' && event.button !== 0) return;
      const rect = fab.getBoundingClientRect();
      state.fabDrag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: rect.left,
        originY: rect.top,
        moved: false
      };
      try { fab.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
    });

    fab.addEventListener('pointermove', (event) => {
      const drag = state.fabDrag;
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return; // 小幅抖动不算拖动
      drag.moved = true;
      const size = 46;
      const maxX = Math.max(6, window.innerWidth - size - 6);
      const maxY = Math.max(6, window.innerHeight - size - 6);
      applyFabPosition({
        x: Math.min(maxX, Math.max(6, drag.originX + dx)),
        y: Math.min(maxY, Math.max(6, drag.originY + dy))
      });
    });

    const finishDrag = (event) => {
      const drag = state.fabDrag;
      if (!drag) return;
      if (typeof event.pointerId === 'number' && event.pointerId !== drag.id) return;
      state.fabDrag = null;
      try { fab.releasePointerCapture(drag.id); } catch (e) { /* 忽略 */ }
      if (!drag.moved) { activateFab(); return; } // 没拖动 → 视为点击激活
      const rect = fab.getBoundingClientRect();
      try {
        chrome.storage.local.set({ fabPos: { x: Math.round(rect.left), y: Math.round(rect.top) } });
      } catch (e) { /* 忽略 */ }
    };

    fab.addEventListener('pointerup', finishDrag);
    fab.addEventListener('pointercancel', () => { state.fabDrag = null; });
  }

  function applyFabPosition(pos) {
    if (!ui.fab || !pos) return;
    const x = Math.round(Number(pos.x));
    const y = Math.round(Number(pos.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    ui.fab.style.left = x + 'px';
    ui.fab.style.top = y + 'px';
    ui.fab.style.right = 'auto';
    ui.fab.style.bottom = 'auto';
  }

  function restoreFabPosition() {
    try {
      chrome.storage.local.get({ fabPos: null }, (got) => {
        if (got && got.fabPos) applyFabPosition(got.fabPos);
      });
    } catch (e) { /* 忽略 */ }
  }

  /** 页面把我们的宿主节点删掉时自动挂回（SPA 页面常见） */
  function watchHostAttached() {
    if (!isTopFrame() || !ui.host) return;
    try {
      const observer = new MutationObserver(() => {
        if (ui.host && !ui.host.isConnected) {
          try { (document.body || document.documentElement).appendChild(ui.host); } catch (e) { /* 忽略 */ }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* 忽略 */ }
  }

  function updateFabVisibility() {
    if (!ui.fab) return;
    ui.fab.hidden = !state.settings.showFab;
  }

  function setBusyUi(busy) {
    if (!ui.fab) return;
    ui.fab.classList.toggle('busy', !!busy);
  }

  /** 轻提示：显示 3.2 秒后自动消失 */
  function toast(text, kind) {
    if (!isTopFrame()) return;
    if (!ui.toast) buildUi();
    if (!ui.toast) return;
    const el = ui.toast;
    el.textContent = String(text || '');
    el.className = 'hxpt-toast show' + (kind ? ' ' + kind : '');
    el.hidden = false;
    if (ui.toastTimer) clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => {
      el.className = 'hxpt-toast';
      ui.toastTimer = null;
    }, 3200);
  }

  /** 显示倒计时状态条（顶层框架调用） */
  function showCountdown(startAt, charCount) {
    if (!isTopFrame()) return;
    if (!ui.overlay) buildUi();
    if (!ui.overlay) return;
    ui.overlayActive = true;
    ui.overlayStartAt = Number(startAt) || Date.now();
    ui.overlayChars = Number(charCount) || 0;
    ui.overlay.hidden = false;
    ui.overlayBtn.textContent = '取消 (Esc)';
    updateCountdownText();
    if (ui.overlayTimer) clearInterval(ui.overlayTimer);
    ui.overlayTimer = setInterval(updateCountdownText, 100);
    setBusyUi(true);
  }

  function updateCountdownText() {
    if (!ui.overlayActive || !ui.overlayText) return;
    const remain = Math.max(0, ui.overlayStartAt - Date.now());
    if (remain > 0) {
      const sec = Math.ceil(remain / 100) / 10; // 保留 1 位小数
      ui.overlayText.textContent = '将在 ' + sec + ' 秒后输入 ' + ui.overlayChars +
        ' 字，请把光标放到目标输入框';
    } else {
      ui.overlayText.textContent = '正在输入 ' + ui.overlayChars + ' 字…';
      ui.overlayBtn.textContent = '中止 (Esc)';
    }
  }

  /** 倒计时结束、开始输入时调用 */
  function showTypingPhase() {
    if (!isTopFrame() || !ui.overlayActive) return;
    if (ui.overlayText) ui.overlayText.textContent = '正在输入 ' + ui.overlayChars + ' 字…';
    if (ui.overlayBtn) ui.overlayBtn.textContent = '中止 (Esc)';
  }

  /** 更新输入进度（由后台转发的 CDP 进度驱动） */
  function setProgress(done, total) {
    if (!isTopFrame() || !ui.overlayActive || !ui.overlayText) return;
    const d = Number(done) || 0;
    const t = Number(total) || ui.overlayChars || 0;
    ui.overlayText.textContent = '正在输入 ' + d + '/' + t + '…';
  }

  function hideOverlay() {
    ui.overlayActive = false;
    if (ui.overlayTimer) { clearInterval(ui.overlayTimer); ui.overlayTimer = null; }
    if (ui.overlay) ui.overlay.hidden = true;
    setBusyUi(false);
  }

  /* ------------------------------------------------------------------
   * 3. 输入执行：DOM 兼容模式 / 后台 CDP 真实键盘模式
   * ------------------------------------------------------------------ */

  /**
   * 让元素获得焦点；如果它此前记录过光标位置且当前焦点本来不在它身上，
   * 则顺带恢复光标位置（用户点了弹窗/按钮后回到输入框的场景）。
   */
  function focusTarget(el) {
    const alreadyFocused = deepActiveElement() === el;
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* 忽略 */ } }
    if (!alreadyFocused && state.lastEl === el) restoreCaret(el, state.lastCaret);
  }

  /** 用 DOM 方式插入文本，返回插入的字符数 */
  function insertTextViaDOM(el, text) {
    if (!el || !isEditable(el)) return 0;
    const normalized = CFG.normalizeNewlines(text);
    if (!normalized) return 0;
    focusTarget(el);

    // 首选：execCommand('insertText') —— 原生插入、会触发 input 事件，
    // 能兼容绝大多数 textarea / contenteditable 编辑器（也绕开 paste 事件拦截）。
    let ok = false;
    try { ok = document.execCommand('insertText', false, normalized); } catch (e) { ok = false; }
    if (ok) return normalized.length;

    // 后备 1：直接改写 input/textarea 的 value（并用原生 setter 绕过 React 等框架的追踪）
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      insertIntoTextControl(el, normalized);
      return normalized.length;
    }
    // 后备 2：contenteditable 用 Range 直接插入文本节点
    if (el.isContentEditable) {
      insertIntoEditable(el, normalized);
      return normalized.length;
    }
    return 0;
  }

  function insertIntoTextControl(el, text) {
    try {
      const isTextarea = el.tagName === 'TEXTAREA';
      const proto = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
      const nextValue = el.value.slice(0, start) + text + el.value.slice(end);
      // 用原型上的 setter 写值：React/Vue 对实例上的 value 做过“追踪”，走原型能确保
      // 之后的 input 事件被框架正确识别（同类思路见 React 受控组件的手动派发事件方案）。
      if (desc && desc.set) desc.set.call(el, nextValue);
      else el.value = nextValue;
      const pos = start + text.length;
      try { el.setSelectionRange(pos, pos); } catch (e) { /* 忽略 */ }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText', data: text }));
    } catch (e) { /* 忽略 */ }
  }

  function insertIntoEditable(el, text) {
    try {
      const selection = window.getSelection();
      if (!selection) return;
      let range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (!range || !el.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText', data: text }));
    } catch (e) { /* 忽略 */ }
  }

  /* ------------------------------------------------------------------
   * 4. 一次注入任务的完整生命周期
   * ------------------------------------------------------------------ */

  function resolveMode(requested, trustedGranted) {
    const mode = CFG.MODES.indexOf(requested) >= 0 ? requested : 'auto';
    if (mode === 'dom') return 'dom';
    if (mode === 'trusted') return trustedGranted ? 'trusted' : 'need-grant';
    return trustedGranted ? 'trusted' : 'dom';
  }

  function typingTimeout(run) {
    const perChar = Math.max(0, run.intervalMs) + 6;
    return Math.min(15 * 60 * 1000, Math.max(20000, run.text.length * perChar + 30000));
  }

  /** 收到后台的 'hxpt:go'：启动倒计时 → 到点执行输入（只有被选中的框架会收到） */
  function beginRun(msg) {
    if (state.activeRun) {
      // 理论上不会发生（后台保证同一标签页只有一个任务），兜底释放占用
      sendBg({ cmd: 'hxpt:result', ok: false, message: '上一次输入尚未结束', chars: 0, aborted: false });
      return;
    }
    if (isTopFrame()) buildUi();

    const delay = Number(msg.delayMs);
    const startAt = Number(msg.startAt) || (Date.now() + (Number.isFinite(delay) ? delay : 0));
    const text = CFG.normalizeNewlines(msg.text || '');
    if (!text) {
      sendBg({ cmd: 'hxpt:result', ok: false, message: '没有可输入的文本', chars: 0, aborted: false });
      return;
    }
    const run = {
      token: 'r' + Date.now(),
      text: text,
      startAt: startAt,
      mode: msg.mode || 'auto',
      intervalMs: Number(msg.intervalMs) || 0,
      iframeOnly: Boolean(msg.iframeOnly),
      cancelled: false,
      cdpActive: false,
      timer: null
    };
    state.activeRun = run;

    if (isTopFrame()) showCountdown(startAt, text.length);
    setBusyUi(true);

    const wait = Math.max(0, startAt - Date.now());
    run.timer = setTimeout(() => {
      if (run.cancelled) return;
      if (isTopFrame()) showTypingPhase();
      executeTyping(run);
    }, wait);
  }

  async function executeTyping(run) {
    if (state.activeRun !== run || run.cancelled) return;
    try {
      const caps = await sendBg({ cmd: 'hxpt:capabilities' });
      const trustedGranted = Boolean(caps && caps.ok && caps.trusted);
      const mode = resolveMode(run.mode, trustedGranted);

      if (mode === 'need-grant') {
        finish(run, {
          ok: false,
          message: '未获得“调试”权限，无法使用真实键盘模拟。请到扩展设置页完成授权，或把输入方式改为“自动/兼容输入”。'
        });
        return;
      }
      if (run.iframeOnly && mode !== 'trusted') {
        finish(run, {
          ok: false,
          message: '目标输入框位于跨域框架内，兼容输入无法写入。请在设置中启用“真实键盘模拟”（会请求调试权限）。'
        });
        return;
      }

      // 再次确认光标位置（用户可能已在倒计时期间改动）
      const active = deepActiveElement();
      const frameFocus = isFrameElement(active);
      let target = null;
      if (isEditable(active) && isVisible(active)) {
        target = active;
      } else if (!(mode === 'trusted' && frameFocus) && state.lastEl && isEditable(state.lastEl) && isVisible(state.lastEl)) {
        target = state.lastEl;
      }

      const trustedCanType = mode === 'trusted' && (target !== null || frameFocus || run.iframeOnly);
      if (!trustedCanType && !target) {
        finish(run, { ok: false, message: '光标已经不在输入框里，本次输入已取消。' });
        return;
      }
      if (run.cancelled) return;

      if (mode === 'trusted') {
        // 真实键盘事件会打到“当前焦点”上，因此先把焦点放回目标元素
        // （例如用户刚才点过扩展按钮、焦点短暂离开输入框的场景）。
        if (target && deepActiveElement() !== target) focusTarget(target);
        run.cdpActive = true;
        const guard = startFocusGuard(run);
        let res;
        try {
          res = await sendBg(
            { cmd: 'hxpt:trusted-type', text: run.text, intervalMs: run.intervalMs },
            typingTimeout(run)
          );
        } finally {
          stopFocusGuard(guard);
          run.cdpActive = false;
        }
        if (state.activeRun !== run) return; // 已被取消
        if (!res || !res.ok) {
          finish(run, {
            ok: false,
            message: (res && res.error) || '真实键盘输入失败',
            chars: (res && res.chars) || 0,
            aborted: Boolean(res && res.aborted)
          });
          return;
        }
        finish(run, {
          ok: true,
          message: '已输入 ' + (res.chars || run.text.length) + ' 个字符',
          chars: res.chars || run.text.length
        });
        return;
      }

      // DOM 兼容模式：只可能在本框架内执行
      if (!target) {
        finish(run, { ok: false, message: '光标已经不在输入框里，本次输入已取消。' });
        return;
      }
      const chars = insertTextViaDOM(target, run.text);
      finish(run, { ok: true, message: '已通过兼容模式输入 ' + chars + ' 个字符', chars: chars });
    } catch (err) {
      finish(run, { ok: false, message: '输入过程中出错：' + ((err && err.message) || err) });
    }
  }

  /**
   * 真实键盘输入期间进行焦点守护：
   * 如果用户把焦点切到了非输入元素（例如页面搜索框、链接），立即中止，
   * 避免把剪贴板内容打到错误的地方。
   */
  function startFocusGuard(run) {
    const timer = setInterval(() => {
      if (state.activeRun !== run || run.cancelled) return;
      const active = deepActiveElement();
      if (isEditable(active) || isFrameElement(active)) return;
      if (active === null || active === document.body) return; // 窗口暂时失焦等情况不判为异常
      // 焦点落到了无关元素上：主动中止
      if (state.activeRun === run) {
        sendBg({ cmd: 'hxpt:abort', reason: 'focus-lost' });
      }
    }, 250);
    return timer;
  }

  function stopFocusGuard(timer) {
    if (timer) clearInterval(timer);
  }

  /** 任务收尾：释放占用、更新 UI、通知后台释放“标签页占用” */
  function finish(run, info) {
    if (state.activeRun !== run) {
      if (isTopFrame() && ui.overlayActive) hideOverlay();
      return;
    }
    state.activeRun = null;
    if (run.timer) { clearTimeout(run.timer); run.timer = null; }
    if (isTopFrame()) {
      hideOverlay();
      const message = info && info.message;
      if (message) toast(message, info.ok ? 'ok' : (info.aborted ? 'muted' : 'err'));
    }
    setBusyUi(false);
    sendBg({
      cmd: 'hxpt:result',
      ok: Boolean(info && info.ok),
      message: (info && info.message) || '',
      chars: (info && info.chars) || 0,
      aborted: Boolean(info && info.aborted)
    });
  }

  /** 本地取消（Esc / 点“取消”按钮 / 后台下发的中止指令） */
  function cancelActiveRun(reason) {
    const run = state.activeRun;
    if (!run) return;
    run.cancelled = true;
    state.activeRun = null;
    if (run.timer) { clearTimeout(run.timer); run.timer = null; }
    if (isTopFrame()) {
      hideOverlay();
      toast('已取消本次输入', 'muted');
    }
    setBusyUi(false);
    if (reason !== 'remote') sendBg({ cmd: 'hxpt:abort', reason: reason || 'user' });
  }

  /** 顶层框架里点击“取消/中止”按钮时的统一入口 */
  function requestCancel() {
    if (state.activeRun) { cancelActiveRun('user'); return; }
    hideOverlay();
    toast('已取消本次输入', 'muted');
    sendBg({ cmd: 'hxpt:abort', reason: 'user' });
  }

  /** Esc 键：倒计时或输入中可用 */
  function onGlobalKeyDown(event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    const overlayVisible = isTopFrame() && ui.overlayActive;
    if (!state.activeRun && !overlayVisible) return;
    event.preventDefault();
    event.stopPropagation();
    requestCancel();
  }

  /* ------------------------------------------------------------------
   * 5. 悬浮按钮激活：优先直接读剪贴板（点击属于用户手势），失败再让后台读
   * ------------------------------------------------------------------ */

  async function readClipboardLocal() {
    try {
      if (!navigator.clipboard) return { ok: false, error: 'no-clipboard-api' };
      let text = '';
      if (typeof navigator.clipboard.read === 'function') {
        try {
          const items = await navigator.clipboard.read();
          text = await CFG.readClipboardTextFromItems(items);
        } catch (e) { /* read() 被拒绝时退回 readText() */ }
      }
      if (!text) {
        try { text = await navigator.clipboard.readText(); } catch (e) { /* 读取失败 */ }
      }
      return { ok: true, text: CFG.normalizeNewlines(text || '') };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  async function activateFab() {
    if (state.activeRun) {
      toast('上一次输入还没结束，请稍候或按 Esc 取消。', 'muted');
      return;
    }
    if (!isTopFrame()) return;
    setBusyUi(true);
    toast('正在读取剪贴板…');

    const payload = { cmd: 'hxpt:start', source: 'fab' };
    try {
      const local = await readClipboardLocal();
      if (local && local.ok) {
        if (!local.text) {
          setBusyUi(false);
          toast('剪贴板里没有可输入的文本（图片或文件暂不支持）。', 'err');
          return;
        }
        payload.text = local.text;
      }
    } catch (e) { /* 本地读取失败就让后台去读 */ }

    const res = await sendBg(payload);
    if (!res || !res.ok) {
      setBusyUi(false);
      toast((res && res.error) || '启动失败，请稍后重试。', 'err');
    }
    // 成功时：倒计时 UI 由本框架（如果本框架执行）或后台消息驱动
  }

  /* ------------------------------------------------------------------
   * 6. 与后台的消息路由
   * ------------------------------------------------------------------ */

  /** 收到后台广播的“寻找可用框架”：报告本框架是否有光标/可编辑元素 */
  function handleArm() {
    const active = deepActiveElement();
    const info = { focused: false, iframe: false, recent: false };
    if (isEditable(active) && isVisible(active)) {
      info.focused = true;
    } else if (isFrameElement(active)) {
      info.iframe = true; // 焦点在本框架内嵌的 iframe 里（可能是没有注入脚本的跨域编辑器）
    } else if (state.lastEl && isEditable(state.lastEl) && isVisible(state.lastEl)) {
      info.recent = true;
    } else {
      return; // 什么也没有，不参与竞争
    }
    sendBg({
      cmd: 'hxpt:candidate',
      focused: info.focused,
      iframe: info.iframe,
      recent: info.recent
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    const cmd = msg.cmd;
    if (typeof cmd !== 'string' || cmd.indexOf('hxpt:') !== 0) return;

    switch (cmd) {
      case 'hxpt:ping':
        sendResponse({ ok: true, top: isTopFrame() });
        return false;
      case 'hxpt:arm':
        handleArm();
        return false;
      case 'hxpt:go':
        beginRun(msg);
        return false;
      case 'hxpt:countdown':
        // 由别的框架执行输入时，顶层框架负责显示倒计时
        if (isTopFrame()) {
          buildUi();
          showCountdown(Number(msg.startAt) || Date.now(), Number(msg.charCount) || 0);
        }
        return false;
      case 'hxpt:progress':
        setProgress(msg.done, msg.total);
        return false;
      case 'hxpt:result':
        if (isTopFrame()) {
          hideOverlay();
          if (msg.message) toast(msg.message, msg.ok ? 'ok' : (msg.aborted ? 'muted' : 'err'));
        }
        return false;
      case 'hxpt:notice':
        if (isTopFrame()) {
          buildUi();
          toast(msg.text || '', 'err');
        }
        return false;
      case 'hxpt:abort':
        // 后台要求中止（用户点了取消按钮 / 其他框架发起取消）
        cancelActiveRun('remote');
        return false;
      case 'hxpt:aborted':
        if (isTopFrame()) {
          const wasVisible = ui.overlayActive;
          hideOverlay();
          if (wasVisible) toast('已取消本次输入', 'muted');
        }
        return false;
      default:
        return false;
    }
  });

  /* ------------------------------------------------------------------
   * 7. 初始化
   * ------------------------------------------------------------------ */
  async function init() {
    try {
      state.settings = await CFG.loadSettings();
    } catch (e) { /* 使用默认值 */ }

    if (isTopFrame()) {
      buildUi();
      updateFabVisibility();
    }

    document.addEventListener('keydown', onGlobalKeyDown, true);

    // 设置变化（比如在弹窗里切换了“悬浮按钮”）实时生效
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync' || !changes) return;
        if (changes.showFab) {
          state.settings.showFab = Boolean(changes.showFab.newValue);
          updateFabVisibility();
        }
        if (changes.delayMs || changes.mode || changes.intervalMs) {
          CFG.loadSettings().then((s) => { state.settings = s; }).catch(() => {});
        }
      });
    } catch (e) { /* 忽略 */ }
  }

  init();
})();
