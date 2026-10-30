$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'update-helpers.psm1') -Force
$usageBase = Join-Path $PSScriptRoot 'runtime-update-tests'
$usageFixture = Join-Path $usageBase ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $usageFixture -Force | Out-Null
$usageChecks = 0
function Assert-Update([bool]$Condition,[string]$Name) {
    if (-not $Condition) { throw $Name }
    $script:usageChecks++
}
function Assert-Rejected([scriptblock]$Operation,[string]$Name) {
    $rejected = $false
    try { & $Operation | Out-Null } catch { $rejected = $true }
    Assert-Update $rejected $Name
}
function Write-FixtureFile([string]$Root,[string]$Name,[string]$Text) {
    $file = Join-Path $Root $Name
    New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force | Out-Null
    [IO.File]::WriteAllText($file,$Text)
}
function New-Fixture([string]$Name) {
    $root = Join-Path $usageFixture $Name
    foreach ($file in @('app/injector.mjs','scripts/update-helpers.psm1','scripts/launch.ps1','start.cmd')) { Write-FixtureFile $root $file 'old fixture' }
    Write-FixtureFile $root 'app/version.json' '{"version":"1.0.0"}'
    Write-FixtureFile $root 'app/settings.local.json' '{"private":"preserved fixture"}'
    Save-UsageUpdateBaseline $root
    return $root
}
function New-Archive([string]$Name,[hashtable]$Extra = @{}) {
    $files = @{'app/version.json'='{"version":"1.1.0"}';'app/injector.mjs'='new fixture';'scripts/update-helpers.psm1'='new helper';'scripts/launch.ps1'='new entry';'start.cmd'='new start'}
    foreach ($key in $Extra.Keys) { $files[$key] = $Extra[$key] }
    $archive = Join-Path $usageFixture ($Name+'.zip')
    $zip = [IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
    $manifestFiles = @()
    try {
        foreach ($key in $files.Keys) {
            $bytes = [Text.Encoding]::UTF8.GetBytes($files[$key])
            $manifestFiles += @{path=$key;sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant();size=$bytes.Length}
            $stream = $zip.CreateEntry($key).Open()
            try { $stream.Write($bytes) } finally { $stream.Dispose() }
        }
        $stream = $zip.CreateEntry('manifest.json').Open()
        try { $stream.Write([Text.Encoding]::UTF8.GetBytes((@{schema=1;version='1.1.0';files=$manifestFiles}|ConvertTo-Json -Depth 6))) } finally { $stream.Dispose() }
    } finally { $zip.Dispose() }
    return $archive
}
try {
    Add-Type -AssemblyName System.IO.Compression
    foreach ($name in @('../outside.ps1','app/../../outside.ps1','app\injector.mjs','app/runtime-installed/session.json','app/settings.local.json','launcher/tool.exe','docs/CON.txt','docs/bad. /x.txt')) {
        Assert-Update (-not (Test-UsageUpdatePath $name)) ('Unsafe update path rejected: '+$name)
    }
    Assert-Update (Test-UsageUpdatePath 'app/runtime-helpers.psm1') 'Runtime helper source is included, distinct from private runtime directories'
    $root = New-Fixture 'roundtrip'
    $archive = New-Archive 'valid'
    $hash = (Get-FileHash -LiteralPath $archive).Hash.ToLowerInvariant()
    $asset = @{name='codex-usage.zip';browser_download_url='https://github.com/qiansecu/codex-usage/releases/download/v1.1.0/codex-usage.zip';digest=('sha256:'+$hash);size=(Get-Item $archive).Length}
    $release = @{draft=$false;prerelease=$false;tag_name='v1.1.0';assets=@($asset)}
    Assert-Update ((Get-UsageReleaseAsset $release '1.0.0').version -eq '1.1.0') 'New stable release selected'
    Assert-Update ($null -eq (Get-UsageReleaseAsset $release '1.1.0')) 'Equal version is not downloaded'
    $release.prerelease=$true
    Assert-Update ($null -eq (Get-UsageReleaseAsset $release '1.0.0')) 'Pre-release is never silently installed'
    $release.prerelease=$false
    $asset.browser_download_url='https://example.invalid/archive.zip'
    Assert-Rejected { Get-UsageReleaseAsset $release '1.0.0' } 'Foreign archive origin rejected'
    $asset.browser_download_url='https://github.com/qiansecu/codex-usage/releases/download/v1.1.0/codex-usage.zip'
    Assert-Rejected { Install-UsageUpdateArchive $root $archive ('0'*64) '1.1.0' } 'Corrupt download rejected before source mutation'
    Assert-Update ((Get-Content (Join-Path $root 'app/injector.mjs') -Raw) -eq 'old fixture') 'Failed checksum leaves old version intact'
    $result = Install-UsageUpdateArchive $root $archive $hash '1.1.0'
    Assert-Update ($result.state -eq 'updated' -and (Get-Content (Join-Path $root 'app/injector.mjs') -Raw) -eq 'new fixture') 'Validated archive replaces managed source'
    Assert-Update ((Get-Content (Join-Path $root 'app/settings.local.json') -Raw) -eq '{"private":"preserved fixture"}') 'Private settings are preserved'
    Restore-UsageUpdate $root
    Assert-Update ((Get-Content (Join-Path $root 'app/injector.mjs') -Raw) -eq 'old fixture') 'Rollback restores previous source'
    Assert-Update ((Get-Content (Join-Path $root 'app/runtime-updates/rejected-version.txt')).Trim() -eq '1.1.0') 'Failed version is remembered to prevent an update loop'
    $dirty = New-Fixture 'dirty'
    Write-FixtureFile $dirty 'app/injector.mjs' 'user changes'
    Assert-Rejected { Install-UsageUpdateArchive $dirty $archive $hash '1.1.0' } 'User edits block automatic replacement'
    $unsafe = New-Archive 'unsafe' @{'../outside.ps1'='unsafe fixture'}
    Assert-Rejected { Install-UsageUpdateArchive (New-Fixture 'unsafe-target') $unsafe (Get-FileHash $unsafe).Hash '1.1.0' } 'Traversal archive rejected before writes'
    $unmanaged = New-Fixture 'unmanaged'
    Write-FixtureFile $unmanaged 'docs/new.md' 'user-owned file'
    $collision = New-Archive 'collision' @{'docs/new.md'='release file'}
    Assert-Rejected { Install-UsageUpdateArchive $unmanaged $collision (Get-FileHash $collision).Hash '1.1.0' } 'New release cannot overwrite an unmanaged local file'
    $network = New-Fixture 'offline'
    $result = Invoke-UsageAutoUpdate $network -FetchRelease { throw 'synthetic offline' } -Download { throw 'must not download' }
    Assert-Update ($result.state -eq 'unavailable' -and (Get-Content (Join-Path $network 'app/injector.mjs') -Raw) -eq 'old fixture') 'Offline check leaves an installed version launchable'
    $auto = New-Fixture 'auto'
    $result = Invoke-UsageAutoUpdate $auto -FetchRelease { $release } -Download { param($url,$file) [IO.File]::Copy($archive,$file) }
    Assert-Update ($result.state -eq 'updated') 'Automatic check/download/validation/install works end to end with a synthetic release'
    $result = Invoke-UsageAutoUpdate $auto -FetchRelease { throw 'must use cached check' }
    Assert-Update ($result.state -eq 'cached') 'Repeated launches do not repeatedly call GitHub'
    $rollback = New-Fixture 'edited-after-update'
    Install-UsageUpdateArchive $rollback $archive $hash '1.1.0' | Out-Null
    Write-FixtureFile $rollback 'app/injector.mjs' 'new user edits'
    Assert-Rejected { Restore-UsageUpdate $rollback } 'Rollback preserves edits made after the update'
    $interrupted = New-Fixture 'interrupted'
    Write-FixtureFile $interrupted 'docs' 'a user-owned file blocks the new directory'
    $blocked = New-Archive 'blocked' @{'docs/new.md'='release file'}
    Assert-Rejected { Install-UsageUpdateArchive $interrupted $blocked (Get-FileHash $blocked).Hash '1.1.0' } 'Mid-install filesystem failure rolls back the transaction'
    Assert-Update ((Get-Content (Join-Path $interrupted 'app/injector.mjs') -Raw) -eq 'old fixture') 'Files replaced before an install failure are restored'
    Assert-Update ((Get-Content (Join-Path $interrupted 'app/version.json') -Raw | ConvertFrom-Json).version -eq '1.0.0') 'Failed update retains the old installed version'
    Write-Host "$usageChecks update checks passed. No network, real installation or client was operated."
} finally {
    $resolved = [IO.Path]::GetFullPath($usageFixture)
    $boundary = [IO.Path]::GetFullPath($usageBase).TrimEnd('\')+'\'
    if (-not $resolved.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected update fixture path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
