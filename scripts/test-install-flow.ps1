$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'install-helpers.psm1') -Force
$usageChecks = 0
function Assert-Install([bool]$Condition,[string]$Message) {
    if (-not $Condition) { throw $Message }
    $script:usageChecks++
}
function New-HandoffFixture {
    $usagePath = 'D:\Apps\OpenAI.Codex_test\app\ChatGPT.exe'
    $usageItems = @(@{pid=101;executable=$usagePath;startTimeUtc='2026-01-01T00:00:00Z';hasWindow=$true},@{pid=102;executable=$usagePath;startTimeUtc='2026-01-01T00:00:01Z';hasWindow=$false})
    $s = @{events=[Collections.Generic.List[string]]::new();accepted=$true;current=$usageItems;remain=$false;validateCount=0;failValidationAt=0;stopFails=$false;startFails=$false}
    $plan = [pscustomobject]@{processes=$usageItems;context=@{installLocation='D:\Apps\OpenAI.Codex_test';allowedExecutables=@($usagePath)}}
    $hooks = @{
        Plan=$plan
        Confirm={param($p) $s.events.Add('confirm');return $s.accepted}.GetNewClosure()
        Validate={param($p) $s.events.Add('validate');$s.validateCount++;return $s.failValidationAt -ne $s.validateCount}.GetNewClosure()
        ReadProcesses={param($p) $s.events.Add('read');foreach($item in $s.current){Write-Output $item}}.GetNewClosure()
        StopProcess={param($p) $s.events.Add('stop:'+$p.pid);if($s.stopFails){throw 'synthetic stop failure'};if(-not $s.remain){$s.current=@($s.current|Where-Object {$_.pid -ne $p.pid})}}.GetNewClosure()
        StartLauncher={param($p) $s.events.Add('start');if($s.startFails){throw 'synthetic launch failure'}}.GetNewClosure()
    }
    return @{state=$s;plan=$plan;hooks=$hooks}
}
function Run-Handoff($Fixture) { $usageHooks=$Fixture.hooks; Invoke-UsageInstallHandoff @usageHooks }
function Is-Rejected($Fixture) { try { Run-Handoff $Fixture | Out-Null;return $false } catch { return $true } }
function Stops($Fixture) { return @($Fixture.state.events | Where-Object {$_ -like 'stop:*'}).Count }
function Starts($Fixture) { return @($Fixture.state.events | Where-Object {$_ -eq 'start'}).Count }

