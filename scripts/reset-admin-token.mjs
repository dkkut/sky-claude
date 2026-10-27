#!/usr/bin/env node
// Сброс личного токена администратора/владельца ВРУЧНУЮ, на сервере (потерян токен и нет способа выдать новый).
//   docker compose exec api node scripts/reset-admin-token.mjs <@username>        # покажет, что будет сделано
//   docker compose exec api node scripts/reset-admin-token.mjs <@username> --yes  # удалит токен
// После сброса человек входит в панель — ей не хватает токена — и выдаёт новый в Профиль → Sky ID (нужен код аутентификатора).
// Аварийно отключить требование для всех: ADMIN_TOKEN=off в .env и перезапуск api (потом включить обратно).
import { query } from '../server/db.mjs';
import { logAdmin } from '../server/adminsec.mjs';

const name = String(process.argv[2] ?? '').replace(/^@/, '').toLowerCase();
const go = process.argv.includes('--yes');
if (!name) { console.error('Использование: reset-admin-token.mjs <@username> [--yes]'); process.exit(1); }
const { rows } = await query('SELECT id, name, is_admin FROM profiles WHERE lower(username) = $1', [name]);
if (!rows[0]) { console.error('Профиль не найден'); process.exit(1); }
const p = rows[0];
const { rows: t } = await query('SELECT last4, created_at FROM admin_tokens WHERE profile_id = $1', [p.id]);
console.log(`Профиль «${p.name}» (${p.is_admin ? 'администратор' : 'не администратор'}), токен ${t[0] ? `есть (…${t[0].last4}, от ${t[0].created_at.toISOString().slice(0, 10)})` : 'не выдан'}.`);
if (!go) { console.log('Ничего не изменено. Добавьте --yes, чтобы удалить токен и закрыть открытые настройки.'); process.exit(0); }
await query('DELETE FROM admin_tokens WHERE profile_id = $1', [p.id]);
await query('DELETE FROM admin_token_unlock WHERE profile_id = $1', [p.id]);
await query('DELETE FROM admin_gate_open WHERE profile_id = $1', [p.id]);
await logAdmin({ actorId: null, targetType: 'user', targetId: p.id, type: 'admin_token_manual_reset', detail: 'ручной сброс токена администратора на сервере' }).catch(() => {});
console.log('Готово: токен удалён, панель закрыта. Человеку нужно выдать новый токен в Профиль → Sky ID.');
process.exit(0);
