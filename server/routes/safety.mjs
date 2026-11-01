/**
 * Sky Safety:
 *   GET  /api/safety                 — настройки, контакты, приглашения мне, мой ожидающий ответ;
 *   PUT  /api/safety/settings        — {enabled, timeoutSec};
 *   POST /api/safety/contacts        — {contactId} пригласить друга; POST /api/safety/contacts/remove; POST /api/safety/invites {ownerId, accept};
 *   POST /api/safety/trigger         — клиент заметил резкую остановку после быстрой езды;
 *   POST /api/safety/:id/ok          — «Я в порядке».
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { getState, saveSettings, addContact, removeContact, answerInvite, trigger, confirmSafe } from './../safety.mjs';

const code = (e) => (e === 'feature_off' ? 503 : e === 'cooldown' ? 429 : e === 'not_found' ? 404 : 400);

export const safetyRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/safety')) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId;
  if (!rateLimit(`sf:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const body = req.method === 'GET' ? {} : ((await parseBody(req)) ?? {});
  const reply = (r) => json(res, r.error ? code(r.error) : 200, r);

  if (req.method === 'GET' && path === '/api/safety') return json(res, 200, await getState(me));
  if (req.method === 'PUT' && path === '/api/safety/settings') return reply(await saveSettings(me, body));
  if (req.method === 'POST' && path === '/api/safety/contacts') return reply(await addContact(me, body.contactId));
  if (req.method === 'POST' && path === '/api/safety/contacts/remove') return reply(await removeContact(me, body.contactId));
  if (req.method === 'POST' && path === '/api/safety/invites') return reply(await answerInvite(me, body.ownerId, body.accept === true));
  if (req.method === 'POST' && path === '/api/safety/trigger') return reply(await trigger(me, body));
  const m = /^\/api\/safety\/(sfe-[0-9a-f]{16})\/ok$/.exec(path);
  if (req.method === 'POST' && m) return reply(await confirmSafe(me, m[1]));
  return json(res, 404, { error: 'not_found' });
};
