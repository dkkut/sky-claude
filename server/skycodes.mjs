/**
 * Sky Codes — коды пополнения и активации.
 *
 * Что это. Владелец выпускает серии кодов (админ-панель), человек вводит
 * код в Sky Codes (раздел кошелька) и получает награду: деньги на счёт
 * SkyMoney, баллы Prime, дни Sky Prime, предмет кастомизации или купон
 * на скидку при покупке Sky Prime.
 *
 * Принципы, от которых зависит безопасность:
 *
 *   · Награду определяет ТОЛЬКО серия в базе. Клиент присылает строку
 *     кода и больше ничего — ни суммы, ни срока, ни вида награды.
 *   · Сам код не хранится. В базе HMAC-отпечаток и последние четыре
 *     знака для подсказки в админке. Показать код можно один раз, в
 *     ответе на создание серии; потом его не вспомнит никто, включая
 *     владельца.
 *   · Активация — одна транзакция: строка кода берётся под замок
 *     (FOR UPDATE), проверяется, награда начисляется ТЕМ ЖЕ механизмом
 *     учёта, что и всё остальное в Sky (wallet.creditIn, grantPrimeIn),
 *     активация записывается, счётчик растёт, и всё это коммитится
 *     вместе. Либо всё, либо ничего.
 *   · Повторная активация одним человеком невозможна: UNIQUE (код,
 *     профиль). Параллельные запросы выстраиваются в очередь на замке
 *     строки кода, второй видит уже готовую активацию.
 *   · Подбор: неудачные попытки пишутся в базу и считаются по профилю и
 *     по отпечатку адреса; выше порога — блокировка на окно времени.
 *   · Создаёт серии только владелец и только после подтверждения
 *     личности (step-up): код — это деньги.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { config } from './config.mjs';
import { generateId } from './security.mjs';
import { rightsOf, can, isOwner } from './admin.mjs';
import { logAdmin, consumeStepUp, lockdownState } from './adminsec.mjs';
import { wallet } from './wallet.mjs';
import { grantPrimeIn } from './skyid.mjs';
import { decryptContent } from './crypto.mjs';

/* ─── Пределы ──────────────────────────────────────────────────────── */

export const REWARD_TYPES = ['balance', 'points', 'prime', 'item', 'discount'];

const MAX_BALANCE_PER_CODE = 100_000;          // ₽ на один код
const MAX_POINTS_PER_CODE = 1_000_000;
const MAX_PRIME_DAYS = 3650;
const MAX_COUPON_DAYS = 365;
const MAX_EXPOSURE_BALANCE = 5_000_000;        // ₽ по всей серии: коды × срабатывания × сумма
const MAX_EXPOSURE_POINTS = 50_000_000;
const MAX_COUNT = 5000;
const MAX_USES = 1_000_000;

const FAIL_WINDOW_MIN = 15;
const FAIL_LIMIT_PROFILE = 8;
const FAIL_LIMIT_IP = 30;

export const STEP_UP_PURPOSE = 'codes_create';

/* ─── Код: формат, отпечаток ───────────────────────────────────────── */

// 32 знака без путаницы 0/O и 1/I: код читают вслух и переписывают с экрана.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const GENERATED_LEN = 16;                       // 16 × 5 бит = 80 бит
const PREFIX = 'SKY';

/** Привести введённое к каноническому виду: верхний регистр, без пробелов и дефисов. */
export const normalizeCode = (raw) => {
  const s = String(raw ?? '').slice(0, 80).toUpperCase().replace(/[\s\-_]/g, '');
  return /^[A-Z0-9]{4,40}$/.test(s) ? s : null;
};

const hmacKey = () => `${config.encryptionKey || config.jwtSecret}:sky-codes:v1`;

export const codeHash = (canonical) =>
  crypto.createHmac('sha256', hmacKey()).update(canonical).digest('hex');

const generateCanonical = () => {
  let out = PREFIX;
  for (let i = 0; i < GENERATED_LEN; i += 1) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
};

/** SKYXXXXXXXXXXXXXXXX → SKY-XXXX-XXXX-XXXX-XXXX (для показа человеку). */
export const prettyCode = (canonical) => {
  if (canonical.startsWith(PREFIX) && canonical.length === PREFIX.length + GENERATED_LEN) {
    const body = canonical.slice(PREFIX.length);
    return `${PREFIX}-${body.match(/.{4}/g).join('-')}`;
  }
  return canonical;
};

