/**
 * Пользовательские подарки Sky Gifts. Человек создаёт подарок (фото/анимация/видео + название, описание, оформление), смотрит предпросмотр и отправляет на проверку;
 * модератор (право `gifts`) одобряет, отклоняет с причиной или передаёт на дополнительную проверку; одобренный подарок попадает в каталог разрешённых и его можно дарить.
 *  • Файл проверяется по СОДЕРЖИМОМУ (png/jpeg/webp/gif, mp4/webm; SVG и всё остальное — нет), по размеру и защитой от вредоносных файлов (server/malware.mjs, ClamAV — если подключён);
 *    «исполняемый файл под видом фото» отклоняется независимо от имени и заявленного типа. Файл лежит зашифрованным, наружу отдаётся только через API.
 *  • Одобренный подарок не правится (чтобы после проверки нельзя было подменить содержимое): для изменений создаётся новый. Автор может снять свой подарок (`withdrawn`); модерация — убрать (`removed`, с причиной).
 *  • Дарение бесплатное для дарителя (денег и баллов не списывает), поэтому ограничено пределами по человеку и по получателю и уважает «кто может мне писать».
 */
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { query, pool } from './db.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { mayWriteTo } from './privacy.mjs';
import { scanBytes, humanReason } from './malware.mjs';
import { saveMedia, openMedia, mediaSize, removeMediaFile } from './customgiftstore.mjs';

export const STYLES = ['classic', 'aurora', 'sunset', 'mint', 'gold', 'night'];
export const MAX_IMAGE = 3 * 1024 * 1024, MAX_VIDEO = 12 * 1024 * 1024;
const MAX_PER_AUTHOR = 30, SEND_PER_DAY = 20, SEND_PER_PAIR_DAY = 3, SUBMIT_PER_DAY = 10;
const err = (code, extra = {}) => ({ error: code, ...extra });
const clean = (v, n) => Array.from(String(v ?? '')).filter((c) => c.charCodeAt(0) > 31 || c === '\n').join('').trim().slice(0, n);
const gid = () => `cgf-${crypto.randomUUID()}`;
const log = (actor, gift, action, detail = '') => query('INSERT INTO custom_gift_log (actor_id, gift_id, action, detail) VALUES ($1,$2,$3,$4)', [actor, gift, action, String(detail).slice(0, 300)]).catch(() => {});

/** Тип файла по первым байтам. SVG, HTML, архивы и прочее — не принимаются. */
export const sniffGiftMedia = (b) => {
  if (!b || b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', kind: 'image' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', kind: 'image' };
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', kind: 'image' };
  if (['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1'))) return { mime: 'image/gif', kind: 'animation' };
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') return { mime: 'video/mp4', kind: 'video' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'video/webm', kind: 'video' };
  return null;
};

const shape = (g, { staff = false } = {}) => ({
  id: g.id, authorId: g.author_id, authorName: g.author_name, name: g.name, description: g.description, style: g.style, hasMedia: Boolean(g.media_id), mediaKind: g.media_kind, mediaBytes: g.media_bytes,
  status: g.status, reason: g.reason, submittedAt: g.submitted_at, createdAt: g.created_at, ...(staff ? { escalatedBy: g.escalated_by, escalationNote: g.escalation_note, reviewedBy: g.reviewed_by } : {}),
});
const SEL = 'SELECT g.*, p.name AS author_name FROM custom_gifts g JOIN profiles p ON p.id = g.author_id';

