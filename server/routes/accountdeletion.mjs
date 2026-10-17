import { json, parseBody, readSession, clientIp } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { verifySkyTwoFactor } from './../skyid.mjs';
import {
  deletionStatus, deletionPreview, sendDeletionCode, requestDeletion, cancelProfileDeletion, restoreStart, restoreFinish, exportData, sendExportCode,
} from './../accountdeletion.mjs';
import { logEvent } from './../skylog.mjs';

const STATUS = { email_required: 409, two_factor_required: 400, email_code_required: 400, invalid_code: 401, too_many_attempts: 429, blocked: 409, already_pending: 409,
  ack_required: 400, ack_wallet_required: 400, ack_prime_required: 400, bad_scope: 400, not_found: 404, last_profile: 409, not_pending: 409, too_soon: 429 };

/** Удаление аккаунта с восстановлением 30 дней, экспорт данных (accountdeletion.mjs). */
export const accountDeletionRoutes = async (req, res, url) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  const mine = path.startsWith('/api/skyid/deletion') || path.startsWith('/api/skyid/export') || path.startsWith('/api/auth/deletion');
  if (!mine) return false;
  const ip = clientIp(req); const ua = String(req.headers['user-agent'] ?? '');
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  if (!rateLimit(`deletion:${ip}`, 30)) return json(res, 429, { error: 'too_many_requests' });

  /* Без входа: аккаунт в ожидании удаления войти не может, поэтому отмена идёт по коду с подтверждённой почты. */
  if (path === '/api/auth/deletion/restore/start' && req.method === 'POST') {
    if (!rateLimitPerHour(`deletion:restore:${ip}`, 10)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, await restoreStart((await parseBody(req))?.identifier));
  }
  if (path === '/api/auth/deletion/restore/finish' && req.method === 'POST') {
    if (!rateLimitPerHour(`deletion:restorefin:${ip}`, 20)) return json(res, 429, { error: 'too_many_requests' });
    const b = (await parseBody(req)) ?? {};
    const r = await restoreFinish(b.identifier, { emailCode: b.emailCode, twoFactorCode: b.twoFactorCode }, verifySkyTwoFactor, ip);
    await logEvent({ category: 'user', type: 'account_deletion_restore', result: r.error ? 'denied' : 'ok', reason: r.error ?? '', ip, ua, service: 'skyid' });
    return reply(r);
  }

  const s = await readSession(req);
  if (!s) return json(res, 401, { error: 'unauthorized' });
  const proofOf = (b) => ({ emailCode: b.emailCode, twoFactorCode: b.twoFactorCode });

  if (req.method === 'GET' && path === '/api/skyid/deletion') return reply(await deletionStatus(s.skyId));
  if (req.method === 'GET' && path === '/api/skyid/deletion/preview') {
    return reply(await deletionPreview(s.skyId, { scope: u.searchParams.get('scope') === 'profile' ? 'profile' : 'account', profileId: u.searchParams.get('profileId') }));
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const b = (await parseBody(req)) ?? {};

  if (path === '/api/skyid/deletion/code') {
    if (!rateLimitPerHour(`deletion:code:${s.skyId}`, 6)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await sendDeletionCode(s.skyId));
  }
  if (path === '/api/skyid/deletion/request') {
    if (!rateLimitPerHour(`deletion:req:${s.skyId}`, 10)) return json(res, 429, { error: 'too_many_requests' });
    const r = await requestDeletion(s.skyId, s.sessionId, { scope: b.scope, profileId: b.profileId, ack: b.ack, ip, ...proofOf(b) }, verifySkyTwoFactor);
    await logEvent({ category: 'user', type: 'account_deletion_request', actorId: s.profileId ?? s.skyId, result: r.error ? 'denied' : 'ok', reason: r.error ?? '', ip, ua, service: 'skyid', detail: { scope: b.scope } });
    return reply(r);
  }
  if (path === '/api/skyid/deletion/cancel-profile') {
    if (!rateLimitPerHour(`deletion:cancel:${s.skyId}`, 20)) return json(res, 429, { error: 'too_many_requests' });
    const r = await cancelProfileDeletion(s.skyId, String(b.profileId ?? ''), proofOf(b), verifySkyTwoFactor);
    await logEvent({ category: 'user', type: 'account_deletion_cancel', actorId: s.profileId ?? s.skyId, result: r.error ? 'denied' : 'ok', reason: r.error ?? '', ip, ua, service: 'skyid' });
    return reply(r);
  }
  if (path === '/api/skyid/export/code') {
    if (!rateLimitPerHour(`export:code:${s.skyId}`, 6)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await sendExportCode(s.skyId));
  }
  if (path === '/api/skyid/export') {
    if (!rateLimitPerHour(`export:${s.skyId}`, 5)) return json(res, 429, { error: 'too_many_requests' });
    const r = await exportData(s.skyId, proofOf(b), verifySkyTwoFactor);
    await logEvent({ category: 'user', type: 'data_export', actorId: s.profileId ?? s.skyId, result: r.error ? 'denied' : 'ok', reason: r.error ?? '', ip, ua, service: 'skyid' });
    return reply(r);
  }
  return json(res, 404, { error: 'not_found' });
};
