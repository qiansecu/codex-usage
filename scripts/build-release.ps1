param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$usageRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'update-helpers.psm1') -Force
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $usageRoot 'dist' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$usageVersion = (Get-Content -LiteralPath (Join-Path $usageRoot 'app/version.json') -Raw | ConvertFrom-Json).version
if ($usageVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version.' }
$usageArchive = Join-Path $OutputDirectory 'codex-usage.zip'
if (Test-Path -LiteralPath $usageArchive) { throw 'Release output already exists; select an empty output directory.' }
Add-Type -AssemblyName System.IO.Compression
$usageZip = [IO.Compression.ZipFile]::Open($usageArchive,[IO.Compression.ZipArchiveMode]::Create)
$usageFiles = @()
try {
    foreach ($name in Get-UsageSourceFiles $usageRoot) {
        $path = Join-Path $usageRoot $name
        if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Release source must not contain reparse points.' }
        $bytes = [IO.File]::ReadAllBytes($path)
        $usageFiles += @{path=$name;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();size=$bytes.Length}
        $stream = $usageZip.CreateEntry($name).Open()
        try { $stream.Write($bytes) } finally { $stream.Dispose() }
    }
    $usageManifest = @{schema=1;version=$usageVersion;files=$usageFiles} | ConvertTo-Json -Depth 6
    $stream = $usageZip.CreateEntry('manifest.json').Open()
    try { $stream.Write([Text.Encoding]::UTF8.GetBytes($usageManifest)) } finally { $stream.Dispose() }
} finally { $usageZip.Dispose() }
Write-Host ('Built version ' + $usageVersion + ' with ' + $usageFiles.Count + ' source files: ' + $usageArchive)
