$ErrorActionPreference = 'Stop'
$usageRoot = Split-Path -Parent $PSScriptRoot
$usageFramework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $usageFramework)) { $usageFramework = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $usageFramework)) { throw 'The Windows .NET Framework C# compiler is required to build the optional launcher.' }
$usageSource = Join-Path $usageRoot 'launcher\StartUsage.cs'
$usageOutput = Join-Path $usageRoot 'launcher\ChatGPT-Usage.exe'
& $usageFramework /nologo /target:winexe /reference:System.Windows.Forms.dll ('/out:' + $usageOutput) $usageSource
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
Write-Host 'Optional launcher built. No shortcuts were changed and no client was started.'
