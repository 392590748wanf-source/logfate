Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$svgPath = Join-Path $root 'assets\gil.svg'
$iconPath = Join-Path $root 'build\icon.ico'
$pngPath = [System.IO.Path]::GetTempFileName()

[xml]$svg = Get-Content -LiteralPath $svgPath -Raw
$pathData = [string]$svg.svg.path.d
if ([string]::IsNullOrWhiteSpace($pathData)) { throw 'Gil.svg has no renderable path.' }

$size = 256.0
$visual = [System.Windows.Media.DrawingVisual]::new()
$context = $visual.RenderOpen()
$cornerRadius = $size * 0.18
$context.DrawRoundedRectangle(
  [System.Windows.Media.Brushes]::White,
  $null,
  [System.Windows.Rect]::new(0, 0, $size, $size),
  $cornerRadius,
  $cornerRadius
)
$context.PushTransform([System.Windows.Media.ScaleTransform]::new($size / 1000, $size / 1000))
$context.DrawGeometry([System.Windows.Media.Brushes]::Black, $null, [System.Windows.Media.Geometry]::Parse($pathData))
$context.Pop()
$context.Close()

$bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new([int]$size, [int]$size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
$bitmap.Render($visual)
$encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
$encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
$pngStream = [System.IO.File]::Open($pngPath, [System.IO.FileMode]::Create)
try { $encoder.Save($pngStream) } finally { $pngStream.Dispose() }

$source = [System.Drawing.Bitmap]::new($pngPath)
$handle = $source.GetHicon()
try {
  $icon = [System.Drawing.Icon]::FromHandle($handle)
  $iconStream = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create)
  try { $icon.Save($iconStream) } finally { $iconStream.Dispose(); $icon.Dispose() }
} finally {
  $source.Dispose()
  Remove-Item -LiteralPath $pngPath -Force -ErrorAction SilentlyContinue
}

Write-Output "Generated client icon: $iconPath"
