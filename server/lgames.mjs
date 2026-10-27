/**
 * Sky Game Launcher: каталог игр, библиотека, сборки (файлы и манифесты), кабинет владельца, заказ размещения (499 ₽), модерация.
 *
 * Принципы:
 *  • Файлы игр лежат на диске по хешу содержимого (`blobs/ab/<sha256>`): одинаковые файлы разных версий хранятся один раз — обновление скачивает только изменившееся.
 *    Хеш и размер считает СЕРВЕР при приёме потока; присланным клиентом контрольным суммам не верим. Пользовательский код на сервере не исполняется никогда.
 *  • Манифест строится сервером из принятых файлов; клиент получает только пути (проверенные), размеры и хеши, скачивает по `buildId + sha256` с проверкой права.
 *  • Цена размещения (499 ₽) и её списание — только на сервере, в одной транзакции со сменой статуса заявки; повтор того же запроса и повторная заявка не списывают дважды.
 *  • Публикация новой сборки — отдельное действие после одобрения; загрузка ничего не заменяет у людей.
 *  • Игры сейчас БЕСПЛАТНЫЕ для игроков: цены продажи и выплат разработчикам в Sky Launcher нет (так и сказано в интерфейсе).
 */
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { query, pool } from './db.mjs';
import { wallet } from './wallet.mjs';
import { notifyGift } from './giftnotify.mjs';
import { notifyStaff } from './staffnotify.mjs';

export const PLACEMENT_PRICE_RUB = 499;
export const DIR = () => process.env.LAUNCHER_DIR || '/data/launcher';
const MAX_FILE = Number(process.env.LAUNCHER_MAX_FILE_BYTES) || 4 * 1024 ** 3;
const MAX_BUILD = Number(process.env.LAUNCHER_MAX_BUILD_BYTES) || 20 * 1024 ** 3;
const MAX_FILES = 20000;
const MAX_GAMES_PER_OWNER = 20;
export const GENRES = ['Экшен', 'Приключения', 'Ролевые', 'Стратегии', 'Симуляторы', 'Шутеры', 'Платформеры', 'Головоломки', 'Гонки', 'Спорт', 'Выживание', 'Инди', 'Казуальные', 'Хоррор', 'Файтинги'];
const OS = ['windows', 'linux', 'macos'];
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const line = (v, n) => txt(v, n).replace(/\s+/g, ' ');
const withTx = async (fn) => { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };
const id = (p) => `${p}-${randomUUID()}`;

export const TERMS = {
  priceRub: PLACEMENT_PRICE_RUB,
  includes: ['Страница игры в каталоге Sky Launcher', 'Проверка карточки и сборки сотрудниками Sky', 'Хранение сборок и раздача обновлений игрокам', 'Статистика установок и запусков в кабинете'],
  requirements: ['Права на распространение игры и всех её частей у заявителя', 'Название, описание, обложка и хотя бы один скриншот', 'Загруженная и проверенная сборка для Windows с указанным исполняемым файлом', 'Игра не содержит вредоносного кода и не нарушает правила Sky'],
  review: 'Заявка проверяется сотрудниками вручную: карточка, права, антивирусная проверка доступными средствами, затем установка и запуск. Антивирусная проверка не является абсолютной гарантией.',
  term: 'Срок размещения не ограничен и продление не требуется. Если условия изменятся, это будет объявлено заранее.',
  refund: 'Если заявка отклонена, 499 ₽ возвращаются на кошелёк Sky полностью. Если заявку вернули на доработку — деньги остаются, повторная оплата не нужна. Блокировка за нарушение правил возврата не даёт.',
  rejectReasons: ['нет прав на распространение', 'вредоносное или опасное содержимое', 'нарушение правил Sky или закона', 'игра не запускается или не соответствует описанию', 'неполная или недостоверная карточка'],
  appeal: 'Решение можно оспорить обращением в поддержку Sky с номером заявки: заявку рассмотрит другой сотрудник.',
  payment: 'Оплата — с кошелька Sky (пополнение через SkyKassa). Оплата не гарантирует одобрение.',
};

