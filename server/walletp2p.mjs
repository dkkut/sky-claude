/**
 * Перевод другому человеку по Sky ID (@нику) — рубли и валютные счета, раздельно (валюты не смешиваются, обмен — отдельная операция walletfx).
 * Порядок: lookup (сервер проверяет получателя и отдаёт ПОДТВЕРЖДЁННЫЕ сведения) → quote (сумма, комиссия, итог, подписанный токен) → transfer.
 * Защита:
 *  • получатель в переводе — тот, что в подписанной котировке; сервер повторно проверяет получателя, сумму, комиссию и лимиты ПОСЛЕ блокировок счетов;
 *  • идемпотентность по (отправитель, idemKey); списание, комиссия и зачисление — одна транзакция (wallet.spendIn/creditIn, FOR UPDATE);
 *    счета блокируются в порядке id — встречные переводы не создают взаимной блокировки;
 *  • баланс проверяет только сервер; клиент ничего не «подтверждает» кроме собственного намерения;
 *  • лимиты: сумма, сутки, новый аккаунт, частота; подозрительное (много получателей, возвратный перевод, первый крупный перевод) помечается для финансистов.
 * Комиссия задаётся владельцем (по умолчанию 0) и видна до подтверждения; она учитывается в учёте (wallet_p2p.fee), деньги комиссии никому не зачисляются.
 * Курс валюты на момент операции — в записи (rate_rub); рублёвый эквивалент нужен только для лимитов.
 */
import { pool, query } from './db.mjs';
import { wallet } from './wallet.mjs';
import { macOf } from './crypto.mjs';
import { generateId } from './security.mjs';
import { frozenProfile } from './freezecheck.mjs';
import { marksFor } from './skymarks.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { CURRENCIES } from './walletfx.mjs';

export const QUOTE_TTL_MS = 5 * 60_000;
const MAX_UNITS = 2_000_000_000;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

let sCache = { at: 0, v: null };
export const settings = async (fresh = false) => {
  if (!fresh && sCache.v && Date.now() - sCache.at < 5000) return sCache.v;
  const r = (await query('SELECT * FROM wallet_p2p_settings WHERE id')).rows[0];
  const v = { enabled: r.enabled, feePercent: Number(r.fee_percent), feeMin: r.fee_min, feeMax: r.fee_max, minAmount: r.min_amount, maxAmount: r.max_amount, dailyLimit: r.daily_limit, newDays: r.new_days, newDailyLimit: r.new_daily_limit, velocityMax: r.velocity_max, recipientsFlag: r.recipients_flag };
  sCache = { at: Date.now(), v }; return v;
};

export const saveSettings = async (actorId, b = {}, { codeOk = false } = {}) => {
  if (!(await isOwner(actorId))) return { error: 'owner_only' };
  if (!codeOk) return { error: 'code_required' };
  const cur = await settings(true);
  const num = (v, d, lo, hi) => (v === undefined ? d : Math.max(lo, Math.min(hi, Number(v))));
  const n = {
    enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.enabled,
    feePercent: num(b.feePercent, cur.feePercent, 0, 10), feeMin: Math.trunc(num(b.feeMin, cur.feeMin, 0, 10000)), feeMax: Math.trunc(num(b.feeMax, cur.feeMax, 0, 100000)),
    minAmount: Math.trunc(num(b.minAmount, cur.minAmount, 1, 1_000_000)), maxAmount: Math.trunc(num(b.maxAmount, cur.maxAmount, 1, 10_000_000)),
    dailyLimit: Math.trunc(num(b.dailyLimit, cur.dailyLimit, 1, 100_000_000)), newDays: Math.trunc(num(b.newDays, cur.newDays, 0, 365)), newDailyLimit: Math.trunc(num(b.newDailyLimit, cur.newDailyLimit, 0, 10_000_000)),
    velocityMax: Math.trunc(num(b.velocityMax, cur.velocityMax, 1, 100)), recipientsFlag: Math.trunc(num(b.recipientsFlag, cur.recipientsFlag, 2, 500)),
  };
  if (Number.isNaN(n.feePercent) || n.minAmount > n.maxAmount) return { error: 'bad_settings' };
  if (n.feeMax && n.feeMax < n.feeMin) return { error: 'bad_settings' };
  await query(`UPDATE wallet_p2p_settings SET enabled=$1, fee_percent=$2, fee_min=$3, fee_max=$4, min_amount=$5, max_amount=$6, daily_limit=$7, new_days=$8, new_daily_limit=$9, velocity_max=$10, recipients_flag=$11, updated_by=$12, updated_at=now() WHERE id`,
    [n.enabled, n.feePercent, n.feeMin, n.feeMax, n.minAmount, n.maxAmount, n.dailyLimit, n.newDays, n.newDailyLimit, n.velocityMax, n.recipientsFlag, actorId]);
  await logAdmin({ actorId, targetType: 'system', type: 'p2p_settings', detail: `переводы ${n.enabled ? 'включены' : 'выключены'}; комиссия ${n.feePercent}% (мин ${n.feeMin}, макс ${n.feeMax || '—'}); лимиты ${n.minAmount}…${n.maxAmount}, сутки ${n.dailyLimit}` });
  return { ok: true, settings: await settings(true) };
};