/* ─── Общие помощники ──────────────────────────────────────────────── */

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const int = (v) => (typeof v === 'number' || /^\d+$/.test(String(v ?? '').trim()) ? Number(v) : NaN);

const iso = (d) => (d ? new Date(d).toISOString() : null);

const BATCH_ID_RE = /^scb-[0-9a-f-]{36}$/;
const CODE_ID_RE = /^scd-[0-9a-f-]{36}$/;
export { BATCH_ID_RE, CODE_ID_RE };

class CodeError extends Error {
  constructor(code, extra = {}) { super(code); this.skyCode = code; this.extra = extra; }
}

const inTx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Пользователь: активация ──────────────────────────────────────── */

const recordFailure = (profileId, ipHash) =>
  query('INSERT INTO sky_code_failures (profile_id, ip_hash) VALUES ($1,$2)',
    [profileId ?? null, ipHash ?? null]).catch(() => {});

/** Не заблокирован ли подбор. Возвращает секунды до разблокировки или 0. */
const lockedFor = async (profileId, ipHash) => {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM sky_code_failures
         WHERE profile_id = $1 AND at > now() - make_interval(mins => $3)) AS by_profile,
       (SELECT count(*)::int FROM sky_code_failures
         WHERE ip_hash = $2 AND at > now() - make_interval(mins => $3)) AS by_ip,
       (SELECT extract(epoch FROM (min(at) + make_interval(mins => $3) - now()))::int
          FROM sky_code_failures
         WHERE (profile_id = $1 OR ip_hash = $2) AND at > now() - make_interval(mins => $3)) AS wait`,
    [profileId, ipHash ?? '-', FAIL_WINDOW_MIN]);
  const r = rows[0];
  if (r.by_profile >= FAIL_LIMIT_PROFILE || (ipHash && r.by_ip >= FAIL_LIMIT_IP)) {
    return Math.max(Number(r.wait) || 60, 1);
  }
  return 0;
};

const rewardView = (b) => ({
  type: b.reward_type,
  amount: Number(b.reward_amount),
  days: Number(b.reward_days),
  item: b.reward_item ?? null,
  percent: Number(b.reward_percent),
});

/**
 * Применить награду внутри транзакции активации. Бросает CodeError —
 * тогда откатится всё, включая пометку «активировано».
 */
const applyReward = async (c, profileId, b, redemptionId) => {
  const ref = `code:${redemptionId}`;
  const descr = `Sky Codes · ${b.title}`.slice(0, 120);
  const out = {};
  switch (b.reward_type) {
    case 'balance': {
      const r = await wallet.creditIn(c, profileId, Number(b.reward_amount), 'code_topup', descr, ref);
      if (r.error) throw new CodeError('reward_failed');
      out.balance = r.balance;
      break;
    }
    case 'points': {
      const r = await wallet.creditPointsIn(c, profileId, Number(b.reward_amount), 'code_points', descr, ref);
      if (r.error) throw new CodeError('reward_failed');
      out.points = r.points;
      break;
    }
    case 'prime': {
      const r = await grantPrimeIn(c, profileId, 'code', Number(b.reward_days), { additive: true });
      out.primeUntil = r.expires ? iso(r.expires) : null;
      out.primeUnlimited = Boolean(r.skipped);
      break;
    }
    case 'item': {
      const { rows: item } = await c.query(
        'SELECT 1 FROM customization_catalog WHERE id = $1 AND active', [b.reward_item]);
      if (!item[0]) throw new CodeError('reward_unavailable');
      const { rows: own } = await c.query(
        'SELECT 1 FROM customization_inventory WHERE profile_id = $1 AND item_id = $2',
        [profileId, b.reward_item]);
      // Награда, которую некуда положить, не сгорает: код остаётся целым.
      if (own[0]) throw new CodeError('item_already_owned');
      await c.query(
        `INSERT INTO customization_inventory (id, profile_id, item_id, acquired_via)
         VALUES ($1,$2,$3,'code')`,
        [`cinv-${generateId()}`, profileId, b.reward_item]);
      break;
    }
    case 'discount': {
      const days = Number(b.reward_days);
      const { rows } = await c.query(
        `INSERT INTO sky_code_coupons (id, profile_id, redemption_id, percent, expires_at)
         VALUES ($1,$2,$3,$4, now() + make_interval(days => $5)) RETURNING expires_at`,
        [`scc-${generateId()}`, profileId, redemptionId, Number(b.reward_percent), days]);
      out.couponUntil = iso(rows[0].expires_at);
      break;
    }
    default:
      throw new CodeError('reward_unavailable');
  }
  return out;
};

/**
 * Активировать код.
 *
 * `profileId` берётся из сессии вызывающим кодом, а не из запроса.
 * Ответ при ошибке не различает «нет такого» и «не для вас»: чужой код,
 * привязанный к другому человеку, выглядит как несуществующий.
 */
export const redeemCode = async (profileId, rawCode, { ipHash = null } = {}) => {
  if (!profileId) return { error: 'unauthorized' };

  const wait = await lockedFor(profileId, ipHash);
  if (wait) return { error: 'too_many_attempts', retryAfter: wait };

  const canonical = normalizeCode(rawCode);
  if (!canonical) {
    await recordFailure(profileId, ipHash);
    return { error: 'invalid_code' };
  }
  const hash = codeHash(canonical);

  let outcome;
  try {
    outcome = await inTx(async (c) => {
      const { rows } = await c.query(
        `SELECT c.id AS code_id, c.status, c.uses, c.hint,
                b.id AS batch_id, b.title, b.reward_type, b.reward_amount, b.reward_days,
                b.reward_item, b.reward_percent, b.max_uses, b.expires_at, b.bound_profile_id
           FROM sky_codes c JOIN sky_code_batches b ON b.id = c.batch_id
          WHERE c.code_hash = $1
          FOR UPDATE OF c`,
        [hash]);
      const row = rows[0];
      if (!row || (row.bound_profile_id && row.bound_profile_id !== profileId)) {
        throw new CodeError('invalid_code', { fail: true });
      }
      if (row.status === 'revoked') throw new CodeError('code_revoked');
      if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) throw new CodeError('code_expired');

      const { rows: done } = await c.query(
        'SELECT 1 FROM sky_code_redemptions WHERE code_id = $1 AND profile_id = $2', [row.code_id, profileId]);
      if (done[0]) throw new CodeError('already_redeemed');
      if (row.uses >= row.max_uses) throw new CodeError('code_exhausted');

      const redemptionId = `scr-${generateId()}`;
      await c.query(
        `INSERT INTO sky_code_redemptions
           (id, code_id, batch_id, profile_id, reward_type, reward_amount, reward_days, reward_item, reward_percent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [redemptionId, row.code_id, row.batch_id, profileId, row.reward_type,
          row.reward_amount, row.reward_days, row.reward_item, row.reward_percent]);

      const extra = await applyReward(c, profileId, row, redemptionId);
      await c.query('UPDATE sky_codes SET uses = uses + 1 WHERE id = $1', [row.code_id]);
      return { redemptionId, row, extra };
    });
  } catch (err) {
    if (err instanceof CodeError) {
      if (err.extra?.fail) await recordFailure(profileId, ipHash);
      return { error: err.skyCode };
    }
    // Уникальный индекс сработал на параллельной активации того же
    // человека — это не сбой, а «уже получено».
    if (err?.code === '23505') return { error: 'already_redeemed' };
    console.error('[codes] активация не удалась:', err.message);
    return { error: 'activation_failed' };
  }

  const { row, extra, redemptionId } = outcome;
  await logAdmin({
    actorId: profileId, targetId: row.code_id, targetType: 'sky_code', type: 'code_redeem',
    detail: `«…${row.hint}» · ${row.title} · ${row.reward_type}`,
  });

  return { ok: true, redemptionId, reward: rewardView(row), title: row.title, ...extra };
};

