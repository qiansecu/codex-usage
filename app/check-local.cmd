@echo off
pwsh.exe -NoProfile -File "%~dp0check-local.ps1" %*
if errorlevel 1 pause
