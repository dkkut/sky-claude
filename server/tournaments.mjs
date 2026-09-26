/**
 * Кабинет турниров Sky Games — общий для всех список вместо
 * localStorage-заглушки (см. миграцию 081_tournaments.sql).
 *
 * Бракетов и результатов здесь нет: у CS2/Dota 2/Fortnite нет своего
 * игрового сервера Sky, который мог бы честно сообщить исход раунда
 * турнира, — выдумывать таблицу плей-офф значило бы вернуть тот же
 * фейк под турнирным названием. Кабинет отвечает за то, что можно
 * сделать честно: создать турнир, набрать реальных участников,
 * организатору — отметить, что турнир начался или завершён.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { teamSizeFor, GAME_TITLE } from './matchmaking.mjs';

const newId = () => `trn-${crypto.randomUUID()}`;
const KNOWN_GAMES = new Set(Object.keys(GAME_TITLE));

const countOf = async (tournamentId) => {
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM tournament_participants WHERE tournament_id = $1', [tournamentId],
  );
  return rows[0].n;
};

const isJoinedBy = async (tournamentId, profileId) => {
  if (!profileId) return false;
  const { rows } = await query(
    'SELECT 1 FROM tournament_participants WHERE tournament_id = $1 AND profile_id = $2', [tournamentId, profileId],
  );
  return rows.length > 0;
};

const toView = async (r, viewerId) => ({
  id: r.id, gameId: r.game_id, title: r.title, description: r.description,
  format: r.format, prize: r.prize, teamsMax: r.teams_max, teamsIn: await countOf(r.id),
  organizerId: r.organizer_id, status: r.status, isJoined: await isJoinedBy(r.id, viewerId),
  startsAt: r.starts_at.toISOString(), createdAt: r.created_at.toISOString(),
});

export const createTournament = async (organizerId, input = {}) => {
  const gameId = String(input.gameId ?? '');
  if (!KNOWN_GAMES.has(gameId)) return { error: 'invalid_game' };
  const title = String(input.title ?? '').trim().slice(0, 80);
  if (title.length < 2) return { error: 'invalid_title' };
  const description = String(input.description ?? '').trim().slice(0, 300);
  const format = String(input.format ?? '').trim().slice(0, 40) || `${teamSizeFor(gameId)} на ${teamSizeFor(gameId)}`;
  const prize = String(input.prize ?? '').trim().slice(0, 60);
  const teamsMax = Math.min(256, Math.max(2, Number(input.teamsMax) || 16));
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now()) return { error: 'invalid_schedule' };

  const id = newId();
  const { rows } = await query(
    `INSERT INTO tournaments (id, game_id, title, description, format, prize, teams_max, organizer_id, starts_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, gameId, title, description, format, prize, teamsMax, organizerId, startsAt],
  );
  return { tournament: await toView(rows[0], organizerId) };
};

export const listTournaments = async (viewerId) => {
  const { rows } = await query(
    `SELECT * FROM tournaments WHERE status != 'cancelled' ORDER BY
       CASE status WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END, starts_at ASC LIMIT 200`,
  );
  return Promise.all(rows.map((r) => toView(r, viewerId)));
};

export const getTournament = async (id, viewerId) => {
  const { rows } = await query('SELECT * FROM tournaments WHERE id = $1', [id]);
  return rows[0] ? toView(rows[0], viewerId) : null;
};

export const joinTournament = async (profileId, id) => {
  const { rows } = await query(`SELECT * FROM tournaments WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row || row.status !== 'upcoming') return { error: 'not_found' };
  const already = await query(
    'SELECT 1 FROM tournament_participants WHERE tournament_id = $1 AND profile_id = $2', [id, profileId],
  );
  if (already.rows.length) return { tournament: await toView(row, profileId) };
  const n = await countOf(id);
  if (n >= row.teams_max) return { error: 'full' };
  await query(
    'INSERT INTO tournament_participants (tournament_id, profile_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [id, profileId],
  );
  return { tournament: await toView(row, profileId) };
};

export const leaveTournament = async (profileId, id) => {
  const { rows } = await query(`SELECT * FROM tournaments WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  await query(
    'DELETE FROM tournament_participants WHERE tournament_id = $1 AND profile_id = $2', [id, profileId],
  );
  return { tournament: await toView(row, profileId) };
};

/** Организатор помечает турнир начавшимся раньше срока или завершённым
 *  вручную — судить исход некому, но статус «идёт»/«кончился» отражать
 *  честно можно и нужно (иначе список навсегда показывал бы «скоро»). */
export const setTournamentStatus = async (profileId, id, status) => {
  if (!['live', 'finished', 'cancelled'].includes(status)) return { error: 'invalid_status' };
  const { rows } = await query(`SELECT * FROM tournaments WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.organizer_id !== profileId) return { error: 'not_allowed' };
  await query('UPDATE tournaments SET status = $2 WHERE id = $1', [id, status]);
  return { tournament: await toView({ ...row, status }, profileId) };
};

/** Сама по себе кнопка "начался" не нужна, если время уже настало —
 *  периодический sweep (см. server.mjs) переводит upcoming → live сам,
 *  как только starts_at наступило. Досрочный вызов setTournamentStatus
 *  остаётся организатору, если тот стартовал раньше объявленного. */
export const sweepStartedTournaments = async () => {
  const { rows } = await query(
    `UPDATE tournaments SET status = 'live' WHERE status = 'upcoming' AND starts_at <= now() RETURNING id`,
  );
  return rows.length;
};
