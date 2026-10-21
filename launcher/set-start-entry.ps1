param([switch]$Restore, [string]$TestRoot, [switch]$ScriptMode)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'shortcut-helpers.psm1') -Force
$taskRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$taskQuietLauncher = Join-Path $taskRoot 'ChatGPT-Usage.exe'
$taskScriptHost = Join-Path $PSHOME 'pwsh.exe'
$taskLaunchScript = [IO.Path]::GetFullPath((Join-Path $taskRoot '..\app\start-installed.ps1'))
$taskScriptArguments = '-NoProfile -WindowStyle Hidden -File "' + $taskLaunchScript + '"'
$taskLauncher = if (-not $ScriptMode -and (Test-Path -LiteralPath $taskQuietLauncher)) { $taskQuietLauncher } else { $taskScriptHost }
$taskArguments = if ($taskLauncher -eq $taskQuietLauncher) { '' } else { $taskScriptArguments }
$taskStateRoot = if ($TestRoot) { Join-Path ([IO.Path]::GetFullPath($TestRoot)) 'state' } else { Join-Path $taskRoot 'state' }
$taskMenu = if ($TestRoot) { Join-Path ([IO.Path]::GetFullPath($TestRoot)) 'menu' } else { [Environment]::GetFolderPath('Programs') }
$taskDesktop = if ($TestRoot) { Join-Path ([IO.Path]::GetFullPath($TestRoot)) 'desktop' } else { [Environment]::GetFolderPath('DesktopDirectory') }
$taskStateFile = Join-Path $taskStateRoot 'entries.json'
New-Item -ItemType Directory -Path $taskStateRoot -Force | Out-Null
$taskEntries = @(if (Test-Path -LiteralPath $taskStateFile) { Get-Content -LiteralPath $taskStateFile -Raw -Encoding UTF8 | ConvertFrom-Json })
function Get-EntryHash([string]$Path) { if (Test-Path -LiteralPath $Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }; return $null }
if ($Restore) {
    foreach ($taskEntry in $taskEntries) {
        $taskHash = Get-EntryHash $taskEntry.path
        if ($taskHash -and $taskHash -ne $taskEntry.installedHash -and $taskHash -ne $taskEntry.originalHash) { throw ('Shortcut changed after setup; preserved: ' + $taskEntry.path) }
        if ($taskEntry.existed -and (Get-EntryHash $taskEntry.backup) -ne $taskEntry.originalHash) { throw ('Backup is missing or changed: ' + $taskEntry.backup) }
    }
    foreach ($taskEntry in $taskEntries) {
        if ($taskEntry.existed) { Copy-Item -LiteralPath $taskEntry.backup -Destination $taskEntry.path -Force }
        elseif (Test-Path -LiteralPath $taskEntry.path) { Remove-Item -LiteralPath $taskEntry.path }
    }
    Write-Host '已恢复原快捷方式；当前客户端窗口不会关闭。'
    exit 0
}
if (-not (Test-Path -LiteralPath $taskLauncher -PathType Leaf)) { throw 'Statistics launcher is missing.' }
$taskPaths = @((Join-Path $taskDesktop 'ChatGPT（统计）.lnk'), (Join-Path $taskMenu 'ChatGPT（统计）.lnk'))
$taskPending = @()
foreach ($taskPath in $taskPaths) {
    $taskExisting = @($taskEntries | Where-Object { $_.path -eq $taskPath })
    if ($taskExisting.Count -gt 1) { throw 'Duplicate shortcut state.' }
    $taskExists = Test-Path -LiteralPath $taskPath
    $taskHash = Get-EntryHash $taskPath
    if ($taskExisting.Count) {
        $taskEntry = $taskExisting[0]
        if ($taskHash -and $taskHash -ne $taskEntry.installedHash -and $taskHash -ne $taskEntry.originalHash) { throw ('Shortcut changed after setup; preserved: ' + $taskPath) }
        if ($taskEntry.existed -and (Get-EntryHash $taskEntry.backup) -ne $taskEntry.originalHash) { throw ('Backup is missing or changed: ' + $taskEntry.backup) }
    } else {
        if ($taskExists) {
            $taskLink = Read-UsageShortcut -Path $taskPath
            $taskOwned = ($taskLink.TargetPath -eq $taskQuietLauncher -and -not $taskLink.Arguments) -or ($taskLink.TargetPath -eq $taskScriptHost -and $taskLink.Arguments -eq $taskScriptArguments)
            if (-not $taskOwned) { throw ('Unrecognized ChatGPT shortcut; preserved: ' + $taskPath) }
        }
        $taskBackup = Join-Path $taskStateRoot (([Guid]::NewGuid().ToString('N')) + '.lnk')
        if ($taskExists) { Copy-Item -LiteralPath $taskPath -Destination $taskBackup }
        $taskEntry = [pscustomobject]@{path=$taskPath; existed=$taskExists; originalHash=$taskHash; backup=$taskBackup; installedHash=$null}
        $taskEntries += $taskEntry
    }
    $taskPending += $taskEntry
}
$taskIcon = $taskLauncher
$taskPackageFile = Join-Path $taskRoot '..\app\runtime-installed\package.json'
if (Test-Path -LiteralPath $taskPackageFile) {
    $taskPackage = Get-Content -LiteralPath $taskPackageFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (Test-Path -LiteralPath $taskPackage.manifestExecutable -PathType Leaf) { $taskIcon = $taskPackage.manifestExecutable }
}
# Stage a fresh link: an existing Store link can contain an activation ID that overrides TargetPath.
foreach ($taskEntry in $taskPending) {
    $taskStaged = Join-Path $taskStateRoot (([Guid]::NewGuid().ToString('N')) + '.lnk')
    Write-UsageShortcut -Path $taskStaged -TargetPath $taskLauncher -Arguments $taskArguments -WorkingDirectory $taskRoot -IconPath $taskIcon -Description '启动已安装的客户端并显示会话用量统计'
    $taskVerified = Read-UsageShortcut -Path $taskStaged
    if ($taskVerified.TargetPath -ne $taskLauncher -or $taskVerified.Arguments -ne $taskArguments) { throw 'Shortcut verification failed.' }
    $taskEntry.installedHash = Get-EntryHash $taskStaged
    # Save the recovery record before replacing a user shortcut.
    ConvertTo-Json -InputObject @($taskEntries) -Depth 5 | Set-Content -LiteralPath $taskStateFile -Encoding UTF8
    $taskParent = Split-Path -Parent $taskEntry.path
    New-Item -ItemType Directory -Path $taskParent -Force | Out-Null
    Copy-Item -LiteralPath $taskStaged -Destination $taskEntry.path -Force
    if ((Get-EntryHash $taskEntry.path) -ne $taskEntry.installedHash) { throw 'Written shortcut verification failed.' }
    Remove-Item -LiteralPath $taskStaged
}
Write-Host '已在桌面和开始菜单添加独立统计入口，原来的普通入口保持不变。'
Write-Host '请在开始菜单搜索 ChatGPT（统计），右键选择“固定到开始屏幕”。'
Write-Host '推荐区中的商店原生入口独立存在，请使用已固定的统计入口。'
Write-Host '首次启动前请完整退出普通客户端；未添加 Windows 登录自启动。'
