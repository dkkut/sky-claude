/**
 * Активность в играх: сколько человек играл и во что играет прямо сейчас.
 *
 * Источники — настоящие, ничего не придумывается:
 *   · Sky Blox — пульс шлёт страница Sky вокруг открытой игры;
 *   · игры на ПК — Windows-приложение Sky (по желанию человека) видит запущенные процессы из известного списка
 *     (electron/known-games.json) и шлёт только id игры; список процессов с устройства не уходит;
 *   · игры на телефоне и «своя игра» — человек отмечает сам; запись живёт, пока приложение Sky открыто и шлёт пульс.
 * Пульс — раз в 30 с (из фона браузер режет таймеры до раза в минуту), поэтому разрыв до 150 с считается одной сессией.
 * Время — от первого до последнего пульса, не более 12 часов на сессию. Что игра «известная», решает сервер: название
 * известной игры берётся из списка, для «своей» — из текста человека. Другим людям активность видна только если
 * человек сам включил показ (game_prefs.share).
 */
import fs from 'node:fs';
import { query } from './db.mjs';

const GAP_SEC = 150;
const MAX_SESSION_SEC = 12 * 3600;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

const KNOWN = JSON.parse(fs.readFileSync(new URL('../electron/known-games.json', import.meta.url), 'utf8'));
const BY_ID = new Map(KNOWN.map((g) => [g.id, g]));
export const knownGames = () => KNOWN.map(({ id, title, icon, platform }) => ({ id, title, icon, platform }));

const slug = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40);

export const ping = async (userId, { kind, refId, title }) => {
  if (kind !== 'blox' && kind !== 'game') return { error: 'bad_kind' };
  let ref = clip(refId, 80); let name = '';
  if (kind === 'blox') {
    if (!ref) return { error: 'bad_ref' };
    const { rows } = await query(`SELECT title FROM blox_games WHERE id = $1 OR id = (SELECT game_id FROM blox_places WHERE id = $1)`, [ref]);
    if (!rows[0]) return { error: 'not_found' };
    name = clip(rows[0].title, 80);
  } else if (BY_ID.has(ref)) {
    name = BY_ID.get(ref).title;
  } else {
    name = clip(title, 60);                       // «своя игра»: название от самого человека
    if (name.length < 2) return { error: 'bad_title' };
    ref = `custom:${slug(name) || 'game'}`;
  }
  // Одновременно человек играет в одну игру: пульс другой закрывает предыдущую.
  await query(`UPDATE game_sessions SET ended_at = now() WHERE user_id = $1 AND ended_at IS NULL AND NOT (kind = $2 AND ref_id = $3)`,
    [userId, kind, ref]);
  const { rows: open } = await query(
    `UPDATE game_sessions SET last_seen_at = now(), title = $4
      WHERE id = (SELECT id FROM game_sessions WHERE user_id = $1 AND kind = $2 AND ref_id = $3 AND ended_at IS NULL
                    AND last_seen_at > now() - ($5 || ' seconds')::interval ORDER BY last_seen_at DESC LIMIT 1)
      RETURNING id`, [userId, kind, ref, name, String(GAP_SEC)]);
  if (!open[0]) await query('INSERT INTO game_sessions (user_id, kind, ref_id, title) VALUES ($1,$2,$3,$4)', [userId, kind, ref, name]);
  return { ok: true, title: name };
};

/** «Закончил играть»: закрывает все открытые сессии человека. */
export const stop = async (userId) => {
  await query('UPDATE game_sessions SET ended_at = now() WHERE user_id = $1 AND ended_at IS NULL', [userId]);
  return { ok: true };
};

/** Секунды игры с момента since: каждая сессия обрезана по началу периода и по 12 часам. */
export const gameSeconds = async (userId, since) => {
  const { rows } = await query(
    `SELECT COALESCE(SUM(LEAST(EXTRACT(EPOCH FROM (last_seen_at - GREATEST(started_at, $2))), $3)), 0)::int AS sec
       FROM game_sessions WHERE user_id = $1 AND last_seen_at >= $2`, [userId, since, MAX_SESSION_SEC]);
  return Math.max(0, Number(rows[0]?.sec ?? 0));
};

const live = (r) => ({ kind: r.kind, refId: r.ref_id, title: r.title, since: r.started_at.toISOString() });

/** Во что человек играет сейчас: открытая сессия с живым пульсом. */
export const nowPlaying = async (userId) => {
  const { rows } = await query(
    `SELECT kind, ref_id, title, started_at FROM game_sessions
      WHERE user_id = $1 AND ended_at IS NULL AND last_seen_at > now() - ($2 || ' seconds')::interval ORDER BY last_seen_at DESC LIMIT 1`, [userId, String(GAP_SEC)]);
  return rows[0] ? live(rows[0]) : null;
};

/** Мои итоги: по играм за неделю и за всё время (в секундах). */
export const summary = async (userId) => {
  const { rows } = await query(
    `SELECT kind, ref_id, max(title) AS title,
            COALESCE(SUM(LEAST(EXTRACT(EPOCH FROM (last_seen_at - started_at)), $2)), 0)::int AS total,
            COALESCE(SUM(LEAST(EXTRACT(EPOCH FROM (last_seen_at - GREATEST(started_at, now() - interval '7 days'))), $2)) FILTER (WHERE last_seen_at >= now() - interval '7 days'), 0)::int AS week
       FROM game_sessions WHERE user_id = $1 GROUP BY kind, ref_id ORDER BY total DESC LIMIT 30`, [userId, MAX_SESSION_SEC]);
  const { rows: pref } = await query('SELECT share FROM game_prefs WHERE user_id = $1', [userId]);
  return { playing: await nowPlaying(userId), share: Boolean(pref[0]?.share),
    games: rows.map((r) => ({ kind: r.kind, refId: r.ref_id, title: r.title, totalSec: Math.max(0, r.total), weekSec: Math.max(0, r.week) })) };
};

export const setShare = async (userId, on) => {
  await query('INSERT INTO game_prefs (user_id, share) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET share = $2', [userId, on === true]);
  return { ok: true, share: on === true };
};

/** Что видят другие: только у тех, кто включил показ; остальные неотличимы от «не играет». */
export const presenceOf = async (ids) => {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x)).filter((x) => x.length > 0 && x.length < 80))].slice(0, 60);
  if (!list.length) return {};
  const { rows } = await query(
    `SELECT DISTINCT ON (s.user_id) s.user_id, s.kind, s.ref_id, s.title, s.started_at
       FROM game_sessions s JOIN game_prefs p ON p.user_id = s.user_id AND p.share
      WHERE s.user_id = ANY($1) AND s.ended_at IS NULL AND s.last_seen_at > now() - ($2 || ' seconds')::interval
      ORDER BY s.user_id, s.last_seen_at DESC`, [list, String(GAP_SEC)]);
  return Object.fromEntries(rows.map((r) => [r.user_id, live(r)]));
};

/** Уборка: сессии старше полугода, брошенные открытые — закрыть. */
export const sweepGameSessions = async () => {
  await query(`UPDATE game_sessions SET ended_at = last_seen_at WHERE ended_at IS NULL AND last_seen_at < now() - interval '1 hour'`);
  await query(`DELETE FROM game_sessions WHERE last_seen_at < now() - interval '180 days'`);
};
