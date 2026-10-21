$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'runtime-helpers.psm1') -Force
$usageNode = Resolve-UsageRuntime -Kind Node
& $usageNode (Join-Path $PSScriptRoot 'build-ui.mjs')
if ($LASTEXITCODE -ne 0) { throw 'UI generation failed.' }
