/**
 * Видеообзор объекта и его проверка администрацией.
 *
 * Зачем он нужен. Общий склад обязан быть устроен по регламенту:
 * зонирование, нумерованные места, запираемые ячейки с ключами. Ни одно
 * из этих требований нельзя проверить по анкете — заполнить её можно
 * сидя дома. Поэтому владелец снимает помещение на видео, а решение
 * принимает человек из администрации.
 *
 * Сделано «обзор объекта», а не «обзор склада», намеренно: тот же обзор
 * понадобится пункту выдачи, и вторая такая же таблица означала бы
 * вторую очередь модерации и второй набор ошибок в ней. Владельца
 * объекта опознаёт `ownerOf` — единственное место, которое придётся
 * дополнить, когда дойдёт до ПВЗ.
 *
 * Что здесь важно по части доступа:
 *
 *   — снимать и загружать вправе только владелец объекта;
 *   — смотреть — владелец и администрация, больше никто: на записи
 *     видно чужой товар, замки и расположение камер;
 *   — решать — только администрация, и состояние обзора клиент не
 *     присылает никогда, даже своё собственное.
 */
import { query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { logLogi } from './logistics.mjs';
import { remove as removeVideo, sizeOf } from './videostore.mjs';

export const VIDEO_ID_RE = /^lvr-[0-9a-f-]{36}$/;
export const SUBJECT_KINDS = ['warehouse', 'pickup_point'];

/** Полгигабайта: обзор помещения — это несколько минут, а не фильм. */
export const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

const MAX_REASON = 500;

/**
 * Кто владеет объектом.
 *
 * Возвращает идентификатор владельца или null, если объекта нет. Ни
 * роли, ни прав здесь не выдаётся: право решает тот, кто спрашивает.
 */
const ownerOf = async (kind, subjectId) => {
  if (kind === 'warehouse') {
    const { rows } = await query(
      'SELECT seller_id FROM logi_warehouses WHERE id = $1', [String(subjectId ?? '')]);
    return rows[0]?.seller_id ?? null;
  }
  /* Пункт выдачи получит здесь свою строку, когда до него дойдёт
     очередь. Пока такого объекта нет, и обзор к нему не привяжешь. */
  return null;
};

const toReview = (row, { own = false } = {}) => ({
  id: row.id,
  subjectKind: row.subject_kind,
  subjectId: row.subject_id,
  status: row.status,
  bytes: Number(row.bytes ?? 0),
  /* Причину отказа владелец видеть обязан: иначе он снимет то же самое
     второй раз и получит второй отказ. */
  rejectReason: row.reject_reason ?? '',
  reviewedAt: row.reviewed_at?.toISOString?.() ?? null,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
  /* Кто именно из администрации решил — видно только администрации:
     арендодателю незачем знать, с кем разговаривать лично. */
  reviewerId: own ? undefined : (row.reviewer_id ?? null),
  uploaderId: own ? undefined : row.uploader_id,
});

/**
 * Завести обзор под загрузку.
 *
 * Строка появляется до файла — иначе некуда записать, чей это файл и
 * какого он типа. Загрузка, оборвавшаяся после этого, оставит строку без
 * файла: она видна владельцу как незавершённая и заменяется следующей
 * попыткой.
 */
export const startReview = async (kind, subjectId, actorId, mime) => {
  if (!SUBJECT_KINDS.includes(String(kind))) return { error: 'bad_subject' };
  const owner = await ownerOf(kind, subjectId);
  if (!owner) return { error: 'not_found' };
  if (owner !== actorId) {
    await logLogi(actorId, 'video_denied', String(subjectId));
    return { error: 'not_found' };
  }

  /* Пока прошлый обзор на проверке, второй не заводится: очередь
     администрации иначе забивается дублями одного объекта. Отклонённый
     или одобренный не мешает — сняли заново, значит сняли заново. */
  const { rows: pending } = await query(
    `SELECT id FROM logi_video_reviews
      WHERE subject_kind = $1 AND subject_id = $2 AND status = 'pending'`,
    [kind, String(subjectId)]);
  if (pending[0]) return { error: 'review_pending' };

  const id = `lvr-${generateId()}`;
  await query(
    `INSERT INTO logi_video_reviews (id, subject_kind, subject_id, uploader_id, mime)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, kind, String(subjectId), actorId, String(mime)]);
  return { id };
};

/** Отметить, сколько байт легло на диск. Размер считает сервер. */
export const finishReview = async (reviewId, bytes) => {
  await query('UPDATE logi_video_reviews SET bytes = $2 WHERE id = $1',
    [reviewId, Math.max(0, Math.round(Number(bytes) || 0))]);
};

/** Убрать незавершённый обзор: загрузка оборвалась, смотреть нечего. */
export const dropReview = async (reviewId) => {
  await query('DELETE FROM logi_video_reviews WHERE id = $1', [String(reviewId ?? '')]);
  await removeVideo(reviewId).catch(() => {});
};

/**
 * Последний обзор объекта — владельцу и администрации.
 *
 * Постороннему возвращается null, и объект для него неотличим от того,
 * у которого обзора нет вовсе.
 */
export const latestReview = async (kind, subjectId, viewerId) => {
  if (!SUBJECT_KINDS.includes(String(kind))) return null;
  const owner = await ownerOf(kind, subjectId);
  if (!owner) return null;
  const own = owner === viewerId;
  if (!own && !(await can(viewerId, 'logistics'))) return null;

  const { rows } = await query(
    `SELECT * FROM logi_video_reviews
      WHERE subject_kind = $1 AND subject_id = $2
      ORDER BY created_at DESC LIMIT 1`, [kind, String(subjectId)]);
  return rows[0] ? toReview(rows[0], { own }) : null;
};

/**
 * Право смотреть саму запись.
 *
 * Возвращает тип файла или null. Вызывается до открытия файла на диске:
 * отказ здесь означает, что поток не начнётся вовсе.
 */
export const videoAccess = async (reviewId, viewerId) => {
  if (!VIDEO_ID_RE.test(String(reviewId ?? ''))) return null;
  const { rows } = await query(
    'SELECT * FROM logi_video_reviews WHERE id = $1', [reviewId]);
  const row = rows[0];
  if (!row) return null;
  const owner = await ownerOf(row.subject_kind, row.subject_id);
  if (owner !== viewerId && !(await can(viewerId, 'logistics'))) {
    await logLogi(viewerId, 'video_watch_denied', reviewId);
    return null;
  }
  return { mime: row.mime, bytes: Number(row.bytes ?? 0) };
};

/** Есть ли у объекта одобренный обзор. Отсюда и открывается общий склад. */
export const hasApprovedReview = async (kind, subjectId) => {
  const { rows } = await query(
    `SELECT 1 FROM logi_video_reviews
      WHERE subject_kind = $1 AND subject_id = $2 AND status = 'approved' LIMIT 1`,
    [String(kind ?? ''), String(subjectId ?? '')]);
  return rows.length > 0;
};

/* ─── Очередь администрации ────────────────────────────────────────── */

/**
 * Что ждёт решения.
 *
 * Заголовок объекта подтягивается здесь же: без названия и города
 * очередь — это список одинаковых строк, и решать по ним нельзя.
 */
export const pendingReviews = async (actorId, { limit } = {}) => {
  if (!(await can(actorId, 'logistics'))) return null;
  const n = Math.min(100, Math.max(1, Number(limit) || 50));
  const { rows } = await query(
    `SELECT r.*, w.name AS wh_name, w.city_id AS wh_city
       FROM logi_video_reviews r
       LEFT JOIN logi_warehouses w
         ON r.subject_kind = 'warehouse' AND w.id = r.subject_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at
      LIMIT $1`, [n]);
  return rows.map((r) => ({
    ...toReview(r),
    subjectTitle: r.wh_name ?? '',
    subjectCity: r.wh_city ?? '',
  }));
};

/**
 * Решение администрации.
 *
 * Переход пишется условием самого UPDATE, а не проверкой перед ним: из
 * двух одновременных решений по одному обзору должно срабатывать ровно
 * одно, и второй сотрудник должен увидеть отказ, а не переписать чужой
 * вердикт.
 *
 * Одобрение обзора само по себе общий склад не включает — оно только
 * снимает запрет. Включает владелец, и только приняв регламент.
 */
export const decideReview = async (reviewId, actorId, approve, reason = '') => {
  if (!(await can(actorId, 'logistics'))) return { error: 'not_allowed' };
  if (!VIDEO_ID_RE.test(String(reviewId ?? ''))) return { error: 'not_found' };

  const next = approve ? 'approved' : 'rejected';
  const why = approve ? '' : String(reason ?? '').slice(0, MAX_REASON);
  if (!approve && !why.trim()) return { error: 'reason_required' };

  const { rows } = await query(
    `UPDATE logi_video_reviews
        SET status = $2, reviewer_id = $3, reviewed_at = now(), reject_reason = $4
      WHERE id = $1 AND status = 'pending'
      RETURNING *`, [reviewId, next, actorId, why]);
  if (!rows[0]) return { error: 'already_decided' };

  const row = rows[0];
  /* Отказ гасит заявку склада: иначе она осталась бы висеть «на
     проверке» при отклонённом обзоре, и владелец ждал бы решения,
     которое уже принято. */
  if (row.subject_kind === 'warehouse') {
    await query(
      `UPDATE logi_warehouses SET shared_state = $2, updated_at = now()
        WHERE id = $1 AND shared_state = 'review'`,
      [row.subject_id, approve ? 'review' : 'rejected']);
  }
  await logLogi(actorId, approve ? 'video_approved' : 'video_rejected', reviewId);
  return { review: toReview(row) };
};

/** Идентификаторы файлов, у которых есть строка. Нужно уборке. */
export const liveVideoIds = async () => {
  const { rows } = await query('SELECT id FROM logi_video_reviews');
  return new Set(rows.map((r) => r.id));
};

export { sizeOf as videoSize };
