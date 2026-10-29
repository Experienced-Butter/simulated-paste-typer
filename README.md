# 模拟录入粘贴助手 · Simulated Paste Typer

在**限制粘贴的网页**上（例如部分在线作业、考试、问卷、在线文档等会拦截粘贴的页面），把剪贴板里的文本**以模拟键盘输入的方式**写入当前光标处。

> 触发 → 等待你放好光标 → 逐字符“打字”输入。全程不发送任何网络请求，剪贴板内容不落盘。

> ℹ️ 支持所有 http(s) 网页与本地 HTML 文件（`file://`，需在扩展详情中允许“访问文件网址”）；`edge://`、扩展页、开发者工具等浏览器内部页面无法注入。

![版本](https://img.shields.io/badge/version-1.1.1-blue)
![平台](https://img.shields.io/badge/platform-Edge%20%2F%20Chromium-3b82f6)
![许可](https://img.shields.io/badge/license-MIT-green)

---

## 目录

- [为什么需要它](#为什么需要它)
- [功能一览](#功能一览)
- [安装（Edge 开发者模式）](#安装edge-开发者模式)
- [使用方法](#使用方法)
- [设置项](#设置项)
- [权限与隐私](#权限与隐私)
- [常见问题](#常见问题)
- [项目结构与开发](#项目结构与开发)
- [发布：GitHub / Edge 加载项商店](#发布github--edge-加载项商店)
- [免责声明](#免责声明)
- [English Summary](#english-summary)

---

## 为什么需要它

部分在线作业 / 考试 / 讨论页面会拦截 `paste` 事件，Ctrl+V 与右键“粘贴”都被禁用。
但是这些页面通常**只拦截“粘贴动作”**，不会拦截真正的键盘输入。

本扩展的做法是：

1. 在你主动触发时读取**当前剪贴板里的最后一条文本**；
2. 等待一段可配置时间（让你把光标点到目标输入框里）；
3. 用**模拟键盘事件**（或等价的 DOM 文本插入）**逐字符**把内容写进光标处。

因为它不是 `paste` 事件，所以不会被“禁止粘贴”的页面逻辑拦截。

## 功能一览

- 🖱️ **三种触发方式**：页面悬浮按钮 / 工具栏弹窗 / 快捷键（默认 `Ctrl+Shift+Y`）
- ⏱️ **可配置等待时间**：触发后 1–60 秒才开始输入，从容放好光标
- ⌨️ **两种输入引擎**
  - *真实键盘模拟*（推荐）：通过 CDP 派发**可信（isTrusted）** 的键盘事件，兼容性最高
  - *兼容输入*：`document.execCommand('insertText')` 等 DOM 方式，**不需要任何额外权限**
- 🧷 **光标保护**：输入前会再次确认光标仍在可编辑区域；输入过程中若焦点被切走会自动中止，避免把内容打到搜索框等位置
- ✋ **随时取消**：倒计时与输入过程中按 `Esc` 或点“中止”即可停止
- 🧩 **框架友好**：支持输入框位于 iframe 内的页面（自动选择正确的框架执行）
- 🎨 **轻量 UI**：所有界面放在 Shadow DOM 内，不污染页面样式，也不被页面样式污染
- 🌐 **通用**：支持所有 http(s) 网页与本地 HTML 文件（`file://` 需在扩展详情中允许“访问文件网址”），浏览器内部页面除外
- 🔒 **零网络请求**：没有统计、没有上报、没有远程代码

## 安装（Edge 开发者模式）

### 方式 A：使用发布包（推荐）

1. 解压 `dist/simulated-paste-typer-v<版本>.zip`（或直接使用 `dist/simulated-paste-typer-v<版本>/` 目录）；
2. 打开 Edge，地址栏输入 `edge://extensions`；
3. 打开左侧 / 右下角的 **“开发人员模式”**；
4. 点击 **“加载解压缩的扩展”**，选择**包含 `manifest.json` 的那个目录**（即解压出来的 `simulated-paste-typer-v<版本>` 文件夹）；
5. 工具栏出现蓝色图标即安装成功（可在“扩展”菜单里把图标固定到工具栏）。

> Chrome 内核相同，`chrome://extensions` 下同样可以加载。

> ⚠️ 安装时 Edge 会提示扩展可“读取并更改你在所有网站上的数据”，这是因为扩展需要在任意网页上提供悬浮按钮与输入能力；扩展没有任何网络请求，剪贴板也只在你主动触发时读取一次。

### 方式 B：从源码构建

```powershell
# Windows PowerShell
pwsh ./scripts/build.ps1
```

构建产物在 `dist/`：

| 产物 | 用途 |
| --- | --- |
| `dist/simulated-paste-typer-v<版本>/` | 开发者模式“加载解压缩的扩展” |
| `dist/simulated-paste-typer-v<版本>.zip` | Edge 加载项商店上传（zip 根目录即 `manifest.json`） |
| `dist/SHA256SUMS.txt` | 发布时附带的校验值 |

也可以**直接加载源码目录** `extension/`（它本身就是可加载的扩展目录），但商店上传请使用构建出的 ZIP。

### 首次使用建议：授权“真实键盘模拟”（可选）

1. 点扩展图标 → 弹窗底部 → “设置与说明” → 打开设置页；
2. 在 “真实键盘模拟” 一栏点 **授权调试权限**，确认浏览器的权限提示；
3. 之后在页面上看到黄色提示条“正在调试此浏览器”是**正常现象**，输入结束自动消失。

不授权也能用：把输入方式设为 **自动** 或 **兼容输入** 即可。

## 使用方法

任意一种方式触发后，都会先等待“触发后等待时间”，然后开始输入：

### 方式 1：页面悬浮按钮（最省事）

1. 在受支持的页面里，先在**目标输入框**里点一下，让光标出现；
2. 点右下角的**圆形按钮**（可拖动到别处）；
3. 等待倒计时结束，内容自动输入到光标处。

> 按钮点击不会抢走输入框焦点，所以光标位置会保留。

### 方式 2：工具栏弹窗

1. 先在目标输入框里点一下（这一步很重要）；
2. 点扩展图标 → **“读取剪贴板并输入到光标处”**；
3. 弹窗关闭后倒计时照常进行（页面下方有状态条）。

### 方式 3：快捷键

- 默认快捷键 **`Ctrl+Shift+Y`**（Mac：`Command+Shift+Y`）；
- 可在 `edge://extensions/shortcuts` 中修改或重设。

> 快捷键触发时剪贴板由后台读取；个别环境下后台读取会失败，此时请改用悬浮按钮或弹窗（它们用点击手势读取，成功率最高）。

### 取消

- 倒计时或输入中：按 **`Esc`**，或点状态条上的“取消 / 中止”。

### “最后一条内容”指什么？

- 指**当前系统剪贴板**的内容（即你最近一次复制/剪切的内容），支持 `text/plain` 与 `text/html`（富文本会转为纯文本）；
- Windows 的剪贴板**历史记录**（`Win+V` 列表）无法被网页扩展访问，扩展只能拿到当前那一条；
- **图片、文件**等非文本内容不支持，会提示“剪贴板里没有可输入的文本”。

## 设置项

设置页：扩展图标 → “设置与说明”（或 `edge://extensions` → 详情 → 扩展选项）。

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 触发后等待时间 | 3 秒 | 触发后先等这么久再输入（1–60 秒） |
| 输入方式 | 自动 | `自动`：有调试权限用真实键盘模拟，否则用兼容输入；`真实键盘模拟`：必须授权调试权限；`兼容输入`：DOM 插入，无需额外权限 |
| 字符间隔 | 5 毫秒 | 真实键盘模拟逐字符输入的间隔（0–200），越大越像真人打字但也更慢 |
| 页面悬浮按钮 | 开 | 是否在受支持的页面显示右下角圆形按钮 |

## 权限与隐私

| 权限 | 为什么需要 |
| --- | --- |
| `clipboardRead` | 读取当前剪贴板文本（只在触发动作时读取一次） |
| `storage` | 保存设置（chrome.storage.sync，浏览器自带同步） |
| `offscreen` | MV3 后台没有 DOM，用离屏文档读取剪贴板 |
| `debugger`（**可选**） | 仅在启用“真实键盘模拟”时请求；用于向当前标签页派发受信任键盘事件 |
| `host_permissions: http(s)://*/*、file:///*` | 在所有网页与本地文件页注入内容脚本和悬浮按钮（安装时“读取并更改所有网站上的数据”的提示即来自这里） |

- **没有网络请求**：扩展代码中不存在 `fetch` / `XMLHttpRequest` / 远程脚本；
- **不收集数据**：不读取浏览历史、不读取页面内容、不上传剪贴板；
- 剪贴板内容**只在内存中传递一次**，输入完成后即丢弃，不写入磁盘或存储；
- 详细的隐私说明见 [`docs/PRIVACY.md`](docs/PRIVACY.md)。

## 常见问题

**Q1：提示“没有找到可输入的编辑框”？**
先在该页面的输入框里**点一下**让光标出现，再触发扩展。输入框如果是 `iframe` 里的跨域编辑器，需要用“真实键盘模拟”（授权调试权限）。

**Q2：真实键盘模拟报错“无法连接调试会话”？**
该标签页开着开发者工具（F12）时，调试接口被占用。请先关闭开发者工具再试。

**Q3：为什么输入期间页面顶部有一条黄色提示？**
真实键盘模拟使用浏览器调试接口，Chromium 会显示“正在调试此浏览器”。输入结束会自动断开；**不要点提示条上的“取消”**，否则会中断本次输入。

**Q4：兼容输入没有反应？**
部分富文本编辑器（自定义 `contenteditable`）不响应 `execCommand('insertText')`。请改用“真实键盘模拟”，或把输入方式选“自动”并授权调试权限。

**Q5：为什么大段文字输入得比较慢？**
真实键盘模拟是**逐字符**模拟打字（默认每个字符间隔 5ms，可调小）。几万字的超长文本请适当调小间隔，或分多次输入。

**Q6：复制的是网页富文本，输入后格式没了？**
剪贴板取的是纯文本（`text/plain`）；只有 HTML 时会把 HTML 转为纯文本（保留换行）。这是刻意为之——模拟键盘输入本身只能输入文本。

**Q7：制表符怎么办？**
Tab 在文本框中通常用于切换焦点而不是插入字符，扩展会把 `\t` 替换为 4 个空格（README 已注明）。

**Q8：会不会把内容打到别的地方？**
输入前会检查“光标是否还在可编辑元素上”，输入中每 250ms 检查一次，焦点被切走就立即中止。但仍建议先放好光标再触发。

**Q9：支持哪些网站？**
支持所有 http(s) 网页与本地 HTML 文件（`file://`，需在扩展详情中允许“访问文件网址”）；`edge://`、扩展页、开发者工具等浏览器内部页面无法注入。

**Q10：弹窗显示“页面脚本未运行”或更新扩展后没反应？**
说明页面里的内容脚本还没加载：先刷新本页（F5）；如果刚更新过扩展，请到 `edge://extensions` 点扩展的“重新加载”，然后刷新页面。

## 项目结构与开发

```
simulated-paste-typer/
├─ extension/                 # ← 源码即扩展本体（可直接“加载解压缩的扩展”）
│  ├─ manifest.json           # MV3 清单
│  ├─ background.js           # Service Worker：剪贴板/候选框架协调/CDP 键盘输入
│  ├─ content.js              # 内容脚本：悬浮按钮、倒计时 UI、DOM 输入
│  ├─ offscreen.html/.js      # 离屏文档：读取剪贴板
│  ├─ popup.html/.css/.js     # 工具栏弹窗
│  ├─ options.html/.css/.js   # 设置页
│  ├─ shared/config.js        # 共享配置与工具函数
│  └─ icons/                  # 图标（由脚本生成）
├─ scripts/
│  ├─ build.ps1               # 校验 + 打包 ZIP
│  └─ make-icons.ps1          # 生成图标
├─ tests/                     # 行为测试（jsdom + chrome 桩；npm test）
│  ├─ test-config.js          # 共享配置 / HTML→纯文本 / 剪贴板条目解析
│  ├─ test-content.js         # 内容脚本：候选、倒计时、DOM 输入、取消
│  ├─ test-background.js      # 后台：读剪贴板、候选评分、CDP 循环、取消
│  └─ test-pages.js           # 弹窗与设置页冒烟测试
├─ docs/
│  ├─ ARCHITECTURE.md         # 架构与消息流程
│  ├─ PRIVACY.md              # 隐私说明（可直接用作商店隐私政策）
│  └─ STORE.md                # Edge 加载项商店提交清单
├─ .github/workflows/build.yml # CI：校验 + 打包 + 测试
├─ dist/                      # 构建产物（未纳入 git）
├─ CHANGELOG.md
├─ LICENSE
└─ README.md
```

开发流程：

```powershell
# 1) 改完 extension/ 里的代码后，在 edge://extensions 里点该扩展的“重新加载”
# 2) 生成图标（只在需要改图标时）
pwsh ./scripts/make-icons.ps1
# 3) 出包
pwsh ./scripts/build.ps1
# 4) 跑行为测试（需要 Node.js，首次要安装依赖）
cd tests
npm install
npm test
```

调试建议：

- 内容脚本日志：在页面按 F12，Console 里看 `__SPT_*` 相关输出；
- 后台日志：`edge://extensions` → 该扩展 → “Service Worker” → 检查视图；
- 弹窗 / 设置页：右键扩展图标 → “审查弹出内容”，或直接打开 `options.html`。

## 发布：GitHub / Edge 加载项商店

### 上传到 GitHub（GitHub Desktop 直接“从本地添加”）

本仓库已经是**初始化好的 git 仓库**（已有 `.git` 与首个提交），所以：

1. 打开 GitHub Desktop → `File` → `Add local repository…`；
2. 选择本目录 `simulated-paste-typer`，即可直接添加；
3. 点 `Publish repository` 推到 GitHub（建议不要勾选 “Keep this code private”，或按需选择）。

如果拿到的是不含 `.git` 的副本，也可以在 GitHub Desktop 里 `File → New repository` 指向该目录，或手动 `git init` 后再添加。

### 提交到 Microsoft Edge 加载项商店

1. 打开 [Edge 加载项开发人员中心](https://partner.microsoft.com/dashboard/microsoftedge/overview) 注册并创建新项目；
2. 上传 `dist/simulated-paste-typer-v<版本>.zip`（根目录含 `manifest.json`）；
3. 名称、简介、详细描述、截图、隐私政策等文案模板见 [`docs/STORE.md`](docs/STORE.md)；
4. 注意：`debugger` 属于**可选高权限**，商店审核时需在“权限说明”里解释用途（模板已写好）；
5. 审核通过后即可发布。

> 隐私政策可以直接把 [`docs/PRIVACY.md`](docs/PRIVACY.md) 的内容托管到 GitHub Pages 后填写链接。

## 免责声明

- 本项目仅用于**你自己有权输入的内容**；请遵守所在学校 / 单位与目标网站的规则；
- 使用本扩展产生的一切后果由使用者自行承担。

## License

[MIT](LICENSE) © 2025 Simulated Paste Typer contributors

---

# English Summary

**Simulated Paste Typer** is a Microsoft Edge (Chromium) extension that types the text currently in your clipboard into the focused input field on pages that block pasting (e.g. homework / quiz / form pages with paste handlers). It works on any http(s) page and local HTML files.

- Triggered by a floating page button, the toolbar popup, or the `Ctrl+Shift+Y` shortcut;
- Waits a configurable delay (1–60 s), then inserts the clipboard text at the caret;
- Two input engines: *trusted keyboard simulation* (CDP via the optional `debugger` permission, real `isTrusted` key events) and *compatibility insert* (`execCommand('insertText')`, no extra permissions);
- No network requests, no data collection. Clipboard is read only on your action and never stored.

Build: `pwsh ./scripts/build.ps1` → loads via `edge://extensions` → *Load unpacked* (`dist/simulated-paste-typer-v<version>/`), or upload `dist/simulated-paste-typer-v<version>.zip` to the Edge Add-ons store.

See [docs/STORE.md](docs/STORE.md) for store listing templates and [docs/PRIVACY.md](docs/PRIVACY.md) for the privacy policy.
