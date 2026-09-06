Add-Type -AssemblyName PresentationCore

$root = Split-Path -Parent $PSScriptRoot
$svgPath = Join-Path $root 'assets\gil.svg'
$iconPath = Join-Path $root 'build\icon.ico'
[xml]$svg = Get-Content -LiteralPath $svgPath -Raw
$pathData = [string]$svg.svg.path.d
if ([string]::IsNullOrWhiteSpace($pathData)) { throw 'Gil.svg has no renderable path.' }

function New-IconEntry([int]$size) {
  $visual = [System.Windows.Media.DrawingVisual]::new()
  $context = $visual.RenderOpen()
  $cornerRadius = $size * 0.18
  $context.DrawRoundedRectangle([System.Windows.Media.Brushes]::White, $null, [System.Windows.Rect]::new(0, 0, $size, $size), $cornerRadius, $cornerRadius)
  $context.PushTransform([System.Windows.Media.ScaleTransform]::new($size / 1000, $size / 1000))
  $context.DrawGeometry([System.Windows.Media.Brushes]::Black, $null, [System.Windows.Media.Geometry]::Parse($pathData))
  $context.Pop()
  $context.Close()

  $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new($size, $size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
  $bitmap.Render($visual)
  $rowBytes = $size * 4
  $pixels = [byte[]]::new(($size * $rowBytes))
  $bitmap.CopyPixels($pixels, $rowBytes, 0)
  $andStride = [int]([Math]::Ceiling($size / 32.0) * 4)
  $andMask = [byte[]]::new(($andStride * $size))
  for ($y = 0; $y -lt $size; $y++) {
    $sourceY = $size - 1 - $y
    for ($x = 0; $x -lt $size; $x++) {
      $alpha = $pixels[($sourceY * $rowBytes) + ($x * 4) + 3]
      if ($alpha -lt 128) {
        $maskOffset = ($y * $andStride) + [int][Math]::Floor($x / 8)
        $andMask[$maskOffset] = $andMask[$maskOffset] -bor (0x80 -shr ($x % 8))
      }
    }
  }

  $stream = [System.IO.MemoryStream]::new()
  $writer = [System.IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([UInt32]40)
    $writer.Write([Int32]$size)
    $writer.Write([Int32]($size * 2))
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]0)
    $writer.Write([UInt32]0)
    $writer.Write([Int32]0)
    $writer.Write([Int32]0)
    $writer.Write([UInt32]0)
    $writer.Write([UInt32]0)
    for ($y = $size - 1; $y -ge 0; $y--) { $writer.Write($pixels, $y * $rowBytes, $rowBytes) }
    $writer.Write($andMask)
    return [pscustomobject]@{
      Directory = [byte[]]@([byte]$(if ($size -eq 256) { 0 } else { $size }), [byte]$(if ($size -eq 256) { 0 } else { $size }), [byte]0, [byte]0, [byte]1, [byte]0, [byte]32, [byte]0)
      Data = $stream.ToArray()
    }
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

$images = @(16, 20, 24, 32, 40, 48, 64, 128 | ForEach-Object { New-IconEntry $_ })

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
