@echo off
pwsh.exe -NoProfile -File "%~dp0reload-statistics.ps1" %*
if errorlevel 1 pause
