/**
 * Sky Storage — управление из админки: четыре кнопки, технические работы, ограничения, настройки, квоты.
 *
 * Каждое действие: проверка права на сервере → (для критических) повторное подтверждение личности (step-up, одноразовый код) →
 * явное подтверждение confirm:true → изменение состояния по версии (конфликт, если кто-то изменил раньше) → запись в журнал
 * администрации (цепочка отпечатков) и в журнал хранилища → уведомление → ответ с ФАКТИЧЕСКИМ состоянием из базы.
 * Состояния независимы: ни одна команда не меняет «чужие» поля.
 */
import { query } from './db.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin, consumeStepUp, beginStepUp } from './adminsec.mjs';
import { redisAlive } from './sessions.mjs';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadState, mutateState, effective, Conflict, logEvent, notifyOwners, newId, snapshot, DEFAULT_SETTINGS, counters, levelFor,
} from './skystoragestate.mjs';
import { describeTarget, getTarget } from './skystoragetarget.mjs';
import * as primary from './skystorageprimary.mjs';
import { keyStatus, activeKid } from './skystoragecrypto.mjs';
import { stats as indexStats } from './skystorageindex.mjs';
import { loadQuotas, activity, CATEGORIES } from './skystoragelimits.mjs';
import { backupSummary, jobRunning } from './skystoragebackup.mjs';
import { quarantineRoot } from './skystorageindex.mjs';

export const CRITICAL_PURPOSE = 'storage_critical';
export const PERMS = {
  view: 'storage_view', audit: 'storage_audit', backup: 'storage_backup', schedule: 'storage_schedule', restore: 'storage_restore', quota: 'storage_quota',
  access: 'storage_access', emergency: 'storage_emergency', enable: 'storage_enable', unlock: 'storage_unlock', keys: 'storage_keys', maintenance: 'storage_maintenance',
};

const err = (code, extra = {}) => ({ error: code, ...extra });
const audit = (actorId, type, detail, meta, result = 'ok') => logAdmin({ actorId, targetType: 'storage', type, detail: String(detail).slice(0, 280), result, meta });
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const brief = (s) => ({ emergency: s.emergency.active, maintenance: s.maintenance.active ? s.maintenance.mode : false, skyAuth: s.skyAuth.active, restrictions: s.restrictions.map((r) => r.kind) });

/** Общая подготовка критического действия: право, подтверждение, код. Возвращает null, если можно продолжать. */
const gateCritical = async (actorId, perm, body, meta, { ownerOnly = false, type } = {}) => {
  if (!(await can(actorId, perm))) { await audit(actorId, type ?? 'storage_denied', `нет права ${perm}`, meta, 'denied'); return err('not_allowed'); }
  if (ownerOnly && !(await isOwner(actorId))) { await audit(actorId, type ?? 'storage_denied', 'только владелец', meta, 'denied'); return err('owner_only'); }
  if (body?.confirm !== true) return err('confirm_required');
  const step = await consumeStepUp(actorId, CRITICAL_PURPOSE, body?.stepUpCode, { meta });
  if (step.error) return step;
  return null;
};

export const beginCritical = async (actorId, meta) => {
  const any = await Promise.all(Object.values(PERMS).map((p) => can(actorId, p)));
  if (!any.some(Boolean)) return err('not_allowed');
  return beginStepUp(actorId, CRITICAL_PURPOSE, { meta });
};

const respond = async (extra = {}) => ({ ok: true, state: await publicState(), ...extra });

/* ─── Публичное состояние ──────────────────────────────────────────── */

export const publicState = async () => {
  const s = await loadState(true);
  const e = effective(s);
  return {
    version: s.version, effective: e, emergency: s.emergency, maintenance: s.maintenance, skyAuth: s.skyAuth, restrictions: s.restrictions,
    settings: s.settings, ticketEpoch: s.ticketEpoch ? new Date(s.ticketEpoch * 1000).toISOString() : null, updatedAt: s.updatedAt, updatedBy: s.updatedBy,
  };
};

