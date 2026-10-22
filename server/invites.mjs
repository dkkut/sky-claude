/**
 * Приглашение новых людей в Sky. У каждого профиля одна постоянная ссылка `https://<DOMAIN>/?inv=<код>`.
 * Клиент при открытии ссылки запоминает код и шлёт его заголовком X-Sky-Invite только на /api/auth/*;
 * когда создаётся НОВЫЙ Sky ID, `recordInvite` один раз записывает «кто пригласил» (invite_uses, PRIMARY KEY по приглашённому).
 * Приглашённый с того же устройства, что и пригласивший, не считается (нельзя пригласить самого себя). Вознаграждений за приглашение нет —
 * считаем и показываем только настоящие регистрации; бонус можно добавить правилом кэшбэка.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { deviceRaw } from './globalblock.mjs';
import { notifyGift } from './giftnotify.mjs';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';        // без 0/O/1/I
export const CODE_RE = /^[A-Z2-9]{8}$/;
const newCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
const linkFor = (code) => `${config.publicOrigin || ''}/?inv=${code}`;

export const getMyInvite = async (profileId) => {
  let row = (await query('SELECT code FROM invite_links WHERE profile_id = $1', [profileId])).rows[0];
  for (let i = 0; !row && i < 5; i += 1) {
    const r = await query('INSERT INTO invite_links (profile_id, code) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING code', [profileId, newCode()]);
    row = r.rows[0] ?? (await query('SELECT code FROM invite_links WHERE profile_id = $1', [profileId])).rows[0];
  }
  if (!row) return { error: 'failed' };
  const { rows: [c] } = await query('SELECT COUNT(*)::int AS n FROM invite_uses WHERE inviter_profile_id = $1', [profileId]);
  const { rows } = await query(
    `SELECT u.created_at, (SELECT p.username FROM profiles p WHERE p.sky_id = u.invitee_sky_id AND p.deleted_at IS NULL ORDER BY p.created_at LIMIT 1) AS username
       FROM invite_uses u WHERE u.inviter_profile_id = $1 ORDER BY u.created_at DESC LIMIT 20`, [profileId]);
  return { code: row.code, link: linkFor(row.code), count: c.n, recent: rows.map((r) => ({ username: r.username ?? null, at: r.created_at.toISOString() })) };
};

/** Для регистрации: записать, кто пригласил нового Sky ID. Любой сбой не должен мешать входу. */
export const recordInvite = async (inviteeSkyId, req) => {
  const code = String(req?.headers?.['x-sky-invite'] ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return false;
  const { rows: [l] } = await query('SELECT l.profile_id, p.sky_id FROM invite_links l JOIN profiles p ON p.id = l.profile_id WHERE l.code = $1', [code]);
  if (!l || l.sky_id === inviteeSkyId) return false;                         // чужого кода нет / сам себя
  // тот же человек с того же устройства — не приглашение
  const dev = deviceRaw(req);
  if (dev) {
    const crypto2 = await import('node:crypto');
    const hash = crypto2.createHmac('sha256', `${config.jwtSecret}:global-block:v1:device`).update(dev).digest('hex');
    const same = await query(`SELECT 1 FROM sky_seen_ids WHERE sky_id = $1 AND kind = 'device' AND value_hash = $2`, [l.sky_id, hash]);
    if (same.rowCount) return false;
  }
  const ins = await query('INSERT INTO invite_uses (invitee_sky_id, inviter_profile_id, code) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [inviteeSkyId, l.profile_id, code]);
  if (!ins.rowCount) return false;
  notifyGift(l.profile_id, 'invite', 'Новый человек в Sky', 'По вашей ссылке зарегистрировался новый человек.', null).catch(() => {});
  return true;
};
