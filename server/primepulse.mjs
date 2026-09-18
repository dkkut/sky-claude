/**
 * Prime Pulse: данные и права.
 *
 * До этого файла предложения были десятком строк, зашитых прямо в
 * src/prime/PrimePulse.tsx: одна и та же кнопка «Активировать» не
 * делала ничего, а «промокод» был одинаковой строкой для всех — то
 * есть не промокодом, а картинкой промокода.
 *
 * Устройство здесь простое, в два слоя:
 *   — предложения заводит и снимает администратор с правом content —
 *     та же роль, что уже отвечает за музыку, кино, ТВ и подкасты;
 *   — погашение выдаёт код, у которого есть ровно два свойства
 *     настоящего кода: он не существует до момента выдачи и он свой
 *     у каждого человека на каждое предложение (или несколько — см.
 *     maxPerUser). Что делает с этим кодом человек дальше — решение
 *     не этого файла: активацию у внешнего партнёра сервер не
 *     проверяет, потому что партнёров с API у Sky нет; предложения на
 *     этом экране — про собственные продукты Sky, и код здесь — это
 *     подтверждение права на плюшку, а не билет во внешнюю систему.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { can } from './admin.mjs';
import { hasPrime } from './skyid.mjs';

const newId = () => `ppo-${crypto.randomUUID()}`;
const newRedemptionId = () => `ppr-${crypto.randomUUID()}`;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `PULSE-${out.slice(0, 4)}-${out.slice(4)}`;
};

const CATEGORIES = ['game', 'service', 'promo', 'fun'];
const MAX_TITLE = 120;
const MAX_DESC = 600;
const MAX_BRAND = 60;
const MAX_VALUE = 40;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Обрезка и очистка от управляющих символов — в заголовках им не место. */
const text = (v, max) => Array.from(String(v ?? ''))
  .filter((ch) => ch.charCodeAt(0) > 31)
  .join('')
  .trim()
  .slice(0, max);

const num = (v, min, max, fallback) => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/* ─── Представление наружу ──────────────────────────────────────────── */

const toOffer = (row) => ({
  id: row.id,
  category: row.category,
  title: row.title,
  description: row.description,
  brand: row.brand,
  valueLabel: row.value_label,
  color: [row.color1, row.color2],
  startsAt: row.starts_at?.toISOString?.() ?? null,
  expiresAt: row.expires_at?.toISOString?.() ?? null,
  active: row.active,
  maxPerUser: Number(row.max_per_user),
  createdAt: row.created_at?.toISOString?.() ?? undefined,
  redeemedCount: row.redeemed_count == null ? undefined : Number(row.redeemed_count),
});

/* ─── Список предложений ────────────────────────────────────────────── */

/**
 * Лента для подписчика: только активные, в своём временном окне.
 * Вместе с числом уже погашенных этим человеком — иначе интерфейс не
 * смог бы честно показать «ещё доступно» до самого клика.
 */
export const listOffersForUser = async (viewerId) => {
  const { rows } = await query(
    `SELECT o.*,
            COALESCE((SELECT count(*) FROM prime_pulse_redemptions r
                       WHERE r.offer_id = o.id AND r.user_id = $1), 0) AS my_redemptions
       FROM prime_pulse_offers o
      WHERE o.active
        AND (o.starts_at IS NULL OR o.starts_at <= now())
        AND (o.expires_at IS NULL OR o.expires_at > now())
      ORDER BY o.created_at DESC`,
    [viewerId ?? ''],
  );
  return rows.map((row) => ({ ...toOffer(row), myRedemptions: Number(row.my_redemptions) }));
};

/** Очередь администратора: все предложения, включая снятые и будущие. */
export const listOffersForAdmin = async (adminId) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query(
    `SELECT o.*,
            (SELECT count(*) FROM prime_pulse_redemptions r WHERE r.offer_id = o.id) AS redeemed_count
       FROM prime_pulse_offers o
      ORDER BY o.created_at DESC`,
  );
  return rows.map(toOffer);
};

/* ─── Управление предложениями (право content) ──────────────────────── */

const checkOfferInput = (raw) => {
  const category = String(raw.category ?? '');
  if (!CATEGORIES.includes(category)) return { error: 'bad_category' };
  const title = text(raw.title, MAX_TITLE);
  if (!title) return { error: 'bad_title' };
  const valueLabel = text(raw.valueLabel, MAX_VALUE);
  if (!valueLabel) return { error: 'bad_value' };
  const color1 = String(raw.color1 ?? '#f59e0b');
  const color2 = String(raw.color2 ?? '#d97706');
  if (!HEX_COLOR.test(color1) || !HEX_COLOR.test(color2)) return { error: 'bad_color' };

  const startsAt = raw.startsAt ? new Date(raw.startsAt) : null;
  const expiresAt = raw.expiresAt ? new Date(raw.expiresAt) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) return { error: 'bad_starts_at' };
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return { error: 'bad_expires_at' };
  if (startsAt && expiresAt && startsAt >= expiresAt) return { error: 'bad_window' };

  return {
    ok: true,
    value: {
      category, title,
      description: text(raw.description, MAX_DESC),
      brand: text(raw.brand, MAX_BRAND) || 'Sky',
      valueLabel, color1, color2,
      startsAt, expiresAt,
      maxPerUser: num(raw.maxPerUser, 1, 100, 1),
    },
  };
};

