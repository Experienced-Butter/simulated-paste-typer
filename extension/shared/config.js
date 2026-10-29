/**
 * 模拟录入粘贴助手 · 共享配置与工具
 * ------------------------------------------------------------------
 * 本文件会被以下四个环境同时加载：
 *   1. 内容脚本（content script）
 *   2. 工具栏弹窗（popup.html）
 *   3. 设置页（options.html）
 *   4. 后台 Service Worker（background.js 里通过 importScripts 加载）
 *
 * 因此这里只放“纯函数 + 设置读写 + 文本处理”，
 * 不直接操作页面 DOM，也不发起任何网络请求。
 */
;(function (g) {
  'use strict';

  /** 默认设置（首次安装时写入 chrome.storage.sync） */
  var DEFAULTS = {
    delayMs: 3000,      // 触发后等待多少毫秒再开始输入（给用户移动光标的时间）
    mode: 'auto',       // auto | trusted | dom，输入方式
    intervalMs: 5,      // 逐字符输入时，字符之间的间隔（毫秒）
    showFab: true       // 是否在页面上显示悬浮按钮
  };

  /** 数值范围限制，防止用户输入离谱的值 */
  var LIMITS = {
    delayMs: { min: 1000, max: 60000 },
    intervalMs: { min: 0, max: 200 }
  };

  var MODES = ['auto', 'trusted', 'dom'];

  var MODE_LABELS = {
    auto: '自动（优先真实键盘模拟）',
    trusted: '真实键盘模拟（需调试权限）',
    dom: '兼容输入（DOM 插入，无需额外权限）'
  };

  /** 给下拉框用的等待时间预设（毫秒） */
  var DELAY_PRESETS = [1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000, 30000];

  /**
   * 把任意输入夹到 [min, max] 之间的整数。
   * 解析失败时返回 fallback。
   */
  function clampInt(value, min, max, fallback) {
    var n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  /** 把任意设置对象整理成“合法”的设置对象（缺项补默认值、越界夹紧） */
  function normalize(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    return {
      delayMs: clampInt(src.delayMs, LIMITS.delayMs.min, LIMITS.delayMs.max, DEFAULTS.delayMs),
      mode: MODES.indexOf(src.mode) >= 0 ? src.mode : DEFAULTS.mode,
      intervalMs: clampInt(src.intervalMs, LIMITS.intervalMs.min, LIMITS.intervalMs.max, DEFAULTS.intervalMs),
      showFab: src.showFab === undefined ? DEFAULTS.showFab : Boolean(src.showFab)
    };
  }

  /** 读取设置（失败时退回默认值，保证 UI 永远可用） */
  async function loadSettings() {
    try {
      var got = await chrome.storage.sync.get(DEFAULTS);
      return normalize(got);
    } catch (e) {
      return normalize(DEFAULTS);
    }
  }

  /** 合并写入设置，返回写后的完整设置 */
  async function saveSettings(patch) {
    var current = await loadSettings();
    var next = normalize(Object.assign({}, current, patch));
    try {
      await chrome.storage.sync.set(next);
    } catch (e) {
      /* 同步存储不可用时静默失败，调用方仍拿到内存里的值 */
    }
    return next;
  }

  /** 统一换行符：\r\n、\r 都转成 \n，避免输入时出现额外空行 */
  function normalizeNewlines(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  }

  /**
   * 把 HTML 片段转换为纯文本：保留段落/换行结构，去掉标签。
   * 场景：剪贴板里只有 text/html（例如从网页复制了富文本）时使用。
   */
  function htmlToText(html) {
    if (!html) return '';
    var doc;
    try {
      doc = new DOMParser().parseFromString(String(html), 'text/html');
    } catch (e) {
      // 极端情况下退化为正则去标签
      return String(html).replace(/<[^>]*>/g, '');
    }
    if (!doc || !doc.body) return '';

    // 视为“块级、需要前后换行”的元素
    var blocks = {
      P: 1, DIV: 1, LI: 1, TR: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
      BLOCKQUOTE: 1, PRE: 1, UL: 1, OL: 1, TABLE: 1, SECTION: 1, ARTICLE: 1,
      HEADER: 1, FOOTER: 1, TD: 1, TH: 1
    };
    var out = [];

    function pushNewline() {
      if (out.length && out[out.length - 1] !== '\n') out.push('\n');
    }

    function walk(node) {
      if (node.nodeType === 3) { // 文本节点
        out.push(node.nodeValue || '');
        return;
      }
      if (node.nodeType !== 1) return; // 只处理元素节点
      var tag = node.tagName;
      if (tag === 'BR') { out.push('\n'); return; }
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      var isBlock = !!blocks[tag];
      if (isBlock) pushNewline();
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
      if (isBlock) pushNewline();
    }

    walk(doc.body);
    var text = out.join('');
    // 清理空白：行尾空格、多余空行
    text = text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  /**
   * 从 ClipboardItem 数组中取出文本内容。
   * 优先 text/plain（最接近用户复制的原文），否则把 text/html 转成纯文本。
   * 返回值：字符串；若剪贴板里只有图片/文件，则返回 ''。
   */
  async function readClipboardTextFromItems(items) {
    if (!items || !items.length) return '';
    // 第一遍：优先第一项里的纯文本（大多数场景）
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var types = (item && item.types) || [];
      if (types.indexOf('text/plain') >= 0) {
        try {
          var plainBlob = await item.getType('text/plain');
          var plainText = await plainBlob.text();
          if (plainText) return plainText;
        } catch (e) { /* 继续尝试 */ }
      }
    }
    // 第二遍：退而求其次，HTML 转纯文本
    for (var j = 0; j < items.length; j++) {
      var item2 = items[j];
      var types2 = (item2 && item2.types) || [];
      if (types2.indexOf('text/html') >= 0) {
        try {
          var htmlBlob = await item2.getType('text/html');
          var html = await htmlBlob.text();
          var converted = htmlToText(html);
          if (converted) return converted;
        } catch (e2) { /* 继续尝试 */ }
      }
    }
    return '';
  }

  g.SPT_CONFIG = {
    DEFAULTS: DEFAULTS,
    LIMITS: LIMITS,
    MODES: MODES,
    MODE_LABELS: MODE_LABELS,
    DELAY_PRESETS: DELAY_PRESETS,
    clampInt: clampInt,
    normalize: normalize,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    normalizeNewlines: normalizeNewlines,
    htmlToText: htmlToText,
    readClipboardTextFromItems: readClipboardTextFromItems
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
