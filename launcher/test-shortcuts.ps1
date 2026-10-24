$ErrorActionPreference = 'Stop'
$usageFixture = Join-Path $PSScriptRoot ('test-fixtures\' + [Guid]::NewGuid().ToString('N') + '-中文 Ж ' + [char]::ConvertFromUtf32(0x1F680))
Import-Module (Join-Path $PSScriptRoot 'shortcut-helpers.psm1') -Force
$usageChecks = 0
function Assert-Shortcut([bool]$Condition, [string]$Name) {
    if (-not $Condition) { throw $Name }
    $script:usageChecks++
}
New-Item -ItemType Directory -Path (Join-Path $usageFixture 'desktop'),(Join-Path $usageFixture 'menu') -Force | Out-Null
$usageDesktop = Join-Path $usageFixture 'desktop\ChatGPT（统计）.lnk'
$usageMenu = Join-Path $usageFixture 'menu\ChatGPT（统计）.lnk'
Write-UsageShortcut -Path $usageDesktop -TargetPath (Join-Path $PSScriptRoot 'ChatGPT-Usage.exe') -Description 'Synthetic original for recovery testing'
$usageOriginalHash = (Get-FileHash -LiteralPath $usageDesktop).Hash
$usageOrdinary = @{}
foreach ($usageFolder in @('desktop','menu')) {
    $usageNormalPath = Join-Path $usageFixture ($usageFolder + '\ChatGPT.lnk')
    Write-UsageShortcut -Path $usageNormalPath -TargetPath (Join-Path $env:WINDIR 'notepad.exe')
    $usageOrdinary[$usageNormalPath] = (Get-FileHash -LiteralPath $usageNormalPath).Hash
}
function Run-ShortcutSetup([switch]$Undo, [switch]$DirectScript) {
    $usageArgs = @('-NoProfile','-File',(Join-Path $PSScriptRoot 'set-start-entry.ps1'),'-TestRoot',$usageFixture)
    if ($Undo) { $usageArgs += '-Restore' }
    if ($DirectScript) { $usageArgs += '-ScriptMode' }
    & (Join-Path $PSHOME 'pwsh.exe') @usageArgs 2>&1 | Out-Null
    return $LASTEXITCODE
}
try {
    $usageUnicodeDirectory = Join-Path $usageFixture '目标 中文 Ж'
    New-Item -ItemType Directory -Path $usageUnicodeDirectory -Force | Out-Null
    $usageUnicodeTarget = Join-Path $usageUnicodeDirectory '启动器.exe'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ChatGPT-Usage.exe') -Destination $usageUnicodeTarget
    $usageUnicodeLink = Join-Path $usageUnicodeDirectory ('统计-' + [char]::ConvertFromUtf32(0x1F680) + '.lnk')
    $usageUnicodeArguments = '--example "中文 Ж ' + [char]::ConvertFromUtf32(0x1F680) + '"'
    Write-UsageShortcut -Path $usageUnicodeLink -TargetPath $usageUnicodeTarget -Arguments $usageUnicodeArguments -WorkingDirectory $usageUnicodeDirectory -Description '中文 Ж shortcut' -IconPath $usageUnicodeTarget -IconIndex 0
    $usageUnicodeInfo = Read-UsageShortcut -Path $usageUnicodeLink
    Assert-Shortcut (Test-Path -LiteralPath $usageUnicodeLink) 'exact Unicode filename exists without ANSI substitutions'
    Assert-Shortcut ($usageUnicodeInfo.TargetPath -ceq $usageUnicodeTarget) 'Unicode target path survives save and load'
    Assert-Shortcut ($usageUnicodeInfo.Arguments -ceq $usageUnicodeArguments) 'Unicode arguments survive save and load'
    Assert-Shortcut ($usageUnicodeInfo.WorkingDirectory -ceq $usageUnicodeDirectory) 'Unicode working directory survives save and load'
    Assert-Shortcut ($usageUnicodeInfo.Description -ceq '中文 Ж shortcut') 'Unicode description survives save and load'
    Assert-Shortcut ($usageUnicodeInfo.IconPath -ceq $usageUnicodeTarget -and $usageUnicodeInfo.IconIndex -eq 0) 'Unicode icon path survives save and load'
    Assert-Shortcut ((Run-ShortcutSetup) -eq 0) 'setup succeeds with synthetic shortcuts'
    foreach ($usagePath in @($usageDesktop,$usageMenu)) {
        Assert-Shortcut ((Read-UsageShortcut -Path $usagePath).TargetPath -eq (Join-Path $PSScriptRoot 'ChatGPT-Usage.exe')) 'shortcut targets this checkout launcher'
    }
    foreach ($usagePath in $usageOrdinary.Keys) { Assert-Shortcut ((Get-FileHash -LiteralPath $usagePath).Hash -eq $usageOrdinary[$usagePath]) 'ordinary launcher shortcut remains byte-identical' }
    Assert-Shortcut ((Run-ShortcutSetup -DirectScript) -eq 0) 'PowerShell shortcut fallback succeeds'
    $usageFallback = Read-UsageShortcut -Path $usageMenu
    Assert-Shortcut ($usageFallback.TargetPath -eq (Join-Path $PSHOME 'pwsh.exe') -and $usageFallback.Arguments.Contains('start-installed.ps1')) 'fallback points to this injection script, not the ordinary app'
    Assert-Shortcut ((Run-ShortcutSetup) -eq 0) 'repeat setup succeeds'
    $usageState = @(Get-Content -LiteralPath (Join-Path $usageFixture 'state\entries.json') -Raw | ConvertFrom-Json)
    Assert-Shortcut ($usageState.Count -eq 2) 'repeat setup preserves one backup record per shortcut'
    Assert-Shortcut ((Run-ShortcutSetup -Undo) -eq 0) 'restore succeeds'
    Assert-Shortcut ((Get-FileHash -LiteralPath $usageDesktop).Hash -eq $usageOriginalHash) 'original shortcut restored byte for byte'
    Assert-Shortcut (-not (Test-Path -LiteralPath $usageMenu)) 'new shortcut removed on restore'
    Assert-Shortcut ((Run-ShortcutSetup) -eq 0) 'setup succeeds after restore'
    Write-UsageShortcut -Path $usageDesktop -TargetPath (Join-Path $env:WINDIR 'notepad.exe')
    $usageChangedHash = (Get-FileHash -LiteralPath $usageDesktop).Hash
    Assert-Shortcut ((Run-ShortcutSetup -Undo) -ne 0) 'user-edited shortcut blocks restore'
    Assert-Shortcut ((Get-FileHash -LiteralPath $usageDesktop).Hash -eq $usageChangedHash) 'user-edited shortcut left untouched'
    $collision = Join-Path $usageFixture 'collision'
    New-Item -ItemType Directory -Path (Join-Path $collision 'menu') -Force | Out-Null
    $foreign = Join-Path $collision 'menu\ChatGPT（统计）.lnk'
    Write-UsageShortcut -Path $foreign -TargetPath (Join-Path $env:WINDIR 'notepad.exe')
    $foreignHash = (Get-FileHash -LiteralPath $foreign).Hash
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'set-start-entry.ps1') -TestRoot $collision | Out-Null
    Assert-Shortcut ($LASTEXITCODE -eq 0) 'a foreign menu entry does not prevent installing a new desktop entry'
    foreach ($folder in @('desktop','menu')) {
        $link = Join-Path $collision ($folder+'\Codex Meter.lnk')
        Assert-Shortcut ((Read-UsageShortcut $link).TargetPath -eq (Join-Path $PSScriptRoot 'ChatGPT-Usage.exe')) 'both new entries use one available name and the current launcher'
    }
    Assert-Shortcut ((Get-FileHash -LiteralPath $foreign).Hash -eq $foreignHash) 'foreign statistics shortcut is preserved byte-for-byte'
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'set-start-entry.ps1') -TestRoot $collision | Out-Null
    $collisionEntries = @(Get-Content (Join-Path $collision 'state\entries.json') -Raw | ConvertFrom-Json)
    Assert-Shortcut ($LASTEXITCODE -eq 0 -and $collisionEntries.Count -eq 2) 'fallback name is stable on repeat setup without duplicate entries'
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'set-start-entry.ps1') -TestRoot $collision -Restore | Out-Null
    Assert-Shortcut (-not (Test-Path (Join-Path $collision 'desktop\Codex Meter.lnk')) -and (Test-Path $foreign)) 'restore removes only the two new fallback entries'
    Write-Host "$usageChecks shortcut checks passed; real shortcuts were not accessed."
} finally {
    $usageResolved = [IO.Path]::GetFullPath($usageFixture)
    $usageBoundary = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'test-fixtures')).TrimEnd('\') + '\'
    if (-not $usageResolved.StartsWith($usageBoundary,[StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture cleanup escaped its directory.' }
    Remove-Item -LiteralPath $usageResolved -Recurse -Force
}
exit 0
