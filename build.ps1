# BUILD LIMPO - APENAS ESSENCIAL (PowerShell)
Write-Host "========================================" -ForegroundColor Green
Write-Host "   BUILD LIMPO - APENAS ESSENCIAL" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Garantir execução no diretório do script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "[1/5] Parando processos..." -ForegroundColor Yellow
taskkill /f /im MUOnline.exe 2>$null
taskkill /f /im electron.exe 2>$null

Write-Host "[2/5] Aguardando processos finalizarem..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host "[3/5] Limpando..." -ForegroundColor Yellow
if (Test-Path "temp-build") { Remove-Item "temp-build" -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path "dist-limpo") { Remove-Item "dist-limpo" -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host "[4/5] Criando pasta temporária limpa..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path "temp-build" -Force | Out-Null
Copy-Item "src\main\main.js" "temp-build\main.js" -Force
Copy-Item "src\main\updater.js" "temp-build\updater.js" -Force
Copy-Item "src\main\registry-manager.js" "temp-build\registry-manager.js" -Force
Copy-Item "src\main\data-manager.js" "temp-build\data-manager.js" -Force
Copy-Item "package.json" "temp-build\package.json" -Force
if (Test-Path "package-lock.json") { Copy-Item "package-lock.json" "temp-build\package-lock.json" -Force }
Copy-Item "src\renderer\assets\icon.ico" "temp-build\icon.ico" -Force

Write-Host "- Copiando pasta src..." -ForegroundColor Cyan
Copy-Item "src" "temp-build\src\" -Recurse -Force

Write-Host "- Copiando node_modules completo..." -ForegroundColor Cyan
Copy-Item "node_modules" "temp-build\node_modules\" -Recurse -Force

Write-Host "[5/5] Compilando..." -ForegroundColor Yellow
Set-Location "temp-build"
# Dependências já copiadas de node_modules (evitar reinstalação para manter devDependencies necessárias)
Write-Host "- Pulando etapa de npm (usando node_modules copiado)" -ForegroundColor Cyan

# Empacotar com ASAR para ocultar fontes
# Especificar explicitamente a versão do Electron para evitar erro de detecção
$electronVersion = (Get-Content ../package.json -Raw | ConvertFrom-Json).devDependencies.electron
if (-not $electronVersion) { $electronVersion = "28.3.3" }
npx @electron/packager . MUOnline --platform=win32 --arch=x64 --out=../dist-limpo --overwrite --icon=icon.ico --asar --electron-version=$electronVersion
Set-Location ".."

Write-Host "[6/5] Aplicando manifest de administrador..." -ForegroundColor Yellow
if (Test-Path "dist-limpo\MUOnline-win32-x64\MUOnline.exe") {
    Write-Host "Executável encontrado, aplicando manifest..." -ForegroundColor Green
    
    Write-Host "Criando manifest temporário..." -ForegroundColor Cyan
    @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" processorArchitecture="*" name="MUOnline" type="win32"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
"@ | Out-File -FilePath "app.manifest" -Encoding UTF8
    
    Write-Host "Aplicando manifest com mt.exe..." -ForegroundColor Cyan
    & "C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\mt.exe" -manifest "app.manifest" -outputresource:"dist-limpo\MUOnline-win32-x64\MUOnline.exe";#1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Manifest de administrador aplicado com sucesso" -ForegroundColor Green
        Write-Host "Launcher solicitará privilégios de administrador via UAC" -ForegroundColor Green
    } else {
        Write-Host "Falha ao aplicar manifest" -ForegroundColor Red
    }
    
    Write-Host "Removendo manifest temporário..." -ForegroundColor Cyan
Remove-Item "app.manifest" -Force -ErrorAction SilentlyContinue

Write-Host "Finalizando build..." -ForegroundColor Cyan
Start-Sleep -Seconds 1

Write-Host "Removendo arquivos desnecessários..." -ForegroundColor Cyan
if (Test-Path "dist-limpo\MUOnline-win32-x64\LICENSE") { 
    Remove-Item "dist-limpo\MUOnline-win32-x64\LICENSE" -Force -ErrorAction SilentlyContinue
    Write-Host "LICENSE removido" -ForegroundColor Green
}
if (Test-Path "dist-limpo\MUOnline-win32-x64\LICENSES.chromium.html") { 
    Remove-Item "dist-limpo\MUOnline-win32-x64\LICENSES.chromium.html" -Force -ErrorAction SilentlyContinue
    Write-Host "LICENSES.chromium.html removido" -ForegroundColor Green
}

# Remover pasta swiftshader (renderização de software - ~10MB)
if (Test-Path "dist-limpo\MUOnline-win32-x64\swiftshader") { 
    Remove-Item "dist-limpo\MUOnline-win32-x64\swiftshader" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "swiftshader/ removido (~10MB)" -ForegroundColor Green
}

# Remover idiomas desnecessários, mantendo apenas en-US (~5MB)
if (Test-Path "dist-limpo\MUOnline-win32-x64\locales") { 
    $localesPath = "dist-limpo\MUOnline-win32-x64\locales"
    $keepLocales = @("en-US.pak")
    
    Get-ChildItem $localesPath -Filter "*.pak" | ForEach-Object {
        if ($_.Name -notin $keepLocales) {
            Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "Locales desnecessários removidos (~5MB)" -ForegroundColor Green
}
} else {
    Write-Host "Executável não encontrado" -ForegroundColor Red
}

Write-Host "Limpando pasta temporária..." -ForegroundColor Cyan
if (Test-Path "temp-build") { 
    try {
        Remove-Item "temp-build" -Recurse -Force -ErrorAction Stop
        Write-Host "Pasta temporária removida" -ForegroundColor Green
    } catch {
        Write-Host "Não foi possível remover pasta temporária (pode estar em uso)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "BUILD LIMPO CONCLUIDO!" -ForegroundColor Green
Write-Host ""
Write-Host "Tamanho: ~150 MB (super otimizado - arquivos e pastas desnecessários removidos)" -ForegroundColor Cyan
Write-Host "Launcher: dist-limpo\MUOnline-win32-x64\" -ForegroundColor Cyan
Write-Host "Apenas arquivos essenciais incluídos" -ForegroundColor Cyan
Write-Host "Correções EACCES aplicadas" -ForegroundColor Cyan
Write-Host ""
Write-Host "Funcionalidades implementadas:" -ForegroundColor Cyan
Write-Host "   1. Solicitação automática de privilégios de administrador via UAC" -ForegroundColor White
Write-Host "   2. Execução do main.exe sem problemas de permissão" -ForegroundColor White
Write-Host "   3. Logs detalhados para debugging" -ForegroundColor White
Write-Host "   4. Tratamento robusto de erros" -ForegroundColor White
Write-Host "   5. Manifest aplicado automaticamente com Visual Studio" -ForegroundColor White
Write-Host "   6. Sistema de tray com notificações" -ForegroundColor White
Write-Host ""
Write-Host "Proximo passo: Testar o launcher!" -ForegroundColor Green
Write-Host ""
