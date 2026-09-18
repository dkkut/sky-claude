/**
 * Обращения в поддержку по HTTP.
 *
 * Именно по HTTP, а не через хаб мессенджера: забаненного в хаб не
 * пускают, а обжаловать блокировку он должен иметь возможность. Это
 * единственная часть приложения, намеренно открытая заблокированному —
 * поэтому здесь нет ничего, кроме его собственных обращений.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { restrictionsOf, can, isAdmin } from './../admin.mjs';
import {
  createTicket, readTicket, listMyTickets, listQueue,
  replyToTicket, assignTicket, setTicketStatus, listAdmins,
} from './../support.mjs';

/** Идентификатор обращения в адресе. */
const TICKET_ID = /^tk-[0-9a-f-]{36}$/;

const idFrom = (url, prefix) => {
  const tail = url.slice(prefix.length).split('/')[0];
  return TICKET_ID.test(tail) ? tail : null;
};

export const supportRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/support')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  // Отдельный предел на обращения: общий по адресу здесь не годится —
  // заблокированный сидит за тем же адресом, что и все остальные.
  if (!rateLimit(`support:${me}`, 60)) {
    return json(res, 429, { error: 'rate_limited' });
  }

  /* ── Своё ─────────────────────────────────────────────────── */

  if (req.method === 'GET' && url === '/api/support/tickets') {
    return json(res, 200, { tickets: await listMyTickets(me) });
  }

  if (req.method === 'POST' && url === '/api/support/tickets') {
    const body = await parseBody(req);
    const result = await createTicket(me, body);
    if (result.error) return json(res, 400, result);
    return json(res, 200, result);
  }

  // Состояние ограничений — чтобы окно блокировки знало, что показать.
  // Здесь же признаки для меню профиля: владелец является
  // администратором по нику, а не по колонке в базе, поэтому спрашивать
  // надо сервер — из профиля, который лежит у клиента, это не видно.
  //
  // Три признака, а не один общий: у ролей разные права, и пункт меню
  // должен появляться у того, кому он вообще что-то откроет. `staff`
  // отвечает за очередь поддержки, `logistics` — за видеообзоры
  // складов, `isAdmin` — за сам вход в панель администратора: она
  // разная у разных ролей, но войти в неё и увидеть, что доступно
  // (или почему не доступно ничего — например, не включён второй
  // фактор), должен любой администратор, а не только с правом support.
  if (req.method === 'GET' && url === '/api/support/status') {
    return json(res, 200, {
      restrictions: await restrictionsOf(me),
      staff: await can(me, 'support'),
      logistics: await can(me, 'logistics'),
      isAdmin: await isAdmin(me),
    });
  }

  /* ── Для тех, кто разбирает ───────────────────────────────── */

  if (req.method === 'GET' && url.startsWith('/api/support/queue')) {
    const params = new URL(req.url, 'http://x').searchParams;
    const list = await listQueue(me, {
      status: params.get('status') ?? undefined,
      mine: params.get('mine') === '1',
    });
    // Не администратору отвечаем тем же, чем и на несуществующий адрес:
    // по разнице ответов не должно быть видно, что очередь существует.
    if (!list) return json(res, 403, { error: 'not_allowed' });
    return json(res, 200, { tickets: list });
  }

  if (req.method === 'GET' && url === '/api/support/admins') {
    const list = await listAdmins(me);
    if (!list) return json(res, 403, { error: 'not_allowed' });
    return json(res, 200, { admins: list });
  }

  /* ── Одно обращение ───────────────────────────────────────── */

  if (url.startsWith('/api/support/ticket/')) {
    const id = idFrom(url, '/api/support/ticket/');
    if (!id) return json(res, 404, { error: 'not_found' });
    const tail = url.slice(`/api/support/ticket/${id}`.length);

    if (req.method === 'GET' && tail === '') {
      const ticket = await readTicket(id, me);
      if (!ticket) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { ticket });
    }

    if (req.method === 'POST' && tail === '/reply') {
      const body = await parseBody(req);
      const result = await replyToTicket(id, me, body.body);
      if (result.error) {
        return json(res, result.error === 'not_allowed' ? 403 : 400, result);
      }
      return json(res, 200, result);
    }

    if (req.method === 'POST' && tail === '/assign') {
      const body = await parseBody(req);
      const result = await assignTicket(id, me, body.assigneeId);
      if (result.error) {
        return json(res, result.error === 'not_allowed' ? 403 : 400, result);
      }
      return json(res, 200, result);
    }

    if (req.method === 'POST' && tail === '/status') {
      const body = await parseBody(req);
      const result = await setTicketStatus(id, me, String(body.status ?? ''));
      if (result.error) {
        return json(res, result.error === 'not_allowed' ? 403 : 400, result);
      }
      return json(res, 200, result);
    }
  }

  return json(res, 404, { error: 'not_found' });
};
