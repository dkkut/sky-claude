/**
 * SkyKassa — настройки из админки: способы оплаты, реквизиты, партнёры, общие параметры.
 *
 * Право `skykassa_settings`. Любое изменение, которое может направить деньги людей
 * не туда (создать/изменить/включить/удалить способ, реквизит, партнёра), требует
 * подтверждения личности (код аутентификатора/почты) и пишется в журнал администрации
 * (владелец получает уведомление по своим настройкам). Отключить — можно без кода:
 * остановка безопасна.
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { logAdmin, consumeStepUp } from './adminsec.mjs';
import { resolveSafeUrl } from './bloxnet.mjs';
import { normalizeIdentifier } from './skykassa.mjs';
import { partnerStatusView, partnerPing } from './skykassapartners.mjs';
import { SETTINGS_PURPOSE } from './skykassareview.mjs';
import {
  APPS, DESTINATIONS, ID_KINDS, newId, clean, isInt, iso, seal, open, tail4, mask, inTx,
  getSettings, saveSettings, KErr,
} from './skykassacore.mjs';

const allowed = (actorId) => can(actorId, 'skykassa_settings');
const FORBIDDEN_FIELD = /pin|cvv|cvc|парол|password|sms|смс|одноразов|код\s*(из|подтвержд)/i;
const ID_RE = /^[a-z][a-z0-9_-]{1,30}$/;

const audit = (actorId, type, detail, meta, result = 'ok') =>
  logAdmin({ actorId, targetType: 'skykassa', type, detail: String(detail).slice(0, 280), result, meta });

const needStep = async (actorId, body, meta) => {
  const r = await consumeStepUp(actorId, SETTINGS_PURPOSE, body?.stepUpCode, { meta });
  return r.error ? r : null;
};

const listOf = (v, allowedList) => {
  if (v == null) return null;
  if (!Array.isArray(v)) return false;
  const out = [...new Set(v.map(String))];
  return out.every((x) => allowedList.includes(x)) ? out : false;
};

/* ─── Способы ──────────────────────────────────────────────────────── */

const cleanFields = (v) => {
  if (!Array.isArray(v)) return false;
  if (v.length > 8) return false;
  const out = []; const keys = new Set();
  for (const f of v) {
    const key = String(f?.key ?? '');
    const label = clean(f?.label, 60);
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(key) || keys.has(key) || !label || FORBIDDEN_FIELD.test(`${key} ${label}`)) return false;
    keys.add(key);
    const type = ['text', 'digits', 'select'].includes(f?.type) ? f.type : 'text';
    const item = { key, label, type, required: f?.required === true, maxLen: Math.min(Math.max(Number(f?.maxLen) || 120, 1), 200) };
    if (type === 'select') {
      const options = Array.isArray(f?.options) ? f.options.map((o) => clean(o, 60)).filter(Boolean).slice(0, 20) : [];
      if (options.length < 2) return false;
      item.options = options;
    }
    out.push(item);
  }
  return out;
};

const methodView = (m, reqCount) => ({
  id: m.id, kind: m.kind, title: m.title, description: m.description, instruction: m.instruction, enabled: m.enabled,
  sort: m.sort, min: Number(m.min_amount), max: Number(m.max_amount), destinations: m.destinations, apps: m.apps,
  senderFields: m.sender_fields, senderKinds: m.sender_kinds, requisites: reqCount ?? 0,
});

const requisiteView = (r) => {
  const d = open(r.identifier_sealed);
  return {
    id: r.id, methodId: r.method_id, label: r.label, recipient: r.recipient_name, bank: r.bank, idKind: r.identifier_kind,
    identifier: d.value ?? '', masked: mask(r.identifier_tail), currency: r.currency, purpose: r.purpose_template,
    instruction: r.instruction, primary: r.is_primary, priority: r.priority, enabled: r.enabled, destinations: r.destinations,
    updatedAt: iso(r.updated_at),
  };
};

