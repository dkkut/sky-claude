/**
 * Самозащита: сигнал (утечка/подозрение) → инцидент → автоматические защитные действия → письмо владельцу со ссылкой ОТМЕНЫ
 * (подтверждение — код аутентификатора). Работает и ДО взлома (упреждающие меры), и после (изоляция, восстановление).
 *
 * Принципы:
 *  • Каждое действие обратимо там, где это возможно (запись об отмене хранится в `undo_state`); необратимые помечены `reversible=false`.
 *  • Владелец и его адрес не блокируются автоматически (иначе нечем отменять); ссылки отмены и сторож (/api/defense/undo, /api/guard) вне блокировок.
 *  • Хостовые действия (восстановить код, пересоздать контейнеры, сменить JWT) выполняет только отдельный сторож на хосте (scripts/sky-guard.sh) —
 *    API лишь ставит команду в очередь, и только если сторож недавно выходил на связь.
 *  • Режим «учебная тревога» (drill) проходит весь путь, но действия только имитируются.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { config } from './config.mjs';
import { sendEmail } from './notify.mjs';
import { notifyGift } from './giftnotify.mjs';
import { sessionStore } from './sessions.mjs';
import { ipMask, ipFp } from './ipmask.mjs';
import { L } from './lang.mjs';
import { verifyTotp } from './totp.mjs';
import { decryptSecret } from './crypto.mjs';
import { logAdmin } from './adminsec.mjs';
import { forgetLockdown } from './admin.mjs';
import { getSettings } from './defensecfg.mjs';

const SEV = { low: 1, medium: 2, high: 3, critical: 4 };
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newId = (p) => `${p}-${crypto.randomUUID()}`;
const clip = (s, n) => String(s ?? '').slice(0, n);

export const KIND_LABEL = { mass_export: 'Массовая выгрузка данных', canary: 'Сработала приманка (canary-токен)', secret_in_request: 'Секрет сервера замечен в запросе',
  admin_anomaly: 'Подозрительные действия администратора', integrity: 'Изменены файлы кода или конфигурации', guard: 'Сторож хоста: отклонение', probing: 'Сканирование/подбор с одного адреса' };
export const ACTION_LABEL = { block_ip: 'Блокировка адреса', hold_account: 'Замораживание аккаунта', revoke_sessions: 'Завершение сессий', raise_level: 'Повышение уровня защиты',
  host_restore_code: 'Восстановление кода на сервере', host_recreate: 'Пересоздание контейнеров', host_rotate_jwt: 'Смена ключа подписи сессий' };

/* ─── Владелец ─── */
export const ownerInfo = async () => {
  const name = String(config.ownerUsername ?? '').trim().toLowerCase();
  if (!name) return null;
  const { rows } = await query(
    `SELECT p.id, p.sky_id, s.email, s.email_verified, s.two_factor_enabled, s.two_factor_secret FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE lower(p.username) = $1 LIMIT 1`, [name]);
  const r = rows[0]; if (!r) return null;
  return { id: r.id, skyId: r.sky_id, email: r.email_verified ? r.email : null, twoFactor: Boolean(r.two_factor_enabled), secret: r.two_factor_secret };
};
const isOwnerProfile = async (profileId) => { const o = await ownerInfo(); return Boolean(o && (o.id === profileId)); };

/* ─── Блокировки адресов (кэш) ─── */
let blocked = new Set(); let blockedAt = 0;
const refreshBlocks = async () => {
  try { blocked = new Set((await query('SELECT ip_fp FROM defense_ip_blocks WHERE expires_at > now()')).rows.map((r) => r.ip_fp)); blockedAt = Date.now(); } catch { /* таблицы нет */ }
};
export const isIpBlocked = (ip) => { if (Date.now() - blockedAt > 15_000) void refreshBlocks(); const f = ipFp(ip); return Boolean(f) && blocked.has(f); };
export const forgetBlocks = () => { blockedAt = 0; };

