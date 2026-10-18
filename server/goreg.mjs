/**
 * Sky GO — регистрация исполнителей (водитель такси, курьер, продавец еды, компания).
 *
 * Одна заявка = (профиль, роль). Форма зависит от статуса: НПД, ИП или ООО (поля и проверки те же,
 * что у продавцов Market: server/sellerrules.mjs). Формат проверяется здесь, подтверждения государственными
 * реестрами нет — и ничто не называется «подтверждённым», пока человек из администрации не принял решение.
 * Выбор статуса сам по себе допуска не даёт: только status = 'approved'.
 * Сведения и документы лежат зашифрованными; документы отдаёт только проверяющий с правом go (каждый просмотр — в журнал).
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { cleanForm, validPhone } from './sellerrules.mjs';
import { sniffDoc, MAX_DOC_BYTES, profileAge, ageFromDob } from './courierverify.mjs';
import { encryptBytes, decryptBytes } from './crypto.mjs';
import { newId, ROLES, LEGAL_FORMS, clean, cityOk, sealJson, openJson, goLog, notifyGo, inTx } from './gocore.mjs';
import { notifyStaff } from './staffnotify.mjs';

const FORM_KIND = { npd: 'npd', ip: 'ip', ooo: 'legal' };
const MAX_DOCS = 8;
const MIN_AGE = 18;

/** Какие документы нужны. Лишнего не просим: у продавца еды и компании — только сведения анкеты (и доверенность при необходимости). */
export const requiredDocs = (role, legalForm, fields) => {
  const need = [];
  if (role === 'taxi_driver') need.push('driver_license', 'vehicle_registration');
  if (role === 'courier') need.push('id_doc');
  if (legalForm === 'ooo' && fields?.repIsHead !== true) need.push('authority_doc');
  return need;
};
export const DOC_LABEL = {
  driver_license: 'Водительское удостоверение', vehicle_registration: 'Свидетельство о регистрации ТС (СТС)',
  id_doc: 'Документ, удостоверяющий личность', authority_doc: 'Документ о полномочиях представителя',
};

/** Особые поля роли (не из анкеты статуса). */
const cleanExtra = (role, extra, { strict }) => {
  const problems = [];
  const out = {};
  const e = extra ?? {};
  const need = (k, label, max = 80) => {
    const v = clean(e[k], max);
    if (!v && strict) problems.push({ field: k, message: `Заполните поле «${label}».` });
    out[k] = v;
  };
  if (role === 'taxi_driver') {
    need('carMake', 'Марка'); need('carModel', 'Модель'); need('carColor', 'Цвет', 30);
    need('plate', 'Госномер', 12); need('licenseNumber', 'Номер водительского удостоверения', 20);
    const y = Number(e.carYear);
    out.carYear = Number.isInteger(y) && y >= 1990 && y <= new Date().getFullYear() + 1 ? y : null;
    if (strict && !out.carYear) problems.push({ field: 'carYear', message: 'Укажите год выпуска автомобиля.' });
    out.carClass = ['economy', 'comfort', 'business'].includes(e.carClass) ? e.carClass : 'economy';
  }
  if (role === 'courier') out.transport = ['foot', 'bike', 'scooter', 'car', 'truck'].includes(e.transport) ? e.transport : 'foot';
  if (role === 'food_seller') need('placeName', 'Название заведения', 120);
  if (role === 'company') need('brand', 'Название для заказов', 120);
  if (role === 'tour_operator' || role === 'hotel') need('brand', 'Название организации', 120);
  return { extra: out, problems };
};

const view = (r, withData) => {
  const d = withData ? openJson(r.data_enc) : null;
  return {
    id: r.id, role: r.role, legalForm: r.legal_form, status: r.status, city: r.city, innLast4: r.inn_last4,
    reviewNote: r.review_note || undefined, submittedAt: r.submitted_at?.toISOString?.() ?? null,
    reviewedAt: r.reviewed_at?.toISOString?.() ?? null, updatedAt: r.updated_at?.toISOString?.() ?? null,
    ...(withData ? { fields: d.fields ?? {}, extra: d.extra ?? {} } : {}),
  };
};

