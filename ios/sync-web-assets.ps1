# Sync the web app (index.html, piexif.js) from the project root into the iOS www folder.
# Run from the "ios" folder:  .\sync-web-assets.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$www  = Join-Path $PSScriptRoot "QR-RTU-Audit\www"
New-Item -ItemType Directory -Force -Path $www | Out-Null
Copy-Item (Join-Path $root "index.html") (Join-Path $www "index.html") -Force
Copy-Item (Join-Path $root "piexif.js")  (Join-Path $www "piexif.js")  -Force
Write-Host "Synced web assets into $www"
Get-ChildItem $www | Format-Table Name, Length
