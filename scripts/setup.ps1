param([switch]$Shortcuts, [switch]$PrepareOnly, [string]$CodexHome)
$ErrorActionPreference = 'Stop'
$usageProject = Split-Path -Parent $PSScriptRoot
& (Join-Path $usageProject 'app\build-ui.ps1')
try { & (Join-Path $usageProject 'scripts\build-launcher.ps1') } catch {
    Write-Warning 'Quiet launcher compilation unavailable; installation can use the PowerShell statistics entry.'
}
if ($Shortcuts) {
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $usageProject 'launcher\set-start-entry.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Shortcut setup failed.' }
}
Write-Host 'Installation files are ready. No Windows login startup entry was added.'
if ($PrepareOnly) {
    Write-Host 'Preparation only: no restart prompt, no client started or closed.'
    return
}
if (-not [Environment]::UserInteractive) {
    Write-Host 'No interactive desktop is available. Installation is prepared; run start.cmd when ready.'
    return
}
Import-Module (Join-Path $PSScriptRoot 'install-helpers.psm1') -Force
$usageInstallStage = 'preflight'
try {
    $usagePlan = New-UsageInstallPlan -ProjectRoot $usageProject -CodexHome $CodexHome
    $usageInstallStage = 'confirmation-and-restart'
    $usageResult = Invoke-UsageInstallHandoff -Plan $usagePlan
} catch {
    $usageInstallError = $_
    try {
        $usageErrorDirectory = Join-Path $usageProject 'app\runtime-installed'
        New-Item -ItemType Directory -Path $usageErrorDirectory -Force | Out-Null
        [ordered]@{at=[DateTimeOffset]::UtcNow.ToString('o');stage=$usageInstallStage;error=$usageInstallError.Exception.Message;location=$usageInstallError.InvocationInfo.PositionMessage} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $usageErrorDirectory 'install-error.json') -Encoding utf8
    } catch { Write-Warning 'The installation error could not be saved; keep the terminal error for review.' }
    throw $usageInstallError
}
if ($usageResult.state -eq 'deferred') {
    Write-Host 'Restart postponed. Your current client was left open; run start.cmd when ready.'
} else {
    Write-Host 'Statistics launcher started. Startup status is recorded under app/runtime-installed.'
}
