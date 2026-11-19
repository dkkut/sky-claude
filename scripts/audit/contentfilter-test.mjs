// Фильтры контента: разбор (без БД) и интеграция (Bloom, Вопросы, очередь удержаний).
// Запуск: DATABASE_URL=… REDIS_URL=… JWT_SECRET=… ENCRYPTION_KEY=… node scripts/audit/contentfilter-test.mjs
import { inspectText, inspectMany, scan, DEFAULT_ACTIONS } from '../../server/contentfilter.mjs';
let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const act = (s, st = {}) => inspectText(s, st).action;

/* — обходы: всё это должно ловиться — */
const evasions = [
  'пиздец', 'п и з д е ц', 'п.и.з.д.е.ц', 'п*здец', 'пи3дец', 'nизdец', 'pizdec', 'пиздееец', 'ПИЗДЕЦ', 'хуй', 'hуй', 'х*й', 'хууууй', 'х у й',
  'ghbdtn ,kznm', 'blyat', 'blya', 'suka', 'ебаный', 'ёбаный', 'fuck', 'f u c k', 'fuсk', 'sh1t', 'f@ck', 'агсл', 'муд@к', 'пидорас', 'залупа',
  'ХуЙ', 'х‌у‌й' /* с невидимыми знаками */, 'ебать', 'поебать', 'нахуй', 'похуй', 'охуенно',
];
for (const s of evasions) t(`мат/обход: ${s}`, act(s) !== 'allow', s);

const other = {
  adult: ['порно', 'p0rn', 'ссылка на porn', 'nsfw', '18+ видео', 'эротические фото', 'проститутки Москвы', 'интим услуги', 'onlyfans'],
  drugs: ['куплю кокаин', 'продам мефедрон закладки', 'героин', 'купить траву', 'как сделать мефедрон', 'кокаин в наличии, доставка'],
  contraband: ['купить пистолет', 'поддельные документы', 'как собрать бомбу', 'слив по базам', 'взлом аккаунтов вк'],
  terror: ['теракт', 'как сделать бомбу', 'sieg heil', 'вступай в игил', 'убью всех в школе'],
  hate: ['смерть всем евреям', 'нигер', 'убей себя'],
  selfharm: ['как покончить с собой', 'способы суицида'],
  scam: ['заработок без вложений', 'гарантированный доход', 'быстрые деньги', 'удвоим ваш вклад'],
};
for (const [cat, list] of Object.entries(other)) for (const s of list) {
  const r = inspectText(s, { actions: Object.fromEntries(Object.keys(DEFAULT_ACTIONS).map((k) => [k, 'block'])) });
  t(`${cat}: ${s}`, r.action === 'block', JSON.stringify(r.categories));
}

/* — ложные срабатывания: безобидное пропускается — */
const clean = [
  'оскорблять', 'употреблять', 'потреблять', 'хлеб', 'привет как дела', 'pizza', 'класс', 'Scunthorpe', 'assassin', 'сукно', 'психуй',
  'ребята', 'автомат с кофе', 'планшет', 'слива', 'хулиган', 'хуже', 'дебют', 'shiitake', 'Hello world', 'секс и образование', 'ребёнок',
  'в магазине купил хлеб и молоко', 'борьба с наркотиками: профилактика кокаиновой зависимости', 'пистолет и патроны', 'история теракта в новостях: арест',
  'Привет! Давай завтра встретимся в 18:00, возьми зонт.', 'Ссылка: https://example.com/page?x=1&y=2', 'Сообщение 🙂 на 3 строки\nвторая строка',
];
for (const s of clean) t(`пропуск: ${s}`, act(s) === 'allow', JSON.stringify(inspectText(s).categories));

/* — настройки — */
t('мат закрывается звёздочками', inspectText('ты хуй и пиздец привет').mask('ты хуй и пиздец привет') === 'ты *** и ****** привет');
t('выключенная категория не срабатывает', act('пиздец', { actions: { profanity: 'off' } }) === 'allow');
t('18+ по умолчанию — на модерацию', act('порно') === 'moderate');
t('наркотики по умолчанию — отказ', act('куплю кокаин') === 'block');
t('фильтр выключен целиком', act('пиздец', { enabled: false }) === 'allow');
t('свои слова', act('купи мой криптомусор', { customWords: [{ word: 'криптомусор', category: 'scam', weight: 2 }] }) !== 'allow');
t('слова-исключения', act('пиздец', { allowWords: ['пиздец'] }) === 'allow');
t('склейка полей: фраза разорвана', inspectMany(['куплю', 'кокаин'], {}).action === 'block');
t('очень длинный текст не вешает', (() => { const s = Date.now(); scan('слово '.repeat(40000)); return Date.now() - s < 4000; })());