export const createOffer = async (adminId, raw = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const checked = checkOfferInput(raw);
  if (checked.error) return checked;
  const v = checked.value;
  const id = newId();
  await query(
    `INSERT INTO prime_pulse_offers
       (id, category, title, description, brand, value_label, color1, color2,
        starts_at, expires_at, max_per_user, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, v.category, v.title, v.description, v.brand, v.valueLabel, v.color1, v.color2,
      v.startsAt, v.expiresAt, v.maxPerUser, adminId],
  );
  return { id };
};

export const updateOffer = async (adminId, offerId, raw = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT id FROM prime_pulse_offers WHERE id = $1', [String(offerId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };

  const checked = checkOfferInput(raw);
  if (checked.error) return checked;
  const v = checked.value;
  await query(
    `UPDATE prime_pulse_offers SET
       category = $2, title = $3, description = $4, brand = $5, value_label = $6,
       color1 = $7, color2 = $8, starts_at = $9, expires_at = $10, max_per_user = $11,
       updated_at = now()
     WHERE id = $1`,
    [offerId, v.category, v.title, v.description, v.brand, v.valueLabel, v.color1, v.color2,
      v.startsAt, v.expiresAt, v.maxPerUser],
  );
  return { ok: true };
};

/** Снять/вернуть предложение — быстрее и обратимее, чем удалять. */
export const setOfferActive = async (adminId, offerId, active) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rowCount } = await query(
    'UPDATE prime_pulse_offers SET active = $2, updated_at = now() WHERE id = $1',
    [String(offerId ?? ''), Boolean(active)],
  );
  if (!rowCount) return { error: 'not_found' };
  return { ok: true };
};

/** Удаление — только когда погашений ещё не было: иначе стёрлась бы история выдач. */
export const deleteOffer = async (adminId, offerId) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query(
    'SELECT (SELECT count(*) FROM prime_pulse_redemptions WHERE offer_id = $1) AS n FROM prime_pulse_offers WHERE id = $1',
    [String(offerId ?? '')],
  );
  if (!rows[0]) return { error: 'not_found' };
  if (Number(rows[0].n) > 0) return { error: 'has_redemptions' };
  await query('DELETE FROM prime_pulse_offers WHERE id = $1', [offerId]);
  return { ok: true };
};

/* ─── Погашение ──────────────────────────────────────────────────────── */

/**
 * Погашение предложения. Prime проверяется здесь, а не только на
 * экране: список можно было и подсмотреть, а вот код выдаётся только
 * тому, у кого подписка действует прямо сейчас.
 *
 * Предел на человека проверяется под замком на пару (предложение,
 * человек): без него два одновременных клика читали бы один и тот же
 * счёт «уже погашено 0 раз» и оба бы прошли мимо предела в 1 — ровно
 * то, что случилось бы при обычном чтении-потом-записи без блокировки.
 */
export const redeemOffer = async (userId, offerId) => {
  if (!(await hasPrime(userId))) return { error: 'prime_required' };
  const oid = String(offerId ?? '');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pulse:${oid}:${userId}`]);

    const { rows } = await client.query(
      `SELECT * FROM prime_pulse_offers WHERE id = $1
          AND active AND (starts_at IS NULL OR starts_at <= now())
          AND (expires_at IS NULL OR expires_at > now())`,
      [oid],
    );
    const offer = rows[0];
    if (!offer) { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    const { rows: mine } = await client.query(
      'SELECT count(*)::int AS n FROM prime_pulse_redemptions WHERE offer_id = $1 AND user_id = $2',
      [oid, userId],
    );
    if ((mine[0]?.n ?? 0) >= Number(offer.max_per_user)) {
      await client.query('ROLLBACK');
      return { error: 'already_redeemed' };
    }

    const id = newRedemptionId();
    const code = newCode();
    await client.query(
      'INSERT INTO prime_pulse_redemptions (id, offer_id, user_id, code) VALUES ($1,$2,$3,$4)',
      [id, oid, userId, code],
    );
    await client.query('COMMIT');
    return { id, code, offer: toOffer(offer) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** Свои погашения — для истории «мои коды». Чужие не отдаются никому, кроме content. */
export const listMyRedemptions = async (userId) => {
  const { rows } = await query(
    `SELECT r.id, r.code, r.redeemed_at, o.id AS offer_id, o.title, o.brand, o.value_label
       FROM prime_pulse_redemptions r JOIN prime_pulse_offers o ON o.id = r.offer_id
      WHERE r.user_id = $1
      ORDER BY r.redeemed_at DESC LIMIT 200`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    redeemedAt: r.redeemed_at.toISOString(),
    offerId: r.offer_id,
    title: r.title,
    brand: r.brand,
    valueLabel: r.value_label,
  }));
};
