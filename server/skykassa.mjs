/**
 * SkyKassa — сторона человека: платёж, выбор способа, реквизиты, данные
 * отправителя, «Перевод совершён», отмена, история.
 *
 * Сумма, валюта, владелец и назначение определяются здесь, на сервере;
 * клиент присылает намерение и выбор. Реквизиты замораживаются в платеже
 * ровно в том виде, в каком показаны человеку.
 */
import { query } from './db.mjs';
import { notifyStaff as notifyStaffQueue } from './staffnotify.mjs';
import { createTicket } from './support.mjs';
import { partnerOptions, partnerCreate, partnerRefresh } from './skykassapartners.mjs';
import {
  APPS, DESTINATIONS, CURRENCY, STATUS_LABEL, PAYABLE, TERMINAL, KErr,
  newId, newNumber, clean, isInt, iso, seal, open, tail4, mask, inTx,
  getSettings, transition, lockPayment, expireIfDue, notifyOnce, rub,
} from './skykassacore.mjs';

const MAX_OPEN = 5;

/* ─── Данные отправителя ───────────────────────────────────────────── */

const luhn = (digits) => {
  let sum = 0; let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
};

/** Привести идентификатор к единому виду. Возвращает { value } или { error }. */
export const normalizeIdentifier = (kind, raw) => {
  const s = String(raw ?? '').trim();
  if (kind === 'card') {
    if (!/^[0-9 \-]+$/.test(s)) return { error: 'bad_card' };
    const d = s.replace(/[ \-]/g, '');
    if (d.length < 13 || d.length > 19 || !luhn(d)) return { error: 'bad_card' };
    return { value: d };
  }
  if (kind === 'phone') {
    if (!/^[+0-9 ()\-]+$/.test(s)) return { error: 'bad_phone' };
    let d = s.replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = `7${d.slice(1)}`;
    else if (d.length === 10 && d[0] === '9') d = `7${d}`;
    if (d.length < 10 || d.length > 15) return { error: 'bad_phone' };
    return { value: `+${d}` };
  }
  if (kind === 'account') {
    const a = s.replace(/[ \-]/g, '').toUpperCase();
    if (/^[0-9]{20}$/.test(a) || /^[A-Z]{2}[0-9A-Z]{13,32}$/.test(a)) return { value: a };
    return { error: 'bad_account' };
  }
  if (kind === 'other') {
    const o = clean(s, 64);
    if (o.length < 3) return { error: 'bad_other' };
    return { value: o };
  }
  return { error: 'bad_kind' };
};

