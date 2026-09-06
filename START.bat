@echo off
echo.
echo  Sky Ecosystem PC - Запуск
echo  ========================
echo.
cd /d "%~dp0"

if not exist "node_modules" (
    echo  Установка зависимостей...
    npm install --legacy-peer-deps
    if errorlevel 1 (
        echo  Пробуем с --force...
        npm install --force
    )
)

echo.
echo  Запуск сервера на http://localhost:4173
echo.
npx vite --host --port 4173