/* ─── Создание ─── */
export const createGift = async (me, body = {}) => {
  const name = clean(body.name, 60); if (name.length < 2) return err('bad_field', { field: 'name' });
  const style = STYLES.includes(body.style) ? body.style : 'classic';
  const { rows: n } = await query("SELECT count(*)::int AS n FROM custom_gifts WHERE author_id = $1 AND status NOT IN ('withdrawn','removed')", [me]); if (n[0].n >= MAX_PER_AUTHOR) return err('too_many_gifts');
  const id = gid();
  await query('INSERT INTO custom_gifts (id, author_id, name, description, style) VALUES ($1,$2,$3,$4,$5)', [id, me, name, clean(body.description, 400), style]);
  await log(me, id, 'created'); return { ok: true, id };
};
export const updateGift = async (me, id, body = {}) => {
  const { rows } = await query('SELECT * FROM custom_gifts WHERE id = $1', [id]); const g = rows[0]; if (!g || g.author_id !== me) return err('not_found');
  if (!['draft', 'rejected'].includes(g.status)) return err('not_editable');
  const patch = { name: g.name, description: g.description, style: g.style };
  if (body.name !== undefined) { patch.name = clean(body.name, 60); if (patch.name.length < 2) return err('bad_field', { field: 'name' }); }
  if (body.description !== undefined) patch.description = clean(body.description, 400);
  if (body.style !== undefined) { if (!STYLES.includes(body.style)) return err('bad_field', { field: 'style' }); patch.style = body.style; }
  await query("UPDATE custom_gifts SET name=$2, description=$3, style=$4, status = CASE WHEN status='rejected' THEN 'draft' ELSE status END, updated_at=now() WHERE id=$1", [id, patch.name, patch.description, patch.style]);
  return { ok: true };
};
/** Загрузка файла: тип по содержимому, размер, защита от вредоносных файлов; старый файл удаляется после успеха. */
export const putMedia = async (me, id, buf, { fileName = '' } = {}) => {
  const { rows } = await query('SELECT * FROM custom_gifts WHERE id = $1', [id]); const g = rows[0]; if (!g || g.author_id !== me) return err('not_found');
  if (!['draft', 'rejected'].includes(g.status)) return err('not_editable');
  const sn = sniffGiftMedia(buf); if (!sn) return err('unsupported_media');
  if (buf.length > (sn.kind === 'video' ? MAX_VIDEO : MAX_IMAGE)) return err('too_large', { maxBytes: sn.kind === 'video' ? MAX_VIDEO : MAX_IMAGE });
  const scan = await scanBytes(buf, { name: fileName, service: 'custom_gift' });                                    // исполняемые файлы, макросы, скрипты и т. п. — независимо от имени и заявленного типа
  if (scan.verdict !== 'clean') return err(scan.unavailable ? 'scan_unavailable' : 'file_blocked', { message: humanReason(scan) });
  const mediaId = `cgm-${crypto.randomUUID()}`;
  const saved = await saveMedia(mediaId, Readable.from([buf]), buf.length + 1); if (saved.error) return err('storage_failed');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  await query("UPDATE custom_gifts SET media_id=$2, media_kind=$3, media_mime=$4, media_bytes=$5, media_sha=$6, status = CASE WHEN status='rejected' THEN 'draft' ELSE status END, updated_at=now() WHERE id=$1", [id, mediaId, sn.kind, sn.mime, buf.length, sha]);
  if (g.media_id) await removeMediaFile(g.media_id);
  await log(me, id, 'media', `${sn.mime} ${buf.length}`); return { ok: true, kind: sn.kind, bytes: buf.length };
};
export const submitGift = async (me, id) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query('SELECT * FROM custom_gifts WHERE id = $1 FOR UPDATE', [id]); const g = rows[0]; if (!g || g.author_id !== me) { await c.query('ROLLBACK'); return err('not_found'); }
    if (!['draft', 'rejected'].includes(g.status)) { await c.query('ROLLBACK'); return err('bad_state', { status: g.status }); }
    if (!g.media_id) { await c.query('ROLLBACK'); return err('media_required'); }
    const { rows: d } = await c.query("SELECT count(*)::int AS n FROM custom_gift_log WHERE actor_id = $1 AND action = 'submitted' AND at > now() - interval '1 day'", [me]); if (d[0].n >= SUBMIT_PER_DAY) { await c.query('ROLLBACK'); return err('too_many_submissions'); }
    await c.query("UPDATE custom_gifts SET status='pending', reason='', submitted_at=now(), updated_at=now() WHERE id=$1", [id]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await log(me, id, 'submitted'); void notifyStaff('custom_gift_review', { title: 'Подарок на проверке', body: 'Пользовательский подарок ждёт решения модератора.', dedupe: `cgf:${id}:${Date.now() >> 15}`, except: me });
  return { ok: true, status: 'pending' };
};
export const withdrawGift = async (me, id) => {
  const r = await query("UPDATE custom_gifts SET status='withdrawn', updated_at=now() WHERE id=$1 AND author_id=$2 AND status IN ('draft','pending','extra_review','approved','rejected') RETURNING id", [id, me]);
  if (!r.rowCount) return err('not_found'); await log(me, id, 'withdrawn'); return { ok: true };       // уже отправленные экземпляры остаются у получателей
};