/* ─── Уровень защиты ─── */
export const getLevel = async () => {
  const { rows } = await query('SELECT level, until, reason, lockdown_by_us, set_at FROM defense_level WHERE id');
  const r = rows[0] ?? { level: 0 };
  return { level: r.level, until: r.until?.toISOString?.() ?? null, reason: r.reason ?? '', lockdownByUs: Boolean(r.lockdown_by_us), setAt: r.set_at?.toISOString?.() ?? null };
};
const lockdownActive = async () => Boolean((await query('SELECT active FROM admin_lockdown WHERE id')).rows[0]?.active);
/** Выставить уровень 0–3. Уровень ≥2 закрывает панель для всех, кроме владельца (если мы её закрыли — сами и откроем). */
export const setLevel = async (level, hours, reason) => {
  const lv = Math.max(0, Math.min(3, Number(level) | 0)); const s = await getSettings();
  const cur = await getLevel();
  let byUs = cur.lockdownByUs;
  if (lv >= 2 && s.actions.panel_lockdown !== false && !(await lockdownActive())) {
    // закрываем панель и завершаем сессии администраторов, КРОМЕ владельца: ему нужно мочь отменить и разобраться
    const why = clip(`Самозащита: уровень ${lv}. ${reason}`, 250);
    await query('UPDATE admin_lockdown SET active = TRUE, reason = $1, set_by = NULL, set_at = now() WHERE id', [why]); forgetLockdown();
    const o = await ownerInfo();
    const { rows } = await query('SELECT DISTINCT sky_id FROM profiles WHERE is_admin AND ($1::text IS NULL OR sky_id <> $1)', [o?.skyId ?? null]);
    let n = 0; for (const r of rows) n += await sessionStore.revokeAllForUser(r.sky_id).catch(() => 0);
    await logAdmin({ actorId: null, type: 'auto_lockdown', targetType: 'system', detail: `${why} · сессий закрыто: ${n}` }).catch(() => {});
    byUs = true; }
  if (lv < 2 && byUs) { await query('UPDATE admin_lockdown SET active = FALSE, reason = $1, set_by = NULL, set_at = now() WHERE id', ['Самозащита: угроза снята']); forgetLockdown(); byUs = false; }
  const until = lv > 0 ? new Date(Date.now() + (Number(hours) > 0 ? Number(hours) : [0, 1, 3, 6][lv]) * 3600_000) : null;
  await query('UPDATE defense_level SET level = $1, until = $2, reason = $3, lockdown_by_us = $4, set_at = now() WHERE id', [lv, until, clip(reason, 200), byUs]);
  return getLevel();
};

/* ─── Действия ─── */
const hostAlive = async () => { const r = (await query('SELECT last_seen FROM defense_guard WHERE id')).rows[0]; return Boolean(r?.last_seen && Date.now() - r.last_seen.getTime() < 10 * 60_000); };
const queueHost = async (kind, incidentId, actionId, params = {}) => {
  if (!(await hostAlive())) return { skip: 'guard_offline' };
  const id = newId('dhc');
  await query('INSERT INTO defense_host_cmds (id, incident_id, action_id, kind, params) VALUES ($1,$2,$3,$4,$5::jsonb)', [id, incidentId, actionId, kind, JSON.stringify(params)]);
  return { state: { cmdId: id } };
};

