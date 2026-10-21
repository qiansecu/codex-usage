@echo off
pwsh.exe -NoProfile -File "%~dp0set-start-entry.ps1"
if errorlevel 1 pause
