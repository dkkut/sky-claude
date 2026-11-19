/**
 * Sky Вопросы — вопросы и ответы людей экосистемы (по образцу Яндекс Кью, но внутри Sky).
 *  — вопрос (название, описание, до 5 тегов), ответы (один ответ от человека на вопрос), голоса «за/против» (не за свой ответ),
 *    «лучший ответ» отмечает автор вопроса (не на свой ответ);
 *  — репутация считается на лету из настоящих данных: сумма очков видимых ответов (не ниже 0) + 10 за каждый ответ, признанный лучшим;
 *  — жалобы и удаление модерацией (право `content`, причина обязательна, журнал администрации).
 *  Всё публично внутри Sky для вошедших; личных данных кроме имени и @ника не отдаём.
 */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';

export const LIMITS = { title: [10, 200], body: 5000, answer: [10, 5000], tags: 5, tag: 24, askPerDay: 10, answerPerDay: 30, reportPerDay: 10 };
const clean = (s, n) => String(s ?? '').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim().slice(0, n);
const note = async (u, k, t, b, r) => { try { await notifyGift(u, k, t, b, r); } catch { /* не ломаем дело */ } };
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
const cleanTags = (v) => [...new Set((Array.isArray(v) ? v : []).map((t) => String(t).toLowerCase().trim().slice(0, LIMITS.tag)).filter((t) => t && TAG_RE.test(t)))].slice(0, LIMITS.tags);

const REP = `(SELECT GREATEST(0, COALESCE(SUM(a2.score), 0))::int + 10 * COALESCE((SELECT count(*) FROM qa_questions q2 JOIN qa_answers a3 ON a3.id = q2.best_answer_id WHERE a3.author_id = $REPID AND a3.status = 'visible' AND q2.status = 'open'), 0)::int
   FROM qa_answers a2 WHERE a2.author_id = $REPID AND a2.status = 'visible')`;

export const reputationOf = async (profileId) => (await query(`SELECT ${REP.replaceAll('$REPID', '$1')} AS rep`, [profileId])).rows[0]?.rep ?? 0;

const qOut = (r) => ({ id: r.id, title: r.title, body: r.body, tags: r.tags, answers: r.answers, views: r.views, createdAt: r.created_at, hasBest: Boolean(r.best_answer_id),
  mine: r.mine, author: { id: r.author_id, name: r.author_name, username: r.author_username } });

export const listQuestions = async (me, { sort = 'new', q = '', tag = '', mine = false, limit = 20, offset = 0 } = {}) => {
  const lim = Math.min(50, Math.max(1, Number(limit) || 20)), off = Math.max(0, Number(offset) || 0);
  const where = [`q.status = 'open'`]; const args = [me];
  const add = (v) => { args.push(v); return `$${args.length}`; };
  const text = clean(q, 80);
  if (text) { const p = add(`%${text.replace(/[%_\\]/g, '\\$&')}%`); where.push(`(q.title ILIKE ${p} OR q.body ILIKE ${p})`); }
  const tg = String(tag ?? '').toLowerCase().trim(); if (tg) where.push(`${add(tg)} = ANY(q.tags)`);
  if (mine) where.push(`q.author_id = $1`);
  if (sort === 'unanswered') where.push(`q.answers = 0`);
  const order = sort === 'top' ? `q.answers DESC, q.views DESC, q.created_at DESC` : `q.created_at DESC`;
  const { rows } = await query(`SELECT q.*, p.name AS author_name, p.username AS author_username, (q.author_id = $1) AS mine
    FROM qa_questions q JOIN profiles p ON p.id = q.author_id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${lim} OFFSET ${off}`, args);
  return { items: rows.map(qOut), hasMore: rows.length === lim };
};

export const popularTags = async () => {
  const { rows } = await query(`SELECT t AS tag, count(*)::int AS n FROM qa_questions q, unnest(q.tags) t WHERE q.status = 'open' GROUP BY t ORDER BY n DESC, t LIMIT 20`);
  return { tags: rows };
};

