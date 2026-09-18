@echo off
rem 离线启动「假设与证据验证工作台」：直接用默认浏览器打开本地界面，无需联网、无需安装。
setlocal
set "DIR=%~dp0"
start "" "%DIR%index.html"
echo 已在默认浏览器打开工作台。若浏览器拦截本地脚本，也可将 index.html 直接拖入 Chrome/Edge。
echo 验收自检：运行  node tests.js
endlocal
