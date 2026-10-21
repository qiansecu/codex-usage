$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'startup-helpers.psm1') -Force
Import-Module (Join-Path $PSScriptRoot '..\launcher\shortcut-helpers.psm1') -Force
$usageProject = Split-Path -Parent $PSScriptRoot
$usageFixtureBase = Join-Path $PSScriptRoot 'runtime-startup-tests'
$usageFixture = Join-Path $usageFixtureBase ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $usageFixture -Force | Out-Null
$usageChecks = 0
function Assert-Startup([bool]$Condition, [string]$Name) {
    if (-not $Condition) { throw $Name }
    $script:usageChecks++
}
function Set-FixtureStatus($Status) {
    $Status | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $usageFixture 'status.json') -Encoding UTF8
}
try {
    Assert-Startup ((Get-UsageLaunchOptions -AppRoot $usageFixture).Count -eq 0) 'clean install has no private launch settings'
    Save-UsageLaunchOptions -AppRoot $usageFixture -NodeExecutable 'D:\Tools\node.exe' -PythonExecutable 'D:\Tools\python.exe' -CodexHome 'D:\Work Data\codex'
    $usageOptions = Get-UsageLaunchOptions -AppRoot $usageFixture
    Assert-Startup ($usageOptions.Count -eq 3 -and $usageOptions.codexHome -eq 'D:\Work Data\codex') 'local launch paths round trip without user configuration copies'
    $usageRaw = Get-Content -LiteralPath (Join-Path $usageFixture 'settings.local.json') -Raw | ConvertFrom-Json
    $usageRaw | Add-Member -NotePropertyName ignoredPrivateField -NotePropertyValue 'synthetic'
    $usageRaw | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $usageFixture 'settings.local.json') -Encoding UTF8
    Assert-Startup ((Get-UsageLaunchOptions -AppRoot $usageFixture).Count -eq 3) 'unknown private configuration fields are not imported'
    $usageAt = [DateTimeOffset]::UtcNow
    Set-FixtureStatus @{at=$usageAt.AddSeconds(-60).ToString('o');stage='usage-status';state='updated'}
    $usageRejected = $false
    try { Wait-UsageReady -RuntimeDirectory $usageFixture -StartedAt $usageAt -TimeoutMilliseconds 0 } catch { $usageRejected = $true }
    Assert-Startup $usageRejected 'stale previous launch does not count as a successful start'
    Assert-Startup (-not (Test-Path -LiteralPath (Join-Path $usageFixture 'desktop'))) 'no shortcuts created before current startup confirmation'
    Set-FixtureStatus @{at=$usageAt.ToString('o');stage='error';error='synthetic startup failure'}
    $usageRejected = $false
    try { Wait-UsageReady -RuntimeDirectory $usageFixture -StartedAt $usageAt -TimeoutMilliseconds 0 } catch { $usageRejected = $_.Exception.Message.Contains('synthetic startup failure') }
    Assert-Startup $usageRejected 'current injection failure is reported without installing shortcuts'
    Set-FixtureStatus @{at=$usageAt.ToString('o');stage='usage-status';state='updated'}
    Wait-UsageReady -RuntimeDirectory $usageFixture -StartedAt $usageAt -TimeoutMilliseconds 0
    Assert-Startup $true 'current ready snapshot permits shortcut installation'
    Install-UsageShortcuts -ProjectRoot $usageProject -TestRoot $usageFixture
    foreach ($usageName in @('desktop','menu')) {
        $usageLink = Join-Path $usageFixture ($usageName + '\ChatGPT（统计）.lnk')
        Assert-Startup (Test-Path -LiteralPath $usageLink) "$usageName receives an independent statistics shortcut"
        Assert-Startup ((Read-UsageShortcut -Path $usageLink).TargetPath -eq (Join-Path $usageProject 'launcher\ChatGPT-Usage.exe')) "$usageName shortcut uses this project launcher"
    }
    Install-UsageShortcuts -ProjectRoot $usageProject -TestRoot $usageFixture
    $usageRecords = @(Get-Content -LiteralPath (Join-Path $usageFixture 'state\entries.json') -Raw | ConvertFrom-Json)
    Assert-Startup ($usageRecords.Count -eq 2) 'automatic setup is idempotent and keeps exactly two recovery records'
    Write-Host "$usageChecks startup flow checks passed; only synthetic desktop/menu directories were used."
} finally {
    $usageResolved = [IO.Path]::GetFullPath($usageFixture)
    $usageBoundary = [IO.Path]::GetFullPath($usageFixtureBase).TrimEnd('\') + '\'
    if (-not $usageResolved.StartsWith($usageBoundary,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected startup fixture directory.' }
    Remove-Item -LiteralPath $usageResolved -Recurse -Force
}
exit 0
