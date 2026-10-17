# Аудит Sky 2026-11 — ход работ

Ветка `claude/project-server-setup-opwwui`. Договорённости с владельцем: критичное сначала; инфраструктура — только конфиги в репозитории (доступа к боевому серверу нет);
зависимости — только патчи; миграции — только добавляющие; **код работающих сервисов не удалялся** (см. `CLEANUP_REPORT.md`).

## Завершено
| Этап | Что сделано |
|---|---|
| 1. Диагностика | инвентаризация, статический обход (маршруты, SQL, SSRF, XSS, секреты, конфиги), реестр — `AUDIT_REPORT.md` |
| 3. Аккаунты | одноразовый refresh-токен (ротация + гашение сессии при повторе), пределы по адресу на отправку кодов и вход по паролю |
| 4. Деньги | покупка Prime одной транзакцией, демо-платежи закрыты в production, журнал кошелька только дописывается, сверка баланса с журналом |
| 8 (частично) | обход всех админских адресов от пользователя и анонима |
| 21. Отчёты | пять документов в корне |

## Изменённые файлы (код)
`server/config.mjs`, `server/skyid.mjs`, `server/routes/skyid.mjs`, `server/routes/auth.mjs`, `server/routes/password.mjs`, `server/wallet.mjs`, `server/systemhealth.mjs`,
`server/migrations/162_wallet_ledger_integrity.sql`, `docker-compose.yml`, `src/wallet/store.ts`, `src/admin/SystemsTab.tsx`, `src/i18n/en.json`, `scripts/wallet-reconcile.mjs`, `scripts/setup-recovery.sh`.

## Тесты этого аудита (все зелёные)
`prime-purchase-atomic-test` 21 · `wallet-ledger-test` 15 · `refresh-rotation-test` 12 · `auth-ip-limits-test` 6 · `admin-authz-sweep-test` 940 проверок по 94 адресам.

## Регрессия после правок (зелёная)
wallet 26 · primerewards 39 · gifts-buy 47 · adminmoney 29 · familywallet 20 · codecampaigns 32 · svid 10 · slots 17 · devicelink 37 · accountfreeze 45 · ws-authz 12 · recovery 43 · rbac (1 допустимое замечание, см. отчёт) ·
prime-gates 11 из 12 (падает «Код» с Prime: у тестового API нет ключа AI, `ai_not_configured` — окружение, не код).
`tsc`, `i18n:check`, `npm run build`, `vite build --mode native` — проходят.

## Не сделано / осталось
- Роль БД: приложение подключается суперпользователем `sky` (см. `SECURITY_REPORT.md`, план).
- Нагрузочные тесты, проверка боевого сервера, восстановление из копии на тестовом окружении, Android-сборка, реальные платёжные провайдеры — не проверялись.
- Не просмотрены построчно: модули Market, GO, Blox, Garant, мессенджер — по ним опирались на их собственные тесты (см. отчёт), а не на новый аудит кода.
- Очистка: список кандидатов есть, удалений нет (нужно решение владельца).

## Следующие действия
1. Деплой (миграция 162), пересборка `.apk`/`.exe`; на сервере `node scripts/wallet-reconcile.mjs` — посмотреть расхождения.
2. Решить по роли БД и шифрованию дампов.
3. Решить по кандидатам на удаление (`CLEANUP_REPORT.md`, категория Б).
