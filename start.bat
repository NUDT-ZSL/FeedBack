@echo off
rem 本地启动：直接用默认浏览器打开（纯前端，无需服务器）
start "" "%~dp0index.html"
rem 如遇浏览器限制，也可改用本地静态服务：
rem   python -m http.server 8000
rem   然后访问 http://localhost:8000
