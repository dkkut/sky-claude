/**
 * Права администратора.
 *
 * Раньше их не было вовсе: колонка is_admin в базе стояла, но её не
 * спрашивала ни одна ручка, а панель администратора меняла записи в
 * localStorage нажавшего. То есть бан, мут и «назначить администратора»
 * не значили ничего.
 *
 * Правило простое: право спрашивается у базы на каждом действии, а не
 * берётся из токена. Иначе снятые права действовали бы до конца сессии
 * — а снимают их обычно как раз тогда, когда ждать нельзя.
 *
 * Владелец задаётся ником в .env. Снять права у него нельзя никому:
 * иначе назначенный администратор мог бы отобрать сервис у хозяина.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';

/** Ник владельца из .env, приведённый к нижнему регистру. */
const ownerName = () => String(config.ownerUsername ?? '').trim().toLowerCase();

/**
 * Владелец ли это по нику. Нужна там, где ник уже прочитан из базы и
 * второй запрос был бы лишним, — например при сборке профиля для
 * клиента. Правило владельца остаётся в одном файле: считать его
 * где-то ещё вручную нельзя, иначе два места разойдутся.
 */
export const isOwnerUsername = (username) => {
  const name = ownerName();
  return Boolean(name) && String(username ?? '').trim().toLowerCase() === name;
};

/**
 * Можно ли завести профиль с этим ником.
 *
 * Ник владельца — не обычный ник. Права владельца выводятся из него, и
 * пока он свободен, любой зарегистрировавшийся под ним получает всю
 * экосистему: не удалить, не забанить, подтверждает сам себе любые
 * критические действия. Это не рассуждение — проверка показала ровно
 * это на живом сервере.
 *
 * Поэтому занять его можно только одноразовым ключом из окружения, и
 * только пока его никто не держит. Ключ знает тот, у кого есть доступ к
 * серверу, то есть настоящий владелец.
 *
 * Сравнение ключа идёт побайтово постоянным временем: обычное равенство
 * строк подсказывает длину совпадения по времени ответа.
 */
export const mayClaimUsername = async (username, claimToken) => {
  const name = ownerName();
  const wanted = String(username ?? '').trim().toLowerCase();
  if (!name || wanted !== name) return { ok: true };

  /* Ник владельца уже за кем-то — второй раз его не занять ничем.
     Иначе утёкший ключ отбирал бы сервис у живого владельца. */
  const { rowCount } = await query(
    'SELECT 1 FROM profiles WHERE lower(username) = $1', [name]);
  if (rowCount > 0) return { ok: false, error: 'username_taken' };

  const want = String(config.ownerClaimToken ?? '');
  if (!want) return { ok: false, error: 'owner_claim_closed' };

  const given = String(claimToken ?? '');
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'owner_claim_denied' };
  }
  return { ok: true, claimedOwner: true };
};

/**
 * Владелец ли это. Сверяем по нику, а не по сохранённому id: сменить
 * ник владельца в .env — законный способ передать сервис, а вот
 * подменить строку в базе не должно быть достаточно.
 */
export const isOwner = async (userId) => {
  const name = ownerName();
  if (!name || !userId) return false;
  const { rowCount } = await query(
    'SELECT 1 FROM profiles WHERE id = $1 AND lower(username) = $2', [userId, name],
  );
  return rowCount > 0;
};

/**
 * Администратор ли. Владелец им является всегда, даже если колонка в
 * базе почему-то говорит иначе: он не должен зависеть от чужих правок.
 */
export const isAdmin = async (userId) => {
  if (!userId) return false;
  const name = ownerName();
  const { rows } = await query(
    'SELECT is_admin, lower(username) = $2 AS owner FROM profiles WHERE id = $1',
    [userId, name || ' '],
  );
  const r = rows[0];
  if (!r) return false;
  return Boolean(r.owner || r.is_admin);
};

/**
 * Куда писать журнал.
 *
 * По умолчанию — прямая вставка: этот файл должен работать и сам по
 * себе. Но записи журнала скреплены цепочкой отпечатков, а считает её
 * adminsec.mjs, и двух писателей у одной цепочки быть не может: строка,
 * вставленная мимо, рвёт её и выглядит как подделка.
 *
 * Поэтому adminsec при загрузке подменяет писателя на свой. Это шов, а
 * не хитрость: обратный импорт замкнул бы два файла друг на друга.
 */
