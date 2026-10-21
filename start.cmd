@echo off
pwsh.exe -NoProfile -File "%~dp0app\start-installed.ps1" %*
if errorlevel 1 pause
