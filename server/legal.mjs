/**
 * Согласие с правилами, офертой и обработкой данных.
 *
 * Галочка в интерфейсе — это то, что человек видел. Запись здесь — то,
 * что мы сможем показать через год: когда согласился и **с какой
 * редакцией**. Без редакции отметка «согласился» ничего не доказывает,
 * потому что документы к тому времени будут другими.
 *
 * Время ставит сервер. Время, присланное клиентом, доказательством быть
 * не может: его выставляет тот, чьё согласие мы и записываем.
 */
import { query } from './db.mjs';

/**
 * Редакция документов. Меняется вместе с текстами в docs/ — и тогда у
 * тех, кто согласился с прошлой, будет видно, что они согласились с
 * прошлой.
 */
export const LEGAL_REVISION = '2026-09-08';

/**
 * Записать согласие. Повторное согласие поверх первого не пишем:
 * важна дата, когда человек согласился впервые, а не последний вход.
 */
export const recordAcceptance = async (skyId, revision = LEGAL_REVISION) => {
  await query(
    `UPDATE sky_ids
        SET legal_revision = $2, legal_accepted_at = now()
      WHERE id = $1 AND legal_accepted_at IS NULL`,
    [skyId, revision],
  );
};

/** С чем и когда согласился владелец Sky ID. */
export const acceptanceOf = async (skyId) => {
  const { rows } = await query(
    'SELECT legal_revision, legal_accepted_at FROM sky_ids WHERE id = $1', [skyId],
  );
  const r = rows[0];
  if (!r?.legal_accepted_at) return null;
  return { revision: r.legal_revision, acceptedAt: r.legal_accepted_at.toISOString() };
};