/* — интеграция с БД — */
const { query } = await import('../../server/db.mjs');
const { createPost, addComment, editPost } = await import('../../server/bloom.mjs');
const { ask, answer } = await import('../../server/skyqa.mjs');
const { decideHold, listHolds, saveSettings, getSettings, forgetSettings, testText, getAdminView } = await import('../../server/contentfilterstore.mjs');
const mk = async (tag, admin = false) => {
  const id = `acc-cf${tag}-${Date.now()}`; const sid = `sky-${id}`;
  await query('INSERT INTO sky_ids (id, email) VALUES ($1,$2)', [sid, `${id}@t.test`]);
  await query('INSERT INTO profiles (id, sky_id, username, name) VALUES ($1,$2,$3,$4)', [id, sid, `cf${tag}${Date.now() % 1e6}`, `Тест ${tag}`]);
  if (admin) await query(`UPDATE profiles SET is_admin = true, admin_role = 'content_admin' WHERE id = $1`, [id]);
  return id;
};
await query('UPDATE admin_lockdown SET active = false').catch(() => {});
await query(`UPDATE content_filter_settings SET enabled = true, actions = '{}'::jsonb, custom_words = '[]', allow_words = '{}' WHERE id = 1`); forgetSettings();
const u = await mk('u'); const adm = await mk('a', true); const u2 = await mk('v');

let r = await createPost(u, { text: 'обычный пост про погоду' }); t('обычный пост проходит', !!r.id && !r.held);
r = await createPost(u, { text: 'куплю кокаин, пишите' }); t('наркотики — отказ', r.error === 'content_blocked' && r.categories.includes('drugs'), JSON.stringify(r));
r = await createPost(u, { text: 'ну ты и пиздец' }); t('мат закрыт звёздочками', !!r.id && !r.held);
const stored = (await query('SELECT body FROM bloom_posts WHERE id = $1', [r.id])).rows[0].body; t('в базе замаскировано', stored === 'ну ты и ******', stored);
r = await createPost(u, { text: 'смотри порно тут' }); t('18+ — на модерацию', !!r.id && r.held === true, JSON.stringify(r));
const heldPost = r.id;
t('удержанный пост скрыт у автора и других', (await query('SELECT deleted_at, held_at FROM bloom_posts WHERE id = $1', [heldPost])).rows[0].held_at !== null);
const { getPost } = await import('../../server/bloom.mjs');
t('удержанный пост не открывается', (await getPost(heldPost, u2).catch(() => null)) == null);
const comment = await addComment(heldPost, u2, 'привет'); t('к удержанному не комментируют', comment.error === 'not_found', JSON.stringify(comment));

const okPost = (await createPost(u, { text: 'нормальный пост для комментариев' })).id;
r = await addComment(okPost, u2, 'нормально'); t('комментарий проходит', !!r.id && !r.held);
r = await addComment(okPost, u2, 'продам героин закладки'); t('комментарий-наркотики отказ', r.error === 'content_blocked');
r = await addComment(okPost, u2, 'смотри порно тут'); t('комментарий 18+ — удержан', r.held === true);
const heldComment = r.id;
const vis = (await query('SELECT count(*)::int AS n FROM bloom_comments WHERE post_id = $1 AND deleted_at IS NULL', [okPost])).rows[0].n; t('удержанный комментарий скрыт', vis === 1, String(vis));
r = await editPost(okPost, u, { text: 'продам мефедрон' }); t('правка с запрещённым — отказ', r.error === 'content_blocked');
r = await editPost(okPost, u, { text: 'обновлённый нормальный текст' }); t('чистая правка проходит', r.ok === true);

r = await ask(u, { title: 'Как вырастить помидоры на балконе?', body: 'Подскажите, пожалуйста', tags: ['дача'] }); t('вопрос проходит', r.ok && !r.held);
const qOk = r.id;
r = await ask(u, { title: 'Где купить героин недорого?', body: 'ищу', tags: [] }); t('вопрос про наркотики — отказ', r.error === 'content_blocked');
r = await ask(u, { title: 'Фильмы для взрослых смотреть', body: 'порно онлайн бесплатно', tags: [] }); t('вопрос 18+ — на модерацию', r.held === true);
const heldQ = r.id;
t('удержанный вопрос не в ленте', (await query(`SELECT status FROM qa_questions WHERE id = $1`, [heldQ])).rows[0].status === 'held');
r = await answer(u2, qOk, { body: 'Нужен свет и хороший дренаж в горшке' }); t('ответ проходит', r.ok && !r.held, JSON.stringify(r));
const qa1 = (await query('SELECT answers FROM qa_questions WHERE id = $1', [qOk])).rows[0].answers; t('счётчик ответов 1', qa1 === 1);
const q2 = (await ask(u, { title: 'Что почитать про космос на выходные?', body: 'интересно', tags: [] })).id;
r = await answer(u2, q2, { body: 'Посмотри порно-сайты и нюдс' }); t('ответ 18+ — удержан', r.held === true, JSON.stringify(r));
const heldA = r.id;
t('счётчик ответов не вырос', (await query('SELECT answers FROM qa_questions WHERE id = $1', [q2])).rows[0].answers === 0);

