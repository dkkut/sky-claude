/**
 * Валютные счета SkyMoney. Основной остаётся рубль; дополнительные счета открываются по желанию (не больше MAX_ACCOUNTS).
 *  • Обмен — только рубли ↔ валюта (между валютами — через рубль). Курс задаёт администрация (wallet_fx_rates), к нему добавляется спред:
 *    покупка валюты дороже середины, продажа дешевле. Рыночных курсов Sky не берёт и не выдумывает; без курса валюта недоступна.
 *  • Рубли списываются/зачисляются через wallet.spendIn/creditIn В ТОЙ ЖЕ транзакции, что и изменение валютного счёта (под FOR UPDATE счёта);
 *    повтор по idemKey ничего не делает. Расчёт — в целых «сотых долях», без чисел с плавающей запятой в деньгах.
 *  • Если курс изменился между показом и обменом, сервер отвечает rate_changed и новой котировкой — обмен не выполняется.
 */
import { pool, query } from './db.mjs';
import { wallet } from './wallet.mjs';
import { generateId } from './security.mjs';

export const MAX_ACCOUNTS = 5;
export const CURRENCIES = {
  USD: { name: 'Доллар США', symbol: '$' }, EUR: { name: 'Евро', symbol: '€' }, GBP: { name: 'Фунт стерлингов', symbol: '£' },
  CNY: { name: 'Юань', symbol: '¥' }, KZT: { name: 'Тенге', symbol: '₸' }, TRY: { name: 'Турецкая лира', symbol: '₺' },
};
const MIN_RUB = 10;
const MAX_RUB = 1_000_000;

const rates = async () => (await query(`SELECT * FROM wallet_fx_rates`)).rows;
const priceOf = (r) => {
  const mid = Number(r.rate_rub), s = Number(r.spread_pct) / 100;
  return { mid, buy: +(mid * (1 + s)).toFixed(6), sell: +(mid * (1 - s)).toFixed(6) };
};

export const overview = async (userId) => {
  const [rs, acc] = await Promise.all([rates(), query(`SELECT currency, balance, created_at FROM wallet_fx_accounts WHERE user_id = $1 ORDER BY created_at`, [userId])]);
  const byCode = new Map(rs.map((r) => [r.currency, r]));
  return {
    max: MAX_ACCOUNTS, minRub: MIN_RUB, maxRub: MAX_RUB,
    currencies: Object.entries(CURRENCIES).map(([code, c]) => {
      const r = byCode.get(code);
      return { code, ...c, available: Boolean(r?.enabled), ...(r ? priceOf(r) : {}) };
    }),
    accounts: acc.rows.map((a) => ({ currency: a.currency, balance: Number(a.balance), openedAt: a.created_at })),
  };
};