/* ─── Каталог и мои ─── */
export const catalog = async ({ q = '', limit = 30, offset = 0 } = {}) => {
  const a = []; let w = "g.status = 'approved'";
  if (q) { a.push(`%${String(q).replace(/[%_\\]/g, '\\$&').toLowerCase().slice(0, 40)}%`); w += ` AND lower(g.name) LIKE $${a.length}`; }
  a.push(Math.max(1, Math.min(60, Number(limit) || 30)), Math.max(0, Number(offset) || 0));
  const { rows } = await query(`${SEL} WHERE ${w} ORDER BY g.reviewed_at DESC NULLS LAST LIMIT $${a.length - 1} OFFSET $${a.length}`, a);
  return { gifts: rows.map((g) => shape(g)), styles: STYLES };
};
export const mine = async (me) => ({ gifts: (await query(`${SEL} WHERE g.author_id = $1 AND g.status <> 'withdrawn' ORDER BY g.created_at DESC LIMIT 100`, [me])).rows.map((g) => shape(g)), styles: STYLES });
/** Файл подарка может открыть: любой — одобренный; автор — свой в любом статусе; получатель/даритель — уже отправленный, пока подарок не убран модерацией. */
export const mediaAccess = async (me, id, { staff = false } = {}) => {
  const { rows } = await query('SELECT * FROM custom_gifts WHERE id = $1', [id]); const g = rows[0]; if (!g?.media_id) return null;
  let allowed = staff || g.author_id === me || g.status === 'approved';
  if (!allowed && g.status !== 'removed') { const { rows: s } = await query('SELECT 1 FROM custom_gift_sends WHERE gift_id = $1 AND (recipient_id = $2 OR sender_id = $2) LIMIT 1', [id, me]); allowed = s.length > 0; }
  if (!allowed) return null;
  return { mediaId: g.media_id, mime: g.media_mime, size: await mediaSize(g.media_id), open: (range) => openMedia(g.media_id, range) };
};

/* ─── Отправка ─── */
export const sendGift = async (me, id, { recipientId, message = '' } = {}) => {
  const { rows } = await query("SELECT * FROM custom_gifts WHERE id = $1 AND status = 'approved'", [id]); const g = rows[0]; if (!g) return err('not_found');
  const rid = String(recipientId ?? ''); if (!rid || rid === me) return err('invalid_recipient');
  const { rows: rp } = await query('SELECT id, name FROM profiles WHERE id = $1', [rid]); if (!rp[0]) return err('recipient_not_found');
  if (!(await mayWriteTo(rid, me))) return err('recipient_not_accepting');
  const { rows: day } = await query("SELECT count(*)::int AS n, count(*) FILTER (WHERE recipient_id = $2)::int AS pair FROM custom_gift_sends WHERE sender_id = $1 AND created_at > now() - interval '1 day'", [me, rid]);
  if (day[0].n >= SEND_PER_DAY) return err('daily_limit'); if (day[0].pair >= SEND_PER_PAIR_DAY) return err('pair_limit');
  const sid = `cgs-${crypto.randomUUID()}`;
  await query('INSERT INTO custom_gift_sends (id, gift_id, sender_id, recipient_id, message) VALUES ($1,$2,$3,$4,$5)', [sid, id, me, rid, clean(message, 300)]);
  void notifyGift(rid, 'custom_gift', '🎁 Вам подарок!', `Вам подарили «${g.name}»`, sid).catch(() => {});
  return { ok: true, id: sid };
};
const sendShape = (r) => ({ id: r.id, giftId: r.gift_id, giftName: r.name, style: r.style, mediaKind: r.media_kind, removed: r.status === 'removed', fromId: r.sender_id, fromName: r.sender_name, toId: r.recipient_id, toName: r.recipient_name, message: r.message, at: r.created_at });
const SENDSEL = 'SELECT s.*, g.name, g.style, g.media_kind, g.status, ps.name AS sender_name, pr.name AS recipient_name FROM custom_gift_sends s JOIN custom_gifts g ON g.id = s.gift_id JOIN profiles ps ON ps.id = s.sender_id JOIN profiles pr ON pr.id = s.recipient_id';
export const received = async (me) => ({ sends: (await query(`${SENDSEL} WHERE s.recipient_id = $1 ORDER BY s.created_at DESC LIMIT 100`, [me])).rows.map(sendShape) });
export const sent = async (me) => ({ sends: (await query(`${SENDSEL} WHERE s.sender_id = $1 ORDER BY s.created_at DESC LIMIT 100`, [me])).rows.map(sendShape) });

