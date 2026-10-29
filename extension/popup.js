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
  const $ = (id) => document.getElementById(id);

  const SUPPORTED_URL = /^(https?|file):\/\//i;
  const PREVIEW_LIMIT = 320;

  let activeTab = null;
  let supported = false;
  let busy = false;

  /* ---------------- 基础工具 ---------------- */

  /** 向后台发消息（统一 resolve，不抛异常） */
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
    if (value % 1000 !== 0) return (value / 1000).toFixed(1) + ' 秒';
    return (value / 1000) + ' 秒';
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
      el.textContent = '（剪贴板为空，或内容不是文本：图片/文件暂不支持）';
      return;
    }
    const flat = String(text);
    const preview = flat.length > PREVIEW_LIMIT ? flat.slice(0, PREVIEW_LIMIT) + ' …' : flat;
    el.textContent = preview + '\n\n共 ' + flat.length + ' 个字符';
  }

  function setBusyState(value, label) {
    busy = Boolean(value);
    const btn = $('injectBtn');
    if (!btn) return;
    btn.disabled = busy || !supported;
    btn.textContent = busy ? (label || '处理中…') : '读取剪贴板并输入到光标处';
  }

  /* ---------------- 初始化 ---------------- */

  async function init() {
    const manifest = chrome.runtime.getManifest();
    $('versionLabel').textContent = 'v' + manifest.version;

    // 1) 当前标签页
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = (tabs && tabs[0]) || null;
    } catch (e) {
      activeTab = null;
    }
    supported = Boolean(activeTab && SUPPORTED_URL.test(activeTab.url || ''));

    const statusRow = $('statusRow');
    const statusText = $('statusText');
    if (supported) {
      statusRow.classList.add('ok');
      statusText.textContent = '已连接受支持的页面，可以开始';
    } else {
      statusRow.classList.add('err');
      statusText.textContent = '当前页面不受支持（浏览器内部页面无法注入）';
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
      option.textContent = formatDelay(ms) + (CFG.DELAY_PRESETS.indexOf(ms) >= 0 ? '' : '（自定义）');
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
      option.textContent = CFG.MODE_LABELS[mode] || mode;
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
        ? '真实键盘模拟：已授权（推荐）'
        : '真实键盘模拟：未授权，将使用兼容输入';
      grantBtn.hidden = granted;
    } catch (e) {
      permText.textContent = '真实键盘模拟：状态未知';
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
      if (granted) setFeedback('已授权“调试”权限：之后将使用真实键盘事件输入（页面会出现黄色调试提示条，属正常现象）。', 'ok');
      else setFeedback('未获得“调试”权限，将继续使用兼容输入方式。', '');
    } catch (e) {
      setFeedback('授权失败：' + ((e && e.message) || e), 'err');
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
    preview.textContent = '正在读取剪贴板…';

    try {
      const local = await readClipboardLocal();
      if (local && local.ok) { setPreview(local.text); return; }

      const resp = await sendBg({ cmd: 'spt:peek' });
      if (resp && resp.ok) { setPreview(resp.text); return; }
      if (!silent) {
        setPreview('（未读取）');
        setFeedback('读取剪贴板失败：' + ((resp && resp.error) || (local && local.error) || '未知原因') + '。请点“刷新”重试。', 'err');
      } else {
        setPreview('（点击“刷新”读取剪贴板）');
      }
    } catch (e) {
      if (!silent) setFeedback('读取剪贴板失败：' + ((e && e.message) || e), 'err');
    }
  }

  /* ---------------- 主流程 ---------------- */

  async function inject() {
    if (busy) return;
    if (!supported) {
      setFeedback('当前页面不受支持，无法注入。请打开普通网页（http/https）或本地 HTML 文件（需允许访问文件网址）。', 'err');
      return;
    }
    setFeedback('');
    setBusyState(true, '正在读取剪贴板…');

    try {
      const payload = { cmd: 'spt:start', tabId: activeTab.id, source: 'popup' };
      const local = await readClipboardLocal();
      if (local && local.ok) payload.text = local.text; // 优先用弹窗读到的内容

      const res = await sendBg(payload);
      if (!res || !res.ok) {
        setFeedback((res && res.error) || '启动失败，请稍后重试。', 'err');
        return;
      }
      setFeedback(
        '已开始：约 ' + formatDelay(res.delayMs) + ' 后输入 ' + res.charCount +
        ' 个字符。请把光标放到目标输入框内，按 Esc 可取消。',
        'ok'
      );
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
      setFeedback('已保存：触发后等待 ' + formatDelay(delayMs) + '。', 'ok');
    });

    $('modeSelect').addEventListener('change', async (event) => {
      await CFG.saveSettings({ mode: event.target.value });
      setFeedback('已保存输入方式。', 'ok');
    });

    $('grantBtn').addEventListener('click', requestDebuggerPermission);
    $('peekBtn').addEventListener('click', async () => {
      setFeedback('');
      await peekClipboard();
    });

    $('fabToggle').addEventListener('change', async (event) => {
      await CFG.saveSettings({ showFab: Boolean(event.target.checked) });
      setFeedback(event.target.checked ? '已显示页面悬浮按钮。' : '已隐藏页面悬浮按钮。', 'ok');
    });

    $('optionsLink').addEventListener('click', (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  init().catch((err) => {
    setFeedback('弹窗初始化失败：' + ((err && err.message) || err), 'err');
  });
})();
