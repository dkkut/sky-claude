/**
 * Sky AI: помощники по сервисам. Один поставщик и ключ (config.ai*), но у каждого сервиса — свой переключатель, модель,
 * потолок ответа, суточный лимит токенов и дополнение к инструкции. Учёт по сервису идёт отдельно от общего (aiusage.mjs).
 * Токены — по данным поставщика, иначе оценка; денег не показываем (ставки — общие, в aiusage). Правит только владелец со step-up `ai_budget`.
 */
import { query } from './db.mjs';
import { logAdmin } from './adminsec.mjs';

export const SERVICES = {
  chat:      { title: 'Чат Sky AI',            hint: 'Обычный диалог и голосовой ассистент.' },
  code:      { title: 'Режим «Код»',           hint: 'Рабочее место программиста (Prime).' },
  quick:     { title: 'Быстрые действия',      hint: 'Перевод, исправление, пересказ и т. п. над текстом.' },
  music:     { title: 'Sky Music',             hint: 'Вопросы о треке, объяснение текста, факты.' },
  documents: { title: 'Документы',             hint: 'Пересказ текста и разбор файлов.' },
  vision:    { title: 'Изображения',           hint: 'Разбор картинки, музыка по фото.' },
  podcasts:  { title: 'Подкасты',              hint: 'Краткое содержание выпусков.' },
};
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,79}$/;
const DEFAULT = { enabled: true, model: '', maxTokens: 0, dailyTokens: 0, instructions: '' };

let cache = { at: 0, v: null };
export const loadServiceCfg = async (fresh = false) => {
  if (!fresh && cache.v && Date.now() - cache.at < 15_000) return cache.v;
  const { rows } = await query('SELECT * FROM ai_service_settings');
  const v = {};
  for (const id of Object.keys(SERVICES)) v[id] = { ...DEFAULT };
  for (const r of rows) if (v[r.service]) v[r.service] = { enabled: r.enabled, model: r.model, maxTokens: r.max_tokens, dailyTokens: Number(r.daily_tokens), instructions: r.instructions };
  cache = { at: Date.now(), v };
  return v;
};

const serviceToday = async (service) => {
  const { rows } = await query(`SELECT COALESCE(SUM(input_tokens + output_tokens + est_tokens), 0)::bigint AS t FROM ai_service_usage_daily WHERE service = $1 AND day = (now() AT TIME ZONE 'utc')::date`, [service]);
  return Number(rows[0].t);
};

/** Перед запросом: сервис включён и суточный лимит не исчерпан. Возвращает настройки для применения. Сбой проверки не отключает Sky AI. */
export const serviceGate = async (service) => {
  if (!SERVICES[service]) return { cfg: DEFAULT };
  try {
    const cfg = (await loadServiceCfg())[service];
    if (!cfg.enabled) return { error: 'ai_service_off' };
    if (cfg.dailyTokens > 0 && (await serviceToday(service)) >= cfg.dailyTokens) return { error: 'ai_service_limit' };
    return { cfg };
  } catch (e) { console.error('[ai] проверка сервиса:', e.message); return { cfg: DEFAULT }; }
};

export const recordService = async ({ service, model = '', ok, usage = null, chars = { input: 0, output: 0 } }) => {
  if (!SERVICES[service]) return;
  const known = Boolean(usage && (usage.input || usage.output));
  const est = known || !ok ? 0 : Math.ceil(((chars.input || 0) + (chars.output || 0)) / 4);
  try {
    await query(
      `INSERT INTO ai_service_usage_daily (day, service, model, requests, errors, input_tokens, output_tokens, est_tokens)
       VALUES ((now() AT TIME ZONE 'utc')::date, $1, $2, 1, $3, $4, $5, $6)
       ON CONFLICT (day, service, model) DO UPDATE SET requests = ai_service_usage_daily.requests + 1, errors = ai_service_usage_daily.errors + $3,
         input_tokens = ai_service_usage_daily.input_tokens + $4, output_tokens = ai_service_usage_daily.output_tokens + $5, est_tokens = ai_service_usage_daily.est_tokens + $6`,
      [service, String(model).slice(0, 80), ok ? 0 : 1, known ? Math.trunc(usage.input || 0) : 0, known ? Math.trunc(usage.output || 0) : 0, est]);
  } catch (e) { console.error('[ai] учёт сервиса:', e.message); }
};

export const servicesOverview = async (days = 30) => {
  const d = Math.max(1, Math.min(180, Number(days) || 30));
  const cfg = await loadServiceCfg(true);
  const { rows } = await query(
    `SELECT service, SUM(requests)::int AS requests, SUM(errors)::int AS errors, SUM(input_tokens)::bigint AS inp, SUM(output_tokens)::bigint AS outp, SUM(est_tokens)::bigint AS est,
            COALESCE(SUM(input_tokens + output_tokens + est_tokens) FILTER (WHERE day = (now() AT TIME ZONE 'utc')::date), 0)::bigint AS today
       FROM ai_service_usage_daily WHERE day > (now() AT TIME ZONE 'utc')::date - $1::int GROUP BY service`, [d]);
  const by = Object.fromEntries(rows.map((r) => [r.service, r]));
  return {
    days: d,
    services: Object.entries(SERVICES).map(([id, s]) => {
      const u = by[id];
      return { id, title: s.title, hint: s.hint, ...cfg[id], requests: u?.requests ?? 0, errors: u?.errors ?? 0, inputTokens: Number(u?.inp ?? 0), outputTokens: Number(u?.outp ?? 0), estimatedTokens: Number(u?.est ?? 0), todayTokens: Number(u?.today ?? 0) };
    }),
  };
};

export const saveService = async (actorId, id, patch = {}) => {
  if (!SERVICES[id]) return { error: 'unknown_service' };
  const cur = (await loadServiceCfg(true))[id]; const next = { ...cur };
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
  if (patch.model !== undefined) {
    const m = String(patch.model ?? '').trim();
    if (m && !MODEL_RE.test(m)) return { error: 'bad_field', field: 'model' };
    next.model = m;
  }
  for (const [k, hi] of [['maxTokens', 8000], ['dailyTokens', 1e12]]) {
    if (patch[k] === undefined) continue;
    const n = Number(patch[k]);
    if (!Number.isFinite(n) || n < 0 || n > hi) return { error: 'bad_field', field: k };
    next[k] = Math.trunc(n);
  }
  if (next.maxTokens > 0 && next.maxTokens < 256) return { error: 'bad_field', field: 'maxTokens' };
  if (patch.instructions !== undefined) {
    const t = String(patch.instructions ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    if (t.length > 600) return { error: 'bad_field', field: 'instructions' };
    next.instructions = t;
  }
  await query(
    `INSERT INTO ai_service_settings (service, enabled, model, max_tokens, daily_tokens, instructions, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (service) DO UPDATE SET enabled=$2, model=$3, max_tokens=$4, daily_tokens=$5, instructions=$6, updated_by=$7, updated_at=now()`,
    [id, next.enabled, next.model, next.maxTokens, next.dailyTokens, next.instructions, actorId]);
  cache = { at: 0, v: null };
  await logAdmin({ actorId, targetType: 'ai', type: 'ai_service_settings', detail: `${id}: ${next.enabled ? 'on' : 'off'} model=${next.model || '—'} max=${next.maxTokens} day=${next.dailyTokens}`.slice(0, 250) });
  return { ok: true, service: { id, ...next } };
};
