/**
 * Проверка личности для допуска к работе курьером: возраст (16+) и
 * паспорт.
 *
 * Возраст в проекте раньше не считал никто — ни одна дата рождения
 * нигде не хранилась. Здесь она появляется впервые, и здесь же решается
 * раз и навсегда: возраст всегда считает сервер по date_of_birth, и
 * клиентскому числу возраста не доверяет ни одна функция проекта.
 *
 * Проверка паспорта устроена так же, как видеообзор помещения
 * (server/videoreview.mjs, миграция 047): одна заявка — один открытый
 * статус, скан хранится зашифрованным (server/crypto.mjs::encryptBytes,
 * тот же приём, что и вложения чата — server/attachments.mjs), решение
 * принимает администратор с правом 'logistics' простой проверкой
 * can(), а не через два ключа: это модерация, а не выдача денег или
 * админских прав — ровно то же разделение, что и у decideMonetization/
 * decideReview в остальном проекте.
 *
 * Скан документа никогда не отдаётся по открытой ссылке — только этим
 * же модулем, только тому, у кого есть право 'logistics', и каждый
 * такой просмотр остаётся в logi_log.
 */
import { query } from './db.mjs';
import { generateId } from './security.mjs';
import { encryptContent, decryptContent, encryptBytes, decryptBytes } from './crypto.mjs';
import { can } from './admin.mjs';
import { marketText as text } from './market.mjs';

const MIN_COURIER_AGE = 16;
const MAX_NAME = 120;

/**
 * Тот же журнал логистики (logi_log), что и в logistics.mjs — не
 * импортирован оттуда, чтобы два модуля не держали друг друга
 * (logistics.mjs, в свою очередь, зовёт функции возраста/проверки
 * отсюда при допуске курьера к работе).
 */
const logLogi = async (actorId, action, subject, detail = {}) => {
  try {
    await query(
      `INSERT INTO logi_log (actor_id, action, subject, detail) VALUES ($1,$2,$3,$4::jsonb)`,
      [actorId ?? null, text(action, 64), subject ? text(subject, 128) : null, JSON.stringify(detail ?? {})]);
  } catch { /* журнал не должен ронять то, что он описывает */ }
};

/* ─── Возраст ─────────────────────────────────────────────────────── */

/** Чистая функция: возраст на сегодня по дате рождения. Ничего не читает и не пишет. */
export const ageFromDob = (dob) => {
  const d = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - d.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
};

/** Возраст профиля прямо сейчас, с сервера. Нет даты рождения — нет возраста. */
export const profileAge = async (profileId) => {
  const { rows } = await query('SELECT date_of_birth FROM profiles WHERE id = $1', [profileId]);
  const dob = rows[0]?.date_of_birth;
  return dob ? ageFromDob(dob) : null;
};

/**
 * Указать дату рождения. Дата в разумных пределах — не в будущем и не
 * старше 120 лет: это защита от опечатки, а не проверка документа.
 *
 * Если дата меняется у уже проверенного курьера, прежняя проверка
 * паспорта перестаёт быть верной: она была подтверждением ЭТОЙ даты, а
 * дата больше не та. Строка не удаляется — история проверки должна
 * остаться, — но её статус возвращается в pending, и до новой проверки
 * курьер не может выйти на связь (см. logistics.mjs::setCourierPresence).
 * Простой смены даты недостаточно, чтобы получить verified обратно:
 * решение всё равно снова принимает администратор.
 */