export const listMine = async (profileId) => {
  const { rows } = await query('SELECT * FROM go_executors WHERE profile_id = $1 ORDER BY created_at', [profileId]);
  const out = [];
  for (const r of rows) {
    const { rows: docs } = await query('SELECT id, kind, mime, size, created_at FROM go_executor_docs WHERE executor_id = $1 ORDER BY created_at', [r.id]);
    out.push({ ...view(r, true), docs: docs.map((d) => ({ id: d.id, kind: d.kind, mime: d.mime, size: d.size })), requiredDocs: requiredDocs(r.role, r.legal_form, openJson(r.data_enc).fields) });
  }
  return out;
};

const ownRow = async (profileId, id, client) => {
  const q = client ?? { query };
  const { rows } = await q.query('SELECT * FROM go_executors WHERE id = $1 AND profile_id = $2', [String(id ?? ''), profileId]);
  return rows[0] ?? null;
};

/** Черновик: создать или поправить. Править можно до отправки, после запроса сведений и после отказа. */
export const saveDraft = async (profileId, input) => {
  const role = String(input?.role ?? '');
  const legalForm = String(input?.legalForm ?? '');
  if (!ROLES.includes(role)) return { error: 'bad_role' };
  if (!LEGAL_FORMS.includes(legalForm)) return { error: 'bad_legal_form' };
  // Туры и отели — только для ИП и организаций (нижний предел Sky; реестры туроператоров/гостиниц не сверяются).
  if ((role === 'tour_operator' || role === 'hotel') && legalForm === 'npd') return { error: 'legal_form_not_allowed' };
  const city = clean(input?.city, 60);
  if (city && !(await cityOk(city))) return { error: 'bad_city' };

  const { fields, problems } = cleanForm(FORM_KIND[legalForm], input?.fields, { strict: false, lenient: true });
  const ex = cleanExtra(role, input?.extra, { strict: false });
  if (problems.length) return { error: 'invalid_fields', problems };

  const { rows } = await query('SELECT * FROM go_executors WHERE profile_id = $1 AND role = $2', [profileId, role]);
  const cur = rows[0];
  if (cur && !['draft', 'needs_info', 'rejected'].includes(cur.status)) return { error: 'not_editable', status: cur.status };

  const data = sealJson({ fields, extra: ex.extra });
  const last4 = String(fields.inn ?? '').slice(-4);
  if (cur) {
    await query(
      `UPDATE go_executors SET legal_form = $2, data_enc = $3, inn_last4 = $4, city = $5,
              status = CASE WHEN status = 'rejected' THEN 'draft' ELSE status END, updated_at = now() WHERE id = $1`,
      [cur.id, legalForm, data, last4, city]);
    return { ok: true, id: cur.id };
  }
  const id = newId('gex');
  await query(
    `INSERT INTO go_executors (id, profile_id, role, legal_form, data_enc, inn_last4, city) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, profileId, role, legalForm, data, last4, city]);
  return { ok: true, id };
};

export const attachDoc = async (profileId, executorId, kind, bytes) => {
  const ex = await ownRow(profileId, executorId);
  if (!ex) return { error: 'not_found' };
  if (!['draft', 'needs_info', 'rejected'].includes(ex.status)) return { error: 'not_editable' };
  if (!DOC_LABEL[kind]) return { error: 'bad_doc_kind' };
  if (!bytes || bytes.length > MAX_DOC_BYTES) return { error: 'file_too_large' };
  const mime = sniffDoc(bytes);
  if (!mime) return { error: 'unsupported_type' };
  const { rows } = await query('SELECT count(*)::int AS n FROM go_executor_docs WHERE executor_id = $1', [ex.id]);
  if (rows[0].n >= MAX_DOCS) return { error: 'too_many_docs' };
  // Новый документ того же вида заменяет прежний.
  await query('DELETE FROM go_executor_docs WHERE executor_id = $1 AND kind = $2', [ex.id, kind]);
  const id = newId('gdoc');
  await query('INSERT INTO go_executor_docs (id, executor_id, kind, mime, size, data) VALUES ($1,$2,$3,$4,$5,$6)', [id, ex.id, kind, mime, bytes.length, encryptBytes(bytes)]);
  return { ok: true, id };
};

export const removeDoc = async (profileId, executorId, docId) => {
  const ex = await ownRow(profileId, executorId);
  if (!ex) return { error: 'not_found' };
  if (!['draft', 'needs_info', 'rejected'].includes(ex.status)) return { error: 'not_editable' };
  await query('DELETE FROM go_executor_docs WHERE id = $1 AND executor_id = $2', [String(docId ?? ''), ex.id]);
  return { ok: true };
};

/** Отправка: строгая проверка всех полей, документов, возраста. */
export const submit = async (profileId, executorId, input = {}) => {
  const r = await submitTx(profileId, executorId, input);
  if (r?.ok) void notifyStaff('go_reg', { title: 'Новая заявка исполнителя Sky GO', body: 'Заявка ждёт проверки.', dedupe: `${executorId}:${Date.now()}`, except: profileId });
  return r;
};
const submitTx = async (profileId, executorId, input = {}) => {
  return inTx(async (c) => {
    const ex = await ownRow(profileId, executorId, c);
    if (!ex) return { error: 'not_found' };
    if (!['draft', 'needs_info', 'rejected'].includes(ex.status)) return { error: 'not_editable', status: ex.status };
    const data = openJson(ex.data_enc);
    const { problems } = cleanForm(FORM_KIND[ex.legal_form], data.fields, { strict: true });
    const x = cleanExtra(ex.role, data.extra, { strict: true });
    const all = [...problems, ...x.problems];
    if (!ex.city) all.push({ field: 'city', message: 'Выберите город.' });
    if (!validPhone(data.fields?.phone ?? data.fields?.orgPhone ?? '')) all.push({ field: 'phone', message: 'Укажите телефон для связи.' });
    if (all.length) return { error: 'invalid_fields', problems: all };

    if (ex.role === 'taxi_driver' || ex.role === 'courier') {
      let age = await profileAge(profileId);
      // Даты рождения в профиле нет — принимаем её прямо в заявке (один раз; уже заданную не перезаписываем).
      if (age === null && input?.dateOfBirth) {
        const d = String(input.dateOfBirth);
        const a = /^\d{4}-\d{2}-\d{2}$/.test(d) ? ageFromDob(d) : null;
        if (a === null || a < 0 || a > 120) return { error: 'invalid_dob' };
        await c.query('UPDATE profiles SET date_of_birth = $2 WHERE id = $1 AND date_of_birth IS NULL', [profileId, d]);
        age = a;
      }
      if (age === null) return { error: 'dob_required' };
      if (age < MIN_AGE) return { error: 'too_young', minAge: MIN_AGE };
    }
    const { rows: docs } = await c.query('SELECT kind FROM go_executor_docs WHERE executor_id = $1', [ex.id]);
    const have = new Set(docs.map((d) => d.kind));
    const missing = requiredDocs(ex.role, ex.legal_form, data.fields).filter((k) => !have.has(k));
    if (missing.length) return { error: 'docs_missing', missing };

    await c.query(`UPDATE go_executors SET status = 'submitted', submitted_at = now(), review_note = '', updated_at = now() WHERE id = $1`, [ex.id]);
    await goLog(profileId, 'exec_submit', ex.id, { role: ex.role, legalForm: ex.legal_form });
    return { ok: true, status: 'submitted' };
  });
};

/* ─── Реквизиты для прямой оплаты ──────────────────────────────────── */
const luhn = (s) => { let sum = 0; let alt = false; for (let i = s.length - 1; i >= 0; i -= 1) { let n = Number(s[i]); if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; };

export const cleanPayDetails = (input) => {
  const method = ['card', 'sbp', 'account'].includes(input?.method) ? input.method : null;
  if (!method) return { error: 'bad_method' };
  const holder = clean(input?.holder, 120);
  if (holder.length < 3) return { error: 'holder_required' };
  const out = { method, holder, bank: clean(input?.bank, 80), note: clean(input?.note, 160) };
  if (method === 'card') {
    const n = String(input?.number ?? '').replace(/\s+/g, '');
    if (!/^\d{16,19}$/.test(n) || !luhn(n)) return { error: 'bad_card' };
    out.number = n;
  } else if (method === 'sbp') {
    const p = String(input?.phone ?? '').replace(/[^\d+]/g, '');
    if (!/^\+?\d{10,15}$/.test(p)) return { error: 'bad_phone' };
    out.phone = p;
    if (!out.bank) return { error: 'bank_required' };
  } else {
    const acc = String(input?.account ?? '').replace(/\s+/g, '');
    const bik = String(input?.bik ?? '').replace(/\s+/g, '');
    if (!/^\d{20}$/.test(acc)) return { error: 'bad_account' };
    if (!/^\d{9}$/.test(bik)) return { error: 'bad_bik' };
    out.account = acc; out.bik = bik;
  }
  return { ok: true, value: out };
};

export const setPayDetails = async (profileId, input) => {
  const r = cleanPayDetails(input);
  if (r.error) return r;
  await query(
    `INSERT INTO go_pay_details (profile_id, data_enc) VALUES ($1,$2)
     ON CONFLICT (profile_id) DO UPDATE SET data_enc = $2, updated_at = now()`, [profileId, sealJson(r.value)]);
  return { ok: true };
};

/** Свои реквизиты — владельцу целиком; номер маскируется (полностью показывается только плательщику по заказу). */
export const myPayDetails = async (profileId) => {
  const { rows } = await query('SELECT data_enc FROM go_pay_details WHERE profile_id = $1', [profileId]);
  if (!rows[0]) return null;
  const d = openJson(rows[0].data_enc);
  const mask = (s) => (s ? `${'•'.repeat(Math.max(0, String(s).length - 4))}${String(s).slice(-4)}` : undefined);
  return { method: d.method, holder: d.holder, bank: d.bank, note: d.note, number: mask(d.number), phone: mask(d.phone), account: mask(d.account), bik: d.bik };
};
export const payDetailsRaw = async (profileId) => {
  const { rows } = await query('SELECT data_enc FROM go_pay_details WHERE profile_id = $1', [profileId]);
  return rows[0] ? openJson(rows[0].data_enc) : null;
};

/* ─── Администрация ────────────────────────────────────────────────── */
const staff = async (adminId) => can(adminId, 'go');

export const adminQueue = async (adminId, { status, role, limit } = {}) => {
  if (!(await staff(adminId))) return { error: 'not_allowed' };
  const args = [];
  const where = [];
  if (status && /^[a-z_]+$/.test(status)) { args.push(status); where.push(`e.status = $${args.length}`); } else where.push("e.status IN ('submitted','in_review','needs_info')");
  if (role && ROLES.includes(role)) { args.push(role); where.push(`e.role = $${args.length}`); }
  args.push(Math.min(Math.max(Number(limit) || 100, 1), 300));
  const { rows } = await query(
    `SELECT e.*, p.name, p.username FROM go_executors e JOIN profiles p ON p.id = e.profile_id
      WHERE ${where.join(' AND ')} ORDER BY e.submitted_at NULLS LAST LIMIT $${args.length}`, args);
  return { items: rows.map((r) => ({ ...view(r, false), profileId: r.profile_id, name: r.name, username: r.username })) };
};

export const adminDetail = async (adminId, id) => {
  if (!(await staff(adminId))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT e.*, p.name, p.username FROM go_executors e JOIN profiles p ON p.id = e.profile_id WHERE e.id = $1', [String(id ?? '')]);
  const r = rows[0];
  if (!r) return { error: 'not_found' };
  const { rows: docs } = await query('SELECT id, kind, mime, size FROM go_executor_docs WHERE executor_id = $1', [r.id]);
  await goLog(adminId, 'exec_view', r.id, {});
  const data = openJson(r.data_enc);
  return { executor: { ...view(r, true), profileId: r.profile_id, name: r.name, username: r.username, docs: docs.map((d) => ({ ...d, label: DOC_LABEL[d.kind] ?? d.kind })),
    checks: { // что проверил сервер, а что — нет
      formatValidated: true, registryChecked: false, requiredDocs: requiredDocs(r.role, r.legal_form, data.fields) } } };
};

export const adminDocBytes = async (adminId, docId) => {
  if (!(await staff(adminId))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT * FROM go_executor_docs WHERE id = $1', [String(docId ?? '')]);
  const d = rows[0];
  if (!d) return { error: 'not_found' };
  await goLog(adminId, 'exec_doc_view', d.executor_id, { doc: d.id, kind: d.kind });
  return { mime: d.mime, bytes: decryptBytes(d.data) };
};

const ACTIONS = {
  start_review: { from: ['submitted'], to: 'in_review' },
  approve: { from: ['submitted', 'in_review', 'needs_info'], to: 'approved' },
  reject: { from: ['submitted', 'in_review', 'needs_info'], to: 'rejected', note: true },
  needs_info: { from: ['submitted', 'in_review'], to: 'needs_info', note: true },
  suspend: { from: ['approved'], to: 'suspended', note: true },
  unsuspend: { from: ['suspended'], to: 'approved' },
  block: { from: ['approved', 'suspended', 'submitted', 'in_review', 'needs_info', 'rejected', 'draft'], to: 'blocked', note: true },
};

export const adminDecide = async (adminId, id, action, note = '') => {
  if (!(await staff(adminId))) return { error: 'not_allowed' };
  const rule = ACTIONS[action];
  if (!rule) return { error: 'bad_action' };
  const text = clean(note, 400);
  if (rule.note && text.length < 3) return { error: 'note_required' };
  return inTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM go_executors WHERE id = $1 FOR UPDATE', [String(id ?? '')]);
    const ex = rows[0];
    if (!ex) return { error: 'not_found' };
    if (!rule.from.includes(ex.status)) return { error: 'bad_transition', status: ex.status };
    await c.query(`UPDATE go_executors SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now() WHERE id = $1`, [ex.id, rule.to, text, adminId]);
    // Снятый допуск гасит присутствие на линии.
    if (['suspended', 'blocked', 'rejected'].includes(rule.to) && ['taxi_driver', 'courier'].includes(ex.role)) {
      await c.query(`UPDATE go_presence SET online = FALSE, updated_at = now() WHERE profile_id = $1 AND role = $2`, [ex.profile_id, ex.role]);
    }
    if (rule.to !== 'in_review') await goLog(adminId, `exec_${action}`, ex.id, { note: text, role: ex.role });
    return { ok: true, status: rule.to, profileId: ex.profile_id, role: ex.role };
  }).then(async (r) => {
    if (r.ok && r.status !== 'in_review') {
      const msg = { approved: 'Заявка одобрена. Активируйте кабинет подпиской, чтобы принимать заказы.', rejected: `Заявка отклонена: ${clean(note, 200)}`,
        needs_info: `Нужны дополнительные сведения: ${clean(note, 200)}`, suspended: `Доступ приостановлен: ${clean(note, 200)}`,
        blocked: `Доступ закрыт: ${clean(note, 200)}` }[r.status] ?? 'Статус заявки изменён.';
      await notifyGo(r.profileId, 'application', 'Заявка исполнителя', msg, id);
    }
    return r;
  });
};

export const executorStatus = async (profileId, role) => {
  const { rows } = await query('SELECT id, status, city, legal_form, data_enc FROM go_executors WHERE profile_id = $1 AND role = $2', [profileId, role]);
  return rows[0] ?? null;
};
