@echo off
cd /d %~dp0
start "" http://127.0.0.1:8000
python server.py 8000
pause
