@echo off
pwsh.exe -NoProfile -File "%~dp0set-start-entry.ps1" -Restore
if errorlevel 1 pause
