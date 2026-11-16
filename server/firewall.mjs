/**
 * Файрвол Sky (прикладной уровень): пять уровней защиты, последний — «Атака».
 *   0 Спокойно · 1 Внимание · 2 Усиленная защита · 3 Тревога · 4 Атака
 * Что делает НА САМОМ ДЕЛЕ (всё в процессе API, без чудес):
 *   • считает запросы по адресам и отвечает 429 тем, кто превышает предел уровня (отдельные пределы для анонимов, вошедших и /api/auth/);
 *   • на уровне ≥3 анонимам открыты только вход, статус, публичные страницы; остальное — 403;
 *   • настойчивых нарушителей блокирует на часы (общая таблица defense_ip_blocks, её же читает самозащита);
 *   • на уровне 4 закрывает новые регистрации, просит оптимизатор ресурсов отложить необязательные работы,
 *     по желанию включает «Under Attack» в Cloudflare (нужны CF_API_TOKEN и CF_ZONE_ID) и пишет владельцу;
 *   • сам повышает уровень по сигналам и по одной ступени снижает, когда тихо (если не поставлен вручную).
 * Чего НЕ делает: не отбивает объёмный DDoS (он съедает канал раньше, чем доходит до приложения) — для этого нужен Cloudflare/провайдер.
 * Свои и инфраструктурные адреса/пути (локальная сеть, healthz, шлюз SSH, сторож, агент, вебхуки, сам файрвол) не ограничиваются.
 */
import { query } from './db.mjs';
import { ipFp, ipMask } from './ipmask.mjs';
import { clientIp } from './http.mjs';
import { logEvent } from './skylog.mjs';
import { forgetBlocks } from './selfdefense.mjs';

export const LEVELS = [
  { id: 0, name: 'Спокойно', hint: 'Обычная работа, без дополнительных ограничений.' },
  { id: 1, name: 'Внимание', hint: 'Мягкие пределы для анонимных запросов и входа.' },
  { id: 2, name: 'Усиленная защита', hint: 'Строже пределы; настойчивых нарушителей блокируем на час.' },
  { id: 3, name: 'Тревога', hint: 'Анонимам открыты только вход и публичные страницы; блокировки на 3 часа.' },
  { id: 4, name: 'Атака', hint: 'Максимум: самые жёсткие пределы, регистрация закрыта, блокировки на 12 часов, необязательные работы отложены, Cloudflare «Under Attack» (если подключён).' },
];
const BAN_HOURS = [0, 0, 1, 3, 12];
// запросов в минуту с одного адреса: [анонимы, вошедшие, /api/auth/*]
const LIMITS = [[Infinity, Infinity, Infinity], [100, Infinity, 40], [60, 100, 24], [30, 60, 12], [12, 30, 6]];
const STRIKES_TO_BAN = 12;     // отказов 429 за 2 минуты → блокировка

export const DEFAULTS = {
  autoEscalate: true,          // сам повышает уровень по сигналам
  autoAttack: true,            // может сам дойти до «Атаки»
  calmMinutes: 10,             // сколько тишины нужно, чтобы снизить на ступень
  trustedIps: [],              // адреса, которые не ограничиваются (свой офис, мониторинг)
  thresholds: {                // за последнюю минуту
    limited1: 40, limited2: 200, limited3: 800,   // отказов 429 всего
    attackers3: 6, attackers4: 20,                // разных адресов, получивших отказ
    rpm2: 6000, rpm3: 20000, rpm4: 60000,         // запросов к API всего
  },
  cloudflare: true,            // при «Атаке» включать Under Attack, если ключи заданы
};

let settings = { ...DEFAULTS, thresholds: { ...DEFAULTS.thresholds } };
let settingsAt = 0;
let state = { level: 0, pinnedUntil: null, reason: '', setBy: null, setAt: null, cfPrev: null };
let lastTriggerAt = 0;
let loadHigh = 0;

