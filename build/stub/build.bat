@echo off
rem Compila o AsgardMU.exe da pasta do jogo (abre Launcher\AsgardMU.exe). Saida: AsgardMU.exe
setlocal
pushd "%~dp0"
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul || (popd & exit /b 1)
if not exist obj mkdir obj
rc /nologo /fo obj\stub.res stub.rc || (popd & exit /b 1)
cl /nologo /O1 /MT /W3 stub.c obj\stub.res /Foobj\ /FeAsgardMU.exe /link /SUBSYSTEM:WINDOWS user32.lib
set RESULT=%ERRORLEVEL%
popd
exit /b %RESULT%
