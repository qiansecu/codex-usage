Set-StrictMode -Version Latest
if (-not ('CodexMeter.ShortcutFile' -as [type])) {
    Add-Type -LiteralPath (Join-Path $PSScriptRoot 'shortcut-native.cs')
}

function Read-UsageShortcut {
    param([Parameter(Mandatory)][string]$Path)
    return [CodexMeter.ShortcutFile]::Read([IO.Path]::GetFullPath($Path))
}

function Write-UsageShortcut {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$TargetPath,
        [string]$Arguments = '',
        [string]$WorkingDirectory = '',
        [string]$Description = '',
        [string]$IconPath = '',
        [int]$IconIndex = 0
    )
    $usageInfo = [CodexMeter.ShortcutInfo]::new()
    $usageInfo.TargetPath = $TargetPath
    $usageInfo.Arguments = $Arguments
    $usageInfo.WorkingDirectory = $WorkingDirectory
    $usageInfo.Description = $Description
    $usageInfo.IconPath = $IconPath
    $usageInfo.IconIndex = $IconIndex
    [CodexMeter.ShortcutFile]::Write([IO.Path]::GetFullPath($Path), $usageInfo)
}

Export-ModuleMember -Function Read-UsageShortcut,Write-UsageShortcut
