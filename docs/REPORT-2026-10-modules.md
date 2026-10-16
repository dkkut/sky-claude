# Отчёт по доработке Sky (модули 1–20)

Составлен по состоянию ветки `claude/project-server-setup-opwwui`. Подробности по каждому модулю — в `CLAUDE.md` (раздел с тем же названием). Проверено тестами в тестовой среде (Postgres, Redis, поддельные поставщики); на боевом сервере, настоящих sshd/PAM, S3, платёжных и AI-провайдерах, Android/Windows-сборках — НЕ проверялось.

## 1. Найденные ошибки и 2. их причины
| Ошибка | Причина |
|---|---|
| Владелец терял доступ при технических/аварийных работах | Сессия без выбранного профиля (после входа, экран PIN) считалась обычным человеком → 503; клиент навсегда показывал заглушку. Медиа-запросы владельца по пропуску тоже получали 503. |
| Закрытая панель позволяла операции | Проверка `admin_lockdown` стояла только в WS и нескольких функциях, прямые HTTP-запросы админа работали. |
| Покупка Sky Gifts / «какие-то владельцы» | Списание → передача → возврат отдельными вызовами (сбой между ними терял деньги и подарок); нераспроданные NFT принадлежат платформе `Sky Mint`, а экраны считали его человеком. |
| Общий счёт семьи виден одному | Баланс хранился только в localStorage внёсшего; серверной сущности не было. |
| Отклонённая заявка курьера после подтверждения паспорта | Состояние `rejected` было конечным; одобрять можно было только `pending`. |
| Квоты хранилища: «Что-то пошло не так» (React #310) | `useCodeGate()` вызывался после раннего `return` — менялся порядок хуков. |
| Реквизиты SkyKassa: телефон не принимался | Тип по умолчанию «account» проверял телефон как счёт; в форме не было БИК/корр. счёта/ИНН. |
| Ёмкость хранилища = диск сервера | При S3 ёмкость считалась как min(лимит, диск сервера). |
| Кнопки «Отмена» не нажимались | Мелкий текст без области нажатия; панель отмены открывалась вне экрана. |
| Чужая кастомизация не видна | Клиент грузил только своё надетое; баннер маркета не рисовался в шапке профиля. |
| Автоудаления файлов | 20-дневная чистка личных файлов и автоочистка карантина (по решению владельца отключены). |

## 3. Файлы
Серверные: `server/{platformaccess,transport,oidc,sshgate,accountrecovery,primecashback,primerewards,aiusage,partners,contentmod,familywallet,systemhealth,customization,logistics,courierverify,skystoragelimits,skystorageindex,storagequota,family}.mjs` и `server/routes/*` с теми же именами; клиентские: `src/admin/*Tab.tsx` (Storage, SkyKassa, Site, Prime, AiUsage, Partners, Content, Ssh, Oidc, Systems), `src/family/*`, `src/customization/*`, `src/profile/viewer/*`, `src/messenger/{ChatWindow,ChatList}.tsx`, `src/partners/`, `src/ai/`, `src/oidc/`, `src/prime/`; скрипты `scripts/{ssh-gate,harden-ssh,setup-ssh-gate,reset-2fa,check-tls}.*`; `nginx/*`; `docs/`.

## 4. API (новые / изменённые)
`/api/oidc/*`, `/api/admin/oidc/*`; `/api/auth/two-factor/reset/*`, `/api/skyid/two-factor/backup-codes`, `/api/skyid/contact/guard-code`; `/api/prime/cashback|rewards*`, `/api/admin/prime*`; `/api/admin/ai-usage*`; `/api/ai/ask`; `/api/partners*`, `/api/admin/partners*`; `/api/admin/ssh*`, `/api/ssh-gate/legacy*`; `/api/admin/content/trash` и `…/trash/:id/restore`, `DELETE /api/admin/content/:kind/:id` (теперь мягкое); `GET /api/family/:id/wallet`, `POST …/wallet-topup|wallet-withdraw|wallet-contribute`; `GET /api/customization/of`; `GET /api/admin/analytics/systems`; `PUT /api/admin/storage/settings|quotas|schedules` (теперь с кодом).

## 5–6. Миграции и таблицы
130 `oidc` · 131 `ssh_gate_controls` · 132 `account_recovery` (`sky_backup_codes`, `two_factor_resets`, `contact_change_log`) · 133 `prime_cashback_rewards` (`prime_cashback`, `prime_rewards`, `prime_redemptions`, `prime_settings`) · 134 `ai_usage` (`ai_usage_daily`, `ai_events`, `ai_alerts_sent`) · 135 `partners` (`partners`, `partner_log`) · 136 `content_trash` · 137 `family_wallet` (`family_wallet`, `family_wallet_tx`). Индексы — в самих файлах (UNIQUE на идемпотентность: `prime_cashback(order_id)`, `family_wallet_tx(family,profile,idem_key)` и др.).

## 7. Механизмы безопасности
Шлюз админки и SSH с подтверждением владельцем (ссылка + код), рубильник SSH; step-up с кодом для критических действий хранилища, Prime, AI-бюджета, партнёров; OIDC только code+PKCE, попарные `sub`; резервные коды и сброс 2FA с ожиданием 48 ч; защита смены почты/номера; HTTPS-принуждение (426), токены не попадают в журнал nginx; деньги и баллы — одной транзакцией под `FOR UPDATE` с идемпотентностью; проверка прав ролей на сервере; лимиты запросов; закрытая панель отсекает права в `rightsOf()`.

## 8. Тесты (последний прогон)
contentmod 27 · skystorage 153 (с `STORAGE_QUARANTINE_AUTOPURGE=1`) · familywallet 20 · courier-reapply 9 · customization-peers 5 · systemhealth 11 · prime-gates 12 · primerewards 39 · gifts-buy 47 · transport 20 · platform-access 26 · modclosure 11 · accountfreeze 45 · devicelink 37 · ippin 42 (с `WS_ORIGIN`) · adminmoney 29 · wallet 26. Ранее в ходе работы: partners 48, aiusage 26, recovery 43, sshgate 40 + sshgate2 24, oidc 65. `tsc`, `i18n:check`, `vite build` — чисто.
Не проходят в этой среде (причины среды/данных, не кода): `registration-test` — 1 проверка зависит от накопленной статистики; `mint-test` — завязан на состояние тестовой базы (несколько владельцев у одного подарка после прежних прогонов; боевую логику покупки проверяет `gifts-buy-test`); `ws-authz`/`trash` без настроенного origin сокета.

## 9. Оставшиеся проблемы
- Деньги, внесённые в общий счёт семьи ДО модуля, остались только в браузере внёсшего и на сервер не перенесены; цели, карманные деньги и очередь одобрений семьи по-прежнему на устройстве, лимиты вывода — клиентские.
- Резервные копии Storage в том же бакете, что и файлы (в панели помечено «не независимая площадка»); отдельной настройки второго бакета нет.
- Подкасты и Sky Video не в корзине контента; вложения мессенджера не в S3.
- «Остаток токенов у поставщика» не получить обычным ключом — показывается «неизвестно».
- GitHub Actions падали сразу при запуске (вероятно, лимит/оплата) — деплой делался вручную.

## 10–11. Настройки и секреты вручную
`DOMAIN` (домен приложения), `OWNER_USERNAME`, `ENCRYPTION_KEY` (хранить отдельно!), `SSH_GATE_SECRET` (≥24 знаков), `STORAGE_KEK_<ID>`/`STORAGE_KEK_ACTIVE`, `STORAGE_S3_*` + `STORAGE_PRIMARY=s3`, `STORAGE_QUARANTINE_AUTOPURGE` (по желанию), `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL`, `VAPID_*`, `FCM_SERVICE_ACCOUNT_JSON`, `GOOGLE_MAPS_KEY`/`YANDEX_*`, `SKYKASSA_PARTNER_*`. В админке: «Общий объём» хранилища (1 ТБ), лимиты токенов AI, правила кэшбэка, каталог наград (по умолчанию пуст), партнёры. На сервере: `scripts/setup-ssh-gate.sh`, `scripts/harden-ssh.sh` (с открытым вторым терминалом), пересоздать nginx после обновления шаблона.

## 12. Как проверить в приложении
Админка → «Состояние систем» (все блоки без ошибок); «Контент» → снять материал → «Корзина» → «Вернуть»; семья → «Общий счёт» с двух аккаунтов; профиль/чат с человеком с надетым баннером; Sky Storage → «Квоты и пороги»; SkyKassa → реквизит типа «Расчётный счёт»; SSH-вход → письмо → подтверждение; `bash scripts/check-tls.sh web.<домен>`.

## 13. Откат
Код — `git revert` коммитов ветки; миграции аддитивные (новые таблицы/колонки), откат — оставить таблицы неиспользуемыми; SSH-шлюз — `touch /etc/sky-ssh-gate.off` или `ssh-gate.sh --uninstall`; `harden-ssh.sh --rollback`; шлюз админки — `ADMIN_GATE=off`; автоуборки — переменные выше; мягко удалённый контент возвращается из корзины 7 дней.

## 14. Остающиеся риски
Не проверены на реальной инфраструктуре: sshd/PAM, S3, платёжные адаптеры, AI-провайдер, Android/Windows-сборки, nginx-конфиг (`nginx -t` при деплое). TLS не скрывает IP и объём соединений. Подтверждение SSH — не единственная защита: нужны ключи и ограничение доступа. Продуктовые цифры (кэшбэк, лимиты) выбраны мной и требуют проверки владельцем. Бета-доступ и демо-данные в боевой базе нужно проверить отдельно.
