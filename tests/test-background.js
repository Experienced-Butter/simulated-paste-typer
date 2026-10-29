/**
 * 后台 Service Worker 行为测试（Node + vm + chrome 桩）
 * 运行：node test-background.js
 * 覆盖：读剪贴板、候选评分、go 下发、结果转发、trusted 输入循环、取消、非受支持页拦截。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', 'extension');
const configSrc = fs.readFileSync(path.join(EXT, 'shared', 'config.js'), 'utf8');
const backgroundSrc = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS', name);
  else { failures++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

/* ---------------- chrome 桩 ---------------- */
const state = {
  messageListeners: [],
  commandListeners: [],
  tabRemovedListeners: [],
  tabUpdatedListeners: [],
  debuggerListeners: [],
  tabMessages: [],        // { tabId, frameId, payload }
  attachCalls: 0,
  detachCalls: 0,
  debuggerCommands: [],   // { method, params }
  offscreenCreated: 0,
  offscreenReads: 0,
  storage: { delayMs: 3000, mode: 'auto', intervalMs: 5, showFab: true },
  tabUrl: 'https://i.chaoxing.com/work',
  pingOk: true,
  debuggerGranted: false,
  clipboardText: '剪贴板内容 abc',
  onArm: null             // (tabId) => 模拟内容脚本上报候选
};

function tabSendMessage(tabId, payload, optionsOrCb, maybeCb) {
  let frameId = 0;
  let cb = null;
  if (typeof optionsOrCb === 'function') cb = optionsOrCb;
  else if (optionsOrCb && typeof optionsOrCb === 'object') frameId = optionsOrCb.frameId == null ? 0 : optionsOrCb.frameId;
  if (typeof maybeCb === 'function') cb = maybeCb;

  state.tabMessages.push({ tabId, frameId, payload });

  if (payload && payload.cmd === 'spt:ping') {
    const resp = state.pingOk ? { ok: true, top: frameId === 0 } : undefined;
    if (cb) { setTimeout(() => cb(resp), 0); return undefined; }
    return state.pingOk ? Promise.resolve(resp) : Promise.reject(new Error('no receiver'));
  }

  if (payload && payload.cmd === 'spt:arm' && typeof state.onArm === 'function') {
    setTimeout(() => state.onArm(tabId), 20);
  }

  if (cb) { setTimeout(() => cb(undefined), 0); return undefined; }
  return Promise.resolve(undefined);
}

const chrome = {
  runtime: {
    lastError: undefined,
    onMessage: { addListener: (fn) => state.messageListeners.push(fn) },
    onInstalled: { addListener: () => {} },
    getManifest: () => ({ version: '1.0.0' }),
    sendMessage: (payload, cb) => {
      if (payload && payload.target === 'spt-offscreen') {
        state.offscreenReads += 1;
        setTimeout(() => cb({ ok: true, text: state.clipboardText }), 0);
        return;
      }
      if (typeof cb === 'function') setTimeout(() => cb({ ok: true }), 0);
    }
  },
  storage: {
    sync: {
      get: (defaults) => Promise.resolve(Object.assign({}, defaults || {}, state.storage)),
      set: (obj) => { Object.assign(state.storage, obj); return Promise.resolve(); }
    }
  },
  permissions: {
    contains: (query, cb) => setTimeout(() => cb(state.debuggerGranted), 0)
  },
  tabs: {
    get: (tabId) => Promise.resolve({ id: tabId, url: state.tabUrl }),
    sendMessage: tabSendMessage,
    onRemoved: { addListener: (fn) => state.tabRemovedListeners.push(fn) },
    onUpdated: { addListener: (fn) => state.tabUpdatedListeners.push(fn) }
  },
  debugger: {
    attach: (target, version, cb) => { state.attachCalls += 1; setTimeout(() => cb(), 0); },
    detach: (target, cb) => { state.detachCalls += 1; setTimeout(() => cb && cb(), 0); },
    sendCommand: (target, method, params, cb) => {
      state.debuggerCommands.push({ method, params });
      setTimeout(() => cb && cb({}), 0);
    },
    onDetach: { addListener: (fn) => state.debuggerListeners.push(fn) }
  },
  offscreen: {
    hasDocument: () => Promise.resolve(state.offscreenCreated > 0),
    createDocument: () => { state.offscreenCreated += 1; return Promise.resolve(); }
  },
  commands: { onCommand: { addListener: (fn) => state.commandListeners.push(fn) } }
};

