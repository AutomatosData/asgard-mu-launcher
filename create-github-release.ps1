# Cria um GitHub Release com o cliente completo do jogo (instalação inicial).
# O launcher baixa sempre o asset "AsgardMU-Client.zip" do release mais recente:
#   https://github.com/<Owner>/<Repo>/releases/latest/download/AsgardMU-Client.zip
#
# Uso: .\create-github-release.ps1 -Version "v1.0.0" -GamePath "C:\path\to\game"
# Requer: GitHub CLI (gh) autenticado com permissão de escrita no repositório.

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,

    [Parameter(Mandatory=$true)]
    [string]$GamePath,

    [Parameter(Mandatory=$false)]
    [string]$Owner = "AutomatosData",

    [Parameter(Mandatory=$false)]
    [string]$Repo = "asgard-mu-client",

    [Parameter(Mandatory=$false)]
    [string]$ReleaseNotes = "Update release $Version"
)

# Deve ser igual a GITHUB.CLIENT_ASSET em src/shared/url-config.js
$assetName = "AsgardMU-Client.zip"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "Erro: GitHub CLI (gh) não encontrado. Instale em https://cli.github.com/" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $GamePath)) {
    Write-Host "Erro: Caminho do jogo não encontrado: $GamePath" -ForegroundColor Red
    exit 1
}

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Criando GitHub Release: $Version" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Pasta temporária para montar o conteúdo do release
$tempDir = Join-Path $env:TEMP "github-release-$Version"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host "[1/3] Preparando arquivos..." -ForegroundColor Cyan

# Itens (relativos à pasta do jogo) incluídos no release, mantendo a estrutura de pastas
$itemsToInclude = @(
    "Data",
    "main.exe",
    "Settings.ini"
)

$copiedItems = @()
foreach ($item in $itemsToInclude) {
    $sourcePath = Join-Path $GamePath $item
    if (Test-Path $sourcePath) {
        Write-Host "  - Copiando: $item" -ForegroundColor Gray
        Copy-Item $sourcePath (Join-Path $tempDir $item) -Recurse -Force
        $copiedItems += $item
    } else {
        Write-Host "  - Ignorado (não encontrado): $item" -ForegroundColor Yellow
    }
}

# Criar ZIP com tar.exe do Windows (suporta arquivos > 2 GB, ao contrário de Compress-Archive)
$zipDir = Join-Path $env:TEMP "github-release-$Version-zip"
if (Test-Path $zipDir) { Remove-Item $zipDir -Recurse -Force }
New-Item -ItemType Directory -Path $zipDir | Out-Null
$zipPath = Join-Path $zipDir $assetName

Write-Host "[2/3] Criando arquivo ZIP..." -ForegroundColor Cyan
if ($copiedItems.Count -eq 0) {
    Write-Host "  Erro: nenhum arquivo do jogo encontrado em $GamePath" -ForegroundColor Red
    exit 1
}
& tar.exe -a -c -f $zipPath -C $tempDir @copiedItems
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Erro ao criar ZIP" -ForegroundColor Red
    exit 1
}

$zipSizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "  ZIP criado: $zipPath ($zipSizeMB MB)" -ForegroundColor Green
if ((Get-Item $zipPath).Length -ge 2GB) {
    Write-Host "  Erro: o GitHub aceita assets de no máximo 2 GB por arquivo." -ForegroundColor Red
    exit 1
}

Write-Host "[3/3] Criando release e enviando o ZIP..." -ForegroundColor Cyan
& gh release create $Version $zipPath --repo "$Owner/$Repo" --title $Version --notes $ReleaseNotes --latest
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Erro ao criar release" -ForegroundColor Red
    exit 1
}

# Limpar arquivos temporários
Write-Host "Limpando arquivos temporários..." -ForegroundColor Cyan
Remove-Item $tempDir -Recurse -Force
Remove-Item $zipDir -Recurse -Force

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Release criado com sucesso!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Version: $Version" -ForegroundColor Cyan
Write-Host "Download: https://github.com/$Owner/$Repo/releases/latest/download/$assetName" -ForegroundColor Cyan
Write-Host ""
