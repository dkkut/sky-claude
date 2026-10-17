import { json, requireProfile, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can } from './../admin.mjs';
import { requestMeta, logAdmin } from './../adminsec.mjs';
import { searchEvents, exportEvents, summary, saveSettings, getSettings, verifyChain, telemetryEnabled, logEvent, CATEGORIES, LEVELS } from './../skylog.mjs';

const FILTERS = ['category', 'level', 'minLevel', 'result', 'type', 'service', 'actor', 'requestId', 'q', 'from', 'to', 'before'];
const pick = (params) => Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v));

/** Ячейка CSV: кавычки удваиваются; значения, похожие на формулу, не исполняются в Excel. */
const cell = (v) => {
  let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/**
 * Единые журналы Sky.
 *  • Сотрудникам с правом `logs`: GET /api/admin/logs[/summary|/export], POST /api/admin/logs/verify, GET|PUT /api/admin/logs/settings.
 *  • Приложениям: POST /api/telemetry — пачка клиентских событий (ошибки, сбои), без содержимого и секретов.
 */
export const skyLogsRoutes = async (req, res, url) => {
  const path = url.split('?')[0];

  if (path === '/api/telemetry') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const s = await requireProfile(req, res);
    if (!s) return true;
    if (!rateLimit(`telemetry:${s.profileId}`, 12)) return json(res, 429, { error: 'too_many_requests' });
    if (!(await telemetryEnabled())) return json(res, 204, {});
    const body = (await parseBody(req)) ?? {};
    const list = (Array.isArray(body.events) ? body.events : []).slice(0, 20);
    const meta = requestMeta(req);
    for (const e of list) {
      const level = ['INFO', 'WARN', 'ERROR', 'CRITICAL'].includes(e?.level) ? e.level : 'ERROR';
      logEvent({
        category: 'client', service: String(e?.platform ?? 'web').slice(0, 20), type: String(e?.type ?? 'client_error').replace(/[^\w.:-]/g, '_').slice(0, 60), level,
        actorId: s.profileId, result: level === 'INFO' ? 'ok' : 'error', reason: String(e?.message ?? '').slice(0, 200), ip: clientIp(req), ua: req.headers['user-agent'],
        detail: { route: String(e?.route ?? '').replace(/[0-9a-f-]{20,}/gi, ':id').slice(0, 120), appVersion: String(e?.appVersion ?? '').slice(0, 20), count: Math.min(999, Number(e?.count) || 1) },
      });
    }
    void meta;
    return json(res, 202, { accepted: list.length });
  }

  if (!path.startsWith('/api/admin/logs')) return false;
  const s = await requireProfile(req, res);
  if (!s) return true;
  const me = s.profileId;
  if (!(await can(me, 'logs'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`logs:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const params = new URL(req.url, 'http://x').searchParams;
  const meta = requestMeta(req);

  if (req.method === 'GET' && path === '/api/admin/logs') {
    const r = await searchEvents(pick(params), params.get('limit'));
    return json(res, 200, { ...r, categories: CATEGORIES, levels: LEVELS });
  }
  if (req.method === 'GET' && path === '/api/admin/logs/summary') return json(res, 200, { ...(await summary()), settings: await getSettings() });
  if (req.method === 'GET' && path === '/api/admin/logs/export') {
    if (!rateLimit(`logs:export:${me}`, 6)) return json(res, 429, { error: 'too_many_requests' });
    const rows = await exportEvents(pick(params), params.get('max'));
    const fmt = params.get('format') === 'json' ? 'json' : 'csv';
    await logAdmin({ actorId: me, targetType: 'system', type: 'logs_export', detail: `${fmt}, записей ${rows.length}`, meta });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    if (fmt === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="sky-logs-${stamp}.json"`, 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(rows));
      return true;
    }
    const head = ['id', 'time', 'category', 'level', 'type', 'service', 'actor', 'target', 'result', 'reason', 'device', 'request', 'detail'];
    const body = rows.map((r) => [r.id, r.at, r.category, r.level, r.type, r.service, r.actorId, r.targetId, r.result, r.reason, r.device, r.requestId, r.detail].map(cell).join(','));
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sky-logs-${stamp}.csv"`, 'X-Content-Type-Options': 'nosniff' });
    res.end(`﻿${head.join(',')}\r\n${body.join('\r\n')}\r\n`);
    return true;
  }
  if (req.method === 'POST' && path === '/api/admin/logs/verify') {
    const r = await verifyChain(Number(params.get('limit')) || 20000);
    await logAdmin({ actorId: me, targetType: 'system', type: 'logs_verify', result: r.ok ? 'ok' : 'error', detail: r.ok ? `цепочка цела, записей ${r.checked}` : `разрыв на ${r.brokenAt}: ${r.why}`, meta });
    return json(res, 200, r);
  }
  if (path === '/api/admin/logs/settings') {
    if (req.method === 'GET') return json(res, 200, await getSettings());
    if (req.method === 'PUT') {
      const body = (await parseBody(req)) ?? {};
      const r = await saveSettings(me, body);
      if (r.error) return json(res, 400, r);
      await logAdmin({ actorId: me, targetType: 'system', type: 'logs_settings', detail: Object.keys(body).join(', '), meta });
      return json(res, 200, r);
    }
  }
  return json(res, 404, { error: 'not_found' });
};
