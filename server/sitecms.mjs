/**
 * Сайт (лендинг на корневом домене), которым управляют из админки Sky.
 *
 * Что здесь живёт — всё из этого читает лендинг по открытому API (`/api/site/*`), а правит сотрудник с правом `site`:
 *   • ссылки сайта (соцсети, менеджер, адрес веб-версии);
 *   • карточки «Скачать»: версия, статус, внешняя ссылка ИЛИ файл, загруженный в админке (apk/exe/dmg/deb/…);
 *   • статус сервисов и заметка о происходящем;
 *   • апелляции и заявки на релиз контента, поданные с сайта (с вложениями), — очередь, статусы, ответ по почте.
 *
 * Открытые ручки не требуют входа, поэтому: жёсткие пределы по адресу, ограничение размера и типа вложений (по первым байтам, а не
 * по имени), секрет подачи для дозагрузки файлов к своей заявке (хранится хешем), никакой выдачи чужих заявок — статус по коду И почте.
 * Файлы лежат на диске в SITE_DIR (том), в базе только описание.
 */
import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { sendEmail } from './notify.mjs';
import { generateId } from './security.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { createBroadcast } from './notifyBroadcast.mjs';
import { encryptSecret, openSecret, macOf } from './crypto.mjs';

/* Почта заявителя лежит зашифрованной (email_enc) + HMAC для поиска (email_hmac); открытая колонка email — только у записей до миграции 176. */
const emailMac = (e) => macOf('site-email', String(e).toLowerCase());
const emailOf = (r) => (r?.email_enc ? openSecret(r.email_enc) : r?.email) || '';

const ROOT = process.env.SITE_DIR || '/data/site';
const MB = 1024 * 1024;
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const cleanMulti = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);
const hash = (kind, v) => crypto.createHash('sha256').update(`${config.jwtSecret}:site:${kind}:v1:${v}`).digest('hex');
const sameHex = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = (prefix) => { const r = Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join(''); return `${prefix}-${r.slice(0, 4)}-${r.slice(4)}`; };
const ipHash = (ip) => (ip ? crypto.createHmac('sha256', `${config.jwtSecret}:site-ip:v1`).update(String(ip)).digest('hex') : null);

export const siteRoot = () => ROOT;
const filePath = (id) => join(ROOT, 'files', id);
const attPath = (id) => join(ROOT, 'att', id);

/* ── Ссылки: только http(s) и mailto — никаких javascript: в href на лендинге ───────────────── */
const URL_OK = (u) => /^(https:\/\/[^\s]{3,500}|http:\/\/[^\s]{3,500}|mailto:[^\s@]{1,64}@[^\s@]{1,190})$/.test(u);

/* ── Запись потока на диск с пределом и хешем ───────────────────────────────────────────────── */
const saveStream = async (source, path, limit) => {
  await mkdir(join(path, '..'), { recursive: true });
  const h = crypto.createHash('sha256'); let size = 0; let head = Buffer.alloc(0);
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > limit) return cb(Object.assign(new Error('too_large'), { code: 'too_large' }));
      if (head.length < 32) head = Buffer.concat([head, chunk]).subarray(0, 32);
      h.update(chunk); cb(null, chunk);
    },
  });
  try {
    await pipeline(source, meter, createWriteStream(path));
  } catch (e) {
    await rm(path, { force: true }).catch(() => {});
    return { error: e.code === 'too_large' ? 'file_too_large' : 'upload_interrupted' };
  }
  if (size === 0) { await rm(path, { force: true }).catch(() => {}); return { error: 'empty_file' }; }
  return { size, sha256: h.digest('hex'), head };
};

