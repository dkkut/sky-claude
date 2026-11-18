/**
 * Правила Sky Business (ноябрь-2026): общие правила, требования к организациям и продавцам, правила пунктов выдачи и складов, использование бренда Sky.
 * Работает поверх существующих организаций (kb_businesses, продавцы Market, пункты выдачи, склады) — своей системы организаций не вводит.
 *  • каждый раздел — редакции (версии): черновик → публикация; опубликованная версия одна, прежняя уходит в архив; история хранится всегда;
 *  • при публикации организациям приходит уведомление; владелец организации подтверждает ознакомление с КОНКРЕТНОЙ версией (кто и когда) — новая версия требует нового подтверждения;
 *  • создаёт, правит и публикует сотрудник с правом `business_rules`; читать опубликованное может любой вошедший.
 * Начальный текст — шаблон Sky (продуктовая политика, не юридическое заключение): он лежит ЧЕРНОВИКОМ и людям не виден, пока администрация его не опубликует.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';

export const SECTIONS = {
  general: 'Общие правила',
  organizations: 'Требования к организациям',
  sellers: 'Требования к продавцам',
  pvz: 'Правила пунктов выдачи',
  warehouses: 'Правила складов',
  brand: 'Использование бренда Sky',
};
const NOTE = {
  general: 'Опубликована новая редакция: «Общие правила». Ознакомьтесь и подтвердите в разделе «Правила».',
  organizations: 'Опубликована новая редакция: «Требования к организациям». Ознакомьтесь и подтвердите в разделе «Правила».',
  sellers: 'Опубликована новая редакция: «Требования к продавцам». Ознакомьтесь и подтвердите в разделе «Правила».',
  pvz: 'Опубликована новая редакция: «Правила пунктов выдачи». Ознакомьтесь и подтвердите в разделе «Правила».',
  warehouses: 'Опубликована новая редакция: «Правила складов». Ознакомьтесь и подтвердите в разделе «Правила».',
  brand: 'Опубликована новая редакция: «Использование бренда Sky». Ознакомьтесь и подтвердите в разделе «Правила».',
};
const SEED = {
  general: `1. Организация действует от своего имени и отвечает за достоверность сведений о себе, товарах, ценах и условиях.\n2. Запрещены обман покупателей, обход правил Sky, подмена цен и условий после оформления заказа, продажа запрещённых к обороту товаров.\n3. Оплата идёт напрямую между сторонами: Sky не принимает деньги за товары и не гарантирует платёж, если сделка оформлена не через Sky Garant.\n4. Организация отвечает на обращения покупателей и Sky в разумный срок, не позднее трёх рабочих дней.\n5. Нарушения рассматриваются администрацией: возможны предупреждение, снятие карточек, приостановка и закрытие доступа. Решение сообщается с причиной, его можно обжаловать.`,
  organizations: `1. Организация указывает правовую форму и контактные данные; сведения проверяются администрацией вручную, подключения к государственным реестрам нет.\n2. Владелец организации один; сотрудники получают только нужные им роли (администратор, менеджер, кассир, контролёр).\n3. Реквизиты для оплаты принадлежат организации; смена реквизитов подтверждается кодом из приложения-аутентификатора.\n4. Организация следит за действующей подпиской: без неё публичные страницы и приём новых заявок закрыты, данные сохраняются.\n5. Организация знакомится с правилами при каждой новой редакции и подтверждает ознакомление в разделе «Правила».`,
  sellers: `1. Карточка товара содержит честное название, описание, фотографии именно этого товара и цену, которую увидит покупатель.\n2. Нельзя размещать товары, продажа которых запрещена или требует разрешений, которых нет: оружие, лекарства, алкоголь, табак, документы, животные.\n3. Продавец передаёт товар в срок, указанный в заказе, и сообщает номер отправления.\n4. Возврат и обмен — по закону и условиям карточки; споры решает администрация по материалам обеих сторон.\n5. Продавец не просит у покупателей PIN-коды, пароли и коды из СМС.`,
  pvz: `Знак и вход.\n1. На фасаде или у входа размещается логотип Sky и название пункта выдачи. Знак виден с улицы: с расстояния не менее 20 метров читается название и логотип.\n2. Логотип на вывеске — не ниже 25 см по высоте. Вокруг логотипа свободное поле не меньше высоты облачка Sky; поверх логотипа ничего не печатается.\n3. Контраст: светлый логотип на тёмном фоне или тёмный на светлом; нельзя размещать на пёстром фоне и под бликующим стеклом.\n4. Вход оформляется так, чтобы пункт находили без подсказки: вывеска у двери, указатель при входе со двора, время работы на двери.\n5. Вывеска чистая, без повреждений и выцветания; повреждённый знак заменяется в течение 14 дней.\n\nРабота пункта.\n6. Заказы выдаются по коду получателя; без кода и подтверждения личности выдача невозможна.\n7. Посылки хранятся в ячейках, доступ к ним только у сотрудников пункта; время работы и закрытия отражаются в приложении.\n8. Пункт не вскрывает посылки; о повреждениях сообщает в приложении и фотографирует состояние при приёме.`,
  warehouses: `Знаки.\n1. На входах для сотрудников и приёмки размещаются небольшие логотипы Sky размером 8–12 см с названием склада.\n2. На въездах — обозначение «Склад Sky» и номер ворот; обозначения читаются водителем с расстояния не менее 15 метров.\n3. В местах приёма транспорта размещаются таблички с номерами пунктов приёма и правилами проезда.\n\nРабота склада.\n4. Приёмка и отгрузка фиксируются в приложении; расхождения оформляются актом с фотографиями.\n5. Хранение — только в отведённых зонах, опасные грузы не принимаются.\n6. Доступ посторонних на склад ограничен; сотрудники имеют только нужные роли.`,
  brand: `1. Логотип Sky используется только в одобренном виде: без искажений, перекраски и добавления эффектов. Допустимы тёмная и светлая версии.\n2. Нельзя использовать название Sky и логотип так, будто организация является частью Sky или ею одобрена: допустима фраза «работает с Sky» или «партнёр Sky» только если такой статус действительно подтверждён администрацией.\n3. Минимальный размер логотипа в печати — 8 мм по высоте, на экране — 24 пикселя.\n4. Материалы с логотипом, где требуется согласование (вывески, реклама, транспорт), присылаются администрации заранее.\n5. При нарушении использование бренда может быть ограничено.`,
};

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const rid = () => `bru-${crypto.randomUUID()}`;
const view = (r, withBody = true) => ({ id: r.id, section: r.section, version: r.version, title: r.title, ...(withBody ? { body: r.body } : {}), status: r.status, changeNote: r.change_note, publishedAt: r.published_at?.toISOString?.(), createdAt: r.created_at.toISOString(), notified: r.notified });

let seeded = false;
export const ensureSeed = async () => {
  if (seeded) return;
  for (const [key, title] of Object.entries(SECTIONS)) {
    if ((await query('SELECT 1 FROM biz_rule_revisions WHERE section = $1 LIMIT 1', [key])).rowCount) continue;
    await query(`INSERT INTO biz_rule_revisions (id, section, version, title, body, status, change_note) VALUES ($1,$2,1,$3,$4,'draft','Шаблон Sky для проверки') ON CONFLICT DO NOTHING`, [rid(), key, title, SEED[key]]);
  }
  seeded = true;
};

/** Организации: владельцы бизнесов, магазинов Market, пунктов выдачи и складов (в том числе профили, у которых организации ещё нет, не входят). */
const orgOwners = async (client = null) => {
  const q = client ? (t) => client.query(t) : (t) => query(t);
  const { rows } = await q(`SELECT DISTINCT owner_id AS id FROM kb_businesses WHERE owner_id IS NOT NULL
    UNION SELECT profile_id FROM market_sellers
    UNION SELECT owner_id FROM market_pickup_points WHERE owner_id IS NOT NULL
    UNION SELECT seller_id FROM logi_warehouses WHERE seller_id IS NOT NULL`);
  return rows.map((r) => r.id);
};
export const isOrgOwner = async (profileId) => (await orgOwners()).includes(profileId);

