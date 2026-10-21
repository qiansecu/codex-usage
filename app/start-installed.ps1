param([string]$CodexHome)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'installed-helpers.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'runtime-helpers.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'startup-helpers.psm1') -Force
$taskRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$taskRuntime = Join-Path $taskRoot 'runtime-installed'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
$taskStop = Join-Path $taskRuntime 'stop'
$taskUserProfile = [Environment]::GetFolderPath('UserProfile')
$taskNode = $null
$taskPython = $null
$taskLaunchIdentity = $null
$taskOwnerIdentity = $null
$taskSession = $null
try {
    $taskOptions = Get-UsageLaunchOptions -AppRoot $taskRoot
    $taskNodePath = if ($env:CODEX_USAGE_NODE) { $env:CODEX_USAGE_NODE } elseif ($taskOptions.ContainsKey('nodeExecutable')) { $taskOptions.nodeExecutable } else { $null }
    $taskPythonPath = if ($env:CODEX_USAGE_PYTHON) { $env:CODEX_USAGE_PYTHON } elseif ($taskOptions.ContainsKey('pythonExecutable')) { $taskOptions.pythonExecutable } else { $null }
    $taskNode = Resolve-UsageRuntime -Kind Node -ExplicitPath $taskNodePath
    $taskPython = Resolve-UsageRuntime -Kind Python -ExplicitPath $taskPythonPath
    foreach ($taskRequired in @($taskNode,$taskPython,(Join-Path $taskRoot 'injector.mjs'),(Join-Path $taskRoot 'store-activation.cs'))) {
        if (-not (Test-Path -LiteralPath $taskRequired -PathType Leaf)) { throw ('Missing runtime file: ' + $taskRequired) }
    }
    & $taskNode (Join-Path $taskRoot 'build-ui.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'UI generation failed.' }
    Set-Content -LiteralPath $taskStop -Value 'stop' -Encoding ASCII
    $taskPreviousFile = Join-Path $taskRuntime 'injector-session.json'
    if (Test-Path -LiteralPath $taskPreviousFile) {
        $taskPrevious = Get-Content -LiteralPath $taskPreviousFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $taskOldIdentity = Get-InstalledProcessIdentity -ProcessId $taskPrevious.identity.pid
        if (Test-SameInstalledProcess -Saved $taskPrevious.identity -Current $taskOldIdentity) {
            $taskOldInjector = Get-Process -Id $taskPrevious.identity.pid -ErrorAction Stop
            if (-not $taskOldInjector.WaitForExit(12000)) { throw 'Old injector did not stop. Use restore-installed.cmd first.' }
        }
    }
    $taskPackages = @(Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction Stop | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' })
    if ($taskPackages.Count -ne 1) { throw 'Cannot uniquely identify the current registered OpenAI.Codex Store package.' }
    $taskPackage = $taskPackages[0]
    [xml]$taskManifest = Get-Content -LiteralPath (Join-Path $taskPackage.InstallLocation 'AppxManifest.xml') -Raw -Encoding UTF8
    $taskApplication = @($taskManifest.SelectNodes("//*[local-name()='Application']") | Where-Object { $_.GetAttribute('Id') -eq 'App' })
    if ($taskApplication.Count -ne 1) { throw 'Registered package does not have the expected App activation entry.' }
    $taskManifestExe = [IO.Path]::GetFullPath((Join-Path $taskPackage.InstallLocation $taskApplication[0].GetAttribute('Executable')))
    $taskAllowed = @($taskManifestExe,(Join-Path $taskPackage.InstallLocation 'app\ChatGPT.exe'),(Join-Path $taskPackage.InstallLocation 'app\Codex.exe')) | Select-Object -Unique
    if (-not (Test-InstalledExecutable -Executable $taskManifestExe -InstallLocation $taskPackage.InstallLocation -AllowedExecutables $taskAllowed)) {
        throw 'Manifest executable is outside the registered package.'
    }
    $taskAumid = $taskPackage.PackageFamilyName + '!App'
    $taskPackageRecord = [ordered]@{ aumid=$taskAumid; packageFullName=$taskPackage.PackageFullName; version=$taskPackage.Version.ToString(); installLocation=$taskPackage.InstallLocation; manifestExecutable=$taskManifestExe }
    $taskPackageRecord | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRuntime 'package.json') -Encoding UTF8
    # Do not force-close the user's existing installed client from a startup script.
    foreach ($taskProcess in (Get-Process -ErrorAction Stop)) {
        try { $taskPath = $taskProcess.Path } catch { continue }
        if (Test-InstalledExecutable -Executable $taskPath -InstallLocation $taskPackage.InstallLocation -AllowedExecutables $taskAllowed) {
            throw 'Installed client is still running. Fully exit it, including its background process, then run this script again.'
        }
    }
    if (-not $CodexHome) {
        $CodexHome = [Environment]::GetEnvironmentVariable('CODEX_HOME','Process')
        if (-not $CodexHome) { $CodexHome = [Environment]::GetEnvironmentVariable('CODEX_HOME','User') }
        if (-not $CodexHome) { $CodexHome = [Environment]::GetEnvironmentVariable('CODEX_HOME','Machine') }
        if (-not $CodexHome -and $taskOptions.ContainsKey('codexHome')) { $CodexHome = $taskOptions.codexHome }
        if (-not $CodexHome) { $CodexHome = Join-Path $taskUserProfile '.codex' }
    }
    if (-not [IO.Path]::IsPathFullyQualified($CodexHome)) { throw 'CodexHome must be an absolute path.' }
    $taskCodexDirectory = [IO.Path]::GetFullPath($CodexHome)
    if (-not (Test-Path -LiteralPath (Join-Path $taskCodexDirectory 'sessions') -PathType Container)) { throw 'Normal local session directory is missing. Specify the actual CodexHome; no credentials are copied.' }
    if (-not ('CodexUsageInstalled.StoreActivation' -as [type])) { Add-Type -LiteralPath (Join-Path $taskRoot 'store-activation.cs') }
    $taskProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $taskProbe.Start(); $taskPort = $taskProbe.LocalEndpoint.Port; $taskProbe.Stop()
    Remove-Item -LiteralPath $taskStop
    $taskActivatedAt = [DateTimeOffset]::UtcNow
    $taskArguments = '--remote-debugging-address=127.0.0.1 --remote-debugging-port=' + $taskPort
    Write-Host ('Activating installed package ' + $taskPackage.Version + '; CDP port ' + $taskPort)
    $taskAppId = [CodexUsageInstalled.StoreActivation]::Activate($taskAumid,$taskArguments)
    $taskLaunchIdentity = Get-InstalledProcessIdentity -ProcessId $taskAppId
    if ($taskLaunchIdentity -and -not (Test-InstalledExecutable -Executable $taskLaunchIdentity.executable -InstallLocation $taskPackage.InstallLocation -AllowedExecutables $taskAllowed)) {
        $taskLaunchIdentity = $null
        throw 'Activation returned a process outside the registered package; no injection performed.'
    }
    $taskSession = [ordered]@{ mode='installed-aumid'; aumid=$taskAumid; packageFullName=$taskPackage.PackageFullName; packageVersion=$taskPackage.Version.ToString(); installLocation=$taskPackage.InstallLocation; port=$taskPort; appPid=$taskAppId; launchIdentity=$taskLaunchIdentity; listenerValidated=$false; codexHome=$taskCodexDirectory; pythonExecutable=$taskPython; profileMode='normal-installed-profile'; startedAt=$taskActivatedAt.ToString('o') }
    $taskSession | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskRuntime 'session.json') -Encoding UTF8
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(120)
    $taskListeners = @()
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        # Query failure is distinct from a successfully queried but empty matching port.
        $taskListeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq $taskPort })
        if ($taskListeners.Count) { break }
        Start-Sleep -Milliseconds 300
    }
    if (-not $taskListeners.Count) { throw 'No CDP listener after 120 seconds. This installed version may not preserve debugging arguments.' }
    $taskOwners = @($taskListeners.OwningProcess | Select-Object -Unique)
    if ($taskOwners.Count -ne 1) { throw 'CDP listener owner is ambiguous; no injection performed.' }
    $taskCandidate = Get-InstalledProcessIdentity -ProcessId $taskOwners[0]
    if (-not $taskCandidate -or -not (Test-InstalledExecutable -Executable $taskCandidate.executable -InstallLocation $taskPackage.InstallLocation -AllowedExecutables $taskAllowed)) {
        throw 'CDP port is owned by a different application; no injection performed.'
    }
    if ([DateTimeOffset]::Parse($taskCandidate.startTimeUtc) -lt $taskActivatedAt.AddSeconds(-2)) { throw 'CDP listener belongs to an older process; no injection performed.' }
    $taskOwnerIdentity = $taskCandidate
    $taskSession.ownerIdentity = $taskOwnerIdentity
    $taskSession.executable = $taskOwnerIdentity.executable
    $taskSession.ownerPid = $taskOwnerIdentity.pid
    $taskSession | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskRuntime 'session.json') -Encoding UTF8
    if (@($taskListeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count) { throw 'Debug listener is not restricted to 127.0.0.1; no injection performed.' }
    $taskSession.listenerValidated = $true
    $taskSession | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskRuntime 'session.json') -Encoding UTF8
    $taskInjector = Start-Process -FilePath $taskNode -ArgumentList @(('"' + (Join-Path $taskRoot 'injector.mjs') + '"'),('"' + (Join-Path $taskRuntime 'session.json') + '"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRuntime 'injector.log') -RedirectStandardError (Join-Path $taskRuntime 'injector-error.log') -PassThru
    [ordered]@{identity=(Get-InstalledProcessIdentity -ProcessId $taskInjector.Id);nodeExecutable=$taskNode;startedAt=[DateTimeOffset]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskRuntime 'injector-session.json') -Encoding UTF8
    Wait-UsageReady -RuntimeDirectory $taskRuntime -StartedAt $taskActivatedAt
    Save-UsageLaunchOptions -AppRoot $taskRoot -NodeExecutable $taskNode -PythonExecutable $taskPython -CodexHome $taskCodexDirectory
    Write-Host 'Statistics startup confirmed. Open an existing local chat.'
    Write-Host ('Status: ' + (Join-Path $taskRuntime 'status.json'))
} catch {
    $taskFailure = $_.Exception.Message
    Set-Content -LiteralPath $taskStop -Value 'stop' -Encoding ASCII
    $taskCleanupErrors = @()
    foreach ($taskIdentity in @($taskOwnerIdentity,$taskLaunchIdentity)) {
        try { Stop-RecordedInstalledProcess -Identity $taskIdentity } catch { $taskCleanupErrors += $_.Exception.Message }
    }
    [ordered]@{at=[DateTimeOffset]::UtcNow.ToString('o');stage='launch-error';error=$taskFailure;cleanupErrors=$taskCleanupErrors} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskRuntime 'launch-error.json') -Encoding UTF8
    Write-Host ('ERROR: ' + $taskFailure) -ForegroundColor Red
    Write-Host 'If a new installed window remains, fully close it and open Codex normally. Installation files and settings were not patched.'
    exit 1
}

# Shortcut failures must not close an otherwise working client.
try {
    Install-UsageShortcuts -ProjectRoot (Split-Path -Parent $taskRoot)
} catch {
    [ordered]@{at=[DateTimeOffset]::UtcNow.ToString('o');stage='shortcut-error';error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRuntime 'shortcut-error.json') -Encoding UTF8
    Write-Warning ('Statistics is running, but the independent shortcuts were not created: ' + $_.Exception.Message)
}
