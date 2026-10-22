import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { getMine, saveMine, rotate, revoke, lookupCode, lookupUsername, CODE_RE } from './../skyqr.mjs';

const originOf = (req) => { const h = String(req.headers['x-forwarded-host'] || req.headers.host || ''); return h ? `${req.headers['x-forwarded-proto'] === 'http' ? 'http' : 'https'}://${h}` : ''; };
const STATUS = { not_found: 404, try_again: 503 };

/**
 * /api/qr/* — Sky QR. Все ручки только для вошедшего профиля.
 *  GET  /me · POST /me (создать/настроить) · POST /me/rotate · POST /me/revoke
 *  GET  /card/<код> — карточка по коду из QR · GET /user/<ник> — ручной ввод
 * Перебор: промахи по коду/нику считаются отдельно и жёстче, чем успешные запросы.
 */
export const skyQrRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/qr/')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);
  const rest = path.slice('/api/qr/'.length);
  if (rest === 'me' || rest.startsWith('me/')) {
    if (!rateLimit(`qr:me:${me}`, 60)) return json(res, 429, { error: 'rate_limited' });
    if (req.method === 'GET' && rest === 'me') return json(res, 200, await getMine(me, originOf(req)));
    if (req.method !== 'POST') return json(res, 404, { error: 'not_found' });
    const b = (await parseBody(req).catch(() => ({}))) ?? {};
    if (rest === 'me') return reply(await saveMine(me, b, originOf(req)));
    if (rest === 'me/rotate') return reply(await rotate(me, originOf(req)));
    if (rest === 'me/revoke') return reply(await revoke(me, originOf(req)));
    return json(res, 404, { error: 'not_found' });
  }
  const m = /^(card|user)\/([^/]+)$/.exec(rest);
  if (req.method === 'GET' && m) {
    if (!rateLimit(`qr:look:${me}`, 40)) return json(res, 429, { error: 'rate_limited' });
    const key = decodeURIComponent(m[2]).slice(0, 80);
    const r = m[1] === 'card' ? await lookupCode(key, me) : await lookupUsername(key, me);
    // Промахи — отдельные жёсткие счётчики против перебора кодов и ников: 8 в минуту и 40 в час на профиль.
    if (r.error === 'not_found' && (!rateLimit(`qr:miss:${me}`, 8) || !rateLimitPerHour(`qr:missh:${me}`, 40))) return json(res, 429, { error: 'rate_limited' });
    return reply(r);
  }
  return json(res, 404, { error: 'not_found' });
};