const isCode = (c) => c === 'RUB' || Object.hasOwn(CURRENCIES, c);
const feeFor = (s, currency, amount) => {
  if (!s.feePercent) return 0;
  let f = Math.ceil((amount * s.feePercent) / 100);
  if (currency === 'RUB') { f = Math.max(f, s.feeMin); if (s.feeMax) f = Math.min(f, s.feeMax); }
  else f = Math.max(f, 1);
  return f;
};
const rateOf = async (c, currency) => {
  if (currency === 'RUB') return { rate: 1 };
  const r = (await c.query('SELECT rate_rub, enabled FROM wallet_fx_rates WHERE currency = $1', [currency])).rows[0];
  return r?.enabled && Number(r.rate_rub) > 0 ? { rate: Number(r.rate_rub) } : null;
};
const rubOf = (currency, amount, rate) => (currency === 'RUB' ? amount : Math.floor((amount * rate) / 100));
const q = (c) => ({ query: (t, v) => c.query(t, v) });

const tokenOf = (sender, recipient, currency, amount, fee, exp) => `${exp}.${macOf('p2pq', `${sender}|${recipient}|${currency}|${amount}|${fee}|${exp}`).slice(0, 40)}`;

/* ─── 1–4. Получатель ─── */
export const lookup = async (senderId, rawHandle) => {
  const s = await settings();
  if (!s.enabled) return { error: 'transfers_disabled' };
  const h = clean(rawHandle, 60).replace(/^@/, '');
  if (!/^[A-Za-z0-9_.-]{2,60}$/.test(h)) return { error: 'not_found' };
  const p = (await query(`SELECT p.id, p.name, p.username, p.avatar, p.created_at, p.is_bot, p.deleted_at, p.sky_id,
      (SELECT blocked_until FROM sky_ids WHERE id = p.sky_id) AS blocked_until
      FROM profiles p WHERE lower(p.username) = lower($1) OR p.id = $1 LIMIT 1`, [h])).rows[0];
  if (!p || p.deleted_at || p.is_bot) return { error: 'not_found' };
  if (p.id === senderId) return { error: 'cannot_send_to_self' };
  if ((p.blocked_until && new Date(p.blocked_until) > new Date()) || (await frozenProfile(p.id))) return { error: 'recipient_unavailable' };
  const marks = await marksFor('user', [p.id]);
  return { recipient: { id: p.id, name: p.name, username: p.username, avatar: p.avatar || undefined, memberSince: p.created_at, mark: marks[p.id] ?? null } };
};

const limitsCheck = async (c, senderId, s, rubEquiv) => {
  if (rubEquiv < s.minAmount) return { error: 'amount_too_small', min: s.minAmount };
  if (rubEquiv > s.maxAmount) return { error: 'amount_too_large', max: s.maxAmount };
  const prof = (await c.query('SELECT created_at FROM profiles WHERE id = $1', [senderId])).rows[0];
  const ageDays = (Date.now() - new Date(prof?.created_at ?? Date.now()).getTime()) / 86_400_000;
  const day = Number((await c.query(`SELECT COALESCE(sum(rub_equiv),0)::bigint AS n FROM wallet_p2p WHERE sender_id = $1 AND created_at > now() - interval '24 hours'`, [senderId])).rows[0].n);
  const cap = ageDays < s.newDays ? Math.min(s.newDailyLimit, s.dailyLimit) : s.dailyLimit;
  if (day + rubEquiv > cap) return { error: ageDays < s.newDays ? 'new_account_limit' : 'daily_limit', limit: cap, used: day };
  const fast = Number((await c.query(`SELECT count(*)::int AS n FROM wallet_p2p WHERE sender_id = $1 AND created_at > now() - interval '10 minutes'`, [senderId])).rows[0].n);
  if (fast >= s.velocityMax) return { error: 'too_fast' };
  return null;
};

