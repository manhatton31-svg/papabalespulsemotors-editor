$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "assets\icon.png"
$publicPng = Join-Path $root "public\assets\icon.png"

if (Test-Path $src) {
    Add-Type -AssemblyName System.Drawing
    $img = [System.Drawing.Image]::FromFile($src)
    $img.Save($publicPng, [System.Drawing.Imaging.ImageFormat]::Png)
    $img.Dispose()
    Write-Host "Saved valid PNG: $publicPng"
}