/* ─── Кнопка 1: «Выключить хранилище» ──────────────────────────────── */

export const emergencyOff = async (actorId, body, meta) => {
  const g = await gateCritical(actorId, PERMS.emergency, body, meta, { type: 'storage_emergency_off' }); if (g) return g;
  const reason = clean(body?.reason, 300);
  if (reason.length < 5) return err('reason_required');
  const mode = body?.mode === 'writes' ? 'writes' : 'full';
  try {
    const { before, state } = await mutateState(actorId, body?.expectedVersion, (s) => ({
      emergency: { active: true, mode, reason, by: actorId, at: new Date().toISOString() },
      // Все ранее выданные временные ссылки и пропуска перестают действовать
      ticket_epoch: Math.floor(Date.now() / 1000),
      restrictions: s.restrictions,
    }));
    await audit(actorId, 'storage_emergency_off', `${mode === 'full' ? 'чтение и запись' : 'запись'} закрыты: ${reason}`.slice(0, 250), meta);
    await logEvent('emergency_off', 'critical', { mode, reason, before: brief(before), after: brief(state) }, actorId);
    await notifyOwners('emergency_off', 'Хранилище аварийно отключено', `Sky Storage выключено (${mode === 'full' ? 'чтение и запись' : 'только запись'}). Причина: ${reason}. Данные и ключи сохранены.`, { critical: true });
    return respond();
  } catch (e) { if (e instanceof Conflict) return err('conflict', { state: await publicState() }); throw e; }
};

/* ─── Кнопка 2: «Ограничить доступ к хранилищу от ключа Sky» ───────── */

export const requireSkyAuth = async (actorId, body, meta) => {
  const g = await gateCritical(actorId, PERMS.emergency, body, meta, { type: 'storage_sky_auth' }); if (g) return g;
  const reason = clean(body?.reason, 300);
  if (reason.length < 5) return err('reason_required');
  try {
    const { before, state } = await mutateState(actorId, body?.expectedVersion, (s) => ({
      sky_auth: { active: true, reason, by: actorId, at: new Date().toISOString() },
      // Ранее выданные временные ссылки и пропуска отзываются; новые будут короче (skyAuthMaxTicketMin)
      ticket_epoch: Math.floor(Date.now() / 1000),
      restrictions: s.restrictions,
    }));
    await audit(actorId, 'storage_sky_auth', `обязательная авторизация Sky: ${reason}`.slice(0, 250), meta);
    await logEvent('sky_auth_on', 'warn', { reason, before: brief(before), after: brief(state) }, actorId);
    await notifyOwners('sky_auth_on', 'Включена обязательная авторизация Sky', `Доступ к хранилищу теперь требует действующей сессии Sky; прежние временные ссылки отозваны. Причина: ${reason}.`, { critical: false });
    return respond({ note: 'Ранее выданные временные пропуска отозваны; приложения получат новые автоматически при следующем запросе.' });
  } catch (e) { if (e instanceof Conflict) return err('conflict', { state: await publicState() }); throw e; }
};

/* ─── Кнопка 3: «Включить хранилище» ───────────────────────────────── */