/* ─── Модерация ─── */
export const queue = async ({ status = '' } = {}) => {
  const st = ['pending', 'extra_review', 'approved', 'rejected', 'removed'].includes(status) ? status : null;
  const { rows } = st ? await query(`${SEL} WHERE g.status = $1 ORDER BY g.submitted_at LIMIT 200`, [st]) : await query(`${SEL} WHERE g.status IN ('pending','extra_review') ORDER BY (g.status = 'extra_review') DESC, g.submitted_at LIMIT 200`);
  return { gifts: rows.map((g) => shape(g, { staff: true })) };
};
export const adminLog = async (gift) => (await query('SELECT at, actor_id, action, detail FROM custom_gift_log WHERE gift_id = $1 ORDER BY id DESC LIMIT 50', [gift])).rows;
/**
 * Решение модератора. approve | reject (причина) | escalate (заметка) | remove (причина, для одобренного).
 * Своё не решают (`self_review`); решение по подарку, переданному на дополнительную проверку, принимает ДРУГОЙ модератор, не тот, кто передал (владелец сервиса — любой).
 */
export const decide = async (actor, id, action, note = '', { owner = false } = {}) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query('SELECT * FROM custom_gifts WHERE id = $1 FOR UPDATE', [id]); const g = rows[0]; if (!g) { await c.query('ROLLBACK'); return err('not_found'); }
    if (g.author_id === actor && !owner) { await c.query('ROLLBACK'); return err('self_review'); }
    const why = clean(note, 300);
    const rules = { approve: [['pending', 'extra_review'], 'approved'], reject: [['pending', 'extra_review'], 'rejected'], escalate: [['pending'], 'extra_review'], remove: [['approved'], 'removed'] };
    const rule = rules[action]; if (!rule) { await c.query('ROLLBACK'); return err('bad_action'); }
    if (!rule[0].includes(g.status)) { await c.query('ROLLBACK'); return err('bad_state', { status: g.status }); }
    if (['reject', 'remove', 'escalate'].includes(action) && why.length < 5) { await c.query('ROLLBACK'); return err('reason_required'); }
    if (g.status === 'extra_review' && g.escalated_by === actor && !owner) { await c.query('ROLLBACK'); return err('second_reviewer_required'); }
    if (action === 'approve' && !g.media_id) { await c.query('ROLLBACK'); return err('media_required'); }
    if (action === 'escalate') await c.query("UPDATE custom_gifts SET status='extra_review', escalated_by=$2, escalation_note=$3, updated_at=now() WHERE id=$1", [id, actor, why]);
    else await c.query('UPDATE custom_gifts SET status=$2, reason=$3, reviewed_by=$4, reviewed_at=now(), updated_at=now() WHERE id=$1', [id, rule[1], action === 'approve' ? '' : why, actor]);
    await c.query('COMMIT');
    await log(actor, id, action, why); await logAdmin({ actorId: actor, targetType: 'custom_gift', targetId: id, type: `custom_gift_${action}`, detail: why.slice(0, 200) });
    if (action !== 'escalate') void notifyGift(g.author_id, 'custom_gift', { approve: 'Подарок одобрен', reject: 'Подарок отклонён', remove: 'Подарок убран из каталога' }[action], action === 'approve' ? `«${g.name}» теперь в каталоге.` : `«${g.name}»: ${why}`, id).catch(() => {});
    else void notifyStaff('custom_gift_review', { title: 'Подарок передан на дополнительную проверку', body: 'Нужен второй модератор.', dedupe: `cgfx:${id}`, except: actor });
    return { ok: true, status: action === 'escalate' ? 'extra_review' : rule[1] };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};
