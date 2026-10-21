$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'runtime-helpers.psm1') -Force
$usageChecks = 0
function Assert-Runtime([bool]$Condition, [string]$Name) {
    if (-not $Condition) { throw $Name }
    $script:usageChecks++
}
Assert-Runtime (Test-UsageRuntimeVersion Node 'v22.0.0') 'minimum Node accepted'
Assert-Runtime (-not (Test-UsageRuntimeVersion Node 'v20.19.0')) 'old Node rejected'
Assert-Runtime (Test-UsageRuntimeVersion Python 'Python 3.10.0') 'minimum Python accepted'
Assert-Runtime (-not (Test-UsageRuntimeVersion Python 'Python 3.9.20')) 'old Python rejected'
Assert-Runtime (-not (Test-UsageRuntimeVersion Python 'not a version')) 'invalid version rejected'
foreach ($usageKind in @('Node','Python')) {
    $usagePath = Resolve-UsageRuntime -Kind $usageKind
    Assert-Runtime ([IO.Path]::IsPathFullyQualified($usagePath)) "$usageKind resolves to an absolute path"
    Assert-Runtime ((Resolve-UsageRuntime -Kind $usageKind -ExplicitPath $usagePath) -eq $usagePath) "$usageKind explicit path retained"
}
$usageRejected = $false
try { Resolve-UsageRuntime -Kind Node -ExplicitPath (Join-Path $PSScriptRoot ('missing-' + [Guid]::NewGuid() + '.exe')) | Out-Null } catch { $usageRejected = $true }
Assert-Runtime $usageRejected 'explicit missing executable rejected without silently selecting another'
Write-Host "$usageChecks runtime checks passed."