export const enableChecks = async () => {
  const s = await loadState(true);
  const checks = [];
  const add = (id, label, ok, critical, detail = '') => checks.push({ id, label, ok, critical, detail });
  try { await query('SELECT 1'); add('db', 'База данных', true, true); } catch { add('db', 'База данных', false, true, 'нет соединения'); }
  add('auth', 'Серверная авторизация Sky (сессии)', await redisAlive().catch(() => false), true);
  // Запись и чтение на диске данных
  try {
    const dir = quarantineRoot(); await mkdir(dir, { recursive: true, mode: 0o700 });
    const p = join(dir, `.probe-${process.pid}-${Date.now()}`);
    await writeFile(p, 'ok'); const back = await readFile(p, 'utf8'); await rm(p);
    add('disk', 'Чтение и запись на диске данных', back === 'ok', true);
  } catch (e) { add('disk', 'Чтение и запись на диске данных', false, true, e.code ?? 'ошибка'); }
  // Внешняя площадка резервных копий
  const d = describeTarget();
  if (d.configured) {
    const h = await getTarget().health().catch((e) => ({ ok: false, code: e.code }));
    add('provider', `Площадка копий (${d.kind})`, h.ok, Boolean(s.settings.backupRequiredForEnable), h.ok ? `${h.ms} мс` : `недоступна: ${h.code ?? ''}`);
  } else add('provider', 'Площадка копий', false, Boolean(s.settings.backupRequiredForEnable), 'не настроена');
  const ks = keyStatus();
  add('keys', 'Ключ шифрования копий', ks.configured, Boolean(s.settings.backupRequiredForEnable), ks.configured ? `активный ${ks.active}` : 'не задан');
  if (s.settings.backupRequiredForEnable) {
    const b = await backupSummary();
    const fresh = b.lastVerified?.verified_at && Date.now() - new Date(b.lastVerified.verified_at).getTime() < 48 * 3600_000;
    add('backup', 'Свежая проверенная копия (за 48 ч)', Boolean(fresh), true);
  }
  const comp = s.restrictions.find((r) => r.kind === 'compromise');
  add('compromise', 'Нет блокировки из-за компрометации', !comp, true, comp ? `активна: ${comp.reason}` : '');
  const { rows } = await query(`SELECT count(*)::int AS n FROM storage_events WHERE level = 'critical' AND kind IN ('object_corrupt','backup_corrupt') AND at > now() - interval '24 hours'`);
  add('errors', 'Нет свежих критических ошибок целостности (24 ч)', rows[0].n === 0, false, rows[0].n ? `событий: ${rows[0].n}` : '');
  const others = s.restrictions.filter((r) => r.kind !== 'compromise');
  if (others.length || s.skyAuth.active || s.maintenance.active) add('other', 'Другие ограничения останутся в силе', true, false, [...others.map((r) => r.kind), ...(s.skyAuth.active ? ['обязательная авторизация Sky'] : []), ...(s.maintenance.active ? ['технические работы'] : [])].join(', '));
  return { checks, canEnable: checks.every((c) => c.ok || !c.critical) };
};

export const enable = async (actorId, body, meta) => {
  if (!(await can(actorId, PERMS.enable))) return err('not_allowed');
  if (body?.preview === true) { const r = await enableChecks(); return { ok: true, ...r, state: await publicState() }; }
  const g = await gateCritical(actorId, PERMS.enable, body, meta, { type: 'storage_enable' }); if (g) return g;
  const r = await enableChecks();
  if (!r.canEnable) { await audit(actorId, 'storage_enable', 'проверки не пройдены', meta, 'denied'); return err('checks_failed', { checks: r.checks }); }
  try {
    const { before, state } = await mutateState(actorId, body?.expectedVersion, (s) => (s.emergency.active ? { emergency: { active: false, endedBy: actorId, endedAt: new Date().toISOString(), previous: s.emergency } } : null));
    await audit(actorId, 'storage_enable', 'аварийное отключение снято', meta);
    await logEvent('enabled', 'warn', { before: brief(before ?? state), after: brief(state), checks: r.checks.map((c) => `${c.id}:${c.ok}`) }, actorId);
    await notifyOwners('enabled', 'Хранилище включено', 'Аварийное отключение Sky Storage снято после проверок. Остальные ограничения не менялись.', { critical: false });
    return respond({ checks: r.checks });
  } catch (e) { if (e instanceof Conflict) return err('conflict', { state: await publicState() }); throw e; }
};

/* ─── Кнопка 4: «Отключить ограничения» ────────────────────────────── */

