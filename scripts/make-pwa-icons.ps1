# Generates the PWA icon set from the iOS app icon so the web install uses the same
# artwork as the shells. Chrome needs a 192 and a 512; Android also wants a maskable
# variant, whose content must sit inside the middle 80% or the launcher shape clips it.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'ios\App\App\Assets.xcassets\AppIcon.appiconset\AppIcon-512@2x.png'
$out  = Join-Path $root 'icons'

if (-not (Test-Path $src)) { Write-Error "Source icon not found: $src"; exit 1 }
New-Item -ItemType Directory -Force -Path $out | Out-Null

$source = [System.Drawing.Image]::FromFile($src)

function Save-Icon {
    param([int]$Size, [double]$Scale, [string]$Name)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # The artwork is white-backed, so pad with white rather than leaving transparency.
    $g.Clear([System.Drawing.Color]::White)

    $inner  = [int][Math]::Round($Size * $Scale)
    $offset = [int][Math]::Round(($Size - $inner) / 2)
    $g.DrawImage($source, $offset, $offset, $inner, $inner)

    $path = Join-Path $out $Name
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output ("{0}  {1}x{1}  {2:N0} bytes" -f $Name, $Size, (Get-Item $path).Length)
}

Save-Icon -Size 192 -Scale 1.0  -Name 'icon-192.png'
Save-Icon -Size 512 -Scale 1.0  -Name 'icon-512.png'
# 72% keeps the wordmark clear of a circular or squircle mask.
Save-Icon -Size 512 -Scale 0.72 -Name 'icon-maskable-512.png'

$source.Dispose()
