$ErrorActionPreference = 'Stop'
$PackageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Installer = Join-Path $PackageRoot 'dist\windows\Conductor-0.4.0-win-x64-Setup.exe'
$InstallDir = Join-Path $PackageRoot 'dist\windows\installer 中文 路径\Conductor'
$AppData = Join-Path $env:APPDATA 'ConductorInstalled'
$Existing = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall | Get-ItemProperty | Where-Object DisplayName -eq 'Conductor'
if ($Existing -or (Test-Path -LiteralPath $AppData) -or (Test-Path -LiteralPath $InstallDir)) { throw 'Existing installed Conductor/data found; use a clean VM.' }
$BeforeUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$BeforeMachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$OriginalProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*E:\workspace\conductor\*' } | Select-Object -ExpandProperty ProcessId)
function Install-Conductor {
    $Process = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=`"$InstallDir`"") -WindowStyle Hidden -Wait -PassThru
    if ($Process.ExitCode -ne 0) { throw "Installer failed: $($Process.ExitCode)" }
    if (!(Test-Path -LiteralPath (Join-Path $InstallDir 'Conductor.exe'))) { throw 'Installed executable missing' }
}
function Uninstall-Conductor([bool]$DeleteData) {
    $Arguments = @('/S')
    if ($DeleteData) { $Arguments += '--delete-app-data'; $Arguments += '--delete-workspace' }
    $Process = Start-Process -FilePath (Join-Path $InstallDir 'Uninstall Conductor.exe') -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
    if ($Process.ExitCode -ne 0) { throw "Uninstaller failed: $($Process.ExitCode)" }
    $Until = [DateTime]::UtcNow.AddSeconds(30)
    while ((Test-Path -LiteralPath (Join-Path $InstallDir 'Conductor.exe')) -and [DateTime]::UtcNow -lt $Until) { Start-Sleep -Milliseconds 250 }
    if (Test-Path -LiteralPath (Join-Path $InstallDir 'Conductor.exe')) { throw 'Uninstaller left executable' }
}
Install-Conductor
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'installer-options-ui.ps1') -Installer (Join-Path $InstallDir 'Uninstall Conductor.exe') -Uninstall
if ($LASTEXITCODE -ne 0) { throw 'Native uninstall options failed' }
& node (Join-Path $PSScriptRoot 'installer-manifest.cjs') $Installer (Join-Path $InstallDir 'Uninstall Conductor.exe')
if ($LASTEXITCODE -ne 0) { throw 'DPI manifest missing' }
$Registration = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall | Get-ItemProperty | Where-Object DisplayName -eq 'Conductor'
if (!$Registration) { throw 'Windows uninstall registration missing' }
$WorkspaceFile = Join-Path $InstallDir 'workspace\project-sentinel.txt'
Set-Content -LiteralPath $WorkspaceFile -Value 'user project test'
New-Item -ItemType Directory -Path (Join-Path $AppData 'codex\sessions') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $AppData 'codex\auth.json'), '{"OPENAI_API_KEY":"fake-installer-key"}')
[IO.File]::WriteAllText((Join-Path $AppData 'codex\config.toml'), 'model="test-model"')
Set-Content -LiteralPath (Join-Path $AppData 'codex\sessions\history.txt') -Value 'test history'
Set-Content -LiteralPath (Join-Path $AppData 'state.electron.json') -Value 'test state'
& node (Join-Path $PSScriptRoot 'windows-ui.test.cjs') (Join-Path $InstallDir 'Conductor.exe')
if ($LASTEXITCODE -ne 0) { throw 'Installed settings UI failed' }
& node (Join-Path $PSScriptRoot 'speech-ui.cjs') (Join-Path $InstallDir 'Conductor.exe')
if ($LASTEXITCODE -ne 0) { throw 'Installed speech UI failed' }
Install-Conductor
if (!(Test-Path -LiteralPath $WorkspaceFile)) { throw 'Upgrade removed workspace' }
if (!(Test-Path -LiteralPath (Join-Path $AppData 'state.electron.json'))) { throw 'Upgrade removed app data' }
Uninstall-Conductor $false
if (!(Test-Path -LiteralPath (Join-Path $AppData 'codex\auth.json'))) { throw 'Keep-config uninstall removed key' }
if (Test-Path -LiteralPath (Join-Path $AppData 'codex\sessions')) { throw 'Keep-config uninstall left sessions' }
if (Test-Path -LiteralPath (Join-Path $AppData 'state.electron.json')) { throw 'Keep-config uninstall left history' }
if (!(Test-Path -LiteralPath $WorkspaceFile)) { throw 'Default uninstall removed project files' }
Install-Conductor
Uninstall-Conductor $true
$Until = [DateTime]::UtcNow.AddSeconds(30)
while ((Test-Path -LiteralPath $AppData) -and [DateTime]::UtcNow -lt $Until) { Start-Sleep -Milliseconds 250 }
if (Test-Path -LiteralPath $AppData) { throw 'Complete uninstall left app data' }
if (Test-Path -LiteralPath $WorkspaceFile) { throw 'Explicit workspace cleanup left files' }
if ([Environment]::GetEnvironmentVariable('Path', 'User') -ne $BeforeUserPath) { throw 'User PATH changed' }
if ([Environment]::GetEnvironmentVariable('Path', 'Machine') -ne $BeforeMachinePath) { throw 'Machine PATH changed' }
foreach ($OriginalId in $OriginalProcesses) { if (!(Get-Process -Id $OriginalId -ErrorAction SilentlyContinue)) { throw 'Original app was stopped' } }
$Registration = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall | Get-ItemProperty | Where-Object DisplayName -eq 'Conductor'
if ($Registration) { throw 'Uninstall registry entry remains' }
Write-Host 'PASS: installed UI + speech, upgrade preserves workspace/data, keep-config uninstall removes history, full cleanup incl workspace, unchanged PATH, original app preserved.'
