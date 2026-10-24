param([string]$CodexHome)
$ErrorActionPreference = 'Stop'
$usageProject = Split-Path -Parent $PSScriptRoot
$usageSettings = Join-Path $usageProject 'app\settings.local.json'
if (-not (Test-Path -LiteralPath $usageSettings -PathType Leaf)) {
    & (Join-Path $PSScriptRoot 'setup.ps1') -CodexHome $CodexHome
} else {
    & (Join-Path $usageProject 'app\start-installed.ps1') -CodexHome $CodexHome
}