/* ─── 5–7. Котировка: сумма, комиссия, итог ─── */
export const quote = async (senderId, { recipientId, currency, amount } = {}) => {
  const s = await settings();
  if (!s.enabled) return { error: 'transfers_disabled' };
  const cur = String(currency ?? 'RUB').toUpperCase();
  if (!isCode(cur)) return { error: 'bad_currency' };
  const amt = Number(amount);
  if (!Number.isSafeInteger(amt) || amt <= 0 || amt > MAX_UNITS) return { error: 'invalid_amount' };
  const rcp = await lookup(senderId, String(recipientId ?? ''));
  if (rcp.error) return rcp;
  const c = q({ query: (t, v) => query(t, v) });
  const rate = await rateOf(c, cur); if (!rate) return { error: 'currency_unavailable' };
  const rubEquiv = rubOf(cur, amt, rate.rate);
  const lim = await limitsCheck(c, senderId, s, rubEquiv); if (lim) return lim;
  if (cur !== 'RUB') {
    if (!(await query('SELECT 1 FROM wallet_fx_accounts WHERE user_id = $1 AND currency = $2', [senderId, cur])).rowCount) return { error: 'no_account' };
    if (!(await query('SELECT 1 FROM wallet_fx_accounts WHERE user_id = $1 AND currency = $2', [rcp.recipient.id, cur])).rowCount) return { error: 'recipient_no_account' };
  }
  const fee = feeFor(s, cur, amt); const exp = Date.now() + QUOTE_TTL_MS;
  return { ok: true, recipient: rcp.recipient, currency: cur, amount: amt, fee, total: amt + fee, rate: cur === 'RUB' ? undefined : rate.rate, rubEquiv, expiresAt: exp, token: tokenOf(senderId, rcp.recipient.id, cur, amt, fee, exp), feePercent: s.feePercent };
};

/** Повторная проверка получателя внутри транзакции — только через её соединение. */
const recipientTx = async (client, rid) => {
  const p = (await client.query(`SELECT p.id, p.name, p.username, p.is_bot, p.deleted_at, (SELECT blocked_until FROM sky_ids WHERE id = p.sky_id) AS blocked_until,
      EXISTS (SELECT 1 FROM acct_freezes f WHERE f.target_type = 'account' AND f.target_id = p.sky_id AND f.status = 'active' AND (f.expires_at IS NULL OR f.expires_at > now())) AS frozen
      FROM profiles p WHERE p.id = $1`, [rid])).rows[0];
  if (!p || p.deleted_at || p.is_bot) return { error: 'not_found' };
  if (p.frozen || (p.blocked_until && new Date(p.blocked_until) > new Date())) return { error: 'recipient_unavailable' };
  return { recipient: { id: p.id, name: p.name, username: p.username } };
};

/** Одновременно в работе не больше 5 переводов: соединения пула (их 10) не должны целиком уйти на ожидание блокировок счетов,
 *  иначе тому, кто держит блокировку, не хватит соединения для вложенных запросов (проверки кошелька) — и всё встанет до тайм-аута. */
let active = 0; const waiters = [];
const enter = () => new Promise((res) => { const go = () => { active++; res(); }; if (active < 5) go(); else waiters.push(go); });
const leave = () => { active--; const n = waiters.shift(); if (n) n(); };

