$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$IconIco = Join-Path $ProjectRoot "build\icon.ico"
$IconTauri = Join-Path $ProjectRoot "src-tauri\icons\icon.ico"
$LauncherBat = Join-Path $ProjectRoot "launch-editor.bat"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "Papa Bales Pulse Editor.lnk"

Write-Host "Building desktop icon..."
Set-Location $ProjectRoot
node scripts/build-icon.mjs
if ($LASTEXITCODE -ne 0) { throw "Icon build failed. Run: npm run fix:icon" }

$iconFile = if ((Test-Path $IconIco) -and (Get-Item $IconIco).Length -gt 1000) {
    $IconIco
} elseif ((Test-Path $IconTauri) -and (Get-Item $IconTauri).Length -gt 1000) {
    $IconTauri
} else {
    throw "No valid icon.ico found. Run: npm run fix:icon"
}

$NodeDir = ${env:ProgramFiles} + "\nodejs"
$CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$npmCmd = Join-Path $NodeDir "npm.cmd"

if (-not (Test-Path $npmCmd)) {
    throw "Node.js not found at $npmCmd. Install Node from https://nodejs.org"
}

# Locate MSVC linker for Rust/Tauri (not always on user PATH)
$MsvcBin = $null
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($vsPath) {
        $link = Get-ChildItem (Join-Path $vsPath "VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe") -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($link) { $MsvcBin = $link.Directory.FullName }
    }
}
if (-not $MsvcBin) {
    $fallback = Get-ChildItem "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\link.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($fallback) { $MsvcBin = $fallback.Directory.FullName }
}

$msvcPathLine = if ($MsvcBin) { "set `"PATH=$MsvcBin;%PATH%`"" } else { "REM MSVC not found - install VS Build Tools if build fails" }

$batContent = @"
@echo off
setlocal
cd /d "$ProjectRoot"
set "PATH=$CargoBin;$NodeDir;%PATH%"
$msvcPathLine
if not exist "$CargoBin\rustc.exe" (
  echo Rust is not installed or incomplete.
  echo Run: winget install Rustlang.Rustup
  echo Then run: rustup default stable
  pause
  exit /b 1
)
echo Starting Papa Bales Pulse Motors Editor...
"$npmCmd" run tauri dev
if errorlevel 1 (
  echo.
  echo Launch failed. Open PowerShell in the project folder and run: npm run tauri dev
  pause
)
"@

Set-Content -Path $LauncherBat -Value $batContent -Encoding ASCII

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $LauncherBat
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.IconLocation = "$iconFile,0"
$Shortcut.Description = "Papa Bales Pulse Motors Editor"
$Shortcut.Save()

Write-Host ""
Write-Host "Desktop shortcut created:"
Write-Host "  $ShortcutPath"
Write-Host "  Icon: $iconFile"
if ($MsvcBin) { Write-Host "  MSVC: $MsvcBin" }
Write-Host ""
Write-Host "Double-click 'Papa Bales Pulse Editor' on your desktop to launch."