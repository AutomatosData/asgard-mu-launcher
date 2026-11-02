; Macros do instalador do AsgardMU (electron-builder, "nsis.include" no package.json)
;
; O jogo fica na pasta escolhida no instalador ($INSTDIR). O launcher (Electron) fica
; em "$INSTDIR\Launcher" (pasta oculta) e um AsgardMU.exe pequeno na pasta do jogo o
; abre (build/stub). O electron-builder extrai o launcher em $INSTDIR; customInstall
; move os arquivos dele para "Launcher\" (também numa instalação antiga, com o launcher
; junto do jogo) e põe o AsgardMU.exe pequeno no lugar.
;
; O desinstalador padrão do electron-builder apaga a pasta inteira, também quando um
; instalador novo atualiza o launcher. Por isso:
;   - atualização (--updated, ver src/main/launcher-update.js): não apaga nada. O
;     instalador novo sobrescreve os arquivos do launcher e o jogo continua lá.
;   - desinstalação pelo Windows: apaga a pasta inteira (launcher e jogo). A página de
;     pasta do instalador sempre termina o caminho em "\AsgardMU".

!define LAUNCHER_DIR "$INSTDIR\Launcher"

; Sempre por usuário (sem UAC e sem a página "todos os usuários"): o launcher e o
; jogo gravam na própria pasta, o que não funciona em Program Files
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro moveToLauncher NAME
  Delete "${LAUNCHER_DIR}\${NAME}"
  Rename "$INSTDIR\${NAME}" "${LAUNCHER_DIR}\${NAME}"
!macroend

!macro moveDirToLauncher NAME
  RMDir /r "${LAUNCHER_DIR}\${NAME}"
  Rename "$INSTDIR\${NAME}" "${LAUNCHER_DIR}\${NAME}"
!macroend

; Mesma lista de LAUNCHER_FILES/LAUNCHER_DIRS em tools/release.js
!macro customInstall
  CreateDirectory "${LAUNCHER_DIR}"
  !insertmacro moveToLauncher "${APP_EXECUTABLE_FILENAME}"
  !insertmacro moveToLauncher "${UNINSTALL_FILENAME}"
  !insertmacro moveToLauncher "uninstallerIcon.ico"
  !insertmacro moveToLauncher "chrome_100_percent.pak"
  !insertmacro moveToLauncher "chrome_200_percent.pak"
  !insertmacro moveToLauncher "resources.pak"
  !insertmacro moveToLauncher "icudtl.dat"
  !insertmacro moveToLauncher "snapshot_blob.bin"
  !insertmacro moveToLauncher "v8_context_snapshot.bin"
  !insertmacro moveToLauncher "version"
  !insertmacro moveToLauncher "vk_swiftshader.dll"
  !insertmacro moveToLauncher "vk_swiftshader_icd.json"
  !insertmacro moveToLauncher "vulkan-1.dll"
  !insertmacro moveToLauncher "ffmpeg.dll"
  !insertmacro moveToLauncher "d3dcompiler_47.dll"
  !insertmacro moveToLauncher "dxcompiler.dll"
  !insertmacro moveToLauncher "dxil.dll"
  !insertmacro moveToLauncher "libEGL.dll"
  !insertmacro moveToLauncher "libGLESv2.dll"
  !insertmacro moveToLauncher "LICENSE.electron.txt"
  !insertmacro moveToLauncher "LICENSES.chromium.html"
  !insertmacro moveDirToLauncher "locales"
  !insertmacro moveDirToLauncher "resources"
  File "/oname=$INSTDIR\${APP_EXECUTABLE_FILENAME}" "${BUILD_RESOURCES_DIR}\stub\AsgardMU.exe"
  SetFileAttributes "${LAUNCHER_DIR}" HIDDEN

  ; O Windows desinstala pelo arquivo novo
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"${LAUNCHER_DIR}\${UNINSTALL_FILENAME}" /currentuser'
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"${LAUNCHER_DIR}\${UNINSTALL_FILENAME}" /currentuser /S'
  ${if} ${FileExists} "${LAUNCHER_DIR}\uninstallerIcon.ico"
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayIcon "${LAUNCHER_DIR}\uninstallerIcon.ico"
  ${endIf}
!macroend

; O desinstalador fica em "Launcher\". Sem InstallLocation no registro, $INSTDIR seria
; essa pasta: sobe para a pasta do jogo.
!macro customUnInit
  StrCpy $R9 $INSTDIR "" -9
  ${if} $R9 == "\Launcher"
    StrCpy $INSTDIR $INSTDIR -9
  ${endIf}
!macroend

!macro customRemoveFiles
  ${ifNot} ${isUpdated}
    RMDir /r $INSTDIR
  ${endIf}
!macroend