/** История активаций человека. */
export const listMyRedemptions = async (profileId, limit = 100) => {
  const { rows } = await query(
    `SELECT r.id, r.reward_type, r.reward_amount, r.reward_days, r.reward_item, r.reward_percent,
            r.redeemed_at, b.title, c.hint
       FROM sky_code_redemptions r
       JOIN sky_code_batches b ON b.id = r.batch_id
       JOIN sky_codes c ON c.id = r.code_id
      WHERE r.profile_id = $1
      ORDER BY r.redeemed_at DESC LIMIT $2`,
    [profileId, Math.min(Math.max(Number(limit) || 100, 1), 300)]);
  return rows.map((r) => ({
    id: r.id, title: r.title, hint: r.hint, redeemedAt: iso(r.redeemed_at),
    reward: {
      type: r.reward_type, amount: Number(r.reward_amount), days: Number(r.reward_days),
      item: r.reward_item ?? null, percent: Number(r.reward_percent),
    },
    result: 'ok',
  }));
};

/* ─── Купоны на скидку ─────────────────────────────────────────────── */

export const listMyCoupons = async (profileId) => {
  const { rows } = await query(
    `SELECT id, percent, applies_to, expires_at, created_at
       FROM sky_code_coupons
      WHERE profile_id = $1 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY percent DESC, expires_at ASC`,
    [profileId]);
  return rows.map((r) => ({
    id: r.id, percent: r.percent, appliesTo: r.applies_to,
    expiresAt: iso(r.expires_at), createdAt: iso(r.created_at),
  }));
};