/** Что сейчас можно снять: ограничения и режим авторизации, с причиной, инициатором и последствиями. */
export const removable = async () => {
  const s = await loadState(true);
  const items = [];
  if (s.skyAuth.active) items.push({ id: 'sky_auth', kind: 'sky_auth', critical: false, reason: s.skyAuth.reason, by: s.skyAuth.by, at: s.skyAuth.at, consequence: 'Доступ к файлам по прежним правилам; короткие пропуска перестанут требоваться.' });
  for (const r of s.restrictions) items.push({ id: r.id, kind: r.kind, critical: Boolean(r.critical), reason: r.reason, by: r.by, at: r.at, auto: Boolean(r.auto), consequence: { readonly: 'Снова разрешится запись.', lock_all: 'Снова разрешится чтение и запись.', no_new_connections: 'Снова разрешатся новые подключения.', compromise: 'Снять нельзя этой кнопкой — только процедура восстановления.' }[r.kind] ?? '' });
  return items;
};

export const removeRestrictions = async (actorId, body, meta) => {
  if (!(await can(actorId, PERMS.unlock))) { await audit(actorId, 'storage_unlock', 'нет права', meta, 'denied'); return err('not_allowed'); }
  const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  if (!ids.length) return err('nothing_selected');
  const items = await removable();
  const chosen = items.filter((i) => ids.includes(i.id));
  if (chosen.length !== ids.length) return err('unknown_restriction');
  if (chosen.some((c) => c.kind === 'compromise' || c.auto)) return err('recovery_procedure_required', { hint: 'Ограничения из-за компрометации снимаются только процедурой восстановления.' });
  const needOwner = chosen.some((c) => c.critical);
  const g = await gateCritical(actorId, PERMS.unlock, body, meta, { ownerOnly: needOwner, type: 'storage_unlock' }); if (g) return g;
  const reason = clean(body?.reason, 300);
  if (reason.length < 5) return err('reason_required');
  try {
    const { before, state } = await mutateState(actorId, body?.expectedVersion, (s) => {
      const patch = {};
      if (ids.includes('sky_auth') && s.skyAuth.active) patch.sky_auth = { active: false, endedBy: actorId, endedAt: new Date().toISOString(), previous: s.skyAuth };
      const left = s.restrictions.filter((r) => !ids.includes(r.id));
      if (left.length !== s.restrictions.length) patch.restrictions = left;
      return Object.keys(patch).length ? patch : null;   // остальные состояния (аварийное, технические работы) не затрагиваются
    });
    await audit(actorId, 'storage_unlock', `сняты: ${chosen.map((c) => c.kind).join(', ')}; причина: ${reason}`.slice(0, 250), meta);
    await logEvent('restrictions_removed', 'warn', { removed: chosen.map((c) => ({ id: c.id, kind: c.kind, by: c.by, at: c.at, reason: c.reason })), why: reason, before: brief(before ?? state), after: brief(state) }, actorId);
    await notifyOwners('unlock', 'Сняты ограничения Sky Storage', `Сняты: ${chosen.map((c) => c.kind).join(', ')}. Причина: ${reason}.`, { critical: true });
    const after = await enableChecks();
    return respond({ checksAfter: after.checks });
  } catch (e) { if (e instanceof Conflict) return err('conflict', { state: await publicState() }); throw e; }
};

/* ─── Ограничения (добавление) и компрометация ─────────────────────── */

