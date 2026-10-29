/**
 * 内容脚本行为测试（jsdom）
 * 运行：node test-content.js
 * 覆盖：候选上报、倒计时、DOM 输入、trusted 输入、取消、空剪贴板提示。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'extension');
const configSrc = fs.readFileSync(path.join(ROOT, 'shared', 'config.js'), 'utf8');
const contentSrc = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS', name);
  else { failures++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const dom = new JSDOM(
  `<!doctype html><html><body>
     <textarea id="ta"></textarea>
     <input id="inp">
     <div id="ce" contenteditable="true"></div>
   </body></html>`,
  { url: 'https://i.chaoxing.com/work', runScripts: 'outside-only', pretendToBeVisual: true }
);
const { window } = dom;
const doc = window.document;

/* ---------- 可见性垫片（jsdom 无布局，所有元素 rect 为 0） ---------- */
function makeVisible(el) {
  el.getClientRects = () => [{}];
  el.getBoundingClientRect = () => ({ width: 200, height: 24, left: 0, top: 0, right: 200, bottom: 24 });
}
makeVisible(doc.getElementById('ta'));
makeVisible(doc.getElementById('inp'));
makeVisible(doc.getElementById('ce'));

/* ---------- chrome 桩 ---------- */
const sent = [];               // 内容脚本发给后台的消息
const responses = {};          // 按 cmd 决定后台回复
const msgListeners = [];       // chrome.runtime.onMessage 的监听器

function makeStorage() {
  const data = {};
  return {
    get: (defaults, cb) => {
      const result = Object.assign({}, defaults || {}, data);
      if (typeof cb === 'function') { setTimeout(() => cb(result), 0); return; }
      return Promise.resolve(result);
    },
    set: (obj, cb) => { Object.assign(data, obj); if (typeof cb === 'function') setTimeout(cb, 0); return Promise.resolve(); }
  };
}

window.chrome = {
  runtime: {
    lastError: undefined,
    sendMessage: (payload, cb) => {
      sent.push(payload);
      const responder = responses[payload && payload.cmd];
      setTimeout(() => {
        if (typeof cb !== 'function') return;
        let resp = { ok: true };
        if (responder) resp = responder(payload);
        cb(resp);
      }, 0);
    },
    onMessage: { addListener: (fn) => msgListeners.push(fn) }
  },
  storage: {
    sync: makeStorage(),
    local: { get: (defaults, cb) => { setTimeout(() => { if (cb) cb(Object.assign({}, defaults || {})); }, 0); }, set: () => {} },
    onChanged: { addListener: () => {} }
  },
  permissions: { contains: (q, cb) => cb(true), request: (q, cb) => cb(true) }
};

/* jsdom 没有 execCommand 实现：让它返回 false，从而走“原生 setter 插入”的兜底分支 */
doc.execCommand = () => false;

/* 记录 textarea 的 input 事件 */
const inputEvents = [];
doc.getElementById('ta').addEventListener('input', (e) => inputEvents.push(e.inputType || 'input'));

/* 加载共享配置 + 内容脚本 */
window.eval(configSrc);
window.eval(contentSrc);

function bgMsg(msg, sender) {
  msgListeners.forEach((fn) => {
    try {
      fn(msg, sender || { tab: { id: 1 }, frameId: 0 }, () => {});
    } catch (e) { console.log('  listener threw:', e); failures++; }
  });
}

function lastSent(cmd) {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].cmd === cmd) return sent[i];
  return null;
}

(async () => {
  console.log('== content.js tests ==');
  await sleep(80); // 等待 init() 读完设置

  const ta = doc.getElementById('ta');
  const host = doc.getElementById('__hxpt_host__');
  check('Shadow UI host 已创建', !!host);

  // 1. 有焦点 → 上报 candidate focused
  ta.focus();
  ta.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
  ta.setSelectionRange(0, 0);
  ta.dispatchEvent(new window.Event('selectionchange', { bubbles: true }));
  bgMsg({ cmd: 'hxpt:arm' });
  await sleep(30);
  let cand = lastSent('hxpt:candidate');
  check('arm → candidate(focused)', !!cand && cand.focused === true, cand);

  // 2. DOM 模式输入（delay 很短）
  responses['hxpt:capabilities'] = () => ({ ok: true, trusted: false });
  responses['hxpt:result'] = () => ({ ok: true });
  inputEvents.length = 0;
  bgMsg({
    cmd: 'hxpt:go',
    text: 'Hello\nWorld',
    startAt: Date.now() + 80,
    delayMs: 80,
    mode: 'dom',
    intervalMs: 0,
    charCount: 11
  });
  await sleep(400);
  check('DOM 模式写入 textarea', ta.value === 'Hello\nWorld', ta.value);
  check('DOM 模式触发了 input 事件', inputEvents.length === 1, inputEvents);
  const domResult = lastSent('hxpt:result');
  check('DOM 模式上报 result(ok)', !!domResult && domResult.ok === true, domResult);

  // 3. trusted 模式：走后台 CDP
  responses['hxpt:capabilities'] = () => ({ ok: true, trusted: true });
  responses['hxpt:trusted-type'] = () => ({ ok: true, chars: 5 });
  ta.value = '';
  ta.focus();
  bgMsg({ cmd: 'hxpt:arm' });
  await sleep(30);
  bgMsg({
    cmd: 'hxpt:go',
    text: 'abcdef',
    startAt: Date.now() + 60,
    delayMs: 60,
    mode: 'trusted',
    intervalMs: 0,
    charCount: 6
  });
  await sleep(300);
  const trustedCall = lastSent('hxpt:trusted-type');
  check('trusted 模式请求后台 CDP 输入', !!trustedCall && trustedCall.text === 'abcdef', trustedCall);
  check('trusted 模式不会写 DOM', ta.value === '', JSON.stringify(ta.value));

  // 4. 取消：倒计时期间 abort，不应触发输入
  const before = sent.filter((m) => m.cmd === 'hxpt:trusted-type').length;
  ta.focus();
  bgMsg({ cmd: 'hxpt:arm' });
  await sleep(30);
  bgMsg({
    cmd: 'hxpt:go',
    text: 'should-not-type',
    startAt: Date.now() + 300,
    delayMs: 300,
    mode: 'trusted',
    intervalMs: 0,
    charCount: 15
  });
  await sleep(60);
  bgMsg({ cmd: 'hxpt:abort' });
  await sleep(400);
  const after = sent.filter((m) => m.cmd === 'hxpt:trusted-type').length;
  check('取消后不再输入', after === before, { before, after });

  // 5. 焦点离开输入框后，仍会以 recent 候选参与竞争（用于“先放光标、再点弹窗”的场景）
  doc.activeElement && doc.activeElement.blur && doc.activeElement.blur();
  ta.blur();
  doc.body.focus && doc.body.focus();
  bgMsg({ cmd: 'hxpt:arm' });
  await sleep(30);
  const recentCand = lastSent('hxpt:candidate');
  check('失去焦点后上报 recent 候选', !!recentCand && recentCand.focused === false && recentCand.recent === true, recentCand);

  // 6. 空文本 go → 立即 result(ok:false)
  bgMsg({ cmd: 'hxpt:go', text: '', startAt: Date.now(), mode: 'dom', intervalMs: 0 });
  await sleep(30);
  const emptyRes = sent.filter((m) => m.cmd === 'hxpt:result').pop();
  check('空文本立即失败', !!emptyRes && emptyRes.ok === false, emptyRes);

  console.log(failures === 0 ? '\nALL CONTENT TESTS PASSED' : `\n${failures} CONTENT TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