/** Цена со скидкой, не меньше рубля. */
export const discountedPrice = (price, percent) =>
  Math.max(1, Math.ceil((Number(price) * (100 - Number(percent))) / 100));

/**
 * Занять лучший действующий купон на Prime. Атомарно: UPDATE ...
 * WHERE consumed_at IS NULL вернёт строку только одному из двух
 * одновременных покупателей. Вызывающий обязан либо завершить покупку,
 * либо вернуть купон через releaseCoupon.
 */
export const claimPrimeCoupon = async (profileId, ref) => {
  const { rows } = await query(
    `UPDATE sky_code_coupons SET consumed_at = now(), consumed_ref = $2
      WHERE id = (
        SELECT id FROM sky_code_coupons
         WHERE profile_id = $1 AND applies_to = 'prime'
           AND consumed_at IS NULL AND expires_at > now()
         ORDER BY percent DESC, expires_at ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED)
        AND consumed_at IS NULL
      RETURNING id, percent`,
    [profileId, ref]);
  return rows[0] ? { id: rows[0].id, percent: rows[0].percent } : null;
};

/** Вернуть купон, если покупка не состоялась. */
export const releaseCoupon = async (couponId) => {
  await query(
    'UPDATE sky_code_coupons SET consumed_at = NULL, consumed_ref = NULL WHERE id = $1', [couponId])
    .catch((err) => console.error('[codes] купон не вернулся:', err.message));
};

/* ─── Администрирование ────────────────────────────────────────────── */

/** Видеть серии, историю и журнал: право 'codes'. */
const mayView = (actorId) => can(actorId, 'codes');

/** Создавать: только владелец (с рабочим вторым фактором). */
export const mayCreate = async (actorId) => {
  const r = await rightsOf(actorId);
  return r.owner === true && r.permissions.includes('codes');
};

const resolveProfile = async (ref) => {
  const s = clean(ref, 80).replace(/^@/, '');
  if (!s) return null;
  const { rows } = await query(
    'SELECT id, username, name FROM profiles WHERE id = $1 OR lower(username) = lower($1) LIMIT 1', [s]);
  return rows[0] ?? null;
};

const batchView = (r) => ({
  id: r.id, title: r.title, note: r.note,
  reward: {
    type: r.reward_type, amount: Number(r.reward_amount), days: Number(r.reward_days),
    item: r.reward_item ?? null, percent: Number(r.reward_percent),
  },
  maxUses: r.max_uses, expiresAt: iso(r.expires_at), count: r.code_count,
  boundProfileId: r.bound_profile_id ?? null,
  boundUsername: r.bound_username ?? null,
  createdBy: r.created_by ?? null, createdByName: r.creator_name ?? null,
  createdAt: iso(r.created_at),
  stats: r.total === undefined ? undefined : {
    total: Number(r.total), active: Number(r.active), revoked: Number(r.revoked),
    uses: Number(r.uses), exhausted: Number(r.exhausted),
  },
});

