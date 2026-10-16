/**
 * Общий счёт Sky Family. Один баланс на семью на сервере — его видят все участники.
 * Пополнение и вывод идут через кошелёк Sky (wallet.spendIn / creditIn) в ТОЙ ЖЕ транзакции,
 * что и изменение общего баланса, под блокировкой строки счёта семьи.
 * Вывести могут только владелец и взрослые; остальным — только пополнение.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { wallet } from './wallet.mjs';

const MAX_AMOUNT = 10_000_000;
const validAmount = (n) => Number.isInteger(n) && n > 0 && n <= MAX_AMOUNT;

const membership = async (profileId, familyId) => {
  const { rows } = await query(
    `SELECT m.*, p.name AS profile_name FROM family_members m LEFT JOIN profiles p ON p.id = m.profile_id
      WHERE m.family_id = $1 AND m.profile_id = $2 AND m.status = 'active'`, [familyId, profileId]);
  return rows[0] ?? null;
};

const view = async (familyId) => {
  const { rows: w } = await query('SELECT balance, turnover FROM family_wallet WHERE family_id = $1', [familyId]);
  const { rows: tx } = await query(
    `SELECT id, profile_id, member_name, kind, amount, descr, created_at FROM family_wallet_tx
      WHERE family_id = $1 ORDER BY created_at DESC LIMIT 100`, [familyId]);
  return {
    balance: Number(w[0]?.balance ?? 0), turnover: Number(w[0]?.turnover ?? 0),
    transactions: tx.map((t) => ({ id: t.id, memberId: t.profile_id, memberName: t.member_name, kind: t.kind,
      amount: Number(t.amount), desc: t.descr, createdAt: t.created_at.toISOString() })),
  };
};

export const getWallet = async (profileId, familyId) => {
  if (!(await membership(profileId, familyId))) return { error: 'not_found' };
  return view(familyId);
};

const change = async (profileId, familyId, kind, amount, desc, idemKey, toProfileId = null) => {
  const n = Number(amount);
  if (!validAmount(n)) return { error: 'invalid_amount' };
  const m = await membership(profileId, familyId);
  if (!m) return { error: 'not_found' };
  const { rows: fam } = await query('SELECT status FROM families WHERE id = $1', [familyId]);
  if (fam[0]?.status !== 'active') return { error: 'family_inactive' };
  const out = kind !== 'topup';
  if (out && !['owner', 'adult'].includes(m.role)) return { error: 'not_allowed' };
  let payee = profileId;
  if (kind === 'withdraw' && toProfileId && toProfileId !== profileId) {
    if (!(await membership(toProfileId, familyId))) return { error: 'not_found' };
    payee = toProfileId;
  }
  const key = idemKey ? String(idemKey).slice(0, 64) : null;
  const name = String(m.profile_name || m.display_name || '').slice(0, 80);
  const text = String(desc || (kind === 'topup' ? 'Пополнение из личного кошелька' : kind === 'withdraw' ? 'Вывод на личный счёт' : 'Взнос в цель')).slice(0, 160);

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO family_wallet (family_id) VALUES ($1) ON CONFLICT DO NOTHING', [familyId]);
    const { rows } = await c.query('SELECT balance FROM family_wallet WHERE family_id = $1 FOR UPDATE', [familyId]);
    if (key) {
      const dup = await c.query('SELECT 1 FROM family_wallet_tx WHERE family_id = $1 AND profile_id = $2 AND idem_key = $3', [familyId, profileId, key]);
      if (dup.rows.length) { await c.query('ROLLBACK'); return { ok: true, duplicate: true, ...(await view(familyId)) }; }
    }
    const bal = Number(rows[0].balance);
    if (kind === 'topup') {
      const r = await wallet.spendIn(c, profileId, n, 'family_topup', 'Пополнение общего счёта Sky Family', `family:${familyId}`);
      if (r.error) { await c.query('ROLLBACK'); return { error: r.error }; }
      await c.query('UPDATE family_wallet SET balance = balance + $2, turnover = turnover + $2, updated_at = now() WHERE family_id = $1', [familyId, n]);
    } else {
      if (bal < n) { await c.query('ROLLBACK'); return { error: 'insufficient_family_funds' }; }
      if (kind === 'withdraw') {
        const r = await wallet.creditIn(c, payee, n, 'family_withdraw', 'Перевод из общего счёта Sky Family', `family:${familyId}`);
        if (r?.error) { await c.query('ROLLBACK'); return { error: r.error }; }
      }
      await c.query('UPDATE family_wallet SET balance = balance - $2, updated_at = now() WHERE family_id = $1', [familyId, n]);
    }
    await c.query(
      `INSERT INTO family_wallet_tx (id, family_id, profile_id, member_name, kind, amount, descr, idem_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [`fwt-${generateId()}`, familyId, profileId, name, kind, n, text, key]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return { ok: true, ...(await view(familyId)) };
};

export const topUp = (p, f, amount, idem) => change(p, f, 'topup', amount, null, idem);
export const withdraw = (p, f, amount, desc, idem, to) => change(p, f, 'withdraw', amount, desc, idem, to);
/** Взнос в цель: деньги уходят с общего счёта (сама цель пока хранится на устройстве). */
export const contribute = (p, f, amount, desc, idem) => change(p, f, 'goal_contribute', amount, desc, idem);