export const getQuestion = async (me, id) => {
  const r = (await query(`SELECT q.*, p.name AS author_name, p.username AS author_username, (q.author_id = $2) AS mine
    FROM qa_questions q JOIN profiles p ON p.id = q.author_id WHERE q.id = $1 AND q.status = 'open'`, [id, me])).rows[0];
  if (!r) return { error: 'not_found' };
  if (!r.mine) await query(`UPDATE qa_questions SET views = views + 1 WHERE id = $1`, [id]);
  const { rows } = await query(`SELECT a.id, a.body, a.score, a.created_at, a.author_id, p.name AS author_name, p.username AS author_username,
      (a.author_id = $2) AS mine, COALESCE(v.value, 0) AS my_vote, (a.id = $3) AS best,
      ${REP.replaceAll('$REPID', 'a.author_id')} AS rep
    FROM qa_answers a JOIN profiles p ON p.id = a.author_id LEFT JOIN qa_votes v ON v.answer_id = a.id AND v.profile_id = $2
    WHERE a.question_id = $1 AND a.status = 'visible' ORDER BY (a.id = $3) DESC, a.score DESC, a.created_at ASC LIMIT 200`, [id, me, r.best_answer_id ?? '']);
  return { question: qOut(r), answers: rows.map((a) => ({ id: a.id, body: a.body, score: a.score, createdAt: a.created_at, mine: a.mine, myVote: a.my_vote, best: a.best,
    author: { id: a.author_id, name: a.author_name, username: a.author_username, rep: a.rep } })) };
};

export const ask = async (me, b) => {
  const title = clean(b.title, LIMITS.title[1]); if (title.length < LIMITS.title[0]) return { error: 'bad_title' };
  const body = clean(b.body, LIMITS.body);
  const n = (await query(`SELECT count(*)::int AS n FROM qa_questions WHERE author_id = $1 AND created_at > now() - interval '1 day'`, [me])).rows[0].n;
  if (n >= LIMITS.askPerDay) return { error: 'daily_limit', limit: LIMITS.askPerDay };
  const dup = (await query(`SELECT 1 FROM qa_questions WHERE author_id = $1 AND lower(title) = lower($2) AND created_at > now() - interval '1 day' AND status = 'open'`, [me, title])).rows[0];
  if (dup) return { error: 'duplicate' };
  const id = `qa-${generateId()}`;
  await query(`INSERT INTO qa_questions (id, author_id, title, body, tags) VALUES ($1,$2,$3,$4,$5)`, [id, me, title, body, cleanTags(b.tags)]);
  return { ok: true, id };
};

export const answer = async (me, qid, b) => {
  const body = clean(b.body, LIMITS.answer[1]); if (body.length < LIMITS.answer[0]) return { error: 'bad_body' };
  const n = (await query(`SELECT count(*)::int AS n FROM qa_answers WHERE author_id = $1 AND created_at > now() - interval '1 day'`, [me])).rows[0].n;
  if (n >= LIMITS.answerPerDay) return { error: 'daily_limit', limit: LIMITS.answerPerDay };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = (await client.query(`SELECT author_id FROM qa_questions WHERE id = $1 AND status = 'open' FOR UPDATE`, [qid])).rows[0];
    if (!q) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (q.author_id === me) { await client.query('ROLLBACK'); return { error: 'own_question' }; }
    const id = `qaa-${generateId()}`;
    const ins = await client.query(`INSERT INTO qa_answers (id, question_id, author_id, body) VALUES ($1,$2,$3,$4) ON CONFLICT (question_id, author_id) DO NOTHING RETURNING id`, [id, qid, me, body]);
    if (!ins.rows[0]) { await client.query('ROLLBACK'); return { error: 'already_answered' }; }
    await client.query(`UPDATE qa_questions SET answers = answers + 1 WHERE id = $1`, [qid]);
    await client.query('COMMIT');
    await note(q.author_id, 'qa_answer', 'Новый ответ на ваш вопрос', 'Кто-то ответил на вопрос, который вы задали в Sky Вопросах.', qid);
    return { ok: true, id };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};

