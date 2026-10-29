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

## 五、截图与宣传素材

商店要求至少一张截图，推荐 **1280×800**（PNG/JPG）。本仓库已用真实 Edge（Chromium 156）自动生成好 4 张 1280×800 截图，位于 [`store-assets/`](store-assets/)：

| 文件 | 内容 |
| --- | --- |
| `store-assets/01-page-countdown.png` | 网页中的悬浮按钮 + 倒计时状态条 |
| `store-assets/02-page-done.png` | 输入完成后的页面与提示 |
| `store-assets/03-popup.png` | 工具栏弹窗界面 |
| `store-assets/04-options.png` | 设置页 |

> 截图使用一个本地“禁止粘贴”的演示页面生成（页面文字与示例答案均为虚构内容）。
> 可另附功能演示 GIF（≤ 10MB）。

## 六、发布检查清单

- [ ] `manifest.json` 中 `version` 已递增
- [ ] `pwsh ./scripts/build.ps1` 构建通过（含 JS 语法检查与文件存在性校验）
- [ ] ZIP 根目录存在 `manifest.json`
- [ ] 在全新 Edge 配置中“加载解压缩的扩展”验证安装
- [ ] 在真实网站上完成一次“悬浮按钮 / 弹窗 / 快捷键”三种触发验证
- [ ] `README.md`、`docs/PRIVACY.md` 链接有效
- [ ] 权限说明文案已按上文填写
- [ ] 截图 / 宣传图已准备（可直接使用 `store-assets/` 里的 4 张）

## 七、打包与提交（操作步骤）

### 1. 打包

```powershell
cd simulated-paste-typer
pwsh ./scripts/build.ps1        # 校验 + 打包
```

输出：

- `dist/simulated-paste-typer-v<版本>/` —— 本地“加载解压缩的扩展”用它；
- `dist/simulated-paste-typer-v<版本>.zip` —— **上传商店用这个**（根目录即 `manifest.json`，已校验）；
- `dist/SHA256SUMS.txt` —— 校验值。

> 当前版本：`1.1.1`，包名 `simulated-paste-typer-v1.1.1.zip`，SHA-256 `6489D57DC3A8EF261BAA6C36DA6D40B5BDFE6546F5099A04F5E870B085131091`。

### 2. 注册 Microsoft Partner Center

1. 打开 <https://partner.microsoft.com/dashboard/microsoftedge/overview>；
2. 用 Microsoft 账号登录（没有就注册一个，邮箱验证）；
3. 同意开发者协议，进入 **Microsoft Edge 加载项** 工作区。Edge 加载项商店**不收取上架费用**。

### 3. 新建项目并上传包

1. 工作区里点 **“新建扩展” / “New extension”**；
2. 填写扩展名称（可与 manifest 名不同，窗口里展示的是商店名称）；
3. 进入项目的 **“程序包 / Packages”** 页 → **“上传新程序包”** → 选择 `dist/simulated-paste-typer-v1.1.1.zip`；
4. 上传后确认版本号显示为 `1.1.1`、状态为“有效”。

### 4. 填写商店信息（Store listing / Properties）

| 字段 | 填什么 |
| --- | --- |
| 名称 | `模拟录入粘贴助手 - 剪贴板转键盘输入`（或 `Simulated Paste Typer`） |
| 简短描述（≤132 字符） | `在限制粘贴的页面上，用模拟键盘输入把剪贴板文本写入光标处。` |
| 详细描述 | 复制本文档“二、商店信息模板 → 详细描述”整段 |
| 类别 | `Productivity`（生产力工具） |
| 语言 | 中文（简体），可选加 English |
| 隐私政策 URL | 见下一步 |
| 支持/联系网址 | `https://github.com/Experienced-Butter/simulated-paste-typer/issues` |
| 网站（可选） | `https://github.com/Experienced-Butter/simulated-paste-typer` |
| 截图 | 上传 `store-assets/01..04` 四张 1280×800 PNG |

### 5. 托管隐私政策（GitHub Pages）

1. 仓库 → **Settings → Pages** → Source 选 **Deploy from a branch**；
2. Branch 选 `master`，文件夹选 **`/docs`**，Save；
3. 等 1–2 分钟，隐私政策地址为：
   `https://Experienced-Butter.github.io/simulated-paste-typer/PRIVACY.md`
4. 把这个地址填到商店的“隐私政策 URL”。（`docs/PRIVACY.md` 内容可直接当政策使用。）

### 6. 提交审核

- 在 **“权限 / 审核说明”** 相关字段里粘贴本文档“三、权限说明”的内容（尤其 `debugger` 为可选权限的解释）；
- 点 **“发布” / “Submit for review”**；
- 审核通常 1–7 个工作日，结果会发到注册邮箱；可在 Partner Center 的“事件日志”查看进度；
- 通过后扩展会在 <https://microsoftedge.microsoft.com/addons> 上架，商店详情页地址可在项目里找到；可把该链接写进 README。

### 7. 发布新版本（以后）

1. 修改代码后把 `manifest.json` 的 `version` **递增**（如 `1.1.2`）；
2. `pwsh ./scripts/build.ps1` 重新打包；
3. Partner Center → 你的项目 → **“程序包” → “上传新程序包”** 上传新 zip → 提交更新；
4. 商店审核通过后用户会自动收到更新。
