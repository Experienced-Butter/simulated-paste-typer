# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.1] - 2025-01-01

### 修复

- 修复 Edge 下整个后台服务不响应的问题：“调试”权限（可选）未授予时 `chrome.debugger` 不存在，后台在启动阶段访问 `chrome.debugger.onDetach` 抛错，导致 Service Worker 无法启动——表现为点“注入”没反应、快捷键无效。
- 后台对 `chrome.debugger` / `chrome.commands` 的访问全部增加存在性保护，权限未授予时不再崩溃。
- 内容脚本查询权限最多等待 3 秒，后台异常时自动按“兼容输入”继续，不会卡住。
- 弹窗新增“页面脚本是否就绪”检测：未注入时明确提示刷新页面 / 重新加载扩展，并禁用注入按钮。
- 弹窗内授权失败时自动打开设置页完成授权；设置页显示授权结果说明。

## [1.1.0] - 2025-01-01

### 变更

- 项目更名为「模拟录入粘贴助手 · Simulated Paste Typer」。
- 解除站点限制：支持所有 http(s) 网页与本地 HTML 文件（`file://`，需在扩展详情中允许“访问文件网址”）；`edge://`、扩展页、开发者工具等浏览器内部页面除外。
- “受支持页面”改为按协议判定；悬浮按钮、弹窗与后台文案同步去站点化。
- 因权限范围扩大到所有网站，安装时会提示“读取并更改你在所有网站上的数据”；扩展只在用户触发时读取剪贴板并输入，没有任何网络请求。

## [1.0.0] - 2025-01-01

### 新增

- 页面右下角悬浮按钮（可拖动），点击后等待指定时间再把剪贴板内容输入到光标处；
- 工具栏弹窗：页面状态检测、等待时间 / 输入方式快捷设置、剪贴板预览、一键注入；
- 快捷键触发（默认 `Ctrl+Shift+Y`，可在 `edge://extensions/shortcuts` 修改）；
- 两种输入引擎：
  - 真实键盘模拟：通过 `chrome.debugger` + CDP 派发可信键盘事件（可选权限）；
  - 兼容输入：`document.execCommand('insertText')` / 原生 value setter，无需额外权限；
- 多框架支持：自动选择“光标所在框架”执行输入，支持 iframe 内编辑器；
- 光标保护：输入前后校验焦点，焦点被切走时自动中止；
- 倒计时 / 进度状态条，支持 `Esc` 取消；
- 设置页：等待时间、输入方式、字符间隔、悬浮按钮开关、调试权限管理；
- 零网络请求、无数据收集；
- 打包脚本与图标生成脚本。

[1.1.1]: https://github.com/your-username/simulated-paste-typer/releases/tag/v1.1.1
[1.1.0]: https://github.com/your-username/simulated-paste-typer/releases/tag/v1.1.0
[1.0.0]: https://github.com/your-username/simulated-paste-typer/releases/tag/v1.0.0
