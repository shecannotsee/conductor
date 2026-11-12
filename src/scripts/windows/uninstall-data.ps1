param([ValidateSet('KeepConfig','Full')][string]$Mode = 'KeepConfig')
$ErrorActionPreference = 'Stop'
$DataRoot = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'ConductorInstalled'))
function Remove-DataItem([string]$ItemPath) {
    $ResolvedItem = [IO.Path]::GetFullPath($ItemPath)
    if (-not $ResolvedItem.StartsWith($DataRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup path outside application data' }
    Remove-Item -LiteralPath $ResolvedItem -Recurse -Force
}
if (-not (Test-Path -LiteralPath $DataRoot)) { exit 0 }
if ($Mode -eq 'Full') {
    Remove-Item -LiteralPath $DataRoot -Recurse -Force
    exit 0
}
foreach ($Item in Get-ChildItem -LiteralPath $DataRoot -Force) {
    if ($Item.Name -eq 'profiles.json' -and -not $Item.PSIsContainer -and -not ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $Profiles = Get-Content -LiteralPath $Item.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        $Profiles.conversations = [pscustomobject]@{}
        [IO.File]::WriteAllText($Item.FullName, ($Profiles | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding $false))
    } elseif ($Item.Name -in @('codex', 'profiles') -and $Item.PSIsContainer -and -not ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $Homes = if ($Item.Name -eq 'codex') { @($Item) } else { @(Get-ChildItem -LiteralPath $Item.FullName -Force) }
        foreach ($ProfileHome in $Homes) {
            if (-not $ProfileHome.PSIsContainer -or ($ProfileHome.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-DataItem $ProfileHome.FullName; continue }
            foreach ($Child in Get-ChildItem -LiteralPath $ProfileHome.FullName -Force) {
                if ($Child.Name -notin @('config.toml','auth.json') -or $Child.PSIsContainer -or ($Child.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-DataItem $Child.FullName }
            }
        }
    } else { Remove-DataItem $Item.FullName }
}
exit 0
