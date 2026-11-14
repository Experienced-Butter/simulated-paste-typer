/**
 * 模拟录入粘贴助手 · 工具栏弹窗逻辑
 * ==================================================================
 * 弹窗提供：
 *   - 当前页面是否受支持的状态提示；
 *   - 等待时间 / 输入方式 的快捷设置（与设置页、后台共享 chrome.storage）；
 *   - “读取剪贴板并输入到光标处”主按钮；
 *   - 调试权限（可选）的快速授权入口；
 *   - 剪贴板内容预览，方便确认“最后一条内容”是否正确。
 *
 * 注意：点击主按钮时剪贴板读取优先在弹窗内完成（点击属于用户手势，
 * 读取成功率最高），失败后再交给后台的离屏文档去读。
 */
'use strict';

(function () {
  const CFG = window.SPT_CONFIG;
  const T = (k, s) => (window.SPT_I18N ? window.SPT_I18N.t(k, s) : k);
  const $ = (id) => document.getElementById(id);

  const SUPPORTED_URL = /^(https?|file):\/\//i;
  const PREVIEW_LIMIT = 320;

  let activeTab = null;
  let supported = false;
  let contentReady = false;
  let busy = false;

  /* ---------------- 基础工具 ---------------- */

  /** 向后台发消息（统一 resolve，不抛异常） */
  function sendBg(payload, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: T('bTimeout') });
      }, typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 20000);
      try {
        chrome.runtime.sendMessage(payload, (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const lastError = chrome.runtime.lastError;
          if (lastError) { resolve({ ok: false, error: lastError.message || T('bNoResp') }); return; }
          resolve(resp || { ok: false, error: T('bEmpty') });
        });
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: String((e && e.message) || e) });
      }
    });
  }

  /** 在弹窗这个扩展页面里读取剪贴板（有 clipboardRead 权限 + 用户手势） */
  async function readClipboardLocal() {
    try {
      let text = '';
      if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
        try {
          const items = await navigator.clipboard.read();
          text = await CFG.readClipboardTextFromItems(items);
        } catch (e) { /* read() 被拒绝时退回 readText() */ }
      }
      if (!text && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        try { text = await navigator.clipboard.readText(); } catch (e) { /* 忽略 */ }
      }
      return { ok: true, text: CFG.normalizeNewlines(text || '') };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  function formatDelay(ms) {
    const value = Number(ms) || 0;
    const n = value % 1000 !== 0 ? (value / 1000).toFixed(1) : String(value / 1000);
    return T('pDelayValue', { n: n });
  }

  function modeLabel(mode) {
    const map = { auto: 'pModeAuto', trusted: 'pModeTrusted', dom: 'pModeDom' };
    return T(map[mode] || 'pModeAuto');
  }

  function setFeedback(text, kind) {
    const el = $('feedback');
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.className = 'feedback' + (kind ? ' ' + kind : '');
    el.textContent = text;
  }

  function setPreview(text) {
    const el = $('clipPreview');
    if (!el) return;
    if (!text) {
      el.textContent = T('pPreviewEmpty');
      return;
    }
    const flat = String(text);
    const preview = flat.length > PREVIEW_LIMIT ? flat.slice(0, PREVIEW_LIMIT) + ' …' : flat;
    el.textContent = preview + T('pPreviewChars', { n: flat.length });
  }

  function setBusyState(value, label) {
    busy = Boolean(value);
    const btn = $('injectBtn');
    if (!btn) return;
    btn.disabled = busy || !supported || !contentReady;
    btn.textContent = busy ? (label || T('pProcessing')) : T('pInject');
  }

  /* ---------------- 初始化 ---------------- */

  async function init() {
    const manifest = chrome.runtime.getManifest();
    document.title = T('pTitle');
    if (window.SPT_I18N) window.SPT_I18N.apply(document);
    $('versionLabel').textContent = 'v' + manifest.version;

    // 1) 当前标签页
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = (tabs && tabs[0]) || null;
    } catch (e) {
      activeTab = null;
    }
    supported = Boolean(activeTab && SUPPORTED_URL.test(activeTab.url || ''));

    // 探测页面里的内容脚本是否就绪：没就绪通常说明页面需要刷新，
    // 或者扩展刚更新过还没在 edge://extensions 里“重新加载”。
    contentReady = false;
    if (supported) {
      contentReady = await Promise.race([
        new Promise((resolve) => {
          try {
            chrome.tabs.sendMessage(activeTab.id, { cmd: 'spt:ping' }, { frameId: 0 }, (resp) => {
              void chrome.runtime.lastError;
              resolve(Boolean(resp && resp.ok));
            });
          } catch (e) { resolve(false); }
        }),
        new Promise((resolve) => setTimeout(() => resolve(false), 3000))
      ]);
    }

    const statusRow = $('statusRow');
    const statusText = $('statusText');
    if (!supported) {
      statusRow.classList.add('err');
      statusText.textContent = T('pStatusUnsupported');
    } else if (!contentReady) {
      statusRow.classList.add('err');
      statusText.textContent = T('pStatusNotReady');
    } else {
      statusRow.classList.add('ok');
      statusText.textContent = T('pStatusReady');
    }
    setBusyState(false);

    // 2) 设置
    const settings = await CFG.loadSettings();
    fillDelaySelect(settings.delayMs);
    fillModeSelect(settings.mode);
    $('fabToggle').checked = Boolean(settings.showFab);

    // 3) 权限状态
    await refreshPermission();

    // 4) 剪贴板预览（尽量在打开弹窗时就展示；没有手势时静默失败，不影响使用）
    await peekClipboard(true);

    bindEvents();
  }

  function fillDelaySelect(current) {
    const select = $('delaySelect');
    select.innerHTML = '';
    const presets = CFG.DELAY_PRESETS.slice();
    if (presets.indexOf(current) < 0) presets.push(current);
    presets.sort((a, b) => a - b);
    for (const ms of presets) {
      const option = document.createElement('option');
      option.value = String(ms);
      option.textContent = formatDelay(ms) + (CFG.DELAY_PRESETS.indexOf(ms) >= 0 ? '' : T('pCustom'));
      select.appendChild(option);
    }
    select.value = String(current);
  }

  function fillModeSelect(current) {
    const select = $('modeSelect');
    select.innerHTML = '';
    for (const mode of CFG.MODES) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = modeLabel(mode);
      select.appendChild(option);
    }
    select.value = CFG.MODES.indexOf(current) >= 0 ? current : CFG.DEFAULTS.mode;
  }

  async function refreshPermission() {
    const permText = $('permText');
    const grantBtn = $('grantBtn');
    try {
      const granted = await new Promise((resolve) => {
        chrome.permissions.contains({ permissions: ['debugger'] }, (value) => {
          void chrome.runtime.lastError;
          resolve(Boolean(value));
        });
      });
      permText.textContent = granted
        ? T('pPermGranted')
        : T('pPermNotGranted');
      grantBtn.hidden = granted;
    } catch (e) {
      permText.textContent = T('pPermUnknown');
      grantBtn.hidden = false;
    }
  }

  async function requestDebuggerPermission() {
    try {
      const granted = await new Promise((resolve) => {
        chrome.permissions.request({ permissions: ['debugger'] }, (value) => {
          void chrome.runtime.lastError;
          resolve(Boolean(value));
        });
      });
      if (granted) {
        setFeedback(T('pGrantOk'), 'ok');
      } else {
        // 弹窗里发起权限请求时，浏览器弹出确认框会让弹窗失焦/关闭，请求可能因此被取消。
        // 改为打开设置页（普通标签页）再授权，成功率更高。
        try { chrome.runtime.openOptionsPage(); } catch (e) { /* 忽略 */ }
        setFeedback(T('pGrantFail'), 'err');
      }
    } catch (e) {
      setFeedback(T('pGrantErr', { e: (e && e.message) || e }), 'err');
    }
    await refreshPermission();
  }

  /**
   * 读取并预览剪贴板。
   * @param {boolean} silent 打开弹窗时静默失败（没有用户手势时读取可能被拒绝，
   *                         此时不弹错误提示，让用户点“刷新”用点击手势重读）
   */
  async function peekClipboard(silent) {
    const preview = $('clipPreview');
    if (!preview) return;
    preview.textContent = T('rReading');

    try {
      const local = await readClipboardLocal();
      if (local && local.ok) { setPreview(local.text); return; }

      const resp = await sendBg({ cmd: 'spt:peek' });
      if (resp && resp.ok) { setPreview(resp.text); return; }
      if (!silent) {
        setPreview(T('pPreviewNotRead'));
        setFeedback(T('pPreviewFail', { e: (resp && resp.error) || (local && local.error) || T('pUnknownReason') }), 'err');
      } else {
        setPreview(T('pPreviewClickRefresh'));
      }
    } catch (e) {
      if (!silent) setFeedback('读取剪贴板失败：' + ((e && e.message) || e), 'err');
    }
  }

  /* ---------------- 主流程 ---------------- */

  async function inject() {
    if (busy) return;
    if (!supported) {
      setFeedback(T('pUnsupported'), 'err');
      return;
    }
    if (!contentReady) {
      setFeedback(T('pNotReady'), 'err');
      return;
    }
    setFeedback('');
    setBusyState(true, T('rReading'));

    try {
      const payload = { cmd: 'spt:start', tabId: activeTab.id, source: 'popup' };
      const local = await readClipboardLocal();
      if (local && local.ok) payload.text = local.text; // 优先用弹窗读到的内容

      const res = await sendBg(payload);
      if (!res || !res.ok) {
        setFeedback((res && res.error) || T('rStartFail'), 'err');
        return;
      }
      setFeedback(T('pStarted', { delay: formatDelay(res.delayMs), n: res.charCount }), 'ok');
    } finally {
      setBusyState(false);
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    $('injectBtn').addEventListener('click', inject);

    $('delaySelect').addEventListener('change', async (event) => {
      const delayMs = Number(event.target.value);
      await CFG.saveSettings({ delayMs: delayMs });
      setFeedback(T('pSavedDelay', { delay: formatDelay(delayMs) }), 'ok');
    });

    $('modeSelect').addEventListener('change', async (event) => {
      await CFG.saveSettings({ mode: event.target.value });
      setFeedback(T('pSavedMode'), 'ok');
    });

    $('grantBtn').addEventListener('click', requestDebuggerPermission);
    $('peekBtn').addEventListener('click', async () => {
      setFeedback('');
      await peekClipboard();
    });

    $('fabToggle').addEventListener('change', async (event) => {
      await CFG.saveSettings({ showFab: Boolean(event.target.checked) });
      setFeedback(event.target.checked ? T('pFabOn') : T('pFabOff'), 'ok');
    });

    $('optionsLink').addEventListener('click', (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  init().catch((err) => {
    setFeedback(T('pInitFail', { e: (err && err.message) || err }), 'err');
  });
})();
