import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import { listQuestions, popularTags, getQuestion, ask, answer, vote, accept, unaccept, removeOwnQuestion, removeOwnAnswer, report, reportQueue, adminRemove, adminDismiss, reputationOf } from './../skyqa.mjs';

const STATUS = { not_found: 404, not_allowed: 403, daily_limit: 429, duplicate: 409, already_answered: 409, already_reported: 409, has_answers: 409, own_question: 403, own_answer: 403, own_content: 403 };
const ID = '(qa-[A-Za-z0-9_-]{6,64})', AID = '(qaa-[A-Za-z0-9_-]{6,64})';

/** /api/qa/* — Sky Вопросы; /api/admin/qa/* — модерация (право content). Параметры запроса — только из req.url. */
export const skyQaRoutes = async (req, res, url) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  if (!path.startsWith('/api/qa/') && !path.startsWith('/api/admin/qa/')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; const m = req.method;
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  if (!rateLimit(`qa:${me}`, 180)) return json(res, 429, { error: 'rate_limited' });

  if (path.startsWith('/api/admin/qa/')) {
    const rest = path.slice('/api/admin/qa/'.length);
    if (m === 'GET' && rest === 'reports') { const r = await reportQueue(me); return r ? json(res, 200, r) : json(res, 403, { error: 'not_allowed' }); }
    if (m === 'POST' && rest === 'remove') { const b = await body(); return reply(await adminRemove(me, b.kind, String(b.id ?? ''), b.reason, requestMeta(req))); }
    let x;
    if (m === 'POST' && (x = /^reports\/(qar-[A-Za-z0-9_-]{6,64})\/dismiss$/.exec(rest))) return reply(await adminDismiss(me, x[1]));
    return json(res, 404, { error: 'not_found' });
  }

  const rest = path.slice('/api/qa/'.length);
  if (m === 'GET' && rest === 'questions') {
    const g = (k) => u.searchParams.get(k) ?? '';
    return json(res, 200, await listQuestions(me, { sort: g('sort'), q: g('q'), tag: g('tag'), mine: g('mine') === '1', limit: g('limit'), offset: g('offset') }));
  }
  if (m === 'GET' && rest === 'tags') return json(res, 200, await popularTags());
  if (m === 'GET' && rest === 'me') return json(res, 200, { reputation: await reputationOf(me) });
  if (m === 'POST' && rest === 'questions') { if (!rateLimit(`qa:ask:${me}`, 6)) return json(res, 429, { error: 'rate_limited' }); return reply(await ask(me, await body())); }
  let x;
  if (m === 'GET' && (x = new RegExp(`^questions/${ID}$`).exec(rest))) return reply(await getQuestion(me, x[1]));
  if (m === 'DELETE' && (x = new RegExp(`^questions/${ID}$`).exec(rest))) return reply(await removeOwnQuestion(me, x[1]));
  if (m === 'POST' && (x = new RegExp(`^questions/${ID}/answers$`).exec(rest))) { if (!rateLimit(`qa:ans:${me}`, 10)) return json(res, 429, { error: 'rate_limited' }); return reply(await answer(me, x[1], await body())); }
  if (m === 'POST' && (x = new RegExp(`^questions/${ID}/accept$`).exec(rest))) return reply(await accept(me, x[1], String((await body()).answerId ?? '')));
  if (m === 'POST' && (x = new RegExp(`^questions/${ID}/unaccept$`).exec(rest))) return reply(await unaccept(me, x[1]));
  if (m === 'DELETE' && (x = new RegExp(`^answers/${AID}$`).exec(rest))) return reply(await removeOwnAnswer(me, x[1]));
  if (m === 'POST' && (x = new RegExp(`^answers/${AID}/vote$`).exec(rest))) { if (!rateLimit(`qa:vote:${me}`, 60)) return json(res, 429, { error: 'rate_limited' }); return reply(await vote(me, x[1], (await body()).value)); }
  if (m === 'POST' && rest === 'report') { const b = await body(); return reply(await report(me, b.kind, String(b.id ?? ''), b.reason)); }
  return json(res, 404, { error: 'not_found' });
};