export const overview = async (actorId, meta) => {
  if (!(await allowed(actorId))) return { error: 'not_allowed' };
  const [settings, methods, reqs, partners] = await Promise.all([
    getSettings(),
    query('SELECT * FROM skykassa_methods WHERE deleted_at IS NULL ORDER BY sort, created_at'),
    query('SELECT * FROM skykassa_requisites WHERE deleted_at IS NULL ORDER BY is_primary DESC, priority, created_at'),
    query('SELECT * FROM skykassa_partners WHERE deleted_at IS NULL ORDER BY sort, created_at'),
  ]);
  await audit(actorId, 'skykassa_settings_view', 'Просмотр настроек и реквизитов', meta);
  return {
    settings, apps: APPS,
    methods: methods.rows.map((m) => methodView(m, reqs.rows.filter((r) => r.method_id === m.id).length)),
    requisites: reqs.rows.map(requisiteView),
    partners: partners.rows.map(partnerStatusView),
  };
};

export const putSettings = async (actorId, body, meta) => {
  if (!(await allowed(actorId))) return { error: 'not_allowed' };
  const r = await saveSettings(actorId, body ?? {});
  if (r.error) return r;
  await audit(actorId, 'skykassa_settings', `Параметры: ${Object.keys(body ?? {}).join(', ').slice(0, 120)}${body?.paused === true ? ' · приём платежей приостановлен' : ''}`, meta);
  return r;
};