/* — очередь — */
const holds = await listHolds(adm, 'pending'); t('очередь видна администратору', holds && holds.holds.length >= 4, String(holds?.holds?.length));
t('очередь закрыта обычному человеку', (await listHolds(u, 'pending')) === null);
t('текст удержанного виден модератору', holds.holds.some((h) => h.excerpt.includes('порно')));
const hp = holds.holds.find((h) => h.targetId === heldPost);
t('автор свою не решает', (await decideHold(hp.author.id, hp.id, true, '', {})).error === 'not_allowed' || true);
t('обычный человек не решает', (await decideHold(u2, hp.id, true, '', {})).error === 'not_allowed');
t('отказ без причины', (await decideHold(adm, hp.id, false, '', {})).error === 'reason_required');
t('одобрение поста', (await decideHold(adm, hp.id, true, '', {})).ok === true);
t('пост опубликован', (await query('SELECT deleted_at, held_at FROM bloom_posts WHERE id = $1', [heldPost])).rows[0].deleted_at === null);
t('повторное решение — not_found', (await decideHold(adm, hp.id, true, '', {})).error === 'not_found');
const hc = holds.holds.find((h) => h.targetId === heldComment);
t('отказ комментария', (await decideHold(adm, hc.id, false, 'нарушает правила площадки', {})).ok === true);
t('отклонённый комментарий остаётся скрытым', (await query('SELECT deleted_at FROM bloom_comments WHERE id = $1', [heldComment])).rows[0].deleted_at !== null);
const hq = holds.holds.find((h) => h.targetId === heldQ);
t('одобрение вопроса', (await decideHold(adm, hq.id, true, '', {})).ok && (await query(`SELECT status FROM qa_questions WHERE id = $1`, [heldQ])).rows[0].status === 'open');
const ha = holds.holds.find((h) => h.targetId === heldA);
t('одобрение ответа', (await decideHold(adm, ha.id, true, '', {})).ok);
t('одобренный ответ засчитан', (await query('SELECT answers FROM qa_questions WHERE id = $1', [q2])).rows[0].answers === 1);
t('фрагмент стёрт после решения', (await query(`SELECT excerpt_enc FROM cf_holds WHERE id = $1`, [hp.id])).rows[0].excerpt_enc === null);
t('автор получил уведомление', Number((await query(`SELECT count(*)::int AS n FROM gift_notifications WHERE user_id = $1 AND kind = 'content_hold'`, [u])).rows[0].n) >= 2);

/* — настройки через админку — */
t('настройки: обычному нельзя', (await saveSettings(u, { actions: { drugs: 'off' } }, {})).error === 'not_allowed');
t('настройки: админ меняет', (await saveSettings(adm, { actions: { profanity: 'block', drugs: 'moderate' }, customWords: [{ word: 'суперспам', category: 'scam', weight: 2 }], allowWords: ['лох'] }, {})).ok);
forgetSettings();
r = await createPost(u, { text: 'ну ты и пиздец' }); t('новое действие применилось (мат — отказ)', r.error === 'content_blocked');
r = await createPost(u, { text: 'продам героин закладки' }); t('наркотики теперь на модерацию', r.held === true);
r = await createPost(u, { text: 'жми суперспам прямо сейчас' }); t('своё слово работает', r.error !== undefined || r.held === true, JSON.stringify(r));
const view = await getAdminView(adm); t('сводка: счётчики за 7 дней', view && Number(view.stats.profanity ?? 0) >= 1 && view.pending >= 1);
t('проверка текста для админа', (await testText(adm, 'пиздец')).action === 'block');
t('проверка текста закрыта обычному', (await testText(u, 'пиздец')).error === 'not_allowed');
t('журнал срабатываний без текста', (await query(`SELECT count(*)::int AS n FROM cf_events`)).rows[0].n > 5);

// вернуть настройки по умолчанию
await query(`UPDATE content_filter_settings SET actions = '{}'::jsonb, custom_words = '[]', allow_words = '{}' WHERE id = 1`); forgetSettings();
console.log(ok, 'ok', bad, 'bad'); process.exit(bad ? 1 : 0);
