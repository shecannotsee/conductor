$ErrorActionPreference = 'Stop'
$PackageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Installer = Join-Path $PackageRoot 'dist\preview\Conductor-Preview-0.3.0-preview.1-win-x64-Setup.exe'
$InstallDir = Join-Path $PackageRoot 'dist\preview\installer-speech 中文 路径'
$PreviewData = Join-Path $env:APPDATA 'Conductor Preview'
$Existing = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall | Get-ItemProperty | Where-Object DisplayName -eq 'Conductor Preview'
if ($Existing -or (Test-Path -LiteralPath $PreviewData) -or (Test-Path -LiteralPath $InstallDir)) {
    throw 'Preview installation/data already exists. Use a clean VM; this test will not touch existing Preview data.'
}
$BeforeUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$BeforeMachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
function Install-Preview {
    $Process = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=`"$InstallDir`"") -WindowStyle Hidden -Wait -PassThru
    if ($Process.ExitCode -ne 0) { throw "Installer failed: $($Process.ExitCode)" }
    if (!(Test-Path -LiteralPath (Join-Path $InstallDir 'Conductor Preview.exe'))) { throw 'Installed executable missing' }
}
function Uninstall-Preview([bool]$DeleteData) {
    $Uninstaller = Join-Path $InstallDir 'Uninstall Conductor Preview.exe'
    $Arguments = @('/S')
    if ($DeleteData) { $Arguments += '--delete-app-data' }
    $Process = Start-Process -FilePath $Uninstaller -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
    if ($Process.ExitCode -ne 0) { throw "Uninstaller failed: $($Process.ExitCode)" }
    $Until = [DateTime]::UtcNow.AddSeconds(30)
    while ((Test-Path -LiteralPath (Join-Path $InstallDir 'Conductor Preview.exe')) -and [DateTime]::UtcNow -lt $Until) { Start-Sleep -Milliseconds 250 }
    if (Test-Path -LiteralPath (Join-Path $InstallDir 'Conductor Preview.exe')) { throw 'Uninstaller left application executable' }
}
Install-Preview
$Registration = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall | Get-ItemProperty | Where-Object DisplayName -eq 'Conductor Preview'
if (!$Registration) { throw 'Windows uninstall registration missing' }
New-Item -ItemType Directory -Path $PreviewData | Out-Null
$Sentinel = Join-Path $PreviewData '.installer-smoke-sentinel'
Set-Content -LiteralPath $Sentinel -Value 'test data only'
& node (Join-Path $PSScriptRoot 'preview-smoke.cjs') (Join-Path $InstallDir 'Conductor Preview.exe')
if ($LASTEXITCODE -ne 0) { throw 'Installed app UI smoke failed' }
& node (Join-Path $PSScriptRoot 'speech-ui.cjs') (Join-Path $InstallDir 'Conductor Preview.exe')
if ($LASTEXITCODE -ne 0) { throw 'Installed speech UI smoke failed' }
Install-Preview
if (!(Test-Path -LiteralPath $Sentinel)) { throw 'Upgrade removed data' }
Uninstall-Preview $false
if (!(Test-Path -LiteralPath $Sentinel)) { throw 'Ordinary uninstall removed data' }
Install-Preview
Uninstall-Preview $true
$Until = [DateTime]::UtcNow.AddSeconds(30)
while ((Test-Path -LiteralPath $PreviewData) -and [DateTime]::UtcNow -lt $Until) { Start-Sleep -Milliseconds 250 }
if (Test-Path -LiteralPath $PreviewData) { throw 'Complete uninstall left Preview data' }
if ([Environment]::GetEnvironmentVariable('Path', 'User') -ne $BeforeUserPath) { throw 'User PATH changed' }
if ([Environment]::GetEnvironmentVariable('Path', 'Machine') -ne $BeforeMachinePath) { throw 'Machine PATH changed' }
$Registration = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall | Get-ItemProperty | Where-Object DisplayName -eq 'Conductor Preview'
if ($Registration) { throw 'Uninstall registry entry remains' }
Write-Host 'PASS: install, installed UI, overwrite upgrade, keep-data uninstall, complete uninstall, registry cleanup, unchanged system/user PATH.'
