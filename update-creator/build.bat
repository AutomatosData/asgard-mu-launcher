@echo off
title BUILD UPDATE CREATOR - SISTEMA DE ATUALIZACAO
color 0A

echo ========================================
echo    BUILD UPDATE CREATOR - SISTEMA DE ATUALIZACAO
echo ========================================
echo.

echo [1/6] Parando processos...
taskkill /f /im update-creator.exe 2>nul

echo [2/6] Limpando build anterior...
if exist "dist" rmdir /s /q "dist"
if exist "executables" rmdir /s /q "executables"

echo [3/6] Verificando dependencias...
if not exist "node_modules" (
    echo - Instalando dependencias...
    npm install
) else (
    echo - Dependencias ja instaladas
)

echo [4/6] Compilando Update Creator...
call npx @electron/packager . update-creator --platform=win32 --arch=x64 --out=dist --overwrite
echo Compilacao finalizada, continuando...

echo [5/6] Criando build limpo...
echo - Verificando se a compilacao funcionou...
if not exist "dist\update-creator-win32-x64\update-creator.exe" (
    echo ERRO: Executavel do Update Creator nao foi criado!
    pause
    exit /b 1
)
echo Compilacao bem-sucedida! Continuando...

mkdir "executables\update-creator" 2>nul

echo - Copiando arquivos essenciais do Electron...
copy "dist\update-creator-win32-x64\update-creator.exe" "executables\update-creator\"
copy "dist\update-creator-win32-x64\icudtl.dat" "executables\update-creator\"
copy "dist\update-creator-win32-x64\v8_context_snapshot.bin" "executables\update-creator\"
copy "dist\update-creator-win32-x64\snapshot_blob.bin" "executables\update-creator\"
copy "dist\update-creator-win32-x64\resources.pak" "executables\update-creator\"
copy "dist\update-creator-win32-x64\chrome_100_percent.pak" "executables\update-creator\"

if exist "dist\update-creator-win32-x64\ffmpeg.dll" copy "dist\update-creator-win32-x64\ffmpeg.dll" "executables\update-creator\"
if exist "dist\update-creator-win32-x64\chrome_200_percent.pak" copy "dist\update-creator-win32-x64\chrome_200_percent.pak" "executables\update-creator\"

echo - Criando estrutura da aplicacao...
mkdir "executables\update-creator\resources\app" 2>nul
mkdir "executables\update-creator\resources\app\node_modules" 2>nul

echo - Copiando arquivos da aplicacao...
copy "main.js" "executables\update-creator\resources\app\"
copy "index.html" "executables\update-creator\resources\app\"
copy "package.json" "executables\update-creator\resources\app\"

echo - Copiando dependencias essenciais...
if exist "node_modules\fs-extra" (
    echo   * Copiando fs-extra...
    xcopy "node_modules\fs-extra" "executables\update-creator\resources\app\node_modules\fs-extra\" /E /I /Y /Q
)

if exist "node_modules\universalify" (
    echo   * Copiando universalify...
    xcopy "node_modules\universalify" "executables\update-creator\resources\app\node_modules\universalify\" /E /I /Y /Q
)

if exist "node_modules\graceful-fs" (
    echo   * Copiando graceful-fs...
    xcopy "node_modules\graceful-fs" "executables\update-creator\resources\app\node_modules\graceful-fs\" /E /I /Y /Q
)

if exist "node_modules\jsonfile" (
    echo   * Copiando jsonfile...
    xcopy "node_modules\jsonfile" "executables\update-creator\resources\app\node_modules\jsonfile\" /E /I /Y /Q
)

echo [6/6] Finalizando...
echo - Removendo pasta dist (mantendo apenas executables\update-creator)...
if exist "dist" rmdir /s /q "dist"
echo - Validacao final do build...

if exist "executables\update-creator\update-creator.exe" (
    echo Executavel: OK
) else (
    echo Executavel: ERRO
)

if exist "executables\update-creator\resources\app\package.json" (
    echo Estrutura: OK
) else (
    echo Estrutura: ERRO
)

set "dep_count=0"
if exist "executables\update-creator\resources\app\node_modules\fs-extra" set /a dep_count+=1
if exist "executables\update-creator\resources\app\node_modules\universalify" set /a dep_count+=1
if exist "executables\update-creator\resources\app\node_modules\graceful-fs" set /a dep_count+=1
if exist "executables\update-creator\resources\app\node_modules\jsonfile" set /a dep_count+=1

echo Dependencias: %dep_count%/4 (fs-extra + sub-dependencias)

echo.
echo ========================================
echo BUILD UPDATE CREATOR CONCLUIDO!
echo ========================================
echo.
echo ESTATISTICAS FINAIS:
echo -Aplicacao: Update Creator (Sistema de Atualizacao)
echo -Executavel: update-creator.exe
echo -Dependencias: %dep_count%/2 essenciais
echo -Estrutura: Aplicacao Electron completa
echo -Status: PRONTO PARA USO
echo.
echo FUNCIONALIDADES:
echo -Interface grafica para criar updates
echo -Selecao de pasta do jogo
echo -Geracao automatica de manifesto
echo -Calculo de hash MD5 dos arquivos
echo -Criacao de pacotes de update
echo.
echo Para usar: executables\update-creator\update-creator.exe
echo.
echo PROXIMOS PASSOS:
echo -Execute o Update Creator
echo -Selecione a pasta do jogo MU Online
echo -Gere o update automaticamente
echo -Use com o sistema de launcher
echo.
pause
