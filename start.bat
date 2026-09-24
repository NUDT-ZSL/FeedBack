@echo off
rem 离线启动：优先用 Python 起本地静态服务，否则直接打开文件
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8000/
  python -m http.server 8000
) else (
  start "" "%~dp0index.html"
)
