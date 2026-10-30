param([string]$CodexHome)
$ErrorActionPreference = 'Stop'
$usageProject = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'update-helpers.psm1') -Force
$usageUpdate = @{state='deferred'}
# Source is only replaced before launch, with neither the app nor its recorded injector running.
$usageBusy = @(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue).Count -gt 0
$usageInjectorRecord = Join-Path $usageProject 'app/runtime-installed/injector-session.json'
if (Test-Path -LiteralPath $usageInjectorRecord) {
    try {
        $usageSaved = Get-Content -LiteralPath $usageInjectorRecord -Raw | ConvertFrom-Json
        if (Get-Process -Id $usageSaved.identity.pid -ErrorAction SilentlyContinue) { $usageBusy = $true }
    } catch { $usageBusy = $true }
}
if (-not $usageBusy) { $usageUpdate = Invoke-UsageAutoUpdate -ProjectRoot $usageProject }
try {
    & (Join-Path $usageProject 'app/start-installed.ps1') -CodexHome $CodexHome
} catch {
    if ($usageUpdate.state -eq 'updated') {
        Restore-UsageUpdate -ProjectRoot $usageProject
        Write-Warning 'The update was rolled back after startup failed. Save your work, fully exit the client, then use the statistics entry again.'
    }
    throw
}
