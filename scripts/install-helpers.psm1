Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '..\app\installed-helpers.psm1') -Force
Import-Module (Join-Path $PSScriptRoot '..\app\runtime-helpers.psm1') -Force
Import-Module (Join-Path $PSScriptRoot '..\app\startup-helpers.psm1') -Force

function Get-UsageInstallLauncher {
    param([string]$ProjectRoot)
    $usageRoot = [IO.Path]::GetFullPath($ProjectRoot)
    $usageScript = Join-Path $usageRoot 'app\start-installed.ps1'
    if (-not (Test-Path -LiteralPath $usageScript -PathType Leaf)) { throw 'Statistics start script is missing.' }
    $usageExe = Join-Path $usageRoot 'launcher\ChatGPT-Usage.exe'
    if (Test-Path -LiteralPath $usageExe -PathType Leaf) {
        return [pscustomobject]@{file=$usageExe;arguments=@();kind='quiet-launcher';script=$usageScript}
    }
    $usageHost = Join-Path $PSHOME 'pwsh.exe'
    if (-not (Test-Path -LiteralPath $usageHost -PathType Leaf)) { throw 'PowerShell 7 is unavailable.' }
    return [pscustomobject]@{file=$usageHost;arguments=@('-NoProfile','-WindowStyle','Hidden','-File',$usageScript);kind='powershell-launcher';script=$usageScript}
}

