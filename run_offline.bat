@echo off
setlocal
cd /d "%~dp0"
python main.py
if errorlevel 1 (
  echo.
  echo Failed to start. Ensure Python with Tkinter is installed.
  pause
)
