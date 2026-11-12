param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'SilentlyContinue'
$Target = [IO.Path]::GetFullPath((Join-Path $InstallRoot 'Conductor.exe'))
$Processes = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $Target
}
foreach ($Process in $Processes) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.ProcessId /T /F 2>$null | Out-Null
}
Start-Sleep -Milliseconds 500
exit 0