/* ─── 8–11. Выполнение ─── */
export const transfer = async (senderId, args = {}) => { await enter(); try { return await doTransfer(senderId, args); } finally { leave(); } };
const doTransfer = async (senderId, { recipientId, currency, amount, token, idemKey, note } = {}) => {
  const s = await settings();
  if (!s.enabled) return { error: 'transfers_disabled' };
  const cur = String(currency ?? '').toUpperCase();
  if (!isCode(cur)) return { error: 'bad_currency' };
  const amt = Number(amount);
  if (!Number.isSafeInteger(amt) || amt <= 0 || amt > MAX_UNITS) return { error: 'invalid_amount' };
  if (typeof idemKey !== 'string' || idemKey.length < 8 || idemKey.length > 80) return { error: 'idem_required' };
  const rid = String(recipientId ?? '');
  if (rid === senderId) return { error: 'cannot_send_to_self' };
  const comment = clean(note, 140);
  const [exps, mac] = String(token ?? '').split('.');
  const exp = Number(exps);

  const pre = await lookup(senderId, rid);
  if (pre.error) return { error: pre.error };
  const client = await pool.connect();
  let result; let flagWork = null;
  try {
    await client.query('BEGIN');
    // Блокировка счетов обеих сторон в порядке id — встречные переводы не ждут друг друга по кругу.
    const ids = [senderId, rid].sort();
    for (const id of ids) await client.query('INSERT INTO wallet_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [id]);
    await client.query('SELECT 1 FROM wallet_accounts WHERE user_id = ANY($1) ORDER BY user_id FOR UPDATE', [ids]);
    if (cur !== 'RUB') await client.query('SELECT 1 FROM wallet_fx_accounts WHERE currency = $2 AND user_id = ANY($1) ORDER BY user_id FOR UPDATE', [ids, cur]);

    const dup = (await client.query('SELECT * FROM wallet_p2p WHERE sender_id = $1 AND idem_key = $2', [senderId, idemKey])).rows[0];
    if (dup) {
      await client.query('ROLLBACK');
      if (dup.recipient_id !== rid || dup.currency !== cur || Number(dup.amount) !== amt) return { error: 'idem_conflict' };
      return { ok: true, duplicate: true, id: dup.id, currency: dup.currency, amount: Number(dup.amount), fee: Number(dup.fee) };
    }
    // Всё, что показали человеку, пересчитываем здесь и сверяем с подписанной котировкой.
    const fee = feeFor(s, cur, amt);
    const okTok = Number.isFinite(exp) && mac && `${exps}.${mac}` === tokenOf(senderId, rid, cur, amt, fee, exp);
    if (!okTok) { await client.query('ROLLBACK'); return { error: 'quote_changed' }; }
    if (exp < Date.now()) { await client.query('ROLLBACK'); return { error: 'quote_expired' }; }
    const rcp = await recipientTx(client, rid);
    if (rcp.error) { await client.query('ROLLBACK'); return { error: rcp.error }; }
    const rate = await rateOf(client, cur); if (!rate) { await client.query('ROLLBACK'); return { error: 'currency_unavailable' }; }
    const rubEquiv = rubOf(cur, amt, rate.rate);
    const lim = await limitsCheck(client, senderId, s, rubEquiv);
    if (lim) { await client.query('ROLLBACK'); await query('INSERT INTO wallet_p2p_flags (user_id, reason, level, detail) VALUES ($1,$2,\'blocked\',$3)', [senderId, lim.error, `${rubEquiv} ₽ экв.`]).catch(() => {}); return lim; }

    const id = `p2p-${generateId()}`;
    const username = rcp.recipient.username;
    const me = (await client.query('SELECT username, name FROM profiles WHERE id = $1', [senderId])).rows[0];
    if (cur === 'RUB') {
      const sp = await wallet.spendIn(client, senderId, amt, 'p2p_out', `Перевод @${username}`, `p2p:${id}`);
      if (sp.error) { await client.query('ROLLBACK'); return sp; }
      if (fee > 0) { const sf = await wallet.spendIn(client, senderId, fee, 'p2p_fee', `Комиссия за перевод @${username}`, `p2p:${id}`); if (sf.error) { await client.query('ROLLBACK'); return sf; } }
      const cr = await wallet.creditIn(client, rid, amt, 'p2p_in', `Перевод от @${me.username}`, `p2p:${id}`);
      if (cr?.error) { await client.query('ROLLBACK'); return cr; }
    } else {
      const a = (await client.query('SELECT balance FROM wallet_fx_accounts WHERE user_id = $1 AND currency = $2', [senderId, cur])).rows[0];
      if (!a) { await client.query('ROLLBACK'); return { error: 'no_account' }; }
      if (!(await client.query('SELECT 1 FROM wallet_fx_accounts WHERE user_id = $1 AND currency = $2', [rid, cur])).rowCount) { await client.query('ROLLBACK'); return { error: 'recipient_no_account' }; }
      if (Number(a.balance) < amt + fee) { await client.query('ROLLBACK'); return { error: 'insufficient_funds', balance: Number(a.balance) }; }
      await client.query('UPDATE wallet_fx_accounts SET balance = balance - $3, updated_at = now() WHERE user_id = $1 AND currency = $2', [senderId, cur, amt + fee]);
      await client.query('UPDATE wallet_fx_accounts SET balance = balance + $3, updated_at = now() WHERE user_id = $1 AND currency = $2', [rid, cur, amt]);
    }
    await client.query(`INSERT INTO wallet_p2p (id, sender_id, recipient_id, currency, amount, fee, rate_rub, rub_equiv, note, idem_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, senderId, rid, cur, amt, fee, cur === 'RUB' ? null : rate.rate, rubEquiv, comment || null, idemKey]);
    await client.query('COMMIT');
    result = { ok: true, id, currency: cur, amount: amt, fee, total: amt + fee, rate: cur === 'RUB' ? undefined : rate.rate, recipient: { name: rcp.recipient.name, username }, createdAt: new Date().toISOString() };
    flagWork = { id, senderId, rid, cur, amt, rubEquiv, me };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }

  void notifyGift(rid, 'p2p', 'Вам перевели деньги', `${flagWork.me.name} (@${flagWork.me.username}) перевёл(а) вам ${amt}${cur === 'RUB' ? ' ₽' : ` (${cur}, сотых долей)`}`, result.id).catch(() => {});
  void evaluate(flagWork, s).catch(() => {});
  return result;
};

/** Подозрительное только помечается (деньги уже в пути законно): финансисты видят очередь и решают. Блокирует лишь превышение лимитов — до выполнения. */
const evaluate = async ({ id, senderId, rid, rubEquiv, amt, cur }, s) => {
  const flags = [];
  const recips = Number((await query(`SELECT count(DISTINCT recipient_id)::int AS n FROM wallet_p2p WHERE sender_id = $1 AND created_at > now() - interval '24 hours'`, [senderId])).rows[0].n);
  if (recips >= s.recipientsFlag) flags.push(['many_recipients', `${recips} получателей за сутки`]);
  const back = await query(`SELECT 1 FROM wallet_p2p WHERE sender_id = $1 AND recipient_id = $2 AND currency = $3 AND created_at > now() - interval '1 hour' AND id <> $4 AND amount BETWEEN $5 AND $6 LIMIT 1`, [rid, senderId, cur, id, Math.floor(amt * 0.9), Math.ceil(amt * 1.1)]);
  if (back.rowCount) flags.push(['round_trip', 'встречный перевод на близкую сумму за час']);
  const first = Number((await query('SELECT count(*)::int AS n FROM wallet_p2p WHERE sender_id = $1 AND recipient_id = $2', [senderId, rid])).rows[0].n);
  if (first === 1 && rubEquiv >= Math.max(10000, Math.floor(s.maxAmount / 2))) flags.push(['large_first', `первый перевод этому получателю на ${rubEquiv} ₽ экв.`]);
  const prof = (await query('SELECT created_at FROM profiles WHERE id = $1', [senderId])).rows[0];
  if (Date.now() - new Date(prof?.created_at ?? 0).getTime() < s.newDays * 86_400_000 && rubEquiv >= 1000) flags.push(['new_account', 'перевод с нового аккаунта']);
  for (const [reason, detail] of flags) await query(`INSERT INTO wallet_p2p_flags (transfer_id, user_id, reason, level, detail) VALUES ($1,$2,$3,'review',$4)`, [id, senderId, reason, detail]);
  if (flags.length) void notifyStaff('p2p_flag', { title: 'Подозрительный перевод', body: 'Перевод помечен для проверки финансистами.', dedupe: id, except: senderId });
};

/* ─── История: все валюты, раздельно ─── */
export const history = async (userId, { currency = 'ALL', limit = 50 } = {}) => {
  const lim = Math.min(200, Math.max(1, Number(limit) || 50)); const cur = String(currency).toUpperCase();
  const rows = [];
  if (cur === 'ALL' || cur === 'RUB') {
    const r = await query(`SELECT id, type, amount, descr, created_at FROM wallet_transactions WHERE user_id = $1 AND COALESCE(currency,'rub') = 'rub' AND COALESCE(ref,'') NOT LIKE 'p2p:%' ORDER BY created_at DESC LIMIT $2`, [userId, lim]);
    for (const x of r.rows) rows.push({ id: x.id, kind: 'rub', type: x.type, currency: 'RUB', amount: Number(x.amount), desc: x.descr, createdAt: x.created_at.toISOString() });
  }
  if (cur === 'ALL' || (cur !== 'RUB' && isCode(cur))) {
    const r = await query(`SELECT id, currency, direction, rub, amount, rate, created_at FROM wallet_fx_transfers WHERE user_id = $1 ${cur === 'ALL' ? '' : 'AND currency = $3'} ORDER BY created_at DESC LIMIT $2`, cur === 'ALL' ? [userId, lim] : [userId, lim, cur]);
    for (const x of r.rows) rows.push({ id: x.id, kind: 'fx_exchange', type: x.direction, currency: x.currency, amount: x.direction === 'buy' ? Number(x.amount) : -Number(x.amount), rate: Number(x.rate), rubCounter: Number(x.rub), createdAt: x.created_at.toISOString() });
  }
  const p = await query(`SELECT t.*, sp.username AS su, rp.username AS ru FROM wallet_p2p t JOIN profiles sp ON sp.id = t.sender_id JOIN profiles rp ON rp.id = t.recipient_id
    WHERE (t.sender_id = $1 OR t.recipient_id = $1) ${cur === 'ALL' ? '' : 'AND t.currency = $3'} ORDER BY t.created_at DESC LIMIT $2`, cur === 'ALL' ? [userId, lim] : [userId, lim, cur]);
  for (const x of p.rows) {
    const out = x.sender_id === userId;
    rows.push({ id: x.id, kind: out ? 'p2p_out' : 'p2p_in', type: out ? 'p2p_out' : 'p2p_in', currency: x.currency, amount: out ? -Number(x.amount) : Number(x.amount), fee: out ? Number(x.fee) : 0, rate: x.rate_rub ? Number(x.rate_rub) : undefined, counterparty: out ? `@${x.ru}` : `@${x.su}`, createdAt: x.created_at.toISOString() });
  }
  return { items: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, lim) };
};

/* ─── Финансисты ─── */
export const adminFlags = async (actorId, { open = true } = {}) => {
  if (!(await can(actorId, 'finance'))) return { error: 'not_allowed' };
  const r = await query(`SELECT f.id, f.transfer_id, f.user_id, f.reason, f.level, f.detail, f.reviewed_at, f.at, p.username FROM wallet_p2p_flags f LEFT JOIN profiles p ON p.id = f.user_id ${open ? 'WHERE f.reviewed_at IS NULL' : ''} ORDER BY f.at DESC LIMIT 200`);
  const tot = (await query(`SELECT currency, count(*)::int AS n, COALESCE(sum(amount),0)::bigint AS amount, COALESCE(sum(fee),0)::bigint AS fee FROM wallet_p2p WHERE created_at > now() - interval '30 days' GROUP BY currency ORDER BY currency`)).rows;
  return { items: r.rows.map((x) => ({ id: Number(x.id), transferId: x.transfer_id ?? undefined, user: x.username ? `@${x.username}` : x.user_id, reason: x.reason, level: x.level, detail: x.detail, reviewed: Boolean(x.reviewed_at), at: x.at.toISOString() })), totals30d: tot.map((x) => ({ currency: x.currency, count: x.n, amount: Number(x.amount), fee: Number(x.fee) })), settings: await settings(true) };
};
export const reviewFlag = async (actorId, flagId, note) => {
  if (!(await can(actorId, 'finance'))) return { error: 'not_allowed' };
  const text = clean(note, 300); if (text.length < 5) return { error: 'reason_required' };
  const r = await query(`UPDATE wallet_p2p_flags SET reviewed_by = $2, reviewed_at = now(), detail = COALESCE(detail,'') || ' | ' || $3 WHERE id = $1 AND reviewed_at IS NULL`, [Number(flagId), actorId, text]);
  if (!r.rowCount) return { error: 'not_found' };
  await logAdmin({ actorId, targetType: 'system', type: 'p2p_flag_review', detail: `метка ${flagId}: ${text}` });
  return { ok: true };
};
