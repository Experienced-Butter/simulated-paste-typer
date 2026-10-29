<#
.SYNOPSIS
    生成扩展图标（16 / 32 / 48 / 128 像素 PNG）。

.DESCRIPTION
    纯离线绘制：圆角渐变底 + “剪贴板 + 向下箭头”图形（表示“把内容写入光标处”）。
    不依赖任何外部资源，方便在 GitHub 上复现（scripts/make-icons.ps1）。

    用法：
        pwsh ./scripts/make-icons.ps1
        pwsh ./scripts/make-icons.ps1 -OutDir ./extension/icons
#>
param(
    [string]$OutDir = (Join-Path $PSScriptRoot '..\extension\icons')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath {
    param(
        [System.Drawing.RectangleF]$Rect,
        [single]$Radius
    )
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = [single]($Radius * 2)
    $path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
    $path.AddArc([single]($Rect.Right - $diameter), $Rect.Y, $diameter, $diameter, 270, 90)
    $path.AddArc([single]($Rect.Right - $diameter), [single]($Rect.Bottom - $diameter), $diameter, $diameter, 0, 90)
    $path.AddArc($Rect.X, [single]($Rect.Bottom - $diameter), $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$sizes = @(16, 32, 48, 128)

foreach ($size in $sizes) {
    $s = [single]$size
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # ---- 背景：圆角矩形渐变 ----
    $inset = [single][Math]::Max(0.4, $s * 0.02)
    $radius = [single]($s * 0.24)
    $rect = New-Object System.Drawing.RectangleF($inset, $inset, [single]($s - 2 * $inset), [single]($s - 2 * $inset))
    $bgPath = New-RoundedRectPath -Rect $rect -Radius $radius

    $startPoint = New-Object System.Drawing.PointF(0, 0)
    $endPoint = New-Object System.Drawing.PointF($s, $s)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $startPoint,
        $endPoint,
        [System.Drawing.Color]::FromArgb(255, 59, 130, 246),
        [System.Drawing.Color]::FromArgb(255, 139, 92, 246)
    )
    $g.FillPath($brush, $bgPath)

    # ---- 前景：白色“剪贴板 + 向下箭头” ----
    $penWidth = [single][Math]::Max(1.0, $s * 0.085)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $penWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    # 剪贴板主体
    $body = New-Object System.Drawing.RectangleF(
        [single]($s * 0.30),
        [single]($s * 0.20),
        [single]($s * 0.40),
        [single]($s * 0.46)
    )
    $bodyPath = New-RoundedRectPath -Rect $body -Radius ([single]($s * 0.07))
    $g.DrawPath($pen, $bodyPath)

    # 剪贴板顶部的“夹子”
    $clip = New-Object System.Drawing.RectangleF(
        [single]($s * 0.40),
        [single]($s * 0.11),
        [single]($s * 0.20),
        [single]($s * 0.15)
    )
    $clipPath = New-RoundedRectPath -Rect $clip -Radius ([single]($s * 0.05))
    $g.FillPath([System.Drawing.Brushes]::White, $clipPath)

    # 内部两条“文本行”（小尺寸不画，避免糊成一团）
    if ($size -ge 32) {
        $innerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [single][Math]::Max(1.0, $s * 0.055))
        $innerPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $innerPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $g.DrawLine($innerPen, [single]($s * 0.37), [single]($s * 0.34), [single]($s * 0.63), [single]($s * 0.34))
        $g.DrawLine($innerPen, [single]($s * 0.37), [single]($s * 0.45), [single]($s * 0.55), [single]($s * 0.45))
        $innerPen.Dispose()
    }

    # 向下箭头：竖线 + 箭头两翼
    $g.DrawLine($pen, [single]($s * 0.50), [single]($s * 0.70), [single]($s * 0.50), [single]($s * 0.90))
    $g.DrawLine($pen, [single]($s * 0.385), [single]($s * 0.795), [single]($s * 0.50), [single]($s * 0.90))
    $g.DrawLine($pen, [single]($s * 0.615), [single]($s * 0.795), [single]($s * 0.50), [single]($s * 0.90))

    $outPath = Join-Path $OutDir ("icon{0}.png" -f $size)
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $pen.Dispose()
    $brush.Dispose()
    $bgPath.Dispose()
    $bodyPath.Dispose()
    $clipPath.Dispose()
    $g.Dispose()
    $bmp.Dispose()

    Write-Host ("[icons] {0} ({1}x{1})" -f $outPath, $size)
}

Write-Host '图标生成完成。'