const ACTIONS = {
  async block_ip(p, ctx) {
    if (!p.ipFp) return { skip: 'no_ip' };
    if (p.local) return { skip: 'local_address' };   // свой хост/внутренняя сеть: блокировать нечего, можно запереть себя
    const hours = Math.max(1, Math.min(168, Number(p.hours) || ctx.settings.blockHours));
    const had = (await query('SELECT 1 FROM defense_ip_blocks WHERE ip_fp = $1 AND expires_at > now()', [p.ipFp])).rowCount;
    await query(`INSERT INTO defense_ip_blocks (ip_fp, ip_mask, reason, incident_id, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)
                 ON CONFLICT (ip_fp) DO UPDATE SET expires_at = GREATEST(defense_ip_blocks.expires_at, EXCLUDED.expires_at), incident_id = EXCLUDED.incident_id`, [p.ipFp, p.ipMask ?? '', clip(p.reason, 120), ctx.incidentId, String(hours)]);
    forgetBlocks(); await refreshBlocks();
    return { state: { ipFp: p.ipFp, existed: Boolean(had) } };
  },
  async hold_account(p, ctx) {
    if (!p.profileId) return { skip: 'no_profile' };
    if (await isOwnerProfile(p.profileId)) return { skip: 'owner_protected' };
    const { rows } = await query('SELECT s.id, s.blocked_until, s.blocked_reason FROM profiles pr JOIN sky_ids s ON s.id = pr.sky_id WHERE pr.id = $1', [p.profileId]);
    const r = rows[0]; if (!r) return { skip: 'not_found' };
    if (r.blocked_until && r.blocked_until > new Date()) return { skip: 'already_blocked' };   // чужую блокировку не перетираем
    const hours = Math.max(1, Math.min(168, Number(p.hours) || ctx.settings.holdHours));
    await query(`UPDATE sky_ids SET blocked_until = now() + ($2 || ' hours')::interval, blocked_reason = $3 WHERE id = $1`, [r.id, String(hours), `defense:${ctx.incidentId}`]);
    await sessionStore.revokeAllForUser(r.id).catch(() => {});
    return { state: { skyId: r.id, prevUntil: r.blocked_until?.toISOString?.() ?? null, prevReason: r.blocked_reason ?? null } };
  },
  async revoke_sessions(p) {
    const skyId = p.skyId ?? (p.profileId ? (await query('SELECT sky_id FROM profiles WHERE id = $1', [p.profileId])).rows[0]?.sky_id : null);
    if (!skyId) return { skip: 'no_subject' };
    if (p.profileId && (await isOwnerProfile(p.profileId))) return { skip: 'owner_protected' };
    const n = await sessionStore.revokeAllForUser(skyId);
    return { state: { revoked: n }, irreversible: true };
  },
  async raise_level(p) {
    const prev = await getLevel();
    if (prev.level >= p.level) return { skip: 'already_higher' };
    await setLevel(p.level, p.hours, p.reason || 'самозащита');
    return { state: { prevLevel: prev.level, prevUntil: prev.until } };
  },
  async host_restore_code(p, ctx) { const r = await queueHost('restore_code', ctx.incidentId, ctx.actionId, p); return r.skip ? r : { ...r, irreversible: true }; },
  async host_recreate(p, ctx) { const r = await queueHost('recreate_containers', ctx.incidentId, ctx.actionId, p); return r.skip ? r : { ...r, irreversible: true }; },
  async host_rotate_jwt(p, ctx) { return queueHost('rotate_jwt', ctx.incidentId, ctx.actionId, p); },
};
const UNDO = {
  async block_ip(st) { if (!st.existed) { await query('DELETE FROM defense_ip_blocks WHERE ip_fp = $1', [st.ipFp]); forgetBlocks(); await refreshBlocks(); } },
  async hold_account(st) {
    // снимаем только своё: если блокировку с тех пор поставил кто-то другой, не трогаем
    await query(`UPDATE sky_ids SET blocked_until = $2, blocked_reason = $3 WHERE id = $1 AND blocked_reason LIKE 'defense:%'`, [st.skyId, st.prevUntil, st.prevReason ?? '']);
  },
  async raise_level(st) { await setLevel(st.prevLevel, st.prevUntil ? Math.max(1, (Date.parse(st.prevUntil) - Date.now()) / 3600_000) : 0, 'отмена владельцем'); },
  async host_rotate_jwt(st, ctx) {
    const c = (await query('SELECT status FROM defense_host_cmds WHERE id = $1', [st.cmdId])).rows[0];
    if (c?.status === 'pending') { await query("UPDATE defense_host_cmds SET status = 'cancelled', done_at = now() WHERE id = $1 AND status = 'pending'", [st.cmdId]); return; }
    if (c?.status === 'done') { const r = await queueHost('restore_jwt', ctx.incidentId, ctx.actionId, { of: st.cmdId }); if (r.skip) throw new Error(r.skip); }
  },
};

