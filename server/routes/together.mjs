/**
 * Sky «Вместе» по HTTP.
 *
 * Здесь только вход: кто спрашивает, не слишком ли часто и той ли формы
 * идентификатор. Кому что можно — решает together.mjs, и решает один
 * раз для всех входов: у сессии их два, обычный запрос и сокет, а
 * правило должно быть одно.
 *
 * Чего этот файл не читает из запроса никогда:
 *   · идентификатор того, кто спрашивает, — он берётся из токена;
 *   · роль и признак владельца — они берутся из строки участника;
 *   · потолок участников — его задаёт сервер, а не экран.
 *
 * Ни одного байта медиа через эти ручки не проходит. Фильм и трек
 * каждый участник тянет из своего модуля, своим пропуском, и права на
 * файл проверяет тот модуль. «Вместе» синхронизирует состояние, а не
 * раздаёт содержимое.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  createSession, readSession, listMySessions, participantsOf,
  inviteToSession, removeParticipant, listInvitations, answerInvitation,
  joinSession, leaveSession, endSession, updateSettings,
  SESSION_ID_RE, INVITE_ID_RE, SESSION_TYPES,
  MAX_PARTICIPANTS_DEFAULT, MAX_PARTICIPANTS_HARD, MAX_QUEUE,
} from './../together.mjs';
import { pushTogether } from './../signal.mjs';

/* ─── Потолки ──────────────────────────────────────────────────────
   Чтение щедрое: экран обновляет список участников. Создание и
   приглашения — скупо: именно они дороже всего стоят остальным.   */
const READ_PER_MIN = 120;
const WRITE_PER_MIN = 60;
const CREATE_PER_HOUR = 20;
const INVITE_PER_HOUR = 200;

/** Ответ на ошибку слоя данных. Один список на весь файл: иначе коды расходятся между ручками. */
const CODES = {
  not_found: 404,
  forbidden: 403,
  prime_required: 403,
  content_forbidden: 403,
  not_controller: 403,
  session_ended: 409,
  session_not_live: 409,
  session_full: 409,
  invitation_pending: 409,
  too_many_sessions: 409,
  limit_below_current: 409,
  content_private: 409,
  content_not_ready: 409,
  content_not_found: 404,
  queue_end: 409,
  queue_start: 409,
};

const fail = (res, result) => json(res, CODES[result.error] ?? 400, { error: result.error });

