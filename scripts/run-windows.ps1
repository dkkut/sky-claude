$ErrorActionPreference = "Stop"

Write-Host "[SKY/BLOOM] Clearing proxy vars for this shell..." -ForegroundColor Cyan
$proxyVars = @(
  "http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY",
  "npm_config_http_proxy", "npm_config_https_proxy"
)

foreach ($name in $proxyVars) {
  Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}

Write-Host "[SKY/BLOOM] Installing dependencies..." -ForegroundColor Cyan
npm install

Write-Host "[SKY/BLOOM] Starting dev server on http://localhost:4173" -ForegroundColor Green
npm run dev:local
