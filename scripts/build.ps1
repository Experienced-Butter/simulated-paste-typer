<#
.SYNOPSIS
    构建并打包“超星粘贴助手”扩展。

.DESCRIPTION
    输出到 dist/：
      dist/chaoxing-paste-typer-v<版本>/      ← 可直接在 Edge/Chrome 里“加载解压缩的扩展”
      dist/chaoxing-paste-typer-v<版本>.zip   ← 可直接用于 Edge 加载项商店上传（zip 根目录含 manifest.json）
      dist/SHA256SUMS.txt                     ← 压缩包校验值（发布时附在 GitHub Release 里）

    构建时会先做基础校验：
      - manifest.json 能否解析、版本号格式是否正确；
      - manifest 里引用的图标 / 脚本 / 页面文件是否存在；
      - 如果本机装有 Node.js，会用 node --check 检查所有 JS 语法。

    用法：
      pwsh ./scripts/build.ps1
      pwsh ./scripts/build.ps1 -Version 1.0.1   # 临时用另一个版本号出包（不修改 manifest）
#>
param(
    [string]$Version = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$extDir = Join-Path $root 'extension'
$distDir = Join-Path $root 'dist'

Write-Host '== 超星粘贴助手 · 构建开始 ==' -ForegroundColor Cyan

# ---------- 1. 解析并校验 manifest ----------
$manifestPath = Join-Path $extDir 'manifest.json'
if (-not (Test-Path $manifestPath)) { throw "找不到 $manifestPath" }

$manifestText = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8)
$manifest = $manifestText | ConvertFrom-Json

$pkgVersion = if ($Version) { $Version } else { [string]$manifest.version }
if ($pkgVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "版本号格式不正确：$pkgVersion（需要形如 1.2.3）"
}

Write-Host ("[manifest] {0} v{1}（manifest_version={2}）" -f $manifest.name, $manifest.version, $manifest.manifest_version)

# ---------- 2. 校验 manifest 引用的文件 ----------
$required = New-Object System.Collections.Generic.List[string]
foreach ($k in @('16', '32', '48', '128')) {
    if ($manifest.icons -and $manifest.icons.$k) { $required.Add([string]$manifest.icons.$k) }
}
if ($manifest.action -and $manifest.action.default_popup) { $required.Add([string]$manifest.action.default_popup) }
if ($manifest.action -and $manifest.action.default_icon) {
    foreach ($prop in $manifest.action.default_icon.PSObject.Properties) { $required.Add([string]$prop.Value) }
}
if ($manifest.options_ui -and $manifest.options_ui.page) { $required.Add([string]$manifest.options_ui.page) }
if ($manifest.background -and $manifest.background.service_worker) { $required.Add([string]$manifest.background.service_worker) }
if ($manifest.content_scripts) {
    foreach ($cs in $manifest.content_scripts) {
        foreach ($js in $cs.js) { $required.Add([string]$js) }
        if ($cs.css) { foreach ($css in $cs.css) { $required.Add([string]$css) } }
    }
}

$missing = @()
foreach ($rel in $required) {
    $full = Join-Path $extDir $rel
    if (-not (Test-Path $full)) { $missing += $rel }
}
if ($missing.Count -gt 0) { throw ("manifest 引用的文件不存在：`n  " + ($missing -join "`n  ")) }
Write-Host ("[check] manifest 引用的 {0} 个文件均存在" -f ($required | Select-Object -Unique).Count)

# ---------- 3. JS 语法检查（有 node 才做） ----------
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $jsFiles = Get-ChildItem -Path $extDir -Recurse -Filter *.js | Where-Object { $_.FullName -notmatch '\\icons\\' }
    foreach ($js in $jsFiles) {
        $output = & node --check $js.FullName 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw ("JS 语法检查失败：{0}`n{1}" -f $js.FullName, ($output -join "`n"))
        }
        Write-Host ("[check] JS OK  {0}" -f $js.FullName.Substring($extDir.Length + 1))
    }
} else {
    Write-Host '[check] 未找到 node，跳过 JS 语法检查' -ForegroundColor Yellow
}

# ---------- 4. 复制到 dist/<名称>-v<版本> ----------
$pkgName = 'chaoxing-paste-typer'
$stageName = '{0}-v{1}' -f $pkgName, $pkgVersion
$stageDir = Join-Path $distDir $stageName
$zipPath = Join-Path $distDir ('{0}.zip' -f $stageName)

if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Force -Path $distDir | Out-Null }
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
Get-ChildItem -Path $extDir -Force | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $stageDir -Recurse -Force
}
Write-Host ("[stage] 已复制扩展文件 → {0}" -f $stageDir.Substring($root.Length + 1))

# ---------- 5. 生成 ZIP（zip 根目录 = manifest.json 所在目录） ----------
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stageDir,
    $zipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false   # includeBaseDirectory = false ← 商店上传要求的根目录结构
)

# ---------- 6. 校验 ZIP ----------
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entries = $archive.Entries | ForEach-Object { $_.FullName }
    if ($entries -notcontains 'manifest.json') {
        throw '打包失败：zip 根目录没有 manifest.json'
    }
    Write-Host ("[zip] {0}（{1} 个条目）" -f $zipPath.Substring($root.Length + 1), $entries.Count)
} finally {
    $archive.Dispose()
}

# ---------- 7. 校验和 ----------
$hash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash
$hashLine = '{0}  {1}' -f $hash, (Split-Path $zipPath -Leaf)
$hashLine | Set-Content -Path (Join-Path $distDir 'SHA256SUMS.txt') -Encoding ASCII
Write-Host ("[hash] SHA256 = {0}" -f $hash)

Write-Host ''
Write-Host '== 构建完成 ==' -ForegroundColor Green
Write-Host ("  解压目录（开发者模式加载）：{0}" -f $stageDir)
Write-Host ("  商店上传 ZIP：               {0}" -f $zipPath)
Write-Host ("  校验文件：                   {0}" -f (Join-Path $distDir 'SHA256SUMS.txt'))
Write-Host ''
Write-Host '下一步：' -ForegroundColor Cyan
Write-Host '  1) Edge → edge://extensions → 打开“开发人员模式” → “加载解压缩的扩展” → 选择上面的解压目录'
Write-Host '  2) 商店上传时使用上面的 ZIP 文件'
