/**
 * Email-коммуникации: /api/admin/email* (право email_comms; Prime и SkyMoney — ещё и finance) и публичные /api/email/unsubscribe, /api/email/receipt/<токен>.
 * Вся логика — emailcomms.mjs; отправка идёт через общий notify.sendEmail.
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { requestMeta, logAdmin } from './../adminsec.mjs';
import * as ec from './../emailcomms.mjs';
import { renderReceiptPage, renderUnsubPage } from './../emailtpl.mjs';

const CODES = { not_found: 404, bad_token: 400, locked: 409, incomplete: 400, bad_date: 400, bad_url: 400, bad_kind: 400, bad_template: 400, no_recipients: 400, hourly_limit: 429, no_verified_email: 409, money_single_recipient: 400, subject_required: 400, bad_timezone: 400, bad_rate: 400 };
const status = (e) => CODES[e] ?? 400;

const html = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' }); res.end(body); };
const readRaw = (req) => new Promise((resolve) => { let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 10_000) req.destroy(); }); req.on('end', () => resolve(raw)); req.on('error', () => resolve('')); });

export const emailCommsRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;

  /* ─── публичные страницы ─── */
  if (p === '/api/email/unsubscribe') {
    if (req.method === 'GET') {
      const t = u.searchParams.get('t') || '';
      return html(res, 200, renderUnsubPage(ec.verifyUnsubToken(t) ? { token: t } : { error: true }));
    }
    if (req.method === 'POST') {
      const raw = await readRaw(req);
      const t = u.searchParams.get('t') || new URLSearchParams(raw).get('t') || '';
      const r = await ec.unsubscribe(t, u.searchParams.get('t') ? 'one_click' : 'link');
      const accepts = String(req.headers.accept || '');
      if (accepts.includes('text/html')) return html(res, r.error ? 400 : 200, renderUnsubPage(r.error ? { error: true } : { done: true }));
      return json(res, r.error ? 400 : 200, r.error ? r : { ok: true });
    }
    return json(res, 405, { error: 'method' });
  }
  if (p.startsWith('/api/email/receipt/')) {
    if (req.method !== 'GET') return json(res, 405, { error: 'method' });
    const data = await ec.receiptData(decodeURIComponent(p.slice('/api/email/receipt/'.length)));
    if (!data) return html(res, 404, renderUnsubPage({ error: true }));
    return html(res, 200, renderReceiptPage({ ...data, autoPrint: u.searchParams.get('print') === '1' }));
  }

  if (!p.startsWith('/api/admin/email')) return false;

  /* ─── админка ─── */
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId; const meta = requestMeta(req);
  if (!(await can(me, 'email_comms'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`emailadm:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const owner = await isOwner(me);
  const m = req.method; const sub = p.slice('/api/admin/email'.length).replace(/^\//, '');
  const body = m === 'GET' ? {} : ((await parseBody(req)) ?? {});

  if (m === 'GET' && sub === 'overview') {
    const [settings, templates, stats] = await Promise.all([ec.getSettings(), ec.listTemplates(), ec.stats()]);
    return json(res, 200, { settings, sender: ec.senderInfo(), templates, stats, canFinance: owner || await can(me, 'finance'), isOwner: owner });
  }
  if (m === 'GET' && sub === 'diagnose') return json(res, 200, await ec.diagnose());
  if (m === 'PUT' && sub === 'settings') {
    // автоотправка по деньгам и подпискам и параметры налога — только владелец
    const sensitive = ['primeAuto', 'moneyAuto', 'ofdTaxRatePct', 'ofdIncludeTopups'].some((k) => k in body);
    if (sensitive && !owner) return json(res, 403, { error: 'owner_only' });
    const r = await ec.saveSettings(me, body);
    if (!r.error) await logAdmin({ actorId: me, type: 'email_settings', targetType: 'system', detail: Object.keys(body).join(', '), meta });
    return json(res, r.error ? status(r.error) : 200, r);
  }
  if (m === 'GET' && sub === 'templates') return json(res, 200, { templates: await ec.listTemplates() });
  if (m === 'PUT' && sub.startsWith('templates/')) {
    const key = sub.slice('templates/'.length);
    const r = await ec.saveTemplate(me, key, body);
    if (!r.error) await logAdmin({ actorId: me, type: 'email_template', targetType: 'system', detail: key, meta });
    return json(res, r.error ? status(r.error) : 200, r);
  }
  if (m === 'POST' && sub === 'preview') { const r = await ec.preview(body); return json(res, r.error ? status(r.error) : 200, r); }
  if (m === 'POST' && sub === 'test') {
    if (!rateLimit(`emailtest:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' });
    const r = await ec.sendTest(me, body);
    if (!r.error) await logAdmin({ actorId: me, type: 'email_test', targetType: 'system', detail: String(body.templateKey || ''), meta });
    return json(res, r.error ? status(r.error) : 200, r);
  }

  /* рассылки */
  if (m === 'GET' && sub === 'campaigns') return json(res, 200, { campaigns: await ec.listCampaigns() });
  if (m === 'GET' && sub.startsWith('campaigns/') && !sub.endsWith('/schedule') && !sub.endsWith('/cancel')) { const c = await ec.getCampaign(sub.slice(10)); return c ? json(res, 200, { campaign: c }) : json(res, 404, { error: 'not_found' }); }
  if (m === 'POST' && sub === 'audience') return json(res, 200, { count: await ec.audienceCount(body.audience) });
  if (m === 'POST' && sub === 'campaigns') { const r = await ec.saveCampaign(me, null, body); return json(res, r.error ? status(r.error) : 200, r); }
  if (m === 'PUT' && sub.startsWith('campaigns/')) { const r = await ec.saveCampaign(me, sub.slice(10), body); return json(res, r.error ? status(r.error) : 200, r); }
  if (m === 'DELETE' && sub.startsWith('campaigns/')) { const r = await ec.deleteCampaign(sub.slice(10)); return json(res, r.error ? status(r.error) : 200, r); }
  if (m === 'POST' && /^campaigns\/[^/]+\/schedule$/.test(sub)) {
    const id = sub.split('/')[1];
    const r = await ec.scheduleCampaign(id, body.at);
    if (!r.error) await logAdmin({ actorId: me, type: 'email_campaign_send', targetType: 'system', detail: id, meta });
    return json(res, r.error ? status(r.error) : 200, r);
  }
  if (m === 'POST' && /^campaigns\/[^/]+\/cancel$/.test(sub)) {
    const id = sub.split('/')[1]; const r = await ec.cancelCampaign(id);
    if (!r.error) await logAdmin({ actorId: me, type: 'email_campaign_cancel', targetType: 'system', detail: id, meta });
    return json(res, r.error ? status(r.error) : 200, r);
  }

  /* адресная отправка */
  if (m === 'GET' && sub === 'users') return json(res, 200, { users: await ec.searchUsers(u.searchParams.get('q') || '') });
  if (m === 'GET' && sub === 'user-info') {
    const id = u.searchParams.get('id') || '';
    return json(res, 200, { prime: await ec.userPrimeInfo(id), payments: await ec.userMoneyPayments(id) });
  }
  if (m === 'POST' && sub === 'send') {
    // Prime и SkyMoney — служебные/финансовые письма: нужны оба права. Рассылку «от имени другого» и подмену данных сервер не принимает вовсе.
    if (['prime', 'money'].includes(body.kind) && !owner && !(await can(me, 'finance'))) return json(res, 403, { error: 'finance_required' });
    if (!rateLimit(`emailsend:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' });
    const r = await ec.manualSend(me, body);
    if (!r.error) await logAdmin({ actorId: me, type: 'email_manual_send', targetType: 'system', detail: `${body.kind}: ${r.results.filter((x) => x.status === 'queued').length}/${r.results.length}`, meta });
    return json(res, r.error ? status(r.error) : 200, r);
  }

  /* журнал и статистика */
  if (m === 'GET' && sub === 'journal') return json(res, 200, { items: await ec.journal({ kind: u.searchParams.get('kind') || '', status: u.searchParams.get('status') || '', q: u.searchParams.get('q') || '', limit: u.searchParams.get('limit'), offset: u.searchParams.get('offset') }) });
  if (m === 'GET' && sub === 'stats') return json(res, 200, await ec.stats());

  return json(res, 404, { error: 'not_found' });
};

/** Сводка «ОФД» (вкладка админки). Право finance. */
export const ofdRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  if (!p.startsWith('/api/admin/ofd')) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  if (!(await can(session.profileId, 'finance'))) return json(res, 403, { error: 'not_allowed' });
  if (req.method !== 'GET') return json(res, 405, { error: 'method' });
  if (!rateLimit(`ofd:${session.profileId}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  return json(res, 200, await ec.ofdSummary({ from: u.searchParams.get('from') || '', to: u.searchParams.get('to') || '' }));
};
