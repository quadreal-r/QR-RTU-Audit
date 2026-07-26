$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$www = Join-Path $PSScriptRoot "app\src\main\assets\www"
New-Item -ItemType Directory -Force -Path $www | Out-Null
Copy-Item (Join-Path $root "index.html") (Join-Path $www "index.html") -Force
Copy-Item (Join-Path $root "piexif.js") (Join-Path $www "piexif.js") -Force
Write-Host "Synced web assets into $www"
Get-ChildItem $www | Format-Table Name, Length
