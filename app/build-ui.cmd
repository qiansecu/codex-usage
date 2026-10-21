@echo off
pwsh.exe -NoProfile -File "%~dp0build-ui.ps1" %*
if errorlevel 1 pause
