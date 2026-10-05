# Script para criar GitHub Release para o jogo
# Uso: .\create-github-release.ps1 -Version "v1.0.0" -GamePath "C:\path\to\game"

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,
    
    [Parameter(Mandatory=$true)]
    [string]$GamePath,
    
    [Parameter(Mandatory=$false)]
    [string]$GitHubToken = $env:GITHUB_TOKEN,
    
    [Parameter(Mandatory=$false)]
    [string]$Owner = "seu-usuario",
    
    [Parameter(Mandatory=$false)]
    [string]$Repo = "asgardmu-game",
    
    [Parameter(Mandatory=$false)]
    [string]$ReleaseNotes = "Update release $Version"
)

if (-not $GitHubToken) {
    Write-Host "Erro: GITHUB_TOKEN não encontrado. Defina a variável de ambiente ou passe como parâmetro." -ForegroundColor Red
    Write-Host "Exemplo: `$env:GITHUB_TOKEN = 'seu-token'" -ForegroundColor Yellow
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

# Criar arquivo temporário para o release
$tempDir = Join-Path $env:TEMP "github-release-$Version"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host "[1/4] Preparando arquivos..." -ForegroundColor Cyan

# Arquivos para incluir no release (ajuste conforme necessário)
$filesToInclude = @(
    "Data\*",
    "main.exe",
    "Settings.ini"
)

foreach ($pattern in $filesToInclude) {
    $sourcePath = Join-Path $GamePath $pattern
    if (Test-Path $sourcePath) {
        Write-Host "  - Copiando: $pattern" -ForegroundColor Gray
        Copy-Item $sourcePath $tempDir -Recurse -Force
    }
}

# Criar arquivo ZIP
$zipPath = Join-Path $env:TEMP "asgardmu-game-$Version.zip"
Write-Host "[2/4] Criando arquivo ZIP..." -ForegroundColor Cyan
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

Write-Host "  ZIP criado: $zipPath" -ForegroundColor Green
Write-Host "  Tamanho: $((Get-Item $zipPath).Length / 1MB) MB" -ForegroundColor Green

Write-Host "[3/4] Criando release no GitHub..." -ForegroundColor Cyan

# Headers para API do GitHub
$headers = @{
    "Authorization" = "token $GitHubToken"
    "Accept" = "application/vnd.github.v3+json"
}

# Criar release
$releaseBody = @{
    tag_name = $Version
    name = $Version
    body = $ReleaseNotes
    draft = $false
    prerelease = $false
} | ConvertTo-Json

try {
    $releaseResponse = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo/releases" -Method Post -Headers $headers -Body $releaseBody -ContentType "application/json"
    Write-Host "  Release criado: $($releaseResponse.html_url)" -ForegroundColor Green
    $uploadUrl = $releaseResponse.upload_url -replace '\{.*\}', ''
} catch {
    Write-Host "  Erro ao criar release: $_" -ForegroundColor Red
    exit 1
}

Write-Host "[4/4] Fazendo upload do asset..." -ForegroundColor Cyan

# Upload do asset
$assetName = "asgardmu-game-$Version.zip"
$assetPath = $zipPath

$headersUpload = @{
    "Authorization" = "token $GitHubToken"
    "Content-Type" = "application/zip"
}

try {
    $uploadResponse = Invoke-RestMethod -Uri "$uploadUrl?name=$assetName" -Method Post -Headers $headersUpload -InFile $assetPath
    Write-Host "  Asset uploaded: $($uploadResponse.browser_download_url)" -ForegroundColor Green
} catch {
    Write-Host "  Erro ao fazer upload: $_" -ForegroundColor Red
    exit 1
}

# Limpar arquivos temporários
Write-Host "Limpando arquivos temporários..." -ForegroundColor Cyan
Remove-Item $tempDir -Recurse -Force
Remove-Item $zipPath -Force

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Release criado com sucesso!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Version: $Version" -ForegroundColor Cyan
Write-Host "URL: $releaseResponse.html_url" -ForegroundColor Cyan
Write-Host ""