const validateBatchInput = async (input) => {
  const title = clean(input.title, 80);
  if (title.length < 2) return { error: 'bad_title' };
  const note = clean(input.note, 300);

  const type = String(input.rewardType ?? '');
  if (!REWARD_TYPES.includes(type)) return { error: 'bad_reward' };

  const count = int(input.count ?? 1);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_COUNT) return { error: 'bad_count' };
  const maxUses = int(input.maxUses ?? 1);
  if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > MAX_USES) return { error: 'bad_max_uses' };

  const reward = { amount: 0, days: 0, item: null, percent: 0 };
  if (type === 'balance' || type === 'points') {
    const a = int(input.amount);
    const cap = type === 'balance' ? MAX_BALANCE_PER_CODE : MAX_POINTS_PER_CODE;
    if (!Number.isSafeInteger(a) || a < 1 || a > cap) return { error: 'bad_amount' };
    reward.amount = a;
    const exposure = a * count * maxUses;
    if (exposure > (type === 'balance' ? MAX_EXPOSURE_BALANCE : MAX_EXPOSURE_POINTS)) {
      return { error: 'exposure_too_high' };
    }
  } else if (type === 'prime') {
    const d = int(input.days);
    if (!Number.isSafeInteger(d) || d < 1 || d > MAX_PRIME_DAYS) return { error: 'bad_days' };
    reward.days = d;
  } else if (type === 'item') {
    const id = clean(input.item, 60);
    const { rows } = await query('SELECT 1 FROM customization_catalog WHERE id = $1 AND active', [id]);
    if (!rows[0]) return { error: 'bad_item' };
    reward.item = id;
    // Предмет у человека один, а повторный код ему не нужен — серия
    // многоразовых кодов на один предмет бессмысленна, но не вредна.
  } else if (type === 'discount') {
    const p = int(input.percent);
    if (!Number.isSafeInteger(p) || p < 1 || p > 90) return { error: 'bad_percent' };
    const d = int(input.days ?? 30);
    if (!Number.isSafeInteger(d) || d < 1 || d > MAX_COUPON_DAYS) return { error: 'bad_days' };
    reward.percent = p; reward.days = d;
  }

  let expiresAt = null;
  if (input.expiresAt) {
    const d = new Date(input.expiresAt);
    if (Number.isNaN(d.getTime()) || typeof input.expiresAt === 'object') return { error: 'bad_expiry' };
    if (d.getTime() <= Date.now() + 60_000) return { error: 'bad_expiry' };
    if (d.getTime() > Date.now() + 5 * 365 * 86400_000) return { error: 'bad_expiry' };
    expiresAt = d;
  }

  let bound = null;
  if (input.boundTo) {
    bound = await resolveProfile(input.boundTo);
    if (!bound) return { error: 'bound_not_found' };
    if (count !== 1) return { error: 'bound_needs_single' };
  }

  let custom = null;
  if (input.customCode) {
    if (count !== 1) return { error: 'custom_needs_single' };
    custom = String(input.customCode).toUpperCase().replace(/[\s\-_]/g, '');
    if (!/^[A-Z0-9]{6,32}$/.test(custom)) return { error: 'bad_custom_code' };
  }

  return { title, note, type, reward, count, maxUses, expiresAt, bound, custom };
};

/**
 * Создать серию. Только владелец, только после подтверждения личности.
 * Возвращает коды открытым текстом ОДИН раз — потом их не получить.
 */
