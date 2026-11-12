param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'
$RuntimeRoot = [IO.Path]::GetFullPath((Join-Path $InstallRoot 'resources\runtime')) + '\'
$Processes = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($RuntimeRoot, [StringComparison]::OrdinalIgnoreCase)
}
foreach ($Process in $Processes) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.ProcessId /T /F 2>$null | Out-Null
}
exit 0
