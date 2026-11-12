!include nsDialogs.nsh
!include MUI2.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!ifdef BUILD_UNINSTALLER
  !define CONDUCTOR_PROGRESS_PREFIX "un."
!else
  !define CONDUCTOR_PROGRESS_PREFIX ""
!endif
Function ${CONDUCTOR_PROGRESS_PREFIX}ConductorProgressShow
  SetDetailsView show
  GetFunctionAddress $0 ${CONDUCTOR_PROGRESS_PREFIX}ConductorProgressTick
  nsDialogs::CreateTimer $0 100
FunctionEnd
Function ${CONDUCTOR_PROGRESS_PREFIX}ConductorProgressTick
  Push $0
  Push $1
  Push $2
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $0 $0 1004
  SendMessage $0 0x0408 0 0 $1 ; PBM_GETPOS
  SendMessage $0 0x0407 0 0 $2 ; PBM_GETRANGE: upper limit
  ${If} $2 > 0
    IntOp $1 $1 * 100
    IntOp $1 $1 / $2
    SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:Conductor - $1%"
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
Function ${CONDUCTOR_PROGRESS_PREFIX}ConductorProgressLeave
  GetFunctionAddress $0 ${CONDUCTOR_PROGRESS_PREFIX}ConductorProgressTick
  nsDialogs::KillTimer $0
  SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:Conductor - 100%"
FunctionEnd
!ifndef BUILD_UNINSTALLER
Var DesktopChoice
Var MenuChoice
Var DesktopControl
Var MenuControl
!else
Var KeepConfigControl
Var FullControl
Var WorkspaceControl
Var CleanupMode
Var DeleteWorkspace
!endif

!macro customHeader
  ManifestDPIAware true
  ManifestDPIAwareness PerMonitorV2,PerMonitor
  ShowInstDetails show
  ShowUninstDetails show
!macroend
!macro customInit
  StrCpy $DesktopChoice 1
  StrCpy $MenuChoice 1
  ReadRegStr $0 HKCU "Software\ConductorDesktop" DesktopShortcut
  ${If} $0 != ""
    StrCpy $DesktopChoice $0
  ${EndIf}
  ReadRegStr $0 HKCU "Software\ConductorDesktop" StartMenuShortcut
  ${If} $0 != ""
    StrCpy $MenuChoice $0
  ${EndIf}
!macroend
!ifndef BUILD_UNINSTALLER
Function ConductorOptions
  !insertmacro MUI_HEADER_TEXT "安装选项" "选择快捷方式。默认工作目录为安装目录下的 workspace。"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateCheckbox} 0 12u 100% 16u "创建桌面快捷方式"
  Pop $DesktopControl
  ${NSD_SetState} $DesktopControl $DesktopChoice
  ${NSD_CreateCheckbox} 0 40u 100% 16u "添加到开始菜单"
  Pop $MenuControl
  ${NSD_SetState} $MenuControl $MenuChoice
  nsDialogs::Show
FunctionEnd
Function ConductorOptionsLeave
  ${NSD_GetState} $DesktopControl $DesktopChoice
  ${NSD_GetState} $MenuControl $MenuChoice
FunctionEnd
!endif
!macro customPageAfterChangeDir
  Page custom ConductorOptions ConductorOptionsLeave
!macroend
!macro customInstall
  CreateDirectory "$INSTDIR\workspace"
  ; A versioned icon path invalidates Explorer's old executable icon cache.
  SetOutPath "$INSTDIR"
  File /oname=conductor-${VERSION}.ico "${BUILD_RESOURCES_DIR}\icon.ico"
  ${If} $DesktopChoice == 0
    Delete "$newDesktopLink"
  ${ElseIfNot} ${isNoDesktopShortcut}
    CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\conductor-${VERSION}.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$newDesktopLink", p 0)'
  ${EndIf}
  ${If} $MenuChoice == 0
    Delete "$newStartMenuLink"
  ${Else}
    !insertmacro createMenuDirectory
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\conductor-${VERSION}.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$newStartMenuLink", p 0)'
  ${EndIf}
  WriteRegStr HKCU "Software\ConductorDesktop" DesktopShortcut $DesktopChoice
  WriteRegStr HKCU "Software\ConductorDesktop" StartMenuShortcut $MenuChoice
