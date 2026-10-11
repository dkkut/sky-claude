/**
 * Денежные операции администрации: правка баланса, откат операции кошелька,
 * снятие Prime, отзыв подарка, отмена подписки.
 *
 * Сюда попадает только уже подтверждённое владельцем действие (заявка
 * `adjust_balance` / `reverse_tx` / … в adminsec.mjs: оформляет сотрудник с
 * правом finance, нужен код, подтверждает владелец). Каждая операция —
 * ОДНА транзакция с блокировкой строки счёта, повторить её второй раз нельзя:
 * откат помечается ссылкой `reverse:<id>`, возврат по подарку и Prime — статусом
 * заказа/подписки внутри той же транзакции.
 *
 * Деньги не создаются из воздуха без следа: каждое изменение — строка в
 * wallet_transactions с типом admin_adjust / admin_reversal / admin_refund и
 * ссылкой на заявку, поэтому в истории кошелька видно, откуда и по чьему решению.
 */
import { pool, query } from './db.mjs';
import { wallet } from './wallet.mjs';
import { notifyGift } from './giftnotify.mjs';

export const MAX_ADJUST = 10_000_000;

/** Операции, которые не откатываются: откат отката и собственные записи админки. */
const NOT_REVERSIBLE = new Set(['admin_reversal', 'admin_refund']);
/** Баллы и рубли лежат в разных столбцах; тип записи показывает, какой из них. */
const isPointsType = (type) => /points/.test(String(type));

const inTx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    if (out?.error) { await client.query('ROLLBACK'); return out; }
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
};

