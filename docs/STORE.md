# Microsoft Edge 加载项商店 · 提交清单

本文件用于把扩展提交到 [Microsoft Edge 加载项商店](https://partner.microsoft.com/dashboard/microsoftedge/overview) 时直接复制粘贴。

## 一、上传包

- 使用 `dist/simulated-paste-typer-v<版本>.zip`；
- ZIP **根目录**必须包含 `manifest.json`（构建脚本已保证）；
- 建议同时上传/附带 `dist/SHA256SUMS.txt` 的 SHA256 值（可选）。

## 二、商店信息模板

### 名称（Name）

- 中文：`模拟录入粘贴助手 - 剪贴板转键盘输入`
- English：`Simulated Paste Typer - Clipboard to Keyboard`

### 简短描述（Short description，≤132 字符）

- 中文：`在限制粘贴的页面上，用模拟键盘输入把剪贴板文本写入光标处。`
- English：`Types clipboard text at the caret with trusted keyboard events on paste-restricted pages.`

### 详细描述（Description）

```
【中文】

模拟录入粘贴助手（Simulated Paste Typer）解决“页面禁止粘贴”的场景：部分在线作业、考试与讨论页面会拦截
Ctrl+V 与右键粘贴，但不会拦截真正的键盘输入。

本扩展做的事情：
1. 在你主动触发时（页面悬浮按钮 / 工具栏按钮 / Ctrl+Shift+Y 快捷键），读取当前剪贴板中的
   最后一条文本；
2. 等待一段可配置的时间（默认 3 秒，1-60 秒可调），让你把光标放到目标输入框；
3. 以模拟键盘输入的方式，把文本逐字符写入光标处。

主要特性：
• 三种触发方式：页面悬浮按钮、工具栏弹窗、键盘快捷键
• 两种输入引擎：真实键盘模拟（可选调试权限，可信 isTrusted 键盘事件）与兼容输入
  （DOM 插入，无需额外权限）
• 光标保护：输入前再次确认光标位置；输入中焦点被切走会自动中止
• 倒计时 / 进度提示，随时按 Esc 取消
• 支持 iframe 内的编辑器
• 适用于所有 http(s) 网页与本地 HTML 文件（file:// 需允许访问文件网址）
• 零网络请求，不收集任何数据

隐私：本扩展不收集、不上传任何数据，不读取浏览历史与页面内容；剪贴板只在你的触发动作时
读取一次，且仅用于本次输入，不落盘。

说明：本扩展仅用于输入你有权输入的内容，请在遵守学校纪律与平台规则的前提下使用。

【English】

Simulated Paste Typer fills paste-restricted web pages by typing clipboard text as
keyboard input. Trigger it with the floating page button, the toolbar popup, or
Ctrl+Shift+Y; it waits a configurable delay and then types the last clipboard
text into the focused field using trusted keyboard events (or a DOM fallback).

Features: three trigger methods, two input engines (CDP trusted keystrokes with
the optional debugger permission, or execCommand insertText with no extra
permissions), caret protection, cancellable countdown, iframe support, works on any http(s) page and local HTML files, and zero
network requests. No data is collected or uploaded.
```

### 分类（Category）

`Productivity`（生产力工具）

### 语言

`中文（简体）`，可选补充 `English`

### 隐私政策 URL

把 [`PRIVACY.md`](PRIVACY.md) 发布为公开网页（例如仓库的 GitHub Pages）后填入链接。

## 三、权限说明（商店审核填写）

商店审核可能针对高权限要求说明，逐条填写如下：

### clipboardRead

> 读取当前剪贴板文本，仅在用户点击“注入”按钮 / 悬浮按钮 / 快捷键时读取一次，用作要输入到页面光标处的内容。不写入剪贴板，不发送到任何服务器。

（English）
> Reads the current clipboard text only when the user explicitly triggers the
> extension (floating button, popup button, or keyboard shortcut). The text is
> used solely to type into the focused field of the page. Nothing is written to
> the clipboard or sent to any server.

### storage

> 保存用户偏好（等待时间、输入方式、字符间隔、悬浮按钮开关），使用 chrome.storage.sync。

### offscreen

> MV3 后台 Service Worker 没有 DOM，无法访问剪贴板；扩展按规范使用 offscreen document（reason: CLIPBOARD）完成剪贴板读取。

### host_permissions: http(s)://*/*、file:///*

> 内容脚本需要在任意网页上提供悬浮按钮与“把剪贴板文本写入光标处”的功能，因此需要覆盖所有 http(s) 网页与本地 HTML 文件（`file://` 还需用户在扩展详情中允许“访问文件网址”）。扩展只在用户主动触发时读取剪贴板并输入，没有任何网络请求。

### debugger（可选权限，默认不授予）

> 用于“真实键盘模拟”：通过 CDP 的 Input.dispatchKeyEvent 向当前标签页派发 isTrusted 的键盘事件，从而绕开页面“禁止粘贴”的限制。该权限是**可选的**，只有用户在设置中主动授权后才会使用；不授权时扩展使用 DOM 插入方式工作。附加说明：使用该模式时 Chromium 会显示黄色“正在调试此浏览器”提示条，输入结束后立即断开调试会话。

（English）
> Optional permission used only for the "trusted keyboard simulation" engine:
> dispatches `isTrusted` key events to the current tab via CDP
> `Input.dispatchKeyEvent`, so paste-blocked pages receive the text as real
> typing. It is requested at runtime only when the user opts in; without it the
> extension falls back to DOM text insertion. While active, Chromium shows a
> yellow "being debugged" infobar, and the debugger session is detached right
> after typing finishes.

## 四、审核测试说明（给审核员）

- 扩展对所有 http(s) 网页与本地 HTML 文件生效，浏览器内部页面（`edge://`、扩展页等）除外；
- 测试步骤：
  1. 打开任意网页（例如 `https://www.bing.com/`）；
  2. 点击页面右下角蓝色圆形按钮（若未显示，可在扩展弹窗中确认“页面悬浮按钮”为开）；
  3. 在页面中找到任意输入框（例如搜索框、弹窗表单），点击让光标出现；
  4. 再点击圆形按钮：3 秒倒计时后，剪贴板文本会被输入到光标处。
- 测试“自动输入到账号登录框”是安全的：不会提交任何表单，只在页面上按键。
- “真实键盘模拟”会显示黄色调试提示条，属于该模式的正常行为。

## 五、截图与宣传素材建议

商店要求至少一张截图（推荐 1280×800，PNG/JPG）：

1. 网页 + 右下角悬浮按钮；2. 倒计时状态条；3. 弹窗界面；4. 设置页。

可另附：功能演示 GIF（≤ 10MB）。

## 六、发布检查清单

- [ ] `manifest.json` 中 `version` 已递增
- [ ] `pwsh ./scripts/build.ps1` 构建通过（含 JS 语法检查与文件存在性校验）
- [ ] ZIP 根目录存在 `manifest.json`
- [ ] 在全新 Edge 配置中“加载解压缩的扩展”验证安装
- [ ] 在真实网站上完成一次“悬浮按钮 / 弹窗 / 快捷键”三种触发验证
- [ ] `README.md`、`docs/PRIVACY.md` 链接有效
- [ ] 权限说明文案已按上文填写
- [ ] 截图 / 宣传图已准备
