!include "MUI2.nsh"

Name "VMS Desktop Client"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\\VMS Desktop Client"
RequestExecutionLevel user
Unicode True
Icon "assets\\vms-shield.ico"
UninstallIcon "assets\\vms-shield.ico"

!define MUI_ICON "assets\\vms-shield.ico"
!define MUI_UNICON "assets\\vms-shield.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${APPDIR}\\*"

  CreateDirectory "$SMPROGRAMS\\VMS Desktop Client"
  CreateShortcut "$SMPROGRAMS\\VMS Desktop Client\\VMS Desktop Client.lnk" "$INSTDIR\\VMS-Desktop-Client.exe"
  CreateShortcut "$DESKTOP\\VMS Desktop Client.lnk" "$INSTDIR\\VMS-Desktop-Client.exe"

  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\\VMS Desktop Client.lnk"
  Delete "$SMPROGRAMS\\VMS Desktop Client\\VMS Desktop Client.lnk"
  RMDir "$SMPROGRAMS\\VMS Desktop Client"
  RMDir /r "$INSTDIR"
SectionEnd