export const addRestriction = async (actorId, body, meta) => {
  const kind = String(body?.kind ?? '');
  if (!['readonly', 'lock_all', 'no_new_connections'].includes(kind)) return err('bad_kind');
  const g = await gateCritical(actorId, PERMS.emergency, body, meta, { type: 'storage_restrict' }); if (g) return g;
  const reason = clean(body?.reason, 300);
  if (reason.length < 5) return err('reason_required');
  try {
    const { state } = await mutateState(actorId, body?.expectedVersion, (s) => ({ restrictions: [...s.restrictions, { id: newId('rs'), kind, critical: kind === 'lock_all', reason, by: actorId, at: new Date().toISOString() }] }));
    await audit(actorId, 'storage_restrict', `${kind}: ${reason}`.slice(0, 250), meta);
    await logEvent('restriction_added', 'warn', { kind, reason }, actorId);
    await notifyOwners(`restrict:${kind}`, 'Добавлено ограничение Sky Storage', `Ограничение «${kind}»: ${reason}.`, { critical: kind === 'lock_all' });
    void state; return respond();
  } catch (e) { if (e instanceof Conflict) return err('conflict', { state: await publicState() }); throw e; }
};

/** Подтверждённая компрометация: критическое ограничение; запись закрыта, новые подключения закрыты, пропуска отозваны. */
export const flagCompromise = async (actorId, body, meta) => {
  const g = await gateCritical(actorId, PERMS.emergency, body, meta, { type: 'storage_compromise' }); if (g) return g;
  const reason = clean(body?.reason, 300);
  if (reason.length < 5) return err('reason_required');
  try {
    await mutateState(actorId, body?.expectedVersion, (s) => ({
      restrictions: [...s.restrictions, { id: newId('rs'), kind: 'compromise', critical: true, auto: false, reason, by: actorId, at: new Date().toISOString(), keyAtFlag: activeKid() }],
      ticket_epoch: Math.floor(Date.now() / 1000),
    }));
    await audit(actorId, 'storage_compromise', reason.slice(0, 250), meta);
    await logEvent('compromise_flag', 'critical', { reason }, actorId);
    await notifyOwners('compromise', 'Компрометация: Sky Storage ограничено', `Зафиксирована компрометация (${reason}). Запись и новые подключения закрыты, временные ссылки отозваны. Нужна процедура восстановления.`, { critical: true });
    return respond();
  } catch (e) { if (e instanceof Conflict) return err('conflict', { state: await publicState() }); throw e; }
};

/**
 * Процедура восстановления после компрометации: только владелец, со step-up. Условия: ключ шифрования ротирован
 * (активный KEK отличается от того, что был при пометке), все ожидающие подтверждения отозваны, действующие подключения
 * требуют повторного подтверждения. Только после этого ограничение снимается. Автоматически доступ не возобновляется.
 */
export const recoverFromCompromise = async (actorId, body, meta) => {
  const g = await gateCritical(actorId, PERMS.unlock, body, meta, { ownerOnly: true, type: 'storage_recover' }); if (g) return g;
  const s = await loadState(true);
  const r = s.restrictions.find((x) => x.kind === 'compromise');
  if (!r) return err('no_compromise');
  if (body?.ackKeysRotated !== true) return err('ack_required');
  if (r.keyAtFlag && r.keyAtFlag === activeKid() && body?.keysNotNeeded !== true) return err('rotate_keys_first', { hint: 'Замените активный STORAGE_KEK и перезапустите сервер (scripts/setup-storage.sh --rotate).' });
  await query(`UPDATE storage_connections SET status = 'revoked', decided_at = now(), decided_by = $1, decided_via = 'recovery' WHERE status IN ('pending','approved')`, [actorId]);
  try {
    await mutateState(actorId, body?.expectedVersion, (st) => ({ restrictions: st.restrictions.filter((x) => x.kind !== 'compromise'), ticket_epoch: Math.floor(Date.now() / 1000) }));
    await audit(actorId, 'storage_recover', 'компрометация закрыта процедурой восстановления', meta);
    await logEvent('compromise_recovered', 'critical', {}, actorId);
    await notifyOwners('recovered', 'Ограничение компрометации снято', 'Процедура восстановления выполнена. Все подключения потребуют нового подтверждения.', { critical: true });
    return respond();
  } catch (e) { if (e instanceof Conflict) return err('conflict', { state: await publicState() }); throw e; }
};

/* ─── Технические работы ───────────────────────────────────────────── */

