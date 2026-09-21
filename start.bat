@echo off
rem Offline semantic-tree / reading-order tool launcher (Windows)
cd /d "%~dp0"
python server.py %*