/* Тип по первым байтам: имя и заголовок Content-Type подделать проще всего. */
const sniff = (b) => {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE') return 'audio/wav';
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  if (b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (b.subarray(0, 4).toString('latin1') === 'OggS') return 'audio/ogg';
  if (b.subarray(0, 4).toString('latin1') === 'fLaC') return 'audio/flac';
  if (b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
  return null;
};

/* ═══ Открытая часть ═══════════════════════════════════════════════════════════════════════════ */

const STATE_ORDER = ['outage', 'degraded', 'maintenance', 'dev', 'operational'];

/** Работы идут, пока включены и срок (если задан) не вышел: забытый выключатель не закроет сайт навсегда. */
const maintView = (m) => {
  const until = m?.maint_until ? new Date(m.maint_until) : null;
  const active = Boolean(m?.maint_active) && (!until || until.getTime() > Date.now());
  return { active, title: m?.maint_title ?? '', text: m?.maint_text ?? '', until: until ? until.toISOString() : null };
};

export const publicContent = async () => {
  const [links, dl, comps, meta] = await Promise.all([
    query('SELECT key, label, url FROM site_links ORDER BY sort, key'),
    query(`SELECT d.*, f.name AS file_name, f.size AS file_size, f.sha256 AS file_sha FROM site_downloads d
             LEFT JOIN site_files f ON f.id = d.file_id WHERE d.status <> 'hidden' ORDER BY d.sort, d.platform`),
    query('SELECT id, name, icon, state, note FROM site_status_components ORDER BY sort, id'),
    query('SELECT headline, note, updated_at, maint_active, maint_title, maint_text, maint_until FROM site_status_meta WHERE id'),
  ]);
  const states = comps.rows.map((c) => c.state);
  const overall = STATE_ORDER.find((s) => states.includes(s)) ?? 'operational';
  return {
    links: Object.fromEntries(links.rows.map((l) => [l.key, l.url])),
    downloads: dl.rows.map((d) => ({
      platform: d.platform, title: d.title, icon: d.icon, info: d.info, version: d.version, button: d.button, status: d.status,
      // Загруженный файл отдаётся нашим адресом (со счётчиком); без файла — внешняя ссылка.
      href: d.file_id ? `/api/site/download/${d.platform}` : d.url,
      file: d.file_id ? { name: d.file_name, size: Number(d.file_size), sha256: d.file_sha } : null,
    })),
    maintenance: maintView(meta.rows[0]),
    status: {
      overall, headline: meta.rows[0]?.headline ?? '', note: meta.rows[0]?.note ?? '', updatedAt: meta.rows[0]?.updated_at?.toISOString?.() ?? null,
      components: comps.rows,
    },
  };
};

/** Файл для скачивания: описание + путь на диске. Счётчик скачиваний растёт при каждой выдаче. */
export const downloadFile = async (platform) => {
  const { rows } = await query(
    `SELECT f.* FROM site_downloads d JOIN site_files f ON f.id = d.file_id WHERE d.platform = $1 AND d.status <> 'hidden'`, [String(platform ?? '')]);
  const f = rows[0];
  if (!f) return null;
  try { await stat(filePath(f.id)); } catch { return null; }
  query('UPDATE site_files SET downloads = downloads + 1 WHERE id = $1', [f.id]).catch(() => {});
  return { file: f, path: filePath(f.id) };
};
export const openRange = (path, start, end) => createReadStream(path, { start, end });

const APPEAL_KINDS = new Set(['account_block', 'content_removal', 'order', 'finance', 'release_rejected', 'other']);
const ATT_RULES = {
  appeal: { max: 3, roles: { file: { types: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'], limit: 50 * MB } } },
  release: { max: 4, roles: {
    audio: { types: ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg'], limit: 100 * MB },
    cover: { types: ['image/jpeg', 'image/png', 'image/webp'], limit: 10 * MB },
    video: { types: ['video/mp4', 'video/webm'], limit: 500 * MB },
    file: { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limit: 20 * MB },
  } },
};

export const submitAppeal = async (b, { ip }) => {
  const kind = String(b?.kind ?? '');
  const email = clean(b?.email, 254).toLowerCase();
  const body = cleanMulti(b?.body, 5000);
  if (!APPEAL_KINDS.has(kind)) return { error: 'bad_kind' };
  if (!EMAIL_RE.test(email)) return { error: 'bad_email' };
  if (body.length < 10) return { error: 'text_too_short' };
  const id = `sap-${generateId()}`; const code = newCode('SKY'); const token = crypto.randomBytes(24).toString('base64url');
  await query(
    `INSERT INTO site_appeals (id, code, token_hash, kind, username, email, email_enc, email_hmac, ref, body, lang, ip_hash) VALUES ($1,$2,$3,$4,$5,'',$6,$7,$8,$9,$10,$11)`,
    [id, code, hash('token', token), kind, clean(b?.username, 64).replace(/^@/, ''), encryptSecret(email), emailMac(email), clean(b?.ref, 64), body, b?.lang === 'en' ? 'en' : 'ru', ipHash(ip)]);
  await sendEmail(email,
    b?.lang === 'en' ? `Sky appeal received: ${code}` : `Апелляция Sky принята: ${code}`,
    b?.lang === 'en'
      ? `We received your appeal. Number: ${code}\nStatus can be checked on the site. Review takes up to 7 business days.`
      : `Мы получили вашу апелляцию. Номер: ${code}\nСтатус можно проверить на сайте. Рассмотрение — до 7 рабочих дней.`).catch(() => {});
  void notifyStaff('site', { title: 'Новая апелляция с сайта', body: `Номер ${code}`, dedupe: id });
  return { ok: true, code, token, id };
};

export const submitRelease = async (b, { ip }) => {
  const kind = b?.kind === 'film' ? 'film' : b?.kind === 'music' ? 'music' : '';
  const email = clean(b?.email, 254).toLowerCase();
  const title = clean(b?.title, 160);
  if (!kind) return { error: 'bad_kind' };
  if (!EMAIL_RE.test(email)) return { error: 'bad_email' };
  if (title.length < 2) return { error: 'title_required' };
  const data = {};
  for (const [k, v] of Object.entries(b?.fields ?? {}).slice(0, 30)) data[clean(k, 40)] = cleanMulti(v, 4000);
  const id = `srl-${generateId()}`; const code = newCode('REL'); const token = crypto.randomBytes(24).toString('base64url');
  await query(
    `INSERT INTO site_releases (id, code, token_hash, kind, email, email_enc, email_hmac, title, data, lang, ip_hash) VALUES ($1,$2,$3,$4,'',$5,$6,$7,$8,$9,$10)`,
    [id, code, hash('token', token), kind, encryptSecret(email), emailMac(email), title, JSON.stringify(data), b?.lang === 'en' ? 'en' : 'ru', ipHash(ip)]);
  await sendEmail(email,
    b?.lang === 'en' ? `Sky release request received: ${code}` : `Заявка на релиз в Sky принята: ${code}`,
    b?.lang === 'en' ? `We received your release request “${title}”. Number: ${code}.` : `Мы получили заявку на релиз «${title}». Номер: ${code}.`).catch(() => {});
  void notifyStaff('site', { title: 'Новая заявка на релиз с сайта', body: `Номер ${code}`, dedupe: id });
  return { ok: true, code, token, id };
};

/** Вложение к своей заявке: нужен код и секрет подачи. Тип — по первым байтам. */
export const attach = async ({ owner, code, token, role, name }, req) => {
  const table = owner === 'release' ? 'site_releases' : owner === 'appeal' ? 'site_appeals' : null;
  if (!table) return { error: 'bad_owner' };
  const { rows } = await query(`SELECT id, token_hash FROM ${table} WHERE code = $1`, [String(code ?? '')]);
  const row = rows[0];
  if (!row || !sameHex(row.token_hash, hash('token', String(token ?? '')))) return { error: 'not_found' };
  const rules = ATT_RULES[owner]; const rule = rules.roles[role || 'file'];
  if (!rule) return { error: 'bad_role' };
  const n = Number((await query('SELECT count(*) FROM site_attachments WHERE owner_kind = $1 AND owner_id = $2', [owner, row.id])).rows[0].count);
  if (n >= rules.max) return { error: 'too_many_files' };
  const id = `sat-${generateId()}`;
  const saved = await saveStream(req, attPath(id), rule.limit);
  if (saved.error) return saved;
  const mime = sniff(saved.head);
  if (!mime || !rule.types.includes(mime)) { await rm(attPath(id), { force: true }).catch(() => {}); return { error: 'unsupported_type' }; }
  await query('INSERT INTO site_attachments (id, owner_kind, owner_id, role, name, mime, size) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, owner, row.id, role || 'file', clean(name, 120) || 'file', mime, saved.size]);
  return { ok: true, id, size: saved.size, mime };
};

/** Статус заявки по коду И почте — чужую по одному коду не посмотреть. */
export const checkAppeal = async (code, email) => {
  const e = clean(email, 254).toLowerCase();
  for (const [table, kind] of [['site_appeals', 'appeal'], ['site_releases', 'release']]) {
    const { rows } = await query(`SELECT status, answer, created_at, answered_at FROM ${table} WHERE code = $1 AND (email_hmac = $2 OR (email <> '' AND lower(email) = $3))`, [String(code ?? '').toUpperCase().trim(), emailMac(e), e]);
    if (rows[0]) return { ok: true, kind, status: rows[0].status, answer: rows[0].answer, createdAt: rows[0].created_at.toISOString(), answeredAt: rows[0].answered_at?.toISOString?.() ?? null };
  }
  return { error: 'not_found' };
};

/* ═══ Админка (право `site`) ═══════════════════════════════════════════════════════════════════ */

const allowed = (me) => can(me, 'site');
const log = (me, type, detail, meta) => logAdmin({ actorId: me, targetType: 'system', type, detail: String(detail).slice(0, 200), meta });

export const adminOverview = async (me) => {
  if (!(await allowed(me))) return null;
  const c = await query(`SELECT
      (SELECT count(*) FROM site_appeals WHERE status IN ('new','review')) AS appeals,
      (SELECT count(*) FROM site_releases WHERE status IN ('new','review')) AS releases,
      (SELECT count(*) FROM site_downloads WHERE file_id IS NOT NULL) AS files,
      (SELECT coalesce(sum(downloads),0) FROM site_files) AS downloads`);
  return { appealsOpen: Number(c.rows[0].appeals), releasesOpen: Number(c.rows[0].releases), filesUploaded: Number(c.rows[0].files), downloads: Number(c.rows[0].downloads) };
};

export const adminLinks = async (me) => (await allowed(me)) ? { links: (await query('SELECT key, label, url, sort FROM site_links ORDER BY sort, key')).rows } : null;
export const adminSaveLinks = async (me, links, meta) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  if (!Array.isArray(links) || links.length > 40) return { error: 'bad_links' };
  const rows = [];
  for (const [i, l] of links.entries()) {
    const key = clean(l?.key, 30); const url = clean(l?.url, 500); const label = clean(l?.label, 60) || key;
    if (!/^[a-z][a-z0-9_]{1,29}$/.test(key)) return { error: 'bad_key', key };
    if (url && !URL_OK(url)) return { error: 'bad_url', key };
    rows.push([key, label, url, i + 1]);
  }
  for (const r of rows) {
    await query(`INSERT INTO site_links (key, label, url, sort, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,now())
                 ON CONFLICT (key) DO UPDATE SET label=$2, url=$3, sort=$4, updated_by=$5, updated_at=now()`, [...r, me]);
  }
  await query('DELETE FROM site_links WHERE NOT (key = ANY($1))', [rows.map((r) => r[0])]);
  await log(me, 'site_links', `ссылок: ${rows.length}`, meta);
  return { ok: true };
};

const DL_STATUS = new Set(['available', 'soon', 'hidden']);
const EXT = { apk: 'application/vnd.android.package-archive', exe: 'application/vnd.microsoft.portable-executable', msi: 'application/x-msi', dmg: 'application/x-apple-diskimage',
  deb: 'application/vnd.debian.binary-package', appimage: 'application/octet-stream', zip: 'application/zip', ipa: 'application/octet-stream' };
export const DOWNLOAD_MAX = 600 * MB;

export const adminDownloads = async (me) => {
  if (!(await allowed(me))) return null;
  const { rows } = await query(`SELECT d.*, f.name AS file_name, f.size AS file_size, f.sha256 AS file_sha, f.downloads AS file_downloads, f.created_at AS file_at
                                  FROM site_downloads d LEFT JOIN site_files f ON f.id = d.file_id ORDER BY d.sort, d.platform`);
  return { items: rows.map((d) => ({ platform: d.platform, title: d.title, icon: d.icon, info: d.info, version: d.version, button: d.button, status: d.status, url: d.url,
    file: d.file_id ? { name: d.file_name, size: Number(d.file_size), sha256: d.file_sha, downloads: Number(d.file_downloads), uploadedAt: d.file_at.toISOString() } : null })) };
};
export const adminSaveDownload = async (me, platform, b, meta) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  const cur = (await query('SELECT * FROM site_downloads WHERE platform = $1', [platform])).rows[0];
  if (!cur) return { error: 'not_found' };
  const status = b?.status === undefined ? cur.status : String(b.status);
  if (!DL_STATUS.has(status)) return { error: 'bad_status' };
  const url = b?.url === undefined ? cur.url : clean(b.url, 500);
  if (url && !URL_OK(url)) return { error: 'bad_url' };
  await query(`UPDATE site_downloads SET title=$2, icon=$3, info=$4, version=$5, button=$6, status=$7, url=$8, updated_by=$9, updated_at=now() WHERE platform=$1`,
    [platform, clean(b?.title ?? cur.title, 60), clean(b?.icon ?? cur.icon, 8), clean(b?.info ?? cur.info, 120), clean(b?.version ?? cur.version, 40), clean(b?.button ?? cur.button, 40), status, url, me]);
  await log(me, 'site_download', `${platform}: ${status}${url ? ', ссылка' : ''}`, meta);
  return { ok: true };
};
/** Загрузка файла приложения: тело запроса — сам файл (поток), имя — в адресе. */
export const adminUploadFile = async (me, platform, name, req, meta) => {
  if (!(await allowed(me))) { req.resume(); return { error: 'not_allowed' }; }
  const cur = (await query('SELECT file_id FROM site_downloads WHERE platform = $1', [platform])).rows[0];
  if (!cur) { req.resume(); return { error: 'not_found' }; }
  const fname = clean(name, 120).replace(/[\\/]/g, '_');
  const ext = fname.split('.').pop()?.toLowerCase() ?? '';
  if (!EXT[ext]) { req.resume(); return { error: 'bad_extension', allowed: Object.keys(EXT) }; }
  const id = `sfl-${generateId()}`;
  const saved = await saveStream(req, filePath(id), DOWNLOAD_MAX);
  if (saved.error) return saved;
  await query('INSERT INTO site_files (id, name, mime, size, sha256, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)', [id, fname, EXT[ext], saved.size, saved.sha256, me]);
  // Загрузили файл — платформа «Скоро» становится «Доступно» (скрытую и уже доступную не трогаем); иначе люди видели бы файл, но кнопка оставалась «Скоро».
  await query("UPDATE site_downloads SET file_id = $2, updated_by = $3, updated_at = now(), status = CASE WHEN status = 'soon' THEN 'available' ELSE status END WHERE platform = $1", [platform, id, me]);
  if (cur.file_id) await dropFile(cur.file_id);
  await log(me, 'site_file_upload', `${platform}: ${fname} (${(saved.size / MB).toFixed(1)} МБ)`, meta);
  return { ok: true, id, size: saved.size, sha256: saved.sha256 };
};
const dropFile = async (id) => { await query('UPDATE site_downloads SET file_id = NULL WHERE file_id = $1', [id]); await query('DELETE FROM site_files WHERE id = $1', [id]); await rm(filePath(id), { force: true }).catch(() => {}); };

/** Последняя рассылка «Вышло обновление» (для панели «Обновления»). */
export const adminLastUpdateNotice = async (me) => {
  if (!(await allowed(me))) return null;
  const r = (await query("SELECT id, title, status, created_at, last_sent_at FROM notify_broadcasts WHERE reason LIKE 'app_update%' ORDER BY created_at DESC LIMIT 1")).rows[0];
  return { last: r ? { id: r.id, title: r.title, status: r.status, createdAt: r.created_at.toISOString(), sentAt: r.last_sent_at ? r.last_sent_at.toISOString() : null } : null };
};
/** «Разослать уведомление об обновлении»: обычная рассылка всем (тот же механизм, что вкладка «Рассылки»: уведомление в приложении + push тем, кто не в сети). */
export const adminNotifyUpdate = async (me, b, meta) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  if (b?.confirm !== true) return { error: 'confirm_required' };
  const version = clean(b?.version, 40);
  if (!version) return { error: 'version_required' };
  const recent = (await query("SELECT 1 FROM notify_broadcasts WHERE reason LIKE 'app_update%' AND created_at > now() - interval '10 minutes' LIMIT 1")).rows[0];
  if (recent) return { error: 'too_soon' };
  const title = `Вышло обновление Sky ${version}`;
  const text = cleanMulti(b?.text, 400) || 'Скачайте новую версию: Профиль → Настройки → «Обновления». Данные аккаунта останутся на месте.';
  const r = await createBroadcast(me, { title, body: text, audienceType: 'all', sendNow: true, reason: `app_update:${version}` }, { trusted: true });
  if (r.error) return r;
  await log(me, 'site_update_notice', `${version}: рассылка всем (${r.broadcast.id})`, meta);
  return { ok: true, id: r.broadcast.id };
};
export const adminDeleteFile = async (me, platform, meta) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  const cur = (await query('SELECT file_id FROM site_downloads WHERE platform = $1', [platform])).rows[0];
  if (!cur) return { error: 'not_found' };
  if (cur.file_id) await dropFile(cur.file_id);
  await log(me, 'site_file_delete', platform, meta);
  return { ok: true };
};

const COMP_STATES = new Set(['operational', 'degraded', 'outage', 'maintenance', 'dev']);
export const adminStatus = async (me) => {
  if (!(await allowed(me))) return null;
  const [c, m] = await Promise.all([query('SELECT id, name, icon, state, note, sort FROM site_status_components ORDER BY sort, id'), query('SELECT headline, note FROM site_status_meta WHERE id')]);
  return { headline: m.rows[0]?.headline ?? '', note: m.rows[0]?.note ?? '', components: c.rows };
};
export const adminSaveStatus = async (me, b, meta) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  const comps = Array.isArray(b?.components) ? b.components : null;
  if (!comps || comps.length > 40) return { error: 'bad_components' };
  const rows = [];
  for (const [i, c] of comps.entries()) {
    const id = clean(c?.id, 30) || `c${i + 1}`;
    if (!/^[a-z0-9_-]{1,30}$/i.test(id)) return { error: 'bad_id' };
    if (!COMP_STATES.has(c?.state)) return { error: 'bad_state', id };
    const name = clean(c?.name, 60); if (!name) return { error: 'name_required', id };
    rows.push([id, name, clean(c?.icon, 8), c.state, clean(c?.note, 200), i + 1]);
  }
  for (const r of rows) await query(`INSERT INTO site_status_components (id, name, icon, state, note, sort) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (id) DO UPDATE SET name=$2, icon=$3, state=$4, note=$5, sort=$6`, r);
  await query('DELETE FROM site_status_components WHERE NOT (id = ANY($1))', [rows.map((r) => r[0])]);
  await query('UPDATE site_status_meta SET headline=$1, note=$2, updated_by=$3, updated_at=now() WHERE id', [clean(b?.headline, 120), cleanMulti(b?.note, 600), me]);
  await log(me, 'site_status', `${rows.length} сервисов`, meta);
  return { ok: true };
};

export const adminMaintenance = async (me) => {
  if (!(await allowed(me))) return null;
  const m = (await query('SELECT maint_active, maint_title, maint_text, maint_until FROM site_status_meta WHERE id')).rows[0];
  const v = maintView(m);
  return { ...v, enabled: Boolean(m?.maint_active), expired: Boolean(m?.maint_active) && !v.active };
};
export const adminSaveMaintenance = async (me, b, meta) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  const on = b?.active === true;
  let until = null;
  if (b?.until) {
    until = new Date(b.until);
    if (Number.isNaN(until.getTime())) return { error: 'bad_until' };
    if (on && until.getTime() <= Date.now()) return { error: 'until_in_past' };
  }
  await query('UPDATE site_status_meta SET maint_active=$1, maint_title=$2, maint_text=$3, maint_until=$4, maint_by=$5, maint_at=now() WHERE id',
    [on, clean(b?.title, 120), cleanMulti(b?.text, 600), until, me]);
  await log(me, on ? 'site_maintenance_on' : 'site_maintenance_off', clean(b?.title, 120), meta);
  return { ok: true };
};

/* Апелляции и заявки на релиз — один механизм, две таблицы. */
const QUEUES = {
  appeal: { table: 'site_appeals', statuses: ['new', 'review', 'accepted', 'rejected', 'closed'], label: (r) => r.kind },
  release: { table: 'site_releases', statuses: ['new', 'review', 'approved', 'rejected'], label: (r) => r.title },
};
const rowView = (kind, r) => (kind === 'appeal'
  ? { id: r.id, code: r.code, kind: r.kind, username: r.username, email: emailOf(r), ref: r.ref, body: r.body, status: r.status, answer: r.answer, createdAt: r.created_at.toISOString(), answeredAt: r.answered_at?.toISOString?.() ?? null }
  : { id: r.id, code: r.code, kind: r.kind, title: r.title, email: emailOf(r), data: r.data, status: r.status, answer: r.answer, createdAt: r.created_at.toISOString(), answeredAt: r.answered_at?.toISOString?.() ?? null });

export const adminQueue = async (me, kind, status) => {
  if (!(await allowed(me))) return null;
  const Q = QUEUES[kind]; if (!Q) return null;
  const args = []; let where = '';
  if (status && Q.statuses.includes(status)) { args.push(status); where = 'WHERE status = $1'; }
  else where = `WHERE status IN ('new','review')`;
  const { rows } = await query(`SELECT * FROM ${Q.table} ${where} ORDER BY created_at DESC LIMIT 200`, args);
  const counts = (await query(`SELECT status, count(*)::int AS n FROM ${Q.table} GROUP BY status`)).rows;
  return { items: rows.map((r) => rowView(kind, r)), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
};
export const adminItem = async (me, kind, id) => {
  if (!(await allowed(me))) return null;
  const Q = QUEUES[kind]; if (!Q) return null;
  const r = (await query(`SELECT * FROM ${Q.table} WHERE id = $1`, [String(id ?? '')])).rows[0];
  if (!r) return { error: 'not_found' };
  const att = (await query('SELECT id, role, name, mime, size FROM site_attachments WHERE owner_kind = $1 AND owner_id = $2 ORDER BY created_at', [kind, r.id])).rows;
  return { item: rowView(kind, r), attachments: att.map((a) => ({ ...a, size: Number(a.size) })) };
};
export const adminDecide = async (me, kind, id, b, meta) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  const Q = QUEUES[kind]; if (!Q) return { error: 'bad_kind' };
  const status = String(b?.status ?? '');
  if (!Q.statuses.includes(status)) return { error: 'bad_status' };
  const answer = cleanMulti(b?.answer, 3000);
  const final = !['new', 'review'].includes(status);
  if (final && answer.length < 3) return { error: 'answer_required' };
  const r = (await query(`UPDATE ${Q.table} SET status=$2, answer=CASE WHEN $3 <> '' THEN $3 ELSE answer END, handled_by=$4, updated_at=now(),
                           answered_at = CASE WHEN $5 THEN now() ELSE answered_at END WHERE id=$1 RETURNING *`, [id, status, answer, me, final])).rows[0];
  if (!r) return { error: 'not_found' };
  await log(me, `site_${kind}_decide`, `${r.code}: ${status}`, meta);
  const en = r.lang === 'en';
  const names = { new: en ? 'received' : 'получена', review: en ? 'under review' : 'на рассмотрении', accepted: en ? 'accepted' : 'удовлетворена', approved: en ? 'approved' : 'одобрена', rejected: en ? 'rejected' : 'отклонена', closed: en ? 'closed' : 'закрыта' };
  if (b?.notify !== false) {
    await sendEmail(emailOf(r), en ? `Sky ${r.code}: ${names[status]}` : `Sky ${r.code}: ${names[status]}`,
      en ? `Your ${kind === 'appeal' ? 'appeal' : 'release request'} ${r.code} is now: ${names[status]}.\n\n${r.answer || ''}` : `Ваша ${kind === 'appeal' ? 'апелляция' : 'заявка на релиз'} ${r.code}: ${names[status]}.\n\n${r.answer || ''}`).catch(() => {});
  }
  return { ok: true, item: rowView(kind, r) };
};
export const adminAttachment = async (me, id) => {
  if (!(await allowed(me))) return null;
  const a = (await query('SELECT * FROM site_attachments WHERE id = $1', [String(id ?? '')])).rows[0];
  if (!a) return { error: 'not_found' };
  try { await stat(attPath(a.id)); } catch { return { error: 'not_found' }; }
  return { att: a, path: attPath(a.id) };
};

export const sweepSite = async () => {
  // Заявки без подтверждения и без файлов старше 2 лет не нужны; вложения закрытых заявок хранятся 180 дней.
  const old = (await query(`SELECT a.id, a.owner_kind FROM site_attachments a
      LEFT JOIN site_appeals p ON a.owner_kind = 'appeal' AND p.id = a.owner_id
      LEFT JOIN site_releases r ON a.owner_kind = 'release' AND r.id = a.owner_id
     WHERE coalesce(p.status, r.status) IN ('closed','rejected','accepted','approved') AND coalesce(p.updated_at, r.updated_at) < now() - interval '180 days'`)).rows;
  for (const a of old) { await rm(attPath(a.id), { force: true }).catch(() => {}); await query('DELETE FROM site_attachments WHERE id = $1', [a.id]); }
};