/* ─── Организации ─── */
export const publicRules = async (profileId) => {
  const pub = (await query(`SELECT * FROM biz_rule_revisions WHERE status = 'published'`)).rows;
  const acks = (await query('SELECT section, version FROM biz_rule_acks WHERE profile_id = $1', [profileId])).rows;
  const org = await isOrgOwner(profileId);
  return { isOrganization: org, sections: Object.entries(SECTIONS).map(([key, label]) => {
    const r = pub.find((x) => x.section === key);
    const acked = r ? acks.some((a) => a.section === key && a.version === r.version) : false;
    return { section: key, label, published: r ? view(r) : null, acknowledged: acked, needsAck: org && Boolean(r) && !acked };
  }) };
};
export const acknowledge = async (profileId, section) => {
  if (!Object.hasOwn(SECTIONS, section)) return { error: 'bad_section' };
  if (!(await isOrgOwner(profileId))) return { error: 'not_organization' };
  const r = (await query(`SELECT version FROM biz_rule_revisions WHERE section = $1 AND status = 'published'`, [section])).rows[0];
  if (!r) return { error: 'not_published' };
  const biz = (await query('SELECT id FROM kb_businesses WHERE owner_id = $1 ORDER BY created_at LIMIT 1', [profileId])).rows[0];
  await query('INSERT INTO biz_rule_acks (profile_id, section, version, business_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [profileId, section, r.version, biz?.id ?? null]);
  return { ok: true, version: r.version };
};
export const pendingCount = async (profileId) => (await publicRules(profileId)).sections.filter((s) => s.needsAck).length;

/* ─── Администрация ─── */
export const adminList = async (actorId) => {
  if (!(await can(actorId, 'business_rules'))) return { error: 'not_allowed' };
  await ensureSeed();
  const rows = (await query('SELECT * FROM biz_rule_revisions ORDER BY section, version DESC')).rows;
  const owners = (await orgOwners()).length;
  const acks = (await query(`SELECT a.section, a.version, count(*)::int AS n FROM biz_rule_acks a JOIN biz_rule_revisions r ON r.section = a.section AND r.version = a.version AND r.status = 'published' GROUP BY a.section, a.version`)).rows;
  return { organizations: owners, sections: Object.entries(SECTIONS).map(([key, label]) => {
    const mine = rows.filter((r) => r.section === key);
    const pub = mine.find((r) => r.status === 'published'); const draft = mine.find((r) => r.status === 'draft');
    return { section: key, label, published: pub ? view(pub) : null, draft: draft ? view(draft) : null, revisions: mine.length, acknowledged: acks.find((a) => a.section === key)?.n ?? 0 };
  }) };
};
export const adminSaveDraft = async (actorId, section, b = {}) => {
  if (!(await can(actorId, 'business_rules'))) return { error: 'not_allowed' };
  if (!Object.hasOwn(SECTIONS, section)) return { error: 'bad_section' };
  const title = clean(b.title, 120), body = clean(b.body, 20000), note = clean(b.changeNote, 300);
  if (title.length < 3) return { error: 'bad_title' }; if (body.length < 30) return { error: 'bad_body' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bizrules:${section}`]);
    const d = (await client.query(`SELECT id FROM biz_rule_revisions WHERE section = $1 AND status = 'draft'`, [section])).rows[0];
    let id;
    if (d) { id = d.id; await client.query('UPDATE biz_rule_revisions SET title=$2, body=$3, change_note=$4, created_by=$5 WHERE id=$1', [id, title, body, note, actorId]); }
    else {
      const v = Number((await client.query('SELECT COALESCE(max(version),0) AS v FROM biz_rule_revisions WHERE section = $1', [section])).rows[0].v) + 1;
      id = rid(); await client.query(`INSERT INTO biz_rule_revisions (id, section, version, title, body, status, change_note, created_by) VALUES ($1,$2,$3,$4,$5,'draft',$6,$7)`, [id, section, v, title, body, note, actorId]);
    }
    await client.query('COMMIT');
    await logAdmin({ actorId, targetType: 'system', type: 'biz_rules_draft', detail: `${section}` });
    return { ok: true, id };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};
/** Публикация: черновик становится действующей редакцией, прежняя — в архив (одной транзакцией); организациям уходит уведомление. */
export const adminPublish = async (actorId, section, { notify = true } = {}) => {
  if (!(await can(actorId, 'business_rules'))) return { error: 'not_allowed' };
  if (!Object.hasOwn(SECTIONS, section)) return { error: 'bad_section' };
  const client = await pool.connect(); let rev;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bizrules:${section}`]);
    const d = (await client.query(`SELECT * FROM biz_rule_revisions WHERE section = $1 AND status = 'draft' FOR UPDATE`, [section])).rows[0];
    if (!d) { await client.query('ROLLBACK'); return { error: 'no_draft' }; }
    const hasPub = (await client.query(`SELECT 1 FROM biz_rule_revisions WHERE section = $1 AND status = 'published'`, [section])).rowCount;
    if (hasPub && String(d.change_note ?? '').trim().length < 5) { await client.query('ROLLBACK'); return { error: 'change_note_required' }; }
    await client.query(`UPDATE biz_rule_revisions SET status = 'archived' WHERE section = $1 AND status = 'published'`, [section]);
    await client.query(`UPDATE biz_rule_revisions SET status = 'published', published_by = $2, published_at = now() WHERE id = $1`, [d.id, actorId]);
    await client.query('COMMIT'); rev = d;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  let sent = 0;
  if (notify) {
    for (const id of await orgOwners()) { try { await notifyGift(id, 'biz_rules', 'Обновлены правила Sky Business', NOTE[section], `${section}:${rev.version}`); sent++; } catch { /* одно уведомление не должно останавливать остальные */ } }
    await query('UPDATE biz_rule_revisions SET notified = $2 WHERE id = $1', [rev.id, sent]);
  }
  await logAdmin({ actorId, targetType: 'system', type: 'biz_rules_publish', detail: `${section} v${rev.version}; уведомлений ${sent}` });
  return { ok: true, version: rev.version, notified: sent };
};
export const adminHistory = async (actorId, section) => {
  if (!(await can(actorId, 'business_rules'))) return { error: 'not_allowed' };
  if (!Object.hasOwn(SECTIONS, section)) return { error: 'bad_section' };
  return { items: (await query(`SELECT r.*, p.username AS pub FROM biz_rule_revisions r LEFT JOIN profiles p ON p.id = r.published_by WHERE r.section = $1 ORDER BY r.version DESC`, [section])).rows.map((r) => ({ ...view(r), publishedBy: r.pub ? `@${r.pub}` : undefined })) };
};
export const adminAcks = async (actorId, section) => {
  if (!(await can(actorId, 'business_rules'))) return { error: 'not_allowed' };
  if (!Object.hasOwn(SECTIONS, section)) return { error: 'bad_section' };
  const pub = (await query(`SELECT version FROM biz_rule_revisions WHERE section = $1 AND status = 'published'`, [section])).rows[0];
  if (!pub) return { version: null, acknowledged: [], pending: 0 };
  const acks = (await query(`SELECT a.profile_id, a.acked_at, a.business_id, p.username, p.name FROM biz_rule_acks a JOIN profiles p ON p.id = a.profile_id WHERE a.section = $1 AND a.version = $2 ORDER BY a.acked_at DESC LIMIT 500`, [section, pub.version])).rows;
  const owners = await orgOwners(); const done = new Set(acks.map((a) => a.profile_id));
  return { version: pub.version, acknowledged: acks.map((a) => ({ profileId: a.profile_id, username: `@${a.username}`, name: a.name, businessId: a.business_id ?? undefined, at: a.acked_at.toISOString() })), pending: owners.filter((o) => !done.has(o)).length, organizations: owners.length };
};
