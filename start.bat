@echo off
rem 素材渠道适配工作台 - 本地启动
cd /d "%~dp0"
set PORT=8321
echo 启动工作台: http://localhost:%PORT%
start "" "http://localhost:%PORT%"
python -m http.server %PORT% --bind 127.0.0.1
pause
