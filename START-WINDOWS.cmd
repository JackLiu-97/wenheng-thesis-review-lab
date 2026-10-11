@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\node\node.exe" (
  echo Portable runtime not found. Please extract the complete Windows migration ZIP first.
  pause
  exit /b 1
)
"runtime\node\node.exe" "scripts\portable-launch.mjs"
pause
