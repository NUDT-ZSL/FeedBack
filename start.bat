@echo off
cd /d %~dp0
start "" http://127.0.0.1:8017/
python server.py 8017
