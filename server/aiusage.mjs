/**
 * AI — ресурсы и токены: учёт расхода, бюджет, предупреждения, безопасные сведения о ключе.
 *
 * Принципы (модуль 6):
 *  • Токены модели ≠ деньги у поставщика. Остаток квоты показывается, только если его даёт поставщик; обычный ключ OpenAI-совместимого
 *    API остаток не отдаёт — тогда «Неизвестно», а рядом наша собственная оценка расхода против заданного администрацией лимита.
 *  • Токены берутся из ответа поставщика (usage). Нет usage — запрос считается отдельно и оценивается по длине (знаков / 4), помечается как оценка.
 *  • Цена — по ставкам, которые задал администратор (за 1 млн токенов); ставок нет — стоимость «не рассчитана», чисел не выдумываем.
 *  • Ключ целиком не показывается никому: только отпечаток (первые 8 знаков SHA-256) и последние 4 знака, если ключ длинный.
 *  • Ограничение при исчерпании лимита (по желанию) блокирует новые запросы к модели; уведомления владельцу — при 80 % / 95 % / исчерпании, по разу за период.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { notifyGift } from './giftnotify.mjs';
import { logAdmin } from './adminsec.mjs';

export const DEFAULTS = {
  dailyTokenLimit: 0,           // 0 — без лимита
  monthlyTokenLimit: 0,
  warnPercent: 80,
  criticalPercent: 95,
  blockWhenExhausted: false,    // true — при исчерпании любого лимита новые запросы к модели отклоняются
  priceInPerMTok: null,         // стоимость за 1 млн входных токенов (в валюте ниже); null — не задано
  priceOutPerMTok: null,
  currency: 'USD',
};
const LIM = { dailyTokenLimit: [0, 1e12], monthlyTokenLimit: [0, 1e13], warnPercent: [1, 100], criticalPercent: [1, 100] };

const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u ?? '').slice(0, 60); } };
export const providerId = (kind = 'chat') => (kind === 'stt' ? hostOf(config.sttBaseUrl) : `${hostOf(config.aiBaseUrl)} (${config.aiApiStyle})`);
export const modelId = (kind = 'chat') => (kind === 'stt' ? String(config.sttModel ?? '') : String(config.aiModel ?? ''));

/* ─── Настройки (кеш на 20 секунд: проверка стоит перед каждым запросом) ─── */
let cache = { at: 0, v: null };
export const loadSettings = async (fresh = false) => {
  if (!fresh && cache.v && Date.now() - cache.at < 20_000) return cache.v;
  const { rows } = await query('SELECT settings FROM ai_settings WHERE id');
  cache = { at: Date.now(), v: { ...DEFAULTS, ...(rows[0]?.settings ?? {}) } };
  return cache.v;
};