/* ─── План по сигналу ─── */
export const planActions = (sig) => {
  const A = []; const ip = sig.ip ? { ipFp: ipFp(sig.ip), ipMask: ipMask(sig.ip), reason: sig.kind, local: /^(::1$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|unknown$)/i.test(String(sig.ip)) } : null;
  const prof = sig.profileId ? { profileId: sig.profileId } : null;
  const sev = SEV[sig.severity] ?? 1;
  switch (sig.kind) {
    case 'mass_export':
      if (sev >= 3) { if (ip) A.push(['block_ip', ip]); if (prof) A.push(['hold_account', prof]); A.push(['raise_level', { level: 1, hours: 2, reason: 'массовая выгрузка' }]); }
      else A.push(['raise_level', { level: 1, hours: 1, reason: 'повышенная выгрузка' }]);
      break;
    case 'probing': if (ip) A.push(['block_ip', { ...ip, hours: 2 }]); break;
    case 'canary': case 'secret_in_request':
      if (ip) A.push(['block_ip', { ...ip, hours: 24 }]); if (prof) A.push(['hold_account', prof]);
      A.push(['raise_level', { level: 3, hours: 6, reason: sig.kind === 'canary' ? 'сработала приманка' : 'секрет в запросе' }]); A.push(['host_rotate_jwt', { reason: sig.kind }]);
      break;
    case 'admin_anomaly':
      if (sev >= 3) { if (prof) A.push(['revoke_sessions', prof]); if (prof) A.push(['hold_account', prof]); A.push(['raise_level', { level: 2, hours: 3, reason: 'подозрительный администратор' }]); }
      else A.push(['raise_level', { level: 1, hours: 2, reason: 'необычные действия администратора' }]);
      break;
    case 'integrity':
      A.push(['raise_level', { level: 3, hours: 6, reason: 'изменён код/конфигурация' }]); A.push(['host_restore_code', { reason: 'integrity' }]); A.push(['host_recreate', { reason: 'integrity' }]);
      break;
    case 'guard':
      if (sev >= 4) { A.push(['raise_level', { level: 3, hours: 6, reason: 'сторож хоста: критично' }]); if (sig.heal !== false) { A.push(['host_restore_code', { reason: 'guard' }]); A.push(['host_recreate', { reason: 'guard' }]); } }
      else if (sev >= 3) A.push(['raise_level', { level: 2, hours: 3, reason: 'сторож хоста: отклонение' }]);
      break;
    default: break;
  }
  return A;
};
const ALLOW_KEY = { block_ip: 'block_ip', hold_account: 'hold_account', revoke_sessions: 'revoke_sessions', raise_level: 'raise_level', host_restore_code: 'host_restore_code', host_recreate: 'host_recreate', host_rotate_jwt: 'host_rotate_jwt' };

const runAction = async (incident, kind, params, settings) => {
  const id = newId('dac'); const target = clip(params.profileId ?? params.ipMask ?? params.skyId ?? kind, 120);
  await query('INSERT INTO defense_actions (id, incident_id, kind, target, params) VALUES ($1,$2,$3,$4,$5::jsonb)', [id, incident.id, kind, target, JSON.stringify(params)]);
  const done = async (status, extra = {}) => query('UPDATE defense_actions SET status = $2, undo_state = $3::jsonb, reversible = $4, error = $5, executed_at = now() WHERE id = $1',
    [id, status, JSON.stringify(extra.state ?? {}), extra.reversible ?? true, clip(extra.error ?? '', 200)]);
  if (incident.mode === 'drill') { await done('simulated'); return id; }
  if (incident.mode === 'notify' || settings.mode === 'notify' || !settings.actions[ALLOW_KEY[kind]]) { await done('skipped', { error: incident.mode === 'notify' || settings.mode === 'notify' ? 'notify_only' : 'disabled' }); return id; }
  try {
    const r = await ACTIONS[kind](params, { incidentId: incident.id, actionId: id, settings });
    if (r?.skip) await done('skipped', { error: r.skip }); else await done('done', { state: r?.state, reversible: !r?.irreversible });
  } catch (e) { await done('failed', { error: e.message }); }
  return id;
};

