/**
 * Проверка обновлений: публичный GET /api/site/app-version (путь под /api/site/ — исключён из шлюзов: устаревшее приложение тоже должно уметь спросить)
 * и админка /api/admin/app-update (право `site`; обязательность и минимальная сборка — владелец с кодом `app_update_force`).
 */
import { json, requireProfile, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { beginStepUp, consumeStepUp, requestMeta } from './../adminsec.mjs';
import * as upd from './../appupdate.mjs';

const CODES = { not_allowed: 403, owner_only: 403, code_required: 401, text_required: 400, unsupported_store: 400, bad_store_url: 400, min_above_latest: 400, latest_required: 400 };

export const appUpdateRoutes = async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/api/site/app-version' && req.method === 'GET') {
    if (!rateLimit(`appver:${clientIp(req)}`, 60)) return json(res, 429, { error: 'too_many_requests' });
    const q = new URL(req.url, 'http://x').searchParams;
    const lang = String(req.headers['x-sky-lang'] ?? q.get('lang') ?? '').toLowerCase().startsWith('en') ? 'en' : 'ru';
    return json(res, 200, await upd.check({ platform: q.get('platform'), build: q.get('build'), lang }));
  }
  if (!p.startsWith('/api/admin/app-update')) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId; const meta = requestMeta(req);
  if (!rateLimit(`appupd:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  if (req.method === 'GET' && p === '/api/admin/app-update') { const r = await upd.adminGet(me); return json(res, r.error ? CODES[r.error] ?? 400 : 200, r); }
  if (req.method === 'POST' && p === '/api/admin/app-update/step-up') { const r = await beginStepUp(me, 'app_update_force', { meta }); return json(res, r.error ? 400 : 200, r); }
  if (req.method === 'PUT' && p === '/api/admin/app-update') {
    const b = (await parseBody(req)) ?? {};
    let codeOk = false;
    if (b.stepUpCode) {
      const s = await consumeStepUp(me, 'app_update_force', b.stepUpCode, { meta });
      if (s.error) return json(res, s.error === 'step_up_exhausted' ? 429 : 401, s);
      codeOk = true;
    }
    const r = await upd.adminSave(me, b, { codeOk });
    return json(res, r.error ? CODES[r.error] ?? 400 : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
