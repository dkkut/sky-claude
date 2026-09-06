@echo off
setlocal

set http_proxy=
set https_proxy=
set HTTP_PROXY=
set HTTPS_PROXY=
set npm_config_http_proxy=
set npm_config_https_proxy=

echo [SKY/BLOOM] Installing dependencies...
call npm install
if errorlevel 1 goto :fail

echo [SKY/BLOOM] Starting dev server on http://localhost:4173
call npm run dev:local
if errorlevel 1 goto :fail

goto :eof

:fail
echo [SKY/BLOOM] Failed. Check network/proxy settings for npm registry access.
exit /b 1
