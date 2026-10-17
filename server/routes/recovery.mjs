import { json, parseBody, requireSkyId, requireProfile, clientIp, appBody } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { can, isOwner, isAdmin } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta } from './../adminsec.mjs';
import { startSession } from './auth.mjs';
import * as flow from './../recoveryflow.mjs';
import * as mail from './../recoverymail.mjs';
import * as radmin from './../recoveryadmin.mjs';
import { generateBackupCodes } from './../accountrecovery.mjs';
import { verifySkyTwoFactor } from './../skyid.mjs';
import { historyFor } from './../recoverycore.mjs';

const STATUS = {
  too_many_requests: 429, invalid_request: 404, invalid_link: 404, verification_failed: 401, not_enough_factors: 409, limited_only: 409,
  wrong_account_type: 409, not_ready: 409, bad_password: 400, invalid_email: 400, same_as_primary: 409, same_as_current: 409, email_unavailable: 409,
  cannot_prove_ownership: 409, two_factor_required: 400, guard_code_required: 400, invalid_code: 401, too_many_attempts: 429, owner_only: 403,
  weak_secret: 400, reason_required: 400, not_found: 404, nothing_to_show: 404, step_up_required: 401, step_up_invalid: 401, step_up_exhausted: 429, not_allowed: 403,
};

/**
 * Sky Recovery.
 *  • /api/recovery/*            — публично (сайт recovery.skymessenger.online): запрос, факторы, завершение, ссылки из писем, обмен кода на сессию.
 *  • /api/skyid/recovery*       — для вошедшего человека: сводка «Безопасность и восстановление», резервная почта, токен администратора, секрет владельца.
 *  • /api/admin/recovery/*      — сотрудникам: отзыв токена администратора (право `security`).
 * Тела ответов публичных ручек одинаковы для существующего и несуществующего аккаунта.
 */
