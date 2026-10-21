@echo off
pwsh.exe -NoProfile -File "%~dp0start-installed.ps1" %*
if errorlevel 1 pause
