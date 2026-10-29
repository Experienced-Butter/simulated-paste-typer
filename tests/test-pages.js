/**
 * 弹窗 / 设置页冒烟测试（jsdom + chrome 桩）
 * 运行：node test-pages.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = path.join(__dirname, '..', 'extension');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS', name);
  else { failures++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

function makeStorage(initial) {
  const data = Object.assign({ delayMs: 3000, mode: 'auto', intervalMs: 5, showFab: true }, initial);
  return {
    data,
    api: {
      sync: {
        get: (defaults, cb) => {
          const result = Object.assign({}, defaults || {}, data);
          if (typeof cb === 'function') { setTimeout(() => cb(result), 0); return; }
          return Promise.resolve(result);
        },
        set: (obj, cb) => { Object.assign(data, obj); if (typeof cb === 'function') setTimeout(cb, 0); return Promise.resolve(); }
      }
    }
  };
}

/* ---------------- 弹窗 ---------------- */
async function testPopup() {
  console.log('== popup.js tests ==');
  const html = fs.readFileSync(path.join(EXT, 'popup.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'chrome-extension://testid/popup.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const store = makeStorage();

  const sent = [];
  window.chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => ({ version: '1.0.0' }),
      sendMessage: (payload, cb) => {
        sent.push(payload);
        setTimeout(() => {
          if (payload.cmd === 'spt:peek') { cb({ ok: true, text: '预览文本' }); return; }
          if (payload.cmd === 'spt:start') { cb({ ok: true, delayMs: 3000, charCount: 7 }); return; }
          cb({ ok: true });
        }, 0);
      },
      openOptionsPage: () => {}
    },
    storage: store.api,
    permissions: { contains: (q, cb) => setTimeout(() => cb(false), 0) },
    tabs: {
      query: () => Promise.resolve([{ id: 9, url: 'https://i.chaoxing.com/work' }])
    }
  };

  // 模拟剪贴板（弹窗内本地读取）
  Object.defineProperty(window.navigator, 'clipboard', {
    value: {
      read: async () => [{ types: ['text/plain'], getType: async () => new window.Blob(['从剪贴板来的文本'], { type: 'text/plain' }) }],
      readText: async () => '从剪贴板来的文本'
    },
    configurable: true
  });

  window.eval(fs.readFileSync(path.join(EXT, 'shared', 'config.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8'));
  await sleep(120);

  const doc = window.document;
  check('显示版本号', doc.getElementById('versionLabel').textContent === 'v1.0.0');
  check('识别受支持页面', doc.getElementById('statusText').textContent.indexOf('已连接受支持的页面') >= 0, doc.getElementById('statusText').textContent);
  check('等待时间下拉框有选项', doc.getElementById('delaySelect').options.length > 3);
  check('输入方式下拉框有 3 项', doc.getElementById('modeSelect').options.length === 3);
  check('剪贴板预览已填充', (doc.getElementById('clipPreview').textContent || '').indexOf('从剪贴板来的文本') >= 0);
  check('未授权时显示授权按钮', doc.getElementById('grantBtn').hidden === false);

  // 点击注入按钮
  doc.getElementById('injectBtn').click();
  await sleep(120);
  const startMsg = sent.filter((m) => m.cmd === 'spt:start').pop();
  check('点击注入发送 spt:start', !!startMsg && startMsg.tabId === 9, startMsg);
  check('优先使用弹窗本地读到的文本', !!startMsg && startMsg.text === '从剪贴板来的文本', startMsg && startMsg.text);
  check('显示成功反馈', (doc.getElementById('feedback').textContent || '').indexOf('已开始') >= 0);

  // 修改等待时间 → 保存
  const delaySelect = doc.getElementById('delaySelect');
  delaySelect.value = '5000';
  delaySelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(50);
  check('修改等待时间写入 storage', store.data.delayMs === 5000, store.data.delayMs);
}

/* ---------------- 设置页 ---------------- */
async function testOptions() {
  console.log('== options.js tests ==');
  const html = fs.readFileSync(path.join(EXT, 'options.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'chrome-extension://testid/options.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const store = makeStorage({ delayMs: 8000, mode: 'dom', intervalMs: 12 });
  const permissionCalls = [];

  window.chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => ({ version: '1.0.0' })
    },
    storage: store.api,
    permissions: {
      contains: (q, cb) => setTimeout(() => cb(false), 0),
      request: (q, cb) => { permissionCalls.push('request'); setTimeout(() => cb(true), 0); },
      remove: (q, cb) => { permissionCalls.push('remove'); setTimeout(() => cb(true), 0); }
    }
  };

  window.eval(fs.readFileSync(path.join(EXT, 'shared', 'config.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(EXT, 'options.js'), 'utf8'));
  await sleep(120);

  const doc = window.document;
  check('等待时间回填为秒', doc.getElementById('delayInput').value === '8', doc.getElementById('delayInput').value);
  check('输入方式回填', doc.getElementById('modeSelect').value === 'dom');
  check('字符间隔回填', doc.getElementById('intervalInput').value === '12');
  check('权限状态显示未授权', doc.getElementById('permStatus').textContent.indexOf('未授权') >= 0);

  // 修改等待时间并触发 change
  const delayInput = doc.getElementById('delayInput');
  delayInput.value = '15';
  delayInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(400);
  check('等待时间按秒保存为毫秒', store.data.delayMs === 15000, store.data.delayMs);

  // 越界值被夹紧
  delayInput.value = '999';
  delayInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(400);
  check('越界等待时间被夹到 60 秒', store.data.delayMs === 60000 && delayInput.value === '60', { delayMs: store.data.delayMs, input: delayInput.value });

  // 授权按钮
  doc.getElementById('grantBtn').click();
  await sleep(80);
  check('点击授权会调用 permissions.request', permissionCalls.indexOf('request') >= 0, permissionCalls);
}

(async () => {
  await testPopup();
  await testOptions();
  console.log(failures === 0 ? '\nALL PAGE TESTS PASSED' : `\n${failures} PAGE TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
