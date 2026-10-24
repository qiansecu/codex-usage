Set-StrictMode -Version Latest

function Test-InstalledExecutable {
    param([string]$Executable, [string]$InstallLocation, [string[]]$AllowedExecutables)
    if (-not $Executable -or -not $InstallLocation) { return $false }
    try {
        $taskPath = [IO.Path]::GetFullPath($Executable)
        $taskPackage = [IO.Path]::GetFullPath($InstallLocation).TrimEnd('\') + '\'
        if (-not $taskPath.StartsWith($taskPackage, [StringComparison]::OrdinalIgnoreCase)) { return $false }
        foreach ($taskAllowed in $AllowedExecutables) {
            if ($taskPath.Equals([IO.Path]::GetFullPath($taskAllowed), [StringComparison]::OrdinalIgnoreCase)) { return $true }
        }
    } catch { return $false }
    return $false
}

function Get-InstalledProcessIdentity {
    param(
        [int]$ProcessId,
        [scriptblock]$ReadProcess = { param($processId) Get-Process -Id $processId -ErrorAction SilentlyContinue },
        [scriptblock]$Pause = { Start-Sleep -Milliseconds 50 }
    )
    $taskFirstStart = $null
    for ($taskAttempt = 0; $taskAttempt -lt 6; $taskAttempt++) {
        $taskProcess = & $ReadProcess $ProcessId
        if (-not $taskProcess) { return $null }
        $taskStart = $null
        try {
            $taskStart = $taskProcess.StartTime.ToUniversalTime().ToString('o')
            if ($null -eq $taskFirstStart) { $taskFirstStart = $taskStart }
            if ($taskStart -ne $taskFirstStart) { throw 'Process was replaced while reading its identity.' }
            $taskExecutable = $taskProcess.Path
            if ($taskExecutable) {
                return [ordered]@{pid=$taskProcess.Id;executable=$taskExecutable;startTimeUtc=$taskStart}
            }
        } catch {
            if ($taskStart -and $taskFirstStart -and $taskStart -ne $taskFirstStart) { throw }
        }
        if ($taskAttempt -lt 5) { & $Pause }
    }
    throw ("Cannot read complete process identity for PID {0}; no incomplete identity was saved." -f $ProcessId)
}

function Get-ProcessStartUtcTicks {
    param($Value)
    try {
        if ($Value -is [DateTimeOffset]) { return $Value.UtcDateTime.Ticks }
        if ($Value -is [DateTime]) {
            if ($Value.Kind -eq [DateTimeKind]::Unspecified) { return $null }
            return $Value.ToUniversalTime().Ticks
        }
        if ($Value -isnot [string] -or $Value -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$') { return $null }
        return [DateTimeOffset]::Parse($Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None).UtcDateTime.Ticks
    } catch { return $null }
}

function Test-SameInstalledProcess {
    param($Saved, $Current)
    if (-not $Saved -or -not $Current -or -not $Saved.executable -or -not $Current.executable) { return $false }
    if ($Saved.pid -ne $Current.pid -or -not $Saved.executable.Equals($Current.executable, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    $taskSavedTicks = Get-ProcessStartUtcTicks -Value $Saved.startTimeUtc
    $taskCurrentTicks = Get-ProcessStartUtcTicks -Value $Current.startTimeUtc
    return $null -ne $taskSavedTicks -and $null -ne $taskCurrentTicks -and $taskSavedTicks -eq $taskCurrentTicks
}

function Resolve-RecordedInjectorIdentity {
    param($Saved, $Current, [string]$ExpectedExecutable)
    # Older startup records could capture Path before Node had finished becoming queryable.
    # Recovery still requires the originally selected runtime plus the exact PID and creation time.
    if (-not $Saved -or -not $Current -or -not $ExpectedExecutable -or -not $Current.executable -or
        -not $Current.executable.Equals($ExpectedExecutable,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Statistics runtime identity does not match; nothing was stopped.'
    }
    $taskCandidate = [ordered]@{pid=$Saved.pid;executable=$Saved.executable;startTimeUtc=$Saved.startTimeUtc}
    if (-not $taskCandidate.executable) { $taskCandidate.executable = $ExpectedExecutable }
    if (-not (Test-SameInstalledProcess $taskCandidate $Current)) {
        throw 'Statistics process identity changed; nothing was stopped.'
    }
    return $taskCandidate
}

function Stop-RecordedInstalledProcess {
    param($Identity)
    if (-not $Identity) { return }
    $taskCurrent = Get-InstalledProcessIdentity -ProcessId $Identity.pid
    if (-not $taskCurrent) { return }
    if (-not (Test-SameInstalledProcess -Saved $Identity -Current $taskCurrent)) {
        throw 'Recorded process identity does not match (PID, executable, or creation time); it was left untouched.'
    }
    $taskProcess = Get-Process -Id $Identity.pid -ErrorAction Stop
    # Close only this recorded process, not every installed-client process or its agent tree.
    $taskProcess.Kill()
    if (-not $taskProcess.WaitForExit(5000)) { throw 'Recorded installed process did not exit.' }
}

Export-ModuleMember -Function Test-InstalledExecutable,Get-InstalledProcessIdentity,Test-SameInstalledProcess,Stop-RecordedInstalledProcess,Resolve-RecordedInjectorIdentity