/* ─── Настройки ─── */
const loadSettings = async () => {
  try {
    const d = (await query('SELECT data FROM firewall_settings WHERE id')).rows[0]?.data ?? {};
    settings = { ...DEFAULTS, ...d, trustedIps: Array.isArray(d.trustedIps) ? d.trustedIps.slice(0, 50).map(String) : [], thresholds: { ...DEFAULTS.thresholds, ...(d.thresholds ?? {}) } };
    settingsAt = Date.now();
  } catch { /* таблицы ещё нет — остаются значения по умолчанию */ }
};
export const getSettings = async () => { if (Date.now() - settingsAt > 10_000) await loadSettings(); return settings; };
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null; };
export const saveSettings = async (actorId, patch) => {
  await loadSettings();
  const next = { ...settings, thresholds: { ...settings.thresholds } };
  for (const k of ['autoEscalate', 'autoAttack', 'cloudflare']) if (patch[k] !== undefined) next[k] = Boolean(patch[k]);
  if (patch.calmMinutes !== undefined) { const v = num(patch.calmMinutes, 1, 240); if (v == null) return { error: 'bad_field', field: 'calmMinutes' }; next.calmMinutes = v; }
  if (patch.trustedIps !== undefined) {
    const list = (Array.isArray(patch.trustedIps) ? patch.trustedIps : String(patch.trustedIps).split(/[\s,;]+/)).map((s) => String(s).trim()).filter(Boolean);
    if (list.length > 50 || list.some((s) => !/^[0-9a-fA-F:.]{3,45}$/.test(s))) return { error: 'bad_field', field: 'trustedIps' };
    next.trustedIps = list;
  }
  const T = { limited1: [1, 1e6], limited2: [1, 1e6], limited3: [1, 1e6], attackers3: [1, 1e5], attackers4: [1, 1e5], rpm2: [100, 1e7], rpm3: [100, 1e7], rpm4: [100, 1e7] };
  for (const [k, [lo, hi]] of Object.entries(T)) if (patch.thresholds?.[k] !== undefined) { const v = num(patch.thresholds[k], lo, hi); if (v == null) return { error: 'bad_field', field: k }; next.thresholds[k] = v; }
  await query('UPDATE firewall_settings SET data = $1::jsonb, updated_by = $2, updated_at = now() WHERE id', [JSON.stringify({ autoEscalate: next.autoEscalate, autoAttack: next.autoAttack, calmMinutes: next.calmMinutes, trustedIps: next.trustedIps, thresholds: next.thresholds, cloudflare: next.cloudflare }), actorId ?? null]);
  settings = next; settingsAt = Date.now();
  await addEvent('settings', state.level, 'изменены настройки файрвола');
  return { ok: true, settings };
};

/* ─── Состояние ─── */
const loadState = async () => {
  try {
    const r = (await query('SELECT level, pinned_until, reason, set_by, set_at, cf_prev FROM firewall_state WHERE id')).rows[0];
    if (r) state = { level: r.level, pinnedUntil: r.pinned_until?.toISOString?.() ?? null, reason: r.reason ?? '', setBy: r.set_by ?? null, setAt: r.set_at?.toISOString?.() ?? null, cfPrev: r.cf_prev ?? null };
  } catch { /* таблицы нет */ }
};
export const getState = () => ({ ...state, name: LEVELS[state.level]?.name ?? '' });
export const currentLevel = () => state.level;
/** Для bloxlimits: при «Тревоге» необязательные работы откладываются (как «высокая нагрузка»), при «Атаке» — как «критично». */
export const loadFloor = () => (state.level >= 4 ? 3 : state.level >= 3 ? 2 : 0);
const addEvent = async (kind, level, detail) => {
  try { await query('INSERT INTO firewall_events (kind, level, detail) VALUES ($1,$2,$3)', [kind, level, String(detail).slice(0, 300)]); } catch { /* журнал не должен ронять защиту */ }
  logEvent({ category: 'security', type: `firewall_${kind}`, level: level >= 3 ? 'WARN' : 'INFO', service: 'firewall', reason: String(detail).slice(0, 150), detail: { level } });
};
export const listEvents = async (limit = 60) => (await query('SELECT id, at, kind, level, detail FROM firewall_events ORDER BY at DESC, id DESC LIMIT $1', [Math.min(200, limit)])).rows
  .map((r) => ({ id: Number(r.id), at: r.at.toISOString(), kind: r.kind, level: r.level, detail: r.detail }));

