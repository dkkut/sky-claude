#!/usr/bin/env node
// Сброс второго фактора ВРУЧНУЮ, на сервере (для администраторов и владельца — они не сбрасывают сами через сайт).
//   docker compose exec api node scripts/reset-2fa.mjs <@username>        # покажет, что будет сделано
//   docker compose exec api node scripts/reset-2fa.mjs <@username> --yes  # выполнит
// Выполняет только тот, у кого есть доступ к серверу. Снимает аутентификатор и резервные коды, завершает все сессии, пишет в журнал администрации.
import { query } from '../server/db.mjs';
import { sessionStore } from '../server/sessions.mjs';
import { logAdmin } from '../server/adminsec.mjs';

const name = String(process.argv[2] ?? '').replace(/^@/, '').toLowerCase();
const go = process.argv.includes('--yes');
if (!name) { console.error('Использование: reset-2fa.mjs <@username> [--yes]'); process.exit(1); }
const { rows } = await query('SELECT p.id, p.sky_id, p.name, p.is_admin, s.two_factor_enabled FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE lower(p.username) = $1', [name]);
if (!rows[0]) { console.error('Профиль не найден'); process.exit(1); }
const p = rows[0];
console.log(`Профиль «${p.name}» (${p.is_admin ? 'администратор' : 'обычный'}), второй фактор ${p.two_factor_enabled ? 'включён' : 'не включён'}.`);
if (!go) { console.log('Ничего не изменено. Добавьте --yes, чтобы снять второй фактор, удалить резервные коды и завершить все сессии.'); process.exit(0); }
await query(`UPDATE sky_ids SET two_factor_enabled = FALSE, two_factor_secret = NULL, two_factor_method = 'app', updated_at = now() WHERE id = $1`, [p.sky_id]);
await query('DELETE FROM sky_backup_codes WHERE sky_id = $1', [p.sky_id]);
await query(`UPDATE two_factor_resets SET status = 'cancelled', decided_at = now() WHERE sky_id = $1 AND status = 'pending'`, [p.sky_id]);
const n = await sessionStore.revokeAllForUser(p.sky_id);
await logAdmin({ actorId: null, targetType: 'user', targetId: p.id, type: 'two_factor_manual_reset', detail: `ручной сброс на сервере; сессий завершено: ${n}` }).catch(() => {});
console.log(`Готово: второй фактор снят, резервные коды удалены, сессий завершено: ${n}. Человеку нужно войти и включить защиту заново.`);
process.exit(0);