let sink = async (entry) => {
  await query(
    `INSERT INTO admin_log (id, actor_id, target_id, type, detail)
     VALUES ($1,$2,$3,$4,$5)`,
    [`al-${crypto.randomUUID()}`, entry.actorId ?? null, entry.targetId ?? null,
      String(entry.type).slice(0, 40),
      encryptContent(String(entry.detail ?? '').slice(0, 300))],
  );
};

export const setAdminLogSink = (fn) => { sink = fn; };

/** Запись в журнал: кто, кого, что. */
export const writeAdminLog = async (actorId, targetId, type, detail, extra = {}) => {
  await sink({ actorId, targetId, type, detail, ...extra });
};

export const listAdminLog = async (actorId, limit = 100) => {
  if (!(await isAdmin(actorId))) return null;
  const { rows } = await query(
    `SELECT id, actor_id, target_id, type, detail, created_at
       FROM admin_log ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 300)],
  );
  return rows.map((r) => ({
    id: r.id, actorId: r.actor_id ?? undefined, targetId: r.target_id ?? undefined,
    type: r.type, detail: decryptContent(r.detail) ?? '',
    createdAt: r.created_at.toISOString(),
  }));
};

/* ─── Назначение администраторов ───────────────────────────────────────── */

/**
 * Выдать или снять права администратора.
 *
 * Назначать может администратор. Но у владельца права не снимаются
 * никем, и себе самому их снять тоже нельзя: иначе последний
 * администратор случайно оставил бы сервис без управления.
 */
export const setAdminRight = async (actorId, targetId, value) => {
  if (!(await isAdmin(actorId))) return { error: 'not_allowed' };
  if (!targetId) return { error: 'not_found' };
  if (actorId === targetId) return { error: 'not_allowed' };
  if (await isOwner(targetId)) return { error: 'owner_protected' };

  const { rowCount } = await query(
    'UPDATE profiles SET is_admin = $2 WHERE id = $1', [targetId, Boolean(value)],
  );
  if (!rowCount) return { error: 'not_found' };
  await writeAdminLog(actorId, targetId, value ? 'admin_grant' : 'admin_revoke',
    value ? 'Выданы права администратора' : 'Сняты права администратора');
  return { ok: true, isAdmin: Boolean(value) };
};

/* ─── Ограничения ──────────────────────────────────────────────────────── */

const FIELDS = {
  ban:  'banned_until',
  mute: 'muted_until',
  spam: 'spam_blocked_until',
};

/** Срок в минутах приводим к разумному: 0 — снять, потолок — год. */
const untilFrom = (minutes) => {
  const n = Math.trunc(Number(minutes));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, 60 * 24 * 365);
};

/**
 * Ограничить человека: бан, запрет говорить или спам-блок.
 * Владельца ограничить нельзя — по той же причине, что и разжаловать.
 */
export const restrictUser = async (actorId, targetId, kind, minutes, extra = {}) => {
  if (!(await isAdmin(actorId))) return { error: 'not_allowed' };
  const column = FIELDS[kind];
  if (!column) return { error: 'not_allowed' };
  if (!targetId || actorId === targetId) return { error: 'not_allowed' };
  if (await isOwner(targetId)) return { error: 'owner_protected' };

  const mins = untilFrom(minutes);
  const { rowCount } = await query(
    `UPDATE profiles
        SET ${column} = CASE WHEN $2::int IS NULL THEN NULL
                             ELSE now() + ($2 || ' minutes')::interval END
      WHERE id = $1`,
    [targetId, mins === null ? null : String(mins)],
  );
  if (!rowCount) return { error: 'not_found' };

  await writeAdminLog(actorId, targetId, mins === null ? `${kind}_lift` : kind,
    mins === null ? 'Ограничение снято' : `Ограничение на ${mins} мин.`, extra);
  return { ok: true, kind, minutes: mins ?? 0 };
};

/* ─── Блокировка учётной записи ─────────────────────────────────────── */

/**
 * Заблокировать Sky ID целиком.
 *
 * Не то же самое, что бан профиля, и не замена ему. Бан закрывает одну
 * витрину — второй профиль того же человека работает дальше. Блокировка
 * закрывает человека: все его профили и те, что он заведёт после, а
 * заодно и вход.
 *
 * Владельца не блокирует никто: иначе назначенный администратор отобрал
 * бы сервис у хозяина через блокировку вместо разжалования.
 *
 * Себя — тоже нельзя. Это не забота об администраторе, а забота о
 * сервисе: последний оставшийся, заблокировавший сам себя, оставил бы
 * экосистему без управления.
 *
 * Право и подтверждение личности проверяются до вызова — здесь только
 * то, что нельзя проверить снаружи: кто хозяин учётной записи.
 */
export const blockSkyId = async (actorId, targetProfileId, minutes, reason = '', extra = {}) => {
  if (!(await isAdmin(actorId))) return { error: 'not_allowed' };
  if (!targetProfileId || actorId === targetProfileId) return { error: 'not_allowed' };
  if (await isOwner(targetProfileId)) return { error: 'owner_protected' };

  const { rows } = await query(
    'SELECT sky_id FROM profiles WHERE id = $1', [String(targetProfileId)]);
  const skyId = rows[0]?.sky_id;
  if (!skyId) return { error: 'not_found' };

  /* Учётная запись, в которой есть профиль владельца, не блокируется
     тоже: иначе владельца достали бы через его же второй профиль. */
  const { rowCount: ownerInside } = await query(
    `SELECT 1 FROM profiles WHERE sky_id = $1 AND lower(username) = $2`,
    [skyId, ownerName() || ' ']);
  if (ownerInside > 0) return { error: 'owner_protected' };

  const mins = untilFrom(minutes);
  await query(
    `UPDATE sky_ids
        SET blocked_until = CASE WHEN $2::int IS NULL THEN NULL
                                 ELSE now() + ($2 || ' minutes')::interval END,
            blocked_reason = $3, blocked_by = $4,
            blocked_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END
      WHERE id = $1`,
    [skyId, mins === null ? null : String(mins), String(reason ?? '').slice(0, 300), actorId]);

  await writeAdminLog(actorId, targetProfileId,
    mins === null ? 'skyid_unblock' : 'skyid_block',
    mins === null ? 'Учётная запись разблокирована'
      : `Учётная запись заблокирована на ${mins} мин.${reason ? `: ${reason}` : ''}`,
    extra);

  return { ok: true, skyId, minutes: mins ?? 0 };
};

/**
 * Заблокирована ли учётная запись этого профиля.
 *
 * Спрашивается у базы при каждой проверке: снятая блокировка должна
 * действовать сразу, а снимают её обычно как раз тогда, когда ждать
 * нельзя.
 */
export const skyIdBlockOf = async (profileId) => {
  const { rows } = await query(
    `SELECT s.blocked_until, s.blocked_reason
       FROM profiles p JOIN sky_ids s ON s.id = p.sky_id
      WHERE p.id = $1`, [String(profileId ?? '')]);
  const until = rows[0]?.blocked_until;
  if (!until || until <= new Date()) return null;
  return { until: until.toISOString(), reason: rows[0].blocked_reason ?? '' };
};

/** Заметка модератора о человеке. Видна только администраторам. */
export const setModerationNote = async (actorId, targetId, text, extra = {}) => {
  if (!(await isAdmin(actorId))) return { error: 'not_allowed' };
  const { rowCount } = await query(
    'UPDATE profiles SET moderation_note = $2 WHERE id = $1',
    [targetId, String(text ?? '').slice(0, 1000)],
  );
  if (!rowCount) return { error: 'not_found' };
  await writeAdminLog(actorId, targetId, 'note', 'Изменена заметка модератора', extra);
  return { ok: true };
};

/* ─── Действующие ограничения ──────────────────────────────────────────── */

/**
 * Что сейчас запрещено этому человеку. Спрашивается у базы при каждой
 * проверке: снятый бан должен действовать сразу, а не с новой сессии.
 */
export const restrictionsOf = async (userId) => {
  const { rows } = await query(
    'SELECT banned_until, muted_until, spam_blocked_until FROM profiles WHERE id = $1',
    [userId],
  );
  const r = rows[0];
  const live = (v) => (v && v > new Date() ? v.toISOString() : undefined);
  return {
    bannedUntil: live(r?.banned_until),
    mutedUntil:  live(r?.muted_until),
    spamUntil:   live(r?.spam_blocked_until),
  };
};

export const isBannedNow = async (userId) =>
  Boolean((await restrictionsOf(userId)).bannedUntil);