export const togetherRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/together')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  /* ── Что умеет сервер ───────────────────────────────────────
     Пределы отдаются экрану, чтобы он не выдумывал свои. Источник
     правды при этом всё равно сервер: присланное сверх предела он
     отклонит, даже если экран покажет другое. */
  if (req.method === 'GET' && path === '/api/together/limits') {
    return json(res, 200, {
      types: SESSION_TYPES,
      maxParticipantsDefault: MAX_PARTICIPANTS_DEFAULT,
      maxParticipantsHard: MAX_PARTICIPANTS_HARD,
      maxQueue: MAX_QUEUE,
    });
  }

  /* ── Мои сессии ─────────────────────────────────────────────
     История отбирается по участию в базе. Здесь нет и не может быть
     ветки «показать все»: такой ветки не существует в слое данных. */
  if (req.method === 'GET' && path === '/api/together/sessions') {
    if (!rateLimit(`tg:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      sessions: await listMySessions(me, {
        status: params.get('status') ?? undefined,
        limit: params.get('limit'),
      }),
    });
  }

  if (req.method === 'POST' && path === '/api/together/sessions') {
    if (!rateLimitPerHour(`tg:create:${me}`, CREATE_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const result = await createSession(me, {
      type: body?.type,
      contentKind: body?.contentKind,
      contentId: body?.contentId,
      title: body?.title,
      maxParticipants: body?.maxParticipants,
      control: body?.control,
    });
    if (result.error) return fail(res, result);
    return json(res, 200, { session: result.session });
  }

  /* ── Приглашения, адресованные мне ──────────────────────────── */

  if (req.method === 'GET' && path === '/api/together/invitations') {
    if (!rateLimit(`tg:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { invitations: await listInvitations(me) });
  }

  const inviteMatch = path.match(/^\/api\/together\/invitation\/([^/]+)\/(accept|decline)$/);
  if (req.method === 'POST' && inviteMatch) {
    const [, inviteId, what] = inviteMatch;
    if (!INVITE_ID_RE.test(inviteId)) return json(res, 404, { error: 'not_found' });
    if (!rateLimit(`tg:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const result = await answerInvitation(me, inviteId, what === 'accept');
    if (result.error) return fail(res, result);
    /* Позвавшему видно сразу, согласился человек или нет. */
    pushTogether(result.recipients, {
      type: result.accepted ? 'together-join' : 'together-decline',
      payload: { sessionId: result.sessionId, userId: me },
    });
    return json(res, 200, { ok: true, accepted: result.accepted, sessionId: result.sessionId });
  }

  /* ── Одна сессия ────────────────────────────────────────────
     Идентификатор проверяется формой до всякого обращения к базе, а
     право на сессию — внутри слоя данных. Чужая сессия отвечает тем
     же, чем несуществующая. */

  const sessionMatch = path.match(/^\/api\/together\/session\/([^/]+)(\/[a-z-]+)?$/);
  if (sessionMatch) {
    const [, sessionId, tailRaw] = sessionMatch;
    const tail = tailRaw ?? '';
    if (!SESSION_ID_RE.test(sessionId)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`tg:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const found = await readSession(sessionId, me);
      return found ? json(res, 200, { session: found }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'GET' && tail === '/participants') {
      if (!rateLimit(`tg:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const people = await participantsOf(sessionId, me);
      return people ? json(res, 200, { participants: people }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'POST' && tail === '/invite') {
      if (!rateLimitPerHour(`tg:invite:${me}`, INVITE_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const result = await inviteToSession(sessionId, me, body?.userIds);
      if (result.error) return fail(res, result);
      pushTogether(result.invited.map((i) => i.id), { type: 'together-invited' });
      return json(res, 200, { invited: result.invited.map((i) => i.id), skipped: result.skipped });
    }

    if (req.method === 'POST' && tail === '/remove') {
      if (!rateLimit(`tg:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const target = String(body?.userId ?? '');
      const result = await removeParticipant(sessionId, me, target);
      if (result.error) return fail(res, result);
      /* Убранный узнаёт об этом сразу. Доступ к событиям сессии у него
         пропал в тот же миг: рассылка идёт по списку участников, а его
         там больше нет. */
      pushTogether(result.recipients, {
        type: 'together-leave',
        payload: { sessionId, userId: target, removed: true },
      });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && tail === '/join') {
      if (!rateLimit(`tg:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const result = await joinSession(sessionId, me);
      if (result.error) return fail(res, result);
      pushTogether(result.recipients, {
        type: 'together-join', payload: { sessionId, userId: me },
      });
      return json(res, 200, { session: result.session });
    }

    if (req.method === 'POST' && tail === '/leave') {
      if (!rateLimit(`tg:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const result = await leaveSession(sessionId, me);
      if (result.error) return fail(res, result);
      pushTogether(result.recipients ?? [], {
        type: result.ended ? 'together-end' : 'together-leave',
        payload: { sessionId, userId: me, newOwnerId: result.newOwnerId },
      });
      return json(res, 200, { ok: true, ended: result.ended === true, newOwnerId: result.newOwnerId });
    }

    if (req.method === 'POST' && tail === '/end') {
      if (!rateLimit(`tg:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const result = await endSession(sessionId, me);
      if (result.error) return fail(res, result);
      pushTogether(result.recipients ?? [], {
        type: 'together-end', payload: { sessionId },
      });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && tail === '/settings') {
      if (!rateLimit(`tg:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const result = await updateSettings(sessionId, me, {
        control: body?.control,
        maxParticipants: body?.maxParticipants,
      });
      if (result.error) return fail(res, result);
      pushTogether(result.recipients, {
        type: 'together-settings',
        payload: { sessionId, control: result.session.control, maxParticipants: result.session.maxParticipants },
      });
      return json(res, 200, { session: result.session });
    }
  }

  return json(res, 404, { error: 'not_found' });
};
