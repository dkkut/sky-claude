/**
 * Заявки на подключение иностранных организаций и платёжных провайдеров к SkyKassa — ТОЛЬКО учёт и чек-лист допуска.
 * Ничего не подключается и не имитируется: даже статус `ready_for_adapter` лишь значит «юридически и технически готово к написанию и проверке
 * адаптера» — настоящее подключение требует договора, ключей в окружении сервера и кода адаптера, которых здесь нет.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';

export const CHECKLIST = ['contract', 'license', 'kyc_aml', 'sanctions_check', 'currency_control', 'adapter_written', 'test_mode_verified', 'secrets_in_env'];
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const view = (r) => ({ id: r.id, name: r.name, country: r.country, legalName: r.legal_name, currencies: r.currencies, status: r.status, checklist: Object.fromEntries(CHECKLIST.map((k) => [k, Boolean(r.checklist?.[k])])), notes: r.notes, live: false, updatedAt: r.updated_at.toISOString() });

export const list = async (actorId) => {
  if (!(await can(actorId, 'skykassa_settings'))) return { error: 'not_allowed' };
  return { items: (await query('SELECT * FROM skykassa_intl_providers ORDER BY created_at DESC LIMIT 200')).rows.map(view), checklistKeys: CHECKLIST, note: 'Реальные международные провайдеры не подключены. Здесь ведётся только учёт заявок и проверок.' };
};
export const save = async (actorId, b = {}) => {
  if (!(await can(actorId, 'skykassa_settings'))) return { error: 'not_allowed' };
  const name = clean(b.name, 120), country = clean(b.country, 8).toUpperCase();
  if (name.length < 2) return { error: 'bad_name' }; if (!/^[A-Z]{2}$/.test(country)) return { error: 'bad_country' };
  const currencies = [...new Set((Array.isArray(b.currencies) ? b.currencies : []).map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)))].slice(0, 20);
  const checklist = Object.fromEntries(CHECKLIST.map((k) => [k, Boolean(b.checklist?.[k])]));
  const id = b.id ? String(b.id) : `intl-${crypto.randomUUID()}`;
  const cur = b.id ? (await query('SELECT status FROM skykassa_intl_providers WHERE id = $1', [id])).rows[0] : null;
  if (b.id && !cur) return { error: 'not_found' };
  await query(`INSERT INTO skykassa_intl_providers (id, name, country, legal_name, currencies, checklist, notes, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8)
    ON CONFLICT (id) DO UPDATE SET name=$2, country=$3, legal_name=$4, currencies=$5, checklist=$6::jsonb, notes=$7, updated_by=$8, updated_at=now(),
      status = CASE WHEN skykassa_intl_providers.status = 'ready_for_adapter' THEN 'checking' ELSE skykassa_intl_providers.status END`,
    [id, name, country, clean(b.legalName, 200), currencies, JSON.stringify(checklist), clean(b.notes, 1000), actorId]);
  await logAdmin({ actorId, targetType: 'system', type: 'skykassa_intl_save', detail: `${name} (${country})` });
  return { ok: true, id };
};
/** «Готово к написанию адаптера» — только владелец и только при полном чек-листе, КРОМЕ пунктов о готовом адаптере и ключах (они появятся позже). */
export const setStatus = async (actorId, id, status, reason) => {
  if (!(await isOwner(actorId))) return { error: 'owner_only' };
  if (!['draft', 'checking', 'ready_for_adapter', 'rejected'].includes(status)) return { error: 'bad_status' };
  const why = clean(reason, 300); if (why.length < 5) return { error: 'reason_required' };
  const r = (await query('SELECT * FROM skykassa_intl_providers WHERE id = $1', [String(id)])).rows[0];
  if (!r) return { error: 'not_found' };
  if (status === 'ready_for_adapter') {
    const missing = ['contract', 'license', 'kyc_aml', 'sanctions_check', 'currency_control'].filter((k) => !r.checklist?.[k]);
    if (missing.length) return { error: 'checklist_incomplete', missing };
  }
  await query('UPDATE skykassa_intl_providers SET status = $2, updated_by = $3, updated_at = now() WHERE id = $1', [String(id), status, actorId]);
  await logAdmin({ actorId, targetType: 'system', type: 'skykassa_intl_status', detail: `${r.name}: ${status} — ${why}` });
  return { ok: true };
};