$f=New-HandoffFixture;$f.state.accepted=$false;$result=Run-Handoff $f
Assert-Install ($result.state -eq 'deferred' -and ($f.state.events -join ',') -eq 'confirm') 'Later must not validate, close, inspect again or start the client'
$f=New-HandoffFixture;$f.state.accepted=$null;$result=Run-Handoff $f
Assert-Install ($result.state -eq 'deferred' -and (Stops $f) -eq 0 -and (Starts $f) -eq 0) 'Closing the prompt defers restart'
$f=New-HandoffFixture;$f.state.accepted='yes';$result=Run-Handoff $f
Assert-Install ($result.state -eq 'deferred') 'Truthy text cannot substitute for an explicit confirmation result'
$f=New-HandoffFixture;$result=Run-Handoff $f
Assert-Install ($result.state -eq 'launch-requested' -and $result.closedProcesses -eq 2) 'Confirmation closes only the captured client identities'
Assert-Install (($f.state.events -join ',') -eq 'confirm,validate,read,stop:101,stop:102,read,validate,start') 'Revalidation and complete exit precede exactly one launcher start'
$f=New-HandoffFixture;$f.state.current=@($f.plan.processes[1],$f.plan.processes[0]);$result=Run-Handoff $f
Assert-Install (($f.state.events -join ',') -eq 'confirm,validate,read,stop:101,stop:102,read,validate,start') 'Visible windows are handled before background cleanup regardless of process enumeration order'
$f=New-HandoffFixture;$f.plan.processes=@();$f.state.current=@();$result=Run-Handoff $f
Assert-Install ((Stops $f) -eq 0 -and (Starts $f) -eq 1 -and $result.closedProcesses -eq 0) 'No running client still requires confirmation, then launches without stopping anything'
$f=New-HandoffFixture;$f.state.current=@($f.state.current)+@(@{pid=103;executable=$f.state.current[0].executable;startTimeUtc='2026-01-01T00:00:02Z'})
Assert-Install ((Is-Rejected $f) -and (Stops $f) -eq 0 -and (Starts $f) -eq 0) 'A newly arrived client while the prompt was open is left untouched'
$f=New-HandoffFixture;$f.state.current=@(@{pid=101;executable=$f.plan.processes[0].executable;startTimeUtc='2026-01-02T00:00:00Z'},$f.plan.processes[1])
Assert-Install ((Is-Rejected $f) -and (Stops $f) -eq 0) 'PID reuse rejects the entire close plan before closing any client'
$f=New-HandoffFixture;$f.state.current=@(@{pid=101;executable='D:\Tools\node.exe';startTimeUtc='2026-01-01T00:00:00Z'})
Assert-Install ((Is-Rejected $f) -and (Stops $f) -eq 0) 'A different executable is never closed'
$f=New-HandoffFixture;$f.state.current=@($f.plan.processes[1]);$result=Run-Handoff $f
Assert-Install ($result.closedProcesses -eq 1 -and ($f.state.events -contains 'stop:102') -and -not ($f.state.events -contains 'stop:101')) 'Already exited client processes do not block a confirmed restart'
$f=New-HandoffFixture;$f.state.remain=$true
Assert-Install ((Is-Rejected $f) -and (Starts $f) -eq 0) 'Remaining background processes prevent launching another client'
$f=New-HandoffFixture;$f.state.failValidationAt=1
Assert-Install ((Is-Rejected $f) -and (Stops $f) -eq 0) 'Changed package or launcher preflight preserves all current processes'
$f=New-HandoffFixture;$f.state.failValidationAt=2
Assert-Install ((Is-Rejected $f) -and (Starts $f) -eq 0) 'Files changed during shutdown cannot launch an unreviewed entry'
$f=New-HandoffFixture;$f.state.stopFails=$true
Assert-Install ((Is-Rejected $f) -and (Stops $f) -eq 1 -and (Starts $f) -eq 0) 'A shutdown error stops the flow without starting or closing other processes'
$f=New-HandoffFixture;$f.state.startFails=$true
Assert-Install ((Is-Rejected $f) -and (Starts $f) -eq 1) 'Failed statistics launch does not fall back to the ordinary client'

