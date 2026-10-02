/**
 * Согласия с документами платформы.
 *
 * Отличается от legal.mjs намеренно. Там одно согласие на всю учётную
 * запись при регистрации Sky ID — «я прочитал правила». Здесь согласий
 * несколько, и каждое привязано к своему делу: правила продавцов
 * принимают, заводя магазин, регламент общего склада — открывая общий
 * склад. Сваливать их в одну отметку нельзя: человек, заведший магазин
 * два года назад, регламента склада в глаза не видел.
 *
 * Что записывается и почему:
 *
 *   редакция  — номер, который мы проставили сами;
 *   отпечаток — SHA-256 самого текста.
 *
 * Одной редакции мало. Номер можно забыть поднять, поправив текст, и
 * тогда запись «согласился с редакцией 2026-09-13» будет указывать на
 * документ, которого человек не читал. Отпечаток врать не умеет:
 * изменился текст — изменился отпечаток, и прежнее согласие перестаёт
 * считаться действующим само, без чьей-либо внимательности.
 *
 * Тексты лежат в docs/ единственным экземпляром — тем же, который
 * человек читает во вкладке «Информация». Второй копии для сервера нет
 * намеренно: две копии одного документа однажды разойдутся, и мы
 * запишем отпечаток не того текста, который показали.
 *
 * Время ставит сервер. Присланное клиентом время доказательством быть
 * не может: его выставляет тот, чьё согласие мы и записываем.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.mjs';

const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');

/**
 * Реестр документов, которые принимают отдельно.
 *
 * `code` уходит в базу и в запросы, `file` — на диск. Клиент присылает
 * только код и выбирает из этого списка; имя файла из запроса не
 * берётся никогда, иначе «../../etc/passwd» стало бы документом.
 */
export const DOCUMENTS = {
  seller_rules: {
    code: 'seller_rules',
    title: 'Правила продавцов',
    revision: '2026-09-13',
    file: 'ПРАВИЛА_ПРОДАВЦОВ.md',
  },
  shared_warehouse_rules: {
    code: 'shared_warehouse_rules',
    title: 'Регламент работы общедоступного склада',
    revision: '2026-09-13',
    file: 'РЕГЛАМЕНТ_ОБЩЕГО_СКЛАДА.md',
  },
  kutrent_terms: {
    code: 'kutrent_terms',
    title: 'Пользовательское соглашение KutRent Market',
    revision: '2026-10-02',
    file: 'KUTRENT_ПОЛЬЗОВАТЕЛЬСКОЕ_СОГЛАШЕНИЕ.md',
  },
  kutrent_privacy: {
    code: 'kutrent_privacy',
    title: 'Политика конфиденциальности KutRent Market',
    revision: '2026-10-02',
    file: 'KUTRENT_ПОЛИТИКА_КОНФИДЕНЦИАЛЬНОСТИ.md',
  },
};

export const DOC_CODES = Object.keys(DOCUMENTS);

/**
 * Текст и отпечаток документа.
 *
 * Считается один раз и держится в памяти: файл на диске меняется только
 * вместе с выкладкой, а хэшировать сотню килобайт на каждый запрос
 * незачем. Перезапуск подхватит новый текст и новый отпечаток — и тем
 * самым потребует согласиться заново.
 */
const cache = new Map();

export const readDocument = async (code) => {
  const doc = DOCUMENTS[String(code ?? '')];
  if (!doc) return null;
  const got = cache.get(doc.code);
  if (got) return got;

  const text = await readFile(join(DOCS_DIR, doc.file), 'utf8');
  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  const out = { code: doc.code, title: doc.title, revision: doc.revision, hash, text };
  cache.set(doc.code, out);
  return out;
};

/** Заголовок без текста — для списков и для состояния кнопки. */
export const documentMeta = async (code) => {
  const doc = await readDocument(code);
  if (!doc) return null;
  return { code: doc.code, title: doc.title, revision: doc.revision, hash: doc.hash };
};

/**
 * Записать согласие.
 *
 * Пишется поверх прежнего: при новой редакции важно, что человек принял
 * именно её, а не то, что когда-то принимал старую. Прежнее согласие при
 * этом не теряется как факт — оно остаётся в журнале действий.
 *
 * Клиент не присылает ни редакцию, ни отпечаток: он присылает только
 * код документа и намерение. Что именно записать, решает сервер по
 * тексту, который у него на диске, — иначе «согласен» можно было бы
 * подписать под чем угодно.
 */
export const acceptDocument = async (profileId, code) => {
  const doc = await readDocument(code);
  if (!doc) return { error: 'unknown_document' };
  await query(
    `INSERT INTO sky_agreements (profile_id, doc_code, revision, doc_hash)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (profile_id, doc_code) DO UPDATE
       SET revision = EXCLUDED.revision,
           doc_hash = EXCLUDED.doc_hash,
           accepted_at = now()`,
    [profileId, doc.code, doc.revision, doc.hash]);
  return { ok: true, code: doc.code, revision: doc.revision };
};

/**
 * Принял ли человек действующую редакцию.
 *
 * Сравнение идёт по отпечатку, а не по номеру редакции: см. выше.
 */
export const hasAccepted = async (profileId, code) => {
  const doc = await readDocument(code);
  if (!doc) return false;
  const { rows } = await query(
    'SELECT doc_hash FROM sky_agreements WHERE profile_id = $1 AND doc_code = $2',
    [String(profileId ?? ''), doc.code]);
  return rows[0]?.doc_hash === doc.hash;
};

/** Что человек принял и что ему ещё предстоит. Для своего же экрана. */
export const acceptanceState = async (profileId) => {
  const { rows } = await query(
    'SELECT doc_code, revision, doc_hash, accepted_at FROM sky_agreements WHERE profile_id = $1',
    [String(profileId ?? '')]);
  const mine = new Map(rows.map((r) => [r.doc_code, r]));
  const out = [];
  for (const code of DOC_CODES) {
    const doc = await readDocument(code);
    const got = mine.get(code);
    out.push({
      code,
      title: doc.title,
      revision: doc.revision,
      accepted: got?.doc_hash === doc.hash,
      /* Принимал, но с тех пор текст изменился — это не то же самое,
         что «не принимал»: человеку надо сказать, что документ новый. */
      outdated: Boolean(got) && got.doc_hash !== doc.hash,
      acceptedAt: got?.accepted_at?.toISOString?.() ?? null,
    });
  }
  return out;
};