export const openAccount = async (userId, currency) => {
  if (!CURRENCIES[currency]) return { error: 'bad_currency' };
  const r = (await query(`SELECT enabled FROM wallet_fx_rates WHERE currency = $1`, [currency])).rows[0];
  if (!r?.enabled) return { error: 'currency_unavailable' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fxopen:${userId}`]);
    const n = (await client.query(`SELECT count(*)::int AS n FROM wallet_fx_accounts WHERE user_id = $1`, [userId])).rows[0].n;
    const has = (await client.query(`SELECT 1 FROM wallet_fx_accounts WHERE user_id = $1 AND currency = $2`, [userId, currency])).rowCount;
    if (has) { await client.query('ROLLBACK'); return { ok: true, duplicate: true }; }
    if (n >= MAX_ACCOUNTS) { await client.query('ROLLBACK'); return { error: 'too_many_accounts' }; }
    await client.query(`INSERT INTO wallet_fx_accounts (user_id, currency) VALUES ($1,$2)`, [userId, currency]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};

export const closeAccount = async (userId, currency) => {
  const { rowCount, rows } = await query(`DELETE FROM wallet_fx_accounts WHERE user_id = $1 AND currency = $2 AND balance = 0 RETURNING 1`, [userId, currency]);
  if (rowCount) return { ok: true };
  const ex = (await query(`SELECT balance FROM wallet_fx_accounts WHERE user_id = $1 AND currency = $2`, [userId, currency])).rows[0];
  void rows;
  return ex ? { error: 'not_empty' } : { error: 'not_found' };
};

/** Котировка: сколько получится. buy: amount — рубли (целые) → сотые валюты; sell: amount — сотые валюты → рубли (целые, вниз). */
export const quote = (r, direction, amount) => {
  const p = priceOf(r);
  if (direction === 'buy') return { price: p.buy, receive: Math.floor((amount * 100) / p.buy) };
  return { price: p.sell, receive: Math.floor((amount / 100) * p.sell) };
};

export const convert = async (userId, { currency, direction, amount, expect, idemKey }) => {
  if (!CURRENCIES[currency]) return { error: 'bad_currency' };
  if (!['buy', 'sell'].includes(direction)) return { error: 'bad_direction' };
  if (!Number.isSafeInteger(amount) || amount <= 0) return { error: 'invalid_amount' };
  if (typeof idemKey !== 'string' || idemKey.length < 8 || idemKey.length > 80) return { error: 'idem_required' };
  if (direction === 'buy' && (amount < MIN_RUB || amount > MAX_RUB)) return { error: 'amount_out_of_range', min: MIN_RUB, max: MAX_RUB };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acc = (await client.query(`SELECT balance FROM wallet_fx_accounts WHERE user_id = $1 AND currency = $2 FOR UPDATE`, [userId, currency])).rows[0];
    if (!acc) { await client.query('ROLLBACK'); return { error: 'no_account' }; }
    // Повтор того же ключа — после замка счёта, чтобы параллельный повтор не обменял дважды.
    const dup = (await client.query(`SELECT * FROM wallet_fx_transfers WHERE user_id = $1 AND idem_key = $2`, [userId, idemKey])).rows[0];
    if (dup) { await client.query('ROLLBACK'); return { ok: true, duplicate: true, rub: Number(dup.rub), amount: Number(dup.amount) }; }
    const rate = (await client.query(`SELECT * FROM wallet_fx_rates WHERE currency = $1`, [currency])).rows[0];
    if (!rate?.enabled) { await client.query('ROLLBACK'); return { error: 'currency_unavailable' }; }
    const q = quote(rate, direction, amount);
    if (Number.isFinite(expect) && expect !== q.receive) { await client.query('ROLLBACK'); return { error: 'rate_changed', price: q.price, receive: q.receive }; }
    if (q.receive <= 0) { await client.query('ROLLBACK'); return { error: 'amount_too_small' }; }
    const id = `fx-${generateId()}`;
    let rub; let cents;
    if (direction === 'buy') {
      rub = amount; cents = q.receive;
      const sp = await wallet.spendIn(client, userId, rub, 'fx_out', `Обмен на ${currency}`, `fx:${id}`);
      if (sp.error) { await client.query('ROLLBACK'); return sp; }
      await client.query(`UPDATE wallet_fx_accounts SET balance = balance + $3, updated_at = now() WHERE user_id = $1 AND currency = $2`, [userId, currency, cents]);
    } else {
      cents = amount; rub = q.receive;
      if (Number(acc.balance) < cents) { await client.query('ROLLBACK'); return { error: 'insufficient_funds', balance: Number(acc.balance) }; }
      if (rub <= 0) { await client.query('ROLLBACK'); return { error: 'amount_too_small' }; }
      await client.query(`UPDATE wallet_fx_accounts SET balance = balance - $3, updated_at = now() WHERE user_id = $1 AND currency = $2`, [userId, currency, cents]);
      const cr = await wallet.creditIn(client, userId, rub, 'fx_in', `Обмен ${currency} на рубли`, `fx:${id}`);
      if (cr?.error) { await client.query('ROLLBACK'); return cr; }
    }
    await client.query(`INSERT INTO wallet_fx_transfers (id, user_id, currency, direction, rub, amount, rate, idem_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, userId, currency, direction, rub, cents, q.price, idemKey]);
    await client.query('COMMIT');
    return { ok: true, id, rub, amount: cents, price: q.price };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};

export const history = async (userId, limit = 50) =>
  (await query(`SELECT id, currency, direction, rub, amount, rate, created_at FROM wallet_fx_transfers WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, Math.min(200, Math.max(1, limit))]))
    .rows.map((r) => ({ id: r.id, currency: r.currency, direction: r.direction, rub: Number(r.rub), amount: Number(r.amount), rate: Number(r.rate), createdAt: r.created_at }));

/* ─── Администрация: курсы ─── */
export const adminRates = async () => {
  const rs = await rates();
  const by = new Map(rs.map((r) => [r.currency, r]));
  return Object.entries(CURRENCIES).map(([code, c]) => {
    const r = by.get(code);
    return { code, ...c, rateRub: r ? Number(r.rate_rub) : null, spreadPct: r ? Number(r.spread_pct) : 1.5, enabled: Boolean(r?.enabled), updatedAt: r?.updated_at ?? null };
  });
};

export const saveRates = async (actorId, list, { confirmBig = false } = {}) => {
  if (!Array.isArray(list) || !list.length) return { error: 'nothing_to_change' };
  const prev = new Map((await rates()).map((r) => [r.currency, Number(r.rate_rub)]));
  const rows = [];
  for (const it of list) {
    const code = String(it?.currency ?? '');
    if (!CURRENCIES[code]) return { error: 'bad_currency', currency: code };
    const rate = Number(it.rateRub); const spread = Number(it.spreadPct ?? 1.5);
    if (!(rate > 0) || rate > 1_000_000 || !Number.isFinite(rate)) return { error: 'bad_rate', currency: code };
    if (!(spread >= 0 && spread <= 20)) return { error: 'bad_spread', currency: code };
    const p = prev.get(code);
    if (p && !confirmBig && (rate / p > 1.3 || rate / p < 0.7)) return { error: 'big_change', currency: code, previous: p };
    rows.push([code, rate, spread, it.enabled !== false]);
  }
  for (const [code, rate, spread, enabled] of rows) {
    await query(`INSERT INTO wallet_fx_rates (currency, rate_rub, spread_pct, enabled, updated_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (currency) DO UPDATE SET rate_rub = $2, spread_pct = $3, enabled = $4, updated_by = $5, updated_at = now()`, [code, rate, spread, enabled, actorId]);
  }
  return { ok: true, changed: rows.map((r) => r[0]) };
};