# Exercise the actual shutdown adapter with inert process objects; never target a real PID.
$usageNativeModule=Get-Module install-helpers
function New-NativeFixture {
    $s=@{terminated=0;reads=0;identity=@{pid=101;executable='D:\Apps\OpenAI.Codex_test\app\ChatGPT.exe';startTimeUtc='2026-01-01T00:00:00Z'}}
    $p=[pscustomobject]@{MainWindowHandle=[IntPtr]1;HasExited=$false;CloseAccepted=$true;WaitReturns=$false;HideOnRefresh=$false;CloseCalls=0}
    $p|Add-Member ScriptMethod CloseMainWindow {$this.CloseCalls++;return $this.CloseAccepted}
    $p|Add-Member ScriptMethod WaitForExit {param($timeout) return $this.WaitReturns}
    $p|Add-Member ScriptMethod Refresh {if($this.HideOnRefresh){$this.MainWindowHandle=[IntPtr]::Zero}}
    return @{state=$s;process=$p;identity=$s.identity;
        readIdentity={param($saved) return $s.identity}.GetNewClosure();
        readProcess={param($saved) $s.reads++;return $p}.GetNewClosure();
        terminate={param($saved) $s.terminated++}.GetNewClosure()}
}
function Run-NativeFixture($Fixture) {
    & $usageNativeModule {param($f) Stop-UsageInstallProcess -Identity $f.identity -ReadIdentity $f.readIdentity -ReadProcess $f.readProcess -Terminate $f.terminate} $Fixture
}
$n=New-NativeFixture;$blocked=$false
try {Run-NativeFixture $n} catch {$blocked=$true}
Assert-Install ($blocked -and $n.state.terminated -eq 0 -and $n.process.CloseCalls -eq 1) 'A visible save prompt or remaining window cannot be force-terminated'
$n=New-NativeFixture;$n.process.WaitReturns=$true;Run-NativeFixture $n
Assert-Install ($n.state.terminated -eq 0 -and $n.process.CloseCalls -eq 1) 'Successful graceful exit never calls termination'
$n=New-NativeFixture;$n.process.HideOnRefresh=$true;Run-NativeFixture $n
Assert-Install ($n.state.terminated -eq 1 -and $n.process.CloseCalls -eq 1) 'Only the confirmed client remaining in the background proceeds to exact-identity cleanup'
$n=New-NativeFixture;$n.process.MainWindowHandle=[IntPtr]::Zero;Run-NativeFixture $n
Assert-Install ($n.state.terminated -eq 1 -and $n.process.CloseCalls -eq 0) 'An already background-only confirmed client uses exact-identity cleanup'
$n=New-NativeFixture;$n.state.identity=@{pid=101;executable=$n.identity.executable;startTimeUtc='2026-01-02T00:00:00Z'};$blocked=$false
try {Run-NativeFixture $n} catch {$blocked=$true}
Assert-Install ($blocked -and $n.state.reads -eq 0 -and $n.state.terminated -eq 0) 'PID identity is rechecked immediately before any window close operation'
# Process snapshots may outlive a short-lived Electron child; unreadable live clients must still fail.
function Run-EnumerationFixture($Items,$Identities,$Exited) {
    $context=@{installLocation='D:\Apps\OpenAI.Codex_test';allowedExecutables=@('D:\Apps\OpenAI.Codex_test\app\ChatGPT.exe')}
    $read={ $Items }.GetNewClosure()
    $identity={param($processId) return $Identities[$processId]}.GetNewClosure()
    $exitState={param($process) return $Exited}.GetNewClosure()
    & $usageNativeModule {param($c,$r,$i,$e) Get-UsageInstallProcesses -Context $c -ReadProcesses $r -ReadIdentity $i -HasExited $e} $context $read $identity $exitState
}
$stale=[pscustomobject]@{Id=201;ProcessName='ChatGPT';Path=$null;MainWindowHandle=[IntPtr]::Zero}
$items=@(Run-EnumerationFixture @($stale) @{} $true)
Assert-Install ($items.Count -eq 0) 'An exited Electron process with an empty cached Path is not treated as an unreadable live client'
$items=@(Run-EnumerationFixture @($stale) @{} $false)
Assert-Install ($items.Count -eq 0) 'A process gone before a fresh identity query does not block restart'
$blocked=$false
try {Run-EnumerationFixture @($stale) @{201=@{pid=201;executable=$null;startTimeUtc='2026-01-01T00:00:00Z'}} $false} catch {$blocked=$_.Exception.Message -like '*PID 201*'}
Assert-Install $blocked 'A still-running client with unreadable identity is preserved and its PID is reported'
$valid=@{201=@{pid=201;executable='D:\Apps\OpenAI.Codex_test\app\ChatGPT.exe';startTimeUtc='2026-01-01T00:00:00Z'}}
$items=@(Run-EnumerationFixture @($stale) $valid $false)
Assert-Install ($items.Count -eq 1 -and $items[0].pid -eq 201 -and -not $items[0].hasWindow) 'A fresh verified identity recovers an empty snapshot path without weakening the package boundary'
$foreign=@{201=@{pid=201;executable='D:\Tools\codex.exe';startTimeUtc='2026-01-01T00:00:00Z'}}
$items=@(Run-EnumerationFixture @($stale) $foreign $false)
Assert-Install ($items.Count -eq 0) 'A readable same-name process outside the registered package is never selected'

Import-Module (Join-Path $PSScriptRoot 'install-dialog.psm1') -Force
$dialogModule = Get-Module install-dialog
$dialogConsent = & $dialogModule {
    $view = New-UsageInstallDialog -Running $true
    try { return @{laterDefault=$view.FindName('Later').IsDefault;laterCancel=$view.FindName('Later').IsCancel;proceedDefault=$view.FindName('Proceed').IsDefault} }
    finally { $view.Close() }
}
Assert-Install ($dialogConsent.laterDefault) 'The styled dialog keeps Enter assigned to Later'
Assert-Install ($dialogConsent.laterCancel) 'The styled dialog keeps Escape assigned to cancel'
Assert-Install (-not $dialogConsent.proceedDefault) 'The styled primary button cannot become implicit restart consent'

