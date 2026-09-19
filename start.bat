@echo off
cd /d "%~dp0"
start "Production Chain Workbench" /min cmd /c "node serve.js"
timeout /t 1 /nobreak >nul
start "" "http://localhost:5173"
