# v1.1.0 · 模拟录入粘贴助手（通用网页版）

> 把剪贴板里的最后一条文本，以**模拟键盘输入**的方式写入网页里当前光标处。适用于拦截 Ctrl+V / 右键粘贴的页面。

## 本版更新

- ✅ **解除站点限制**：现在支持**所有 http(s) 网页**以及本地 HTML 文件（`file://`，需在扩展详情页允许“访问文件网址”）；`edge://`、扩展页、开发者工具等浏览器内部页面无法注入。
- 支持页面改为按协议判定，不再绑定特定站点；悬浮按钮、弹窗与后台提示文案同步更新。
- 项目更名为「模拟录入粘贴助手 · Simulated Paste Typer」。
- README / STORE / PRIVACY / CHANGELOG 文档同步；行为测试全部通过。

## 安装

1. 下载本 Release 附件中的 `simulated-paste-typer-v1.1.0.zip` 并解压；
2. 打开 Edge，地址栏输入 `edge://extensions`；
3. 打开 **“开发人员模式”**；
4. 点击 **“加载解压缩的扩展”**，选择解压出的目录（根目录要能看到 `manifest.json`）。

> Chrome 内核相同，`chrome://extensions` 下同样可以加载。
> 首次安装时浏览器会提示“读取并更改你在所有网站上的数据”，这是通用网页扩展的固有权限提示；本扩展没有任何网络请求。

## 使用

任意一种方式触发后，先等待设定时间（默认 3 秒），随后内容会逐字符输入到当前光标处：

1. **页面悬浮按钮**：在目标输入框里点一下让光标出现 → 点右下角圆形按钮；
2. **工具栏弹窗**：点扩展图标 → “读取剪贴板并输入到光标处”；
3. **快捷键**：默认 `Ctrl+Shift+Y`（可在 `edge://extensions/shortcuts` 修改）。

倒计时或输入过程中按 `Esc` 可取消。输入方式（真实键盘模拟 / 兼容输入）、等待时间、字符间隔均可在设置页调整。

## 文件校验

| 文件 | SHA256 |
| --- | --- |
| `simulated-paste-typer-v1.1.0.zip` | `CBFA87F13AC06AE634478C1CBD17978639C6340806EF9E2465E1DBAEFDD35647` |

下载后可用 PowerShell 验证：

```powershell
Get-FileHash .\simulated-paste-typer-v1.1.0.zip -Algorithm SHA256
```

## English

**Simulated Paste Typer v1.1.0** — types the current clipboard text at the caret using trusted keyboard events. Now works on **any http(s) page** and local HTML files (enable "Allow access to file URLs" for `file://`). Browser-internal pages (`edge://`, extension pages, DevTools) are not supported.

Install: unzip and load via `edge://extensions` → Developer mode → *Load unpacked*. Trigger with the floating page button, the toolbar popup, or `Ctrl+Shift+Y` (editable in `edge://extensions/shortcuts`). Press `Esc` to cancel during countdown or typing. No network requests, no data collection.
