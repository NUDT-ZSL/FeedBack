@echo off
cd /d %~dp0
if not exist data\sample.ply python scripts\make_sample.py
start "" http://127.0.0.1:8791/
python server\app.py --port 8791