export const saveMethod = async (actorId, id, body, meta) => {
  if (!(await allowed(actorId))) return { error: 'not_allowed' };
  const creating = !id;
  const { rows } = creating ? { rows: [] } : await query('SELECT * FROM skykassa_methods WHERE id = $1 AND deleted_at IS NULL', [String(id).slice(0, 60)]);
  const cur = rows[0];
  if (!creating && !cur) return { error: 'not_found' };

  const next = {
    kind: creating ? 'custom' : cur.kind,
    title: 'title' in body ? clean(body.title, 80) : cur?.title ?? '',
    description: 'description' in body ? clean(body.description, 300) : cur?.description ?? '',
    instruction: 'instruction' in body ? clean(body.instruction, 800) : cur?.instruction ?? '',
    enabled: 'enabled' in body ? body.enabled === true : cur?.enabled ?? false,
    sort: 'sort' in body ? Number(body.sort) : cur?.sort ?? 100,
    min: 'min' in body ? Number(body.min) : Number(cur?.min_amount ?? 100),
    max: 'max' in body ? Number(body.max) : Number(cur?.max_amount ?? 100000),
  };
  if (creating && ['account', 'transfer', 'custom'].includes(body.kind)) next.kind = body.kind;
  if (next.title.length < 2) return { error: 'bad_field', field: 'title' };
  if (!isInt(next.sort) || next.sort < 0 || next.sort > 10000) return { error: 'bad_field', field: 'sort' };
  if (!isInt(next.min) || !isInt(next.max) || next.min < 1 || next.max < next.min || next.max > 10_000_000) return { error: 'bad_field', field: 'max' };
  const dests = 'destinations' in body ? listOf(body.destinations, DESTINATIONS) : cur?.destinations ?? DESTINATIONS;
  const apps = 'apps' in body ? listOf(body.apps, APPS) : cur?.apps ?? [];
  const kinds = 'senderKinds' in body ? listOf(body.senderKinds, ID_KINDS) : cur?.sender_kinds ?? ID_KINDS;
  if (dests === false || !dests?.length) return { error: 'bad_field', field: 'destinations' };
  if (apps === false) return { error: 'bad_field', field: 'apps' };
  if (kinds === false || !kinds?.length) return { error: 'bad_field', field: 'senderKinds' };
  const fields = 'senderFields' in body ? cleanFields(body.senderFields) : cur?.sender_fields ?? [];
  if (fields === false) return { error: 'bad_field', field: 'senderFields' };

  const turningOff = !creating && cur.enabled && next.enabled === false && Object.keys(body).every((k) => ['enabled', 'stepUpCode'].includes(k));
  if (!turningOff) { const st = await needStep(actorId, body, meta); if (st) return st; }

  const mid = creating ? `skm-${newId('x').slice(2, 14)}` : cur.id;
  if (creating) {
    await query(
      `INSERT INTO skykassa_methods (id, kind, title, description, instruction, enabled, sort, min_amount, max_amount, destinations, apps, sender_fields, sender_kinds, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [mid, next.kind, next.title, next.description, next.instruction, next.enabled, next.sort, next.min, next.max,
        JSON.stringify(dests), JSON.stringify(apps ?? []), JSON.stringify(fields), JSON.stringify(kinds), actorId]);
  } else {
    await query(
      `UPDATE skykassa_methods SET title=$2, description=$3, instruction=$4, enabled=$5, sort=$6, min_amount=$7, max_amount=$8,
         destinations=$9, apps=$10, sender_fields=$11, sender_kinds=$12, updated_at=now() WHERE id=$1`,
      [mid, next.title, next.description, next.instruction, next.enabled, next.sort, next.min, next.max,
        JSON.stringify(dests), JSON.stringify(apps ?? []), JSON.stringify(fields), JSON.stringify(kinds)]);
  }
  await audit(actorId, creating ? 'skykassa_method_new' : 'skykassa_method_edit', `«${next.title}»${next.enabled ? ' · включён' : ' · выключен'}`, meta);
  return { ok: true, id: mid };
};

export const deleteMethod = async (actorId, id, body, meta) => {
  if (!(await allowed(actorId))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT title FROM skykassa_methods WHERE id = $1 AND deleted_at IS NULL', [String(id).slice(0, 60)]);
  if (!rows[0]) return { error: 'not_found' };
  const st = await needStep(actorId, body, meta); if (st) return st;
  await inTx(async (c) => {
    await c.query('UPDATE skykassa_methods SET deleted_at = now(), enabled = FALSE WHERE id = $1', [id]);
    await c.query('UPDATE skykassa_requisites SET deleted_at = now(), enabled = FALSE, is_primary = FALSE WHERE method_id = $1 AND deleted_at IS NULL', [id]);
  });
  await audit(actorId, 'skykassa_method_del', `«${rows[0].title}» удалён (история платежей сохранена)`, meta);
  return { ok: true };
};

/* ─── Реквизиты ────────────────────────────────────────────────────── */

const hist = (c, reqId, actorId, action, detail) =>
  c.query('INSERT INTO skykassa_requisite_history (id, requisite_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5)', [newId('skh'), reqId, actorId, action, JSON.stringify(detail)]);

export const saveRequisite = async (actorId, id, body, meta) => {
  if (!(await allowed(actorId))) return { error: 'not_allowed' };
  const creating = !id;
  let cur = null;
  if (!creating) {
    const { rows } = await query('SELECT * FROM skykassa_requisites WHERE id = $1 AND deleted_at IS NULL', [String(id).slice(0, 60)]);
    cur = rows[0];
    if (!cur) return { error: 'not_found' };
  }
  const methodId = creating ? String(body?.methodId ?? '') : cur.method_id;
  const { rows: ms } = await query('SELECT id, title FROM skykassa_methods WHERE id = $1 AND deleted_at IS NULL', [methodId]);
  if (!ms[0]) return { error: 'bad_field', field: 'methodId' };

  const next = {
    label: 'label' in body ? clean(body.label, 80) : cur?.label ?? '',
    recipient: 'recipient' in body ? clean(body.recipient, 160) : cur?.recipient_name ?? '',
    bank: 'bank' in body ? clean(body.bank, 120) : cur?.bank ?? '',
    purpose: 'purpose' in body ? clean(body.purpose, 200) : cur?.purpose_template ?? 'Пополнение Sky, заявка {number}',
    instruction: 'instruction' in body ? clean(body.instruction, 600) : cur?.instruction ?? '',
    priority: 'priority' in body ? Number(body.priority) : cur?.priority ?? 100,
    enabled: 'enabled' in body ? body.enabled === true : cur?.enabled ?? true,
    primary: 'primary' in body ? body.primary === true : cur?.is_primary ?? false,
    idKind: 'idKind' in body ? String(body.idKind) : cur?.identifier_kind ?? '',
  };
  if (next.recipient.length < 3) return { error: 'bad_field', field: 'recipient' };
  if (!ID_KINDS.includes(next.idKind)) return { error: 'bad_field', field: 'idKind' };
  if (!isInt(next.priority) || next.priority < 0 || next.priority > 10000) return { error: 'bad_field', field: 'priority' };
  let dests = cur?.destinations ?? null;
  if ('destinations' in body) {
    dests = listOf(body.destinations, DESTINATIONS);
    if (dests === false) return { error: 'bad_field', field: 'destinations' };
  }

  let sealed = cur?.identifier_sealed; let tail = cur?.identifier_tail;
  if (creating || 'identifier' in body || next.idKind !== cur.identifier_kind) {
    const idn = normalizeIdentifier(next.idKind, body?.identifier);
    if (idn.error) return { error: idn.error, field: 'identifier' };
    sealed = seal({ value: idn.value }); tail = tail4(idn.value);
  }

  const turningOff = !creating && cur.enabled && next.enabled === false && Object.keys(body).every((k) => ['enabled', 'stepUpCode'].includes(k));
  if (!turningOff) { const st = await needStep(actorId, body, meta); if (st) return st; }

  const rid = creating ? `skr-${newId('x').slice(2, 14)}` : cur.id;
  await inTx(async (c) => {
    if (next.primary) await c.query('UPDATE skykassa_requisites SET is_primary = FALSE WHERE method_id = $1 AND is_primary AND id <> $2', [methodId, rid]);
    if (creating) {
      await c.query(
        `INSERT INTO skykassa_requisites (id, method_id, label, recipient_name, bank, identifier_kind, identifier_sealed, identifier_tail,
           purpose_template, instruction, is_primary, priority, enabled, destinations, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [rid, methodId, next.label, next.recipient, next.bank, next.idKind, sealed, tail, next.purpose, next.instruction,
          next.primary, next.priority, next.enabled, dests ? JSON.stringify(dests) : null, actorId]);
      await hist(c, rid, actorId, 'created', { tail, recipient: next.recipient, bank: next.bank });
    } else {
      await c.query(
        `UPDATE skykassa_requisites SET label=$2, recipient_name=$3, bank=$4, identifier_kind=$5, identifier_sealed=$6, identifier_tail=$7,
           purpose_template=$8, instruction=$9, is_primary=$10, priority=$11, enabled=$12, destinations=$13, updated_at=now() WHERE id=$1`,
        [rid, next.label, next.recipient, next.bank, next.idKind, sealed, tail, next.purpose, next.instruction,
          next.primary, next.priority, next.enabled, dests ? JSON.stringify(dests) : null]);
      const diff = {};
      if (cur.recipient_name !== next.recipient) diff.recipient = [cur.recipient_name, next.recipient];
      if (cur.bank !== next.bank) diff.bank = [cur.bank, next.bank];
      if (cur.identifier_tail !== tail || cur.identifier_kind !== next.idKind) diff.identifier = [mask(cur.identifier_tail), mask(tail)];
      if (cur.enabled !== next.enabled) diff.enabled = [cur.enabled, next.enabled];
      if (cur.is_primary !== next.primary) diff.primary = [cur.is_primary, next.primary];
      if (cur.priority !== next.priority) diff.priority = [cur.priority, next.priority];
      if (cur.purpose_template !== next.purpose) diff.purpose = true;
      if (cur.instruction !== next.instruction) diff.instruction = true;
      await hist(c, rid, actorId, 'updated', diff);
    }
  });
  await audit(actorId, creating ? 'skykassa_req_new' : 'skykassa_req_edit', `${ms[0].title} · ${mask(tail)}${next.enabled ? '' : ' · выключен'}`, meta);
  return { ok: true, id: rid };
};