export const createBatch = async (actorId, input, { meta = {} } = {}) => {
  if (!(await mayCreate(actorId))) {
    await logAdmin({ actorId, type: 'code_batch_create', result: 'denied', targetType: 'sky_code', detail: 'Не владелец', meta });
    return { error: 'not_allowed' };
  }
  const lock = await lockdownState();
  if (lock.active && !(await isOwner(actorId))) return { error: 'lockdown' };

  const v = await validateBatchInput(input ?? {});
  if (v.error) return v;

  const step = await consumeStepUp(actorId, STEP_UP_PURPOSE, input?.stepUpCode, { meta });
  if (step.error) return step;

  const batchId = `scb-${generateId()}`;
  const plain = [];
  try {
    await inTx(async (c) => {
      await c.query(
        `INSERT INTO sky_code_batches
           (id, title, note, reward_type, reward_amount, reward_days, reward_item, reward_percent,
            max_uses, expires_at, bound_profile_id, code_count, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [batchId, v.title, v.note, v.type, v.reward.amount, v.reward.days, v.reward.item,
          v.reward.percent, v.maxUses, v.expiresAt, v.bound?.id ?? null, v.count, actorId]);

      let made = 0;
      let guard = 0;
      while (made < v.count) {
        if ((guard += 1) > v.count * 5 + 20) throw new CodeError('generation_failed');
        const canonical = v.custom ?? generateCanonical();
        const { rowCount } = await c.query(
          `INSERT INTO sky_codes (id, batch_id, code_hash, hint)
           VALUES ($1,$2,$3,$4) ON CONFLICT (code_hash) DO NOTHING`,
          [`scd-${generateId()}`, batchId, codeHash(canonical), canonical.slice(-4)]);
        if (rowCount) { plain.push(prettyCode(canonical)); made += 1; }
        else if (v.custom) throw new CodeError('custom_code_taken');
      }
    });
  } catch (err) {
    if (err instanceof CodeError) return { error: err.skyCode };
    console.error('[codes] серия не создана:', err.message);
    return { error: 'create_failed' };
  }

  await logAdmin({
    actorId, targetId: batchId, targetType: 'sky_code', type: 'code_batch_create',
    detail: `«${v.title}» · ${v.type} · кодов ${v.count} × ${v.maxUses}`, meta,
  });

  return {
    ok: true,
    batch: { id: batchId, title: v.title, count: v.count, maxUses: v.maxUses },
    codes: plain,            // единственный раз, когда коды видны
  };
};

export const listBatches = async (actorId, { limit } = {}) => {
  if (!(await mayView(actorId))) return null;
  const { rows } = await query(
    `SELECT b.*, p.username AS bound_username, cr.name AS creator_name,
            count(c.id) AS total,
            count(c.id) FILTER (WHERE c.status = 'active') AS active,
            count(c.id) FILTER (WHERE c.status = 'revoked') AS revoked,
            coalesce(sum(c.uses), 0) AS uses,
            count(c.id) FILTER (WHERE c.uses >= b.max_uses) AS exhausted
       FROM sky_code_batches b
       LEFT JOIN sky_codes c ON c.batch_id = b.id
       LEFT JOIN profiles p ON p.id = b.bound_profile_id
       LEFT JOIN profiles cr ON cr.id = b.created_by
      GROUP BY b.id, p.username, cr.name
      ORDER BY b.created_at DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 300)]);
  return rows.map(batchView);
};

export const listCodes = async (actorId, batchId, { status, limit, offset } = {}) => {
  if (!(await mayView(actorId))) return null;
  if (!BATCH_ID_RE.test(String(batchId ?? ''))) return { error: 'not_found' };
  const args = [batchId];
  let where = 'c.batch_id = $1';
  if (status === 'active' || status === 'revoked') { args.push(status); where += ` AND c.status = $${args.length}`; }
  if (status === 'used') where += ' AND c.uses > 0';
  if (status === 'unused') where += " AND c.uses = 0 AND c.status = 'active'";
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  args.push(lim, off);
  const { rows } = await query(
    `SELECT c.id, c.hint, c.label, c.status, c.uses, c.revoked_at, c.revoke_reason, c.created_at,
            b.max_uses,
            (SELECT max(redeemed_at) FROM sky_code_redemptions r WHERE r.code_id = c.id) AS last_used
       FROM sky_codes c JOIN sky_code_batches b ON b.id = c.batch_id
      WHERE ${where}
      ORDER BY c.created_at, c.id LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
  return {
    items: rows.map((r) => ({
      id: r.id, hint: r.hint, label: r.label, status: r.status, uses: r.uses, maxUses: r.max_uses,
      lastUsedAt: iso(r.last_used), revokedAt: iso(r.revoked_at), revokeReason: r.revoke_reason,
      createdAt: iso(r.created_at),
    })),
  };
};

export const listRedemptions = async (actorId, { batchId, q, limit } = {}) => {
  if (!(await mayView(actorId))) return null;
  const args = [];
  const where = [];
  if (batchId) {
    if (!BATCH_ID_RE.test(String(batchId))) return { error: 'not_found' };
    args.push(batchId); where.push(`r.batch_id = $${args.length}`);
  }
  const needle = clean(q, 60).toLowerCase();
  if (needle) {
    args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
    where.push(`(lower(p.username) LIKE $${args.length} ESCAPE '\\' OR lower(p.name) LIKE $${args.length} ESCAPE '\\' OR lower(b.title) LIKE $${args.length} ESCAPE '\\')`);
  }
  args.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  const { rows } = await query(
    `SELECT r.id, r.profile_id, r.reward_type, r.reward_amount, r.reward_days, r.reward_item,
            r.reward_percent, r.redeemed_at, p.username, p.name, b.title, c.hint
       FROM sky_code_redemptions r
       JOIN profiles p ON p.id = r.profile_id
       JOIN sky_code_batches b ON b.id = r.batch_id
       JOIN sky_codes c ON c.id = r.code_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY r.redeemed_at DESC LIMIT $${args.length}`, args);
  return {
    items: rows.map((r) => ({
      id: r.id, profileId: r.profile_id, username: r.username, name: r.name,
      title: r.title, hint: r.hint, redeemedAt: iso(r.redeemed_at),
      reward: {
        type: r.reward_type, amount: Number(r.reward_amount), days: Number(r.reward_days),
        item: r.reward_item ?? null, percent: Number(r.reward_percent),
      },
    })),
  };
};

/** Отозвать один код (любой действующий). Уже начисленное не отменяется. */
export const revokeCode = async (actorId, codeId, reason, { meta = {} } = {}) => {
  if (!(await mayView(actorId))) return { error: 'not_allowed' };
  if (!CODE_ID_RE.test(String(codeId ?? ''))) return { error: 'not_found' };
  const why = clean(reason, 200);
  if (why.length < 3) return { error: 'reason_required' };
  const { rows } = await query(
    `UPDATE sky_codes SET status = 'revoked', revoked_at = now(), revoked_by = $2, revoke_reason = $3
      WHERE id = $1 AND status = 'active' RETURNING id, hint, batch_id`,
    [codeId, actorId, why]);
  if (!rows[0]) {
    const { rows: ex } = await query('SELECT status FROM sky_codes WHERE id = $1', [codeId]);
    return { error: ex[0] ? 'already_revoked' : 'not_found' };
  }
  await logAdmin({
    actorId, targetId: codeId, targetType: 'sky_code', type: 'code_revoke',
    detail: `«…${rows[0].hint}» · ${why}`, meta,
  });
  return { ok: true };
};

/** Отозвать все НЕИСПОЛЬЗОВАННЫЕ коды серии. */
export const revokeBatchUnused = async (actorId, batchId, reason, { meta = {} } = {}) => {
  if (!(await mayView(actorId))) return { error: 'not_allowed' };
  if (!BATCH_ID_RE.test(String(batchId ?? ''))) return { error: 'not_found' };
  const why = clean(reason, 200);
  if (why.length < 3) return { error: 'reason_required' };
  const { rowCount } = await query(
    `UPDATE sky_codes SET status = 'revoked', revoked_at = now(), revoked_by = $2, revoke_reason = $3
      WHERE batch_id = $1 AND status = 'active' AND uses = 0`,
    [batchId, actorId, why]);
  await logAdmin({
    actorId, targetId: batchId, targetType: 'sky_code', type: 'code_batch_revoke',
    detail: `отозвано неиспользованных: ${rowCount} · ${why}`, meta,
  });
  return { ok: true, revoked: rowCount };
};

const csvCell = (v) => {
  let s = String(v ?? '');
  // Защита от формул в Excel/Sheets: ячейка, начинающаяся с = + - @, исполняется.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Выгрузка серии в CSV. Секретных значений кодов здесь нет — они не
 * хранятся. Есть последние четыре знака, статус и использование: этого
 * хватает, чтобы сверить, что с серией происходит.
 */
export const exportBatchCsv = async (actorId, batchId, { meta = {} } = {}) => {
  if (!(await mayView(actorId))) return { error: 'not_allowed' };
  if (!BATCH_ID_RE.test(String(batchId ?? ''))) return { error: 'not_found' };
  const { rows: bs } = await query('SELECT * FROM sky_code_batches WHERE id = $1', [batchId]);
  const b = bs[0];
  if (!b) return { error: 'not_found' };
  const { rows } = await query(
    `SELECT c.hint, c.status, c.uses, c.revoked_at,
            (SELECT max(redeemed_at) FROM sky_code_redemptions r WHERE r.code_id = c.id) AS last_used
       FROM sky_codes c WHERE c.batch_id = $1 ORDER BY c.created_at, c.id`, [batchId]);
  const head = ['series', 'code_tail', 'status', 'uses', 'max_uses', 'reward_type', 'reward_amount',
    'reward_days', 'reward_percent', 'expires_at', 'last_used_at', 'revoked_at'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      b.title, `…${r.hint}`, r.status, r.uses, b.max_uses, b.reward_type, b.reward_amount,
      b.reward_days, b.reward_percent, iso(b.expires_at) ?? '', iso(r.last_used) ?? '', iso(r.revoked_at) ?? '',
    ].map(csvCell).join(','));
  }
  await logAdmin({
    actorId, targetId: batchId, targetType: 'sky_code', type: 'code_export',
    detail: `«${b.title}» · строк ${rows.length}`, meta,
  });
  return { ok: true, filename: `sky-codes-${batchId.slice(4, 12)}.csv`, csv: `﻿${lines.join('\r\n')}\r\n` };
};

/** Журнал действий по кодам (создание, отзыв, выгрузка, активации). */
export const codesLog = async (actorId, { limit } = {}) => {
  if (!(await mayView(actorId))) return null;
  const { rows } = await query(
    `SELECT a.id, a.type, a.result, a.detail, a.created_at, a.actor_id, p.username, p.name
       FROM admin_log a LEFT JOIN profiles p ON p.id = a.actor_id
      WHERE a.type LIKE 'code\\_%' ESCAPE '\\'
      ORDER BY a.created_at DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 300)]);
  return rows.map((r) => ({
    id: r.id, type: r.type, result: r.result, detail: decryptContent(r.detail) ?? '',
    actorId: r.actor_id ?? null, actorName: r.name ?? null, actorUsername: r.username ?? null,
    createdAt: iso(r.created_at),
  }));
};

