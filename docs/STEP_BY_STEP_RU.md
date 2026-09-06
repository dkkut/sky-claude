# SKY / BLOOM — пошагово для новичка

## День 1: Запуск и базовая проверка

1. `npm run dev:win`
2. Открыть `http://localhost:4173`
3. Перекликать все модули в sidebar
4. Убедиться, что UI не ломается

## День 2: Backend foundation

1. Создать папку `backend/`
2. Инициализировать Node + Express + TypeScript
3. Поднять `/health` endpoint
4. Добавить `.env` и порт `4000`

## День 3: Auth

1. `/auth/register`
2. `/auth/login`
3. JWT access + refresh
4. Middleware проверки токена

## День 4: База данных

1. PostgreSQL
2. Таблицы: users, tasks, finances, analytics_data, notifications, settings, ai_logs
3. Миграции

## День 5-7: Модули

1. Tasks CRUD + статусы + приоритет
2. Finance CRUD + категории
3. Notifications read/unread
4. Dashboard агрегаты

## День 8+: AI и интеграции

1. Suggestion engine
2. Forecast модуль
3. AI assistant panel

## Правило

Двигаться маленькими итерациями: 1 фича = 1 commit = 1 проверка.