/* ─── Счётчики (в памяти одного процесса) ─── */
const win = new Map();           // ключ → { t, n } — окно в минуту
const strikes = new Map();       // ip → [время отказов]
const SLOT = 10_000;
const series = [];               // по 10-секундным корзинам: { t, req, limited, banned, anon, authed }
const slot = () => { const t = Math.floor(Date.now() / SLOT) * SLOT; let s = series[series.length - 1]; if (!s || s.t !== t) { s = { t, req: 0, limited: 0, banned: 0, anon: 0, authed: 0, limitedIps: new Set() }; series.push(s); while (series.length > 90) series.shift(); } return s; };
const hit = (key, limit) => {
  const now = Date.now(); let w = win.get(key);
  if (!w || now - w.t >= 60_000) { w = { t: now, n: 0 }; win.set(key, w); }
  w.n += 1;
  return w.n <= limit;
};
const sweepWin = () => { const now = Date.now(); for (const [k, w] of win) if (now - w.t > 120_000) win.delete(k); for (const [k, a] of strikes) { const f = a.filter((t) => now - t < 120_000); if (f.length) strikes.set(k, f); else strikes.delete(k); } };

const PRIVATE = /^(::1$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|f[cd][0-9a-f]{2}:|::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/i;
const EXEMPT_PATHS = ['/healthz', '/api/ssh-gate/', '/api/guard/', '/api/ops/agent/', '/api/sandbox/runner/', '/api/defense/', '/api/admin/firewall', '/api/skykassa/webhook/', '/api/kbiz/webhook/', '/api/platform/status'];
const ANON_OK = ['/api/auth/', '/api/platform/', '/api/site/', '/api/oidc/', '/api/kbiz/public/', '/api/bloom/public/', '/api/blocked/', '/api/email/', '/api/tax/doc/', '/api/recovery/', '/api/storage/verify/', '/api/storage/download/', '/api/guide', '/api/telemetry'];
const MEDIA = /^\/api\/[\w/-]+\/(cover|audio|poster|thumb|thumbnail|avatar|media|file|stream|segment|image)(\/[\w.-]*)?(\?|$)/;

/**
 * Решение по запросу. Возвращает null (пропустить) или { status, error, retryAfter }.
 * authed — запрос пришёл с действующим токеном доступа.
 */
export const gate = (req, authed) => {
  const s = slot(); s.req += 1;
  const ip = clientIp(req); const url = String(req.url || '');
  if (!url.startsWith('/api/') || req.method === 'OPTIONS') return null;
  authed ? (s.authed += 1) : (s.anon += 1);
  const lv = state.level;
  if (lv <= 0) return null;
  if (PRIVATE.test(ip) || ip === 'unknown' || settings.trustedIps.includes(ip)) return null;
  if (EXEMPT_PATHS.some((p) => url.startsWith(p))) return null;
  if (req.method === 'GET' && MEDIA.test(url)) return null;     // у потоков свой предел, лента тянет их десятками
  const [anonLim, authLim, authEndpointLim] = LIMITS[lv];
  if (!authed && lv >= 3 && !ANON_OK.some((p) => url.startsWith(p))) { s.limited += 1; return { status: 403, error: 'firewall_restricted', retryAfter: 0 }; }
  const fp = ip;
  let ok = hit(`fw:${authed ? 'a' : 'n'}:${fp}`, authed ? authLim : anonLim);
  if (ok && url.startsWith('/api/auth/')) ok = hit(`fw:auth:${fp}`, authEndpointLim);
  if (ok) return null;
  s.limited += 1; s.limitedIps.add(ip);
  const arr = strikes.get(ip) ?? []; arr.push(Date.now()); strikes.set(ip, arr);
  if (lv >= 2 && arr.filter((t) => Date.now() - t < 120_000).length >= STRIKES_TO_BAN) { strikes.delete(ip); void ban(ip, BAN_HOURS[lv], `файрвол, уровень ${lv}`, false); s.banned += 1; }
  return { status: 429, error: 'firewall_limited', retryAfter: 30 };
};

/* ─── Блокировки адресов ─── */
export const ban = async (ip, hours, reason, manual) => {
  const fp = ipFp(ip); if (!fp) return { error: 'bad_ip' };
  if (PRIVATE.test(String(ip)) || settings.trustedIps.includes(String(ip))) return { error: 'protected_address' };
  const h = Math.max(1, Math.min(168, Number(hours) || 1));
  await query(`INSERT INTO defense_ip_blocks (ip_fp, ip_mask, reason, incident_id, expires_at) VALUES ($1,$2,$3,NULL, now() + ($4 || ' hours')::interval)
               ON CONFLICT (ip_fp) DO UPDATE SET expires_at = GREATEST(defense_ip_blocks.expires_at, EXCLUDED.expires_at), reason = EXCLUDED.reason`, [fp, ipMask(String(ip)), `${manual ? 'вручную' : 'авто'}: ${String(reason).slice(0, 100)}`, String(h)]);
  forgetBlocks();
  await addEvent('ban', state.level, `${manual ? 'блокировка вручную' : 'блокировка'} ${ipMask(String(ip))} на ${h} ч`);
  return { ok: true, ipFp: fp };
};
export const unban = async (fp) => { await query('DELETE FROM defense_ip_blocks WHERE ip_fp = $1', [String(fp)]); forgetBlocks(); await addEvent('unban', state.level, `снята блокировка ${String(fp).slice(0, 8)}…`); return { ok: true }; };
export const listBans = async () => (await query('SELECT ip_fp, ip_mask, reason, expires_at, created_at FROM defense_ip_blocks WHERE expires_at > now() ORDER BY created_at DESC LIMIT 200')).rows
  .map((b) => ({ ipFp: b.ip_fp, ip: b.ip_mask, reason: b.reason, expiresAt: b.expires_at.toISOString(), createdAt: b.created_at.toISOString() }));

/* ─── Cloudflare (необязательно) ─── */
export const cloudflareConfigured = () => Boolean(process.env.CF_API_TOKEN && process.env.CF_ZONE_ID);
const cf = async (method, path, body) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(process.env.CF_ZONE_ID)}${path}`, {
    method, headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(String(j.errors?.[0]?.message || `HTTP ${r.status}`).slice(0, 120));
  return j.result;
};
const cloudflareAttack = async (on) => {
  if (!settings.cloudflare || !cloudflareConfigured()) return;
  try {
    if (on) {
      if (state.cfPrev) return;                          // уже включено нами
      const cur = (await cf('GET', '/settings/security_level'))?.value || 'medium';
      if (cur === 'under_attack') return;
      await cf('PATCH', '/settings/security_level', { value: 'under_attack' });
      await query('UPDATE firewall_state SET cf_prev = $1 WHERE id', [cur]); state.cfPrev = cur;
      await addEvent('cloudflare', 4, `Cloudflare: Under Attack (было «${cur}»)`);
    } else if (state.cfPrev) {
      await cf('PATCH', '/settings/security_level', { value: state.cfPrev });
      await addEvent('cloudflare', state.level, `Cloudflare: возвращено «${state.cfPrev}»`);
      await query('UPDATE firewall_state SET cf_prev = NULL WHERE id'); state.cfPrev = null;
    }
  } catch (e) { await addEvent('cloudflare', state.level, `Cloudflare не ответил: ${e.message}`); }
};

/* ─── Смена уровня ─── */
const notifyOwner = async (lv, why) => {
  try {
    const { ownerInfo } = await import('./selfdefense.mjs'); const o = await ownerInfo(); if (!o) return;
    const { notifyGift } = await import('./giftnotify.mjs');
    await notifyGift(o.id, 'firewall', `Файрвол: «${LEVELS[lv].name}»`, String(why).slice(0, 180));
  } catch { /* уведомление не должно ронять защиту */ }
};
export const setLevel = async (level, { hours = 0, reason = '', by = null, auto = false } = {}) => {
  const lv = Math.max(0, Math.min(4, Number(level) | 0));
  const prev = state.level;
  const pinned = !auto && lv > 0 && Number(hours) > 0 ? new Date(Date.now() + Math.min(168, Number(hours)) * 3600_000) : (!auto && lv > 0 ? new Date(Date.now() + 24 * 3600_000) : null);
  await query('UPDATE firewall_state SET level = $1, pinned_until = $2, reason = $3, set_by = $4, set_at = now() WHERE id', [lv, auto ? (state.pinnedUntil ? new Date(state.pinnedUntil) : null) : pinned, String(reason).slice(0, 200), by]);
  await loadState();
  if (auto) lastTriggerAt = Date.now();
  if (lv !== prev) {
    await addEvent(auto ? (lv > prev ? 'level_up' : 'level_down') : 'level_manual', lv, `${LEVELS[prev].name} → ${LEVELS[lv].name}${reason ? ` · ${reason}` : ''}`);
    if (lv >= 3 && lv > prev) void notifyOwner(lv, reason || LEVELS[lv].hint);
    await cloudflareAttack(lv >= 4);
  }
  return getState();
};

/* ─── Автоматика ─── */
const sums = (sec) => { const from = Date.now() - sec * 1000; const o = { req: 0, limited: 0, banned: 0, attackers: new Set() }; for (const s of series) if (s.t >= from) { o.req += s.req; o.limited += s.limited; o.banned += s.banned; for (const i of s.limitedIps) o.attackers.add(i); } return o; };
export const stats = () => {
  const m = sums(60); const hist = series.slice(-60).map((s) => ({ t: s.t, req: s.req, limited: s.limited }));
  return { reqPerMin: m.req, limitedPerMin: m.limited, bannedPerMin: m.banned, attackers: m.attackers.size, series: hist };
};
export const firewallTick = async () => {
  await loadState(); await loadSettings(); sweepWin();
  const now = Date.now(); const m = sums(60); const T = settings.thresholds;
  let target = 0; let why = '';
  const up = (lv, text) => { if (lv > target) { target = lv; why = text; } };
  if (m.limited >= T.limited1) up(1, `${m.limited} отказов за минуту`);
  if (m.limited >= T.limited2 || m.req >= T.rpm2) up(2, m.limited >= T.limited2 ? `${m.limited} отказов за минуту` : `${m.req} запросов за минуту`);
  if (m.limited >= T.limited3 || m.attackers.size >= T.attackers3 || m.req >= T.rpm3) up(3, `${m.attackers.size} адресов получили отказ, ${m.req} запросов за минуту`);
  if ((m.limited >= T.limited3 && m.attackers.size >= T.attackers4) || m.req >= T.rpm4) up(4, `${m.attackers.size} адресов атакуют, ${m.req} запросов за минуту`);
  try { const { loadLevel } = await import('./bloxlimits.mjs'); loadHigh = loadLevel() >= 3 ? loadHigh + 1 : 0; if (loadHigh >= 3) up(3, 'сервер перегружен (задержка цикла событий)'); } catch { /* нет модуля */ }
  if (!settings.autoAttack) target = Math.min(target, 3);
  if (settings.autoEscalate && target > state.level) { await setLevel(target, { reason: why, auto: true }); return; }
  if (target > 0 && settings.autoEscalate) lastTriggerAt = now;   // угроза держится — не снижаем
  const pinned = state.pinnedUntil && Date.parse(state.pinnedUntil) > now;
  if (state.level > 0 && !pinned && settings.autoEscalate && now - Math.max(lastTriggerAt, (state.setAt ? Date.parse(state.setAt) : 0)) > settings.calmMinutes * 60_000) {
    await setLevel(state.level - 1, { reason: 'тихо', auto: true });
  } else if (state.level > 0 && !pinned && state.pinnedUntil && Date.parse(state.pinnedUntil) <= now) {
    await query('UPDATE firewall_state SET pinned_until = NULL WHERE id');   // ручной срок вышел — дальше решает автоматика
  }
};

let timer = null;
export const startFirewall = () => {
  if (timer) return; void loadState().then(loadSettings);
  timer = setInterval(() => { firewallTick().catch((e) => console.error('[firewall] тик:', e.message)); }, SLOT); timer.unref();
};
/** Для тестов. */
export const _reset = () => { win.clear(); strikes.clear(); series.length = 0; lastTriggerAt = 0; loadHigh = 0; };
