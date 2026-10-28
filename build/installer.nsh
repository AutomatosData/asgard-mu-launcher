; Macros do instalador do AsgardMU (electron-builder, "nsis.include" no package.json)
;
; O jogo fica na mesma pasta do launcher. O desinstalador padrão do electron-builder
; apaga a pasta inteira, também quando um instalador novo atualiza o launcher.
; Por isso:
;   - atualização (--updated, ver src/main/launcher-update.js): não apaga nada. O
;     instalador novo sobrescreve os arquivos do launcher e o jogo continua lá.
;   - desinstalação pelo Windows: apaga a pasta inteira (launcher e jogo). A página de
;     pasta do instalador sempre termina o caminho em "\AsgardMU".

; Sempre por usuário (sem UAC e sem a página "todos os usuários"): o launcher e o
; jogo gravam na própria pasta, o que não funciona em Program Files
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customRemoveFiles
  ${ifNot} ${isUpdated}
    RMDir /r $INSTDIR
  ${endIf}
!macroend