export const setMaintenance = async (actorId, body, meta) => {
  const on = body?.on === true;
  const mode = body?.mode === 'emergency' ? 'emergency' : 'safe';
  // Безопасное обслуживание — обычная операция; аварийная остановка — критическая (подтверждение личности).
  if (on && mode === 'emergency') { const g = await gateCritical(actorId, PERMS.maintenance, body, meta, { type: 'storage_maint' }); if (g) return g; }
  else { if (!(await can(actorId, PERMS.maintenance))) return err('not_allowed'); if (body?.confirm !== true) return err('confirm_required'); }
  const reason = clean(body?.reason, 300);
  if (on && reason.length < 3) return err('reason_required');
  if (!on) {
    const h = await enableChecks();
    const bad = h.checks.filter((c) => !c.ok && c.critical && ['db', 'auth', 'disk'].includes(c.id));
    if (bad.length) return err('checks_failed', { checks: h.checks });     // перед отключением режима проверяется состояние
  }
  try {
    const { before, state } = await mutateState(actorId, body?.expectedVersion, (s) => ({
      maintenance: on ? { active: true, mode, reason, by: actorId, at: new Date().toISOString() } : { active: false, endedBy: actorId, endedAt: new Date().toISOString(), previous: s.maintenance },
    }));
    await audit(actorId, on ? 'storage_maint_on' : 'storage_maint_off', `${on ? `${mode}: ${reason}` : 'режим снят'}`, meta);
    await logEvent(on ? 'maintenance_on' : 'maintenance_off', 'warn', { mode, reason, before: brief(before), after: brief(state) }, actorId);
    await notifyOwners(on ? 'maint_on' : 'maint_off', on ? 'Технические работы хранилища' : 'Технические работы завершены', on ? `Режим «${mode === 'safe' ? 'безопасное обслуживание' : 'аварийная остановка'}»: ${reason}.` : 'Обычная работа восстановлена (аварийное отключение и ограничения не менялись).', { critical: false });
    return respond({ activity: activity() });
  } catch (e) { if (e instanceof Conflict) return err('conflict', { state: await publicState() }); throw e; }
};

/* ─── Настройки и квоты ────────────────────────────────────────────── */

const num = (v, lo, hi) => { if (v === null || v === '' || v === undefined) return null; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.floor(n) : NaN; };

export const updateSettings = async (actorId, body, meta) => {
  if (!(await can(actorId, PERMS.quota))) return err('not_allowed');
  const patch = body?.settings ?? {};
  const cur = (await loadState(true)).settings;
  const next = { ...cur, thresholds: { ...cur.thresholds }, retention: { ...cur.retention } };
  const bad = (f) => err('bad_field', { field: f });
  for (const k of ['warn', 'critical', 'block', 'full']) if (patch.thresholds?.[k] !== undefined) { const n = num(patch.thresholds[k], 1, 100); if (Number.isNaN(n) || n === null) return bad(`thresholds.${k}`); next.thresholds[k] = n; }
  const t = next.thresholds; if (!(t.warn < t.critical && t.critical < t.block && t.block <= t.full)) return bad('thresholds');
  const nums = { totalBytes: [1, 1e15, true], reserveFreeBytes: [0, 1e13], maxFileBytes: [1, 1e13], maxFiles: [1, 1e12, true], maxConcurrentUploads: [1, 1000], maxConcurrentIO: [1, 10000], maxBackgroundJobs: [1, 4], uploadsPerMinute: [1, 100000], approvalTimeoutMin: [1, 1440], approvalRiskThreshold: [0, 10], skyAuthMaxTicketMin: [5, 1440], quarantineDays: [1, 365], downloadLinkMinutes: [1, 120] };
  for (const [k, [lo, hi, nullable]] of Object.entries(nums)) if (patch[k] !== undefined) { const n = num(patch[k], lo, hi); if (Number.isNaN(n) || (n === null && !nullable)) return bad(k); next[k] = n; }
  if (patch.approvalScope !== undefined) { if (!['admin', 'off'].includes(patch.approvalScope)) return bad('approvalScope'); next.approvalScope = patch.approvalScope; }
  for (const k of ['backupRequiredForEnable', 'notifyEmail']) if (patch[k] !== undefined) next[k] = patch[k] === true;
  if (patch.retention) for (const [k, lo, hi, nullable] of [['days', 1, 3650], ['maxBytes', 1, 1e15, true], ['minKeep', 1, 100]]) if (patch.retention[k] !== undefined) { const n = num(patch.retention[k], lo, hi); if (Number.isNaN(n) || (n === null && !nullable)) return bad(`retention.${k}`); next.retention[k] = n; }
  // Ослабление защит (таймаут подтверждения больше суток, отключение политики) — критично: требует подтверждения личности
  const weakens = next.approvalScope === 'off' && cur.approvalScope !== 'off';
  if (weakens) { const g = await gateCritical(actorId, PERMS.quota, body, meta, { ownerOnly: true, type: 'storage_settings' }); if (g) return g; }
  try {
    const { before } = await mutateState(actorId, body?.expectedVersion, () => ({ settings: next }));
    await audit(actorId, 'storage_settings', Object.keys(patch).join(', ').slice(0, 200), meta);
    await logEvent('settings', 'info', { changed: Object.keys(patch) }, actorId);
    void before; return respond();
  } catch (e) { if (e instanceof Conflict) return err('conflict', { state: await publicState() }); throw e; }
};

