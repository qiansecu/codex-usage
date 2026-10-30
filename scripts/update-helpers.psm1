Set-StrictMode -Version Latest

function Get-UsageSourceFiles {
    param([string]$ProjectRoot)
    # Installation artifacts, local settings and runtime records never belong to an update.
    $root = [IO.Path]::GetFullPath($ProjectRoot)
    $files = [Collections.Generic.List[string]]::new()
    foreach ($directory in @('app','scripts','launcher','docs','.github')) {
        $base = Join-Path $root $directory
        if (-not (Test-Path -LiteralPath $base)) { continue }
        foreach ($file in Get-ChildItem -LiteralPath $base -File -Recurse) {
            $relative = [IO.Path]::GetRelativePath($root,$file.FullName).Replace('\','/')
            if (Test-UsageUpdatePath $relative) { $files.Add($relative) }
        }
    }
    foreach ($name in @('README.md','start.cmd','.gitignore','.gitattributes')) {
        if (Test-Path -LiteralPath (Join-Path $root $name)) { $files.Add($name) }
    }
    return @($files | Sort-Object -Unique)
}

function Test-UsageUpdatePath {
    param([string]$Name)
    if ($Name -match '[\\:\x00-\x1f<>"|?*]' -or $Name -match '(^|/)\.{1,2}(/|$)' -or $Name -match '(^|/)[^/]*[. ](/|$)' -or $Name -match '(^|/)(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|/|$)') { return $false }
    if ($Name -in @('README.md','start.cmd','.gitignore','.gitattributes')) { return $true }
    if ($Name -notmatch '^(app|scripts|launcher|docs|\.github)/') { return $false }
    if ($Name -match '(?i)(^|/)(runtime[^/]*|state|profile|node_modules|test-fixtures|__pycache__)/|(^|/)(auth\.json|config\.toml)$|\.local\.json$|/footer-page\.js$|/last-launch\.') { return $false }
    return $Name -match '\.(mjs|js|py|ps1|psm1|cmd|cs|md|json|png|yml|yaml|txt)$' -or $Name -eq 'docs/LICENSE'
}

function Assert-UsageUpdateLocation {
    param([string]$ProjectRoot,[string]$Name)
    if (-not (Test-UsageUpdatePath $Name)) { throw 'Unsupported update file path.' }
    $root = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $current = $root
    if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Update root is a reparse point.' }
    foreach ($part in $Name.Split('/')) {
        $current = Join-Path $current $part
        if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Update path is a reparse point.' }
    }
    return $current
}

function Get-UsageUpdateDirectory {
    param([string]$ProjectRoot)
    $root = [IO.Path]::GetFullPath($ProjectRoot)
    foreach ($part in @('app','runtime-updates')) {
        $root = Join-Path $root $part
        if (Test-Path -LiteralPath $root) {
            if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Update state is a reparse point.' }
        } else { New-Item -ItemType Directory -Path $root | Out-Null }
    }
    return $root
}

function Save-UsageUpdateBaseline {
    param([string]$ProjectRoot)
    $directory = Get-UsageUpdateDirectory $ProjectRoot
    $file = Join-Path $directory 'baseline.json'
    if (Test-Path -LiteralPath $file) { return }
    $hashes = [ordered]@{}
    foreach ($name in Get-UsageSourceFiles $ProjectRoot) {
        $path = Assert-UsageUpdateLocation $ProjectRoot $name
        $hashes[$name] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    [ordered]@{version=(Get-Content -LiteralPath (Join-Path $ProjectRoot 'app/version.json') -Raw | ConvertFrom-Json).version;files=$hashes} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $file -Encoding utf8
}

function Get-UsageReleaseAsset {
    param($Release,[string]$CurrentVersion)
    if ($Release.draft -or $Release.prerelease -or $Release.tag_name -notmatch '^v(\d+\.\d+\.\d+)$') { return $null }
    $version = $Matches[1]
    if ([version]$version -le [version]$CurrentVersion) { return $null }
    $assets = @($Release.assets | Where-Object { $_.name -ceq 'codex-usage.zip' })
    if ($assets.Count -ne 1) { throw 'Release archive is missing or ambiguous.' }
    $asset = $assets[0]
    $expected = 'https://github.com/qiansecu/codex-usage/releases/download/' + $Release.tag_name + '/codex-usage.zip'
    if ($asset.browser_download_url -cne $expected -or $asset.digest -notmatch '^sha256:[0-9a-f]{64}$' -or $asset.size -le 0 -or $asset.size -gt 20MB) { throw 'Release archive metadata is invalid.' }
    return @{version=$version;url=$expected;sha256=$asset.digest.Substring(7);size=[long]$asset.size}
}

function Install-UsageUpdateArchive {
    param([string]$ProjectRoot,[string]$Archive,[string]$ExpectedHash,[string]$ExpectedVersion)
    $root = [IO.Path]::GetFullPath($ProjectRoot)
    $directory = Get-UsageUpdateDirectory $root
    $baselineFile = Join-Path $directory 'baseline.json'
    $baseline = Get-Content -LiteralPath $baselineFile -Raw | ConvertFrom-Json -AsHashtable
    if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ine $ExpectedHash) { throw 'Update archive checksum mismatch.' }
    foreach ($name in $baseline.files.Keys) {
        $file = Assert-UsageUpdateLocation $root $name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file).Hash -ine $baseline.files[$name]) { throw 'Local source changes found; automatic update postponed.' }
    }
    Add-Type -AssemblyName System.IO.Compression
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    $content = [Collections.Generic.Dictionary[string,byte[]]]::new([StringComparer]::OrdinalIgnoreCase)
    try {
        if ($zip.Entries.Count -gt 512) { throw 'Too many archive entries.' }
        $total = 0L
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName
            if ($name -cne 'manifest.json' -and -not (Test-UsageUpdatePath $name)) { throw 'Unsafe or unsupported archive path.' }
            if ($content.ContainsKey($name) -or $entry.Length -gt 5MB -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Duplicate, oversized or symbolic archive entry.' }
            $total += $entry.Length
            if ($total -gt 20MB) { throw 'Update archive is too large.' }
            $stream = $entry.Open(); $memory = [IO.MemoryStream]::new()
            try { $stream.CopyTo($memory); $content.Add($name,$memory.ToArray()) } finally { $stream.Dispose(); $memory.Dispose() }
        }
    } finally { $zip.Dispose() }
    $manifest = [Text.Encoding]::UTF8.GetString($content['manifest.json']) | ConvertFrom-Json -AsHashtable
    if ($manifest.schema -ne 1 -or $manifest.version -cne $ExpectedVersion -or $manifest.files.Count -ne $content.Count - 1) { throw 'Invalid update manifest.' }
    $newHashes = @{}
    foreach ($record in $manifest.files) {
        $name = [string]$record.path
        $null = Assert-UsageUpdateLocation $root $name
        if ($newHashes.ContainsKey($name) -or -not $content.ContainsKey($name)) { throw 'Invalid manifest file list.' }
        $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($content[$name])).ToLowerInvariant()
        if ($hash -cne $record.sha256 -or $content[$name].Length -ne $record.size) { throw 'Update file checksum mismatch.' }
        if ((Test-Path -LiteralPath (Join-Path $root $name)) -and -not $baseline.files.ContainsKey($name)) { throw 'Update would overwrite an unmanaged local file.' }
        $newHashes[$name] = $hash
    }
    foreach ($required in @('app/version.json','app/injector.mjs','scripts/update-helpers.psm1','scripts/launch.ps1','start.cmd')) {
        if (-not $newHashes.ContainsKey($required)) { throw 'Required update source is missing.' }
    }
    if (([Text.Encoding]::UTF8.GetString($content['app/version.json']) | ConvertFrom-Json).version -cne $ExpectedVersion) { throw 'Archive version mismatch.' }
    $backup = Join-Path $directory ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup | Out-Null
    $changes = @()
    # All validation completes before the first source file is touched. Version is committed last.
    $names = @(@($baseline.files.Keys) + @($newHashes.Keys) | Sort-Object -Unique | Sort-Object { $_ -eq 'app/version.json' })
    foreach ($name in $names) {
        $path = Assert-UsageUpdateLocation $root $name
        $exists = Test-Path -LiteralPath $path -PathType Leaf
        if ($exists) {
            $copy = Join-Path $backup $name
            New-Item -ItemType Directory -Path (Split-Path -Parent $copy) -Force | Out-Null
            [IO.File]::Copy($path,$copy)
        }
        $changes += @{path=$name;existed=$exists;hash=$newHashes[$name]}
    }
    [IO.File]::Copy($baselineFile,(Join-Path $backup 'baseline.json'))
    $transaction = @{backup=[IO.Path]::GetFileName($backup);version=$ExpectedVersion;changes=$changes}
    $transaction | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $directory 'transaction.json') -Encoding utf8
    try {
        foreach ($change in $changes) {
            $path = Assert-UsageUpdateLocation $root $change.path
            if ($content.ContainsKey($change.path)) {
                New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
                [IO.File]::WriteAllBytes($path + '.update-tmp',$content[$change.path])
                [IO.File]::Move($path + '.update-tmp',$path,$true)
            } elseif (Test-Path -LiteralPath $path -PathType Leaf) { [IO.File]::Delete($path) }
        }
        @{version=$ExpectedVersion;files=$newHashes} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $baselineFile -Encoding utf8
    } catch {
        Restore-UsageUpdate -ProjectRoot $root -DuringInstall
        throw
    }
    return @{state='updated';version=$ExpectedVersion}
}