/* ---------------- 加载 background.js ---------------- */
const sandbox = {
  chrome,
  importScripts: () => {}, // 共享配置单独执行
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
};
const context = vm.createContext(sandbox);
sandbox.self = sandbox;
vm.runInContext('var self = globalThis;', context);
vm.runInContext(configSrc, context);
vm.runInContext(backgroundSrc, context);

/* ---------------- 工具 ---------------- */
function sendMessageToBackground(msg, sender) {
  let response;
  const ret = state.messageListeners[0](
    msg,
    sender || { tab: { id: 5 }, frameId: 0 },
    (resp) => { response = resp; }
  );
  return { ret, getResponse: () => response };
}

async function callBg(msg, sender) {
  const holder = { resp: undefined };
  state.messageListeners[0](msg, sender || { tab: { id: 5 }, frameId: 0 }, (resp) => { holder.resp = resp; });
  for (let i = 0; i < 100 && holder.resp === undefined; i++) await sleep(20);
  return holder.resp;
}

function lastTabMessage(cmd) {
  for (let i = state.tabMessages.length - 1; i >= 0; i--) {
    const item = state.tabMessages[i];
    if (item.payload && item.payload.cmd === cmd) return item;
  }
  return null;
}

/* ---------------- 用例 ---------------- */
(async () => {
  console.log('== background.js tests ==');

  // 1. 普通流程：hotkey 触发 → 读剪贴板 → 候选 → go
  state.onArm = (tabId) => {
    state.messageListeners[0](
      { cmd: 'spt:candidate', focused: true, iframe: false, recent: false },
      { tab: { id: tabId }, frameId: 2 },
      () => {}
    );
  };
  let res = await callBg({ cmd: 'spt:start', source: 'hotkey' });
  check('start 成功', !!res && res.ok === true && res.frameId === 2, res);
  check('走了离屏文档读剪贴板', state.offscreenReads > 0);
  const go = lastTabMessage('spt:go');
  check('向执行框架下发 go（frame 2）', !!go && go.frameId === 2 && go.payload.text === state.clipboardText, go && { frameId: go.frameId, cmd: go.payload.cmd });
  const countdown = lastTabMessage('spt:countdown');
  check('向顶层下发 countdown（frame 0）', !!countdown && countdown.frameId === 0);

  // 2. 结果转发 + 占用释放
  state.messageListeners[0](
    { cmd: 'spt:result', ok: true, message: 'ok', chars: 10 },
    { tab: { id: 5 }, frameId: 2 },
    () => {}
  );
  await sleep(30);
  const relay = lastTabMessage('spt:result');
  check('结果转发到顶层（frame 0）', !!relay && relay.frameId === 0);

  state.onArm = (tabId) => {
    state.messageListeners[0](
      { cmd: 'spt:candidate', focused: true, iframe: false, recent: false },
      { tab: { id: tabId }, frameId: 2 },
      () => {}
    );
  };
  res = await callBg({ cmd: 'spt:start', source: 'hotkey' });
  check('上一次完成后可以再次 start（占用已释放）', !!res && res.ok === true, res);
  state.messageListeners[0]({ cmd: 'spt:result', ok: true, message: 'ok', chars: 10 }, { tab: { id: 5 }, frameId: 2 }, () => {});
  await sleep(30);

  // 3. 候选评分：focused 优先于 recent
  state.tabMessages.length = 0;
  state.onArm = (tabId) => {
    state.messageListeners[0]({ cmd: 'spt:candidate', recent: true }, { tab: { id: tabId }, frameId: 1 }, () => {});
    state.messageListeners[0]({ cmd: 'spt:candidate', focused: true }, { tab: { id: tabId }, frameId: 3 }, () => {});
  };
  res = await callBg({ cmd: 'spt:start', source: 'hotkey' });
  check('优先选择 focused 框架', !!res && res.frameId === 3, res);
  state.messageListeners[0]({ cmd: 'spt:result', ok: true }, { tab: { id: 5 }, frameId: 3 }, () => {});
  await sleep(30);

  // 4. 无候选 → 顶层提示
  state.tabMessages.length = 0;
  state.onArm = null;
  res = await callBg({ cmd: 'spt:start', source: 'hotkey' });
  check('无候选时返回失败', !!res && res.ok === false, res);
  const notice = lastTabMessage('spt:notice');
  check('无候选时顶层显示提示', !!notice && notice.frameId === 0);

  // 5. 非受支持页面拦截
  state.tabUrl = 'https://example.com/';
  res = await callBg({ cmd: 'spt:start', source: 'hotkey' });
  check('非受支持页面被拦截', !!res && res.ok === false && /不受支持/.test(res.error || ''), res);
  state.tabUrl = 'https://i.chaoxing.com/work';

  // 6. trusted-type：权限未授予 → fallback
  state.debuggerGranted = false;
  let tr = await callBg({ cmd: 'spt:trusted-type', text: 'abc', intervalMs: 0 }, { tab: { id: 5 }, frameId: 2 });
  check('未授权时返回 fallback', !!tr && tr.ok === false && tr.fallback === true, tr);

  // 7. trusted-type：逐字符输入（含回车与制表符）
  state.debuggerGranted = true;
  state.attachCalls = 0;
  state.detachCalls = 0;
  state.debuggerCommands.length = 0;
  tr = await callBg({ cmd: 'spt:trusted-type', text: 'A\nB\tC', intervalMs: 0 }, { tab: { id: 5 }, frameId: 2 });
  check('trusted 输入成功，字符数正确', !!tr && tr.ok === true && tr.chars === 5, tr); // 7 = A \n B 4空格 C
  const methods = state.debuggerCommands.map((c) => c.method);
  check('attach / detach 各一次', state.attachCalls === 1 && state.detachCalls === 1, { attach: state.attachCalls, detach: state.detachCalls });
  const charTexts = state.debuggerCommands.filter((c) => c.params.type === 'char').map((c) => c.params.text);
  check('char 序列 = A, \\r, B, 4空格, C', JSON.stringify(charTexts) === JSON.stringify(['A', '\r', 'B', '    ', 'C']), charTexts);
  check('Enter 用 rawKeyDown + keyUp', methods.filter((m) => m === 'Input.dispatchKeyEvent').length >= 6, methods);
  const lastProgress = lastTabMessage('spt:progress');
  check('有进度上报', !!lastProgress && lastProgress.payload.total === 5);

  // 8. 输入中取消
  state.debuggerGranted = true;
  state.debuggerCommands.length = 0;
  const typingPromise = callBg(
    { cmd: 'spt:trusted-type', text: 'X'.repeat(120), intervalMs: 5 },
    { tab: { id: 5 }, frameId: 2 }
  );
  await sleep(120);
  state.messageListeners[0]({ cmd: 'spt:abort', reason: 'user' }, { tab: { id: 5 }, frameId: 0 }, () => {});
  tr = await typingPromise;
  check('取消后输入中止', !!tr && tr.ok === false && tr.aborted === true && tr.chars < 120, tr);
  await sleep(100);

  // 9. 弹窗传入已读取的文本（不走 offscreen）
  state.tabMessages.length = 0;
  const readsBefore = state.offscreenReads;
  state.onArm = (tabId) => {
    state.messageListeners[0]({ cmd: 'spt:candidate', focused: true }, { tab: { id: tabId }, frameId: 0 }, () => {});
  };
  res = await callBg({ cmd: 'spt:start', source: 'popup', text: '直接传入的文本' });
  check('弹窗显式文本生效', !!res && res.ok === true, res);
  check('显式文本时不读离屏剪贴板', state.offscreenReads === readsBefore);
  const go2 = lastTabMessage('spt:go');
  check('go 下发的是弹窗传入的文本', !!go2 && go2.payload.text === '直接传入的文本', go2 && go2.payload.text);
  state.messageListeners[0]({ cmd: 'spt:result', ok: true }, { tab: { id: 5 }, frameId: 0 }, () => {});
  await sleep(30);

  // 10. 空文本 → 失败
  res = await callBg({ cmd: 'spt:start', source: 'popup', text: '' });
  check('空文本返回失败', !!res && res.ok === false, res);

  console.log(failures === 0 ? '\nALL BACKGROUND TESTS PASSED' : `\n${failures} BACKGROUND TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
