@echo off
pwsh.exe -NoProfile -File "%~dp0setup.ps1" %*
if errorlevel 1 pause
