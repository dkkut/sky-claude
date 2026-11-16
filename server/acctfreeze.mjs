/**
 * Sky Account — заморозка аккаунтов и каналов.
 *  • Аккаунт (Sky ID): сервер закрывает всё, кроме открытого списка: свой экран заморозки, обращение в поддержку и апелляция, просмотр баланса (без движения денег), выгрузка своих данных,
 *    выход из аккаунта, разрешённые чаты (список задаёт сотрудник; остальные чаты человек не видит и в них не пишет). Данные не удаляются, деньги автоматически не возвращаются и не списываются.
 *  • Канал/группа: писать в него нельзя, читать можно; участники видят причину (если сотрудник разрешил показать), дату, статус и порядок обжалования (апелляцию подаёт владелец чата).
 *  • Заморозить и восстановить может сотрудник с правом `account_freeze` (владельца сервиса заморозить нельзя; другого администратора — только владелец сервиса). Все шаги — в журнал заморозок и в журнал администрации.
 *  • Апелляцию решает НЕ тот, кто замораживал (владелец сервиса — может); принятая апелляция снимает заморозку. Срок (`expires_at`) гасит заморозку сам.
 * Возврат средств — отдельная проверенная процедура через поддержку и финансы; заморозка его не запускает.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { isOwnerRaw } from './admin.mjs';

const err = (code, extra = {}) => ({ error: code, ...extra });
const clean = (v, n) => Array.from(String(v ?? '')).filter((c) => c.charCodeAt(0) > 31 || c === '\n').join('').trim().slice(0, n);
const dec = (b) => { try { return b ? decryptSecret(b) : ''; } catch { return ''; } };
const log = (actor, fid, action, detail = '') => query('INSERT INTO acct_freeze_log (actor_id, freeze_id, action, detail) VALUES ($1,$2,$3,$4)', [actor, fid, action, String(detail).slice(0, 300)]).catch(() => {});
const MAX_APPEALS = 3, APPEAL_MIN = 20;

export { frozenSky, frozenChat, frozenProfile, chatAllowedFor, frozenMay, forgetFreezes } from './freezecheck.mjs';
import { forgetFreezes, frozenSky, frozenChat } from './freezecheck.mjs';

/* ─── Создание ─── */
const publicShape = (f, viewer) => ({
  id: f.id, type: f.target_type, since: f.started_at, until: f.expires_at, status: f.status, reason: f.show_reason ? (f.public_reason || null) : null, reasonHidden: !f.show_reason,
  ...(viewer === 'account' ? { allowedChatIds: f.allowed_chat_ids } : {}),
});
export const freezeAccount = async (actor, { username = '', profileId = '', reason, publicReason = '', showReason = false, expiresAt = null, allowedChatIds = [] } = {}) => {
  const why = clean(reason, 500); if (why.length < 10) return err('reason_required');
  const { rows } = profileId ? await query('SELECT id, sky_id, username FROM profiles WHERE id = $1', [profileId]) : await query('SELECT id, sky_id, username FROM profiles WHERE lower(username) = lower($1)', [String(username).replace(/^@/, '')]);
  const p = rows[0]; if (!p) return err('person_not_found');
  const { rows: mine } = await query('SELECT sky_id FROM profiles WHERE id = $1', [actor]); if (mine[0]?.sky_id === p.sky_id) return err('cannot_freeze_self');
  const { rows: all } = await query('SELECT id FROM profiles WHERE sky_id = $1', [p.sky_id]);
  for (const x of all) { if (await isOwnerRaw(x.id)) return err('owner_protected'); }
  const { rows: adm } = await query('SELECT 1 FROM profiles WHERE sky_id = $1 AND is_admin LIMIT 1', [p.sky_id]);
  if (adm[0] && !(await isOwnerRaw(actor))) return err('admin_target_owner_only');
  const exp = expiresAt ? new Date(expiresAt) : null; if (exp && (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now() + 60_000)) return err('bad_field', { field: 'expiresAt' });
  const chats = [...new Set((Array.isArray(allowedChatIds) ? allowedChatIds : []).map((x) => String(x)).filter((x) => /^[A-Za-z0-9~_-]{1,200}$/.test(x)))].slice(0, 50);
  if (chats.length) { const { rows: ok } = await query('SELECT chat_id FROM chat_members WHERE chat_id = ANY($1) AND user_id = ANY($2)', [chats, all.map((x) => x.id)]); const okSet = new Set(ok.map((x) => x.chat_id)); if (chats.some((c) => !okSet.has(c))) return err('bad_field', { field: 'allowedChatIds' }); }
  const fid = `afz-${crypto.randomUUID()}`;
  try { await query('INSERT INTO acct_freezes (id, target_type, target_id, reason, public_reason, show_reason, expires_at, allowed_chat_ids, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [fid, 'account', p.sky_id, why, clean(publicReason, 300), showReason === true && clean(publicReason, 300).length > 0, exp, chats, actor]); }
  catch (e) { if (e.code === '23505') return err('already_frozen'); throw e; }
  forgetFreezes(); await log(actor, fid, 'frozen', `account @${p.username}`); await logAdmin({ actorId: actor, targetType: 'account_freeze', targetId: fid, type: 'account_freeze', detail: `@${p.username}: ${why}`.slice(0, 220) });
  for (const x of all) void notifyGift(x.id, 'account_freeze', 'Аккаунт заморожен', 'Откройте Sky — там причина (если её можно показать), порядок обжалования и обращение в поддержку.', fid).catch(() => {});
  return { ok: true, id: fid };
};
export const freezeChannel = async (actor, { chatId, reason, publicReason = '', showReason = false, expiresAt = null } = {}) => {
  const why = clean(reason, 500); if (why.length < 10) return err('reason_required');
  const { rows } = await query("SELECT id, type, name AS title FROM chats WHERE id = $1 AND type IN ('channel','group')", [String(chatId ?? '')]); const c = rows[0]; if (!c) return err('chat_not_found');
  const exp = expiresAt ? new Date(expiresAt) : null; if (exp && (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now() + 60_000)) return err('bad_field', { field: 'expiresAt' });
  const fid = `afz-${crypto.randomUUID()}`;
  try { await query('INSERT INTO acct_freezes (id, target_type, target_id, reason, public_reason, show_reason, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [fid, 'channel', c.id, why, clean(publicReason, 300), showReason === true && clean(publicReason, 300).length > 0, exp, actor]); }
  catch (e) { if (e.code === '23505') return err('already_frozen'); throw e; }
  forgetFreezes(); await log(actor, fid, 'frozen', `channel ${c.id}`); await logAdmin({ actorId: actor, targetType: 'account_freeze', targetId: fid, type: 'channel_freeze', detail: `${c.id}: ${why}`.slice(0, 220) });
  const { rows: owners } = await query("SELECT owner_id AS user_id FROM chats WHERE id = $1 AND owner_id IS NOT NULL", [c.id]);
  for (const o of owners) void notifyGift(o.user_id, 'account_freeze', 'Канал заморожен', `«${c.title ?? 'Канал'}»: откройте его, чтобы увидеть статус и порядок обжалования.`, fid).catch(() => {});
  return { ok: true, id: fid };
};

/* ─── Восстановление и апелляции ─── */
const lift = async (actor, fid, note, action) => {
  const r = await query("UPDATE acct_freezes SET status='lifted', lifted_by=$2, lifted_at=now(), lift_note=$3 WHERE id=$1 AND status='active' RETURNING target_type, target_id", [fid, actor, note]);
  if (!r.rowCount) return false; forgetFreezes(); await log(actor, fid, action, note); await logAdmin({ actorId: actor, targetType: 'account_freeze', targetId: fid, type: action === 'lifted' ? 'account_unfreeze' : 'account_unfreeze_appeal', detail: note.slice(0, 200) });
  const t = r.rows[0];
  const users = t.target_type === 'account' ? (await query('SELECT id FROM profiles WHERE sky_id = $1', [t.target_id])).rows.map((x) => x.id) : (await query('SELECT owner_id AS id FROM chats WHERE id = $1 AND owner_id IS NOT NULL', [t.target_id])).rows.map((x) => x.id);
  for (const u of users) void notifyGift(u, 'account_freeze', t.target_type === 'account' ? 'Заморозка снята' : 'Канал снова доступен', 'Доступ восстановлен.', fid).catch(() => {});
  return true;
};
export const liftFreeze = async (actor, fid, note) => { const n = clean(note, 300); if (n.length < 5) return err('reason_required'); return (await lift(actor, fid, n, 'lifted')) ? { ok: true } : err('not_found'); };
export const appeal = async (me, { freezeId, text }) => {
  const t = clean(text, 2000); if (t.length < APPEAL_MIN) return err('appeal_too_short');
  const { rows } = await query("SELECT * FROM acct_freezes WHERE id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > now())", [String(freezeId ?? '')]); const f = rows[0]; if (!f) return err('not_found');
  if (f.target_type === 'account') { const { rows: p } = await query('SELECT 1 FROM profiles WHERE id = $1 AND sky_id = $2', [me, f.target_id]); if (!p[0]) return err('not_found'); }
  else { const { rows: o } = await query('SELECT 1 FROM chats WHERE id = $1 AND owner_id = $2', [f.target_id, me]); if (!o[0]) return err('only_owner_can_appeal'); }
  const { rows: n } = await query('SELECT count(*)::int AS n FROM acct_freeze_appeals WHERE freeze_id = $1', [f.id]); if (n[0].n >= MAX_APPEALS) return err('too_many_appeals');
  const aid = `afa-${crypto.randomUUID()}`;
  try { await query('INSERT INTO acct_freeze_appeals (id, freeze_id, author_id, text_enc) VALUES ($1,$2,$3,$4)', [aid, f.id, me, encryptSecret(t)]); } catch (e) { if (e.code === '23505') return err('appeal_open'); throw e; }
  await log(me, f.id, 'appeal', ''); void notifyStaff('freeze_appeal', { title: 'Апелляция на заморозку', body: 'Нужно решение сотрудника.', dedupe: `afa:${aid}`, except: me });
  return { ok: true, id: aid };
};
export const decideAppeal = async (actor, aid, outcome, note, { owner = false } = {}) => {
  const n = clean(note, 300); if (n.length < 5) return err('reason_required'); if (!['accepted', 'rejected'].includes(outcome)) return err('bad_action');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query('SELECT a.*, f.created_by, f.status AS fstatus FROM acct_freeze_appeals a JOIN acct_freezes f ON f.id = a.freeze_id WHERE a.id = $1 FOR UPDATE OF a', [aid]); const a = rows[0];
    if (!a) { await c.query('ROLLBACK'); return err('not_found'); } if (a.status !== 'open') { await c.query('ROLLBACK'); return err('bad_state'); }
    if (a.created_by === actor && !owner) { await c.query('ROLLBACK'); return err('self_review'); }
    await c.query('UPDATE acct_freeze_appeals SET status=$2, decided_by=$3, decision=$4, decided_at=now() WHERE id=$1', [aid, outcome, actor, n]);
    await c.query('COMMIT');
    await log(actor, a.freeze_id, `appeal_${outcome}`, n);
    if (outcome === 'accepted') await lift(actor, a.freeze_id, `Апелляция принята: ${n}`, 'lifted_by_appeal');
    else { await logAdmin({ actorId: actor, targetType: 'account_freeze', targetId: a.freeze_id, type: 'freeze_appeal_reject', detail: n.slice(0, 200) }); void notifyGift(a.author_id, 'account_freeze', 'Апелляция отклонена', n, a.freeze_id).catch(() => {}); }
    return { ok: true, status: outcome };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};
export const sweepFreezes = async () => { const r = await query("UPDATE acct_freezes SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at <= now() RETURNING id"); if (r.rowCount) forgetFreezes(); return r.rowCount; };

/* ─── Чтение ─── */
/** Экран замороженного аккаунта: что видит человек. Причина — только если сотрудник разрешил её показывать. */
export const myStatus = async (me) => {
  const { rows } = await query('SELECT sky_id FROM profiles WHERE id = $1', [me]); const sky = rows[0]?.sky_id; const f = sky ? await frozenSky(sky) : null;
  if (!f) return { frozen: false };
  const { rows: ap } = await query('SELECT id, status, decision, created_at, decided_at FROM acct_freeze_appeals WHERE freeze_id = $1 ORDER BY created_at DESC', [f.id]);
  let chats = [];
  if ((f.allowed_chat_ids ?? []).length) chats = (await query("SELECT id, type, name FROM chats WHERE id = ANY($1) AND trashed_at IS NULL", [f.allowed_chat_ids])).rows.map((c) => ({ id: c.id, type: c.type, title: c.name }));
  return { frozen: true, freeze: publicShape(f, 'account'), allowedChats: chats, appeals: ap.map((a) => ({ id: a.id, status: a.status, decision: a.status === 'open' ? '' : a.decision, at: a.created_at, decidedAt: a.decided_at })), canAppeal: !ap.some((a) => a.status === 'open') && ap.length < MAX_APPEALS,
    refundInfo: 'Заморозка не списывает деньги и не возвращает их автоматически. Если вам нужен возврат, напишите в поддержку: он оформляется по проверенной финансовой процедуре после рассмотрения. Баланс и история доступны только для просмотра.' };
};
/** Статус канала для его участников. */
export const channelStatus = async (me, chatId) => {
  const { rows: m } = await query('SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, me]); if (!m[0]) return err('not_found');
  const f = await frozenChat(chatId); if (!f) return { frozen: false };
  const { rows: ap } = await query('SELECT id, status, decision FROM acct_freeze_appeals WHERE freeze_id = $1 ORDER BY created_at DESC', [f.id]);
  const { rows: ow } = await query('SELECT 1 FROM chats WHERE id = $1 AND owner_id = $2', [chatId, me]); const isOwner = ow.length > 0;
  return { frozen: true, freeze: publicShape(f, 'channel'), isOwner, appeals: isOwner ? ap.map((a) => ({ id: a.id, status: a.status, decision: a.status === 'open' ? '' : a.decision })) : [], canAppeal: isOwner && !ap.some((a) => a.status === 'open') && ap.length < MAX_APPEALS,
    howToAppeal: 'Владелец канала может подать апелляцию на этом экране или написать в поддержку Sky (Профиль → Тех. поддержка).' };
};
export const adminList = async ({ status = 'active' } = {}) => {
  const st = ['active', 'lifted', 'expired'].includes(status) ? status : 'active';
  const { rows } = await query(`SELECT f.*, CASE WHEN f.target_type = 'account' THEN (SELECT string_agg(p.username, ', ') FROM profiles p WHERE p.sky_id = f.target_id) ELSE (SELECT c.name FROM chats c WHERE c.id = f.target_id) END AS label FROM acct_freezes f WHERE f.status = $1 ORDER BY f.started_at DESC LIMIT 200`, [st]);
  const { rows: ap } = await query("SELECT a.id, a.freeze_id, a.text_enc, a.created_at, f.target_type, f.created_by FROM acct_freeze_appeals a JOIN acct_freezes f ON f.id = a.freeze_id WHERE a.status = 'open' ORDER BY a.created_at LIMIT 100");
  return { freezes: rows.map((f) => ({ id: f.id, type: f.target_type, targetId: f.target_id, label: f.label, reason: f.reason, publicReason: f.public_reason, showReason: f.show_reason, status: f.status, startedAt: f.started_at, expiresAt: f.expires_at, createdBy: f.created_by, liftedBy: f.lifted_by, liftNote: f.lift_note, allowedChatIds: f.allowed_chat_ids })), appeals: ap.map((a) => ({ id: a.id, freezeId: a.freeze_id, type: a.target_type, text: dec(a.text_enc), at: a.created_at, frozenBy: a.created_by })) };
};
export const adminLog = async (fid) => (await query('SELECT at, actor_id, action, detail FROM acct_freeze_log WHERE freeze_id = $1 ORDER BY id', [fid])).rows;
