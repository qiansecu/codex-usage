@echo off
pwsh.exe -NoProfile -File "%~dp0restore-installed.ps1" %*
if errorlevel 1 pause
