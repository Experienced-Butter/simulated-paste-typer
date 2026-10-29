/**
 * 超星粘贴助手 · 后台 Service Worker
 * ==================================================================
 * 职责：
 *  1) 读取剪贴板：MV3 的 Service Worker 没有 DOM，因此使用 chrome.offscreen
 *     创建一个离屏文档来调用 navigator.clipboard（权限来自 "clipboardRead"）；
 *  2) 协调一次注入：
 *       广播寻找可用框架 → 收集各框架的“候选”（有光标/有最近编辑位置）
 *       → 选出最合适的一个 → 下发 'hxpt:go' → 记录标签页占用 → 收尾时释放；
 *  3) 真实键盘模拟：chrome.debugger + CDP 的 Input.dispatchKeyEvent 派发
 *     “受信任（isTrusted）的键盘事件”，逐字符输入，并支持中断；
 *  4) 工具栏按钮、快捷键（Ctrl+Shift+Y）触发的统一入口。
 *
 * 权限说明：
 *  - clipboardRead / storage / offscreen 是常规权限；
 *  - debugger 是“可选权限”，只在用户主动授权后才会用于真实键盘模拟。
 *
 * 本文件不发送任何网络请求，也不收集任何数据。
 */
'use strict';

importScripts('shared/config.js');

const CFG = self.HXPT_CONFIG || globalThis.HXPT_CONFIG;

/* ==================================================================
 * 0. 全局状态
 * ================================================================== */

/** tabId -> { frameId, expiresAt }：记录某个标签页当前由哪个框架执行输入 */
const claims = new Map();

/** 正在进行“启动流程”（读剪贴板、挑框架）的标签页，防止连点导致并发 */
const startingTabs = new Set();

/** String(tabId) -> { abort: boolean }：正在进行的 CDP 输入会话 */
const typingSessions = new Map();

/** tabId -> { items: [], }：等待各框架上报候选 */
const candidateBuckets = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 只处理 *.chaoxing.com 页面（内容脚本的匹配范围与之一致） */
const SUPPORTED_URL = /^https:\/\/([^/]+\.)?chaoxing\.com\//i;

/* ==================================================================
 * 1. 基础 API 封装（统一用回调写法，兼容性最好）
 * ================================================================== */

function hasPermission(name) {
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains({ permissions: [name] }, (granted) => {
        void chrome.runtime.lastError;
        resolve(Boolean(granted));
      });
    } catch (e) { resolve(false); }
  });
}

/** 向某个框架发送消息（忽略失败：比如页面已卸载） */
function sendToFrame(tabId, frameId, payload) {
  try {
    const result = chrome.tabs.sendMessage(tabId, payload, { frameId: frameId });
    if (result && typeof result.catch === 'function') result.catch(() => {});
    return result;
  } catch (e) { return undefined; }
}

/** 向标签页内所有框架广播（内容脚本里会按需自行过滤） */
function sendToAllFrames(tabId, payload) {
  try {
    const result = chrome.tabs.sendMessage(tabId, payload);
    if (result && typeof result.catch === 'function') result.catch(() => {});
    return result;
  } catch (e) { return undefined; }
}

/** 确认页面里内容脚本就绪（frameId 0） */
function tabPing(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { cmd: 'hxpt:ping' }, { frameId: 0 }, (resp) => {
        const lastError = chrome.runtime.lastError;
        if (lastError || !resp || !resp.ok) resolve({ ok: false });
        else resolve({ ok: true, top: Boolean(resp.top) });
      });
    } catch (e) { resolve({ ok: false }); }
  });
}

/** 检查标签页是否是受支持的超星页面 */
async function checkTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = (tab && tab.url) || '';
    if (!SUPPORTED_URL.test(url)) {
      return { ok: false, error: '当前页面不是超星页面：本扩展现仅支持 *.chaoxing.com 域名。' };
    }
    return { ok: true, tab: tab };
  } catch (e) {
    return { ok: false, error: '无法读取当前标签页信息。' };
  }
}

/* ==================================================================
 * 2. 剪贴板（离屏文档）
 * ================================================================== */

let creatingOffscreen = null;