/* ─── Сигнал → инцидент ─── */
export const handleSignal = async (sig) => {
  const s = await getSettings();
  if (!s.enabled && sig.mode !== 'drill') return { skipped: 'disabled' };
  const subject = sig.subject || (sig.profileId ? `profile:${sig.profileId}` : sig.ip ? `ip:${ipFp(sig.ip)}` : 'system');
  const evId = newId('lke');
  // одинаковый сигнал в течение 10 минут — одна запись со счётчиком (без повторных действий и писем)
  if (sig.mode !== 'drill') {
    const dup = (await query(`SELECT id, detail FROM leak_events WHERE kind = $1 AND subject = $2 AND created_at > now() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1`, [sig.kind, subject])).rows[0];
    if (dup) { await query(`UPDATE leak_events SET detail = jsonb_set(detail, '{count}', to_jsonb(COALESCE((detail->>'count')::int, 1) + 1)) WHERE id = $1`, [dup.id]); return { duplicate: true, eventId: dup.id }; }
  }
  const mode = sig.mode === 'drill' ? 'drill' : (s.mode === 'notify' ? 'notify' : 'auto');
  await query('INSERT INTO leak_events (id, kind, severity, subject, ip_mask, detail) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
    [evId, sig.kind, sig.severity, clip(subject, 120), ipMask(sig.ip ?? ''), JSON.stringify({ ...(sig.detail ?? {}), count: 1, drill: mode === 'drill' || undefined })]);
  const plan = planActions(sig);
  if (!plan.length && (SEV[sig.severity] ?? 1) < 3 && mode !== 'drill') return { recorded: true, eventId: evId };

  // слияние с открытым инцидентом по тому же субъекту
  let inc = mode === 'drill' ? null : (await query(`SELECT * FROM defense_incidents WHERE subject = $1 AND status = 'active' AND mode <> 'drill' AND created_at > now() - interval '30 minutes' ORDER BY created_at DESC LIMIT 1`, [subject])).rows[0];
  if (!inc) {
    const id = newId('dinc');
    await query('INSERT INTO defense_incidents (id, title, severity, mode, subject, summary) VALUES ($1,$2,$3,$4,$5,$6)', [id, clip(`${mode === 'drill' ? 'УЧЕНИЕ: ' : ''}${KIND_LABEL[sig.kind] ?? sig.kind}`, 140), sig.severity, mode, clip(subject, 120), clip(sig.summary ?? '', 400)]);
    inc = (await query('SELECT * FROM defense_incidents WHERE id = $1', [id])).rows[0];
  } else if ((SEV[sig.severity] ?? 0) > (SEV[inc.severity] ?? 0)) await query('UPDATE defense_incidents SET severity = $2 WHERE id = $1', [inc.id, sig.severity]);
  await query('UPDATE leak_events SET incident_id = $2 WHERE id = $1', [evId, inc.id]);

  const have = new Set((await query('SELECT kind, target FROM defense_actions WHERE incident_id = $1', [inc.id])).rows.map((r) => `${r.kind}:${r.target}`));
  const created = [];
  for (const [kind, params] of plan) {
    const target = clip(params.profileId ?? params.ipMask ?? params.skyId ?? kind, 120);
    if (have.has(`${kind}:${target}`)) continue;
    created.push(await runAction(inc, kind, params, s));
  }
  const mail = await notifyOwner(inc.id, evId);
  return { incidentId: inc.id, eventId: evId, actions: created.length, mail };
};

/* ─── Письмо владельцу ─── */
let mailWindow = [];
const mailAllowed = () => { const t = Date.now(); mailWindow = mailWindow.filter((x) => t - x < 3600_000); if (mailWindow.length >= 8) return false; mailWindow.push(t); return true; };

const describeActions = (acts) => acts.map((a) => {
  const st = { done: 'выполнено', simulated: 'учебное (не выполнялось)', skipped: `пропущено${a.error ? ` (${a.error})` : ''}`, failed: `не вышло (${a.error})`, undone: 'отменено', pending: 'в работе' }[a.status] ?? a.status;
  return `• ${ACTION_LABEL[a.kind] ?? a.kind}${a.target && a.target !== a.kind ? ` — ${a.target}` : ''}: ${st}${a.status === 'done' && !a.reversible ? ' (необратимо)' : ''}`;
}).join('\n');

