@echo off
setlocal
cd /d "C:\Users\mphat\papa-bales-pulse-editor"
set "PATH=C:\Users\mphat\.cargo\bin;C:\Program Files\nodejs;%PATH%"
set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;%PATH%"
if not exist "C:\Users\mphat\.cargo\bin\rustc.exe" (
  echo Rust is not installed or incomplete.
  echo Run: winget install Rustlang.Rustup
  echo Then run: rustup default stable
  pause
  exit /b 1
)
echo Starting Papa Bales Pulse Motors Editor...
"C:\Program Files\nodejs\npm.cmd" run tauri dev
if errorlevel 1 (
  echo.
  echo Launch failed. Open PowerShell in the project folder and run: npm run tauri dev
  pause
)