function offscreenHasDocument() {
  return new Promise((resolve) => {
    try {
      if (!chrome.offscreen || typeof chrome.offscreen.hasDocument !== 'function') {
        resolve(false);
        return;
      }
      const maybePromise = chrome.offscreen.hasDocument();
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then((value) => resolve(Boolean(value)), () => resolve(false));
      } else {
        resolve(false);
      }
    } catch (e) { resolve(false); }
  });
}

/** 确保离屏文档存在（存在则复用） */
async function ensureOffscreenDocument() {
  try {
    if (!chrome.offscreen) return false;
    if (await offscreenHasDocument()) return true;
    if (creatingOffscreen) { await creatingOffscreen; return await offscreenHasDocument(); }
    creatingOffscreen = (async () => {
      try {
        const created = chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['CLIPBOARD'],
          justification: '读取剪贴板里的文本，仅在用户点击注入按钮或快捷键时使用，数据不会离开本机。'
        });
        if (created && typeof created.then === 'function') await created;
        return true;
      } catch (e) {
        return false; // 例如离屏文档已存在、或环境不支持
      }
    })();
    await creatingOffscreen;
    creatingOffscreen = null;
    return await offscreenHasDocument();
  } catch (e) {
    creatingOffscreen = null;
    return false;
  }
}

/** 请求离屏文档读取剪贴板（单次） */
function requestOffscreenClipboardOnce() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ target: 'hxpt-offscreen', cmd: 'read' }, (resp) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) resolve({ ok: false, error: lastError.message || 'offscreen 无响应' });
        else resolve(resp || { ok: false, error: 'offscreen 返回为空' });
      });
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) });
    }
  });
}

/**
 * 请求离屏文档读取剪贴板（带重试）。
 * 刚创建离屏文档时，脚本可能还没挂上消息监听，所以失败时短暂等待后重试。
 */
async function requestOffscreenClipboard() {
  let last = { ok: false, error: 'offscreen 无响应' };
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await requestOffscreenClipboardOnce();
    if (last && last.ok) return last;
    if (attempt < 2) await sleep(150);
  }
  return last;
}

/** 读取剪贴板文本：{ ok, text } | { ok:false, error } */
async function readClipboard() {
  const ready = await ensureOffscreenDocument();
  if (!ready) {
    return { ok: false, error: '无法创建离屏文档（浏览器版本过低或接口不可用）' };
  }
  const resp = await requestOffscreenClipboard();
  if (!resp || !resp.ok) return { ok: false, error: (resp && resp.error) || '读取剪贴板失败' };
  return { ok: true, text: CFG.normalizeNewlines(resp.text || '') };
}

/* ==================================================================
 * 3. 候选框架与“标签页占用”协调
 * ================================================================== */

function hasActiveClaim(tabId) {
  const claim = claims.get(tabId);
  if (!claim) return false;
  if (claim.expiresAt <= Date.now()) {
    claims.delete(tabId);
    return false;
  }
  return true;
}

/**
 * 广播 'hxpt:arm' 后收集各框架上报的“候选”。
 * 最多等 400ms（足够本地消息往返），返回分数最高的候选。
 */
function collectCandidates(tabId) {
  return new Promise((resolve) => {
    const bucket = { items: [] };
    candidateBuckets.set(tabId, bucket);
    setTimeout(() => {
      if (candidateBuckets.get(tabId) === bucket) candidateBuckets.delete(tabId);
      resolve(pickBestCandidate(bucket.items));
    }, 400);
  });
}

function recordCandidate(tabId, frameId, msg) {
  const bucket = candidateBuckets.get(tabId);
  if (!bucket) return;
  if (bucket.items.some((item) => item.frameId === frameId)) return; // 同一框架只记一次
  bucket.items.push({
    frameId: frameId,
    focused: Boolean(msg.focused),
    iframe: Boolean(msg.iframe),
    recent: Boolean(msg.recent),
    at: Date.now()
  });
}

/**
 * 候选评分：当前光标在可编辑元素上（focused）最优；
 * 其次是焦点在跨域 iframe 里（iframe，可配合真实键盘模拟）；
 * 最后是“最近编辑过输入框”（recent，适用于用户刚才点了弹窗/按钮的场景）。
 */