/** Голос за/против ответа (0 — снять). За свой ответ голосовать нельзя. Счёт меняется на разницу в одной транзакции под замком ответа. */
export const vote = async (me, answerId, value) => {
  const v = Number(value); if (![-1, 0, 1].includes(v)) return { error: 'bad_value' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const a = (await client.query(`SELECT a.author_id, a.score FROM qa_answers a JOIN qa_questions q ON q.id = a.question_id WHERE a.id = $1 AND a.status = 'visible' AND q.status = 'open' FOR UPDATE OF a`, [answerId])).rows[0];
    if (!a) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (a.author_id === me) { await client.query('ROLLBACK'); return { error: 'own_answer' }; }
    const prev = (await client.query(`SELECT value FROM qa_votes WHERE answer_id = $1 AND profile_id = $2`, [answerId, me])).rows[0]?.value ?? 0;
    if (v === 0) await client.query(`DELETE FROM qa_votes WHERE answer_id = $1 AND profile_id = $2`, [answerId, me]);
    else await client.query(`INSERT INTO qa_votes (answer_id, profile_id, value) VALUES ($1,$2,$3) ON CONFLICT (answer_id, profile_id) DO UPDATE SET value = EXCLUDED.value`, [answerId, me, v]);
    const score = a.score + (v - prev);
    await client.query(`UPDATE qa_answers SET score = $2 WHERE id = $1`, [answerId, score]);
    await client.query('COMMIT');
    return { ok: true, score, myVote: v };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};

export const accept = async (me, qid, answerId) => {
  const q = (await query(`SELECT author_id FROM qa_questions WHERE id = $1 AND status = 'open'`, [qid])).rows[0];
  if (!q || q.author_id !== me) return { error: 'not_found' };
  const a = (await query(`SELECT author_id FROM qa_answers WHERE id = $1 AND question_id = $2 AND status = 'visible'`, [answerId, qid])).rows[0];
  if (!a) return { error: 'not_found' };
  if (a.author_id === me) return { error: 'own_answer' };
  const r = await query(`UPDATE qa_questions SET best_answer_id = $2 WHERE id = $1 AND (best_answer_id IS DISTINCT FROM $2) RETURNING 1`, [qid, answerId]);
  if (r.rows[0]) await note(a.author_id, 'qa_best', 'Ваш ответ признан лучшим', 'Автор вопроса отметил ваш ответ лучшим — это добавило очков репутации.', qid);
  return { ok: true };
};

export const unaccept = async (me, qid) => {
  const r = await query(`UPDATE qa_questions SET best_answer_id = NULL WHERE id = $1 AND author_id = $2 AND status = 'open' RETURNING 1`, [qid, me]);
  return r.rows[0] ? { ok: true } : { error: 'not_found' };
};

/** Автор удаляет свой вопрос, только пока на него нет чужих ответов, или свой ответ. */
export const removeOwnQuestion = async (me, qid) => {
  const q = (await query(`SELECT author_id, answers FROM qa_questions WHERE id = $1 AND status = 'open'`, [qid])).rows[0];
  if (!q || q.author_id !== me) return { error: 'not_found' };
  if (q.answers > 0) return { error: 'has_answers' };
  await query(`UPDATE qa_questions SET status = 'removed' WHERE id = $1`, [qid]);
  return { ok: true };
};

export const removeOwnAnswer = async (me, answerId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const a = (await client.query(`UPDATE qa_answers SET status = 'removed' WHERE id = $1 AND author_id = $2 AND status = 'visible' RETURNING question_id`, [answerId, me])).rows[0];
    if (!a) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    await client.query(`UPDATE qa_questions SET answers = GREATEST(0, answers - 1), best_answer_id = CASE WHEN best_answer_id = $2 THEN NULL ELSE best_answer_id END WHERE id = $1`, [a.question_id, answerId]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};

export const REASONS = ['spam', 'abuse', 'illegal', 'personal_data', 'other'];
export const report = async (me, kind, id, reason) => {
  if (!['question', 'answer'].includes(kind)) return { error: 'bad_kind' };
  if (!REASONS.includes(reason)) return { error: 'bad_reason' };
  const t = kind === 'question'
    ? (await query(`SELECT author_id FROM qa_questions WHERE id = $1 AND status = 'open'`, [id])).rows[0]
    : (await query(`SELECT author_id FROM qa_answers WHERE id = $1 AND status = 'visible'`, [id])).rows[0];
  if (!t) return { error: 'not_found' };
  if (t.author_id === me) return { error: 'own_content' };
  const n = (await query(`SELECT count(*)::int AS n FROM qa_reports WHERE reporter_id = $1 AND created_at > now() - interval '1 day'`, [me])).rows[0].n;
  if (n >= LIMITS.reportPerDay) return { error: 'daily_limit' };
  const r = await query(`INSERT INTO qa_reports (id, kind, target_id, reporter_id, reason) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, [`qar-${generateId()}`, kind, id, me, reason]);
  return r.rows[0] ? { ok: true } : { error: 'already_reported' };
};

/* ───────────── модерация (право content) ───────────── */

export const reportQueue = async (adminId) => {
  if (!(await can(adminId, 'content'))) return null;
  const { rows } = await query(`SELECT r.id, r.kind, r.target_id, r.reason, r.created_at,
      COALESCE(q.title, left(a.body, 160)) AS preview, COALESCE(q.author_id, a.author_id) AS author_id,
      (SELECT count(*)::int FROM qa_reports r2 WHERE r2.kind = r.kind AND r2.target_id = r.target_id AND r2.status = 'open') AS reports
    FROM qa_reports r LEFT JOIN qa_questions q ON r.kind = 'question' AND q.id = r.target_id LEFT JOIN qa_answers a ON r.kind = 'answer' AND a.id = r.target_id
    WHERE r.status = 'open' ORDER BY r.created_at LIMIT 100`);
  return { items: rows };
};

export const adminRemove = async (adminId, kind, id, reason, meta = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const why = clean(reason, 300); if (why.length < 5) return { error: 'reason_required' };
  let author;
  if (kind === 'question') author = (await query(`UPDATE qa_questions SET status = 'removed' WHERE id = $1 AND status = 'open' RETURNING author_id`, [id])).rows[0]?.author_id;
  else if (kind === 'answer') {
    const a = (await query(`UPDATE qa_answers SET status = 'removed' WHERE id = $1 AND status = 'visible' RETURNING author_id, question_id`, [id])).rows[0];
    if (a) {
      author = a.author_id;
      await query(`UPDATE qa_questions SET answers = GREATEST(0, answers - 1), best_answer_id = CASE WHEN best_answer_id = $2 THEN NULL ELSE best_answer_id END WHERE id = $1`, [a.question_id, id]);
    }
  } else return { error: 'bad_kind' };
  if (!author) return { error: 'not_found' };
  await query(`UPDATE qa_reports SET status = 'done' WHERE kind = $1 AND target_id = $2`, [kind, id]);
  await logAdmin({ actorId: adminId, targetId: id, targetType: `qa_${kind}`, type: 'qa_remove', detail: why.slice(0, 200), meta });
  await note(author, 'qa_removed', 'Материал удалён модерацией', (kind === 'question' ? `Ваш вопрос удалён: ${why}` : `Ваш ответ удалён: ${why}`), id);
  return { ok: true };
};

export const adminDismiss = async (adminId, reportId) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const r = await query(`UPDATE qa_reports SET status = 'done' WHERE id = $1 AND status = 'open' RETURNING 1`, [reportId]);
  return r.rows[0] ? { ok: true } : { error: 'not_found' };
};
