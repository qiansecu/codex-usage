$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'installed-helpers.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'runtime-helpers.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'startup-helpers.psm1') -Force
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
Wait-UsageReady -RuntimeDirectory $detailRuntime -StartedAt $detailReloadAt
Write-Host 'Statistics reloaded. The client and chat were left open.'