function pickBestCandidate(items) {
  if (!items || !items.length) return null;
  const score = (item) => (item.focused ? 3 : 0) + (item.iframe ? 2 : 0) + (item.recent ? 1 : 0);
  const sorted = items.slice().sort((a, b) => (score(b) - score(a)) || (a.at - b.at));
  return sorted[0] || null;
}

/* ==================================================================
 * 4. CDP 真实键盘输入
 * ================================================================== */

function attachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.attach({ tabId: tabId }, '1.3', () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) reject(new Error(lastError.message || '附加调试会话失败'));
        else resolve();
      });
    } catch (e) { reject(e); }
  });
}

function detachDebugger(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.debugger.detach({ tabId: tabId }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch (e) { resolve(); }
  });
}

function debuggerCommand(tabId, method, params) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.sendCommand({ tabId: tabId }, method, params, (result) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) reject(new Error(lastError.message || (method + ' 执行失败')));
        else resolve(result);
      });
    } catch (e) { reject(e); }
  });
}

/** 把底层英文错误翻译成用户能看懂的提示 */
function debuggerErrorText(err) {
  const message = String((err && err.message) || err || '');
  if (/another debugger|already attached|attached to the tab|cannot attach/i.test(message)) {
    return '无法连接调试会话：请先关闭该页面的开发者工具（F12），或等待上一次输入完成后再试。';
  }
  if (/debugger permission|permission/i.test(message)) {
    return '缺少“调试”权限：请在扩展设置页重新授权真实键盘模拟。';
  }
  if (/detach|disconnected|target closed|not attached/i.test(message)) {
    return '调试会话已断开（可能点了黄色提示条上的“取消”或页面被关闭），本次输入中止。';
  }
  return message || '真实键盘输入失败';
}

/** 输入单个字符（'char' 事件等价于键盘产生的字符输入，且 isTrusted = true） */
function sendChar(tabId, text) {
  return debuggerCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'char',
    text: text,
    unmodifiedText: text
  });
}

/** 输入一个回车（模拟 Enter 键的完整序列） */
async function pressEnter(tabId) {
  await debuggerCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
  await debuggerCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'char',
    text: '\r',
    key: 'Enter',
    unmodifiedText: '\r'
  });
  await debuggerCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
}

/**
 * 逐字符派发真实键盘事件，返回 { ok, chars } 或 { ok:false, error, aborted }。
 * 说明：输入过程中每隔约 200ms 向顶层框架上报一次进度；用户取消时立即中断。
 */
async function typeTrusted(tabId, text, intervalMs) {
  if (!(await hasPermission('debugger'))) {
    return { ok: false, fallback: true, error: '未授予“调试”权限，无法使用真实键盘模拟' };
  }
  const key = String(tabId);
  if (typingSessions.has(key)) {
    return { ok: false, error: '该标签页已有一个输入任务正在进行' };
  }

  try {
    await attachDebugger(tabId);
  } catch (err) {
    return { ok: false, error: debuggerErrorText(err) };
  }

  const session = { abort: false };
  typingSessions.set(key, session);
  sendToFrame(tabId, 0, { cmd: 'hxpt:progress', done: 0, total: text.length });

  let sent = 0;
  let lastReport = Date.now();
  try {
    for (let i = 0; i < text.length; i++) {
      if (session.abort) {
        return { ok: false, aborted: true, chars: sent, error: '输入已取消' };
      }
      const ch = text[i];
      if (ch === '\r') continue; // \r 统一由 \n 处理，避免 CRLF 出现多余空行
      if (ch === '\n') {
        await pressEnter(tabId);
      } else if (ch === '\t') {
        // Tab 在文本框里通常被浏览器用于切换焦点而不是插入制表符，
        // 为保证内容完整，这里用 4 个空格代替制表符（README 有说明）。
        await sendChar(tabId, '    ');
      } else {
        await sendChar(tabId, ch);
      }
      sent += 1;

      if (Date.now() - lastReport >= 200) {
        lastReport = Date.now();
        sendToFrame(tabId, 0, { cmd: 'hxpt:progress', done: sent, total: text.length });
      }
      if (intervalMs > 0) await sleep(intervalMs);
    }
    sendToFrame(tabId, 0, { cmd: 'hxpt:progress', done: sent, total: text.length });
    return { ok: true, chars: sent };
  } catch (err) {
    return { ok: false, error: debuggerErrorText(err), chars: sent };
  } finally {
    typingSessions.delete(key);
    await detachDebugger(tabId);
  }
}