const lockAccount = async (client, userId) => {
  await client.query(
    'INSERT INTO wallet_accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  await client.query('SELECT 1 FROM wallet_accounts WHERE user_id = $1 FOR UPDATE', [userId]);
};

/** Начислить (amount > 0) или списать (amount < 0). Списать больше, чем есть, нельзя. */
export const adjustBalance = async (target, currency, amount, reason, ref) => {
  const n = Number(amount);
  if (!Number.isSafeInteger(n) || n === 0 || Math.abs(n) > MAX_ADJUST) return { error: 'bad_amount' };
  const points = currency === 'points';
  const descr = `Корректировка администрацией: ${reason}`.slice(0, 300);
  return inTx(async (c) => {
    await lockAccount(c, target);
    const r = n > 0
      ? await (points ? wallet.creditPointsIn : wallet.creditIn)(c, target, n, 'admin_adjust', descr, ref)
      : await (points ? wallet.spendPointsIn : wallet.spendIn)(c, target, -n, 'admin_adjust', descr, ref);
    if (r.error) return r;
    return { ok: true, balance: r.balance, points: r.points, outcome:
      `${n > 0 ? 'Начислено' : 'Списано'} ${Math.abs(n)} ${points ? 'баллов' : '₽'}, ` +
      `${points ? `баллов теперь ${r.points}` : `баланс ${r.balance} ₽`}` };
  });
};

/** Операция из истории кошелька, годная к откату (для проверки заявки и показа). */
export const reversibleTx = async (target, txId) => {
  const { rows } = await query(
    'SELECT id, user_id, type, amount, descr, created_at FROM wallet_transactions WHERE id = $1', [txId]);
  const tx = rows[0];
  if (!tx || tx.user_id !== target) return { error: 'not_found' };
  if (NOT_REVERSIBLE.has(tx.type)) return { error: 'not_reversible' };
  const done = await query(
    "SELECT 1 FROM wallet_transactions WHERE ref = $1 AND type = 'admin_reversal'", [`reverse:${txId}`]);
  if (done.rows[0]) return { error: 'already_reversed' };
  return { tx };
};

/** Откатить операцию: приход — снять, расход — вернуть. Второй раз откатить нельзя. */
export const reverseTransaction = async (target, txId, reason, ref) => {
  return inTx(async (c) => {
    await lockAccount(c, target);
    const { rows } = await c.query(
      'SELECT id, user_id, type, amount, descr FROM wallet_transactions WHERE id = $1', [txId]);
    const tx = rows[0];
    if (!tx || tx.user_id !== target) return { error: 'not_found' };
    if (NOT_REVERSIBLE.has(tx.type)) return { error: 'not_reversible' };
    const done = await c.query(
      "SELECT 1 FROM wallet_transactions WHERE ref = $1 AND type = 'admin_reversal'", [`reverse:${txId}`]);
    if (done.rows[0]) return { error: 'already_reversed' };

    const amount = Number(tx.amount);
    const points = isPointsType(tx.type);
    const descr = `Откат операции ${tx.id} (${tx.descr}): ${reason}`.slice(0, 300);
    const refKey = `reverse:${txId}`;
    const r = amount > 0
      ? await (points ? wallet.spendPointsIn : wallet.spendIn)(c, target, amount, 'admin_reversal', descr, refKey)
      : await (points ? wallet.creditPointsIn : wallet.creditIn)(c, target, -amount, 'admin_reversal', descr, refKey);
    if (r.error) {
      return { error: points ? 'reverse_insufficient_points' : 'reverse_insufficient_funds', balance: r.balance, points: r.points };
    }
    return { ok: true, outcome:
      `Операция ${tx.id} отменена: ${amount > 0 ? 'списано' : 'возвращено'} ${Math.abs(amount)} ${points ? 'баллов' : '₽'}` };
  });
};

/* ─── Prime ─────────────────────────────────────────────────────────── */

/**
 * Сколько вернуть за неиспользованные дни.
 *
 * Возврат считается только от того, что человек реально заплатил с кошелька
 * (запись типа `prime` — «Sky Prime · N дн.»): подарочные, семейные, выданные
 * администрацией и бессрочные подписки возврата не дают — платить за них никто
 * со своего счёта не платил.
 */
export const primeRefundPreview = async (client, profileId, sub) => {
  if (!sub || !sub.expires_at || sub.plan === 'family' || sub.plan === 'legacy') return { refund: 0, why: 'not_paid' };
  const { rows } = await client.query(
    `SELECT id, amount, descr FROM wallet_transactions
      WHERE user_id = $1 AND type = 'prime' ORDER BY created_at DESC LIMIT 1`, [profileId]);
  const last = rows[0];
  if (!last) return { refund: 0, why: 'no_purchase' };
  const days = Number(/(\d+)\s*дн/.exec(last.descr)?.[1] ?? 0);
  if (!days) return { refund: 0, why: 'no_purchase' };
  const paid = -Number(last.amount);
  const left = Math.max(0, Math.ceil((new Date(sub.expires_at).getTime() - Date.now()) / 86_400_000));
  const used = Math.min(left, days);
  return { refund: Math.floor((paid * used) / days), paid, days, left: used };
};

const endPrime = async (client, profileId) => {
  const { rows } = await client.query(
    `SELECT id, plan, expires_at FROM prime_subscriptions
      WHERE profile_id = $1 AND status = 'active' FOR UPDATE`, [profileId]);
  const sub = rows[0];
  if (!sub) return null;
  await client.query(
    "UPDATE prime_subscriptions SET status = 'cancelled', expires_at = now() WHERE id = $1", [sub.id]);
  await client.query('UPDATE profiles SET is_prime = FALSE, updated_at = now() WHERE id = $1', [profileId]);
  return sub;
};

export const primeInfo = async (profileId) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, plan, expires_at FROM prime_subscriptions
        WHERE profile_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > now())`, [profileId]);
    const sub = rows[0];
    if (!sub) return { active: false };
    const preview = await primeRefundPreview(client, profileId, sub);
    return { active: true, plan: sub.plan, expiresAt: sub.expires_at?.toISOString() ?? null, refundPreview: preview.refund };
  } finally { client.release(); }
};

/** Снять Prime досрочно; при refund=true вернуть деньги за неиспользованные дни. */
export const revokePrimeAdmin = async (target, refund, reason, ref) => {
  return inTx(async (c) => {
    await lockAccount(c, target);
    const sub = await endPrime(c, target);
    if (!sub) return { error: 'no_active_prime' };
    let back = 0;
    if (refund) {
      const p = await primeRefundPreview(c, target, sub);
      back = p.refund;
      if (back > 0) {
        const r = await wallet.creditIn(c, target, back, 'admin_refund',
          `Возврат за неиспользованные дни Prime: ${reason}`.slice(0, 300), ref);
        if (r.error) return r;
      }
    }
    return { ok: true, outcome: back > 0
      ? `Prime снят, возвращено ${back} ₽`
      : `Prime снят${refund ? ', возвращать нечего (подписка не оплачена с кошелька)' : ''}` };
  });
};

/** Отменить подписку без возврата: Prime или семейный Prime (владелец семьи). */
export const cancelSubscriptionAdmin = async (target, what, reason) => {
  if (what === 'prime') {
    const r = await revokePrimeAdmin(target, false, reason, null);
    return r.error ? r : { ok: true, outcome: 'Подписка Prime отменена без возврата' };
  }
  if (what !== 'family') return { error: 'bad_kind' };
  return inTx(async (c) => {
    const { rows: fams } = await c.query(
      "SELECT id FROM families WHERE owner_id = $1 AND status = 'active' FOR UPDATE", [target]);
    if (!fams.length) return { error: 'no_family' };
    let ended = 0;
    for (const f of fams) {
      await c.query('UPDATE families SET prime_paid_until = now(), updated_at = now() WHERE id = $1', [f.id]);
      const { rows: mem } = await c.query(
        'SELECT profile_id FROM family_members WHERE family_id = $1 AND profile_id IS NOT NULL', [f.id]);
      for (const m of mem) {
        const { rows: s } = await c.query(
          "SELECT id FROM prime_subscriptions WHERE profile_id = $1 AND status = 'active' AND plan = 'family' FOR UPDATE",
          [m.profile_id]);
        if (s[0]) {
          await c.query("UPDATE prime_subscriptions SET status = 'cancelled', expires_at = now() WHERE id = $1", [s[0].id]);
          await c.query('UPDATE profiles SET is_prime = FALSE, updated_at = now() WHERE id = $1', [m.profile_id]);
          ended += 1;
        }
      }
    }
    return { ok: true, outcome: `Семейная подписка отменена без возврата, Prime снят у ${ended} участн.` };
  });
};

/* ─── Подарки ───────────────────────────────────────────────────────── */

/** Подарок (обычный gi-… или Prime pgi-…), который можно отозвать, и его отправитель. */
export const giftForRevoke = async (instanceId) => {
  const id = String(instanceId ?? '');
  if (/^gi-[0-9a-f-]{36}$/.test(id)) {
    const { rows } = await query(
      `SELECT i.id, i.sender_id, i.recipient_id, i.status, o.price, o.currency
         FROM gift_instances i JOIN gift_orders o ON o.id = i.order_id WHERE i.id = $1`, [id]);
    return rows[0] ? { kind: 'gift', ...rows[0] } : null;
  }
  if (/^pgi-[0-9a-f-]{36}$/.test(id)) {
    const { rows } = await query(
      `SELECT i.id, i.sender_id, i.recipient_id, i.status, i.days, o.price, o.currency
         FROM prime_gift_instances i JOIN gift_orders o ON o.id = i.order_id WHERE i.id = $1`, [id]);
    return rows[0] ? { kind: 'prime', ...rows[0] } : null;
  }
  return null;
};

/** Отозвать подарок у получателя и вернуть деньги отправителю (один раз). */
export const revokeGiftAdmin = async (senderId, instanceId, reason, ref) => {
  return inTx(async (c) => {
    const isPrime = String(instanceId).startsWith('pgi-');
    const table = isPrime ? 'prime_gift_instances' : 'gift_instances';
    const { rows } = await c.query(
      `SELECT i.*, o.price, o.currency, o.status AS order_status
         FROM ${table} i JOIN gift_orders o ON o.id = i.order_id WHERE i.id = $1 FOR UPDATE OF i, o`, [instanceId]);
    const g = rows[0];
    if (!g || g.sender_id !== senderId) return { error: 'not_found' };
    if (isPrime ? g.status === 'unavailable' : g.status === 'cancelled') return { error: 'already_cancelled' };

    if (isPrime) {
      if (g.status === 'activated') {
        // Получатель уже активировал: убираем из его Prime ровно подаренные дни.
        const { rows: s } = await c.query(
          `SELECT id, expires_at FROM prime_subscriptions
            WHERE profile_id = $1 AND status = 'active' FOR UPDATE`, [g.recipient_id]);
        if (s[0]?.expires_at) {
          const left = new Date(s[0].expires_at).getTime() - g.days * 86_400_000;
          if (left <= Date.now()) {
            await c.query("UPDATE prime_subscriptions SET status = 'cancelled', expires_at = now() WHERE id = $1", [s[0].id]);
            await c.query('UPDATE profiles SET is_prime = FALSE, updated_at = now() WHERE id = $1', [g.recipient_id]);
          } else {
            await c.query('UPDATE prime_subscriptions SET expires_at = $2 WHERE id = $1', [s[0].id, new Date(left)]);
          }
        }
      }
      await c.query(
        `UPDATE prime_gift_instances SET status = 'unavailable', unavailable_reason = 'revoked_by_admin', cancelled_at = now()
          WHERE id = $1`, [instanceId]);
    } else {
      await c.query("UPDATE gift_instances SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [instanceId]);
    }

    let refunded = 0;
    if (g.order_status === 'paid') {
      await c.query("UPDATE gift_orders SET status = 'refunded' WHERE id = $1", [g.order_id]);
      const descr = `Возврат: подарок отозван администрацией (${reason})`.slice(0, 300);
      const r = g.currency === 'points'
        ? await wallet.creditPointsIn(c, senderId, g.price, 'admin_refund', descr, ref ?? g.order_id)
        : await wallet.creditIn(c, senderId, g.price, 'admin_refund', descr, ref ?? g.order_id);
      if (r.error) return r;
      refunded = g.price;
    }
    return { ok: true, recipientId: g.recipient_id, outcome:
      `Подарок отозван${refunded ? `, отправителю возвращено ${refunded} ${g.currency === 'points' ? 'баллов' : '₽'}` : ' (деньги уже были возвращены)'}` };
  }).then(async (r) => {
    if (r.ok) {
      await notifyGift(r.recipientId, 'gift_cancelled', 'Подарок отозван',
        'Администрация отозвала подарок', instanceId).catch(() => {});
      await notifyGift(senderId, 'gift_cancelled', 'Подарок отозван, деньги возвращены',
        'Администрация отозвала ваш подарок и вернула оплату', instanceId).catch(() => {});
    }
    return r;
  });
};

/** Сводка по человеку для экрана: счёт, последние операции, Prime, подарки. */
export const userMoneySummary = async (profileId) => {
  const [acc, txs, gifts, pgifts, prime, who] = await Promise.all([
    query('SELECT balance, points FROM wallet_accounts WHERE user_id = $1', [profileId]),
    query(`SELECT id, type, amount, descr, ref, created_at FROM wallet_transactions
            WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60`, [profileId]),
    query(`SELECT i.id, i.status, i.recipient_id, i.created_at, c.name, o.price, o.currency
             FROM gift_instances i JOIN gift_orders o ON o.id = i.order_id
             LEFT JOIN gift_catalog c ON c.id = i.gift_catalog_id
            WHERE i.sender_id = $1 ORDER BY i.created_at DESC LIMIT 20`, [profileId]),
    query(`SELECT i.id, i.status, i.recipient_id, i.created_at, i.days, o.price, o.currency
             FROM prime_gift_instances i JOIN gift_orders o ON o.id = i.order_id
            WHERE i.sender_id = $1 ORDER BY i.created_at DESC LIMIT 20`, [profileId]),
    primeInfo(profileId),
    query('SELECT id, name, username FROM profiles WHERE id = $1', [profileId]),
  ]);
  if (!who.rows[0]) return null;
  const done = new Set((await query(
    "SELECT ref FROM wallet_transactions WHERE user_id = $1 AND type = 'admin_reversal'", [profileId])).rows.map((r) => r.ref));
  return {
    profile: who.rows[0],
    balance: Number(acc.rows[0]?.balance ?? 0),
    points: Number(acc.rows[0]?.points ?? 0),
    transactions: txs.rows.map((r) => ({
      id: r.id, type: r.type, amount: Number(r.amount), desc: r.descr, createdAt: r.created_at.toISOString(),
      points: isPointsType(r.type),
      reversible: !NOT_REVERSIBLE.has(r.type) && !done.has(`reverse:${r.id}`),
    })),
    gifts: [
      ...gifts.rows.map((g) => ({ id: g.id, kind: 'gift', title: g.name ?? 'Подарок', status: g.status, price: g.price, currency: g.currency, recipientId: g.recipient_id, createdAt: g.created_at.toISOString(), revocable: g.status !== 'cancelled' })),
      ...pgifts.rows.map((g) => ({ id: g.id, kind: 'prime', title: `Prime · ${g.days} дн.`, status: g.status, price: g.price, currency: g.currency, recipientId: g.recipient_id, createdAt: g.created_at.toISOString(), revocable: g.status !== 'unavailable' })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    prime,
  };
};
