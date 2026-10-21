$ErrorActionPreference = 'Stop'
$taskChecks = @()
foreach ($taskName in @('start-installed.ps1','restore-installed.ps1','reload-statistics.ps1','installed-helpers.psm1','check-installed.ps1','runtime-helpers.psm1','test-runtime-helpers.ps1','build-ui.ps1','startup-helpers.psm1','test-startup-helpers.ps1')) {
    $taskTokens = $null; $taskErrors = $null
    [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $taskName),[ref]$taskTokens,[ref]$taskErrors) | Out-Null
    if ($taskErrors.Count) { throw ($taskName + ': ' + ($taskErrors.Message -join ', ')) }
    $taskChecks += 'parse:' + $taskName
}
Add-Type -LiteralPath (Join-Path $PSScriptRoot 'store-activation.cs')
$taskChecks += 'activation C# compiled; activation not invoked'
Import-Module (Join-Path $PSScriptRoot 'installed-helpers.psm1') -Force
function Assert-InstalledCheck {
    param([bool]$Actual,[bool]$Expected,[string]$Name)
    if ($Actual -ne $Expected) { throw ('Check failed: ' + $Name) }
    $script:taskChecks += $Name
}
$taskPackagePath = 'C:\Program Files\WindowsApps\OpenAI.Codex_test'
$taskAllowedPaths = @($taskPackagePath + '\app\ChatGPT.exe')
Assert-InstalledCheck (Test-InstalledExecutable $taskAllowedPaths[0] $taskPackagePath $taskAllowedPaths) $true 'registered executable accepted'
Assert-InstalledCheck (Test-InstalledExecutable $taskAllowedPaths[0].ToUpperInvariant() $taskPackagePath $taskAllowedPaths) $true 'path comparison ignores case'
Assert-InstalledCheck (Test-InstalledExecutable ($taskPackagePath + '-other\app\ChatGPT.exe') $taskPackagePath $taskAllowedPaths) $false 'similar package prefix rejected'
Assert-InstalledCheck (Test-InstalledExecutable 'C:\lab\ChatGPT.exe' $taskPackagePath $taskAllowedPaths) $false 'experiment copy rejected'
Assert-InstalledCheck (Test-InstalledExecutable ($taskPackagePath + '\app\unknown.exe') $taskPackagePath $taskAllowedPaths) $false 'unlisted package executable rejected'
$taskSaved = @{pid=100;executable=$taskAllowedPaths[0];startTimeUtc='2026-10-14T00:00:00Z'}
Assert-InstalledCheck (Test-SameInstalledProcess $taskSaved @{pid=100;executable=$taskAllowedPaths[0];startTimeUtc='2026-10-14T00:00:00Z'}) $true 'same process identity accepted'
Assert-InstalledCheck (Test-SameInstalledProcess $taskSaved @{pid=100;executable=$taskAllowedPaths[0];startTimeUtc='2026-10-15T00:00:00Z'}) $false 'reused PID rejected'
Assert-InstalledCheck (Test-SameInstalledProcess $taskSaved @{pid=100;executable='C:\other\node.exe';startTimeUtc='2026-10-14T00:00:00Z'}) $false 'changed executable rejected'
Assert-InstalledCheck (Test-SameInstalledProcess $taskSaved $null) $false 'already exited process rejected'
$taskExactIso = '2026-10-14T18:02:22.2759347Z'
$taskExact = @{pid=100;executable=$taskAllowedPaths[0];startTimeUtc=$taskExactIso}
$taskJsonRoundTrip = $taskExact | ConvertTo-Json | ConvertFrom-Json
Assert-InstalledCheck (Test-SameInstalledProcess $taskJsonRoundTrip $taskExact) $true 'real JSON round-trip date object matches exact ISO creation time'
Assert-InstalledCheck (Test-SameInstalledProcess $taskExact $taskJsonRoundTrip) $true 'date object and string match in either argument order'
Assert-InstalledCheck (Test-SameInstalledProcess $taskJsonRoundTrip @{pid=100;executable=$taskAllowedPaths[0];startTimeUtc='2026-10-15T02:02:22.2759347+08:00'}) $true 'equivalent timezone offset matches the same UTC instant'
Assert-InstalledCheck (Test-SameInstalledProcess $taskJsonRoundTrip @{pid=100;executable=$taskAllowedPaths[0];startTimeUtc='2026-10-14T18:02:22.2759348Z'}) $false 'one tick difference is rejected without time tolerance'
Assert-InstalledCheck (Test-SameInstalledProcess $taskJsonRoundTrip @{pid=100;executable=$taskAllowedPaths[0];startTimeUtc='invalid'}) $false 'malformed creation time rejected'
Assert-InstalledCheck (Test-SameInstalledProcess $taskJsonRoundTrip @{pid=100;executable=$taskAllowedPaths[0];startTimeUtc=[DateTime]::SpecifyKind([DateTime]::Parse('2026-10-14T18:02:22.2759347'),[DateTimeKind]::Unspecified)}) $false 'ambiguous creation time without timezone rejected'
$taskResult = [ordered]@{checkedAt=[DateTimeOffset]::UtcNow.ToString('o');passed=$taskChecks.Count;failed=0;checks=$taskChecks;desktopLaunch='not invoked'}
$taskRuntime = Join-Path $PSScriptRoot 'runtime-installed'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
$taskResult | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskRuntime 'local-checks.json') -Encoding UTF8
$taskResult | ConvertTo-Json -Depth 5