export const saveSettings = async (actorId, patch) => {
  const cur = await loadSettings(true); const next = { ...cur };
  for (const [k, [lo, hi]] of Object.entries(LIM)) {
    if (patch?.[k] === undefined) continue;
    const n = Number(patch[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) return { error: 'bad_field', field: k };
    next[k] = Math.trunc(n);
  }
  if (next.warnPercent >= next.criticalPercent) return { error: 'bad_field', field: 'warnPercent' };
  if (patch?.blockWhenExhausted !== undefined) next.blockWhenExhausted = patch.blockWhenExhausted === true;
  for (const k of ['priceInPerMTok', 'priceOutPerMTok']) {
    if (patch?.[k] === undefined) continue;
    if (patch[k] === null || patch[k] === '') { next[k] = null; continue; }
    const n = Number(patch[k]);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { error: 'bad_field', field: k };
    next[k] = n;
  }
  if (patch?.currency !== undefined) next.currency = String(patch.currency).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'USD';
  await query('UPDATE ai_settings SET settings = $1::jsonb, updated_by = $2, updated_at = now() WHERE id', [JSON.stringify(next), actorId]);
  cache = { at: 0, v: null };
  await event('settings', 'ok', JSON.stringify(next).slice(0, 200));
  await logAdmin({ actorId, targetType: 'ai', type: 'ai_budget_settings', detail: JSON.stringify(next).slice(0, 250) });
  return { ok: true, settings: next };
};

export const event = (kind, code = '', detail = '', kindOfCall = 'chat') =>
  query('INSERT INTO ai_events (provider, model, kind, code, detail) VALUES ($1,$2,$3,$4,$5)', [providerId(kindOfCall), modelId(kindOfCall), kind, String(code).slice(0, 60), String(detail).slice(0, 300)])
    .catch(() => {});

/* ─── Учёт ──────────────────────────────────────────────────────────── */

/** Записать итог запроса. usage: { input, output } от поставщика либо null; chars: { input, output } для оценки. */
export const recordCall = async ({ kind = 'chat', ok, code = '', usage = null, chars = { input: 0, output: 0 } }) => {
  const known = Boolean(usage && (usage.input || usage.output));
  const estIn = known ? 0 : Math.ceil((chars.input || 0) / 4); const estOut = known ? 0 : Math.ceil((chars.output || 0) / 4);
  try {
    await query(
      `INSERT INTO ai_usage_daily (day, provider, model, kind, requests, errors, input_tokens, output_tokens, est_requests, est_input, est_output)
       VALUES ((now() AT TIME ZONE 'utc')::date, $1, $2, $3, 1, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (day, provider, model, kind) DO UPDATE SET
         requests = ai_usage_daily.requests + 1, errors = ai_usage_daily.errors + $4,
         input_tokens = ai_usage_daily.input_tokens + $5, output_tokens = ai_usage_daily.output_tokens + $6,
         est_requests = ai_usage_daily.est_requests + $7, est_input = ai_usage_daily.est_input + $8, est_output = ai_usage_daily.est_output + $9`,
      [providerId(kind), modelId(kind), kind, ok ? 0 : 1, known ? Math.trunc(usage.input || 0) : 0, known ? Math.trunc(usage.output || 0) : 0,
        ok && !known ? 1 : 0, ok ? estIn : 0, ok ? estOut : 0]);
  } catch (e) { console.error('[ai] учёт расхода:', e.message); return; }
  if (!ok) await event(code === 'ai_busy' ? 'rate_limit' : 'error', code, '', kind);
  else if (kind === 'chat') await checkAlerts().catch(() => {});
};

const monthKey = () => new Date().toISOString().slice(0, 7);
const dayKey = () => new Date().toISOString().slice(0, 10);

/** Расход (токены, реальные + оценка) за сегодня и за месяц по запросам к модели. */
export const spend = async () => {
  const { rows } = await query(
    `SELECT COALESCE(SUM(input_tokens + output_tokens + est_input + est_output) FILTER (WHERE day = (now() AT TIME ZONE 'utc')::date), 0)::bigint AS today,
            COALESCE(SUM(input_tokens + output_tokens + est_input + est_output), 0)::bigint AS month
       FROM ai_usage_daily WHERE kind = 'chat' AND day >= date_trunc('month', (now() AT TIME ZONE 'utc'))::date`);
  return { today: Number(rows[0].today), month: Number(rows[0].month) };
};

/** Проверка перед запросом к модели. Блокирует только если администрация включила «блокировать при исчерпании». */
export const checkBudget = async () => {
  const s = await loadSettings();
  if (!s.blockWhenExhausted || (!s.dailyTokenLimit && !s.monthlyTokenLimit)) return { ok: true };
  const u = await spend();
  const over = (s.dailyTokenLimit && u.today >= s.dailyTokenLimit) ? 'daily' : (s.monthlyTokenLimit && u.month >= s.monthlyTokenLimit) ? 'monthly' : null;
  if (!over) return { ok: true };
  const last = await query(`SELECT 1 FROM ai_events WHERE kind = 'budget' AND at > now() - interval '1 hour' LIMIT 1`);
  if (!last.rowCount) await event('budget', over, `запрос отклонён: лимит ${over === 'daily' ? 'дня' : 'месяца'} исчерпан`);
  return { error: 'ai_budget', period: over };
};

const ownerIds = async () => {
  const name = String(config.ownerUsername ?? '').trim().toLowerCase();
  if (!name) return [];
  return (await query('SELECT id FROM profiles WHERE lower(username) = $1', [name])).rows.map((r) => r.id);
};

/** Предупреждения владельцу: при warnPercent, criticalPercent и исчерпании — по разу за день/месяц. */
export const checkAlerts = async () => {
  const s = await loadSettings();
  if (!s.dailyTokenLimit && !s.monthlyTokenLimit) return;
  const u = await spend();
  const checks = [['d:' + dayKey(), u.today, s.dailyTokenLimit, 'дня'], ['m:' + monthKey(), u.month, s.monthlyTokenLimit, 'месяца']];
  for (const [period, used, limit, label] of checks) {
    if (!limit) continue;
    const pct = (used / limit) * 100;
    const level = pct >= 100 ? 'exhausted' : pct >= s.criticalPercent ? 'critical' : pct >= s.warnPercent ? 'warn' : null;
    if (!level) continue;
    const ins = await query('INSERT INTO ai_alerts_sent (period, level) VALUES ($1,$2) ON CONFLICT DO NOTHING', [period, level]);
    if (!ins.rowCount) continue;
    const title = level === 'exhausted' ? `Sky AI: лимит ${label} исчерпан` : level === 'critical' ? `Sky AI: лимит ${label} почти исчерпан` : `Sky AI: расход подходит к лимиту ${label}`;
    const body = `Израсходовано ${used.toLocaleString('ru-RU')} из ${limit.toLocaleString('ru-RU')} токенов (${Math.round(pct)}%).${level === 'exhausted' && s.blockWhenExhausted ? ' Новые запросы к модели отклоняются.' : ''}`;
    await event('alert', level, `${title}: ${body}`);
    for (const id of await ownerIds()) await notifyGift(id, 'ai_budget', title, body).catch(() => {});
  }
};

/* ─── Сведения для админки ──────────────────────────────────────────── */

const fingerprint = (key) => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 8);
const maskKey = (key) => (String(key).length >= 20 ? `••••${String(key).slice(-4)}` : '••••');
export const keyInfo = (key) => (key ? { configured: true, fingerprint: fingerprint(key), masked: maskKey(key) } : { configured: false });