/** Предметы кастомизации, которые можно выдать кодом. */
export const listItemChoices = async (actorId) => {
  if (!(await mayView(actorId))) return null;
  const { rows } = await query(
    'SELECT id, category FROM customization_catalog WHERE active ORDER BY category, id');
  return rows.map((r) => ({ id: r.id, category: r.category }));
};

/** Дать отдельному коду имя (или убрать, если пусто). */
export const renameCode = async (actorId, codeId, label, { meta = {} } = {}) => {
  if (!(await mayView(actorId))) return { error: 'not_allowed' };
  if (!CODE_ID_RE.test(String(codeId ?? ''))) return { error: 'not_found' };
  if (typeof label !== 'string') return { error: 'bad_label' };
  const name = clean(label, 60);
  const { rows } = await query(
    'UPDATE sky_codes SET label = $2 WHERE id = $1 RETURNING hint', [codeId, name]);
  if (!rows[0]) return { error: 'not_found' };
  await logAdmin({
    actorId, targetId: codeId, targetType: 'sky_code', type: 'code_rename',
    detail: `«…${rows[0].hint}» → «${name || '—'}»`, meta,
  });
  return { ok: true, label: name };
};

/**
 * Отозвать выбранные коды: списком id или по самому коду (тот, что человек
 * прислал, — находим по хешу). Уже начисленное не отменяется.
 */
