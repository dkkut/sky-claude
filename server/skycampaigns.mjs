/**
 * Кампании Sky Codes (модуль 11, ноябрь-2026). Расширение, а не вторая система: коды, награды, активации и купоны — в skycodes.mjs.
 * Кампания добавляет: окно действия (старт/конец), приостановку, лимит активаций на человека, бюджет (₽ и баллы), сводку и журнал.
 * Проверка при активации — `campaignGate`, ВНУТРИ транзакции активации, под замком строки кампании: параллельные активации одного
 * человека и общий расход бюджета не обгоняют друг друга.
 */
import { query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';

export const CAMPAIGN_ID_RE = /^scm-[0-9a-f-]{36}$/;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const mayManage = (actorId) => can(actorId, 'codes');

/** Ошибка кампании, которую skycodes превращает в ответ человеку (откатывая всю активацию). */
export class CampaignError extends Error { constructor(code) { super(code); this.skyCode = code; } }

/** Вызывается в транзакции активации. `row` — строка кода с полями серии (campaign_id, starts_at, reward_type, reward_amount). */
export const campaignGate = async (c, profileId, row) => {
  if (row.starts_at && new Date(row.starts_at).getTime() > Date.now()) throw new CampaignError('code_not_started');
  if (!row.campaign_id) return;
  const { rows } = await c.query('SELECT * FROM sky_code_campaigns WHERE id = $1 FOR UPDATE', [row.campaign_id]);
  const m = rows[0];
  if (!m) return;
  if (m.status === 'paused') throw new CampaignError('campaign_paused');
  if (m.status === 'ended' || (m.ends_at && new Date(m.ends_at).getTime() <= Date.now())) throw new CampaignError('campaign_ended');
  if (m.starts_at && new Date(m.starts_at).getTime() > Date.now()) throw new CampaignError('code_not_started');
  const { rows: used } = await c.query('SELECT count(*)::int AS n FROM sky_code_redemptions WHERE campaign_id = $1 AND profile_id = $2', [m.id, profileId]);
  if (used[0].n >= m.per_user_limit) throw new CampaignError('campaign_user_limit');
  const amount = Number(row.reward_amount) || 0;
  if (row.reward_type === 'balance' && m.budget_balance !== null) {
    if (Number(m.spent_balance) + amount > Number(m.budget_balance)) throw new CampaignError('campaign_budget_exhausted');
  }
  if (row.reward_type === 'points' && m.budget_points !== null) {
    if (Number(m.spent_points) + amount > Number(m.budget_points)) throw new CampaignError('campaign_budget_exhausted');
  }
  if (row.reward_type === 'balance') await c.query('UPDATE sky_code_campaigns SET spent_balance = spent_balance + $2 WHERE id = $1', [m.id, amount]);
  if (row.reward_type === 'points') await c.query('UPDATE sky_code_campaigns SET spent_points = spent_points + $2 WHERE id = $1', [m.id, amount]);
};

const view = (r) => ({
  id: r.id, title: r.title, note: r.note, status: r.status, startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), perUserLimit: r.per_user_limit,
  budgetBalance: r.budget_balance === null ? null : Number(r.budget_balance), budgetPoints: r.budget_points === null ? null : Number(r.budget_points),
  spentBalance: Number(r.spent_balance), spentPoints: Number(r.spent_points), createdAt: iso(r.created_at),
  batches: r.batches === undefined ? undefined : Number(r.batches), redemptions: r.redemptions === undefined ? undefined : Number(r.redemptions), people: r.people === undefined ? undefined : Number(r.people),
  live: r.status === 'active' && (!r.starts_at || new Date(r.starts_at) <= new Date()) && (!r.ends_at || new Date(r.ends_at) > new Date()),
});

const when = (v, name) => {
  if (v === undefined) return { skip: true };
  if (v === null || v === '') return { value: null };
  const d = new Date(v);
  if (typeof v === 'object' || Number.isNaN(d.getTime())) return { error: `bad_${name}` };
  return { value: d };
};
const money = (v) => { if (v === undefined) return { skip: true }; if (v === null || v === '') return { value: null }; const n = Number(v); return Number.isSafeInteger(n) && n >= 0 ? { value: n } : { error: 'bad_budget' }; };

export const listCampaigns = async (actorId) => {
  if (!(await mayManage(actorId))) return null;
  const { rows } = await query(
    `SELECT m.*, (SELECT count(*) FROM sky_code_batches b WHERE b.campaign_id = m.id) AS batches,
            (SELECT count(*) FROM sky_code_redemptions r WHERE r.campaign_id = m.id) AS redemptions,
            (SELECT count(DISTINCT r.profile_id) FROM sky_code_redemptions r WHERE r.campaign_id = m.id) AS people
       FROM sky_code_campaigns m ORDER BY m.created_at DESC LIMIT 200`);
  return rows.map(view);
};

