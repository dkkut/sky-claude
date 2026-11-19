// Sky Вопросы через HTTP: вопросы, ответы, голоса, лучший ответ, репутация, жалобы, модерация, изоляция.
// API: OWNER_USERNAME=lifeowner ADMIN_GATE=off ADMIN_TOKEN=off EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test RATE_LIMIT_PER_MINUTE=5000
// Запуск: . env.sh; node scripts/audit/skyqa-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2]; let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const q = (s) => execSync(`psql postgres://sky:sky@localhost:5432/skytest -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const J = (o) => ({ method: 'POST', body: JSON.stringify(o) });
const a = await mkuser(S, 'QaA'); const b = await mkuser(S, 'QaB'); const c = await mkuser(S, 'QaC'); const adm = await mkuser(S, 'QaAdm');
q(`UPDATE admin_lockdown SET active = false`); q(`UPDATE profiles SET is_admin = true, admin_role = 'content_admin' WHERE id = '${adm.pid}'`);

t('без входа 401', (await call('/api/qa/questions')).status === 401);
t('короткое название — 400', (await call('/api/qa/questions', J({ title: 'мало' }), a.tok)).data.error === 'bad_title');
const mk = await call('/api/qa/questions', J({ title: 'Как лучше хранить фото в Sky Cloud?', body: 'Хочу понять, что надёжнее.', tags: ['Фото', 'cloud', 'cloud', 'плохой тег!', 'a'.repeat(40)] }), a.tok);
t('вопрос создан', mk.status === 200 && mk.data.id?.startsWith('qa-'), JSON.stringify(mk.data)); const qid = mk.data.id;
t('дубль в сутки — 409', (await call('/api/qa/questions', J({ title: 'как лучше хранить фото в sky cloud?' }), a.tok)).status === 409);
const g0 = await call(`/api/qa/questions/${qid}`, {}, b.tok);
t('вопрос виден другому, теги очищены', g0.status === 200 && g0.data.question.tags.includes('фото') && g0.data.question.tags.filter((x) => x === 'cloud').length === 1 && !g0.data.question.tags.some((x) => x.includes('!')), JSON.stringify(g0.data.question.tags));
t('в списке есть и фильтр по тегу работает', (await call('/api/qa/questions?tag=фото', {}, c.tok)).data.items.some((x) => x.id === qid) && !(await call('/api/qa/questions?tag=нет-такого', {}, c.tok)).data.items.length);
t('поиск по тексту', (await call('/api/qa/questions?q=Sky%20Cloud', {}, c.tok)).data.items.some((x) => x.id === qid) && (await call('/api/qa/questions?q=%25', {}, c.tok)).status === 200);
t('без ответов — в «без ответа»', (await call('/api/qa/questions?sort=unanswered', {}, c.tok)).data.items.some((x) => x.id === qid));
t('свой вопрос не отвечать — 403', (await call(`/api/qa/questions/${qid}/answers`, J({ body: 'Отвечу сам себе, очень умно.' }), a.tok)).data.error === 'own_question');
t('короткий ответ — 400', (await call(`/api/qa/questions/${qid}/answers`, J({ body: 'ага' }), b.tok)).data.error === 'bad_body');
const ab = await call(`/api/qa/questions/${qid}/answers`, J({ body: 'Лучше держать оригиналы в личной коллекции и делать копию.' }), b.tok); t('ответ B', ab.status === 200 && ab.data.id?.startsWith('qaa-'), JSON.stringify(ab.data));
t('второй ответ того же человека — 409', (await call(`/api/qa/questions/${qid}/answers`, J({ body: 'Ещё один ответ того же человека.' }), b.tok)).status === 409);
const ac = await call(`/api/qa/questions/${qid}/answers`, J({ body: 'Мне хватает обычного облака, оно удобное.' }), c.tok);
t('счётчик ответов = 2', (await call(`/api/qa/questions/${qid}`, {}, a.tok)).data.question.answers === 2);
t('автор получил уведомление', Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id='${a.pid}' AND kind='qa_answer'`)) === 2);
// голоса
t('за свой ответ голосовать нельзя', (await call(`/api/qa/answers/${ab.data.id}/vote`, J({ value: 1 }), b.tok)).data.error === 'own_answer');
t('плохое значение — 400', (await call(`/api/qa/answers/${ab.data.id}/vote`, J({ value: 5 }), a.tok)).status === 400);
t('голос «за» A', (await call(`/api/qa/answers/${ab.data.id}/vote`, J({ value: 1 }), a.tok)).data.score === 1);
t('повтор того же голоса не удваивает', (await call(`/api/qa/answers/${ab.data.id}/vote`, J({ value: 1 }), a.tok)).data.score === 1);
t('голос «за» C', (await call(`/api/qa/answers/${ab.data.id}/vote`, J({ value: 1 }), c.tok)).data.score === 2);
t('смена на «против» меняет на 2', (await call(`/api/qa/answers/${ab.data.id}/vote`, J({ value: -1 }), c.tok)).data.score === 0);
t('снять голос', (await call(`/api/qa/answers/${ab.data.id}/vote`, J({ value: 0 }), c.tok)).data.score === 1);
// гонка голосов: 8 разных людей одновременно
const crowd = []; for (let i = 0; i < 6; i++) crowd.push(await mkuser(S, 'QaV' + i));
await Promise.all(crowd.map((u) => call(`/api/qa/answers/${ab.data.id}/vote`, J({ value: 1 }), u.tok)));
const sc = (await call(`/api/qa/questions/${qid}`, {}, a.tok)).data.answers.find((x) => x.id === ab.data.id).score;
t('гонка голосов: итог = число голосов', sc === 7 && Number(q(`SELECT score FROM qa_answers WHERE id='${ab.data.id}'`)) === Number(q(`SELECT coalesce(sum(value),0) FROM qa_votes WHERE answer_id='${ab.data.id}'`)), String(sc));
// лучший ответ
t('чужой не отмечает лучший — 404', (await call(`/api/qa/questions/${qid}/accept`, J({ answerId: ab.data.id }), c.tok)).status === 404);
t('автор отмечает', (await call(`/api/qa/questions/${qid}/accept`, J({ answerId: ab.data.id }), a.tok)).status === 200);
const g1 = (await call(`/api/qa/questions/${qid}`, {}, c.tok)).data;
t('лучший ответ — первым, с пометкой', g1.answers[0].id === ab.data.id && g1.answers[0].best === true && g1.question.hasBest === true);
t('репутация B = очки + 10 за лучший', g1.answers[0].author.rep === 7 + 10 && (await call('/api/qa/me', {}, b.tok)).data.reputation === 17, JSON.stringify(g1.answers[0].author));
t('уведомление «лучший»', Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id='${b.pid}' AND kind='qa_best'`)) === 1);
// удаление
t('вопрос с ответами автор не удалит — 409', (await call(`/api/qa/questions/${qid}`, { method: 'DELETE' }, a.tok)).status === 409);
t('чужой ответ не удалить — 404', (await call(`/api/qa/answers/${ac.data.id}`, { method: 'DELETE' }, b.tok)).status === 404);
t('свой ответ удалить', (await call(`/api/qa/answers/${ac.data.id}`, { method: 'DELETE' }, c.tok)).status === 200 && (await call(`/api/qa/questions/${qid}`, {}, a.tok)).data.question.answers === 1);
// жалобы и модерация
t('жалоба на свой — 403', (await call('/api/qa/report', J({ kind: 'answer', id: ab.data.id, reason: 'spam' }), b.tok)).status === 403);
t('плохая причина — 400', (await call('/api/qa/report', J({ kind: 'answer', id: ab.data.id, reason: 'x' }), c.tok)).status === 400);
t('жалоба принята, повтор — 409', (await call('/api/qa/report', J({ kind: 'answer', id: ab.data.id, reason: 'spam' }), c.tok)).status === 200 && (await call('/api/qa/report', J({ kind: 'answer', id: ab.data.id, reason: 'spam' }), c.tok)).status === 409);
t('очередь жалоб — только модератору', (await call('/api/admin/qa/reports', {}, c.tok)).status === 403 && (await call('/api/admin/qa/reports', {}, adm.tok)).data.items.length >= 1);
t('человек не удаляет как админ', (await call('/api/admin/qa/remove', J({ kind: 'answer', id: ab.data.id, reason: 'очень плохой ответ' }), c.tok)).status === 403);
t('без причины — 400', (await call('/api/admin/qa/remove', J({ kind: 'answer', id: ab.data.id, reason: 'x' }), adm.tok)).status === 400);
t('модератор удаляет ответ', (await call('/api/admin/qa/remove', J({ kind: 'answer', id: ab.data.id, reason: 'нарушение правил' }), adm.tok)).status === 200);
const g2 = (await call(`/api/qa/questions/${qid}`, {}, a.tok)).data;
t('ответ пропал, счётчик и лучший сброшены', g2.answers.length === 0 && g2.question.answers === 0 && g2.question.hasBest === false);
t('репутация автора после удаления упала', (await call('/api/qa/me', {}, b.tok)).data.reputation === 0);
t('автору ответа пришло уведомление', Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id='${b.pid}' AND kind='qa_removed'`)) === 1);
t('модератор удаляет вопрос, он пропадает из списка', (await call('/api/admin/qa/remove', J({ kind: 'question', id: qid, reason: 'тестовое снятие' }), adm.tok)).status === 200 && (await call(`/api/qa/questions/${qid}`, {}, c.tok)).status === 404);
t('автор без ответов удаляет сам', await (async () => { const m2 = await call('/api/qa/questions', J({ title: 'Вопрос, который автор удалит сам' }), a.tok); return (await call(`/api/qa/questions/${m2.data.id}`, { method: 'DELETE' }, a.tok)).status === 200; })());
t('плохой id и SQL-мусор — безопасно', (await call('/api/qa/questions/x%27%3Bdrop', {}, a.tok)).status === 404 && (await call("/api/qa/questions?sort=x';drop&limit=abc&offset=-5", {}, a.tok)).status === 200);
t('подмена автора в теле игнорируется', await (async () => { const r = await call('/api/qa/questions', J({ title: 'Подмена автора не должна пройти', author_id: c.pid, authorId: c.pid }), a.tok); const g = await call(`/api/qa/questions/${r.data.id}`, {}, c.tok); return g.data.question.author.id === a.pid; })());
q(`INSERT INTO qa_questions (id, author_id, title) SELECT 'qa-bulk'||g, '${c.pid}', 'Массовый вопрос номер '||g FROM generate_series(1,10) g`);
t('предел 10 вопросов в сутки — 429', (await call('/api/qa/questions', J({ title: 'Одиннадцатый вопрос за сутки' }), c.tok)).status === 429);
console.log(`ok ${ok}, fail ${bad}`); process.exit(bad ? 1 : 0);