export const deleteRequisite = async (actorId, id, body, meta) => {
  if (!(await allowed(actorId))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT * FROM skykassa_requisites WHERE id = $1 AND deleted_at IS NULL', [String(id).slice(0, 60)]);
  if (!rows[0]) return { error: 'not_found' };
  const st = await needStep(actorId, body, meta); if (st) return st;
  await inTx(async (c) => {
    await c.query('UPDATE skykassa_requisites SET deleted_at = now(), enabled = FALSE, is_primary = FALSE WHERE id = $1', [id]);
    await hist(c, id, actorId, 'deleted', { tail: rows[0].identifier_tail });
  });
  await audit(actorId, 'skykassa_req_del', `Реквизит ${mask(rows[0].identifier_tail)} удалён (платежи с ним не затронуты)`, meta);
  return { ok: true };
};

export const requisiteHistory = async (actorId, id) => {
  if (!(await allowed(actorId))) return { error: 'not_allowed' };
  const { rows } = await query(
    `SELECT h.action, h.detail, h.created_at, p.username FROM skykassa_requisite_history h
       LEFT JOIN profiles p ON p.id = h.actor_id WHERE h.requisite_id = $1 ORDER BY h.created_at DESC LIMIT 100`, [String(id).slice(0, 60)]);
  return { items: rows.map((r) => ({ action: r.action, detail: r.detail, by: r.username, at: iso(r.created_at) })) };
};

/* ─── Партнёры ─────────────────────────────────────────────────────── */

export const savePartner = async (actorId, id, body, meta) => {
  if (!(await allowed(actorId))) return { error: 'not_allowed' };
  const creating = !id;
  let cur = null;
  if (!creating) {
    const { rows } = await query('SELECT * FROM skykassa_partners WHERE id = $1 AND deleted_at IS NULL', [String(id).slice(0, 40)]);
    cur = rows[0];
    if (!cur) return { error: 'not_found' };
  }
  const pid = creating ? String(body?.id ?? '') : cur.id;
  if (creating) {
    if (!ID_RE.test(pid)) return { error: 'bad_field', field: 'id' };
    const { rowCount } = await query('SELECT 1 FROM skykassa_partners WHERE id = $1', [pid]);
    if (rowCount) return { error: 'exists' };
  }
  const next = {
    title: 'title' in body ? clean(body.title, 80) : cur?.title ?? '',
    logo: 'logo' in body ? clean(body.logo, 300) : cur?.logo_url ?? '',
    baseUrl: 'baseUrl' in body ? clean(body.baseUrl, 300) : cur?.base_url ?? '',
    enabled: 'enabled' in body ? body.enabled === true : cur?.enabled ?? false,
    sort: 'sort' in body ? Number(body.sort) : cur?.sort ?? 100,
    min: 'min' in body ? Number(body.min) : Number(cur?.min_amount ?? 100),
    max: 'max' in body ? Number(body.max) : Number(cur?.max_amount ?? 100000),
    feePercent: 'feePercent' in body ? Number(body.feePercent) : Number(cur?.fee_percent ?? 0),
    feeFixed: 'feeFixed' in body ? Number(body.feeFixed) : Number(cur?.fee_fixed ?? 0),
    note: 'note' in body ? clean(body.note, 300) : cur?.note ?? '',
  };
  if (next.title.length < 2) return { error: 'bad_field', field: 'title' };
  if (next.logo && !/^https:\/\/[^\s]+$/.test(next.logo) && !/^\/[A-Za-z0-9_\-./]+$/.test(next.logo)) return { error: 'bad_field', field: 'logo' };
  if (!isInt(next.sort) || next.sort < 0 || next.sort > 10000) return { error: 'bad_field', field: 'sort' };
  if (!isInt(next.min) || !isInt(next.max) || next.min < 1 || next.max < next.min || next.max > 10_000_000) return { error: 'bad_field', field: 'max' };
  if (!Number.isFinite(next.feePercent) || next.feePercent < 0 || next.feePercent > 30) return { error: 'bad_field', field: 'feePercent' };
  if (!isInt(next.feeFixed) || next.feeFixed < 0 || next.feeFixed > 100000) return { error: 'bad_field', field: 'feeFixed' };
  if (next.baseUrl) {
    const t = await resolveSafeUrl(next.baseUrl, { label: 'Адрес партнёра' });
    if (!t.ok) return { error: 'bad_url', message: t.message };
  }
  const dests = 'destinations' in body ? listOf(body.destinations, DESTINATIONS) : cur?.destinations ?? ['balance'];
  const apps = 'apps' in body ? listOf(body.apps, APPS) : cur?.apps ?? [];
  if (dests === false || !dests?.length) return { error: 'bad_field', field: 'destinations' };
  if (apps === false) return { error: 'bad_field', field: 'apps' };
  const methods = 'methods' in body ? (Array.isArray(body.methods) ? body.methods.map((m) => clean(m, 40)).filter(Boolean).slice(0, 12) : false) : cur?.methods ?? [];
  if (methods === false) return { error: 'bad_field', field: 'methods' };

  const turningOff = !creating && cur.enabled && next.enabled === false && Object.keys(body).every((k) => ['enabled', 'stepUpCode'].includes(k));
  if (!turningOff) { const st = await needStep(actorId, body, meta); if (st) return st; }

  if (creating) {
    await query(
      `INSERT INTO skykassa_partners (id, title, logo_url, base_url, enabled, sort, min_amount, max_amount, fee_percent, fee_fixed, destinations, apps, methods, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [pid, next.title, next.logo, next.baseUrl, next.enabled, next.sort, next.min, next.max, next.feePercent, next.feeFixed,
        JSON.stringify(dests), JSON.stringify(apps ?? []), JSON.stringify(methods), next.note]);
  } else {
    await query(
      `UPDATE skykassa_partners SET title=$2, logo_url=$3, base_url=$4, enabled=$5, sort=$6, min_amount=$7, max_amount=$8, fee_percent=$9,
         fee_fixed=$10, destinations=$11, apps=$12, methods=$13, note=$14, updated_at=now() WHERE id=$1`,
      [pid, next.title, next.logo, next.baseUrl, next.enabled, next.sort, next.min, next.max, next.feePercent, next.feeFixed,
        JSON.stringify(dests), JSON.stringify(apps ?? []), JSON.stringify(methods), next.note]);
  }
  await audit(actorId, creating ? 'skykassa_partner_new' : 'skykassa_partner_edit', `${next.title}${next.enabled ? ' · включён' : ' · выключен'}`, meta);
  return { ok: true, id: pid };
};

export const deletePartner = async (actorId, id, body, meta) => {
  if (!(await allowed(actorId))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT title FROM skykassa_partners WHERE id = $1 AND deleted_at IS NULL', [String(id).slice(0, 40)]);
  if (!rows[0]) return { error: 'not_found' };
  const st = await needStep(actorId, body, meta); if (st) return st;
  await query('UPDATE skykassa_partners SET deleted_at = now(), enabled = FALSE WHERE id = $1', [id]);
  await audit(actorId, 'skykassa_partner_del', `${rows[0].title} удалён`, meta);
  return { ok: true };
};

export const checkPartner = async (actorId, id, meta) => {
  if (!(await allowed(actorId))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT * FROM skykassa_partners WHERE id = $1 AND deleted_at IS NULL', [String(id).slice(0, 40)]);
  if (!rows[0]) return { error: 'not_found' };
  const r = await partnerPing(rows[0]);
  await audit(actorId, 'skykassa_partner_check', `${rows[0].title}: ${r.ok ? 'связь есть' : 'нет связи'}`, meta);
  return r;
};

export { KErr };
