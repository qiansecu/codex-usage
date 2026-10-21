$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'runtime-helpers.psm1') -Force
$taskNode = Resolve-UsageRuntime -Kind Node
$taskPython = Resolve-UsageRuntime -Kind Python
Push-Location -LiteralPath $PSScriptRoot
try {
    Write-Host 'JavaScript syntax and controller/data-binding checks'
    & $taskNode build-ui.mjs --check
    if ($LASTEXITCODE -ne 0) { throw 'Generated UI payload is out of date.' }
    & $taskNode --check footer-page.js
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax check failed.' }
    & $taskNode --test test-data-binding.mjs test-footer-page.mjs test-header.mjs test-injector.mjs test-runtime-routing.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Node checks failed.' }
    Write-Host 'Python session backend checks'
    & $taskPython -B -m unittest -v test_usage_backend.py
    if ($LASTEXITCODE -ne 0) { throw 'Python checks failed.' }
    Write-Host 'PowerShell parsing, activation compilation and process identity checks'
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'check-installed.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Installed launcher checks failed.' }
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'test-runtime-helpers.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Runtime resolver checks failed.' }
    Write-Host 'All local checks passed. No client was started or closed; default shortcuts were not changed.'
} finally {
    Pop-Location
}
