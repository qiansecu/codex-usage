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
$taskSyntheticStart = [DateTime]::Parse('2026-10-14T18:02:22.2759347Z').ToUniversalTime()
$taskReadState = @{reads=0;pauses=0}
$taskRead = {param($processId) $taskReadState.reads++;[pscustomobject]@{Id=$processId;Path=$(if($taskReadState.reads -gt 1){$taskAllowedPaths[0]}else{$null});StartTime=$taskSyntheticStart}}.GetNewClosure()
$taskPause = {$taskReadState.pauses++}.GetNewClosure()
$taskRecovered = Get-InstalledProcessIdentity -ProcessId 100 -ReadProcess $taskRead -Pause $taskPause
Assert-InstalledCheck ($taskRecovered.executable -eq $taskAllowedPaths[0] -and $taskReadState.reads -eq 2 -and $taskReadState.pauses -eq 1) $true 'initially empty executable is retried before recording identity'
$taskNullRead = {param($processId) [pscustomobject]@{Id=$processId;Path=$null;StartTime=$taskSyntheticStart}}.GetNewClosure()
$taskBlocked = $false
try {Get-InstalledProcessIdentity -ProcessId 100 -ReadProcess $taskNullRead -Pause {} | Out-Null} catch {$taskBlocked=$true}
Assert-InstalledCheck $taskBlocked $true 'persistently unreadable executable never produces an incomplete identity record'
$taskReadState.reads=0
$taskReusedRead = {param($processId) $taskReadState.reads++;[pscustomobject]@{Id=$processId;Path=$null;StartTime=$taskSyntheticStart.AddTicks($taskReadState.reads)}}.GetNewClosure()
$taskBlocked=$false
try {Get-InstalledProcessIdentity -ProcessId 100 -ReadProcess $taskReusedRead -Pause {} | Out-Null} catch {$taskBlocked=$true}
Assert-InstalledCheck $taskBlocked $true 'PID replacement during an executable retry is rejected'
Assert-InstalledCheck ($null -eq (Get-InstalledProcessIdentity -ProcessId 100 -ReadProcess {param($processId) return $null} -Pause {})) $true 'already exited process returns absent instead of an invalid identity'
$taskPartial = @{pid=100;executable=$null;startTimeUtc=$taskExactIso}
$taskRecovered = Resolve-RecordedInjectorIdentity -Saved $taskPartial -Current $taskExact -ExpectedExecutable $taskAllowedPaths[0]
Assert-InstalledCheck (Test-SameInstalledProcess $taskRecovered $taskExact) $true 'legacy missing executable recovers only with selected runtime and exact PID and timestamp'
$taskBlocked=$false
try {Resolve-RecordedInjectorIdentity $taskPartial @{pid=100;executable=$taskAllowedPaths[0];startTimeUtc='2026-10-14T18:02:22.2759348Z'} $taskAllowedPaths[0] | Out-Null} catch {$taskBlocked=$true}
Assert-InstalledCheck $taskBlocked $true 'legacy recovery rejects even one changed creation-time tick'
$taskBlocked=$false
try {Resolve-RecordedInjectorIdentity $taskPartial $taskExact 'C:\other\node.exe' | Out-Null} catch {$taskBlocked=$true}
Assert-InstalledCheck $taskBlocked $true 'legacy recovery cannot substitute another runtime executable'
$taskBlocked=$false
try {Resolve-RecordedInjectorIdentity @{pid=100;executable='C:\other\node.exe';startTimeUtc=$taskExactIso} $taskExact $taskAllowedPaths[0] | Out-Null} catch {$taskBlocked=$true}
Assert-InstalledCheck $taskBlocked $true 'explicit executable mismatch is never repaired as a missing path'
$taskResult = [ordered]@{checkedAt=[DateTimeOffset]::UtcNow.ToString('o');passed=$taskChecks.Count;failed=0;checks=$taskChecks;desktopLaunch='not invoked'}
$taskRuntime = Join-Path $PSScriptRoot 'runtime-installed'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
$taskResult | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskRuntime 'local-checks.json') -Encoding UTF8
$taskResult | ConvertTo-Json -Depth 5
