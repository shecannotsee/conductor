param([Parameter(Mandatory=$true)][string]$Installer, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class InstallerControls {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static Dictionary<IntPtr,string> Read(uint pid) {
    var r = new Dictionary<IntPtr,string>();
    EnumWindows((h,p) => { uint id; GetWindowThreadProcessId(h,out id); if(id==pid) EnumChildWindows(h,(c,q)=> { var s=new StringBuilder(2048); GetWindowText(c,s,s.Capacity); r[c]=s.ToString(); return true; },IntPtr.Zero); return true; }, IntPtr.Zero);
    return r;
  }
}
"@
$LaunchArgs = if ($Uninstall) { "_?=$([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Installer)))" } else { " " }
$Process = Start-Process -FilePath ([IO.Path]::GetFullPath($Installer)) -ArgumentList $LaunchArgs -WindowStyle Hidden -PassThru
try {
    for ($Step = 0; $Step -lt 60; $Step++) {
        Start-Sleep -Milliseconds 300
        $Controls = [InstallerControls]::Read($Process.Id)
        $Names = @($Controls.Values)
        if ($Uninstall -and ($Names -join '|') -match '保留 API 配置') {
            if (($Names -join '|') -notmatch '完全清理应用数据' -or ($Names -join '|') -notmatch 'workspace') { throw 'Uninstall choices missing' }
            Write-Host 'PASS: hidden native uninstaller exposes keep-config, full-cleanup and workspace choices.'
            exit 0
        }
        if (!$Uninstall -and ($Names -join '|') -match '创建桌面快捷方式') {
            if (($Names -join '|') -notmatch '添加到开始菜单') { throw 'Start-menu option missing' }
            Write-Host 'PASS: hidden native installer exposes desktop/start-menu options before installation.'
            exit 0
        }
        foreach ($Control in $Controls.GetEnumerator()) {
            if ($Control.Value -match '下一步|Next') {
                [InstallerControls]::PostMessage($Control.Key, 0xF5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
                break
            }
        }
    }
    throw ('Options page not reached: ' + ($Names -join '|'))
} finally {
    $Process.Refresh()
    if (!$Process.HasExited) { Stop-Process -Id $Process.Id -Force }
}
