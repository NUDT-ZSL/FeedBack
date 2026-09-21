@echo off
setlocal
cd /d "%~dp0"
echo.
echo 区域仓网调拨工作台正在启动...
echo 浏览器地址: http://127.0.0.1:8765/index.html
echo 按 Ctrl+C 可停止本地服务。
echo.
start "" "http://127.0.0.1:8765/index.html"
python -m http.server 8765
