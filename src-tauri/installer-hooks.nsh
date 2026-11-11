; Ganchos do instalador do AsgardMU (Tauri, "bundle.windows.nsis.installerHooks").
;
; O jogo fica na pasta escolhida no instalador ($INSTDIR), junto do AsgardMU.exe (launcher).
;
; Atualização do launcher (src-tauri/src/self_update.rs e o launcher Electron 1.0.x):
;   AsgardMU-Setup.exe /S /UPDATE --updated --force-run /D=<pasta do jogo>
; (o launcher Electron não passa /UPDATE: o instalador recria os atalhos, com o mesmo destino)
; O instalador só troca o launcher; o jogo continua lá. "--force-run" abre o launcher novo.
;
; As instalações do launcher Electron tinham o launcher em "$INSTDIR\Launcher" (1.0.5+) ou
; junto do jogo (antes). O instalador apaga esses arquivos e o registro do desinstalador antigo.
;
; Desinstalação pelo Windows: apaga a pasta inteira (launcher e jogo).

; Chaves do instalador antigo (electron-builder, appId "AsgardMU.app")
!define ASGARD_OLD_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\4c0b42bd-415f-5f99-b246-d9482295de5f"
!define ASGARD_OLD_INSTALL_KEY "Software\4c0b42bd-415f-5f99-b246-d9482295de5f"

; Pasta padrão do instalador: C:\AsgardMU. Por cima de uma instalação do launcher
; Electron, a pasta dessa instalação. Uma instalação do launcher novo já vem em $INSTDIR
; (o instalador lê a pasta anterior do registro).
!define MUI_CUSTOMFUNCTION_GUIINIT AsgardGuiInit
Function AsgardGuiInit
  ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    StrCpy $INSTDIR "C:\AsgardMU"
    ReadRegStr $R9 HKCU "${ASGARD_OLD_INSTALL_KEY}" "InstallLocation"
    ${If} $R9 != ""
    ${AndIf} ${FileExists} "$R9\*.*"
      StrCpy $INSTDIR $R9
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ; Launcher Electron 1.0.5+ ainda aberto (ele chama este instalador e fecha em seguida):
  ; fecha antes, senão a pasta "Launcher" não pode ser apagada
  ${If} ${FileExists} "$INSTDIR\Launcher\${MAINBINARYNAME}.exe"
    !insertmacro CheckIfAppIsRunning "$INSTDIR\Launcher\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Launcher Electron 1.0.5+: pasta "Launcher" (o AsgardMU.exe pequeno da raiz já foi trocado)
  ${If} ${FileExists} "$INSTDIR\Launcher\resources\app.asar"
    RMDir /r "$INSTDIR\Launcher"
  ${EndIf}

  ; Launcher Electron antes do 1.0.5: arquivos junto do jogo
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
    RMDir /r "$INSTDIR\resources"
    ${If} ${FileExists} "$INSTDIR\locales\en-US.pak"
      RMDir /r "$INSTDIR\locales"
    ${EndIf}
    Delete "$INSTDIR\Uninstall AsgardMU.exe"
    Delete "$INSTDIR\uninstallerIcon.ico"
    Delete "$INSTDIR\chrome_100_percent.pak"
    Delete "$INSTDIR\chrome_200_percent.pak"
    Delete "$INSTDIR\resources.pak"
    Delete "$INSTDIR\icudtl.dat"
    Delete "$INSTDIR\snapshot_blob.bin"
    Delete "$INSTDIR\v8_context_snapshot.bin"
    Delete "$INSTDIR\version"
    Delete "$INSTDIR\vk_swiftshader.dll"
    Delete "$INSTDIR\vk_swiftshader_icd.json"
    Delete "$INSTDIR\vulkan-1.dll"
    Delete "$INSTDIR\ffmpeg.dll"
    Delete "$INSTDIR\d3dcompiler_47.dll"
    Delete "$INSTDIR\dxcompiler.dll"
    Delete "$INSTDIR\dxil.dll"
    Delete "$INSTDIR\libEGL.dll"
    Delete "$INSTDIR\libGLESv2.dll"
    Delete "$INSTDIR\LICENSE.electron.txt"
    Delete "$INSTDIR\LICENSES.chromium.html"
  ${EndIf}

  ; Registro do desinstalador antigo: o Windows mostra só o novo
  DeleteRegKey HKCU "${ASGARD_OLD_UNINSTALL_KEY}"
  DeleteRegKey HKCU "${ASGARD_OLD_INSTALL_KEY}"

  ; Pasta do jogo limpa: o desinstalador fica oculto
  SetFileAttributes "$INSTDIR\uninstall.exe" HIDDEN

  ; Atualização do launcher: abre o launcher novo
  ClearErrors
  ${GetOptions} $CMDLINE "--force-run" $R9
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
  ${EndIf}
  ClearErrors
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Desinstalação pelo Windows: apaga o jogo também, só em uma pasta que tem o jogo.
  ; Nunca em uma atualização (/UPDATE) nem quando o instalador novo chama o desinstalador
  ; para reinstalar: nesse caso o desinstalador roda na própria pasta ($EXEDIR = $INSTDIR);
  ; pelo Windows ele roda de uma cópia na pasta temporária.
  ${If} $UpdateMode <> 1
  ${AndIf} $EXEDIR != $INSTDIR
    ${If} ${FileExists} "$INSTDIR\main.exe"
    ${OrIf} ${FileExists} "$INSTDIR\Data\*.*"
      RMDir /r "$INSTDIR"
    ${EndIf}
  ${EndIf}
!macroend
