@echo off
setlocal
cd /d "%~dp0"
python -m web.app --host 127.0.0.1 --port 8000
if errorlevel 1 pause