function Get-UsageInstallPackage {
    $usagePackages = @(Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction Stop | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' })
    if ($usagePackages.Count -ne 1) { throw 'Cannot uniquely verify the installed desktop client.' }
    $usagePackage = $usagePackages[0]
    [xml]$usageManifest = Get-Content -LiteralPath (Join-Path $usagePackage.InstallLocation 'AppxManifest.xml') -Raw -Encoding utf8
    $usageApplication = @($usageManifest.SelectNodes("//*[local-name()='Application']") | Where-Object { $_.GetAttribute('Id') -eq 'App' })
    if ($usageApplication.Count -ne 1) { throw 'Cannot verify the registered client application.' }
    $usageManifestExe = [IO.Path]::GetFullPath((Join-Path $usagePackage.InstallLocation $usageApplication[0].GetAttribute('Executable')))
    $usageAllowed = @($usageManifestExe,(Join-Path $usagePackage.InstallLocation 'app\ChatGPT.exe'),(Join-Path $usagePackage.InstallLocation 'app\Codex.exe')) | Select-Object -Unique
    if (-not (Test-InstalledExecutable $usageManifestExe $usagePackage.InstallLocation $usageAllowed) -or -not (Test-Path -LiteralPath $usageManifestExe -PathType Leaf)) { throw 'Registered client executable verification failed.' }
    return [pscustomobject]@{packageFullName=$usagePackage.PackageFullName;installLocation=$usagePackage.InstallLocation;allowedExecutables=@($usageAllowed)}
}

function Get-UsageInstallProcesses {
    param(
        $Context,
        [scriptblock]$ReadProcesses = { Get-Process -ErrorAction Stop },
        [scriptblock]$ReadIdentity = { param($processId) Get-InstalledProcessIdentity -ProcessId $processId },
        [scriptblock]$HasExited = { param($process) $process.Refresh(); return $process.HasExited }
    )
    foreach ($usageProcess in (& $ReadProcesses)) {
        $usageIdentity = $null
        try { $usagePath = $usageProcess.Path } catch { $usagePath = $null }
        if (-not $usagePath) {
            if ($usageProcess.ProcessName -notin @('ChatGPT','Codex')) { continue }
            # A snapshot can retain an exited Electron child whose Path has become empty.
            if (& $HasExited $usageProcess) { continue }
            $usageIdentity = & $ReadIdentity $usageProcess.Id
            if (-not $usageIdentity) { continue }
            $usagePath = $usageIdentity.executable
            if (-not $usagePath) { throw ("Cannot verify running client process PID {0} ({1}); close it manually before continuing." -f $usageProcess.Id,$usageProcess.ProcessName) }
        }
        if (Test-InstalledExecutable $usagePath $Context.installLocation $Context.allowedExecutables) {
            if (-not $usageIdentity) { $usageIdentity = & $ReadIdentity $usageProcess.Id }
            if (-not $usageIdentity) { continue }
            if (-not (Test-InstalledExecutable $usageIdentity.executable $Context.installLocation $Context.allowedExecutables)) {
                if (& $HasExited $usageProcess) { continue }
                throw ("Client process identity changed while reading PID {0}; no restart was performed." -f $usageProcess.Id)
            }
            $usageIdentity['hasWindow'] = $usageProcess.MainWindowHandle -ne [IntPtr]::Zero
            Write-Output $usageIdentity
        }
    }
}

function New-UsageInstallPlan {
    param([string]$ProjectRoot, [string]$CodexHome)
    $usageRoot = [IO.Path]::GetFullPath($ProjectRoot)
    $usageApp = Join-Path $usageRoot 'app'
    $usageOptions = Get-UsageLaunchOptions -AppRoot $usageApp
    $usageNodePath = if ($env:CODEX_USAGE_NODE) { $env:CODEX_USAGE_NODE } elseif ($usageOptions.ContainsKey('nodeExecutable')) { $usageOptions.nodeExecutable } else { $null }
    $usagePythonPath = if ($env:CODEX_USAGE_PYTHON) { $env:CODEX_USAGE_PYTHON } elseif ($usageOptions.ContainsKey('pythonExecutable')) { $usageOptions.pythonExecutable } else { $null }
    $usageNode = Resolve-UsageRuntime -Kind Node -ExplicitPath $usageNodePath
    $usagePython = Resolve-UsageRuntime -Kind Python -ExplicitPath $usagePythonPath
    if (-not $CodexHome) {
        foreach ($usageScope in @('Process','User','Machine')) {
            $CodexHome = [Environment]::GetEnvironmentVariable('CODEX_HOME',$usageScope)
            if ($CodexHome) { break }
        }
        if (-not $CodexHome -and $usageOptions.ContainsKey('codexHome')) { $CodexHome = $usageOptions.codexHome }
        if (-not $CodexHome) { $CodexHome = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
    }
    if (-not [IO.Path]::IsPathFullyQualified($CodexHome) -or -not (Test-Path -LiteralPath (Join-Path $CodexHome 'sessions') -PathType Container)) { throw 'Specify the actual existing local session directory before restarting.' }
    $usageLauncher = Get-UsageInstallLauncher -ProjectRoot $usageRoot
    $usageContext = Get-UsageInstallPackage
    $usageProcesses = @(Get-UsageInstallProcesses -Context $usageContext)
    return [pscustomobject]@{
        projectRoot=$usageRoot;context=$usageContext;processes=$usageProcesses;launcher=$usageLauncher;
        launcherHash=(Get-FileHash -LiteralPath $usageLauncher.file -Algorithm SHA256).Hash;
        scriptHash=(Get-FileHash -LiteralPath $usageLauncher.script -Algorithm SHA256).Hash;
        node=$usageNode;python=$usagePython;codexHome=[IO.Path]::GetFullPath($CodexHome)
    }
}

function Test-UsageInstallPlan {
    param($Plan)
    if ((Get-FileHash -LiteralPath $Plan.launcher.file -Algorithm SHA256).Hash -ne $Plan.launcherHash -or (Get-FileHash -LiteralPath $Plan.launcher.script -Algorithm SHA256).Hash -ne $Plan.scriptHash) { throw 'Startup files changed. Run installation again before restarting.' }
    $usageCurrent = Get-UsageInstallPackage
    if ($usageCurrent.packageFullName -ne $Plan.context.packageFullName -or $usageCurrent.installLocation -ne $Plan.context.installLocation) { throw 'The installed client changed. Run installation again before restarting.' }
    return $true
}

function Show-UsageInstallConfirmation {
    param($Plan)
    Import-Module (Join-Path $PSScriptRoot 'install-dialog.psm1') -Force
    return Show-UsageInstallDialog -Running (@($Plan.processes).Count -gt 0)
}

function Stop-UsageInstallProcess {
    param(
        $Identity,
        [scriptblock]$ReadIdentity = { param($saved) Get-InstalledProcessIdentity -ProcessId $saved.pid },
        [scriptblock]$ReadProcess = { param($saved) Get-Process -Id $saved.pid -ErrorAction Stop },
        [scriptblock]$Terminate = { param($saved) Stop-RecordedInstalledProcess -Identity $saved }
    )
    $usageCurrent = & $ReadIdentity $Identity
    if (-not $usageCurrent) { return }
    if (-not (Test-SameInstalledProcess $Identity $usageCurrent)) { throw 'Client process identity changed; it was preserved.' }
    $usageProcess = & $ReadProcess $Identity
    if ($usageProcess.MainWindowHandle -ne [IntPtr]::Zero) {
        if ($usageProcess.CloseMainWindow() -and $usageProcess.WaitForExit(3000)) { return }
        $usageProcess.Refresh()
        if ($usageProcess.HasExited) { return }
        if ($usageProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            throw 'A client window or save dialog remains open. Complete it manually; the window was not forced closed.'
        }
    }
    # Called only after the installation dialog explicitly confirms closing windows and background processes.
    & $Terminate $Identity
}

function Start-UsageInstallLauncher {
    param($Plan)
    $usageStart = [Diagnostics.ProcessStartInfo]::new()
    $usageStart.FileName = $Plan.launcher.file
    foreach ($usageArgument in $Plan.launcher.arguments) { $usageStart.ArgumentList.Add($usageArgument) }
    $usageStart.WorkingDirectory = $Plan.projectRoot
    $usageStart.UseShellExecute = $false; $usageStart.CreateNoWindow = $true
    $usageStart.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $usageStart.Environment['CODEX_USAGE_NODE'] = $Plan.node
    $usageStart.Environment['CODEX_USAGE_PYTHON'] = $Plan.python
    $usageStart.Environment['CODEX_HOME'] = $Plan.codexHome
    $usageLaunched = [Diagnostics.Process]::Start($usageStart)
    if (-not $usageLaunched) { throw 'Statistics launcher could not be started.' }
    $usageLaunched.Dispose()
}

function Invoke-UsageInstallHandoff {
    param(
        $Plan,
        [scriptblock]$Confirm = { param($p) Show-UsageInstallConfirmation $p },
        [scriptblock]$Validate = { param($p) Test-UsageInstallPlan $p },
        [scriptblock]$ReadProcesses = { param($p) Get-UsageInstallProcesses -Context $p.context },
        [scriptblock]$StopProcess = { param($p) Stop-UsageInstallProcess $p },
        [scriptblock]$StartLauncher = { param($p) Start-UsageInstallLauncher $p }
    )
    $usageAccepted = & $Confirm $Plan
    if ($usageAccepted -isnot [bool] -or -not $usageAccepted) { return [pscustomobject]@{state='deferred';closedProcesses=0} }
    if ((& $Validate $Plan) -ne $true) { throw 'Restart plan verification failed.' }
    $usageCurrent = @(& $ReadProcesses $Plan)
    foreach ($usageProcess in $usageCurrent) {
        $usageMatch = @($Plan.processes | Where-Object { Test-SameInstalledProcess $_ $usageProcess })
        if ($usageMatch.Count -ne 1) { throw 'Client processes changed while confirming; no restart was performed. Run installation again.' }
    }
    # Deal with visible windows and save dialogs before cleaning up background-only processes.
    $usageCloseOrder = @($usageCurrent | Sort-Object -Stable -Property @{Expression={ -not $_.hasWindow }})
    foreach ($usageProcess in $usageCloseOrder) { & $StopProcess $usageProcess }
    if (@(& $ReadProcesses $Plan).Count) { throw 'Client background processes remain; exit them manually. The new launcher was not started.' }
    if ((& $Validate $Plan) -ne $true) { throw 'Startup files changed; the new launcher was not started.' }
    & $StartLauncher $Plan
    return [pscustomobject]@{state='launch-requested';closedProcesses=$usageCurrent.Count}
}

Export-ModuleMember -Function Get-UsageInstallLauncher,New-UsageInstallPlan,Invoke-UsageInstallHandoff
