#!/usr/bin/env node
// Экстренное восстановление ВЛАДЕЛЬЦА — только с консоли сервера (никакая роль в панели этого сделать не может).
//   docker compose exec api node scripts/recover-owner.mjs SR-10482          # покажет заявку и что будет сделано
//   docker compose exec api node scripts/recover-owner.mjs SR-10482 --yes    # отметит заявку как одобренную консолью
// Что это даёт: заявка владельца получает статус «Восстановление разрешено» с пометкой консольного одобрения. Доступ не выдаётся:
// владелец проходит сайт восстановления с ключом чата заявки, затем обязательное ожидание (OWNER_RECOVERY_WAIT_HOURS × 2) со ссылкой «отменить»
// на основную и резервную почты, после чего все сессии завершаются, второй фактор сбрасывается и владелец настраивает защиту заново.
// Перед запуском проверьте человека независимыми от Sky способами (звонок, личная встреча, документы хостера/домена). Всё пишется в журнал безопасности.
import { query } from '../server/db.mjs';
import { logEvent, flushNow } from '../server/skylog.mjs';

const number = String(process.argv[2] ?? '').toUpperCase();
const go = process.argv.includes('--yes');
if (!/^SR-\d+$/.test(number)) { console.error('Использование: recover-owner.mjs SR-12345 [--yes]'); process.exit(1); }
const { rows } = await query(`SELECT id, sky_id, account_kind, status, contact_email FROM recovery_cases WHERE number = $1`, [number]);
const c = rows[0];
if (!c) { console.error('Заявка не найдена'); process.exit(1); }
if (c.account_kind !== 'owner') { console.error('Это не заявка владельца: консоль подтверждает только их. Остальные решаются в панели.'); process.exit(1); }
if (!c.sky_id) { console.error('Заявка не привязана к аккаунту (нет Sky ID): сначала привяжите вручную, проверив личность.'); process.exit(1); }
console.log(`Заявка ${number}: статус ${c.status}, Sky ID ${c.sky_id}, контакт ${c.contact_email}.`);
if (!go) { console.log('Ничего не изменено. Добавьте --yes после независимой проверки личности владельца.'); process.exit(0); }
await query(`UPDATE recovery_cases SET status = 'allowed', updated_at = now(), unread_user = unread_user + 1 WHERE id = $1`, [c.id]);
await query(`INSERT INTO recovery_case_log (case_id, actor_id, event, detail) VALUES ($1, NULL, 'console_approved', 'одобрено с консоли сервера'), ($1, NULL, 'status:allowed', 'консоль')`, [c.id]);
logEvent({ category: 'security', service: 'recovery', type: 'owner_case_console_approved', level: 'CRITICAL', targetId: c.sky_id, detail: { number } });
await flushNow();
console.log('Готово. Сообщите владельцу: сайт восстановления → «Экстренное восстановление владельца» → фактор «Ключ разрешённой заявки».');
process.exit(0);