const NAME_RE = /^[\p{L}][\p{L}\p{M}\s.'’\-]{1,118}$/u;

/**
 * Проверить данные отправителя по настройкам способа.
 * Никаких PIN/CVV/паролей/кодов из SMS: форма их не содержит, а поля из
 * настроек способа с такими названиями отклоняются при сохранении способа.
 */
export const validateSender = (method, input) => {
  const fio = clean(input?.fio, 120);
  if (!NAME_RE.test(fio) || fio.split(' ').filter(Boolean).length < 2) return { error: 'bad_fio', field: 'fio' };
  const kinds = Array.isArray(method.sender_kinds) ? method.sender_kinds : ['card', 'phone', 'account', 'other'];
  const kind = String(input?.idKind ?? '');
  if (!kinds.includes(kind)) return { error: 'bad_kind', field: 'idKind' };
  const idn = normalizeIdentifier(kind, input?.idNumber);
  if (idn.error) return { error: idn.error, field: 'idNumber' };
  const extra = {};
  for (const f of Array.isArray(method.sender_fields) ? method.sender_fields : []) {
    const raw = input?.extra?.[f.key];
    const v = clean(raw, Math.min(Number(f.maxLen) || 120, 200));
    if (!v) { if (f.required) return { error: 'field_required', field: f.key }; continue; }
    if (f.type === 'digits' && !/^[0-9]+$/.test(v)) return { error: 'field_digits', field: f.key };
    if (f.type === 'select' && !(Array.isArray(f.options) && f.options.includes(v))) return { error: 'field_option', field: f.key };
    extra[f.key] = v;
  }
  return { data: { fio, idKind: kind, idNumber: idn.value, extra }, kind, tail: tail4(idn.value) };
};

export const senderPublic = (row) => {
  if (!row) return null;
  const d = open(row.data_sealed);
  return {
    fio: d.fio ?? '', idKind: row.id_kind, idMasked: mask(row.id_tail),
    extraKeys: Object.keys(d.extra ?? {}), confirmed: Boolean(row.confirmed_at),
    updatedAt: iso(row.updated_at),
  };
};

/* ─── Представления ────────────────────────────────────────────────── */

export const requisiteView = (snap, { full }) => {
  if (!snap || !snap.recipient) return null;
  return {
    methodTitle: snap.methodTitle, recipient: snap.recipient, bank: snap.bank ?? '',
    idKind: snap.idKind, identifier: full ? snap.identifier : mask(snap.tail),
    tail: snap.tail, currency: snap.currency, purpose: snap.purpose,
    instruction: snap.instruction ?? '', amount: snap.amount,
  };
};

export const paymentView = async (row, { staff = false } = {}) => {
  const snap = open(row.requisite_sealed);
  const live = row.kind === 'direct' && (PAYABLE.has(row.status) || ['user_reported', 'awaiting_review', 'in_review', 'need_info'].includes(row.status));
  const { rows: msgs } = await query(
    'SELECT id, from_staff, body, created_at FROM skykassa_messages WHERE payment_id = $1 ORDER BY created_at', [row.id]);
  const { rows: refunds } = await query(
    'SELECT id, amount, status, reason, decline_reason, created_at FROM skykassa_refunds WHERE payment_id = $1 ORDER BY created_at', [row.id]);
  const { rows: sender } = await query('SELECT * FROM skykassa_sender WHERE payment_id = $1', [row.id]);
  const { rows: method } = row.method_id
    ? await query('SELECT sender_fields, sender_kinds FROM skykassa_methods WHERE id = $1', [row.method_id]) : { rows: [] };
  let code = null;
  if (row.code_sealed && !staff) {
    const { rows: used } = await query('SELECT 1 FROM sky_code_redemptions WHERE code_id = $1 LIMIT 1', [row.code_id]);
    const expired = row.code_expires_at && new Date(row.code_expires_at).getTime() < Date.now();
    code = { value: used.length || expired ? null : open(row.code_sealed).code ?? null, used: used.length > 0, expired: Boolean(expired), expiresAt: iso(row.code_expires_at) };
  }
  return {
    id: row.id, number: row.number, app: row.app, kind: row.kind,
    status: row.status, statusLabel: STATUS_LABEL[row.status],
    amount: Number(row.amount), fee: Number(row.fee), total: Number(row.total), currency: row.currency,
    destination: row.destination, methodTitle: row.method_title, partnerTitle: row.partner_title,
    expiresAt: iso(row.expires_at), reportedAt: iso(row.reported_at), createdAt: iso(row.created_at),
    creditedAt: iso(row.credited_at), balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
    requisites: row.kind === 'direct' ? requisiteView(snap, { full: live && !staff }) : null,
    partnerUrl: row.kind === 'partner' && PAYABLE.has(row.status) && row.partner_url_sealed ? open(row.partner_url_sealed).url ?? null : null,
    sender: senderPublic(sender[0]),
    senderConfig: method[0] ? { fields: method[0].sender_fields, kinds: method[0].sender_kinds } : null,
    rejectReason: row.reject_reason, cancelReason: row.cancel_reason,
    messages: msgs.map((m) => ({ id: m.id, fromStaff: m.from_staff, body: m.body, at: iso(m.created_at) })),
    refunds: refunds.map((r) => ({ id: r.id, amount: Number(r.amount), status: r.status, reason: r.reason, declineReason: r.decline_reason, at: iso(r.created_at) })),
    refundedTotal: refunds.filter((r) => r.status === 'done').reduce((s, r) => s + Number(r.amount), 0),
    ticketId: row.ticket_id, code,
    canCancel: ['created', 'awaiting_payment', 'awaiting_review', 'need_info'].includes(row.status),
    errorText: staff ? row.error_text : '',
  };
};

/* ─── Способы и партнёры, доступные для суммы ──────────────────────── */

const inList = (list, v) => !Array.isArray(list) || list.length === 0 || list.includes(v);

/** Реквизит, который будет показан: основной, затем по приоритету; подходящий по назначению. */
const pickRequisite = async (c, methodId, destination) => {
  const { rows } = await c.query(
    `SELECT * FROM skykassa_requisites
      WHERE method_id = $1 AND enabled AND deleted_at IS NULL AND currency = $2
      ORDER BY is_primary DESC, priority ASC, created_at ASC`, [methodId, CURRENCY]);
  return rows.find((r) => r.destinations == null || r.destinations.includes(destination)) ?? null;
};

export const listOptions = async ({ amount, destination, app }) => {
  const s = await getSettings();
  const { rows: methods } = await query(
    'SELECT * FROM skykassa_methods WHERE enabled AND deleted_at IS NULL ORDER BY sort, created_at');
  const direct = [];
  for (const m of methods) {
    if (!inList(m.destinations, destination) || !inList(m.apps, app)) continue;
    if (amount < Number(m.min_amount) || amount > Number(m.max_amount)) continue;
    const req = await pickRequisite({ query }, m.id, destination);
    if (!req) continue;                                        // без реквизитов способ не показываем
    direct.push({ id: m.id, kind: m.kind, title: m.title, description: m.description, min: Number(m.min_amount), max: Number(m.max_amount) });
  }
  const partners = s.partnersEnabled ? await partnerOptions({ amount, destination, app }) : [];
  return { direct, partners, settings: { notice: s.notice, minAmount: s.minAmount, maxAmount: s.maxAmount, ttlMinutes: s.ttlMinutes } };
};

/* ─── Создание ─────────────────────────────────────────────────────── */

const appName = (v) => (APPS.includes(String(v)) ? String(v) : 'web');

export const createPayment = async (userId, body) => {
  const s = await getSettings();
  if (s.paused) return { error: 'paused', message: s.pauseMessage };
  const app = appName(body?.app);
  if (s.apps[app] === false) return { error: 'app_disabled', message: s.pauseMessage };
  const amount = Number(body?.amount);
  if (!isInt(amount) || amount < s.minAmount || amount > s.maxAmount) {
    return { error: 'bad_amount', min: s.minAmount, max: s.maxAmount };
  }
  const destination = String(body?.destination ?? 'balance');
  if (!DESTINATIONS.includes(destination)) return { error: 'bad_destination' };
  const idem = body?.idemKey == null ? null : clean(body.idemKey, 64);
  if (idem !== null && !/^[A-Za-z0-9_\-]{8,64}$/.test(idem)) return { error: 'bad_idem' };

  try {
    const row = await inTx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`skykassa:create:${userId}`]);
      if (idem) {
        const { rows } = await c.query('SELECT * FROM skykassa_payments WHERE user_id = $1 AND idem_key = $2', [userId, idem]);
        if (rows[0]) return { ...rows[0], _dup: true };
      }
      const { rows: open_ } = await c.query(
        "SELECT count(*)::int AS n FROM skykassa_payments WHERE user_id = $1 AND status IN ('created','awaiting_payment')", [userId]);
      if (open_[0].n >= MAX_OPEN) throw new KErr('too_many_open');
      const id = newId('skp');
      let number = newNumber();
      for (let i = 0; i < 5; i += 1) {
        const { rowCount } = await c.query('SELECT 1 FROM skykassa_payments WHERE number = $1', [number]);
        if (!rowCount) break;
        number = newNumber();
      }
      const { rows } = await c.query(
        `INSERT INTO skykassa_payments (id, number, user_id, app, kind, status, amount, currency, fee, total, destination, idem_key, expires_at)
         VALUES ($1,$2,$3,$4,'direct','created',$5,$6,0,$5,$7,$8, now() + ($9 || ' minutes')::interval) RETURNING *`,
        [id, number, userId, app, amount, CURRENCY, destination, idem, String(s.ttlMinutes)]);
      await c.query(
        `INSERT INTO skykassa_status_log (id, payment_id, to_status, actor_id, actor_kind, reason) VALUES ($1,$2,'created',$3,'user','Платёж создан')`,
        [newId('skl'), id, userId]);
      return rows[0];
    });
    return { payment: await paymentView(row), duplicate: Boolean(row._dup) };
  } catch (err) {
    if (err instanceof KErr) return { error: err.kcode };
    throw err;
  }
};

