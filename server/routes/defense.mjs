/**
 * Самозащита и обнаружение утечек.
 *  • /api/admin/defense*  — админка (просмотр — право security; изменения — только владелец со step-up `defense_settings`);
 *  • /api/defense/undo/*  — публичная страница отмены по ссылке из письма (ссылка + код аутентификатора);
 *  • /api/guard/*         — сторож хоста (подпись HMAC GUARD_SECRET: время + метод + путь + хеш тела).
 */
import crypto from 'node:crypto';
import { json, requireProfile, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta, logAdmin } from './../adminsec.mjs';
import { getSettings, saveSettings } from './../defensecfg.mjs';
import { query } from './../db.mjs';
import { ipFp } from './../ipmask.mjs';
import * as sd from './../selfdefense.mjs';
import * as ld from './../leakdetect.mjs';

const badSig = new Map();
const secret = () => String(process.env.GUARD_SECRET ?? '');
const readRaw = (req) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > 64 * 1024) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
});
const guardAuth = (req, rawPath, raw) => {
  const key = secret(); if (key.length < 24) return 'guard_disabled';
  const ts = Number(req.headers['x-guard-ts']); const sig = String(req.headers['x-guard-sig'] ?? '');
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 120) return 'bad_time';
  const want = crypto.createHmac('sha256', key).update(`${ts}\n${req.method}\n${rawPath}\n${crypto.createHash('sha256').update(raw).digest('hex')}`).digest('hex');
  const a = Buffer.from(want); const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? null : 'bad_signature';
};