export const revokeSelected = async (actorId, { ids, code, reason } = {}, { meta = {} } = {}) => {
  if (!(await mayView(actorId))) return { error: 'not_allowed' };
  const why = clean(reason, 200);
  if (why.length < 3) return { error: 'reason_required' };

  let list = [];
  if (code !== undefined && code !== null && code !== '') {
    const canonical = normalizeCode(code);
    if (!canonical) return { error: 'not_found' };
    const { rows } = await query('SELECT id FROM sky_codes WHERE code_hash = $1', [codeHash(canonical)]);
    if (!rows[0]) return { error: 'not_found' };
    list = [rows[0].id];
  } else {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500) return { error: 'bad_selection' };
    list = [...new Set(ids.map(String))];
    if (!list.every((x) => CODE_ID_RE.test(x))) return { error: 'bad_selection' };
  }

  const { rows } = await query(
    `UPDATE sky_codes SET status = 'revoked', revoked_at = now(), revoked_by = $2, revoke_reason = $3
      WHERE id = ANY($1::text[]) AND status = 'active' RETURNING id, hint`,
    [list, actorId, why]);
  await logAdmin({
    actorId, targetId: list[0], targetType: 'sky_code', type: 'code_revoke',
    detail: `выбранные коды: отозвано ${rows.length} из ${list.length}${rows.length === 1 ? ` («…${rows[0].hint}»)` : ''} · ${why}`, meta,
  });
  if (!rows.length) return { error: 'already_revoked' };
  return { ok: true, revoked: rows.length, skipped: list.length - rows.length };
};
