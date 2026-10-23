# Sky Ecosystem — Sky V5.1.0 beta

## Запуск на Windows

### Способ 1 — двойной клик (самый простой)
Запусти файл `START.bat` — он сам установит зависимости и запустит приложение.

### Способ 2 — терминал
```cmd
cd sky_work
npm install --legacy-peer-deps
npx vite --host --port 4173
```

### Способ 3 — PowerShell
```ps1
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\START.ps1
```

После запуска открой: **http://localhost:4173**

## Аккаунты

| Логин       | Пароль | Роль       |
|-------------|--------|------------|
| kutuzov     | 0000   | Admin + Prime |
| luna_nova   | 0000   | Prime      |
| neon_driver | 0000   | User       |

## Backend (опционально)
```cmd
node server/server.mjs
```
→ http://localhost:3001

## Требования
- Node.js 18+
- npm 8+
