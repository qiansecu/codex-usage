param([switch]$Shortcuts)
$ErrorActionPreference = 'Stop'
$usageProject = Split-Path -Parent $PSScriptRoot
& (Join-Path $usageProject 'app\build-ui.ps1')
& (Join-Path $usageProject 'scripts\build-launcher.ps1')
if ($Shortcuts) {
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $usageProject 'launcher\set-start-entry.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Shortcut setup failed.' }
}
Write-Host 'Ready. Fully exit the regular client, then run start.cmd.'
Write-Host 'No Windows login startup entry was added.'
