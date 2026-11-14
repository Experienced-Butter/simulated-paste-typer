# v1.1.3 更新说明（界面多语言 + 商店多语言）

> 本版把扩展界面改为**自动跟随浏览器语言**：简体中文 / 繁体中文 / English。
> 功能、权限、快捷键与安装方式不变；只改了界面语言与商店语言，便于向更多地区发布。

## 一、本版改了什么

| 内容 | 说明 |
| --- | --- |
| 界面语言 | 弹窗、设置页、页面悬浮按钮、倒计时、状态与报错全部本地化 |
| 自动切换 | 浏览器语言是繁体中文（zh-TW / zh-HK / zh-MO / zh-Hant）→ 繁体中文；是其它中文（zh-CN / zh-SG 等）→ 简体中文；非中文 → English |
| 商店语言 | 包内新增 `_locales/en`、`_locales/zh_TW`、`_locales/zh_HK`、`_locales/zh_MO`（`default_locale` 改为 `en`），商店可识别为多语言扩展 |
| 版本 | 1.1.2 → **1.1.3**（用于商店更新） |

已用真实 Edge（Chromium 156）分别以 `--lang=en-US / zh-CN / zh-TW / zh-HK` 运行验证，界面均按预期显示对应语言。

## 二、更新步骤

### 步骤 1：本地仓库（GitHub Desktop）

```text
GitHub Desktop → 选择 simulated-paste-typer → Changes → Commit → Push origin
```

本次提交包含：`extension/shared/i18n.js`、`extension/_locales/*`、popup/options 的本地化改动、版本号 1.1.3。

### 步骤 2：Edge 商店上传新包

> 注意：v1.1.2 目前还在「正在审阅」。有两条路：
> - **A（推荐）**：等 v1.1.2 审阅结束（通过或拒绝），再上传 v1.1.3 作为更新；
> - **B**：如果着急，先在该项目里点「取消提交」，然后直接把 v1.1.3 作为新的提交发出去。

1. Partner Center → 你的项目 → **「程序包」→「上传新程序包」**；
2. 选择 `dist/simulated-paste-typer-v1.1.3.zip`，等待校验通过，版本应显示 `1.1.3`。

### 步骤 3：补充商店语言（Store 一览）

新包会多出可用语言：**英文 / 中文(中国) / 中文(台灣) / 中文(香港) / 中文(澳門)**。

1. 「Store 一览」页 → **「添加语言」**，依次加入需要的语言（至少加 **英文** 与 **中文(台灣)**；香港/澳门可加，也可由台湾文案复用）；
2. 对每种语言点 **「编辑详细信息」**：
   - **描述**：粘贴下面对应语言的文案（简体沿用 1.1.2 已填的内容）；
   - **扩展徽标**：上传 `docs/store-assets/logo-300.png`（每种语言都要，可重复同一张）；
   - **屏幕截图**：上传 `docs/store-assets/01..04` 四张 1280×800（每种语言都要）；
   - **搜索词**：可选，建议英文用 `paste`、`keyboard`、`typing`；繁中用 `貼上`、`鍵盤`、`輸入`；
3. 每种语言都点 **「保存草稿」**，语言行状态变为「已完成」。

### 步骤 4：确认其他步骤并提交

- 「可用性」「属性」「隐私」保持原样（类别：高效工作；网站与支持链接已填）；
- 点 **「发布」** 提交审核，预计 1–7 个工作日；
- 审核通过后，商店详情页会按用户语言显示对应文案。

### 步骤 5：GitHub 发布（可选）

1. GitHub Desktop 创建 tag `v1.1.3` 并推送；
2. GitHub → Releases → Draft a new release → 选 `v1.1.3`，附上
   `dist/simulated-paste-typer-v1.1.3.zip` 与 `dist/SHA256SUMS.txt`；
3. 描述可直接用本文件内容。

## 三、商店描述文案（英文 / 繁体）

### English

```
Simulated Paste Typer types the current clipboard text at the caret using trusted keyboard events.
It is designed for pages that block pasting (Ctrl+V / right-click paste), such as homework, quiz,
survey and online-document forms.

How it works
1. Click the target input field so the caret appears.
2. Trigger the extension: floating page button, toolbar popup, or Ctrl+Shift+Y.
3. After the configured delay (3 s by default) the text is typed character by character; press Esc to cancel.

Features
- Three ways to trigger: floating button, popup, keyboard shortcut
- Two input engines: trusted keyboard simulation (optional debugger permission, isTrusted key events) and compatible input (DOM insertion, no extra permissions)
- Caret protection: the caret position is re-checked before typing and typing stops if focus moves away
- Supports editors inside iframes; works on any http(s) page and local HTML files
- Zero network requests, no data collection

Permissions
- clipboardRead: reads the clipboard text once, only when you trigger it
- storage: saves your preferences
- offscreen: reads the clipboard from a small offscreen document (MV3 background has no DOM)
- Optional debugger: used only for trusted keyboard simulation after you grant it
- host permissions: needed to inject the floating button and typing logic on pages
```

### 繁體中文

```
模擬錄入貼上助手會把目前剪貼簿中的文字，以模擬鍵盤輸入的方式寫入游標處。
適用於會攔截貼上的網頁（例如部分線上作業、測驗、問卷與線上表單）。

使用方式
1. 先在目標輸入框裡點一下，讓游標出現；
2. 透過頁面右下角圓形按鈕、工具列彈出視窗，或按 Ctrl+Shift+Y 觸發；
3. 等待設定的時間（預設 3 秒）後，文字會逐字輸入到游標處；按 Esc 可取消。

主要功能
- 三種觸發方式：頁面懸浮按鈕、彈出視窗、快速鍵
- 兩種輸入引擎：真實鍵盤模擬（選用偵錯權限，派發可信鍵盤事件）與相容輸入（DOM 插入，無需額外權限）
- 游標保護：輸入前再次確認游標位置，焦點被切走會自動中止
- 支援 iframe 內的編輯器；支援所有 http(s) 網頁與本機 HTML 檔案
- 沒有任何網路請求，不收集任何資料

權限說明
- clipboardRead：只在你主動觸發時讀取一次剪貼簿文字
- storage：儲存設定
- offscreen：MV3 背景沒有 DOM，用離屏文件讀取剪貼簿
- 選用 debugger：僅在啟用「真實鍵盤模擬」並授權後使用
- host_permissions：需要在網頁中注入懸浮按鈕與輸入功能
```

## 四、校验

`dist/simulated-paste-typer-v1.1.3.zip` 的 SHA-256 见 `dist/SHA256SUMS.txt`，下载后可用：

```powershell
Get-FileHash .\simulated-paste-typer-v1.1.3.zip -Algorithm SHA256
```
