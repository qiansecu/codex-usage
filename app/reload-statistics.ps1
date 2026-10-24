$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'installed-helpers.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'runtime-helpers.psm1') -Force
$detailRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$detailRuntime = Join-Path $detailRoot 'runtime-installed'
$detailSession = Get-Content -LiteralPath (Join-Path $detailRuntime 'session.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$detailOwner = Get-InstalledProcessIdentity -ProcessId $detailSession.ownerIdentity.pid
if (-not (Test-SameInstalledProcess -Saved $detailSession.ownerIdentity -Current $detailOwner)) { throw 'Client listener identity changed or is inaccessible; nothing was stopped.' }
$detailPackage = @(Get-AppxPackage -Name 'OpenAI.Codex' | Where-Object { $_.PackageFullName -eq $detailSession.packageFullName })
if ($detailPackage.Count -ne 1 -or -not (Test-InstalledExecutable -Executable $detailOwner.executable -InstallLocation $detailPackage[0].InstallLocation -AllowedExecutables @((Join-Path $detailPackage[0].InstallLocation 'app\ChatGPT.exe'),(Join-Path $detailPackage[0].InstallLocation 'app\Codex.exe')))) { throw 'Registered client package verification failed.' }
$detailListeners = @(Get-NetTCPConnection -State Listen -LocalPort $detailSession.port -ErrorAction Stop)
if ($detailListeners.Count -ne 1 -or $detailListeners[0].LocalAddress -ne '127.0.0.1' -or $detailListeners[0].OwningProcess -ne $detailOwner.pid) { throw 'Listener verification failed.' }
$detailSaved = Get-Content -LiteralPath (Join-Path $detailRuntime 'injector-session.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$detailCurrent = Get-InstalledProcessIdentity -ProcessId $detailSaved.identity.pid
$detailNode = Resolve-UsageRuntime -Kind Node -ExplicitPath $detailSaved.nodeExecutable
if ($detailCurrent) {
    $detailSaved.identity = Resolve-RecordedInjectorIdentity -Saved $detailSaved.identity -Current $detailCurrent -ExpectedExecutable $detailNode
} elseif ($detailSaved.identity.executable -and -not $detailSaved.identity.executable.Equals($detailNode,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'Statistics runtime verification failed.'
}
& $detailNode (Join-Path $detailRoot 'build-ui.mjs') --check
if ($LASTEXITCODE -ne 0) { throw 'UI source and generated payload do not match.' }
$detailStop = Join-Path $detailRuntime 'stop'
if ($detailCurrent) {
    $detailOld = Get-Process -Id $detailSaved.identity.pid -ErrorAction Stop
    Set-Content -LiteralPath $detailStop -Value 'stop' -Encoding ASCII
    if (-not $detailOld.WaitForExit(12000)) { throw 'Statistics process did not stop gracefully; it was not force-closed.' }
}
$detailStamp = [Guid]::NewGuid().ToString('N')
foreach ($detailLog in @('injector.log','injector-error.log')) {
    $detailLogPath = Join-Path $detailRuntime $detailLog
    if (Test-Path -LiteralPath $detailLogPath) { Move-Item -LiteralPath $detailLogPath -Destination (Join-Path $detailRuntime ($detailLog + '.before-reload-' + $detailStamp)) }
}
if (Test-Path -LiteralPath $detailStop) { Remove-Item -LiteralPath $detailStop }
$detailReloadAt = [DateTimeOffset]::UtcNow
$detailInjector = Start-Process -FilePath $detailNode -ArgumentList @(('"' + (Join-Path $detailRoot 'injector.mjs') + '"'),('"' + (Join-Path $detailRuntime 'session.json') + '"')) -WorkingDirectory $detailRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $detailRuntime 'injector.log') -RedirectStandardError (Join-Path $detailRuntime 'injector-error.log') -PassThru
[ordered]@{identity=(Get-InstalledProcessIdentity -ProcessId $detailInjector.Id);nodeExecutable=$detailNode;startedAt=[DateTimeOffset]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $detailRuntime 'injector-session.json') -Encoding UTF8
$detailDeadline = [DateTime]::UtcNow.AddSeconds(15)
while ([DateTime]::UtcNow -lt $detailDeadline) {
    $detailInjector.Refresh()
    $detailStatus = $null
    try { $detailStatus = Get-Content -LiteralPath (Join-Path $detailRuntime 'status.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    $detailStatusAt = $null
    try {
        if ($detailStatus) { $detailStatusAt = if ($detailStatus.at -is [DateTime]) { [DateTimeOffset]$detailStatus.at } else { [DateTimeOffset]::Parse($detailStatus.at) } }
    } catch { }
    if ($null -ne $detailStatusAt -and $detailStatusAt -ge $detailReloadAt) {
        if ($detailStatus.stage -eq 'error') { throw ('Statistics reload failed: ' + $detailStatus.error) }
        if ($detailStatus.stage -eq 'usage-status' -and $detailStatus.state -eq 'updated') {
            Write-Host 'Statistics reloaded. The client and chat were left open.'
            return
        }
    }
    if ($detailInjector.HasExited) { throw 'Statistics process exited; see runtime-installed\injector-error.log.' }
    Start-Sleep -Milliseconds 200
}
throw 'Statistics is still starting; see runtime-installed\status.json.'
