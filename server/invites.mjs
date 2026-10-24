/**
 * Приглашение новых людей в Sky. У каждого профиля одна постоянная ссылка `https://<DOMAIN>/?inv=<код>`.
 * Клиент при открытии ссылки запоминает код и шлёт его заголовком X-Sky-Invite только на /api/auth/*;
 * когда создаётся НОВЫЙ Sky ID, `recordInvite` один раз записывает «кто пригласил» (invite_uses, PRIMARY KEY по приглашённому).
 * Награды: Prime-дни и Prime Points по порогам MILESTONES (забирает сам человек, один порог — один раз, одной транзакцией). Бизнес-тарифа среди наград нет.
 * Приглашённый с того же устройства, что и пригласивший, не считается (нельзя пригласить самого себя). Вознаграждений за приглашение нет —
 * считаем и показываем только настоящие регистрации; бонус можно добавить правилом кэшбэка.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { deviceRaw } from './globalblock.mjs';
import { notifyGift } from './giftnotify.mjs';
import { pool } from './db.mjs';
import { wallet } from './wallet.mjs';
import { grantPrimeIn } from './skyid.mjs';

export const MILESTONES = [
  { count: 5,   primeDays: 3,   points: 200 },
  { count: 10,  primeDays: 5,   points: 500 },
  { count: 25,  primeDays: 14,  points: 1200 },
  { count: 50,  primeDays: 30,  points: 3000 },
  { count: 100, primeDays: 90,  points: 7500 },
  { count: 250, primeDays: 180, points: 20000 },
];

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
  const claimed = new Set((await query('SELECT milestone FROM invite_rewards WHERE profile_id = $1', [profileId])).rows.map((r) => r.milestone));
  const milestones = MILESTONES.map((m) => ({ ...m, reached: c.n >= m.count, claimed: claimed.has(m.count) }));
  return { code: row.code, link: linkFor(row.code), count: c.n, milestones, recent: rows.map((r) => ({ username: r.username ?? null, at: r.created_at.toISOString() })) };
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

/** Забрать награду за порог: Prime-дни и баллы выдаются в одной транзакции с отметкой «получено». */
export const claimInviteReward = async (profileId, count) => {
  const m = MILESTONES.find((x) => x.count === Number(count));
  if (!m) return { error: 'bad_milestone', status: 400 };
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invite-claim:${profileId}`]);
    const { rows: [n] } = await c.query('SELECT COUNT(*)::int AS n FROM invite_uses WHERE inviter_profile_id = $1', [profileId]);
    if (n.n < m.count) { await c.query('ROLLBACK'); return { error: 'not_reached', status: 409 }; }
    const ins = await c.query('INSERT INTO invite_rewards (profile_id, milestone, prime_days, points) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [profileId, m.count, m.primeDays, m.points]);
    if (!ins.rowCount) { await c.query('ROLLBACK'); return { error: 'already_claimed', status: 409 }; }
    await grantPrimeIn(c, profileId, 'standard', m.primeDays, { additive: true });
    const cr = await wallet.creditPointsIn(c, profileId, m.points, 'points_earn', `Награда за приглашения: ${m.count} чел.`, `invite:${m.count}`);
    if (cr?.error) { await c.query('ROLLBACK'); return { error: cr.error, status: 500 }; }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
  notifyGift(profileId, 'invite', 'Награда за приглашения', `+${m.primeDays} дн. Prime и ${m.points} баллов`, `invite:${m.count}`).catch(() => {});
  return { ok: true, primeDays: m.primeDays, points: m.points };
};
