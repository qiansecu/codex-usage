Set-StrictMode -Version Latest

function Get-UsageLaunchOptions {
    param([string]$AppRoot)
    $usagePath = Join-Path $AppRoot 'settings.local.json'
    if (-not (Test-Path -LiteralPath $usagePath)) { return @{} }
    $usageRaw = Get-Content -LiteralPath $usagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $usageResult = @{}
    foreach ($usageName in @('nodeExecutable','pythonExecutable','codexHome')) {
        $usageValue = $usageRaw.PSObject.Properties[$usageName]
        if ($usageValue) {
            if ($usageValue.Value -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($usageValue.Value)) { throw "Invalid local launch setting: $usageName" }
            $usageResult[$usageName] = [IO.Path]::GetFullPath($usageValue.Value)
        }
    }
    return $usageResult
}

function Save-UsageLaunchOptions {
    param([string]$AppRoot, [string]$NodeExecutable, [string]$PythonExecutable, [string]$CodexHome)
    $usageValues = [ordered]@{nodeExecutable=$NodeExecutable;pythonExecutable=$PythonExecutable;codexHome=$CodexHome}
    foreach ($usageValue in $usageValues.Values) {
        if (-not [IO.Path]::IsPathFullyQualified($usageValue)) { throw 'Launch settings require absolute paths.' }
    }
    $usageValues | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $AppRoot 'settings.local.json') -Encoding UTF8
}

function Wait-UsageReady {
    param([string]$RuntimeDirectory, [DateTimeOffset]$StartedAt, [int]$TimeoutMilliseconds = 15000)
    $usageDeadline = [DateTimeOffset]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    do {
        $usageStatus = $null
        try { $usageStatus = Get-Content -LiteralPath (Join-Path $RuntimeDirectory 'status.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
        $usageStatusAt = $null
        try {
            if ($usageStatus -and $usageStatus.PSObject.Properties['at']) {
                $usageStatusAt = if ($usageStatus.at -is [DateTime]) { [DateTimeOffset]$usageStatus.at } else { [DateTimeOffset]::Parse($usageStatus.at) }
            }
        } catch { }
        if ($null -ne $usageStatusAt -and $usageStatusAt -ge $StartedAt) {
            if ($usageStatus.stage -eq 'error') { throw ('Statistics startup failed: ' + $usageStatus.error) }
            if ($usageStatus.stage -eq 'usage-status' -and $usageStatus.state -eq 'updated') { return }
        }
        if ([DateTimeOffset]::UtcNow -ge $usageDeadline) { break }
        Start-Sleep -Milliseconds 150
    } while ($true)
    throw 'Statistics startup was not confirmed; see runtime-installed\injector-error.log.'
}

function Install-UsageShortcuts {
    param([string]$ProjectRoot, [string]$TestRoot)
    $usageExe = Join-Path $ProjectRoot 'launcher\ChatGPT-Usage.exe'
    if (-not (Test-Path -LiteralPath $usageExe)) {
        try {
            & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $ProjectRoot 'scripts\build-launcher.ps1')
            if ($LASTEXITCODE -ne 0) { Write-Warning 'Quiet launcher build unavailable; shortcuts will use PowerShell directly.' }
        } catch { Write-Warning 'Quiet launcher build unavailable; shortcuts will use PowerShell directly.' }
    }
    $usageArguments = @('-NoProfile','-File',(Join-Path $ProjectRoot 'launcher\set-start-entry.ps1'))
    if ($TestRoot) { $usageArguments += @('-TestRoot',[IO.Path]::GetFullPath($TestRoot)) }
    & (Join-Path $PSHOME 'pwsh.exe') @usageArguments
    if ($LASTEXITCODE -ne 0) { throw 'Independent shortcut setup failed; existing shortcuts were left protected. See runtime-installed\shortcut-error.json.' }
}

Export-ModuleMember -Function Get-UsageLaunchOptions,Save-UsageLaunchOptions,Wait-UsageReady,Install-UsageShortcuts