export const setDateOfBirth = async (profileId, dobInput) => {
  const raw = String(dobInput ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return { error: 'bad_date' };
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { error: 'bad_date' };
  const now = new Date();
  if (d.getTime() > now.getTime()) return { error: 'bad_date' };
  const age = ageFromDob(d);
  if (age === null || age > 120) return { error: 'bad_date' };

  await query('UPDATE profiles SET date_of_birth = $2 WHERE id = $1', [profileId, raw]);

  const { rows } = await query(
    `UPDATE courier_verifications SET status = 'pending', reviewer_id = NULL, reviewed_at = NULL,
            reject_reason = 'Дата рождения изменена — требуется повторная проверка', updated_at = now()
      WHERE profile_id = $1 AND status = 'verified' RETURNING id`,
    [profileId]);
  if (rows[0]) await logLogi(profileId, 'courier_dob_changed_reverify', rows[0].id);

  return { ok: true, age };
};

/* ─── Заявка на проверку паспорта ───────────────────────────────────── */

const toVerification = (row) => ({
  id: row.id,
  profileId: row.profile_id,
  status: row.status,
  rejectReason: row.reject_reason ?? undefined,
  reviewedAt: row.reviewed_at?.toISOString?.() ?? undefined,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
  updatedAt: row.updated_at?.toISOString?.() ?? undefined,
  hasDoc: Boolean(row.has_doc),
});

/** Моя последняя проверка — для экрана заявки курьера. */
export const myVerification = async (profileId) => {
  const { rows } = await query(
    `SELECT v.*, EXISTS (SELECT 1 FROM courier_verification_docs d WHERE d.verification_id = v.id) AS has_doc
       FROM courier_verifications v WHERE v.profile_id = $1
      ORDER BY v.created_at DESC LIMIT 1`, [profileId]);
  return rows[0] ? toVerification(rows[0]) : null;
};

/**
 * Подать заявку на проверку паспорта. Дата рождения должна быть уже
 * указана — иначе от чего вообще проверять возраст. Одна открытая
 * заявка на человека — вторая, пока первая не решена, отклоняется
 * partial-уникальным индексом.
 */
export const submitVerification = async (profileId, { fullName } = {}) => {
  const age = await profileAge(profileId);
  if (age === null) return { error: 'no_birth_date' };
  if (age < MIN_COURIER_AGE) return { error: 'underage' };

  const id = `cvr-${generateId()}`;
  const name = text(fullName, MAX_NAME);
  try {
    await query(
      `INSERT INTO courier_verifications (id, profile_id, full_name_enc, operation_id)
       VALUES ($1,$2,$3,$4)`,
      [id, profileId, name ? encryptContent(name) : null, `cvr-op-${generateId()}`]);
  } catch (err) {
    if (err.code === '23505') return { error: 'already_pending' };
    throw err;
  }
  await logLogi(profileId, 'courier_verification_submitted', id);
  return { verification: await myVerification(profileId) };
};

/* ─── Скан документа ─────────────────────────────────────────────────── */

export const MAX_DOC_BYTES = 8 * 1024 * 1024;

const DOC_SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

/** Тип по первым байтам. Документы чувствительны: неопознанное отклоняется, а не сохраняется «как есть». */
export const sniffDoc = (buf) => {
  if (!buf || buf.length < 16) return null;
  for (const s of DOC_SIGNATURES) {
    try { if (s.test(buf)) return s.mime; } catch { /* короткий буфер */ }
  }
  return null;
};

/**
 * Приложить скан к своей открытой заявке. Только к своей и только
 * пока она pending: подменить скан у уже решённой заявки нельзя, а
 * дозагрузить — можно (последний вызов побеждает, вложений немного,
 * так что версии не нужны).
 */
export const attachVerificationDoc = async (verificationId, profileId, bytes, declaredMime) => {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return { error: 'empty_file' };
  if (bytes.length > MAX_DOC_BYTES) return { error: 'too_large' };
  const mime = sniffDoc(bytes);
  if (!mime) return { error: 'unsupported_media' };
  void declaredMime; // Content-Type клиента не участвует в решении — только байты.

  const { rows } = await query(
    `SELECT id FROM courier_verifications WHERE id = $1 AND profile_id = $2 AND status = 'pending'`,
    [String(verificationId ?? ''), profileId]);
  if (!rows[0]) return { error: 'not_found' };

  await query('DELETE FROM courier_verification_docs WHERE verification_id = $1', [verificationId]);
  await query(
    `INSERT INTO courier_verification_docs (id, verification_id, mime, bytes, data)
     VALUES ($1,$2,$3,$4,$5)`,
    [`cvd-${generateId()}`, verificationId, mime, bytes.length, encryptBytes(bytes)]);
  await logLogi(profileId, 'courier_doc_uploaded', verificationId);
  return { ok: true, mime, bytes: bytes.length };
};

/**
 * Отдать скан администратору. Право проверяется здесь же, а не только
 * на уровне ручки: этот модуль — последняя линия перед байтами
 * документа. Каждый просмотр остаётся в logi_log.
 */
export const verificationDocBytes = async (verificationId, adminId) => {
  if (!(await can(adminId, 'logistics'))) return null;
  const { rows } = await query(
    `SELECT d.mime, d.data FROM courier_verification_docs d
       JOIN courier_verifications v ON v.id = d.verification_id
      WHERE v.id = $1`, [String(verificationId ?? '')]);
  if (!rows[0]) return null;
  const data = decryptBytes(rows[0].data);
  if (!data) return null;
  await logLogi(adminId, 'courier_doc_viewed', verificationId);
  return { mime: rows[0].mime, data };
};

/* ─── Решение администратора ─────────────────────────────────────────── */

/**
 * Одобрить/отклонить проверку паспорта.
 *
 * Простое право 'logistics' — как и у любой другой модерации в проекте
 * (decideReview, decideMonetization, moderateEvent): это не выдача
 * денег и не админских прав, чтобы требовать второй ключ.
 *
 * На одобрении возраст пересчитывается заново, а не берётся из заявки:
 * если человек ждал решения полгода и за это время что-то изменилось
 * в дате рождения (см. setDateOfBirth), администратор не должен
 * одобрить то, что уже не соответствует условию.
 */
export const decideVerification = async (verificationId, adminId, approve, reason = '') => {
  if (!(await can(adminId, 'logistics'))) return { error: 'not_allowed' };
  const id = String(verificationId ?? '');

  const { rows: cur } = await query(
    `SELECT * FROM courier_verifications WHERE id = $1 AND status = 'pending'`, [id]);
  const row = cur[0];
  if (!row) return { error: 'not_found' };

  if (approve) {
    const age = await profileAge(row.profile_id);
    if (age === null || age < MIN_COURIER_AGE) {
      return { error: 'underage' };
    }
    const { rows: hasDoc } = await query(
      'SELECT 1 FROM courier_verification_docs WHERE verification_id = $1', [id]);
    if (!hasDoc[0]) return { error: 'no_document' };
  }
  const status = approve ? 'verified' : 'rejected';
  const rejectReason = approve ? null : text(reason, 300) || 'Отклонено';

  const { rows: upd } = await query(
    `UPDATE courier_verifications
        SET status = $2, reviewer_id = $3, reviewed_at = now(), reject_reason = $4, updated_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, status, adminId, rejectReason]);
  if (!upd[0]) return { error: 'not_found' };

  await logLogi(adminId, approve ? 'courier_verification_approved' : 'courier_verification_rejected', id);
  return { verification: toVerification(upd[0]) };
};

/** Очередь на проверку для админ-панели. */
export const verificationQueue = async (adminId, { limit } = {}) => {
  if (!(await can(adminId, 'logistics'))) return null;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await query(
    `SELECT v.*, p.name AS profile_name, p.username, p.date_of_birth,
            EXISTS (SELECT 1 FROM courier_verification_docs d WHERE d.verification_id = v.id) AS has_doc
       FROM courier_verifications v JOIN profiles p ON p.id = v.profile_id
      WHERE v.status = 'pending'
      ORDER BY v.created_at ASC LIMIT $1`, [lim]);
  return rows.map((r) => ({
    ...toVerification(r),
    profileName: r.profile_name,
    username: r.username,
    age: r.date_of_birth ? ageFromDob(r.date_of_birth) : null,
    fullName: r.full_name_enc ? (decryptContent(r.full_name_enc) ?? '') : '',
  }));
};

export { MIN_COURIER_AGE };
