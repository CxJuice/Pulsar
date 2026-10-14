!macro customInstallmode
  ; Keep upgrades in the installation scope already registered on this machine.
  ${If} $hasPerUserInstallation == "1"
  ${AndIf} $hasPerMachineInstallation != "1"
    StrCpy $isForceCurrentInstall "1"
  ${ElseIf} $hasPerMachineInstallation == "1"
  ${AndIf} $hasPerUserInstallation != "1"
    StrCpy $isForceMachineInstall "1"
  ${EndIf}
!macroend

!include nsDialogs.nsh
!pragma warning disable 6001

Var PulsarDirectoryInput
Var PulsarBrowseButton
Var PulsarRegisteredPath

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎使用 Pulsar"
  !define MUI_WELCOMEPAGE_TEXT ""

  ; Use the branded welcome page and replace the generic directory page below.
  !undef allowToChangeInstallationDirectory
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  !insertmacro MUI_PAGE_INIT
  Page custom PulsarDirectoryPageShow PulsarDirectoryPageLeave

  Function PulsarDirectoryPageShow
    !insertmacro MUI_HEADER_TEXT "选择安装位置" ""

    StrCpy $PulsarRegisteredPath ""
    ${If} $installMode == "CurrentUser"
      ReadRegStr $PulsarRegisteredPath HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${Else}
      ReadRegStr $PulsarRegisteredPath HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}

    ${If} $PulsarRegisteredPath != ""
      StrCpy $INSTDIR $PulsarRegisteredPath
      Abort
    ${EndIf}

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 20u "安装位置"
    Pop $0
    ${NSD_CreateText} 0 27u 235u 15u "$INSTDIR"
    Pop $PulsarDirectoryInput
    ${NSD_CreateButton} 243u 25u 64u 19u "浏览..."
    Pop $PulsarBrowseButton
    ${NSD_OnClick} $PulsarBrowseButton PulsarBrowseDirectory
    nsDialogs::Show
  FunctionEnd

  Function PulsarBrowseDirectory
    nsDialogs::SelectFolderDialog "选择安装文件夹" "$INSTDIR"
    Pop $0
    ${If} $0 != error
      ${NSD_SetText} $PulsarDirectoryInput $0
    ${EndIf}
  FunctionEnd

  Function PulsarDirectoryPageLeave
    ${NSD_GetText} $PulsarDirectoryInput $INSTDIR
    ${If} $INSTDIR == ""
      MessageBox MB_ICONEXCLAMATION "请选择安装文件夹。"
      Abort
    ${EndIf}
  FunctionEnd

  ; Keep the normal shortcut behavior even though the stock directory page is hidden.
  !define allowToChangeInstallationDirectory
!macroend

!define MUI_FINISHPAGE_TITLE "Pulsar 已就绪"
!define MUI_FINISHPAGE_TEXT "Pulsar 已安装完成。"
