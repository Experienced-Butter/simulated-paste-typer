/**
 * 超星粘贴助手 · 设置页逻辑
 * ==================================================================
 * - 读写 chrome.storage.sync（与弹窗、后台共享同一份设置）；
 * - 数值输入统一夹紧到合法范围；
 * - “调试”权限是可选的，这里提供授权 / 移除入口。
 */
'use strict';

(function () {
  const CFG = window.HXPT_CONFIG;
  const $ = (id) => document.getElementById(id);

  let settings = null;
  let saveTimer = null;
  let savedTimer = null;

  /* ---------------- 设置应用 / 保存 ---------------- */

  function applySettings(next) {
    settings = next;
    $('delayInput').value = String(Math.round(next.delayMs / 1000));
    $('intervalInput').value = String(next.intervalMs);
    $('modeSelect').value = next.mode;
    $('fabToggle').checked = Boolean(next.showFab);
  }

  function flashSaved() {
    const el = $('saveState');
    el.hidden = false;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { el.hidden = true; }, 1600);
  }

  /** 简单防抖保存：连续改动只触发最后一次写入 */
  function scheduleSave(patch) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const next = await CFG.saveSettings(patch);
      applySettings(next); // 回填夹紧之后的值
      flashSaved();
    }, 250);
  }

  /* ---------------- 权限 ---------------- */

  function permissionsContains() {
    return new Promise((resolve) => {
      try {
        chrome.permissions.contains({ permissions: ['debugger'] }, (value) => {
          void chrome.runtime.lastError;
          resolve(Boolean(value));
        });
      } catch (e) { resolve(false); }
    });
  }

  async function refreshPermission() {
    const badge = $('permStatus');
    const granted = await permissionsContains();
    if (granted) {
      badge.className = 'badge ok';
      badge.textContent = '已授权（推荐）';
    } else {
      badge.className = 'badge err';
      badge.textContent = '未授权：将使用兼容输入';
    }
    $('grantBtn').disabled = granted;
    $('revokeBtn').disabled = !granted;
  }

  async function requestPermission() {
    try {
      const granted = await new Promise((resolve) => {
        chrome.permissions.request({ permissions: ['debugger'] }, (value) => {
          void chrome.runtime.lastError;
          resolve(Boolean(value));
        });
      });
      await refreshPermission();
      if (!granted) {
        // 用户拒绝时不打扰，只在状态里体现
      }
    } catch (e) { /* 忽略 */ }
  }

  async function removePermission() {
    try {
      await new Promise((resolve) => {
        chrome.permissions.remove({ permissions: ['debugger'] }, (value) => {
          void chrome.runtime.lastError;
          resolve(Boolean(value));
        });
      });
      await refreshPermission();
      // 移除权限后，若输入方式仍是“真实键盘模拟”之外的自动，则无需改设置
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 初始化 ---------------- */

  async function init() {
    const manifest = chrome.runtime.getManifest();
    $('versionLabel').textContent = 'v' + manifest.version;
    $('aboutVersion').textContent = manifest.version;

    // 填写“输入方式”下拉框
    const modeSelect = $('modeSelect');
    for (const mode of CFG.MODES) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = CFG.MODE_LABELS[mode] || mode;
      modeSelect.appendChild(option);
    }

    applySettings(await CFG.loadSettings());
    await refreshPermission();
    bindEvents();
  }

  function bindEvents() {
    // 等待时间：界面用“秒”，存储用“毫秒”
    $('delayInput').addEventListener('change', (event) => {
      const seconds = CFG.clampInt(Number(event.target.value), 1, 60, 3);
      event.target.value = String(seconds);
      scheduleSave({ delayMs: seconds * 1000 });
    });

    $('intervalInput').addEventListener('change', (event) => {
      const intervalMs = CFG.clampInt(Number(event.target.value), 0, 200, 5);
      event.target.value = String(intervalMs);
      scheduleSave({ intervalMs: intervalMs });
    });

    $('modeSelect').addEventListener('change', (event) => {
      scheduleSave({ mode: event.target.value });
    });

    $('fabToggle').addEventListener('change', (event) => {
      scheduleSave({ showFab: Boolean(event.target.checked) });
    });

    $('resetBtn').addEventListener('click', async () => {
      const next = await CFG.saveSettings(CFG.DEFAULTS);
      applySettings(next);
      flashSaved();
    });

    $('grantBtn').addEventListener('click', requestPermission);
    $('revokeBtn').addEventListener('click', removePermission);
  }

  init().catch((err) => {
    console.error('[HXPT] 设置页初始化失败', err);
  });
})();
