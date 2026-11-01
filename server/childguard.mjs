/**
 * Детский профиль: переписка, расписание и траты. Зависит только от базы (его зовут wallet, privacy, signal — без циклов).
 * Настройки лежат в child_accounts.settings: schedule {from,to,tz}, dailySpend, friendsOnly, words[], money, hideAdult.
 * Текст сообщений не хранится: при срабатывании слова записывается только само слово из списка опекуна.
 */
import { query } from './db.mjs';
import { generateId } from './security.mjs';

let cache = new Map();
export const forgetChildCfg = (id) => { if (id) cache.delete(id); else cache = new Map(); };
export const childCfg = async (profileId) => {
  if (!profileId) return null;
  const hit = cache.get(profileId);
  if (hit && Date.now() - hit.at < 4000) return hit.row;
  let row = null;
  try { row = (await query('SELECT profile_id, guardian_id, settings FROM child_accounts WHERE profile_id = $1', [profileId])).rows[0] ?? null; } catch { return null; }
  cache.set(profileId, { at: Date.now(), row });
  if (cache.size > 5000) cache.clear();
  return row;
};

const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '')); return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : null; };
/** Разрешено ли сейчас по расписанию ребёнка (по часовому поясу, который указал опекун). Расписания нет — всегда да. */
export const withinSchedule = (settings, now = Date.now()) => {
  const sc = settings?.schedule;
  if (!sc) return true;
  const from = toMin(sc.from), to = toMin(sc.to);
  if (from == null || to == null || from === to) return true;
  const local = new Date(now - (Number(sc.tz) || 0) * 60_000);       // tz = getTimezoneOffset() опекуна
  const t = local.getUTCHours() * 60 + local.getUTCMinutes();
  return from < to ? t >= from && t < to : t >= from || t < to;
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const normWord = (w) => norm(w).slice(0, 40);
/** Слово из списка найдено в тексте: короткие (до 4 знаков) — только целым словом, длинные — и внутри слова. */
export const findWord = (text, words) => {
  const t = ` ${norm(text)} `;
  if (t.trim() === '') return null;
  for (const w of words ?? []) {
    const n = normWord(w);
    if (n.length < 2) continue;
    if (n.length < 4 ? t.includes(` ${n} `) : t.includes(n)) return n;
  }
  return null;
};

const friends = async (a, b) => {
  const [x, y] = a < b ? [a, b] : [b, a];
  return !!(await query(`SELECT 1 FROM friendships WHERE a_id = $1 AND b_id = $2 AND status = 'accepted'`, [x, y])).rows[0];
};

/** Нельзя ли writer написать owner в личку из-за детского режима (любой из двоих — ребёнок). */
export const childWriteDenied = async (ownerId, writerId) => {
  const [o, w] = await Promise.all([childCfg(ownerId), childCfg(writerId)]);
  if (!o && !w) return null;
  for (const [cfg, child, other] of [[o, ownerId, writerId], [w, writerId, ownerId]]) {
    if (!cfg) continue;
    const blocked = (await query('SELECT 1 FROM child_blocked_peers WHERE child_id = $1 AND peer_id = $2', [child, other])).rows[0];
    if (blocked) return 'child_chat_blocked';
    if (cfg.settings?.friendsOnly !== false && !(await friends(child, other))) return 'child_friends_only';
  }
  return null;
};

/** Проверка исходящего сообщения: расписание ребёнка и запрещённые слова (в личных чатах — блокируется чат с этим человеком). */
export const guardChildMessage = async (me, chatId, text) => {
  const mine = await childCfg(me);
  if (mine && !withinSchedule(mine.settings)) return 'child_time_limit';
  const { rows: chat } = await query('SELECT type FROM chats WHERE id = $1', [chatId]);
  if (chat[0]?.type !== 'direct') return null;
  const { rows } = await query('SELECT user_id FROM chat_members WHERE chat_id = $1 AND user_id <> $2', [chatId, me]);
  const peer = rows[0]?.user_id;
  if (!peer) return null;
  for (const [child, other, cfg] of [[me, peer, mine], [peer, me, await childCfg(peer)]]) {
    if (!cfg) continue;
    const hit = findWord(text, cfg.settings?.words);
    if (!hit) continue;
    const ins = await query('INSERT INTO child_blocked_peers (child_id, peer_id, word) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1', [child, other, hit]);
    if (ins.rows[0] && cfg.guardian_id) {
      try {
        const { notifyGift } = await import('./giftnotify.mjs');
        const p = (await query('SELECT name FROM profiles WHERE id = $1', [child])).rows[0];
        await notifyGift(cfg.guardian_id, 'child_chat_blocked', 'Чат ребёнка закрыт', `В переписке профиля «${p?.name ?? ''}» сработало запрещённое слово «${hit}». Чат с этим человеком закрыт; открыть его можно в настройках детского аккаунта.`, `cb-${generateId()}`);
      } catch { /* уведомление не должно ронять блокировку */ }
    }
    return 'child_chat_blocked';
  }
  return null;
};

/** Траты детского профиля: запрет денег и суточный предел (скользящие 24 часа, рубли). q — query или client.query. */
export const childSpendDenied = async (q, userId, amount) => {
  const cfg = await childCfg(userId);
  if (!cfg) return null;
  const s = cfg.settings ?? {};
  if (!s.money) return 'child_spend_blocked';
  const limit = Number(s.dailySpend) || 0;
  if (limit > 0) {
    const { rows } = await q(`SELECT COALESCE(-SUM(amount),0)::bigint AS spent FROM wallet_transactions
                              WHERE user_id = $1 AND currency = 'rub' AND amount < 0 AND created_at > now() - interval '24 hours'`, [userId]);
    if (Number(rows[0].spent) + Number(amount) > limit) return 'child_spend_limit';
  }
  return null;
};
