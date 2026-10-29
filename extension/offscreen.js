/**
 * 超星粘贴助手 · 离屏文档脚本
 * ==================================================================
 * MV3 的 Service Worker 没有 DOM、也不能直接访问剪贴板，
 * 所以后台通过 chrome.offscreen 创建一个这个页面来读取剪贴板。
 *
 * 只响应来自后台的消息：
 *   { target: 'hxpt-offscreen', cmd: 'read' }
 * 回复：
 *   { ok: true, text }           读取成功（text 可能是空字符串）
 *   { ok: false, error }         读取失败（权限/激活/接口不可用）
 *
 * 这里不保存任何内容，也不发起任何网络请求。
 */
'use strict';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'hxpt-offscreen' || msg.cmd !== 'read') return;

  (async () => {
    const CFG = self.HXPT_CONFIG;
    try {
      let text = '';

      // 优先用 navigator.clipboard.read()：
      // 它能拿到“当前剪贴板条目”的全部类型，便于选择文本内容（哪怕同时带了图片）。
      if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
        try {
          const items = await navigator.clipboard.read();
          if (CFG && CFG.readClipboardTextFromItems) {
            text = await CFG.readClipboardTextFromItems(items);
          }
        } catch (e) { /* read() 不可用时退回 readText() */ }
      }

      // 退路：直接读纯文本
      if (!text && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        try { text = await navigator.clipboard.readText(); } catch (e) { /* 忽略，下面统一报错 */ }
      }

      // 仍失败则给出错误（区分“读不到”和“为空”对用户没有意义，后台会统一提示）
      if (!text) {
        // 再尝试一次 readText，以便区分“权限拒绝”和“剪贴板本来就是空的”
        let lastError = null;
        try {
          if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
            await navigator.clipboard.readText();
            sendResponse({ ok: true, text: '' }); // 能读到，但内容为空（例如只有图片/文件）
            return;
          }
        } catch (e) {
          lastError = e;
        }
        sendResponse({ ok: false, error: String((lastError && lastError.message) || '读取剪贴板失败') });
        return;
      }

      sendResponse({ ok: true, text: String(text) });
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();

  return true; // 异步 sendResponse
});