export const notifyOwner = async (incidentId, eventId) => {
  const inc = (await query('SELECT * FROM defense_incidents WHERE id = $1', [incidentId])).rows[0]; if (!inc) return 'no_incident';
  const owner = await ownerInfo(); if (!owner) return 'owner_missing';
  const acts = (await query('SELECT kind, target, status, reversible, error FROM defense_actions WHERE incident_id = $1 ORDER BY created_at', [incidentId])).rows;
  const ev = eventId ? (await query('SELECT kind, severity, ip_mask, detail FROM leak_events WHERE id = $1', [eventId])).rows[0] : null;
  const drill = inc.mode === 'drill';
  // запись в «Уведомления» (+push) — всегда; письмо — с ограничением частоты
  void notifyGift(owner.id, 'defense', clip(`${drill ? 'Учение: ' : ''}Самозащита: ${inc.title}`, 120), clip(`Действий: ${acts.length}. Отмена — по ссылке из письма или в админке («Самозащита»).`, 240), `def:${inc.id}:${acts.length}`).catch(() => {});
  if (!owner.email) return 'no_email';
  if (!drill && !mailAllowed()) return 'mail_limited';
  const s = await getSettings();
  const token = crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO defense_undo_links (token_hash, incident_id, expires_at) VALUES ($1,$2, now() + ($3 || ' days')::interval)`, [sha(`undo:${token}`), incidentId, String(s.undoLinkDays)]);
  await query('UPDATE defense_incidents SET last_mail_at = now() WHERE id = $1', [incidentId]);
  const link = `${config.publicOrigin}/defense-undo?t=${token}`;
  const when = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const body = L(
    `${drill ? 'ЭТО УЧЕНИЕ — реальных действий не было.\n\n' : ''}Самозащита Sky сработала (${when} UTC, уровень: ${inc.severity}).\n\nЧто случилось: ${inc.title}\n${ev ? `Источник: ${ev.ip_mask || 'адрес не определён'}\n` : ''}\nЧто сделано автоматически:\n${describeActions(acts) || '• действий не потребовалось — только запись'}\n\n`
    + `Если это ложная тревога или вы хотите вернуть всё как было, откройте ссылку и подтвердите кодом из аутентификатора (действует ${s.undoLinkDays} дн.):\n${link}\n\nЕсли тревога настоящая — ничего делать не нужно: защита уже работает.`,
    `${drill ? 'THIS IS A DRILL — nothing was actually done.\n\n' : ''}Sky self-defense was triggered (${when} UTC, severity: ${inc.severity}).\n\nWhat happened: ${inc.title}\n${ev ? `Source: ${ev.ip_mask || 'address unknown'}\n` : ''}\nAutomatic actions:\n${describeActions(acts) || '• none needed — logged only'}\n\n`
    + `If this is a false alarm or you want to revert, open the link and confirm with your authenticator code (valid for ${s.undoLinkDays} days):\n${link}\n\nIf the alarm is real, do nothing: protection is already active.`);
  try { const r = await sendEmail(owner.email, L(`${drill ? '[УЧЕНИЕ] ' : ''}Sky: сработала самозащита`, `${drill ? '[DRILL] ' : ''}Sky: self-defense triggered`), body); return r && r.ok === false ? 'email_failed' : 'sent'; }
  catch (e) { console.error('[defense] письмо:', e.message); return 'email_failed'; }
};

/* ─── Отмена ─── */
const undoOne = async (a, via) => {
  if (!['done', 'simulated'].includes(a.status)) return { error: 'not_active' };
  if (a.status === 'done' && !a.reversible) return { error: 'not_reversible' };
  if (a.status === 'done') { const fn = UNDO[a.kind]; if (fn) { try { await fn(a.undo_state, { incidentId: a.incident_id, actionId: a.id }); } catch (e) { return { error: 'undo_failed', detail: clip(e.message, 100) }; } } }
  await query("UPDATE defense_actions SET status = 'undone', undone_at = now(), undone_via = $2 WHERE id = $1", [a.id, via]);
  return { ok: true };
};
const closeIfDone = async (incidentId) => {
  const left = (await query("SELECT count(*)::int AS n FROM defense_actions WHERE incident_id = $1 AND status = 'done'", [incidentId])).rows[0].n;
  if (!left) await query("UPDATE defense_incidents SET status = 'cancelled', closed_at = now() WHERE id = $1 AND status = 'active'", [incidentId]);
};
export const undoActions = async (incidentId, ids, via) => {
  const acts = (await query('SELECT * FROM defense_actions WHERE incident_id = $1 AND ($2::text[] IS NULL OR id = ANY($2)) ORDER BY created_at DESC', [incidentId, ids ?? null])).rows;
  const out = [];
  for (const a of acts) { if (!['done', 'simulated'].includes(a.status)) continue; out.push({ id: a.id, kind: a.kind, ...(await undoOne(a, via)) }); }
  await closeIfDone(incidentId);
  return out;
};
export const markFalsePositive = async (incidentId) => query("UPDATE leak_events SET status = 'false_positive' WHERE incident_id = $1 AND status = 'open'", [incidentId]);

const linkRow = async (token) => {
  const t = String(token ?? ''); if (!/^[A-Za-z0-9_-]{30,80}$/.test(t)) return null;
  return (await query('SELECT * FROM defense_undo_links WHERE token_hash = $1 AND expires_at > now()', [sha(`undo:${t}`)])).rows[0] ?? null;
};
const shapeAct = (a) => ({ id: a.id, kind: a.kind, label: ACTION_LABEL[a.kind] ?? a.kind, target: a.target, status: a.status, reversible: a.reversible, error: a.error, executedAt: a.executed_at?.toISOString?.() ?? null });
export const inspectUndo = async (token) => {
  const l = await linkRow(token); if (!l) return { error: 'invalid_link' };
  const inc = (await query('SELECT * FROM defense_incidents WHERE id = $1', [l.incident_id])).rows[0]; if (!inc) return { error: 'invalid_link' };
  const acts = (await query('SELECT * FROM defense_actions WHERE incident_id = $1 ORDER BY created_at', [l.incident_id])).rows;
  const evs = (await query('SELECT kind, severity, ip_mask, created_at FROM leak_events WHERE incident_id = $1 ORDER BY created_at', [l.incident_id])).rows;
  return { ok: true, incident: { id: inc.id, title: inc.title, severity: inc.severity, status: inc.status, drill: inc.mode === 'drill', createdAt: inc.created_at.toISOString() },
    events: evs.map((e) => ({ kind: e.kind, label: KIND_LABEL[e.kind] ?? e.kind, severity: e.severity, ip: e.ip_mask, at: e.created_at.toISOString() })), actions: acts.map(shapeAct) };
};
export const confirmUndo = async (token, code, { actionIds = null, falseAlarm = false } = {}) => {
  const l = await linkRow(token); if (!l) return { error: 'invalid_link' };
  if (l.locked_until && l.locked_until > new Date()) return { error: 'locked' };
  const owner = await ownerInfo(); if (!owner) return { error: 'owner_missing' };
  if (!owner.twoFactor) return { error: 'two_factor_required' };
  const key = decryptSecret(owner.secret);
  const good = Boolean(key) && verifyTotp(key, String(code ?? '').replace(/\s+/g, ''));
  if (!good) {
    const r = (await query(`UPDATE defense_undo_links SET locked_until = CASE WHEN attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
        attempts = CASE WHEN attempts + 1 >= 5 THEN 0 ELSE attempts + 1 END WHERE token_hash = $1 RETURNING attempts, locked_until`, [l.token_hash])).rows[0];
    return r?.locked_until && r.locked_until > new Date() ? { error: 'locked' } : { error: 'bad_code', left: 5 - (r?.attempts ?? 0) };
  }
  await query('UPDATE defense_undo_links SET attempts = 0 WHERE token_hash = $1', [l.token_hash]);
  const results = await undoActions(l.incident_id, Array.isArray(actionIds) && actionIds.length ? actionIds.map(String) : null, 'link');
  if (falseAlarm) await markFalsePositive(l.incident_id);
  await logAdmin({ actorId: owner.id, type: 'defense_undo', targetType: 'system', detail: clip(`инцидент ${l.incident_id}: отменено ${results.filter((r) => r.ok).length}${falseAlarm ? ' · ложная тревога' : ''}`, 200) }).catch(() => {});
  return { ok: true, results };
};

/* ─── Сторож хоста ─── */
export const guardReport = async (body) => {
  const info = { version: clip(body?.version, 20), host: clip(body?.host, 60), baseline: Boolean(body?.baseline), ok: Boolean(body?.ok), checkedAt: new Date().toISOString(), findings: Array.isArray(body?.findings) ? body.findings.length : 0 };
  await query('UPDATE defense_guard SET last_seen = now(), info = $1::jsonb WHERE id', [JSON.stringify(info)]);
  const out = [];
  for (const f of (Array.isArray(body?.findings) ? body.findings : []).slice(0, 10)) {
    const sev = ['high', 'critical', 'medium', 'low'].includes(f.severity) ? f.severity : 'high';
    out.push(await handleSignal({ kind: f.kind === 'integrity' ? 'integrity' : 'guard', severity: sev, subject: `system:guard:${clip(f.code ?? f.kind, 30)}`, detail: { code: clip(f.code, 40), what: clip(f.detail, 200) }, summary: clip(f.detail, 200), heal: f.heal }));
  }
  return { ok: true, handled: out.length };
};
export const guardCommands = async () => {
  const { rows } = await query("UPDATE defense_host_cmds SET status = 'running' WHERE id IN (SELECT id FROM defense_host_cmds WHERE status = 'pending' ORDER BY created_at LIMIT 5) RETURNING id, kind, params");
  return { commands: rows.map((r) => ({ id: r.id, kind: r.kind, params: r.params })) };
};
export const guardResult = async (id, ok, text) => {
  const r = await query("UPDATE defense_host_cmds SET status = $2, result = $3, done_at = now() WHERE id = $1 AND status = 'running'", [String(id ?? ''), ok ? 'done' : 'failed', clip(text, 300)]);
  return r.rowCount ? { ok: true } : { error: 'not_found' };
};

/* ─── Периодика ─── */
export const defenseTick = async () => {
  await query('DELETE FROM defense_ip_blocks WHERE expires_at < now() - interval \'1 day\'').catch(() => {});
  await query('DELETE FROM defense_undo_links WHERE expires_at < now()').catch(() => {});
  await refreshBlocks();
  const lv = await getLevel();
  if (lv.level > 0 && lv.until && new Date(lv.until) < new Date()) await setLevel(Math.max(0, lv.level - 1), 0, 'срок уровня истёк');
};

/* ─── Для админки ─── */
export const listIncidents = async (limit = 30) => {
  const { rows } = await query('SELECT * FROM defense_incidents ORDER BY created_at DESC LIMIT $1', [Math.min(100, limit)]);
  return rows.map((r) => ({ id: r.id, title: r.title, severity: r.severity, status: r.status, mode: r.mode, summary: r.summary, createdAt: r.created_at.toISOString(), closedAt: r.closed_at?.toISOString?.() ?? null }));
};
export const getIncident = async (id) => {
  const inc = (await query('SELECT * FROM defense_incidents WHERE id = $1', [String(id ?? '')])).rows[0]; if (!inc) return null;
  const acts = (await query('SELECT * FROM defense_actions WHERE incident_id = $1 ORDER BY created_at', [inc.id])).rows;
  const evs = (await query('SELECT id, kind, severity, ip_mask, detail, status, created_at FROM leak_events WHERE incident_id = $1 ORDER BY created_at', [inc.id])).rows;
  return { id: inc.id, title: inc.title, severity: inc.severity, status: inc.status, mode: inc.mode, createdAt: inc.created_at.toISOString(), actions: acts.map(shapeAct),
    events: evs.map((e) => ({ id: e.id, kind: e.kind, label: KIND_LABEL[e.kind] ?? e.kind, severity: e.severity, ip: e.ip_mask, detail: e.detail, status: e.status, at: e.created_at.toISOString() })) };
};
export const undoOneById = async (actionId, actorId) => {
  const a = (await query('SELECT * FROM defense_actions WHERE id = $1', [String(actionId ?? '')])).rows[0]; if (!a) return { error: 'not_found' };
  const r = await undoOne(a, `admin:${actorId}`); if (r.ok) await closeIfDone(a.incident_id); return r;
};
export const drill = async () => handleSignal({ kind: 'mass_export', severity: 'high', mode: 'drill', subject: `drill:${Date.now()}`, ip: '203.0.113.7', detail: { note: 'учебная тревога' }, summary: 'Учебная тревога из админки' });
export { pool };
