/**
 * shared/config.js 单元测试（纯函数 + DOMParser）
 * 运行：node test-config.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const configSrc = fs.readFileSync(path.join(__dirname, '..', 'extension', 'shared', 'config.js'), 'utf8');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com/' });

const sandbox = { console, setTimeout, clearTimeout, DOMParser: dom.window.DOMParser, Node: dom.window.Node };
const context = vm.createContext(sandbox);
vm.runInContext('var self = globalThis;', context);
vm.runInContext(configSrc, context);
const CFG = sandbox.SPT_CONFIG;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS', name);
  else { failures++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

(async () => {
  console.log('== config.js tests ==');

  check('默认值', CFG.DEFAULTS.delayMs === 3000 && CFG.DEFAULTS.mode === 'auto' && CFG.DEFAULTS.intervalMs === 5);

  // clampInt
  check('clampInt 夹紧上界', CFG.clampInt(999, 0, 200, 5) === 200);
  check('clampInt 夹紧下界', CFG.clampInt(-5, 0, 200, 5) === 0);
  check('clampInt 非法值用 fallback', CFG.clampInt('abc', 0, 200, 5) === 5);

  // normalize
  const n = CFG.normalize({ delayMs: 999999, mode: 'bogus', intervalMs: -3, showFab: 0 });
  check('normalize 修正越界与非法枚举', n.delayMs === 60000 && n.mode === 'auto' && n.intervalMs === 0 && n.showFab === false, n);

  // normalizeNewlines
  check('normalizeNewlines 处理 CRLF/CR', CFG.normalizeNewlines('a\r\nb\rc') === 'a\nb\nc', CFG.normalizeNewlines('a\r\nb\rc'));

  // htmlToText
  check('htmlToText 段落 → 换行', CFG.htmlToText('<p>你好</p><p>世界</p>') === '你好\n世界', CFG.htmlToText('<p>你好</p><p>世界</p>'));
  check('htmlToText br → 换行', CFG.htmlToText('a<br>b') === 'a\nb', CFG.htmlToText('a<br>b'));
  check('htmlToText 列表 → 每项一行', CFG.htmlToText('<ul><li>一</li><li>二</li></ul>') === '一\n二', CFG.htmlToText('<ul><li>一</li><li>二</li></ul>'));
  check('htmlToText 去脚本样式', CFG.htmlToText('<style>.a{}</style><script>x()</script>正文') === '正文', CFG.htmlToText('<style>.a{}</style><script>x()</script>正文'));
  check('htmlToText 空输入', CFG.htmlToText('') === '');

  // readClipboardTextFromItems
  function item(types, contents) {
    return {
      types,
      getType: async (type) => new Blob([contents[type]], { type })
    };
  }
  const plain = await CFG.readClipboardTextFromItems([item(['text/plain'], { 'text/plain': '纯文本' })]);
  check('优先 text/plain', plain === '纯文本', plain);

  const htmlOnly = await CFG.readClipboardTextFromItems([item(['text/html'], { 'text/html': '<p>富文本</p><p>第二段</p>' })]);
  check('HTML → 纯文本', htmlOnly === '富文本\n第二段', htmlOnly);

  const imageOnly = await CFG.readClipboardTextFromItems([item(['image/png'], { 'image/png': '' })]);
  check('只有图片时返回空', imageOnly === '');

  const multi = await CFG.readClipboardTextFromItems([
    item(['image/png'], { 'image/png': '' }),
    item(['text/plain'], { 'text/plain': '第二个文本' })
  ]);
  check('多条目时跳过图片取文本', multi === '第二个文本', multi);

  console.log(failures === 0 ? '\nALL CONFIG TESTS PASSED' : `\n${failures} CONFIG TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
