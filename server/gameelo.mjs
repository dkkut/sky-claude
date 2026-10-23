/**
 * Система ELO Sky Games: лиги, коэффициент K, история, таблица лидеров.
 * Рейтинг меняет только matchmaking.confirmResult (подтверждение соперником). Здесь — правила и чтение.
 *
 *  • Лиги по ELO: Бронза <900, Серебро 900–1099, Золото 1100–1299, Платина 1300–1499, Алмаз 1500–1699, Мастер 1700+.
 *  • K: первые 10 игр — 48 (калибровка), дальше 32, от 1700 — 24. Нижний предел рейтинга — 100.
 *  • Не больше 3 зачётных матчей против одних и тех же соперников за 24 часа — дальше матч сыгран, а рейтинг не меняется.
 */
import { query } from './db.mjs';

export const TIERS = [
  { id: 'bronze', name: 'Бронза', min: 0 }, { id: 'silver', name: 'Серебро', min: 900 }, { id: 'gold', name: 'Золото', min: 1100 },
  { id: 'platinum', name: 'Платина', min: 1300 }, { id: 'diamond', name: 'Алмаз', min: 1500 }, { id: 'master', name: 'Мастер', min: 1700 },
];
export const ELO_FLOOR = 100;
export const CALIBRATION_GAMES = 10;
export const PAIR_LIMIT_24H = 3;

export const tierOf = (elo) => {
  let idx = 0;
  TIERS.forEach((t, i) => { if (elo >= t.min) idx = i; });
  const cur = TIERS[idx]; const next = TIERS[idx + 1] ?? null;
  return { id: cur.id, name: cur.name, min: cur.min, next: next ? { id: next.id, name: next.name, min: next.min } : null,
    progress: next ? Math.max(0, Math.min(1, (elo - cur.min) / (next.min - cur.min))) : 1 };
};

export const kFor = (gamesPlayed, elo) => (gamesPlayed < CALIBRATION_GAMES ? 48 : elo >= 1700 ? 24 : 32);

export const expectedScore = (own, opp) => 1 / (1 + 10 ** ((opp - own) / 400));

/** Ключ «эти же соперники»: отсортированные составы обеих команд, порядок сторон не важен. */
export const pairKey = (teamA, teamB) => [[...teamA].sort().join(','), [...teamB].sort().join(',')].sort().join('|');

export const ratingView = async (profileId, gameId) => {
  await query('INSERT INTO game_ratings (profile_id, game_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [profileId, gameId]);
  const r = (await query('SELECT elo, wins, losses, peak_elo FROM game_ratings WHERE profile_id=$1 AND game_id=$2', [profileId, gameId])).rows[0];
  const games = r.wins + r.losses;
  let position = null;
  if (games > 0) position = Number((await query(`SELECT count(*) AS n FROM game_ratings WHERE game_id=$1 AND (wins+losses) > 0 AND elo > $2`, [gameId, r.elo])).rows[0].n) + 1;
  return { elo: r.elo, wins: r.wins, losses: r.losses, peak: Math.max(r.peak_elo, r.elo), games, calibrating: games < CALIBRATION_GAMES, gamesToCalibrate: Math.max(0, CALIBRATION_GAMES - games), tier: tierOf(r.elo), position };
};

export const leaderboard = async (viewerId, gameId, limit = 50) => {
  const lim = Math.min(100, Math.max(1, Number(limit) || 50));
  const { rows } = await query(
    `SELECT r.profile_id, r.elo, r.wins, r.losses, p.name, p.username FROM game_ratings r JOIN profiles p ON p.id = r.profile_id
      WHERE r.game_id = $1 AND (r.wins + r.losses) >= 1 ORDER BY r.elo DESC, (r.wins + r.losses) DESC, r.updated_at ASC LIMIT $2`, [gameId, lim]);
  return { top: rows.map((r, i) => ({ place: i + 1, profileId: r.profile_id, name: r.name, username: r.username, elo: r.elo, wins: r.wins, losses: r.losses, tier: tierOf(r.elo).id, me: r.profile_id === viewerId })),
    mine: await ratingView(viewerId, gameId) };
};

export const history = async (profileId, gameId, limit = 30) => {
  const { rows } = await query(
    `SELECT match_id, elo_before, elo_after, delta, won, k, rated, at FROM game_rating_history WHERE profile_id=$1 AND game_id=$2 ORDER BY id DESC LIMIT $3`,
    [profileId, gameId, Math.min(100, Math.max(1, Number(limit) || 30))]);
  return { items: rows.map((r) => ({ matchId: r.match_id, before: r.elo_before, after: r.elo_after, delta: r.delta, won: r.won, k: r.k, rated: r.rated, at: r.at.toISOString() })) };
};
