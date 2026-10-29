# v1.1.1 · 模拟录入粘贴助手（修复后台不响应）

把剪贴板里的最后一条文本，以**模拟键盘输入**的方式写入网页当前光标处。适用于拦截 Ctrl+V / 右键粘贴的页面。

## 本次修复（重要）

修复了一个会导致**整个后台服务不响应**的问题：

- **根因**：`debugger` 是可选权限，未授予时 Edge 中 `chrome.debugger` 为 `undefined`；后台脚本在启动阶段访问 `chrome.debugger.onDetach` 抛 TypeError，导致 Service Worker 无法启动。表现为：点“注入”没有输入、快捷键无效、授权后仍提示未获得权限。
- 后台对所有 `chrome.debugger` / `chrome.commands` 的访问增加存在性保护，权限未授予时不再崩溃。
- 内容脚本查询权限最多等待 3 秒，后台异常时自动按“兼容输入”继续，不会卡住。
- 弹窗新增“页面脚本是否就绪”检测：未注入时明确提示刷新页面 / 重新加载扩展，并禁用注入按钮。
- 弹窗内授权失败时自动打开设置页完成授权；设置页显示授权结果与排障提示。

已在真实 Edge（Chromium 156）中端到端验证：兼容输入与真实键盘模拟两种模式都能正确输入。

## 安装 / 更新

1. 下载本 Release 附件 `simulated-paste-typer-v1.1.1.zip` 并解压；
2. 打开 Edge → `edge://extensions` → 开启“开发人员模式”；
3. **移除旧版本**（尤其之前加载的旧目录），再点“加载解压缩的扩展”，选择解压目录（根目录有 `manifest.json`）；
4. 打开任意网页按 `F5` 刷新。点扩展图标，第一行应显示“已连接受支持的页面，可以开始”，右下角出现蓝色圆形按钮。

> 更新后如果弹窗显示“页面脚本未运行”：到 `edge://extensions` 点该扩展的“重新加载”，再刷新页面。

## 使用

1. 在目标输入框里点一下，让光标出现；
2. 触发以下任一方式：
   - 页面右下角**圆形按钮**（可拖动）；
   - 工具栏弹窗 → “读取剪贴板并输入到光标处”；
   - 快捷键 `Ctrl+Shift+Y`（可在 `edge://extensions/shortcuts` 修改）；
3. 等待设定时间（默认 3 秒）后，文本会逐字符输入到光标处；按 `Esc` 可取消。

如需“真实键盘模拟”：扩展图标 → 设置与说明 → 在设置页点“授权调试权限”并允许（输入期间页面顶部会出现黄色调试提示条，属正常现象）。

## 校验

| 文件 | SHA-256 |
| --- | --- |
| `simulated-paste-typer-v1.1.1.zip` | `6489D57DC3A8EF261BAA6C36DA6D40B5BDFE6546F5099A04F5E870B085131091` |

```powershell
Get-FileHash .\simulated-paste-typer-v1.1.1.zip -Algorithm SHA256
```

## English

**Simulated Paste Typer v1.1.1** — types the current clipboard text at the caret with trusted keyboard events; works on any http(s) page and local HTML files.

Fixed: the background service worker could fail to start on Edge when the optional `debugger` permission was not granted (`chrome.debugger` is `undefined` then, and accessing `chrome.debugger.onDetach` threw). The background now guards all optional-API access, the popup detects whether the content script is injected, and permission granting routes through the options page.

Verified end-to-end on real Edge (Chromium 156) for both DOM insertion and trusted CDP keyboard typing.
