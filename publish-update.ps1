# Publica um patch do jogo no Cloudflare R2 (servido em https://updates.asgardmu.com.br/).
#
# Fluxo:
#   1. Gere o patch com o update-creator (cria a pasta "update" com update.json + arquivos)
#   2. Rode: .\publish-update.ps1 -Source "C:\caminho\para\update"
#
# Os arquivos são enviados primeiro e o update.json por último, para que nenhum jogador
# receba um manifest que aponte para arquivos ainda não enviados.
#
# Requer: rclone (https://rclone.org/) com um remote S3 para o R2 configurado.
# Veja "Publicar patches" no README.en.md.

param(
    [Parameter(Mandatory=$false)]
    [string]$Source = (Join-Path $PSScriptRoot "..\update"),

    # Nome do remote configurado no rclone
    [Parameter(Mandatory=$false)]
    [string]$Remote = "r2",

    [Parameter(Mandatory=$false)]
    [string]$Bucket = "asgard-mu-updates",

    # Remove do bucket arquivos que não estão mais na pasta do patch
    [switch]$Prune,

    # Mostra o que seria feito, sem enviar nada
    [switch]$DryRun
)

$manifestName = "update.json"

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
    Write-Host "Erro: rclone não encontrado. Instale com: winget install Rclone.Rclone" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $Source)) {
    Write-Host "Erro: pasta do patch não encontrada: $Source" -ForegroundColor Red
    exit 1
}
$Source = (Resolve-Path $Source).Path

$manifestPath = Join-Path $Source $manifestName
if (-not (Test-Path $manifestPath)) {
    Write-Host "Erro: $manifestName não encontrado em $Source (gere o patch com o update-creator)" -ForegroundColor Red
    exit 1
}

# Validar o manifest antes de enviar
try {
    $manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $files = if ($manifest.files) { $manifest.files } else { $manifest }
    $missing = @($files | Where-Object { -not (Test-Path (Join-Path $Source $_.path)) })
    if ($missing.Count -gt 0) {
        Write-Host "Erro: $($missing.Count) arquivo(s) do manifest não existem na pasta. Ex.: $($missing[0].path)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "Erro: $manifestName inválido: $_" -ForegroundColor Red
    exit 1
}

$target = "${Remote}:${Bucket}"
$extraArgs = @("--checksum", "--progress", "--transfers", "8")
if ($DryRun) { $extraArgs += "--dry-run" }

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Publicando patch no R2" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Origem:   $Source"
Write-Host "Destino:  $target"
Write-Host "Arquivos: $(@($files).Count)"
Write-Host ""

Write-Host "[1/2] Enviando arquivos do jogo..." -ForegroundColor Cyan
$mode = if ($Prune) { "sync" } else { "copy" }
& rclone $mode $Source $target --exclude "/$manifestName" @extraArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao enviar arquivos. O update.json NÃO foi publicado." -ForegroundColor Red
    exit 1
}

Write-Host "[2/2] Publicando $manifestName..." -ForegroundColor Cyan
& rclone copyto $manifestPath "$target/$manifestName" --checksum @extraArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao publicar $manifestName" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Patch publicado: https://updates.asgardmu.com.br/$manifestName" -ForegroundColor Green