export const getOwn = async (userId, id) => {
  const { rows } = await query('SELECT * FROM skykassa_payments WHERE id = $1 AND user_id = $2', [String(id).slice(0, 80), userId]);
  return rows[0] ?? null;
};

/** Показать платёж владельцу; просроченный фиксируется в момент чтения. */
export const viewOwn = async (userId, id, { refresh = false } = {}) => {
  let row = await getOwn(userId, id);
  if (!row) return { error: 'not_found' };
  if (PAYABLE.has(row.status) && new Date(row.expires_at).getTime() <= Date.now()) {
    await inTx(async (c) => { const p = await lockPayment(c, row.id); if (p) await expireIfDue(c, p); });
    row = await getOwn(userId, id);
  }
  if (refresh && row.kind === 'partner' && PAYABLE.has(row.status)) {
    await partnerRefresh(row.id).catch((e) => console.error('[skykassa] проверка у партнёра:', e.message));
    row = await getOwn(userId, id);
  }
  return { payment: await paymentView(row) };
};

export const listOwn = async (userId, { limit = 50, offset = 0 } = {}) => {
  const { rows } = await query(
    `SELECT * FROM skykassa_payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, Math.min(Math.max(Number(limit) || 50, 1), 100), Math.max(Number(offset) || 0, 0)]);
  const items = [];
  for (const r of rows) {
    items.push({
      id: r.id, number: r.number, status: r.status, statusLabel: STATUS_LABEL[r.status], amount: Number(r.amount),
      currency: r.currency, destination: r.destination, kind: r.kind, methodTitle: r.method_title || r.partner_title,
      createdAt: iso(r.created_at), app: r.app,
    });
  }
  return { items };
};

/* ─── Выбор способа ────────────────────────────────────────────────── */

export const choose = async (userId, id, body) => {
  const mode = String(body?.mode ?? '');
  try {
    const out = await inTx(async (c) => {
      const pay = await lockPayment(c, String(id).slice(0, 80));
      if (!pay || pay.user_id !== userId) throw new KErr('not_found');
      if (await expireIfDue(c, pay)) return { expired: true };
      const s = await getSettings(c);
      if (s.paused) throw new KErr('paused', { message: s.pauseMessage });
      if (!PAYABLE.has(pay.status) || pay.partner_ref || pay.reported_at) throw new KErr('bad_state');
      const amount = Number(pay.amount);

      if (mode === 'direct') {
        const { rows: ms } = await c.query('SELECT * FROM skykassa_methods WHERE id = $1 AND enabled AND deleted_at IS NULL', [String(body?.methodId ?? '')]);
        const m = ms[0];
        if (!m || !inList(m.destinations, pay.destination) || !inList(m.apps, pay.app)
          || amount < Number(m.min_amount) || amount > Number(m.max_amount)) throw new KErr('method_unavailable');
        const req = await pickRequisite(c, m.id, pay.destination);
        if (!req) throw new KErr('method_unavailable');
        const idnum = open(req.identifier_sealed).value ?? '';
        const snap = {
          methodTitle: m.title, recipient: req.recipient_name, bank: req.bank, idKind: req.identifier_kind,
          identifier: idnum, tail: req.identifier_tail, currency: req.currency, amount,
          purpose: String(req.purpose_template || 'Пополнение Sky, заявка {number}').replace(/\{number\}/g, pay.number).slice(0, 200),
          instruction: [m.instruction, req.instruction].filter(Boolean).join('\n\n'),
        };
        const set = {
          kind: 'direct', method_id: m.id, method_title: m.title, requisite_id: req.id, requisite_sealed: seal(snap),
          partner_id: null, partner_title: '', fee: 0, total: amount,
        };
        if (pay.status === 'created') await transition(c, pay, 'awaiting_payment', { actorId: userId, actorKind: 'user', reason: `Способ: ${m.title}`, set });
        else {
          await c.query(
            `UPDATE skykassa_payments SET method_id=$2, method_title=$3, requisite_id=$4, requisite_sealed=$5, updated_at=now() WHERE id=$1`,
            [pay.id, m.id, m.title, req.id, set.requisite_sealed]);
          await c.query(
            `INSERT INTO skykassa_status_log (id, payment_id, from_status, to_status, actor_id, actor_kind, reason) VALUES ($1,$2,$3,$3,$4,'user',$5)`,
            [newId('skl'), pay.id, pay.status, userId, `Способ изменён: ${m.title}`]);
        }
        return { pid: pay.id };
      }

      if (mode === 'partner') {
        if (pay.status !== 'created') throw new KErr('bad_state');
        const created = await partnerCreate(c, pay, String(body?.partnerId ?? ''), s);
        return { pid: pay.id, created };
      }
      throw new KErr('bad_mode');
    });
    if (out.expired) return { error: 'expired' };
    return viewOwn(userId, out.pid);
  } catch (err) {
    if (err instanceof KErr) return { error: err.kcode, ...err.extra };
    throw err;
  }
};

/* ─── Данные отправителя ───────────────────────────────────────────── */

export const saveSender = async (userId, id, body) => {
  try {
    const done = await inTx(async (c) => {
      const pay = await lockPayment(c, String(id).slice(0, 80));
      if (!pay || pay.user_id !== userId) throw new KErr('not_found');
      if (await expireIfDue(c, pay)) return { expired: true };
      if (pay.kind !== 'direct') throw new KErr('bad_state');
      if (pay.status !== 'awaiting_payment') throw new KErr('use_change');   // после отправки — только через запись об изменении
      const { rows: ms } = await c.query('SELECT sender_fields, sender_kinds FROM skykassa_methods WHERE id = $1', [pay.method_id]);
      const v = validateSender(ms[0] ?? {}, body);
      if (v.error) throw new KErr(v.error, { field: v.field });
      await c.query(
        `INSERT INTO skykassa_sender (payment_id, data_sealed, id_kind, id_tail, confirmed_at, updated_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (payment_id) DO UPDATE SET data_sealed = EXCLUDED.data_sealed, id_kind = EXCLUDED.id_kind,
           id_tail = EXCLUDED.id_tail, confirmed_at = EXCLUDED.confirmed_at, updated_at = now()`,
        [pay.id, seal(v.data), v.kind, v.tail, body?.confirmed === true ? new Date() : null]);
      return {};
    });
    if (done.expired) return { error: 'expired' };
    return viewOwn(userId, id);
  } catch (err) {
    if (err instanceof KErr) return { error: err.kcode, ...err.extra };
    throw err;
  }
};

/** Правка после отправки: отдельная запись об изменении (автор, время, причина). */
export const changeSender = async (userId, id, body) => {
  const reason = clean(body?.reason, 300);
  if (reason.length < 5) return { error: 'reason_required' };
  try {
    await inTx(async (c) => {
      const pay = await lockPayment(c, String(id).slice(0, 80));
      if (!pay || pay.user_id !== userId) throw new KErr('not_found');
      if (!['awaiting_review', 'in_review', 'need_info'].includes(pay.status)) throw new KErr('bad_state');
      const { rows: cur } = await c.query('SELECT * FROM skykassa_sender WHERE payment_id = $1 FOR UPDATE', [pay.id]);
      if (!cur[0]) throw new KErr('sender_required');
      const { rows: ms } = await c.query('SELECT sender_fields, sender_kinds FROM skykassa_methods WHERE id = $1', [pay.method_id]);
      const v = validateSender(ms[0] ?? {}, body);
      if (v.error) throw new KErr(v.error, { field: v.field });
      const after = seal(v.data);
      await c.query(
        `INSERT INTO skykassa_sender_changes (id, payment_id, author_id, reason, before_sealed, after_sealed) VALUES ($1,$2,$3,$4,$5,$6)`,
        [newId('skc'), pay.id, userId, reason, cur[0].data_sealed, after]);
      await c.query(
        'UPDATE skykassa_sender SET data_sealed=$2, id_kind=$3, id_tail=$4, updated_at=now() WHERE payment_id=$1',
        [pay.id, after, v.kind, v.tail]);
    });
    return viewOwn(userId, id);
  } catch (err) {
    if (err instanceof KErr) return { error: err.kcode, ...err.extra };
    throw err;
  }
};

/* ─── «Перевод совершён» ───────────────────────────────────────────── */

export const report = async (userId, id, body) => {
  let notifyStaff = null;
  try {
    const dup = await inTx(async (c) => {
      const pay = await lockPayment(c, String(id).slice(0, 80));
      if (!pay || pay.user_id !== userId) throw new KErr('not_found');
      if (['user_reported', 'awaiting_review', 'in_review', 'awaiting_owner', 'need_info'].includes(pay.status)) return true;   // двойной клик
      if (await expireIfDue(c, pay)) return 'expired';
      if (pay.status !== 'awaiting_payment' || pay.kind !== 'direct') throw new KErr('bad_state');
      if (Number(body?.amount) !== Number(pay.amount)) throw new KErr('amount_mismatch');
      const { rows: sd } = await c.query('SELECT * FROM skykassa_sender WHERE payment_id = $1', [pay.id]);
      if (!sd[0]) throw new KErr('sender_required');
      if (!sd[0].confirmed_at) throw new KErr('sender_not_confirmed');
      await c.query('UPDATE skykassa_sender SET submitted_sealed = data_sealed WHERE payment_id = $1', [pay.id]);
      await transition(c, pay, 'user_reported', { actorId: userId, actorKind: 'user', reason: 'Пользователь сообщил о переводе', set: { reported_at: new Date() } });
      await transition(c, pay, 'awaiting_review', { actorKind: 'system', reason: 'Заявка передана на проверку' });
      notifyStaff = { number: pay.number, amount: pay.amount, id: pay.id };
      return false;
    });
    if (dup === 'expired') return { error: 'expired' };
    if (notifyStaff) {
      await notifyOnce(userId, `${notifyStaff.id}:awaiting_review`, 'SkyKassa', 'Заявка на пополнение отправлена на проверку. Мы сообщим о результате.');
      // Сотрудникам с правом skykassa и владельцу (по их настройкам; владельца раньше этот путь не охватывал).
      void notifyStaffQueue('topup', { title: 'Новая заявка на пополнение', body: `Заявка ${notifyStaff.number} на ${rub(notifyStaff.amount)} ждёт проверки.`, dedupe: `${notifyStaff.id}:new`, except: userId });
    }
    const v = await viewOwn(userId, id);
    return dup ? { ...v, duplicate: true } : v;
  } catch (err) {
    if (err instanceof KErr) return { error: err.kcode, ...err.extra };
    throw err;
  }
};

/* ─── Отмена ───────────────────────────────────────────────────────── */

export const cancel = async (userId, id, body) => {
  const reason = clean(body?.reason, 200) || 'По просьбе пользователя';
  try {
    await inTx(async (c) => {
      const pay = await lockPayment(c, String(id).slice(0, 80));
      if (!pay || pay.user_id !== userId) throw new KErr('not_found');
      if (pay.status === 'cancelled_user') return;                         // повтор
      if (!['created', 'awaiting_payment', 'awaiting_review', 'need_info'].includes(pay.status)) throw new KErr('cannot_cancel');
      if (pay.status === 'awaiting_payment' && pay.partner_ref) throw new KErr('cannot_cancel');   // у партнёра уже создан платёж
      await transition(c, pay, 'cancelled_user', { actorId: userId, actorKind: 'user', reason, set: { cancel_reason: reason } });
    });
    return viewOwn(userId, id);
  } catch (err) {
    if (err instanceof KErr) return { error: err.kcode, ...err.extra };
    throw err;
  }
};

/** Ответ человека на запрос сведений. */
export const reply = async (userId, id, body) => {
  const text = clean(body?.body, 1000);
  if (text.length < 2) return { error: 'empty' };
  let staffId = null;
  try {
    await inTx(async (c) => {
      const pay = await lockPayment(c, String(id).slice(0, 80));
      if (!pay || pay.user_id !== userId) throw new KErr('not_found');
      if (pay.status !== 'need_info') throw new KErr('bad_state');
      await c.query('INSERT INTO skykassa_messages (id, payment_id, author_id, from_staff, body) VALUES ($1,$2,$3,FALSE,$4)', [newId('skm'), pay.id, userId, text]);
      staffId = pay.reviewer_id;
      await transition(c, pay, 'in_review', { actorId: userId, actorKind: 'user', reason: 'Пользователь ответил на запрос' });
    });
    if (staffId) await notifyOnce(staffId, `${id}:reply:${Date.now()}`, 'SkyKassa', 'Пользователь ответил на запрос сведений.');
    return viewOwn(userId, id);
  } catch (err) {
    if (err instanceof KErr) return { error: err.kcode, ...err.extra };
    throw err;
  }
};

/* ─── Поддержка по платежу ─────────────────────────────────────────── */

export const openSupport = async (userId, id) => {
  const row = await getOwn(userId, id);
  if (!row) return { error: 'not_found' };
  if (row.ticket_id) return { ticketId: row.ticket_id, existing: true };
  const r = await createTicket(userId, {
    subject: `SkyKassa ${row.number}`,
    body: `Вопрос по платежу SkyKassa ${row.number}: ${rub(row.amount)}, статус «${STATUS_LABEL[row.status]}».`,
    kind: 'question',
  });
  if (r.error) return { error: r.error };
  const tid = r.ticket?.id ?? null;
  if (tid) await query('UPDATE skykassa_payments SET ticket_id = $2 WHERE id = $1 AND ticket_id IS NULL', [row.id, tid]);
  return { ticketId: tid };
};

/* ─── Уборка: просроченные платежи ─────────────────────────────────── */

export const sweepSkykassa = async () => {
  const { rows } = await query(
    "SELECT id FROM skykassa_payments WHERE status IN ('created','awaiting_payment') AND expires_at < now() LIMIT 500");
  let n = 0;
  for (const r of rows) {
    const notify = await inTx(async (c) => {
      const p = await lockPayment(c, r.id);
      if (!p || !(await expireIfDue(c, p))) return null;
      n += 1;
      return { user: p.user_id, id: p.id };
    });
    if (notify) await notifyOnce(notify.user, `${notify.id}:expired`, 'SkyKassa', 'Срок действия платежа истёк. Если вы не переводили деньги, ничего делать не нужно.');
  }
  return n;
};

export { TERMINAL };