export const overview = async (days = 30) => {
  const d = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const s = await loadSettings(true);
  const { rows: byModel } = await query(
    `SELECT provider, model, kind, SUM(requests)::int AS requests, SUM(errors)::int AS errors,
            SUM(input_tokens)::bigint AS input_tokens, SUM(output_tokens)::bigint AS output_tokens,
            SUM(est_requests)::int AS est_requests, SUM(est_input)::bigint AS est_input, SUM(est_output)::bigint AS est_output
       FROM ai_usage_daily WHERE day > (now() AT TIME ZONE 'utc')::date - $1::int GROUP BY provider, model, kind ORDER BY provider, model, kind`, [d]);
  const { rows: series } = await query(
    `SELECT day::text AS day, SUM(input_tokens + est_input)::bigint AS input_tokens, SUM(output_tokens + est_output)::bigint AS output_tokens, SUM(requests)::int AS requests, SUM(errors)::int AS errors
       FROM ai_usage_daily WHERE kind = 'chat' AND day > (now() AT TIME ZONE 'utc')::date - $1::int GROUP BY day ORDER BY day`, [d]);
  const { rows: ev } = await query(`SELECT at, provider, model, kind, code, detail FROM ai_events ORDER BY at DESC LIMIT 60`);
  const { rows: recent } = await query(
    `SELECT count(*) FILTER (WHERE kind IN ('error')) ::int AS errors FROM ai_events WHERE at > now() - interval '15 minutes'`);
  const { rows: lastOk } = await query(`SELECT max(at) AS at FROM ai_events WHERE kind = 'error'`);
  const u = await spend();
  const num = (v) => Number(v ?? 0);
  const price = (m) => (s.priceInPerMTok == null && s.priceOutPerMTok == null ? null
    : Math.round(((num(m.input_tokens) + num(m.est_input)) * (s.priceInPerMTok ?? 0) + (num(m.output_tokens) + num(m.est_output)) * (s.priceOutPerMTok ?? 0)) / 1e6 * 10000) / 10000);
  return {
    periodDays: d,
    settings: s,
    chat: { configured: Boolean(config.aiApiKey), provider: providerId('chat'), model: modelId('chat'), style: config.aiApiStyle, key: keyInfo(config.aiApiKey) },
    stt: { configured: Boolean(config.sttApiKey && config.sttBaseUrl), provider: providerId('stt'), model: modelId('stt'), key: keyInfo(config.sttApiKey) },
    // Остаток у поставщика: обычный ключ его не отдаёт — честно «неизвестно», рядом наша оценка против лимита из настроек
    providerQuota: { known: false },
    spend: { today: u.today, month: u.month, dailyLimit: s.dailyTokenLimit || null, monthlyLimit: s.monthlyTokenLimit || null,
      dailyLeft: s.dailyTokenLimit ? Math.max(0, s.dailyTokenLimit - u.today) : null, monthlyLeft: s.monthlyTokenLimit ? Math.max(0, s.monthlyTokenLimit - u.month) : null },
    models: byModel.map((m) => ({ provider: m.provider, model: m.model, kind: m.kind, requests: m.requests, errors: m.errors,
      inputTokens: num(m.input_tokens), outputTokens: num(m.output_tokens), estRequests: m.est_requests, estInputTokens: num(m.est_input), estOutputTokens: num(m.est_output),
      cost: m.kind === 'chat' ? price(m) : null })),
    series: series.map((r) => ({ day: r.day, input: num(r.input_tokens), output: num(r.output_tokens), requests: r.requests, errors: r.errors })),
    events: ev.map((e) => ({ at: e.at, provider: e.provider, model: e.model, kind: e.kind, code: e.code, detail: e.detail })),
    health: { recentErrors15m: recent[0]?.errors ?? 0, lastErrorAt: lastOk[0]?.at ?? null },
  };
};

export const sweepAiEvents = async () => {
  await query(`DELETE FROM ai_events WHERE at < now() - interval '90 days'`);
  await query(`DELETE FROM ai_usage_daily WHERE day < (now() AT TIME ZONE 'utc')::date - 400`);
  await query(`DELETE FROM ai_alerts_sent WHERE at < now() - interval '90 days'`);
};
