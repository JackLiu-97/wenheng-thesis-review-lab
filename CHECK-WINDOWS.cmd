@echo off
setlocal
cd /d "%~dp0"
"runtime\node\node.exe" "scripts\portable-launch.mjs" --check
pause
