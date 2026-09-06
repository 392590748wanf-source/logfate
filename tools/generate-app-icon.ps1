Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$svgPath = Join-Path $root 'assets\gil.svg'
$iconPath = Join-Path $root 'build\icon.ico'
[xml]$svg = Get-Content -LiteralPath $svgPath -Raw
$pathData = [string]$svg.svg.path.d
if ([string]::IsNullOrWhiteSpace($pathData)) { throw 'Gil.svg has no renderable path.' }

$images = @()
foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 128, 256)) {
  $pngPath = [System.IO.Path]::GetTempFileName()
  $temporaryIconPath = Join-Path ([System.IO.Path]::GetTempPath()) "gilfate-icon-$size-$([Guid]::NewGuid().ToString('N')).ico"
  try {
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

    $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new($size, $size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($visual)
    $encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $pngStream = [System.IO.File]::Open($pngPath, [System.IO.FileMode]::Create)
    try { $encoder.Save($pngStream) } finally { $pngStream.Dispose() }

    $source = [System.Drawing.Bitmap]::new($pngPath)
    try {
      $icon = [System.Drawing.Icon]::FromHandle($source.GetHicon())
      try {
        $iconStream = [System.IO.File]::Open($temporaryIconPath, [System.IO.FileMode]::Create)
        try { $icon.Save($iconStream) } finally { $iconStream.Dispose() }
      } finally { $icon.Dispose() }
    } finally { $source.Dispose() }

    $raw = [System.IO.File]::ReadAllBytes($temporaryIconPath)
    if ($raw.Length -lt 22) { throw "Generated $size px icon layer is missing." }
    $length = [BitConverter]::ToInt32($raw, 14)
    $offset = [BitConverter]::ToInt32($raw, 18)
    if ($length -le 0 -or $offset -lt 22 -or ($offset + $length) -gt $raw.Length) { throw "Generated $size px icon layer is invalid." }
    $directory = [byte[]]::new(8)
    [Array]::Copy($raw, 6, $directory, 0, 8)
    $data = [byte[]]::new($length)
    [Array]::Copy($raw, $offset, $data, 0, $length)
    $images += [pscustomobject]@{ Directory = $directory; Data = $data }
  } finally {
    Remove-Item -LiteralPath $pngPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temporaryIconPath -Force -ErrorAction SilentlyContinue
  }
}

$stream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($stream)
try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$images.Count)
  $offset = 6 + (16 * $images.Count)
  foreach ($image in $images) {
    $writer.Write([byte[]]$image.Directory)
    $writer.Write([UInt32]$image.Data.Length)
    $writer.Write([UInt32]$offset)
    $offset += $image.Data.Length
  }
  foreach ($image in $images) { $writer.Write([byte[]]$image.Data) }
  [System.IO.File]::WriteAllBytes($iconPath, $stream.ToArray())
} finally {
  $writer.Dispose()
  $stream.Dispose()
}

Write-Output "Generated multi-size client icon: $iconPath"