$usageFixtureBase = Join-Path $PSScriptRoot 'runtime-install-tests'
$usageFixture = Join-Path $usageFixtureBase ([Guid]::NewGuid().ToString('N')+'-安装 空格')
New-Item -ItemType Directory -Path (Join-Path $usageFixture 'app'),(Join-Path $usageFixture 'scripts'),(Join-Path $usageFixture 'launcher') -Force | Out-Null
try {
    $usageFakeStart = Join-Path $usageFixture 'app\start-installed.ps1'
    Set-Content -LiteralPath $usageFakeStart -Value '# synthetic entry, never execute a desktop client' -Encoding utf8
    $usageSpec=Get-UsageInstallLauncher $usageFixture
    Assert-Install ($usageSpec.kind -eq 'powershell-launcher' -and $usageSpec.file -eq (Join-Path $PSHOME 'pwsh.exe')) 'Missing optional compiler uses the current PowerShell host'
    Assert-Install (($usageSpec.arguments -join '|') -eq ('-NoProfile|-WindowStyle|Hidden|-File|'+$usageFakeStart)) 'Fallback targets this injection script and preserves Unicode paths as separate arguments'
    $usageFakeExe = Join-Path $usageFixture 'launcher\ChatGPT-Usage.exe'
    Set-Content -LiteralPath $usageFakeExe -Value 'synthetic file; never execute' -Encoding ascii
    $usageSpec=Get-UsageInstallLauncher $usageFixture
    Assert-Install ($usageSpec.kind -eq 'quiet-launcher' -and $usageSpec.file -eq $usageFakeExe -and $usageSpec.arguments.Count -eq 0) 'Compiled statistics launcher takes precedence'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'start.ps1') -Destination (Join-Path $usageFixture 'scripts\start.ps1')
    $usageMarker = 'param([string]$CodexHome); Set-Content -LiteralPath (Join-Path $PSScriptRoot "route.txt") -Value $CodexHome'
    Set-Content -LiteralPath (Join-Path $usageFixture 'scripts\setup.ps1') -Value $usageMarker -Encoding utf8
    Set-Content -LiteralPath $usageFakeStart -Value $usageMarker -Encoding utf8
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $usageFixture 'scripts\start.ps1') -CodexHome 'D:\Demo Sessions'
    Assert-Install ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath (Join-Path $usageFixture 'scripts\route.txt')) -and -not (Test-Path -LiteralPath (Join-Path $usageFixture 'app\route.txt'))) 'First start enters installation instead of silently closing the client'
    Assert-Install ((Get-Content -LiteralPath (Join-Path $usageFixture 'scripts\route.txt')).Trim() -eq 'D:\Demo Sessions') 'Explicit session directory reaches first-install preparation'
    Set-Content -LiteralPath (Join-Path $usageFixture 'app\settings.local.json') -Value '{}' -Encoding utf8
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $usageFixture 'scripts\start.ps1') -CodexHome 'D:\Other Sessions'
    Assert-Install ($LASTEXITCODE -eq 0 -and (Get-Content -LiteralPath (Join-Path $usageFixture 'app\route.txt')).Trim() -eq 'D:\Other Sessions') 'Daily startup bypasses the installation prompt and forwards explicit session settings'
    foreach ($usageFile in @('setup.ps1','start.ps1','install-helpers.psm1','install-dialog.psm1','test-install-flow.ps1')) {
        $usageTokens=$null;$usageErrors=$null
        [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $usageFile),[ref]$usageTokens,[ref]$usageErrors) | Out-Null
        Assert-Install (-not $usageErrors.Count) ('PowerShell parses: '+$usageFile)
    }
    Write-Host "$usageChecks installation handoff checks passed. No actual dialog, client, process or real shortcut was operated."
} finally {
    $usageResolved=[IO.Path]::GetFullPath($usageFixture)
    $usageBoundary=[IO.Path]::GetFullPath($usageFixtureBase).TrimEnd('\')+'\'
    if (-not $usageResolved.StartsWith($usageBoundary,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected installation fixture path.' }
    Remove-Item -LiteralPath $usageResolved -Recurse -Force
}
exit 0