export const recoveryRoutes = async (req, res, url) => {
  const path = new URL(req.url, 'http://x').pathname;
  const pub = path.startsWith('/api/recovery/');
  const mine = path === '/api/skyid/recovery' || path.startsWith('/api/skyid/recovery/');
  const adm = path.startsWith('/api/admin/recovery/');
  if (!pub && !mine && !adm) return false;
  const ip = clientIp(req);
  const reply = (r, ok = 200) => json(res, r?.error ? STATUS[r.error] ?? 400 : ok, r);
  if (!rateLimit(`rcv:${ip}`, 90)) return json(res, 429, { error: 'too_many_requests' });
  const b = req.method === 'GET' ? {} : ((await parseBody(req)) ?? {});

  /* ── Публичные ── */
  if (pub) {
    if (req.method === 'GET' && path === '/api/recovery/info') return json(res, 200, { ok: true });
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    if (path === '/api/recovery/start') return reply(await flow.start({ identifier: b.identifier, kind: b.kind, ip, ua: req.headers['user-agent'] }));
    if (path === '/api/recovery/email/send') return reply(await flow.sendEmailCode({ requestId: b.requestId, secret: b.secret, ip }));
    if (path === '/api/recovery/verify') return reply(await flow.verifyFactor({ requestId: b.requestId, secret: b.secret, factor: b.factor, value: b.value, ip }));
    if (path === '/api/recovery/status') return reply(await flow.status({ requestId: b.requestId, secret: b.secret }));
    if (path === '/api/recovery/complete') return reply(await flow.complete({ requestId: b.requestId, secret: b.secret, newPassword: b.newPassword, ip }));
    if (path === '/api/recovery/backup-email') return reply(await flow.limitedSetBackupEmail({ requestId: b.requestId, secret: b.secret, email: b.email, ip }));
    if (path === '/api/recovery/cancel') return reply(await flow.cancelByLink(b.token, ip));
    if (path === '/api/recovery/finish/info') return reply(await flow.finishInfo(b.token));
    if (path === '/api/recovery/finish/send-code') return reply(await flow.finishSendCode({ token: b.token, ip }));
    if (path === '/api/recovery/finish') return reply(await flow.finish({ token: b.token, code: b.code, ownerSecret: b.ownerSecret, newPassword: b.newPassword, ip }));
    if (path === '/api/recovery/confirm-email') { if (!rateLimitPerHour(`rcv:conf:${ip}`, 30)) return json(res, 429, { error: 'too_many_requests' }); return reply(await mail.confirmLink(b.token, ip)); }
    if (path === '/api/recovery/handoff') {
      const r = await flow.exchangeHandoff({ code: b.code, req, ip, deps: { startSession } });
      if (r.error) return reply(r);
      return json(res, 200, appBody(req, { ok: true, session: r.session }, { refreshToken: r.refreshToken }), { 'Set-Cookie': r.cookie });
    }
    return json(res, 404, { error: 'not_found' });
  }

  /* ── Человек, вошедший в Sky ID ── */
  if (mine) {
    const s = await requireSkyId(req, res); if (!s) return true;
    if (!rateLimit(`rcv:u:${s.skyId}`, 40)) return json(res, 429, { error: 'too_many_requests' });
    const profileId = s.profileId;
    if (req.method === 'GET' && path === '/api/skyid/recovery') {
      const o = await mail.overview(s.skyId, s.sessionId);
      const admin = profileId ? await isAdmin(profileId) : false;
      const owner = profileId ? await isOwner(profileId) : false;
      return json(res, 200, { ...o,
        adminToken: profileId ? await radmin.adminTokenState(profileId) : { exists: false },
        isAdmin: Boolean(admin), isOwner: owner, ownerSecret: owner ? await radmin.ownerSecretState(profileId) : undefined });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    if (path === '/api/skyid/recovery/guard-code') return reply(await mail.sendGuardCode(s.skyId));
    if (path === '/api/skyid/recovery/backup-email') return reply(await mail.startSet(s.skyId, b, ip));
    if (path === '/api/skyid/recovery/end-other-sessions') return reply(await mail.endOtherSessions(s.skyId, s.sessionId, ip));
    if (path === '/api/skyid/recovery/backup-codes') {
      if (!rateLimitPerHour(`rcv:codes:${s.skyId}`, 5)) return json(res, 429, { error: 'too_many_requests' });
      const c = await verifySkyTwoFactor(s.skyId, String(b.twoFactorCode ?? ''));
      if (c?.skipped) return json(res, 409, { error: 'two_factor_required' });
      if (c?.error) return json(res, 401, { error: 'invalid_code' });
      return json(res, 200, await generateBackupCodes(s.skyId));
    }
    // Токен администратора и секрет владельца — только для профиля с нужной ролью, с подтверждением личности.
    const meta = requestMeta(req);
    if (path === '/api/skyid/recovery/admin-token/step-up') {
      if (!profileId) return json(res, 409, { error: 'no_profile' });
      const r = await beginStepUp(profileId, 'recovery_admin_token', { meta }); return reply(r);
    }
    if (path === '/api/skyid/recovery/admin-token/reveal' || path === '/api/skyid/recovery/admin-token/rotate') {
      if (!profileId) return json(res, 409, { error: 'no_profile' });
      const step = await consumeStepUp(profileId, 'recovery_admin_token', b.stepUpCode, { meta });
      if (step.error) return json(res, step.error === 'step_up_exhausted' ? 429 : 401, step);
      if (!(await isAdmin(profileId))) return json(res, 403, { error: 'not_allowed' });
      if (path.endsWith('/rotate')) {
        const i = await radmin.issueAdminToken(profileId, profileId, 'rotated_by_holder'); if (i.error) return reply(i);
      }
      return reply(await radmin.revealOnce(profileId, ip));
    }
    if (path === '/api/skyid/recovery/owner-secret') {
      if (!profileId || !(await isOwner(profileId))) return json(res, 403, { error: 'owner_only' });
      const step = await consumeStepUp(profileId, 'recovery_owner_secret', b.stepUpCode, { meta });
      if (step.error) return json(res, step.error === 'step_up_exhausted' ? 429 : 401, step);
      return reply(await radmin.setOwnerSecret(profileId, b.secret, ip));
    }
    if (path === '/api/skyid/recovery/owner-secret/step-up') {
      if (!profileId || !(await isOwner(profileId))) return json(res, 403, { error: 'owner_only' });
      return reply(await beginStepUp(profileId, 'recovery_owner_secret', { meta }));
    }
    return json(res, 404, { error: 'not_found' });
  }

  /* ── Сотрудники ── */
  const s = await requireProfile(req, res); if (!s) return true;
  if (!(await can(s.profileId, 'security'))) return json(res, 403, { error: 'not_allowed' });
  const meta = requestMeta(req);
  if (req.method === 'GET' && path === '/api/admin/recovery/history') {
    const sky = new URL(req.url, 'http://x').searchParams.get('skyId') ?? '';
    return json(res, 200, { items: sky ? await historyFor(sky, 100) : [] });
  }
  if (req.method === 'POST' && path === '/api/admin/recovery/step-up') return reply(await beginStepUp(s.profileId, 'recovery_staff', { meta }));
  if (req.method === 'POST' && path === '/api/admin/recovery/admin-token/revoke') {
    const step = await consumeStepUp(s.profileId, 'recovery_staff', b.stepUpCode, { meta });
    if (step.error) return json(res, step.error === 'step_up_exhausted' ? 429 : 401, step);
    return reply(await radmin.revokeAdminToken(s.profileId, String(b.profileId ?? ''), b.reason, ip));
  }
  return json(res, 404, { error: 'not_found' });
};