/* ───────── безопасные пути и файлы ───────── */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Нормализует относительный путь файла сборки. null — путь недопустим (выход за каталог, диск, служебные имена). */
export const safeRelPath = (raw) => {
  const p = String(raw ?? '');
  if (!p || p.length > 240 || /[\u0000-\u001f\\:*?"<>|]/.test(p) || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split('/');
  if (parts.length > 20) return null;
  for (const s of parts) { if (!s || s === '.' || s === '..' || s.length > 120 || /[. ]$/.test(s) || RESERVED.test(s)) return null; }
  return parts.join('/');
};
const blobPath = (sha) => join(DIR(), 'blobs', sha.slice(0, 2), sha);
const SHA_RE = /^[0-9a-f]{64}$/;

/* ───────── права участников ───────── */
const CAN = {
  owner:     new Set(['view', 'edit', 'build', 'submit', 'publish', 'news', 'stats', 'team', 'orders']),
  developer: new Set(['view', 'edit', 'build', 'news', 'stats']),
  publisher: new Set(['view', 'edit', 'submit', 'publish', 'news', 'stats']),
  analyst:   new Set(['view', 'stats']),
};
export const roleOf = async (gameId, me) => (await query('SELECT role FROM launcher_game_members WHERE game_id=$1 AND profile_id=$2', [gameId, me])).rows[0]?.role ?? null;
const need = async (gameId, me, perm) => { const r = await roleOf(gameId, me); return r && CAN[r].has(perm) ? r : null; };
const gameRow = async (gid) => (await query('SELECT * FROM launcher_games WHERE id=$1', [gid])).rows[0] ?? null;

/* ───────── карточка игры ───────── */
export const cleanGame = (b) => {
  const out = {}; const errors = [];
  if (b.title !== undefined) { const t = line(b.title, 80); if (t.length < 2) errors.push('title: от 2 знаков'); else out.title = t; }
  if (b.shortDescr !== undefined) out.short_descr = line(b.shortDescr, 160);
  if (b.descr !== undefined) out.descr = txt(b.descr, 4000);
  if (b.genres !== undefined) out.genres = [...new Set((Array.isArray(b.genres) ? b.genres : []).map((g) => line(g, 30)).filter((g) => GENRES.includes(g)))].slice(0, 4);
  if (b.developer !== undefined) out.developer = line(b.developer, 80);
  if (b.publisher !== undefined) out.publisher = line(b.publisher, 80);
  if (b.os !== undefined) out.os = [...new Set((Array.isArray(b.os) ? b.os : []).filter((o) => OS.includes(o)))];
  if (b.requirements !== undefined) {
    const r = b.requirements && typeof b.requirements === 'object' ? b.requirements : {};
    out.requirements = Object.fromEntries(['os', 'cpu', 'ram', 'gpu', 'disk', 'notes'].filter((k) => r[k] !== undefined).map((k) => [k, line(r[k], 120)]));
  }
  if (b.links !== undefined) {
    const l = b.links && typeof b.links === 'object' ? b.links : {}; const o = {};
    for (const k of ['site', 'support']) if (l[k]) { try { const u = new URL(String(l[k])); if (u.protocol === 'https:' && !u.username && !u.password) o[k] = u.toString().slice(0, 300); else errors.push(`links.${k}: только https`); } catch { errors.push(`links.${k}: неверная ссылка`); } }
    out.links = o;
  }
  return { errors, value: out };
};
const gameView = (g, extra = {}) => ({
  id: g.id, title: g.title, shortDescr: g.short_descr, descr: g.descr, genres: g.genres, developer: g.developer, publisher: g.publisher, requirements: g.requirements, os: g.os, links: g.links,
  status: g.status, statusNote: g.status_note, featured: g.featured, publishedAt: g.published_at?.toISOString() ?? null, updatedAt: g.updated_at.toISOString(), ...extra,
});

export const createGame = async (me, b) => {
  const { errors, value } = cleanGame({ title: b.title, ...b }); if (errors.length || !value.title) return { error: 'invalid', errors: errors.length ? errors : ['title обязателен'] };
  const n = (await query(`SELECT count(*)::int AS n FROM launcher_game_members WHERE profile_id=$1 AND role='owner'`, [me])).rows[0].n; if (n >= MAX_GAMES_PER_OWNER) return { error: 'too_many' };
  const gid = id('lgm');
  await withTx(async (c) => {
    await c.query(`INSERT INTO launcher_games (id, title, short_descr, descr, genres, developer, publisher, requirements, os, links, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [gid, value.title, value.short_descr ?? '', value.descr ?? '', value.genres ?? [], value.developer ?? '', value.publisher ?? '', JSON.stringify(value.requirements ?? {}), value.os ?? ['windows'], JSON.stringify(value.links ?? {}), me]);
    await c.query(`INSERT INTO launcher_game_members (game_id, profile_id, role) VALUES ($1,$2,'owner')`, [gid, me]);
  });
  return { ok: true, id: gid };
};
export const saveGame = async (me, gid, b) => {
  if (!(await need(gid, me, 'edit'))) return { error: 'not_found' };
  const g = await gameRow(gid); if (['blocked'].includes(g.status)) return { error: 'blocked' };
  const { errors, value } = cleanGame(b); if (errors.length) return { error: 'invalid', errors };
  const set = Object.entries(value); if (!set.length) return { ok: true };
  const cols = set.map(([k], i) => `${k}=$${i + 2}`).join(', ');
  await query(`UPDATE launcher_games SET ${cols}, updated_at=now() WHERE id=$1`, [gid, ...set.map(([, v]) => (typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v))]);
  if (g.status === 'published') await query(`INSERT INTO launcher_mod_log (game_id, actor_id, action, note) VALUES ($1,$2,'card_edit_live',$3)`, [gid, me, Object.keys(value).join(',')]);
  return { ok: true };
};

/* ───────── изображения ───────── */
const IMG = [[Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png'], [Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'], [Buffer.from('RIFF'), 'image/webp']];
export const sniffImage = (buf) => { for (const [sig, mime] of IMG) if (buf.subarray(0, sig.length).equals(sig) && (mime !== 'image/webp' || buf.subarray(8, 12).toString() === 'WEBP')) return mime; return null; };
export const addMedia = async (me, gid, kind, buf) => {
  if (!(await need(gid, me, 'edit'))) return { error: 'not_found' };
  if (!['cover', 'screenshot'].includes(kind)) return { error: 'bad_kind' };
  if (!buf?.length || buf.length > 1_000_000) return { error: 'too_large' };
  const mime = sniffImage(buf); if (!mime) return { error: 'bad_image' };
  if (kind === 'screenshot') { const n = (await query(`SELECT count(*)::int AS n FROM launcher_game_media WHERE game_id=$1 AND kind='screenshot'`, [gid])).rows[0].n; if (n >= 8) return { error: 'too_many' }; }
  if (kind === 'cover') await query(`DELETE FROM launcher_game_media WHERE game_id=$1 AND kind='cover'`, [gid]);
  const mid = id('lmd');
  await query(`INSERT INTO launcher_game_media (id, game_id, kind, mime, bytes, data, position) VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(max(position),0)+1 FROM launcher_game_media WHERE game_id=$2 AND kind=$3))`, [mid, gid, kind, mime, buf.length, buf]);
  return { ok: true, id: mid };
};
export const deleteMedia = async (me, gid, mid) => { if (!(await need(gid, me, 'edit'))) return { error: 'not_found' }; return { ok: (await query('DELETE FROM launcher_game_media WHERE id=$1 AND game_id=$2', [mid, gid])).rowCount > 0 }; };
/** Картинка: опубликованной игры — любому вошедшему; иначе только участникам и сотрудникам с правом (проверяет маршрут). */
export const getMedia = async (mid, me, isStaff) => {
  const r = (await query(`SELECT m.mime, m.data, g.status, g.id AS gid FROM launcher_game_media m JOIN launcher_games g ON g.id=m.game_id WHERE m.id=$1`, [mid])).rows[0]; if (!r) return null;
  if (r.status !== 'published' && !isStaff && !(await roleOf(r.gid, me))) return null;
  return { mime: r.mime, data: r.data };
};
const mediaOf = async (gid) => (await query(`SELECT id, kind FROM launcher_game_media WHERE game_id=$1 ORDER BY kind, position`, [gid])).rows;

/* ───────── сборки ───────── */
const buildView = (b) => ({ id: b.id, version: b.version, channel: b.channel, status: b.status, launchExe: b.launch_exe, launchArgs: b.launch_args, notes: b.notes, totalBytes: Number(b.total_bytes), fileCount: b.file_count, scanStatus: b.scan_status, scanDetail: b.scan_detail, reviewNote: b.review_note, blocked: b.blocked, error: b.error, createdAt: b.created_at.toISOString(), publishedAt: b.published_at?.toISOString() ?? null });
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,30}$/;
export const createBuild = async (me, gid, { version, channel = 'release', notes = '' } = {}) => {
  if (!(await need(gid, me, 'build'))) return { error: 'not_found' };
  const g = await gameRow(gid); if (g.status === 'blocked') return { error: 'blocked' };
  if (!VERSION_RE.test(String(version ?? ''))) return { error: 'bad_version' };
  if (!['release', 'test'].includes(channel)) return { error: 'bad_channel' };
  const n = (await query(`SELECT count(*)::int AS n FROM launcher_builds WHERE game_id=$1 AND status IN ('uploading','uploaded')`, [gid])).rows[0].n; if (n >= 3) return { error: 'too_many_open_builds' };
  const bid = id('lbd');
  try { await query(`INSERT INTO launcher_builds (id, game_id, version, channel, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [bid, gid, String(version), channel, txt(notes, 2000), me]); }
  catch (e) { if (e.code === '23505') return { error: 'version_exists' }; throw e; }
  return { ok: true, id: bid };
};
const ownBuild = async (me, bid, perm = 'build') => {
  const b = (await query('SELECT * FROM launcher_builds WHERE id=$1', [bid])).rows[0]; if (!b) return null;
  return (await need(b.game_id, me, perm)) ? b : null;
};

/** Принимает файл потоком: считает SHA-256 и размер на лету, пишет во временный файл, кладёт по хешу. Не держит файл в памяти. */
export const receiveFile = async (me, bid, relPath, stream, declaredSize) => {
  const b = await ownBuild(me, bid); if (!b) { stream.resume(); return { error: 'not_found' }; }
  if (b.status !== 'uploading') { stream.resume(); return { error: 'build_closed' }; }
  const p = safeRelPath(relPath); if (!p) { stream.resume(); return { error: 'bad_path' }; }
  const lower = p.toLowerCase();
  const ex = (await query('SELECT path FROM launcher_build_files WHERE build_id=$1 AND lower(path)=$2', [bid, lower])).rows[0];
  if (ex && ex.path !== p) { stream.resume(); return { error: 'path_case_conflict' }; }
  const cnt = (await query('SELECT count(*)::int AS n, COALESCE(sum(size),0)::bigint AS s FROM launcher_build_files WHERE build_id=$1 AND path<>$2', [bid, p])).rows[0];
  if (cnt.n >= MAX_FILES) { stream.resume(); return { error: 'too_many_files' }; }
  if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE) { stream.resume(); return { error: 'file_too_large' }; }
  const tmp = join(DIR(), 'tmp', `${randomUUID()}.part`); await mkdir(dirname(tmp), { recursive: true });
  const hash = createHash('sha256'); let size = 0; const budget = Math.min(MAX_FILE, MAX_BUILD - Number(cnt.s));
  const out = createWriteStream(tmp);
  const result = await new Promise((resolve) => {
    let failed = null;
    stream.on('data', (ch) => { size += ch.length; if (size > budget) { failed = size > MAX_FILE ? 'file_too_large' : 'build_too_large'; stream.destroy(); return; } hash.update(ch); if (!out.write(ch)) { stream.pause(); out.once('drain', () => stream.resume()); } });
    stream.on('end', () => out.end(() => resolve(failed ? { error: failed } : { ok: true })));
    stream.on('error', () => { out.destroy(); resolve({ error: failed || 'upload_aborted' }); });
    stream.on('close', () => { if (failed) { out.destroy(); resolve({ error: failed }); } });
  });
  if (result.error) { await rm(tmp, { force: true }); return result; }
  if (Number.isFinite(declaredSize) && declaredSize !== size) { await rm(tmp, { force: true }); return { error: 'size_mismatch' }; }
  const sha = hash.digest('hex'); const dest = blobPath(sha);
  await mkdir(dirname(dest), { recursive: true });
  if (await access(dest).then(() => true, () => false)) await rm(tmp, { force: true }); else await rename(tmp, dest);
  await query(`INSERT INTO launcher_build_files (build_id, path, sha256, size) VALUES ($1,$2,$3,$4) ON CONFLICT (build_id, path) DO UPDATE SET sha256=$3, size=$4`, [bid, p, sha, size]);
  return { ok: true, path: p, sha256: sha, size };
};
export const removeBuildFile = async (me, bid, relPath) => { const b = await ownBuild(me, bid); if (!b) return { error: 'not_found' }; if (b.status !== 'uploading') return { error: 'build_closed' }; return { ok: (await query('DELETE FROM launcher_build_files WHERE build_id=$1 AND path=$2', [bid, relPath])).rowCount > 0 }; };

const runScan = (file) => new Promise((resolve) => {
  const cmd = process.env.LAUNCHER_AV_CMD; if (!cmd) return resolve({ status: 'not_run' });
  execFile(cmd, [...(process.env.LAUNCHER_AV_ARGS ? process.env.LAUNCHER_AV_ARGS.split(' ') : ['--no-summary']), file], { timeout: 120000 }, (err, out) => {
    if (!err) return resolve({ status: 'clean' });
    if (err.code === 1) return resolve({ status: 'infected', detail: String(out).split('\n')[0].slice(0, 200) });
    resolve({ status: 'error', detail: String(err.message).slice(0, 120) });
  });
});
const ARG_RE = /^[-A-Za-z0-9_=.:/+]{1,60}$/;
/** Закрывает загрузку: проверяет состав, исполняемый файл и аргументы, запускает антивирус (если настроен), фиксирует манифест. */
export const finalizeBuild = async (me, bid, { launchExe, launchArgs = [] } = {}) => {
  const b = await ownBuild(me, bid); if (!b) return { error: 'not_found' };
  if (b.status !== 'uploading') return { error: 'build_closed' };
  const files = (await query('SELECT path, sha256, size FROM launcher_build_files WHERE build_id=$1', [bid])).rows;
  if (!files.length) return { error: 'no_files' };
  const exe = safeRelPath(launchExe); if (!exe || !/\.exe$/i.test(exe) || !files.some((f) => f.path === exe)) return { error: 'bad_launch_exe' };
  const args = (Array.isArray(launchArgs) ? launchArgs : []).map(String); if (args.length > 8 || args.some((a) => !ARG_RE.test(a))) return { error: 'bad_launch_args' };
  let scan = { status: 'not_run' };
  if (process.env.LAUNCHER_AV_CMD) {
    for (const f of files) { const r = await runScan(blobPath(f.sha256)); if (r.status !== 'clean') { scan = { status: r.status, detail: `${f.path}: ${r.detail ?? ''}` }; break; } scan = { status: 'clean' }; }
  }
  const total = files.reduce((a, f) => a + Number(f.size), 0);
  const failed = scan.status === 'infected' || scan.status === 'error';
  await query(`UPDATE launcher_builds SET status=$2, launch_exe=$3, launch_args=$4, total_bytes=$5, file_count=$6, scan_status=$7, scan_detail=$8, error=$9, updated_at=now() WHERE id=$1`,
    [bid, failed ? 'failed' : 'uploaded', exe, args, total, files.length, scan.status, scan.detail ?? '', failed ? 'Антивирусная проверка не пройдена' : '']);
  return { ok: !failed, scan, status: failed ? 'failed' : 'uploaded' };
};
export const manifestOf = async (bid) => {
  const b = (await query('SELECT * FROM launcher_builds WHERE id=$1', [bid])).rows[0]; if (!b) return null;
  const files = (await query('SELECT path, sha256, size FROM launcher_build_files WHERE build_id=$1 ORDER BY path', [bid])).rows;
  return { gameId: b.game_id, buildId: b.id, version: b.version, channel: b.channel, totalBytes: Number(b.total_bytes), launch: { exe: b.launch_exe, args: b.launch_args }, files: files.map((f) => ({ path: f.path, size: Number(f.size), sha256: f.sha256 })) };
};
export const listBuilds = async (me, gid) => { if (!(await need(gid, me, 'view'))) return { error: 'not_found' }; const { rows } = await query('SELECT * FROM launcher_builds WHERE game_id=$1 ORDER BY created_at DESC LIMIT 100', [gid]); return { builds: rows.map(buildView) }; };

/** Отправка сборки на проверку: игра уже оплачена/одобрена (для первой сборки — через заявку на размещение). */
export const submitBuild = async (me, bid) => {
  const b = await ownBuild(me, bid, 'submit') ?? await ownBuild(me, bid, 'build'); if (!b) return { error: 'not_found' };
  const g = await gameRow(b.game_id); const role = await roleOf(b.game_id, me);
  if (!CAN[role].has('submit')) return { error: 'forbidden' };
  if (b.status !== 'uploaded') return { error: 'not_ready' };
  if (g.status !== 'published') return { error: 'game_not_published' };   // для ещё не опубликованной игры — через submitGame
  await query(`UPDATE launcher_builds SET status='submitted', updated_at=now() WHERE id=$1 AND status='uploaded'`, [bid]);
  void notifyStaff('launcher', { title: 'Sky Launcher: новая сборка на проверку', body: `${g.title} · ${b.version}`, dedupe: `bld:${bid}`, except: me }).catch(() => {});
  return { ok: true };
};
export const deleteBuild = async (me, bid) => {
  const b = await ownBuild(me, bid); if (!b) return { error: 'not_found' };
  if (['published', 'approved', 'submitted'].includes(b.status)) return { error: 'build_in_use' };
  await query('DELETE FROM launcher_builds WHERE id=$1', [bid]); return { ok: true };
};

/* ───────── публикация сборок и откат ───────── */
const liveSwitch = async (c, g, bid, actor) => {
  if (g.published_build_id && g.published_build_id !== bid) await c.query(`UPDATE launcher_builds SET status='superseded', updated_at=now() WHERE id=$1 AND status='published'`, [g.published_build_id]);
  await c.query(`UPDATE launcher_builds SET status='published', published_at=now(), updated_at=now() WHERE id=$1`, [bid]);
  await c.query(`UPDATE launcher_games SET published_build_id=$2, updated_at=now() WHERE id=$1`, [g.id, bid]);
  await c.query(`INSERT INTO launcher_mod_log (game_id, actor_id, action, note) VALUES ($1,$2,'build_live',$3)`, [g.id, actor, bid]);
};
/** Выпустить одобренную сборку (или вернуть прежнюю, ранее опубликованную) — владелец и менеджер публикаций. */
export const publishBuild = async (me, bid) => withTx(async (c) => {
  const b = (await c.query('SELECT * FROM launcher_builds WHERE id=$1 FOR UPDATE', [bid])).rows[0]; if (!b) return { error: 'not_found' };
  if (!(await need(b.game_id, me, 'publish'))) return { error: 'not_found' };
  const g = (await c.query('SELECT * FROM launcher_games WHERE id=$1 FOR UPDATE', [b.game_id])).rows[0];
  if (g.status !== 'published') return { error: 'game_not_published' };
  if (b.channel !== 'release') return { error: 'test_channel' };
  if (b.blocked) return { error: 'build_blocked' };
  if (!['approved', 'superseded'].includes(b.status) || !b.approved_at) return { error: 'not_approved' };
  if (g.published_build_id === bid) return { ok: true, duplicate: true };
  await liveSwitch(c, g, bid, me); return { ok: true };
});

/* ───────── заказ размещения 499 ₽ ───────── */
export const placementState = async (me, gid) => {
  if (!(await need(gid, me, 'view'))) return { error: 'not_found' };
  const o = (await query('SELECT id, amount_rub, status, created_at, paid_at, refunded_at FROM launcher_orders WHERE game_id=$1 ORDER BY created_at DESC LIMIT 5', [gid])).rows;
  const g = await gameRow(gid); const bal = await wallet.getState?.(me).catch(() => null);
  return { terms: TERMS, priceRub: PLACEMENT_PRICE_RUB, gameStatus: g.status, orders: o.map((x) => ({ id: x.id, amountRub: x.amount_rub, status: x.status, createdAt: x.created_at.toISOString(), paidAt: x.paid_at?.toISOString() ?? null, refundedAt: x.refunded_at?.toISOString() ?? null })), balance: bal?.balance ?? null };
};
const missingForSubmit = async (g) => {
  const miss = [];
  if (!g.title) miss.push('Название'); if (!g.descr || g.descr.length < 30) miss.push('Описание (от 30 знаков)'); if (!g.genres.length) miss.push('Жанр');
  if (!g.developer) miss.push('Разработчик'); if (!g.os.length) miss.push('Поддерживаемая ОС'); if (!Object.keys(g.requirements ?? {}).length) miss.push('Системные требования');
  const m = await mediaOf(g.id); if (!m.some((x) => x.kind === 'cover')) miss.push('Обложка'); if (!m.some((x) => x.kind === 'screenshot')) miss.push('Хотя бы один скриншот');
  const b = (await query(`SELECT count(*)::int AS n FROM launcher_builds WHERE game_id=$1 AND channel='release' AND status IN ('uploaded','submitted','approved','published')`, [g.id])).rows[0].n;
  if (!b) miss.push('Загруженная сборка (закрытая проверка файлов)');
  return miss;
};
/** Подать заявку: сервер сам определяет цену, списывает с кошелька и меняет статус одной транзакцией. Повтор того же ключа и повторная заявка не списывают дважды. */
export const submitGame = async (me, gid, idemKey) => {
  const key = String(idemKey ?? '').slice(0, 80); if (key.length < 8) return { error: 'idem_required' };
  if ((await roleOf(gid, me)) !== 'owner') return { error: 'not_found' };
  const dup = (await query('SELECT id, status, game_id FROM launcher_orders WHERE profile_id=$1 AND idem_key=$2', [me, key])).rows[0];
  if (dup) return dup.game_id === gid ? { ok: true, duplicate: true, orderId: dup.id, orderStatus: dup.status } : { error: 'idem_conflict' };
  return withTx(async (c) => {
    const g = (await c.query('SELECT * FROM launcher_games WHERE id=$1 FOR UPDATE', [gid])).rows[0]; if (!g) return { error: 'not_found' };
    if (!['draft', 'needs_changes', 'awaiting_payment'].includes(g.status)) return { error: 'bad_status', status: g.status };
    const miss = await missingForSubmit(g); if (miss.length) return { error: 'incomplete', missing: miss };
    const paid = (await c.query(`SELECT id FROM launcher_orders WHERE game_id=$1 AND status='paid'`, [gid])).rows[0];
    let orderId = paid?.id;
    if (!paid) {
      orderId = id('lor');
      await c.query(`INSERT INTO launcher_orders (id, game_id, profile_id, amount_rub, idem_key) VALUES ($1,$2,$3,$4,$5)`, [orderId, gid, me, PLACEMENT_PRICE_RUB, key]);
      const sp = await wallet.spendIn(c, me, PLACEMENT_PRICE_RUB, 'launcher_placement', `Размещение игры «${g.title}» в Sky Launcher`, `launcher:${orderId}`);
      if (sp.error) throw Object.assign(new Error(sp.error), { launcher: sp });
      await c.query(`UPDATE launcher_orders SET status='paid', paid_at=now() WHERE id=$1`, [orderId]);
    }
    await c.query(`UPDATE launcher_games SET status='pending_review', status_note='', updated_at=now() WHERE id=$1`, [gid]);
    await c.query(`UPDATE launcher_builds SET status='submitted', updated_at=now() WHERE game_id=$1 AND channel='release' AND status='uploaded'`, [gid]);
    await c.query(`INSERT INTO launcher_mod_log (game_id, actor_id, action, note) VALUES ($1,$2,'submitted',$3)`, [gid, me, orderId]);
    void notifyStaff('launcher', { title: 'Sky Launcher: заявка на размещение игры', body: g.title, dedupe: `game:${gid}:${orderId}`, except: me }).catch(() => {});
    return { ok: true, orderId, charged: !paid };
  }).catch((e) => { if (e.launcher) return { error: e.launcher.error, balance: e.launcher.balance }; if (e.code === '23505') return { error: 'already_paid_or_duplicate' }; throw e; });
};

/* ───────── модерация ───────── */
const modLog = (c, gid, actor, action, note = '') => c.query('INSERT INTO launcher_mod_log (game_id, actor_id, action, note) VALUES ($1,$2,$3,$4)', [gid, actor, action, String(note).slice(0, 500)]);
const ownerOf = async (c, gid) => (await c.query(`SELECT profile_id FROM launcher_game_members WHERE game_id=$1 AND role='owner'`, [gid])).rows[0]?.profile_id;
/** decision: approve | needs_changes | reject | unpublish | block | unblock. Отказ возвращает плату; доработка и блокировка — нет. */
export const decideGame = async (actor, gid, decision, note = '') => {
  const why = line(note, 500);
  if (['needs_changes', 'reject', 'block', 'unpublish'].includes(decision) && why.length < 5) return { error: 'reason_required' };
  const res = await withTx(async (c) => {
    const g = (await c.query('SELECT * FROM launcher_games WHERE id=$1 FOR UPDATE', [gid])).rows[0]; if (!g) return { error: 'not_found' };
    const owner = await ownerOf(c, gid);
    if (owner === actor && decision !== 'unpublish') return { error: 'self_review' };
    if (decision === 'approve') {
      if (g.status !== 'pending_review') return { error: 'bad_status' };
      const b = (await c.query(`SELECT * FROM launcher_builds WHERE game_id=$1 AND channel='release' AND status='submitted' AND NOT blocked ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [gid])).rows[0];
      if (!b) return { error: 'no_submitted_build' };
      if (b.scan_status === 'infected') return { error: 'build_infected' };
      await c.query(`UPDATE launcher_builds SET approved_at=now(), approved_by=$2 WHERE id=$1`, [b.id, actor]);
      await c.query(`UPDATE launcher_games SET status='published', status_note='', published_at=COALESCE(published_at, now()) WHERE id=$1`, [gid]);
      await liveSwitch(c, { ...g, published_build_id: null }, b.id, actor);
      await modLog(c, gid, actor, 'approved', b.id);
    } else if (decision === 'needs_changes') {
      if (g.status !== 'pending_review') return { error: 'bad_status' };
      await c.query(`UPDATE launcher_games SET status='needs_changes', status_note=$2, updated_at=now() WHERE id=$1`, [gid, why]);
      await c.query(`UPDATE launcher_builds SET status='uploaded' WHERE game_id=$1 AND status='submitted'`, [gid]); await modLog(c, gid, actor, 'needs_changes', why);
    } else if (decision === 'reject') {
      if (!['pending_review', 'needs_changes'].includes(g.status)) return { error: 'bad_status' };
      await c.query(`UPDATE launcher_games SET status='rejected', status_note=$2, updated_at=now() WHERE id=$1`, [gid, why]);
      await c.query(`UPDATE launcher_builds SET status='rejected', review_note=$2 WHERE game_id=$1 AND status IN ('submitted','uploaded')`, [gid, why]);
      const o = (await c.query(`SELECT * FROM launcher_orders WHERE game_id=$1 AND status='paid' FOR UPDATE`, [gid])).rows[0];
      if (o) {   // возврат по опубликованным условиям: отказ → плата возвращается полностью, один раз (ref + статус заказа)
        await wallet.creditIn(c, o.profile_id, o.amount_rub, 'launcher_refund', `Возврат за размещение игры «${g.title}»`, `launcher-refund:${o.id}`);
        await c.query(`UPDATE launcher_orders SET status='refunded', refunded_at=now(), refund_reason=$2 WHERE id=$1`, [o.id, why]);
      }
      await modLog(c, gid, actor, 'rejected', why);
    } else if (decision === 'unpublish' || decision === 'block') {
      await c.query(`UPDATE launcher_games SET status=$2, status_note=$3, updated_at=now() WHERE id=$1`, [gid, decision === 'block' ? 'blocked' : 'unpublished', why]);
      if (decision === 'block') await c.query(`UPDATE launcher_builds SET blocked=TRUE WHERE game_id=$1`, [gid]);
      await modLog(c, gid, actor, decision, why);
    } else if (decision === 'unblock') {
      if (g.status !== 'blocked') return { error: 'bad_status' };
      await c.query(`UPDATE launcher_games SET status='unpublished', status_note='', updated_at=now() WHERE id=$1`, [gid]); await c.query(`UPDATE launcher_builds SET blocked=FALSE WHERE game_id=$1`, [gid]); await modLog(c, gid, actor, 'unblocked', why);
    } else if (decision === 'republish') {
      if (g.status !== 'unpublished' || !g.published_build_id) return { error: 'bad_status' };
      await c.query(`UPDATE launcher_games SET status='published', status_note='', updated_at=now() WHERE id=$1`, [gid]); await modLog(c, gid, actor, 'republished', why);
    } else return { error: 'bad_decision' };
    return { ok: true, owner, title: g.title };
  });
  if (res.ok && res.owner) void notifyGift(res.owner, 'launcher', 'Sky Launcher', `«${res.title}»: ${({ approve: 'заявка одобрена, игра опубликована', needs_changes: `нужны исправления — ${why}`, reject: `заявка отклонена (${why}); плата за размещение возвращена на кошелёк`, unpublish: `игра снята с публикации — ${why}`, block: `игра заблокирована — ${why}`, unblock: 'блокировка снята', republish: 'игра снова опубликована' })[decision]}`, gid).catch(() => {});
  return res;
};
/** Решение по отдельной сборке уже опубликованной игры: approve (становится доступной для публикации владельцем) | reject | block (в т.ч. остановить опасную сборку). */
export const decideBuild = async (actor, bid, decision, note = '') => withTx(async (c) => {
  const b = (await c.query('SELECT * FROM launcher_builds WHERE id=$1 FOR UPDATE', [bid])).rows[0]; if (!b) return { error: 'not_found' };
  const why = line(note, 500); if (['reject', 'block'].includes(decision) && why.length < 5) return { error: 'reason_required' };
  if ((await ownerOf(c, b.game_id)) === actor) return { error: 'self_review' };
  if (decision === 'approve') { if (b.status !== 'submitted') return { error: 'bad_status' }; if (b.scan_status === 'infected') return { error: 'build_infected' }; await c.query(`UPDATE launcher_builds SET status='approved', approved_at=now(), approved_by=$2, review_note='' WHERE id=$1`, [bid, actor]); }
  else if (decision === 'reject') { if (b.status !== 'submitted') return { error: 'bad_status' }; await c.query(`UPDATE launcher_builds SET status='rejected', review_note=$2 WHERE id=$1`, [bid, why]); }
  else if (decision === 'block') {
    await c.query(`UPDATE launcher_builds SET blocked=TRUE, review_note=$2 WHERE id=$1`, [bid, why]);
    const g = (await c.query('SELECT * FROM launcher_games WHERE id=$1 FOR UPDATE', [b.game_id])).rows[0];
    if (g.published_build_id === bid) {   // откат на предыдущую одобренную, если она есть, иначе игра снимается
      const prev = (await c.query(`SELECT id FROM launcher_builds WHERE game_id=$1 AND channel='release' AND approved_at IS NOT NULL AND NOT blocked AND id<>$2 ORDER BY published_at DESC NULLS LAST LIMIT 1`, [b.game_id, bid])).rows[0];
      if (prev) await liveSwitch(c, g, prev.id, actor); else await c.query(`UPDATE launcher_games SET status='unpublished', published_build_id=NULL, status_note=$2 WHERE id=$1`, [g.id, 'Сборка остановлена: ' + why]);
    }
  } else return { error: 'bad_decision' };
  await modLog(c, b.game_id, actor, `build_${decision}`, `${bid} ${why}`); return { ok: true };
});

/* ───────── каталог, библиотека, загрузка ───────── */
const card = (g, extra = {}) => ({ id: g.id, title: g.title, shortDescr: g.short_descr, genres: g.genres, developer: g.developer, os: g.os, cover: g.cover ?? null, featured: g.featured, publishedAt: g.published_at?.toISOString() ?? null, updatedAt: g.updated_at.toISOString(), ...extra });
export const listCatalog = async (me, { q, genre, sort = 'new', limit = 30, offset = 0 } = {}) => {
  const a = [me]; const w = [`g.status='published'`];
  if (q) { a.push(`%${line(q, 60).toLowerCase().replace(/[\\%_]/g, '\\$&')}%`); w.push(`(lower(g.title) LIKE $${a.length} ESCAPE '\\' OR lower(g.short_descr) LIKE $${a.length} ESCAPE '\\')`); }
  if (genre && GENRES.includes(genre)) { a.push(genre); w.push(`$${a.length} = ANY(g.genres)`); }
  a.push(Math.min(60, Math.max(1, Number(limit) || 30))); a.push(Math.max(0, Number(offset) || 0));
  const order = sort === 'title' ? 'lower(g.title)' : sort === 'updated' ? 'g.updated_at DESC' : 'g.published_at DESC NULLS LAST';
  const { rows } = await query(
    `SELECT g.*, (SELECT id FROM launcher_game_media m WHERE m.game_id=g.id AND m.kind='cover' LIMIT 1) AS cover, (l.profile_id IS NOT NULL) AS inlib, COALESCE(l.favorite, false) AS fav,
            b.version, b.total_bytes FROM launcher_games g LEFT JOIN launcher_library l ON l.game_id=g.id AND l.profile_id=$1 LEFT JOIN launcher_builds b ON b.id=g.published_build_id
      WHERE ${w.join(' AND ')} ORDER BY g.featured DESC, ${order} LIMIT $${a.length - 1} OFFSET $${a.length}`, a);
  return { games: rows.map((g) => card(g, { inLibrary: g.inlib, favorite: g.fav, version: g.version, sizeBytes: g.total_bytes ? Number(g.total_bytes) : null })), genres: GENRES };
};
export const gameDetail = async (me, gid, staff = false) => {
  const g = await gameRow(gid); if (!g) return { error: 'not_found' };
  const role = await roleOf(gid, me);
  if (g.status !== 'published' && !role && !staff) return { error: 'not_found' };
  const [media, news, hist, lib] = await Promise.all([
    mediaOf(gid), query('SELECT id, title, body, created_at FROM launcher_news WHERE game_id=$1 ORDER BY created_at DESC LIMIT 10', [gid]),
    query(`SELECT version, notes, published_at, total_bytes FROM launcher_builds WHERE game_id=$1 AND channel='release' AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 20`, [gid]),
    query('SELECT favorite, source FROM launcher_library WHERE profile_id=$1 AND game_id=$2', [me, gid]),
  ]);
  const live = g.published_build_id ? (await query('SELECT id, version, total_bytes, file_count, published_at FROM launcher_builds WHERE id=$1', [g.published_build_id])).rows[0] : null;
  return { game: gameView(g, { cover: media.find((m) => m.kind === 'cover')?.id ?? null, screenshots: media.filter((m) => m.kind === 'screenshot').map((m) => m.id),
    build: live ? { id: live.id, version: live.version, sizeBytes: Number(live.total_bytes), fileCount: live.file_count, updatedAt: live.published_at?.toISOString() ?? null } : null,
    history: hist.rows.map((h) => ({ version: h.version, notes: h.notes, at: h.published_at.toISOString(), sizeBytes: Number(h.total_bytes) })),
    news: news.rows.map((n) => ({ id: n.id, title: n.title, body: n.body, at: n.created_at.toISOString() })), inLibrary: Boolean(lib.rows[0]), favorite: lib.rows[0]?.favorite ?? false, myRole: role }) };
};
export const addToLibrary = async (me, gid) => {
  const g = await gameRow(gid); if (!g || g.status !== 'published' || !g.published_build_id) return { error: 'not_found' };
  await query(`INSERT INTO launcher_library (profile_id, game_id, source) VALUES ($1,$2,'free') ON CONFLICT DO NOTHING`, [me, gid]); return { ok: true };
};
export const removeFromLibrary = async (me, gid) => ({ ok: (await query('DELETE FROM launcher_library WHERE profile_id=$1 AND game_id=$2', [me, gid])).rowCount > 0 });
export const setFavorite = async (me, gid, on) => ({ ok: (await query('UPDATE launcher_library SET favorite=$3 WHERE profile_id=$1 AND game_id=$2', [me, gid, on])).rowCount > 0 });
export const listLibrary = async (me) => {
  const { rows } = await query(
    `SELECT g.*, l.favorite, l.added_at, l.last_played_at, l.play_count, l.source, (SELECT id FROM launcher_game_media m WHERE m.game_id=g.id AND m.kind='cover' LIMIT 1) AS cover, b.version, b.total_bytes, b.id AS build_id
       FROM launcher_library l JOIN launcher_games g ON g.id=l.game_id LEFT JOIN launcher_builds b ON b.id=g.published_build_id WHERE l.profile_id=$1 ORDER BY l.last_played_at DESC NULLS LAST, l.added_at DESC`, [me]);
  return { library: rows.map((g) => card(g, { favorite: g.favorite, addedAt: g.added_at.toISOString(), lastPlayedAt: g.last_played_at?.toISOString() ?? null, playCount: g.play_count, available: g.status === 'published', version: g.version, buildId: g.build_id, sizeBytes: g.total_bytes ? Number(g.total_bytes) : null })) };
};
/** Манифест для установки/обновления: только игроку, у которого игра в библиотеке (или участнику — для тестового канала). */
export const getManifest = async (me, gid, channel = 'release') => {
  const g = await gameRow(gid); if (!g) return { error: 'not_found' };
  if (channel === 'test') {
    if (!(await roleOf(gid, me))) return { error: 'not_found' };
    const b = (await query(`SELECT id FROM launcher_builds WHERE game_id=$1 AND channel='test' AND status IN ('uploaded','submitted','approved','published') AND NOT blocked ORDER BY created_at DESC LIMIT 1`, [gid])).rows[0];
    return b ? { manifest: await manifestOf(b.id) } : { error: 'no_build' };
  }
  if (g.status !== 'published' || !g.published_build_id) return { error: 'not_available' };
  const lib = (await query('SELECT 1 FROM launcher_library WHERE profile_id=$1 AND game_id=$2', [me, gid])).rows[0]; if (!lib) return { error: 'not_in_library' };
  const b = (await query('SELECT blocked FROM launcher_builds WHERE id=$1', [g.published_build_id])).rows[0]; if (b?.blocked) return { error: 'not_available' };
  return { manifest: await manifestOf(g.published_build_id) };
};
/** Доступ к файлу: игрок с игрой в библиотеке — к файлам опубликованной сборки; участник — к файлам своих сборок. Возвращает { path, size } или null. */
export const blobAccess = async (me, bid, sha) => {
  if (!SHA_RE.test(sha)) return null;
  const f = (await query(`SELECT f.size, b.game_id, b.status, b.blocked, b.channel, g.published_build_id FROM launcher_build_files f JOIN launcher_builds b ON b.id=f.build_id JOIN launcher_games g ON g.id=b.game_id WHERE f.build_id=$1 AND f.sha256=$2 LIMIT 1`, [bid, sha])).rows[0]; if (!f || f.blocked) return null;
  const role = await roleOf(f.game_id, me);
  if (!(role && CAN[role].has('view'))) { if (f.published_build_id !== bid) return null; if (!(await query('SELECT 1 FROM launcher_library WHERE profile_id=$1 AND game_id=$2', [me, f.game_id])).rows[0]) return null; }
  return { path: blobPath(sha), size: Number(f.size) };
};
export const openBlob = (path, range) => createReadStream(path, range);
const EVENT_KINDS = ['install_ok', 'install_fail', 'update_ok', 'update_fail', 'launch', 'launch_fail', 'verify_fail'];
export const recordEvent = async (me, gid, kind) => {
  if (!EVENT_KINDS.includes(kind)) return { error: 'bad_kind' };
  const lib = (await query('SELECT 1 FROM launcher_library WHERE profile_id=$1 AND game_id=$2', [me, gid])).rows[0]; if (!lib) return { error: 'not_found' };
  await query(`INSERT INTO launcher_events (day, game_id, kind, n) VALUES (current_date,$1,$2,1) ON CONFLICT (day, game_id, kind) DO UPDATE SET n = launcher_events.n + 1`, [gid, kind]);
  if (kind === 'launch') await query('UPDATE launcher_library SET last_played_at=now(), play_count=play_count+1 WHERE profile_id=$1 AND game_id=$2', [me, gid]);
  return { ok: true };
};

/* ───────── кабинет владельца ───────── */
export const myGames = async (me) => {
  const { rows } = await query(`SELECT g.*, m.role, (SELECT id FROM launcher_game_media x WHERE x.game_id=g.id AND x.kind='cover' LIMIT 1) AS cover FROM launcher_game_members m JOIN launcher_games g ON g.id=m.game_id WHERE m.profile_id=$1 ORDER BY g.updated_at DESC`, [me]);
  return { games: rows.map((g) => ({ ...card(g), status: g.status, statusNote: g.status_note, myRole: g.role })) };
};
export const myGame = async (me, gid) => {
  if (!(await need(gid, me, 'view'))) return { error: 'not_found' };
  const d = await gameDetail(me, gid, false); const members = (await query(`SELECT m.profile_id, m.role, p.username, p.name FROM launcher_game_members m JOIN profiles p ON p.id=m.profile_id WHERE m.game_id=$1 ORDER BY m.created_at`, [gid])).rows;
  const role = d.game.myRole;
  return { ...d, members: members.map((m) => ({ id: m.profile_id, role: m.role, username: m.username, name: m.name })), can: [...CAN[role]], builds: (await listBuilds(me, gid)).builds, modLog: (await query('SELECT action, note, at FROM launcher_mod_log WHERE game_id=$1 ORDER BY id DESC LIMIT 30', [gid])).rows.map((r) => ({ action: r.action, note: r.note, at: r.at.toISOString() })) };
};
export const addMember = async (me, gid, username, role) => {
  if (!(await need(gid, me, 'team'))) return { error: 'not_found' };
  if (!['developer', 'publisher', 'analyst'].includes(role)) return { error: 'bad_role' };
  const p = (await query('SELECT id FROM profiles WHERE lower(username)=lower($1)', [String(username ?? '').replace(/^@/, '')])).rows[0]; if (!p) return { error: 'user_not_found' };
  const n = (await query('SELECT count(*)::int AS n FROM launcher_game_members WHERE game_id=$1', [gid])).rows[0].n; if (n >= 10) return { error: 'too_many' };
  await query(`INSERT INTO launcher_game_members (game_id, profile_id, role) VALUES ($1,$2,$3) ON CONFLICT (game_id, profile_id) DO UPDATE SET role = CASE WHEN launcher_game_members.role='owner' THEN 'owner' ELSE $3 END`, [gid, p.id, role]);
  return { ok: true };
};
export const removeMember = async (me, gid, pid) => { if (!(await need(gid, me, 'team'))) return { error: 'not_found' }; return { ok: (await query(`DELETE FROM launcher_game_members WHERE game_id=$1 AND profile_id=$2 AND role<>'owner'`, [gid, pid])).rowCount > 0 }; };
export const proposeTransfer = async (me, gid, username, confirmTitle) => {
  if ((await roleOf(gid, me)) !== 'owner') return { error: 'not_found' };
  const g = await gameRow(gid); if (String(confirmTitle ?? '').trim() !== g.title) return { error: 'confirm_title' };
  const p = (await query('SELECT id FROM profiles WHERE lower(username)=lower($1)', [String(username ?? '').replace(/^@/, '')])).rows[0]; if (!p) return { error: 'user_not_found' }; if (p.id === me) return { error: 'self' };
  try { const t = id('ltr'); await query(`INSERT INTO launcher_game_transfers (id, game_id, from_id, to_id) VALUES ($1,$2,$3,$4)`, [t, gid, me, p.id]); void notifyGift(p.id, 'launcher', 'Sky Launcher', `Вам предлагают стать владельцем игры «${g.title}»`, t).catch(() => {}); return { ok: true, id: t }; }
  catch (e) { if (e.code === '23505') return { error: 'pending_exists' }; throw e; }
};
export const answerTransfer = async (me, tid, accept) => withTx(async (c) => {
  const t = (await c.query(`SELECT * FROM launcher_game_transfers WHERE id=$1 AND to_id=$2 AND status='pending' FOR UPDATE`, [tid, me])).rows[0]; if (!t) return { error: 'not_found' };
  if (!accept) { await c.query(`UPDATE launcher_game_transfers SET status='declined', decided_at=now() WHERE id=$1`, [tid]); return { ok: true }; }
  const n = (await c.query(`SELECT count(*)::int AS n FROM launcher_game_members WHERE profile_id=$1 AND role='owner'`, [me])).rows[0].n; if (n >= MAX_GAMES_PER_OWNER) return { error: 'too_many' };
  await c.query(`UPDATE launcher_game_members SET role='developer' WHERE game_id=$1 AND profile_id=$2 AND role='owner'`, [t.game_id, t.from_id]);
  await c.query(`INSERT INTO launcher_game_members (game_id, profile_id, role) VALUES ($1,$2,'owner') ON CONFLICT (game_id, profile_id) DO UPDATE SET role='owner'`, [t.game_id, me]);
  await c.query(`UPDATE launcher_game_transfers SET status='accepted', decided_at=now() WHERE id=$1`, [tid]); await modLog(c, t.game_id, me, 'transfer_accepted', t.from_id); return { ok: true };
});
export const incomingTransfers = async (me) => ({ transfers: (await query(`SELECT t.id, g.title, p.username FROM launcher_game_transfers t JOIN launcher_games g ON g.id=t.game_id JOIN profiles p ON p.id=t.from_id WHERE t.to_id=$1 AND t.status='pending'`, [me])).rows });
export const postNews = async (me, gid, title, body) => {
  if (!(await need(gid, me, 'news'))) return { error: 'not_found' }; const t = line(title, 100); if (t.length < 2) return { error: 'invalid' };
  await query('INSERT INTO launcher_news (id, game_id, title, body, created_by) VALUES ($1,$2,$3,$4,$5)', [id('lnw'), gid, t, txt(body, 3000), me]); return { ok: true };
};
export const gameStats = async (me, gid, days = 30) => {
  if (!(await need(gid, me, 'stats'))) return { error: 'not_found' }; const d = Math.min(365, Math.max(1, Number(days) || 30));
  const ev = (await query(`SELECT kind, sum(n)::int AS n FROM launcher_events WHERE game_id=$1 AND day > current_date - $2::int GROUP BY kind`, [gid, d])).rows;
  const lib = (await query('SELECT count(*)::int AS n FROM launcher_library WHERE game_id=$1', [gid])).rows[0].n;
  return { days: d, inLibrary: lib, events: Object.fromEntries(ev.map((e) => [e.kind, e.n])) };
};
/** Фоновая уборка: брошенные недозагруженные сборки старше 7 дней и неиспользуемые файлы старше суток. */
export const sweepLauncher = async () => {
  const gone = await query(`DELETE FROM launcher_builds WHERE status IN ('uploading','failed') AND updated_at < now() - interval '7 days' RETURNING id`);
  return gone.rowCount;
};

/* ───────── администрирование ───────── */
export const adminGames = async ({ status, q } = {}) => {
  const a = []; const w = ['TRUE'];
  if (status) { a.push(status); w.push(`g.status=$${a.length}`); }
  if (q) { a.push(`%${line(q, 60).toLowerCase().replace(/[\\%_]/g, '\\$&')}%`); w.push(`lower(g.title) LIKE $${a.length} ESCAPE '\\'`); }
  const { rows } = await query(`SELECT g.*, p.username AS owner_username, o.status AS order_status, o.amount_rub, (SELECT count(*)::int FROM launcher_library l WHERE l.game_id=g.id) AS libs FROM launcher_games g
      LEFT JOIN launcher_game_members m ON m.game_id=g.id AND m.role='owner' LEFT JOIN profiles p ON p.id=m.profile_id
      LEFT JOIN LATERAL (SELECT status, amount_rub FROM launcher_orders WHERE game_id=g.id ORDER BY created_at DESC LIMIT 1) o ON TRUE
     WHERE ${w.join(' AND ')} ORDER BY (g.status='pending_review') DESC, g.updated_at DESC LIMIT 200`, a);
  return { games: rows.map((g) => ({ id: g.id, title: g.title, status: g.status, statusNote: g.status_note, owner: g.owner_username, orderStatus: g.order_status, amountRub: g.amount_rub, library: g.libs, featured: g.featured, updatedAt: g.updated_at.toISOString() })) };
};
export const adminGame = async (gid) => {
  const g = await gameRow(gid); if (!g) return { error: 'not_found' };
  const d = await gameDetail('-', gid, true);
  const builds = (await query('SELECT * FROM launcher_builds WHERE game_id=$1 ORDER BY created_at DESC LIMIT 50', [gid])).rows.map(buildView);
  const orders = (await query('SELECT id, amount_rub, status, created_at, refunded_at FROM launcher_orders WHERE game_id=$1 ORDER BY created_at DESC', [gid])).rows;
  const log = (await query('SELECT actor_id, action, note, at FROM launcher_mod_log WHERE game_id=$1 ORDER BY id DESC LIMIT 100', [gid])).rows;
  return { ...d, builds, orders: orders.map((o) => ({ id: o.id, amountRub: o.amount_rub, status: o.status, createdAt: o.created_at.toISOString(), refundedAt: o.refunded_at?.toISOString() ?? null })), log: log.map((l) => ({ actorId: l.actor_id, action: l.action, note: l.note, at: l.at.toISOString() })) };
};
export const adminSetFeatured = async (gid, on) => ({ ok: (await query(`UPDATE launcher_games SET featured=$2 WHERE id=$1 AND status='published'`, [gid, Boolean(on)])).rowCount > 0 });
export const adminOwners = async () => {
  const { rows } = await query(`SELECT p.id, p.username, count(DISTINCT g.id)::int AS games, count(DISTINCT g.id) FILTER (WHERE g.status='published')::int AS published, COALESCE(sum(o.amount_rub) FILTER (WHERE o.status='paid'),0)::int AS paid, COALESCE(sum(o.amount_rub) FILTER (WHERE o.status='refunded'),0)::int AS refunded
      FROM launcher_game_members m JOIN profiles p ON p.id=m.profile_id JOIN launcher_games g ON g.id=m.game_id LEFT JOIN launcher_orders o ON o.game_id=g.id AND o.profile_id=p.id WHERE m.role='owner' GROUP BY p.id, p.username ORDER BY games DESC LIMIT 200`);
  return { owners: rows };
};
export const adminQueues = async () => {
  const pend = (await query(`SELECT b.id, b.version, b.status, b.scan_status, b.error, b.total_bytes, b.updated_at, g.title, g.id AS gid FROM launcher_builds b JOIN launcher_games g ON g.id=b.game_id WHERE b.status IN ('uploading','failed','submitted') ORDER BY b.updated_at DESC LIMIT 100`)).rows;
  const st = (await query(`SELECT count(DISTINCT sha256)::int AS blobs, COALESCE(sum(size) FILTER (WHERE true),0)::bigint AS total FROM (SELECT DISTINCT ON (sha256) sha256, size FROM launcher_build_files) x`)).rows[0];
  return { builds: pend.map((b) => ({ id: b.id, gameId: b.gid, game: b.title, version: b.version, status: b.status, scan: b.scan_status, error: b.error, bytes: Number(b.total_bytes), at: b.updated_at.toISOString() })), storage: { blobs: st.blobs, bytes: Number(st.total) } };
};
