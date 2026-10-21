$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'installed-helpers.psm1') -Force
$taskRuntime = Join-Path $PSScriptRoot 'runtime-installed'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
Set-Content -LiteralPath (Join-Path $taskRuntime 'stop') -Value 'stop' -Encoding ASCII
$taskInjectorFile = Join-Path $taskRuntime 'injector-session.json'
if (Test-Path -LiteralPath $taskInjectorFile) {
    $taskInjectorRecord = Get-Content -LiteralPath $taskInjectorFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $taskInjectorCurrent = Get-InstalledProcessIdentity -ProcessId $taskInjectorRecord.identity.pid
    if (Test-SameInstalledProcess -Saved $taskInjectorRecord.identity -Current $taskInjectorCurrent) {
        $taskInjector = Get-Process -Id $taskInjectorRecord.identity.pid -ErrorAction Stop
        if (-not $taskInjector.WaitForExit(12000)) { throw 'Injector did not stop. Installed client was left open; fully close it manually.' }
    }
}
$taskSessionFile = Join-Path $taskRuntime 'session.json'
$taskPortInspection = 'no-session'
$taskDebugListeners = $null
if (Test-Path -LiteralPath $taskSessionFile) {
    $taskSession = Get-Content -LiteralPath $taskSessionFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($taskName in @('ownerIdentity','launchIdentity')) {
        if ($taskSession.PSObject.Properties[$taskName]) {
            Stop-RecordedInstalledProcess -Identity $taskSession.$taskName
        }
    }
    try {
        $taskDebugListeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq $taskSession.port }).Count
        $taskPortInspection = 'queried'
    } catch {
        $taskPortInspection = 'unavailable:' + $_.Exception.GetType().Name
        $taskDebugListeners = $null
    }
}
[ordered]@{at=[DateTimeOffset]::UtcNow.ToString('o');stage='restore-complete';portInspection=$taskPortInspection;debugListeners=$taskDebugListeners} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRuntime 'restore-status.json') -Encoding UTF8
Write-Host 'Recorded debug instance closed. Open the installed app normally to return to its standard appearance.'
