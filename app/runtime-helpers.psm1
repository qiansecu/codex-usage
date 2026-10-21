Set-StrictMode -Version Latest

function Test-UsageRuntimeVersion {
    param([ValidateSet('Node','Python')][string]$Kind, [string]$VersionText)
    if ($Kind -eq 'Node' -and $VersionText -match '^v(\d+)\.(\d+)\.(\d+)') { return [int]$Matches[1] -ge 22 }
    if ($Kind -eq 'Python' -and $VersionText -match '^Python (\d+)\.(\d+)\.(\d+)') {
        return [int]$Matches[1] -gt 3 -or ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -ge 10)
    }
    return $false
}

function Resolve-UsageRuntime {
    param([ValidateSet('Node','Python')][string]$Kind, [string]$ExplicitPath)
    $usageVariable = if ($Kind -eq 'Node') { 'CODEX_USAGE_NODE' } else { 'CODEX_USAGE_PYTHON' }
    if (-not $ExplicitPath) { $ExplicitPath = [Environment]::GetEnvironmentVariable($usageVariable) }
    $usageCandidates = @()
    if ($ExplicitPath) {
        if (-not [IO.Path]::IsPathFullyQualified($ExplicitPath)) { throw "$usageVariable must be an absolute executable path." }
        $usageCandidates = @($ExplicitPath)
    } else {
        $usageCommand = if ($Kind -eq 'Node') { 'node.exe' } else { 'python.exe' }
        $usageCandidates += @(Get-Command $usageCommand -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object Source)
        $usageCache = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache\codex-runtimes\codex-primary-runtime\dependencies'
        $usageCandidates += if ($Kind -eq 'Node') { Join-Path $usageCache 'node\bin\node.exe' } else { Join-Path $usageCache 'python\python.exe' }
    }
    foreach ($usageCandidate in ($usageCandidates | Select-Object -Unique)) {
        # Ignore Microsoft's Python Store launcher alias; it is not a usable interpreter.
        if (-not $ExplicitPath -and $Kind -eq 'Python' -and $usageCandidate -match '\\Microsoft\\WindowsApps\\') { continue }
        if (-not (Test-Path -LiteralPath $usageCandidate -PathType Leaf)) { continue }
        $usageVersion = (& $usageCandidate --version 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -eq 0 -and (Test-UsageRuntimeVersion -Kind $Kind -VersionText $usageVersion)) { return [IO.Path]::GetFullPath($usageCandidate) }
    }
    $usageMinimum = if ($Kind -eq 'Node') { 'Node.js 22+' } else { 'Python 3.10+' }
    throw "Cannot find $usageMinimum. Install it on PATH or set $usageVariable to its absolute executable path."
}

Export-ModuleMember -Function Resolve-UsageRuntime,Test-UsageRuntimeVersion