export const setQuota = async (actorId, body, meta) => {
  if (!(await can(actorId, PERMS.quota))) return err('not_allowed');
  const category = String(body?.category ?? '');
  if (!CATEGORIES.includes(category)) return err('bad_category');
  const f = { hard: num(body?.hardBytes, 0, 1e15), maxFile: num(body?.maxFileBytes, 1, 1e13), maxFiles: num(body?.maxFiles, 0, 1e12), conc: num(body?.maxConcurrent, 1, 1000) };
  if (Object.values(f).some(Number.isNaN)) return err('bad_field');
  await query(`INSERT INTO storage_quotas (category, hard_bytes, max_file_bytes, max_files, max_concurrent, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6, now())
    ON CONFLICT (category) DO UPDATE SET hard_bytes = $2, max_file_bytes = $3, max_files = $4, max_concurrent = $5, updated_by = $6, updated_at = now()`, [category, f.hard, f.maxFile, f.maxFiles, f.conc, actorId]);
  await loadQuotas();
  await audit(actorId, 'storage_quota', `${category}: ${JSON.stringify(f)}`, meta);
  await logEvent('quota', 'info', { category, ...f }, actorId);
  return { ok: true };
};

/* ─── Обзор для панели ─────────────────────────────────────────────── */

export const overview = async () => {
  const [state, st, backups, quotas, conns, events] = await Promise.all([
    publicState(), indexStats(), backupSummary(),
    query('SELECT * FROM storage_quotas ORDER BY category'),
    query(`SELECT status, count(*)::int AS n FROM storage_connections GROUP BY status`),
    query(`SELECT id, at, level, kind, detail FROM storage_events WHERE level IN ('warn','critical') ORDER BY at DESC LIMIT 15`),
  ]);
  const target = describeTarget();
  const health = target.configured ? await getTarget().health().catch((e) => ({ ok: false, code: e.code })) : null;
  return {
    state, stats: st, backups, quotas: quotas.rows, target: { ...target, health }, primary: primary.status(),
    activity: activity(), counters, job: jobRunning(),
    connections: Object.fromEntries(conns.rows.map((r) => [r.status, r.n])), lastProblems: events.rows,
    keys: keyStatus(), defaults: DEFAULT_SETTINGS, level: st.capacity.level, categories: CATEGORIES,
  };
};

export { levelFor, snapshot };