export const defenseRoutes = async (req, res, url) => {
  const ip = clientIp(req);
  /* ── Сторож хоста ── */
  if (url.startsWith('/api/guard/')) {
    if (!rateLimit(`guard:${ip}`, 120)) return json(res, 429, { error: 'too_many_requests' });
    let raw; try { raw = await readRaw(req); } catch { return json(res, 413, { error: 'too_large' }); }
    const bad = guardAuth(req, url, raw);
    if (bad) {
      // Неверная подпись — не «утечка»: любой может прислать мусор. Тревогу (блок АДРЕСА отправителя) поднимаем только при настойчивом переборе.
      if (bad !== 'guard_disabled') { badSig.set(ip, [...(badSig.get(ip) ?? []).filter((t) => Date.now() - t < 600_000), Date.now()]); if ((badSig.get(ip) ?? []).length >= 30) { badSig.delete(ip); void sd.handleSignal({ kind: 'probing', severity: 'medium', ip, subject: `ip:${ipFp(ip)}`, detail: { where: 'guard_sig' }, summary: 'Перебор подписи сторожа' }).catch(() => {}); } }
      return json(res, bad === 'guard_disabled' ? 404 : 403, { error: bad });
    }
    let body = {}; try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { return json(res, 400, { error: 'bad_json' }); }
    if (req.method === 'POST' && url === '/api/guard/report') return json(res, 200, await sd.guardReport(body));
    if (req.method === 'GET' && url === '/api/guard/commands') { await query('UPDATE defense_guard SET last_seen = now() WHERE id'); return json(res, 200, await sd.guardCommands()); }
    const m = url.match(/^\/api\/guard\/commands\/([\w-]{8,80})\/result$/);
    if (req.method === 'POST' && m) { const r = await sd.guardResult(m[1], body.ok === true, body.text); return json(res, r.error ? 404 : 200, r); }
    return json(res, 404, { error: 'not_found' });
  }

  /* ── Отмена по ссылке из письма (без входа) ── */
  if (url.startsWith('/api/defense/undo')) {
    if (!rateLimit(`defundo:${ip}`, 30)) return json(res, 429, { error: 'too_many_requests' });
    const u = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url === '/api/defense/undo/info') { const r = await sd.inspectUndo(u.searchParams.get('t')); return json(res, r.error ? 404 : 200, r); }
    if (req.method === 'POST' && url === '/api/defense/undo/confirm') {
      const b = (await parseBody(req)) ?? {};
      const r = await sd.confirmUndo(b.t, b.code, { actionIds: b.actionIds, falseAlarm: b.falseAlarm === true });
      return json(res, r.error ? (r.error === 'invalid_link' ? 404 : r.error === 'locked' ? 429 : r.error === 'bad_code' ? 401 : 400) : 200, r);
    }
    return json(res, 404, { error: 'not_found' });
  }

  if (!url.startsWith('/api/admin/defense') && !url.startsWith('/api/admin/leaks')) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId;
  if (!(await can(me, 'security'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`defadm:${me}`, 90)) return json(res, 429, { error: 'too_many_requests' });
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const meta = requestMeta(req);
  const owner = await isOwner(me);

  if (req.method === 'GET' && p === '/api/admin/leaks') return json(res, 200, { events: await ld.leakList({ status: u.searchParams.get('status'), kind: u.searchParams.get('kind'), limit: Number(u.searchParams.get('limit')) || 100 }) });
  if (req.method === 'GET' && p === '/api/admin/defense') {
    const [level, settings, incidents, guard, blocks, canaries] = await Promise.all([
      sd.getLevel(), getSettings(), sd.listIncidents(30),
      query('SELECT last_seen, info FROM defense_guard WHERE id').then((r) => r.rows[0] ?? null),
      query('SELECT ip_fp, ip_mask, reason, incident_id, expires_at FROM defense_ip_blocks WHERE expires_at > now() ORDER BY expires_at DESC LIMIT 100').then((r) => r.rows),
      query('SELECT id, label, hint, active, hits, last_hit_at, created_at FROM defense_canaries ORDER BY created_at DESC').then((r) => r.rows),
    ]);
    const open = (await query("SELECT count(*)::int AS n FROM leak_events WHERE status = 'open' AND created_at > now() - interval '7 days'")).rows[0].n;
    const guardAlive = Boolean(guard?.last_seen && Date.now() - guard.last_seen.getTime() < 10 * 60_000);
    return json(res, 200, { level, settings, incidents, openLeaks: open, canEdit: owner, secretConfigured: secret().length >= 24,
      guard: { alive: guardAlive, lastSeen: guard?.last_seen?.toISOString?.() ?? null, info: guard?.info ?? {} },
      blocks: blocks.map((b) => ({ ipFp: b.ip_fp, ip: b.ip_mask, reason: b.reason, incidentId: b.incident_id, expiresAt: b.expires_at.toISOString() })),
      canaries: canaries.map((c) => ({ id: c.id, label: c.label, hint: c.hint, active: c.active, hits: c.hits, lastHitAt: c.last_hit_at?.toISOString?.() ?? null })) });
  }
  const mi = p.match(/^\/api\/admin\/defense\/incidents\/([\w-]{8,80})$/);
  if (req.method === 'GET' && mi) { const r = await sd.getIncident(mi[1]); return r ? json(res, 200, r) : json(res, 404, { error: 'not_found' }); }

  // изменения — только владелец; отмена и пометки «ложная тревога» — любой сотрудник с правом security (откат уменьшает защиту, поэтому пишется в журнал)
  if (req.method === 'POST' && p === '/api/admin/defense/step-up') { if (!owner) return json(res, 403, { error: 'owner_only' }); const r = await beginStepUp(me, 'defense_settings', { meta }); return json(res, r.error ? 400 : 200, r); }
  const mark = p.match(/^\/api\/admin\/leaks\/([\w-]{8,80})\/mark$/);
  if (req.method === 'POST' && mark) { const b = (await parseBody(req)) ?? {}; const r = await ld.leakMark(mark[1], b.status); return json(res, r.error ? 400 : 200, r); }

  if (!owner) return json(res, 403, { error: 'owner_only' });
  const b = (req.method === 'GET' || req.method === 'DELETE') ? {} : ((await parseBody(req)) ?? {});
  const needCode = async () => { const s = await consumeStepUp(me, 'defense_settings', b.stepUpCode, { meta }); if (s.error) { json(res, s.error === 'step_up_exhausted' ? 429 : 401, s); return true; } return false; };

  if (req.method === 'PUT' && p === '/api/admin/defense/settings') {
    { const e = await needCode(); if (e) return true; }
    const r = await saveSettings(me, b.settings ?? {});
    if (!r.error) await logAdmin({ actorId: me, type: 'defense_settings', targetType: 'system', detail: 'изменены настройки самозащиты', meta });
    return json(res, r.error ? 400 : 200, r.error ? r : { ok: true, settings: await getSettings() });
  }
  if (req.method === 'POST' && p === '/api/admin/defense/level') {
    { const e = await needCode(); if (e) return true; }
    const r = await sd.setLevel(b.level, Number(b.hours) || 0, String(b.reason || 'вручную').slice(0, 150));
    await logAdmin({ actorId: me, type: 'defense_level', targetType: 'system', detail: `уровень ${r.level}`, meta });
    return json(res, 200, r);
  }
  if (req.method === 'POST' && p === '/api/admin/defense/drill') { const r = await sd.drill(); await logAdmin({ actorId: me, type: 'defense_drill', targetType: 'system', detail: 'учебная тревога', meta }); return json(res, 200, r); }
  if (req.method === 'POST' && p === '/api/admin/defense/integrity/rebaseline') { { const e = await needCode(); if (e) return true; } const r = await ld.rebaseline(); await logAdmin({ actorId: me, type: 'defense_rebaseline', targetType: 'system', detail: 'эталон кода обновлён', meta }); return json(res, 200, r); }
  if (req.method === 'POST' && p === '/api/admin/defense/integrity/check') return json(res, 200, await ld.integrityCheck());
  const ua = p.match(/^\/api\/admin\/defense\/actions\/([\w-]{8,80})\/undo$/);
  if (req.method === 'POST' && ua) { { const e = await needCode(); if (e) return true; } const r = await sd.undoOneById(ua[1], me); await logAdmin({ actorId: me, type: 'defense_undo', targetType: 'system', detail: `действие ${ua[1]}`, result: r.error ? 'error' : 'ok', meta }); return json(res, r.error ? 400 : 200, r); }
  if (req.method === 'POST' && p === '/api/admin/defense/canaries') {
    { const e = await needCode(); if (e) return true; }
    const label = String(b.label ?? '').trim(); if (label.length < 3) return json(res, 400, { error: 'bad_label' });
    const r = await ld.createCanary(me, label, b.hint); await logAdmin({ actorId: me, type: 'defense_canary', targetType: 'system', detail: `приманка «${label.slice(0, 40)}»`, meta });
    return json(res, 200, r);
  }
  const dc = p.match(/^\/api\/admin\/defense\/canaries\/([\w-]{8,80})$/);
  if (req.method === 'DELETE' && dc) { await query('UPDATE defense_canaries SET active = FALSE WHERE id = $1', [dc[1]]); ld.forgetCanaries(); return json(res, 200, { ok: true }); }
  const db = p.match(/^\/api\/admin\/defense\/blocks\/([0-9a-f]{16,64})$/);
  if (req.method === 'DELETE' && db) { await query('DELETE FROM defense_ip_blocks WHERE ip_fp = $1', [db[1]]); sd.forgetBlocks(); return json(res, 200, { ok: true }); }
  return json(res, 404, { error: 'not_found' });
};
