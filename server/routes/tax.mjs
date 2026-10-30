/**
 * Sky Tax: /api/tax/* — кабинет субъекта (Sky, бизнес, продавец, исполнитель); /api/admin/tax/* — раздел администрации (право `tax`);
 * публичная печатная страница документа /api/tax/doc/<защищённая ссылка> (открывается из письма покупателя).
 * Доступ к scope решает сервер (`resolveScope`): чужой или несуществующий scope — всегда 404, без подсказок.
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta, logAdmin } from './../adminsec.mjs';
import { accessOf } from './../kbstaff.mjs';
import { verifySkyTwoFactor } from './../skyid.mjs';
import * as tx from './../taxcore.mjs';

const STATUS = { not_found: 404, not_allowed: 403, bad_state: 409, classification_required: 409, subject_incomplete: 409, not_enabled: 409, reason_required: 400, bad_amount: 400, individual_not_supported: 403, status_verified_elsewhere: 409,
  provider_not_available: 400, provider_not_for_status: 409, no_integration: 409, owner_only: 403, step_up_required: 401, step_up_invalid: 401, two_factor_required: 401, too_many_requests: 429, manual_not_allowed: 409 };
const deps = { can, isOwner, accessOf };

export const taxRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  /* публичная страница документа */
  if (p.startsWith('/api/tax/doc/')) {
    if (req.method !== 'GET') return json(res, 405, { error: 'method' });
    const page = await tx.docPage(decodeURIComponent(p.slice('/api/tax/doc/'.length)), u.searchParams.get('print') === '1');
    res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
    return res.end(page ?? '<!doctype html><meta charset="utf-8"><title>Sky</title><p style="font-family:sans-serif;padding:40px">Ссылка недействительна.</p>');
  }
  const isAdmin = p.startsWith('/api/admin/tax');
  if (!isAdmin && !p.startsWith('/api/tax/')) return false;

  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId; const meta = requestMeta(req);
  if (!rateLimit(`tax:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
  const reply = (r, ok = 200) => json(res, r?.error ? (STATUS[r.error] ?? 400) : ok, r);
  const m = req.method; const body = m === 'GET' ? {} : ((await parseBody(req)) ?? {});

  /* ─── администрация ─── */
  if (isAdmin) {
    const owner = await isOwner(me);
    if (!owner && !(await can(me, 'tax'))) return json(res, 403, { error: 'not_allowed' });
    const sub = p.slice('/api/admin/tax'.length).replace(/^\//, '');
    if (m === 'GET' && sub === 'overview') return json(res, 200, { ...(await tx.overview()), isOwner: owner });
    if (m === 'GET' && sub === 'ops') return json(res, 200, { ops: await tx.listOps(u.searchParams.get('scope') || null, { status: u.searchParams.get('status') || '', q: u.searchParams.get('q') || '', from: u.searchParams.get('from') || '', to: u.searchParams.get('to') || '', limit: u.searchParams.get('limit'), offset: u.searchParams.get('offset') }) });
    if (m === 'GET' && sub === 'docs') return json(res, 200, { docs: await tx.listDocs(u.searchParams.get('scope') || null, { q: u.searchParams.get('q') || '', from: u.searchParams.get('from') || '', to: u.searchParams.get('to') || '', limit: u.searchParams.get('limit'), offset: u.searchParams.get('offset') }) });
    if (m === 'GET' && sub === 'log') return json(res, 200, { log: await tx.listLog(u.searchParams.get('scope') || null, { limit: u.searchParams.get('limit'), offset: u.searchParams.get('offset') }) });
    if (m === 'POST' && sub === 'step-up') { if (!owner) return json(res, 403, { error: 'owner_only' }); const purpose = body.purpose === 'tax_live' ? 'tax_live' : 'tax_settings'; const r = await beginStepUp(me, purpose, { meta }); return json(res, r.error ? 400 : 200, r); }
    if (m === 'PUT' && sub === 'global') {
      // реальная передача данных включается глобально ТОЛЬКО владельцем, с кодом подтверждения
      if (!owner) return json(res, 403, { error: 'owner_only' });
      const s = await consumeStepUp(me, 'tax_live', body.stepUpCode, { meta }); if (s.error) return json(res, s.error === 'step_up_exhausted' ? 429 : 401, s);
      const r = await tx.setGlobal(me, body); if (!r.error) await logAdmin({ actorId: me, type: 'tax_global', targetType: 'system', detail: Object.keys(body).filter((k) => k !== 'stepUpCode').join(','), meta });
      return reply(r);
    }
    return json(res, 404, { error: 'not_found' });
  }

  /* ─── кабинет субъекта ─── */
  const sub = p.slice('/api/tax/'.length);
  if (m === 'GET' && sub === 'scopes') return json(res, 200, { scopes: await tx.myScopes(me, deps), global: { liveEnabled: (await tx.getGlobal()).liveEnabled } });
  if (m === 'GET' && sub === 'providers') return json(res, 200, { providers: tx.providerList(u.searchParams.get('taxStatus') || null) });
  const scopeKey = m === 'GET' ? u.searchParams.get('scope') : body.scope;
  const ctx = await tx.resolveScope(me, scopeKey, deps); if (!ctx || !ctx.canView) return json(res, 404, { error: 'not_found' });
  const sky = ctx.kind === 'sky';
  /** Опасные действия: Sky — код подтверждения владельца (step-up); остальные — код аутентификатора, если он включён. */
  const danger = async (purpose) => {
    if (!ctx.canManage) return { error: 'not_allowed' };
    if (sky) { const s = await consumeStepUp(me, purpose, body.stepUpCode, { meta }); return s.error ? { error: s.error } : null; }
    const tf = await verifySkyTwoFactor(session.skyId, body.twoFactorCode); return tf?.error ? { error: tf.error === 'invalid_code' ? 'two_factor_required' : tf.error } : null;
  };
  const adminLog = (type, detail) => sky ? logAdmin({ actorId: me, type, targetType: 'system', detail, meta }) : null;
  const gl = await tx.getGlobal();

  if (m === 'GET' && sub === 'subject') return json(res, 200, { subject: await tx.getSubjectView(ctx.scope), canManage: ctx.canManage, canOperate: ctx.canOperate, role: ctx.role, global: { liveEnabled: gl.liveEnabled, dueHours: gl.dueHours }, providers: tx.providerList() });
  if (m === 'POST' && sub === 'subject') {
    if (!ctx.canManage) return json(res, 403, { error: 'not_allowed' });
    if ('inn' in body) { const d = await danger('tax_settings'); if (d) return reply(d); }
    const r = await tx.saveSubject(ctx, me, body); if (!r.error) await adminLog('tax_subject', Object.keys(body).filter((k) => !['stepUpCode', 'twoFactorCode', 'scope', 'inn'].join(',').includes(k)).join(','));
    return reply(r);
  }
  if (m === 'PUT' && sub === 'mode') { if (!ctx.canManage) return json(res, 403, { error: 'not_allowed' }); if (sky) { const d = await danger('tax_settings'); if (d) return reply(d); } const r = await tx.setMode(ctx, me, body.mode); if (!r.error) await adminLog('tax_mode', body.mode); return reply(r); }
  if (m === 'POST' && sub === 'enabled') { if (!ctx.canManage) return json(res, 403, { error: 'not_allowed' }); const r = await tx.setEnabled(ctx, me, body.enabled === true); if (!r.error) await adminLog('tax_enabled', String(body.enabled === true)); return reply(r); }
  if (m === 'POST' && sub === 'live') {
    if (body.live === true && body.confirm !== true) return json(res, 400, { error: 'confirm_required' });
    const d = await danger(sky ? 'tax_live' : 'tax_settings'); if (d) return reply(d);
    const r = await tx.setLive(ctx, me, body.live === true); if (!r.error) await adminLog('tax_live', String(body.live === true)); return reply(r);
  }
  if (sub === 'integration') {
    const d = (m === 'PUT' || m === 'DELETE') ? await danger(sky ? 'tax_settings' : 'tax_settings') : (ctx.canManage ? null : { error: 'not_allowed' });
    if (d) return reply(d);
    if (m === 'PUT') { const r = await tx.saveIntegration(ctx, me, body); if (!r.error) await adminLog('tax_integration', body.provider); return reply(r); }
    if (m === 'DELETE') { const r = await tx.removeIntegration(ctx, me); if (!r.error) await adminLog('tax_integration_removed', ''); return reply(r); }
    if (m === 'POST') { if (!rateLimit(`taxtest:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' }); return reply(await tx.testIntegration(ctx, me)); }
  }
  if (!ctx.canOperate) return json(res, 403, { error: 'not_allowed' });
  if (m === 'GET' && sub === 'ops') return json(res, 200, { ops: await tx.listOps(ctx.scope, { status: u.searchParams.get('status') || '', q: u.searchParams.get('q') || '', from: u.searchParams.get('from') || '', to: u.searchParams.get('to') || '', kind: u.searchParams.get('kind') || '', limit: u.searchParams.get('limit'), offset: u.searchParams.get('offset') }) });
  if (m === 'POST' && sub === 'ops/confirm-all') { const r = await tx.confirmAll(ctx.scope, me); await adminLog('tax_confirm_all', String(r.confirmed)); return json(res, 200, r); }
  let mm;
  if (m === 'POST' && (mm = sub.match(/^ops\/([A-Za-z0-9-]{6,60})\/(confirm|reject|retry|classify|manual-doc)$/))) {
    const id = mm[1]; const a = mm[2]; let r;
    if (a === 'confirm' || a === 'reject') r = await tx.decide(ctx.scope, me, id, a, body.reason);
    else if (a === 'retry') r = await tx.retryOp(ctx.scope, me, id);
    else if (a === 'classify') r = await tx.classifyManual(ctx.scope, me, id, body.as, body.reason);
    else r = await tx.manualDoc(ctx.scope, me, id, body);
    if (!r.error) await adminLog(`tax_op_${a}`, id);
    return reply(r);
  }
  if (m === 'GET' && sub === 'docs') return json(res, 200, { docs: await tx.listDocs(ctx.scope, { q: u.searchParams.get('q') || '', from: u.searchParams.get('from') || '', to: u.searchParams.get('to') || '', limit: u.searchParams.get('limit'), offset: u.searchParams.get('offset') }) });
  if (m === 'POST' && (mm = sub.match(/^docs\/([A-Za-z0-9-]{6,60})\/(refund|resend)$/))) {
    const r = mm[2] === 'refund' ? await tx.refundDoc(ctx.scope, me, mm[1], body) : await tx.resendDoc(ctx.scope, me, mm[1]);
    if (!r.error) await adminLog(`tax_doc_${mm[2]}`, mm[1]); return reply(r);
  }
  if (m === 'GET' && sub === 'report') {
    const range = { from: u.searchParams.get('from') || '', to: u.searchParams.get('to') || '' };
    if (u.searchParams.get('format') === 'csv') { const c = await tx.reportCsv(ctx.scope, range); res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sky-tax.csv"', 'Cache-Control': 'no-store' }); return res.end('﻿' + c); }
    return json(res, 200, { report: await tx.report(ctx.scope, range) });
  }
  if (m === 'GET' && sub === 'log') return json(res, 200, { log: await tx.listLog(ctx.scope, { limit: u.searchParams.get('limit'), offset: u.searchParams.get('offset') }) });
  return json(res, 404, { error: 'not_found' });
};
