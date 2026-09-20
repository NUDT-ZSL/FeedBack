@echo off
setlocal
cd /d "%~dp0"
echo Starting offline sampling chain on http://127.0.0.1:8765
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8765/index.html'"
python -m http.server 8765