/* ==================================================================
 * 5. 注入主流程
 * ================================================================== */

/**
 * 启动一次注入（所有触发方式的统一入口）。
 * @param {string} source       触发表面：popup | hotkey | fab
 * @param {number} tabId        目标标签页
 * @param {string} [explicitText] 调用方已读到的剪贴板文本（可选）
 */
async function startInjection(source, tabId, explicitText) {
  if (!tabId || tabId < 0) return { ok: false, error: '未找到目标标签页' };

  const check = await checkTab(tabId);
  if (!check.ok) return check;

  const ping = await tabPing(tabId);
  if (!ping.ok) {
    return {
      ok: false,
      error: '页面脚本还没就绪：请先刷新超星页面再试（仅支持 *.chaoxing.com 页面）。'
    };
  }

  if (hasActiveClaim(tabId) || startingTabs.has(tabId)) {
    return { ok: false, error: '已有一次输入正在进行，请等它结束或按 Esc 取消。' };
  }
  startingTabs.add(tabId);
  try {
    const settings = await CFG.loadSettings();

    // 拿到本次要输入的文本：优先用调用方已经读到的，否则由后台读剪贴板
    let text = '';
    if (typeof explicitText === 'string') {
      text = CFG.normalizeNewlines(explicitText);
    } else {
      const clip = await readClipboard();
      if (!clip.ok) return { ok: false, error: '读取剪贴板失败：' + clip.error };
      text = clip.text;
    }
    if (!text) {
      return { ok: false, error: '剪贴板里没有可输入的文本（图片或文件暂不支持）。' };
    }

    const delayMs = settings.delayMs;
    const startAt = Date.now() + delayMs;

    // 广播 → 收集候选 → 选一个框架执行
    const collection = collectCandidates(tabId);
    sendToAllFrames(tabId, { cmd: 'hxpt:arm', charCount: text.length });
    const chosen = await collection;

    if (!chosen) {
      sendToFrame(tabId, 0, {
        cmd: 'hxpt:notice',
        text: '没有找到可以输入的编辑框：请先在输入框里点一下，让光标出现，然后再触发。'
      });
      return { ok: false, error: '没有找到可输入的编辑框：请先点击输入框放置光标。' };
    }

    const ttl = delayMs + 120000; // 占用至少保留到“倒计时 + 输入”结束
    claims.set(tabId, { frameId: chosen.frameId, expiresAt: Date.now() + ttl });

    // 由子框架执行时，让顶层框架负责显示倒计时（子框架里的 UI 太小）
    if (chosen.frameId !== 0) {
      sendToFrame(tabId, 0, { cmd: 'hxpt:countdown', startAt: startAt, delayMs: delayMs, charCount: text.length });
    }

    sendToFrame(tabId, chosen.frameId, {
      cmd: 'hxpt:go',
      text: text,
      startAt: startAt,
      delayMs: delayMs,
      mode: settings.mode,
      intervalMs: settings.intervalMs,
      charCount: text.length,
      iframeOnly: Boolean(chosen.iframe),
      source: source
    });

    return {
      ok: true,
      frameId: chosen.frameId,
      charCount: text.length,
      delayMs: delayMs,
      startAt: startAt
    };
  } finally {
    startingTabs.delete(tabId);
  }
}

function handleResult(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return;
  // 正常情况下结果一定在输入结束后才上报；如果此时还有输入会话在跑，
  // 说明调用方已超时/放弃（例如内容脚本超时），把残留的输入会话也停掉，
  // 避免它继续往页面里“幽灵输入”。
  const session = typingSessions.get(String(tabId));
  if (session) session.abort = true;
  claims.delete(tabId);
  // 执行框架不是顶层时，把结果转发给顶层框架显示提示
  if (sender.frameId !== 0) {
    sendToFrame(tabId, 0, {
      cmd: 'hxpt:result',
      ok: Boolean(msg.ok),
      message: msg.message || '',
      chars: Number(msg.chars) || 0,
      aborted: Boolean(msg.aborted)
    });
  }
}

