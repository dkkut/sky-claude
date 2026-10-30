/**
 * Лимиты загрузки: личная коллекция и публикация — раздельно (модуль 4, ноябрь-2026).
 *
 * Личная загрузка (`personal`) — закрытый файл владельца: проверяется при самой загрузке (размер, формат, длительность,
 * число файлов, общий объём, одновременные загрузки, скорость). Публикация (`public`) — отправка в общий каталог:
 * проверяется при отправке на проверку (размер, формат, длительность, число и объём опубликованного у человека).
 * Всё считает сервер; клиент лишь показывает заранее (`effective`). Пустое значение в таблице = значение по умолчанию.
 */
import { query } from './db.mjs';
import { hasPrime } from './skyid.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';

const GB = 1024 ** 3;
export const QUOTA_FREE_DEFAULT = 5 * GB;
export const QUOTA_PRIME_DEFAULT = 10 * GB;

export const KINDS = ['film', 'music'];
const FORMATS = {
  film: { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-msvideo': 'avi', 'video/ogg': 'ogv' },
  music: { 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/wav': 'wav', 'audio/mp4': 'm4a' },
};
export const formatKey = (kind, mime) => FORMATS[kind]?.[String(mime ?? '')] ?? null;
export const knownFormats = (kind) => Object.values(FORMATS[kind] ?? {});

/** Значения, действующие, пока администрация ничего не задала. */
const defaults = (scope, kind) => {
  const filmMax = Math.max(1024 * 1024, Number(process.env.FILM_MAX_BYTES) || 4 * GB);
  const base = { maxFileBytes: kind === 'film' ? filmMax : 30 * 1024 * 1024, maxFiles: 0, totalBytes: 0, totalBytesPrime: 0, formats: null, maxDurationSec: 0, maxConcurrent: 3, speedKbps: 0, maxBatch: 0 };
  if (kind === 'all') return { ...base, maxFileBytes: 0, totalBytes: QUOTA_FREE_DEFAULT, totalBytesPrime: QUOTA_PRIME_DEFAULT };
  if (scope === 'public') return { ...base, maxConcurrent: 0 };
  return base;
};

let cache = { at: 0, rows: new Map() };
const TTL = 15_000;
export const forgetLimits = () => { cache = { at: 0, rows: new Map() }; };
const load = async () => {
  if (Date.now() - cache.at < TTL) return cache.rows;
  const { rows } = await query('SELECT * FROM upload_limits');
  cache = { at: Date.now(), rows: new Map(rows.map((r) => [`${r.scope}:${r.kind}`, r])) };
  return cache.rows;
};

const merge = (scope, kind, r) => {
  const d = defaults(scope, kind);
  const pick = (v, dv) => (v === null || v === undefined ? dv : Number(v));
  return {
    scope, kind,
    maxFileBytes: pick(r?.max_file_bytes, d.maxFileBytes),
    maxFiles: pick(r?.max_files, d.maxFiles),
    totalBytes: pick(r?.total_bytes, d.totalBytes),
    totalBytesPrime: pick(r?.total_bytes_prime, d.totalBytesPrime),
    formats: r?.formats ? r.formats.split(',').filter(Boolean) : (kind === 'all' ? null : knownFormats(kind)),
    maxDurationSec: pick(r?.max_duration_sec, d.maxDurationSec),
    maxConcurrent: pick(r?.max_concurrent, d.maxConcurrent),
    speedKbps: pick(r?.speed_kbps, d.speedKbps),
    maxBatch: pick(r?.max_batch, d.maxBatch),
    custom: Boolean(r),
  };
};

export const getLimits = async (scope, kind) => merge(scope, kind, (await load()).get(`${scope}:${kind}`));

/** Общий объём личного хранилища для человека (кино + музыка вместе). */
export const personalQuotaFor = async (profileId) => {
  const l = await getLimits('personal', 'all');
  return (await hasPrime(profileId)) ? l.totalBytesPrime : l.totalBytes;
};

/* ─── Личная загрузка ──────────────────────────────────────────────── */

const active = new Map(); // `${profile}:${kind}` -> число идущих загрузок

/**
 * Занять место под загрузку. Возвращает { ok, release } либо { error }. release() вызывать при любом исходе.
 * Размер и длительность — слова клиента (проверяются ещё раз по факту записи на диск); формат — по сигнатуре файла.
 */
export const beginPersonalUpload = async (profileId, kind, { declaredBytes = 0, mime, duration = 0 } = {}) => {
  const l = await getLimits('personal', kind);
  const fmt = formatKey(kind, mime);
  if (!fmt || (l.formats && !l.formats.includes(fmt))) return { error: 'format_not_allowed', allowed: l.formats };
  if (declaredBytes > 0 && l.maxFileBytes > 0 && declaredBytes > l.maxFileBytes) return { error: 'file_too_large', maxBytes: l.maxFileBytes };
  if (l.maxDurationSec > 0 && duration > l.maxDurationSec) return { error: 'too_long', maxSeconds: l.maxDurationSec };
  if (l.maxFiles > 0) {
    const table = kind === 'film' ? 'film_movies' : 'music_tracks';
    const { rows } = await query(`SELECT count(*)::int AS n FROM ${table} WHERE owner_id = $1 AND status = 'private'`, [profileId]);
    if (rows[0].n >= l.maxFiles) return { error: 'too_many_files', max: l.maxFiles };
  }
  const key = `${profileId}:${kind}`;
  const n = active.get(key) ?? 0;
  if (l.maxConcurrent > 0 && n >= l.maxConcurrent) return { error: 'too_many_uploads', max: l.maxConcurrent };
  active.set(key, n + 1);
  let done = false;
  return { ok: true, limits: l, release: () => { if (done) return; done = true; const c = (active.get(key) ?? 1) - 1; if (c <= 0) active.delete(key); else active.set(key, c); } };
};

/** Потолок размера одного файла для saveStream (по факту записи). */
export const maxFileBytesFor = async (scope, kind) => {
  const l = await getLimits(scope, kind);
  return l.maxFileBytes > 0 ? l.maxFileBytes : Number.MAX_SAFE_INTEGER;
};

/** Ограничение скорости приёма: пауза между кусками так, чтобы не быстрее speedKbps (килобит/с). */
export const throttled = (iterable, kbps) => {
  if (!kbps || kbps <= 0) return iterable;
  const bytesPerSec = (kbps * 1000) / 8;
  return (async function* () {
    const t0 = Date.now(); let sent = 0;
    for await (const chunk of iterable) {
      sent += chunk.length;
      const due = t0 + (sent / bytesPerSec) * 1000;
      const wait = due - Date.now();
      if (wait > 5) await new Promise((r) => setTimeout(r, wait));
      yield chunk;
    }
  })();
};

/* ─── Публикация ───────────────────────────────────────────────────── */

/** Проверка при отправке в общий каталог. row — запись фильма/трека (id, owner_id, bytes, mime, duration_sec). */
export const checkPublish = async (kind, row) => {
  const l = await getLimits('public', kind);
  const fmt = formatKey(kind, row.mime);
  if (l.formats && fmt && !l.formats.includes(fmt)) return { error: 'format_not_allowed_public', allowed: l.formats };
  if (l.maxFileBytes > 0 && Number(row.bytes ?? 0) > l.maxFileBytes) return { error: 'file_too_large_public', maxBytes: l.maxFileBytes };
  if (l.maxDurationSec > 0 && Number(row.duration_sec ?? 0) > l.maxDurationSec) return { error: 'too_long_public', maxSeconds: l.maxDurationSec };
  if (l.maxFiles > 0 || l.totalBytes > 0 || l.totalBytesPrime > 0) {
    const table = kind === 'film' ? 'film_movies' : 'music_tracks';
    const { rows } = await query(
      `SELECT count(*)::int AS n, coalesce(sum(bytes),0)::bigint AS b FROM ${table}
        WHERE owner_id = $1 AND status IN ('published','pending') AND id <> $2`, [row.owner_id, row.id]);
    if (l.maxFiles > 0 && rows[0].n >= l.maxFiles) return { error: 'too_many_public', max: l.maxFiles };
    const cap = (await hasPrime(row.owner_id)) ? (l.totalBytesPrime || l.totalBytes) : l.totalBytes;
    if (cap > 0 && Number(rows[0].b) + Number(row.bytes ?? 0) > cap) return { error: 'public_quota_exceeded', maxBytes: cap };
  }
  return { ok: true };
};

/* ─── Для клиента и админки ────────────────────────────────────────── */

export const effectiveFor = async (profileId) => {
  const out = { personal: {}, public: {} };
  for (const scope of ['personal', 'public']) for (const kind of KINDS) {
    const l = await getLimits(scope, kind);
    out[scope][kind] = { maxFileBytes: l.maxFileBytes, maxFiles: l.maxFiles, formats: l.formats, maxDurationSec: l.maxDurationSec, maxConcurrent: l.maxConcurrent, speedKbps: l.speedKbps, maxBatch: l.maxBatch,
      totalBytes: l.totalBytes, totalBytesPrime: l.totalBytesPrime };
  }
  out.personalQuotaBytes = await personalQuotaFor(profileId);
  return out;
};

const toInt = (v, min, max) => {
  if (v === null || v === '' || v === undefined) return undefined;   // не менять
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new Error('bad_value');
  return n;
};

export const adminOverview = async (actorId) => {
  if (!(await can(actorId, 'upload_limits'))) return null;
  const rows = [];
  for (const scope of ['personal', 'public']) for (const kind of [...KINDS, ...(scope === 'personal' ? ['all'] : [])]) rows.push({ ...(await getLimits(scope, kind)), defaults: defaults(scope, kind) });
  return { limits: rows, formats: { film: knownFormats('film'), music: knownFormats('music') } };
};

/**
 * Сохранить одну строку. Поле, присланное как `null`, возвращается к умолчанию; не присланное — не меняется.
 */
export const adminSave = async (actorId, body, meta) => {
  if (!(await can(actorId, 'upload_limits'))) return { error: 'not_allowed' };
  const scope = body?.scope; const kind = body?.kind;
  if (!['personal', 'public'].includes(scope) || ![...KINDS, 'all'].includes(kind) || (kind === 'all' && scope !== 'personal')) return { error: 'bad_target' };
  const fields = {};
  try {
    const TB = 1024 ** 4;
    const spec = { maxFileBytes: ['max_file_bytes', 1, 64 * GB], maxFiles: ['max_files', 0, 1_000_000], totalBytes: ['total_bytes', 0, 100 * TB], totalBytesPrime: ['total_bytes_prime', 0, 100 * TB],
      maxDurationSec: ['max_duration_sec', 0, 86400 * 7], maxConcurrent: ['max_concurrent', 1, 100], speedKbps: ['speed_kbps', 0, 10_000_000], maxBatch: ['max_batch', 0, 10_000] };
    for (const [k, [col, min, max]] of Object.entries(spec)) {
      if (!(k in (body ?? {}))) continue;
      if (body[k] === null) { fields[col] = null; continue; }
      const v = toInt(body[k], min, max);
      if (v !== undefined) fields[col] = v;
    }
    if ('formats' in (body ?? {})) {
      if (body.formats === null) fields.formats = null;
      else {
        const known = kind === 'all' ? [] : knownFormats(kind);
        const list = [...new Set((Array.isArray(body.formats) ? body.formats : []).map(String))].filter((f) => known.includes(f));
        if (!list.length) return { error: 'no_formats' };
        fields.formats = list.join(',');
      }
    }
  } catch { return { error: 'bad_value' }; }
  const cols = Object.keys(fields);
  if (!cols.length) return { error: 'nothing_to_change' };
  const ins = ['scope', 'kind', ...cols, 'updated_by'];
  const vals = [scope, kind, ...cols.map((c) => fields[c]), actorId];
  const upd = [...cols, 'updated_by'].map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  await query(
    `INSERT INTO upload_limits (${ins.join(',')}) VALUES (${ins.map((_, i) => `$${i + 1}`).join(',')})
     ON CONFLICT (scope, kind) DO UPDATE SET ${upd}, updated_at = now()`, vals);
  forgetLimits();
  await logAdmin({ actorId, targetType: 'system', type: 'upload_limits', detail: `${scope}/${kind}: ${cols.join(', ')}`, meta });
  return { ok: true, limit: await getLimits(scope, kind) };
};