!macroend
!macro customUnInit
  StrCpy $CleanupMode "KeepConfig"
  StrCpy $DeleteWorkspace 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--delete-app-data" $1
  ${IfNot} ${Errors}
    StrCpy $CleanupMode "Full"
  ${EndIf}
  ClearErrors
  ${GetOptions} $0 "--delete-workspace" $1
  ${IfNot} ${Errors}
    StrCpy $DeleteWorkspace 1
  ${EndIf}
!macroend
!macro customCheckAppRunning
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\stop-installed-app.ps1" -InstallRoot "$INSTDIR"'
  Pop $0
  Pop $1
!macroend
!ifdef BUILD_UNINSTALLER
Function un.ConductorOptions
  !insertmacro MUI_HEADER_TEXT "卸载选项" "选择是否保留 API 配置，以及是否删除工作目录。"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateRadioButton} 0 8u 100% 20u "保留 API 配置（服务商、Key、模型和推理强度）"
  Pop $KeepConfigControl
  ${NSD_Check} $KeepConfigControl
  ${NSD_CreateRadioButton} 0 34u 100% 20u "完全清理应用数据（包括所有 Key 和配置）"
  Pop $FullControl
  ${NSD_CreateLabel} 0 62u 100% 42u "两种方式都会移除程序、内置运行环境、语音模型、聊天记录和缓存。$\r$\n不勾选下面的选项时，workspace 和其中的项目文件不会被删除。"
  Pop $0
  ${NSD_CreateCheckbox} 0 100u 100% 20u "同时删除安装目录内 workspace 中的所有项目文件"
  Pop $WorkspaceControl
  ${NSD_CreateLabel} 0 126u 100% 24u "默认保留项目文件；外部工作目录不会被删除。"
  Pop $0
  nsDialogs::Show
FunctionEnd
Function un.ConductorOptionsLeave
  ${NSD_GetState} $FullControl $0
  ${If} $0 == 1
    StrCpy $CleanupMode "Full"
  ${Else}
    StrCpy $CleanupMode "KeepConfig"
  ${EndIf}
  ${NSD_GetState} $WorkspaceControl $DeleteWorkspace
  ${If} $DeleteWorkspace == 1
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "确认永久删除 $INSTDIR\workspace 内的所有项目文件？" IDYES confirmed_workspace
    Abort
    confirmed_workspace:
  ${EndIf}
FunctionEnd
!endif
!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.ConductorOptions un.ConductorOptionsLeave
!macroend
!macro customUnInstall
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\stop-runtime.ps1" -InstallRoot "$INSTDIR"'
  Pop $0
  Pop $1
  ${IfNot} ${isUpdated}
    nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\uninstall-data.ps1" -Mode "$CleanupMode"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "无法清理应用数据，请关闭 Conductor 后重试。"
      Abort
    ${EndIf}
    DeleteRegKey HKCU "Software\ConductorDesktop"
  ${EndIf}
!macroend
; Preserve user projects during upgrades and by default on uninstall.
!macro customRemoveFiles
  FindFirst $R0 $R1 "$INSTDIR\*"
  ${DoWhile} $R1 != ""
    ${If} $R1 != "."
    ${AndIf} $R1 != ".."
    ${AndIf} $R1 != "workspace"
      ${If} ${FileExists} "$INSTDIR\$R1\*"
        RMDir /r "$INSTDIR\$R1"
      ${Else}
        Delete "$INSTDIR\$R1"
      ${EndIf}
    ${EndIf}
    FindNext $R0 $R1
  ${Loop}
  FindClose $R0
  ${IfNot} ${isUpdated}
    ${If} $DeleteWorkspace == 1
      RMDir /r "$INSTDIR\workspace"
    ${EndIf}
  ${EndIf}
  RMDir "$INSTDIR"
!macroend