export const createCampaign = async (actorId, input, { meta = {} } = {}) => {
  if (!(await mayManage(actorId))) return { error: 'not_allowed' };
  const title = clean(input?.title, 80);
  if (title.length < 2) return { error: 'bad_title' };
  const limit = input?.perUserLimit === undefined ? 1 : Number(input.perUserLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return { error: 'bad_limit' };
  const s = when(input?.startsAt, 'start'); const e = when(input?.endsAt, 'end');
  if (s.error || e.error) return { error: s.error ?? e.error };
  if (s.value && e.value && e.value <= s.value) return { error: 'bad_window' };
  if (e.value && e.value.getTime() <= Date.now()) return { error: 'bad_window' };
  const bb = money(input?.budgetBalance); const bp = money(input?.budgetPoints);
  if (bb.error || bp.error) return { error: 'bad_budget' };
  const id = `scm-${generateId()}`;
  await query(
    `INSERT INTO sky_code_campaigns (id, title, note, starts_at, ends_at, per_user_limit, budget_balance, budget_points, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, title, clean(input?.note, 300), s.value ?? null, e.value ?? null, limit, bb.value ?? null, bp.value ?? null, actorId]);
  await logAdmin({ actorId, targetId: id, targetType: 'sky_code', type: 'code_campaign_create', detail: `«${title}» · лимит на человека ${limit}`, meta });
  return { ok: true, id };
};

export const updateCampaign = async (actorId, id, input, { meta = {} } = {}) => {
  if (!(await mayManage(actorId))) return { error: 'not_allowed' };
  if (!CAMPAIGN_ID_RE.test(String(id ?? ''))) return { error: 'not_found' };
  const cur = (await query('SELECT * FROM sky_code_campaigns WHERE id = $1', [id])).rows[0];
  if (!cur) return { error: 'not_found' };
  const sets = []; const args = [id]; const changed = [];
  const put = (col, v, label) => { args.push(v); sets.push(`${col} = $${args.length}`); changed.push(label); };
  if (input?.status !== undefined) {
    if (!['active', 'paused', 'ended'].includes(input.status)) return { error: 'bad_status' };
    if (cur.status === 'ended' && input.status !== 'ended') return { error: 'campaign_ended' };
    if (input.status !== cur.status) put('status', input.status, `статус → ${input.status}`);
  }
  if (input?.title !== undefined) { const t = clean(input.title, 80); if (t.length < 2) return { error: 'bad_title' }; put('title', t, 'название'); }
  if (input?.note !== undefined) put('note', clean(input.note, 300), 'заметка');
  if (input?.perUserLimit !== undefined) { const l = Number(input.perUserLimit); if (!Number.isInteger(l) || l < 1 || l > 1000) return { error: 'bad_limit' }; put('per_user_limit', l, `лимит на человека ${l}`); }
  const s = when(input?.startsAt, 'start'); const e = when(input?.endsAt, 'end');
  if (s.error || e.error) return { error: s.error ?? e.error };
  if (!s.skip) put('starts_at', s.value, 'старт');
  if (!e.skip) put('ends_at', e.value, 'конец');
  const bb = money(input?.budgetBalance); const bp = money(input?.budgetPoints);
  if (bb.error || bp.error) return { error: 'bad_budget' };
  if (!bb.skip) put('budget_balance', bb.value, 'бюджет ₽');
  if (!bp.skip) put('budget_points', bp.value, 'бюджет баллов');
  if (!sets.length) return { error: 'nothing_to_change' };
  await query(`UPDATE sky_code_campaigns SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  await logAdmin({ actorId, targetId: id, targetType: 'sky_code', type: 'code_campaign_update', detail: `«${cur.title}»: ${changed.join(', ')}`, meta });
  return { ok: true };
};

/** Сводка кампании: по сериям, активациям и людям. История активаций — общая страница «Активации» с фильтром. */
export const campaignSummary = async (actorId, id) => {
  if (!(await mayManage(actorId))) return null;
  if (!CAMPAIGN_ID_RE.test(String(id ?? ''))) return { error: 'not_found' };
  const m = (await query('SELECT * FROM sky_code_campaigns WHERE id = $1', [id])).rows[0];
  if (!m) return { error: 'not_found' };
  const batches = (await query(
    `SELECT b.id, b.title, b.reward_type, b.code_count, b.max_uses,
            (SELECT count(*) FROM sky_code_redemptions r WHERE r.batch_id = b.id)::int AS redeemed
       FROM sky_code_batches b WHERE b.campaign_id = $1 ORDER BY b.created_at DESC`, [id])).rows;
  const top = (await query(
    `SELECT p.username, count(*)::int AS n FROM sky_code_redemptions r JOIN profiles p ON p.id = r.profile_id WHERE r.campaign_id = $1 GROUP BY p.username ORDER BY n DESC, p.username LIMIT 10`, [id])).rows;
  const agg = (await query('SELECT count(*)::int AS n, count(DISTINCT profile_id)::int AS people FROM sky_code_redemptions WHERE campaign_id = $1', [id])).rows[0];
  return { campaign: { ...view({ ...m, batches: batches.length, redemptions: agg.n, people: agg.people }) }, batches: batches.map((b) => ({ id: b.id, title: b.title, rewardType: b.reward_type, codes: b.code_count, maxUses: b.max_uses, redeemed: b.redeemed })), topUsers: top.map((t) => ({ username: `@${t.username}`, count: t.n })) };
};
