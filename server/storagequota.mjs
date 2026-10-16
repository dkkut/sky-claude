/**
 * Sky Personal Storage: квота на личную коллекцию.
 *
 * Квота — одна на весь Sky ID, и считается по кино и музыке вместе:
 * сумма bytes всех private-записей в film_movies и music_tracks этого
 * владельца. Публикация не считается личным хранилищем: опубликованный
 * фильм или трек занимает место в общем каталоге, а не в чьей-то
 * персональной квоте — иначе отправка на проверку и публикация стали бы
 * способом освободить место, не удаляя файл, что обманывает смысл
 * ограничения.
 *
 * Гонка при одновременной загрузке двух больших файлов закрыта не
 * блокировкой на время всей передачи (стрим фильма идёт минутами, и
 * держать транзакцию открытой столько — само по себе дыра), а
 * резервированием: вызывающий сразу после создания записи ставит ей
 * заявленный (или предельный, если размер неизвестен наперёд) размер,
 * и только потом начинает писать файл на диск. Второй одновременный
 * запрос увидит эту резервацию в сумме и либо откажет, либо тоже
 * зарезервирует то, что реально осталось. Реальный размер подставляется
 * по факту записи и может быть только меньше резерва — saveStream сам
 * обрывает поток по achieved-пределу одного файла раньше, чем резерв
 * мог бы быть превышен.
 */
import { query } from './db.mjs';
import { hasPrime } from './skyid.mjs';
import { removeMovieFiles } from './filmstore.mjs';
import { remove as removeTrackFile } from './musicstore.mjs';

export const QUOTA_FREE_BYTES  = 5  * 1024 * 1024 * 1024;
export const QUOTA_PRIME_BYTES = 10 * 1024 * 1024 * 1024;

/** Сколько дней личный файл может не открываться владельцем, прежде чем попасть в уборку. */
/**
 * 0 — автоматическую уборку личных файлов выключить совсем (файлы лежат,
 * пока их не удалит владелец; место ограничено квотой). По умолчанию 20 —
 * как в исходном задании; владелец сервиса переключает переменной
 * PERSONAL_RETENTION_DAYS. Уборка стирает файл безвозвратно, поэтому
 * человек обязан видеть срок и иметь кнопку «хранить всегда» (retentionOf).
 */
const rawDays = Number(process.env.PERSONAL_RETENTION_DAYS ?? 0);
export const RETENTION_DAYS = Number.isFinite(rawDays) && rawDays >= 0 ? Math.floor(rawDays) : 0;

/** Что показать владельцу о судьбе личного файла: защита и дата уборки. */
export const retentionOf = (row) => {
  if (row.own !== true || row.status !== 'private') return {};
  if (RETENTION_DAYS === 0 || row.retention_keep === true) return { retentionKeep: row.retention_keep === true };
  const last = row.owner_last_used_at ? new Date(row.owner_last_used_at).getTime() : Date.now();
  return { retentionKeep: false, expiresAt: new Date(last + RETENTION_DAYS * 86_400_000).toISOString() };
};

export const quotaBytesFor = async (userId) => (
  (await hasPrime(userId)) ? QUOTA_PRIME_BYTES : QUOTA_FREE_BYTES
);

/** Сколько уже занято личной коллекцией — кино и музыка, только private. */
export const usedBytesFor = async (userId) => {
  const { rows } = await query(
    `SELECT
         coalesce((SELECT sum(bytes) FROM film_movies  WHERE owner_id = $1 AND status = 'private'), 0)
       + coalesce((SELECT sum(bytes) FROM music_tracks WHERE owner_id = $1 AND status = 'private'), 0)
       AS used`,
    [String(userId)],
  );
  return Number(rows[0]?.used ?? 0);
};

/**
 * Хватит ли места под incomingBytes сверх уже занятого.
 * Возвращает { ok, quota, used } — используется и для отказа, и для
 * показа остатка места на экране.
 */
export const checkQuota = async (userId, incomingBytes) => {
  const [quota, used] = await Promise.all([quotaBytesFor(userId), usedBytesFor(userId)]);
  const extra = Math.max(0, Number(incomingBytes) || 0);
  return { ok: used + extra <= quota, quota, used };
};

/**
 * Отмечает, что ВЛАДЕЛЕЦ открывал свой личный файл — продлевает ему
 * жизнь на следующие RETENTION_DAYS. Условие в самом UPDATE (status и
 * owner_id), а не отдельной проверкой: чужой или опубликованный файл
 * эта функция не трогает, даже если ей передать не тот movieId.
 */
export const touchOwnerUsage = async (kind, fileId, viewerId) => {
  const table = kind === 'track' ? 'music_tracks' : 'film_movies';
  await query(
    `UPDATE ${table} SET owner_last_used_at = now()
      WHERE id = $1 AND owner_id = $2 AND status = 'private'`,
    [String(fileId ?? ''), String(viewerId ?? '')],
  );
};

/** Владелец защищает личный файл от автоматической уборки, или снимает защиту. */
export const setRetentionKeep = async (kind, fileId, ownerId, keep) => {
  const table = kind === 'track' ? 'music_tracks' : 'film_movies';
  const { rowCount } = await query(
    `UPDATE ${table} SET retention_keep = $3 WHERE id = $1 AND owner_id = $2 AND status = 'private'`,
    [String(fileId ?? ''), String(ownerId ?? ''), keep === true],
  );
  return rowCount > 0;
};

/**
 * Уборка личных файлов, которыми владелец не пользовался
 * RETENTION_DAYS дней — не защищённых setRetentionKeep и не занятых
 * прямо сейчас живой комнатой «Вместе» (§8/§57 брифа: активный просмотр
 * важнее срока давности, а общий просмотр гостем не продлевает этот
 * срок сам по себе — продлевает только открытие владельцем, через
 * touchOwnerUsage выше).
 *
 * Для музыки проверяется и прямое использование (content_kind='track'),
 * и присутствие в очереди альбома/плейлиста живой listen-сессии — там
 * content_id указывает не на трек, а на альбом/плейлist, и трек виден
 * только через JSONB-очередь сессии.
 */
export const sweepUnusedPersonalFiles = async () => {
  if (RETENTION_DAYS === 0) return { films: 0, tracks: 0 };
  const { rows: films } = await query(
    `DELETE FROM film_movies m
      WHERE status = 'private' AND retention_keep = FALSE
        AND owner_last_used_at < now() - (${RETENTION_DAYS} || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM together_sessions s
           WHERE s.status = 'live' AND s.content_kind = 'movie' AND s.content_id = m.id
        )
      RETURNING id`);
  for (const r of films) await removeMovieFiles(r.id).catch(() => {});

  const { rows: tracks } = await query(
    `DELETE FROM music_tracks t
      WHERE status = 'private' AND retention_keep = FALSE
        AND owner_last_used_at < now() - (${RETENTION_DAYS} || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM together_sessions s
           WHERE s.status = 'live' AND (
                   (s.content_kind = 'track' AND s.content_id = t.id)
                OR (s.session_type = 'listen' AND EXISTS (
                      SELECT 1 FROM jsonb_array_elements(s.queue) elem WHERE elem->>'id' = t.id
                    ))
                 )
        )
      RETURNING id`);
  for (const r of tracks) {
    await removeTrackFile(r.id).catch(() => {});
    await removeTrackFile(`cov-${r.id.slice(4)}`).catch(() => {});
  }

  if (films.length || tracks.length) {
    console.log(`[personal storage] уборка неиспользуемого: кино ${films.length}, музыка ${tracks.length}`);
  }
  return { films: films.length, tracks: tracks.length };
};
