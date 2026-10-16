/**
 * Кого пропускают мимо «Технических» и «Аварийных работ».
 *
 * Режим работ закрывает сайт для людей, но не для тех, кто должен его чинить:
 *   — «Аварийные работы» (shutdown) — проходит только владелец;
 *   — «Технические работы» (maintenance) — владелец и администраторы.
 * Раньше решение принималось только по ПРОФИЛЮ сессии. Но сразу после входа — пока профиль ещё не выбран, а также
 * на экране «PIN при смене IP» — у сессии есть только Sky ID, профиля нет. Такой запрос считался запросом обычного человека,
 * получал 503, а клиент навсегда показывал «Технические работы»: владелец не мог ни выбрать профиль, ни ввести PIN.
 * Теперь для запросов к /api/skyid/* (список и выбор профиля, PIN, устройства) учитывается Sky ID целиком: если у него есть
 * профиль владельца (для shutdown) или администратора (для maintenance), запрос проходит. Решение остаётся серверным и
 * точечным: на остальные разделы такой доступ без выбранного профиля не распространяется, а каждый обработчик по-прежнему
 * сам проверяет права. Постоянного обхода аутентификации это не создаёт — нужна действующая сессия Sky ID.
 */
import { query } from './db.mjs';
import { config } from './config.mjs';
import { isAdmin, isOwnerRaw } from './admin.mjs';

const SKYID_PATH = /^\/api\/skyid(\/|$)/;

const skyIdHasStaff = async (skyId, kind) => {
  const name = String(config.ownerUsername ?? '').trim().toLowerCase();
  const { rowCount } = await query(
    kind === 'shutdown'
      ? 'SELECT 1 FROM profiles WHERE sky_id = $1 AND lower(username) = $2 LIMIT 1'
      : 'SELECT 1 FROM profiles WHERE sky_id = $1 AND (is_admin OR lower(username) = $2) LIMIT 1',
    [skyId, name || ' ']);
  return rowCount > 0;
};

/**
 * Проходит ли этот запрос сквозь включённый режим. `session` — результат readSession (или null), `mediaWho` — профиль из
 * пропуска на медиа. `kind` — какой режим действует: 'shutdown' | 'maintenance'.
 */
export const passesPlatformMode = async ({ session, mediaWho, url, kind }) => {
  const who = session?.profileId ?? mediaWho ?? null;
  if (who) return kind === 'shutdown' ? isOwnerRaw(who) : isAdmin(who);
  if (session?.skyId && SKYID_PATH.test(url)) return skyIdHasStaff(session.skyId, kind);
  return false;
};

/** Для ручки статуса: может ли именно этот посетитель работать при активном режиме (клиент тогда не показывает заглушку). */
export const viewerBypasses = async (session, kind) => {
  if (!session) return false;
  if (session.profileId) return kind === 'shutdown' ? isOwnerRaw(session.profileId) : isAdmin(session.profileId);
  return skyIdHasStaff(session.skyId, kind);
};
