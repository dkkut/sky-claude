Write-Host ""
Write-Host " Sky Ecosystem PC - Запуск" -ForegroundColor Cyan
Write-Host " ========================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

if (-not (Test-Path "node_modules")) {
    Write-Host " Установка зависимостей..." -ForegroundColor Yellow
    npm install --legacy-peer-deps
    if ($LASTEXITCODE -ne 0) {
        Write-Host " Пробуем с --force..." -ForegroundColor Yellow
        npm install --force
    }
}

Write-Host ""
Write-Host " Открой в браузере: http://localhost:4173" -ForegroundColor Green
Write-Host ""
npx vite --host --port 4173
