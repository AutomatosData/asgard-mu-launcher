# BUILD LIMPO - APENAS ESSENCIAL (PowerShell)
Write-Host "========================================" -ForegroundColor Green
Write-Host "   BUILD LIMPO - APENAS ESSENCIAL" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Garantir execucao no diretorio do script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "[1/5] Parando processos..." -ForegroundColor Yellow
taskkill /f /im AsgardMU.exe 2>$null
taskkill /f /im electron.exe 2>$null

Write-Host "[2/5] Aguardando processos finalizarem..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host "[3/5] Limpando..." -ForegroundColor Yellow
if (Test-Path "temp-build") { Remove-Item "temp-build" -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path "dist-limpo") { Remove-Item "dist-limpo" -Recurse -Force -ErrorAction SilentlyContinue }
# Sobras de temp-build fazem o Copy-Item aninhar pastas (node_modules\node_modules) e quebram o build
if (Test-Path "temp-build") {
    Write-Host "Nao foi possivel remover temp-build (arquivos em uso). Feche processos e tente novamente." -ForegroundColor Red
    exit 1
}

Write-Host "[4/5] Criando pasta temporaria limpa..." -ForegroundColor Yellow
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
# Dependencias ja copiadas de node_modules (evitar reinstalacao para manter devDependencies necessarias)
Write-Host "- Pulando etapa de npm (usando node_modules copiado)" -ForegroundColor Cyan

# Empacotar com ASAR para ocultar fontes
# Especificar explicitamente a versao do Electron para evitar erro de deteccao
# Usar a versao instalada (package.json pode conter ranges como ^39.0.0, invalidos para download)
$electronVersion = (Get-Content node_modules/electron/package.json -Raw | ConvertFrom-Json).version
if (-not $electronVersion) { $electronVersion = ((Get-Content ../package.json -Raw | ConvertFrom-Json).devDependencies.electron) -replace '^[\^~]', '' }
npx @electron/packager . AsgardMU --platform=win32 --arch=x64 --out=../dist-limpo --overwrite --icon=icon.ico --asar --electron-version=$electronVersion
Set-Location ".."

Write-Host "[6/5] Aplicando manifest de administrador..." -ForegroundColor Yellow
if (Test-Path "dist-limpo\AsgardMU-win32-x64\AsgardMU.exe") {
    Write-Host "Executavel encontrado, aplicando manifest..." -ForegroundColor Green
    
    Write-Host "Criando manifest temporario..." -ForegroundColor Cyan
    @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" processorArchitecture="*" name="AsgardMU" type="win32"/>
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
    # Localizar mt.exe x64 do Windows SDK mais recente instalado
    $mtExe = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\mt.exe" -ErrorAction SilentlyContinue |
        Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1 -ExpandProperty FullName
    $mtOk = $false
    if ($mtExe) {
        & $mtExe -manifest "app.manifest" "-outputresource:dist-limpo\AsgardMU-win32-x64\AsgardMU.exe;#1"
        $mtOk = ($LASTEXITCODE -eq 0)
    } else {
        Write-Host "mt.exe nao encontrado (instale o Windows SDK)" -ForegroundColor Red
    }
    if ($mtOk) {
        Write-Host "Manifest de administrador aplicado com sucesso" -ForegroundColor Green
        Write-Host "Launcher solicitara privilegios de administrador via UAC" -ForegroundColor Green
    } else {
        Write-Host "Falha ao aplicar manifest" -ForegroundColor Red
    }
    
    Write-Host "Removendo manifest temporario..." -ForegroundColor Cyan
Remove-Item "app.manifest" -Force -ErrorAction SilentlyContinue

Write-Host "Finalizando build..." -ForegroundColor Cyan
Start-Sleep -Seconds 1

Write-Host "Removendo arquivos desnecessarios..." -ForegroundColor Cyan
if (Test-Path "dist-limpo\AsgardMU-win32-x64\LICENSE") { 
    Remove-Item "dist-limpo\AsgardMU-win32-x64\LICENSE" -Force -ErrorAction SilentlyContinue
    Write-Host "LICENSE removido" -ForegroundColor Green
}
if (Test-Path "dist-limpo\AsgardMU-win32-x64\LICENSES.chromium.html") { 
    Remove-Item "dist-limpo\AsgardMU-win32-x64\LICENSES.chromium.html" -Force -ErrorAction SilentlyContinue
    Write-Host "LICENSES.chromium.html removido" -ForegroundColor Green
}

# Remover pasta swiftshader (renderizacao de software - ~10MB)
if (Test-Path "dist-limpo\AsgardMU-win32-x64\swiftshader") { 
    Remove-Item "dist-limpo\AsgardMU-win32-x64\swiftshader" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "swiftshader/ removido (~10MB)" -ForegroundColor Green
}

# Remover idiomas desnecessarios, mantendo apenas en-US (~5MB)
if (Test-Path "dist-limpo\AsgardMU-win32-x64\locales") { 
    $localesPath = "dist-limpo\AsgardMU-win32-x64\locales"
    $keepLocales = @("en-US.pak")
    
    Get-ChildItem $localesPath -Filter "*.pak" | ForEach-Object {
        if ($_.Name -notin $keepLocales) {
            Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "Locales desnecessarios removidos (~5MB)" -ForegroundColor Green
}
} else {
    Write-Host "Executavel nao encontrado" -ForegroundColor Red
}

Write-Host "Limpando pasta temporaria..." -ForegroundColor Cyan
if (Test-Path "temp-build") { 
    try {
        Remove-Item "temp-build" -Recurse -Force -ErrorAction Stop
        Write-Host "Pasta temporaria removida" -ForegroundColor Green
    } catch {
        Write-Host "Nao foi possivel remover pasta temporaria (pode estar em uso)" -ForegroundColor Yellow
    }
}