function Restore-UsageUpdate {
    param([string]$ProjectRoot,[switch]$DuringInstall)
    $directory = Get-UsageUpdateDirectory $ProjectRoot
    $transaction = Get-Content -LiteralPath (Join-Path $directory 'transaction.json') -Raw | ConvertFrom-Json -AsHashtable
    if ($transaction.backup -notmatch '^[a-f0-9]{32}$') { throw 'Invalid update backup.' }
    $backup = Join-Path $directory $transaction.backup
    if ((Get-Item -LiteralPath $backup).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Update backup is a reparse point.' }
    foreach ($change in $transaction.changes) {
        $path = Assert-UsageUpdateLocation $ProjectRoot $change.path
        if (-not $DuringInstall -and (Test-Path -LiteralPath $path) -and $change.hash -and (Get-FileHash -LiteralPath $path).Hash -ine $change.hash) { throw 'Updated source was edited; automatic rollback postponed.' }
        if ($change.existed) {
            $copy = Assert-UsageUpdateLocation $backup $change.path
            $oldHashes = Get-Content -LiteralPath (Join-Path $backup 'baseline.json') -Raw | ConvertFrom-Json -AsHashtable
            if (-not $oldHashes.files.ContainsKey($change.path) -or (Get-FileHash -LiteralPath $copy).Hash -ine $oldHashes.files[$change.path]) { throw 'Update backup integrity check failed.' }
        }
    }
    foreach ($change in $transaction.changes) {
        $path = Assert-UsageUpdateLocation $ProjectRoot $change.path
        if ($change.existed) { [IO.File]::Copy((Join-Path $backup $change.path),$path,$true) }
        elseif (Test-Path -LiteralPath $path -PathType Leaf) { [IO.File]::Delete($path) }
    }
    [IO.File]::Copy((Join-Path $backup 'baseline.json'),(Join-Path $directory 'baseline.json'),$true)
    $transaction.version | Set-Content -LiteralPath (Join-Path $directory 'rejected-version.txt') -Encoding utf8
}

function Invoke-UsageAutoUpdate {
    param([string]$ProjectRoot,[scriptblock]$FetchRelease = { Invoke-RestMethod -Uri 'https://api.github.com/repos/qiansecu/codex-usage/releases/latest' -Headers @{'User-Agent'='Codex-Usage-Updater';Accept='application/vnd.github+json'} -TimeoutSec 5 },[scriptblock]$Download = { param($url,$file) Invoke-WebRequest -Uri $url -OutFile $file -TimeoutSec 10 })
    $directory = Get-UsageUpdateDirectory $ProjectRoot
    $lock = $null
    try {
        $lock = [IO.File]::Open((Join-Path $directory 'update.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        if (Test-Path -LiteralPath (Join-Path $ProjectRoot '.git')) { return @{state='development-checkout'} }
        if ($env:CODEX_USAGE_AUTO_UPDATE -eq '0') { return @{state='disabled'} }
        if (-not (Test-Path -LiteralPath (Join-Path $directory 'baseline.json'))) { return @{state='needs-setup'} }
        $checked = Join-Path $directory 'checked-at.txt'
        if (Test-Path -LiteralPath $checked) {
            $last = [DateTimeOffset]::Parse((Get-Content -LiteralPath $checked -Raw).Trim())
            if ([DateTimeOffset]::UtcNow - $last -lt [TimeSpan]::FromHours(6)) { return @{state='cached'} }
        }
        $current = (Get-Content -LiteralPath (Join-Path $ProjectRoot 'app/version.json') -Raw | ConvertFrom-Json).version
        $release = & $FetchRelease
        $asset = Get-UsageReleaseAsset $release $current
        if (-not $asset) {
            [DateTimeOffset]::UtcNow.ToString('o') | Set-Content -LiteralPath $checked -Encoding utf8
            return @{state='current'}
        }
        $rejected = Join-Path $directory 'rejected-version.txt'
        if ((Test-Path -LiteralPath $rejected) -and (Get-Content -LiteralPath $rejected -Raw).Trim() -eq $asset.version) { return @{state='previously-rejected'} }
        $archive = Join-Path $directory 'download.zip'
        & $Download $asset.url $archive
        if ((Get-Item -LiteralPath $archive).Length -ne $asset.size) { throw 'Incomplete update download.' }
        $result = Install-UsageUpdateArchive $ProjectRoot $archive $asset.sha256 $asset.version
        [DateTimeOffset]::UtcNow.ToString('o') | Set-Content -LiteralPath $checked -Encoding utf8
        return $result
    } catch {
        # Failure to check/download must not prevent an already installed version from starting.
        @{at=[DateTimeOffset]::UtcNow.ToString('o');state='update-unavailable';error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'update-status.json') -Encoding utf8
        return @{state='unavailable'}
    } finally { if ($lock) { $lock.Dispose() } }
}

Export-ModuleMember -Function Get-UsageSourceFiles,Test-UsageUpdatePath,Save-UsageUpdateBaseline,Get-UsageReleaseAsset,Install-UsageUpdateArchive,Restore-UsageUpdate,Invoke-UsageAutoUpdate
