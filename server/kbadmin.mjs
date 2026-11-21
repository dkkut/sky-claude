/** SkyKassa Business — администрация Sky: список бизнесов, карточка, приостановка и возобновление (право `kassa_biz`). Реквизиты, контакты покупателей и секреты не показываются. */
import { query } from './db.mjs';
import { clean } from './gocore.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { err, audit, subState } from './kbiz.mjs';

export const adminList = async ({ q = '', status = '' } = {}) => {
  const vals = []; let w = 'TRUE';
  if (['draft', 'active', 'suspended'].includes(status)) { vals.push(status); w += ` AND b.status = $${vals.length}`; }
  const term = clean(q, 60).toLowerCase();
  if (term) { vals.push(`%${term.replace(/[%_\\]/g, '\\$&')}%`, term); w += ` AND (lower(b.name) LIKE $${vals.length - 1} OR lower(p.username) LIKE $${vals.length - 1} OR b.id = $${vals.length})`; }
  const { rows } = await query(
    `SELECT b.id, b.name, b.status, b.mode, b.legal_type, b.created_at, b.suspended_reason, p.username,
            (SELECT max(expires_at) FROM kb_subscriptions s WHERE s.business_id = b.id) AS sub_until,
            (SELECT count(*)::int FROM kb_payments x WHERE x.business_id = b.id AND x.status <> 'created') AS requests,
            (SELECT COALESCE(SUM(amount_rub), 0)::bigint FROM kb_payments x WHERE x.business_id = b.id AND x.currency = 'RUB' AND x.status = 'confirmed') AS confirmed_sum,
            (SELECT count(*)::int FROM kb_staff t WHERE t.business_id = b.id AND t.status = 'active') AS staff,
            EXISTS (SELECT 1 FROM kb_providers v WHERE v.business_id = b.id AND v.enabled) AS has_provider
       FROM kb_businesses b JOIN profiles p ON p.id = b.owner_id WHERE ${w} ORDER BY b.created_at DESC LIMIT 100`, vals);
  return { businesses: rows.map((r) => ({ id: r.id, name: r.name, owner: r.username, status: r.status, mode: r.mode, legalType: r.legal_type, createdAt: r.created_at.toISOString(), subUntil: r.sub_until?.toISOString?.() ?? null,
    requests: r.requests, confirmedSumRub: Number(r.confirmed_sum), staff: r.staff, hasProvider: r.has_provider, suspendedReason: r.suspended_reason || undefined })) };
};

export const adminCard = async (id) => {
  const { rows } = await query(`SELECT b.*, p.username FROM kb_businesses b JOIN profiles p ON p.id = b.owner_id WHERE b.id = $1`, [String(id ?? '')]);
  const b = rows[0]; if (!b) return err('not_found');
  const sub = await subState(b.id);
  const { rows: a } = await query('SELECT actor, action, detail, at FROM kb_audit WHERE business_id = $1 ORDER BY id DESC LIMIT 50', [b.id]);
  const { rows: pr } = await query('SELECT base_url, enabled, last_ok_at, last_error FROM kb_providers WHERE business_id = $1', [b.id]);
  let host = ''; try { host = new URL(pr[0]?.base_url).host; } catch { /* ok */ }
  const { rows: cnt } = await query(`SELECT count(*) FILTER (WHERE source = 'provider' AND status = 'confirmed')::int AS by_provider, count(*) FILTER (WHERE source <> 'provider' AND status = 'confirmed')::int AS by_owner, count(*) FILTER (WHERE status = 'not_found')::int AS not_found FROM kb_payments WHERE business_id = $1`, [b.id]);
  return { business: { id: b.id, name: b.name, owner: b.username, status: b.status, mode: b.mode, legalType: b.legal_type, legalVerified: false, category: b.category, country: b.country, description: b.description, createdAt: b.created_at.toISOString(),
    suspendedReason: b.suspended_reason || undefined, suspendedAt: b.suspended_at?.toISOString?.() ?? null, shopSlug: b.shop_slug || undefined, shopEnabled: b.shop_enabled },
    subscription: sub, provider: pr[0] ? { host, enabled: pr[0].enabled, lastOkAt: pr[0].last_ok_at?.toISOString?.() ?? null, lastError: pr[0].last_error || null } : null, payments: cnt[0],
    audit: a.map((x) => ({ actor: x.actor === 'provider' ? 'provider' : 'other', action: x.action, detail: x.detail, at: x.at.toISOString() })) };
};

export const suspend = async (actorId, id, reason, meta = {}) => {
  const why = clean(reason, 300); if (why.length < 5) return err('reason_required');
  const { rows } = await query(`UPDATE kb_businesses SET status = 'suspended', suspended_reason = $2, suspended_by = $3, suspended_at = now(), updated_at = now() WHERE id = $1 AND status <> 'suspended' RETURNING owner_id, name`, [String(id ?? ''), why, actorId]);
  if (!rows[0]) { const { rows: ex } = await query('SELECT status FROM kb_businesses WHERE id = $1', [String(id ?? '')]); return ex[0] ? { ok: true, duplicate: true } : err('not_found'); }
  await audit(id, actorId, 'admin_suspended', why);
  await logAdmin({ actorId, targetType: 'kassa_business', targetId: id, type: 'kassa_biz_suspend', detail: `${rows[0].name}: ${why}`, meta });
  await notifyGift(rows[0].owner_id, 'kassa_biz', 'SkyKassa Business приостановлен', `Администрация Sky приостановила ваш бизнес: ${why}`, `kbsusp:${id}:${Date.now()}`).catch(() => {});
  return { ok: true };
};
export const resume = async (actorId, id, reason, meta = {}) => {
  const why = clean(reason, 300); if (why.length < 5) return err('reason_required');
  const { rows } = await query(`UPDATE kb_businesses SET status = 'draft', suspended_reason = '', updated_at = now() WHERE id = $1 AND status = 'suspended' RETURNING owner_id, name`, [String(id ?? '')]);
  if (!rows[0]) return err('bad_state');
  await audit(id, actorId, 'admin_resumed', why);
  await logAdmin({ actorId, targetType: 'kassa_business', targetId: id, type: 'kassa_biz_resume', detail: `${rows[0].name}: ${why}`, meta });
  await notifyGift(rows[0].owner_id, 'kassa_biz', 'SkyKassa Business возобновлён', 'Приостановка снята. Бизнес скрыт — опубликуйте его в кабинете, когда будете готовы.', `kbres:${id}:${Date.now()}`).catch(() => {});
  return { ok: true };
};