function handleAbort(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return;
  const claim = claims.get(tabId);
  const session = typingSessions.get(String(tabId));
  if (session) session.abort = true; // 让正在逐字符输入的循环尽快退出
  claims.delete(tabId);
  // 通知执行框架中止
  if (claim && claim.frameId !== 0) {
    sendToFrame(tabId, claim.frameId, { cmd: 'hxpt:abort', reason: msg.reason || 'user' });
  }
  // 如果取消是从子框架发起的，通知顶层框架收起倒计时
  if (sender.frameId !== 0) {
    sendToFrame(tabId, 0, { cmd: 'hxpt:aborted', reason: msg.reason || 'user' });
  }
}

/* ==================================================================
 * 6. 消息路由
 * ================================================================== */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  const cmd = msg.cmd;
  if (typeof cmd !== 'string' || cmd.indexOf('hxpt:') !== 0) return;

  const tabId = sender.tab && sender.tab.id;
  const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;

  /** 标准异步回复包装 */
  const call = (fn) => {
    Promise.resolve()
      .then(fn)
      .then((result) => {
        try { sendResponse(result || {}); } catch (e) { /* 忽略 */ }
      }, (err) => {
        try { sendResponse({ ok: false, error: String((err && err.message) || err) }); } catch (e) { /* 忽略 */ }
      });
    return true;
  };

  switch (cmd) {
    case 'hxpt:start':
      return call(async () => {
        const targetTabId = typeof msg.tabId === 'number' && msg.tabId > 0 ? msg.tabId : tabId;
        return startInjection(msg.source || 'unknown', targetTabId, msg.text);
      });

    case 'hxpt:candidate':
      if (tabId) recordCandidate(tabId, frameId, msg);
      return call(async () => ({ ok: true }));

    case 'hxpt:capabilities':
      return call(async () => ({
        ok: true,
        trusted: await hasPermission('debugger'),
        version: chrome.runtime.getManifest().version
      }));

    case 'hxpt:trusted-type':
      return call(async () => {
        if (!tabId) return { ok: false, error: '缺少目标标签页' };
        const text = CFG.normalizeNewlines(msg.text || '');
        if (!text) return { ok: false, error: '没有可输入的文本' };
        const intervalMs = CFG.clampInt(msg.intervalMs, 0, 200, 5);
        return typeTrusted(tabId, text, intervalMs);
      });

    case 'hxpt:result':
      handleResult(msg, sender);
      return call(async () => ({ ok: true }));

    case 'hxpt:abort':
      handleAbort(msg, sender);
      return call(async () => ({ ok: true }));

    case 'hxpt:peek':
      return call(async () => {
        const clip = await readClipboard();
        if (!clip.ok) return { ok: false, error: clip.error };
        return { ok: true, text: clip.text };
      });

    default:
      return false;
  }
});

/* ==================================================================
 * 7. 事件：快捷键、安装初始化、标签页清理、调试会话断开
 * ================================================================== */

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'trigger-inject') return;
  (async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== 'number') return;
      const res = await startInjection('hotkey', tab.id);
      if (!res.ok) sendToFrame(tab.id, 0, { cmd: 'hxpt:notice', text: res.error });
    } catch (e) { /* 忽略：例如当前窗口不是普通网页 */ }
  })();
});

chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    try {
      const current = await chrome.storage.sync.get(null);
      if (!current || typeof current !== 'object' || current.delayMs === undefined) {
        await chrome.storage.sync.set(CFG.DEFAULTS);
      }
    } catch (e) { /* 忽略 */ }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  claims.delete(tabId);
  startingTabs.delete(tabId);
  const session = typingSessions.get(String(tabId));
  if (session) session.abort = true;
  candidateBuckets.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo && changeInfo.status === 'loading') {
    // 页面开始加载：清掉旧任务的占用，避免“永远显示忙碌”
    claims.delete(tabId);
    startingTabs.delete(tabId);
    candidateBuckets.delete(tabId);
    const session = typingSessions.get(String(tabId));
    if (session) session.abort = true;
  }
});

// 用户在黄色提示条上点了“取消”，或者页面被关闭/开发者工具接管
chrome.debugger.onDetach.addListener((source) => {
  if (!source || typeof source.tabId !== 'number') return;
  const session = typingSessions.get(String(source.tabId));
  if (session) session.abort = true;
});
