/**
 * Матчмейкинг Sky Games.
 *
 * Рейтинг, очередь и найденный матч — всё на сервере. Раньше ELO
 * вычислялся на лету в интерфейсе из статистики в localStorage
 * (500 + wins*12 + hours*3) — переписав своё же хранилище, игрок
 * получал любой рейтинг, какой захочет. «Поиск матча» был таймером со
 * случайной задержкой без единого другого живого игрока.
 *
 * Формат команды — по игре (TEAM_SIZE), а не выдуманное «5v5» на
 * карточке без единого игрока за ним: CS2 и Dota2 — 5 на 5, Fortnite —
 * отряд на отряд 4 на 4 (полноценный королевской-битвы режим с
 * десятками отдельных отрядов — другая модель данных; здесь те же два
 * противоборствующих состава, что и у остальных игр). Схема
 * (team_a/team_b — массивы) годится для любого размера без миграции.
 *
 * Подтверждения результата (кто выиграл) здесь нет и не может быть
 * честно: за этими карточками игр не стоит ни одного настоящего
 * игрового сервера, который мог бы сообщить исход, — выдумывать его
 * значило бы просто вернуть фейковые ELO-изменения на новом месте.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';

const newId = (p) => `${p}-${crypto.randomUUID()}`;
const MATCH_ACCEPT_TIMEOUT_MS = 20_000;

/** Игроков в одной команде. Решает сервер, а не карточка игры в
 *  интерфейсе — иначе переписанный клиент мог бы подтвердить матч
 *  вдвоём там, где нужно по пять. Неизвестная игра — 1 на 1. */
const TEAM_SIZE = { 'g-cs2': 5, 'g-dota2': 5, 'g-fortnite': 4 };
export const teamSizeFor = (gameId) => TEAM_SIZE[gameId] ?? 1;

/** Название игры для подписей вне интерфейса (название авто-войс-пати
 *  комнаты команды) — тот же список, что и в src/gaming/store.ts. */
export const GAME_TITLE = { 'g-cs2': 'Counter-Strike 2', 'g-dota2': 'Dota 2', 'g-fortnite': 'Fortnite' };

export const getRating = async (profileId, gameId) => {
  await query(
    `INSERT INTO game_ratings (profile_id, game_id) VALUES ($1,$2)
     ON CONFLICT (profile_id, game_id) DO NOTHING`,
    [profileId, gameId],
  );
  const { rows } = await query(
    'SELECT elo, wins, losses FROM game_ratings WHERE profile_id = $1 AND game_id = $2',
    [profileId, gameId],
  );
  return rows[0];
};

/** Активный матч человека — pending или только что confirmed (клиент
 *  ещё не увидел ответ). Не даёт встать в очередь, уже кому-то
 *  назначенным. */
export const myActiveMatch = async (profileId) => {
  const { rows } = await query(
    `SELECT * FROM matches
      WHERE status IN ('pending','confirmed') AND ($1 = ANY(team_a) OR $1 = ANY(team_b))
      ORDER BY created_at DESC LIMIT 1`,
    [profileId],
  );
  return rows[0] ? toMatch(rows[0]) : null;
};

const toMatch = (r) => ({
  id: r.id, gameId: r.game_id, teamA: r.team_a, teamB: r.team_b,
  avgElo: r.avg_elo, status: r.status, createdAt: r.created_at.toISOString(),
});

/**
 * Встать в очередь. PRIMARY KEY(profile_id) в matchmaking_queue сам не
 * даёт занять две очереди сразу — INSERT ... ON CONFLICT DO UPDATE
 * просто переставляет существующую запись на новую игру, а не
 * заводит вторую.
 *
 * Сразу пробует найти соперника: если кто-то уже ждёт в этой же игре,
 * матч находится тем же вызовом, а не отдельным опросом.
 */
export const joinQueue = async (profileId, gameId) => {
  // Блокируем повторный вход в очередь, только пока матч ещё не
  // подтверждён обеими сторонами (status='pending'). Как только матч
  // confirmed — работа мэтчмейкинга закончена (реального игрового
  // сервера, который сообщил бы «игра завершена», здесь нет), и игрок
  // должен иметь возможность сразу встать в очередь на следующий матч,
  // а не застрять в «активном» матче навсегда.
  const already = await myActiveMatch(profileId);
  if (already && already.status === 'pending') return { error: 'in_active_match', match: already };

  const teamSize = teamSizeFor(gameId);
  const wanted = teamSize * 2;
  const rating = await getRating(profileId, gameId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO matchmaking_queue (profile_id, game_id, elo, joined_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (profile_id) DO UPDATE SET game_id = $2, elo = $3, joined_at = now()`,
      [profileId, gameId, rating.elo],
    );

    // Ближайшие по ELO в той же игре — с блокировкой строк, чтобы два
    // одновременных join не забрали одного и того же ожидающего дважды.
    // Себя явно не исключаем: он и так первый по расстоянию (0), и без
    // него набор мог бы недосчитаться одного места.
    const { rows: candidates } = await client.query(
      `SELECT profile_id, elo FROM matchmaking_queue
        WHERE game_id = $1
        ORDER BY abs(elo - $2) ASC LIMIT $3 FOR UPDATE SKIP LOCKED`,
      [gameId, rating.elo, wanted],
    );
    if (candidates.length < wanted) {
      await client.query('COMMIT');
      return { queued: true };
    }

    // Составы — не «топ отдельно от низких»: сортируем по ELO и
    // раздаём по очереди в две команды, чтобы силы вышли ровными, а не
    // одна команда из полностью сильнейших против слабейших.
    const sorted = [...candidates].sort((a, b) => a.elo - b.elo);
    const teamA = [];
    const teamB = [];
    sorted.forEach((c, i) => (i % 2 === 0 ? teamA : teamB).push(c.profile_id));

    const allIds = sorted.map((c) => c.profile_id);
    await client.query('DELETE FROM matchmaking_queue WHERE profile_id = ANY($1)', [allIds]);
    const matchId = newId('match');
    const avgElo = Math.round(sorted.reduce((sum, c) => sum + c.elo, 0) / sorted.length);
    await client.query(
      `INSERT INTO matches (id, game_id, team_a, team_b, avg_elo) VALUES ($1,$2,$3,$4,$5)`,
      [matchId, gameId, teamA, teamB, avgElo],
    );
    await client.query(
      `INSERT INTO match_accepts (match_id, profile_id) SELECT $1, unnest($2::text[])`,
      [matchId, allIds],
    );
    await client.query('COMMIT');
    const match = { id: matchId, gameId, teamA, teamB, avgElo, status: 'pending' };
    return { matched: true, match, opponentIds: allIds.filter((id) => id !== profileId) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const leaveQueue = async (profileId) => {
  await query('DELETE FROM matchmaking_queue WHERE profile_id = $1', [profileId]);
  return { ok: true };
};

/** Принятие матча своей стороной. Кого именно принимать — сервер
 *  сверяет по составу team_a/team_b, а не по тому, что прислал клиент. */
export const acceptMatch = async (profileId, matchId) => {
  const { rows } = await query(
    `SELECT * FROM matches WHERE id = $1 AND status = 'pending'
       AND ($2 = ANY(team_a) OR $2 = ANY(team_b))`,
    [matchId, profileId],
  );
  const row = rows[0];
  if (!row) return { error: 'not_found' };

  await query(
    'UPDATE match_accepts SET accepted = TRUE WHERE match_id = $1 AND profile_id = $2',
    [matchId, profileId],
  );
  const { rows: pending } = await query(
    'SELECT count(*)::int AS n FROM match_accepts WHERE match_id = $1 AND NOT accepted',
    [matchId],
  );
  if (pending[0].n === 0) {
    await query(`UPDATE matches SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [matchId]);
    return { confirmed: true, match: toMatch({ ...row, status: 'confirmed' }) };
  }
  return { waiting: true, match: toMatch(row) };
};

/** Отказ или выход из очереди/матча — та же зачистка, что и при
 *  просрочке: другая сторона, если уже приняла, возвращается в
 *  очередь, а не остаётся ждать неотвечающего вечно. */
export const declineMatch = async (profileId, matchId) => {
  const { rows } = await query(
    `SELECT * FROM matches WHERE id = $1 AND status = 'pending'
       AND ($2 = ANY(team_a) OR $2 = ANY(team_b))`,
    [matchId, profileId],
  );
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  await query(`UPDATE matches SET status = 'cancelled' WHERE id = $1`, [matchId]);
  const others = [...row.team_a, ...row.team_b].filter((id) => id !== profileId);
  const requeued = [];
  for (const other of others) {
    const rating = await getRating(other, row.game_id);
    await query(
      `INSERT INTO matchmaking_queue (profile_id, game_id, elo, joined_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (profile_id) DO UPDATE SET game_id = $2, elo = $3, joined_at = now()`,
      [other, row.game_id, rating.elo],
    );
    requeued.push(other);
  }
  return { ok: true, gameId: row.game_id, requeued };
};

/**
 * Просроченные подтверждения — вызывается по таймеру (см. server/signal.mjs),
 * а не проверяется на каждый чих: очередь и так короткая. Кто принял,
 * тот возвращается в очередь автоматически, кто не ответил — просто
 * выпадает и должен нажать «искать» заново, как и в любом реальном
 * матчмейкинге.
 */
export const sweepStaleMatches = async () => {
  const cutoff = new Date(Date.now() - MATCH_ACCEPT_TIMEOUT_MS).toISOString();
  const { rows: stale } = await query(
    `SELECT * FROM matches WHERE status = 'pending' AND created_at < $1`,
    [cutoff],
  );
  const results = [];
  for (const row of stale) {
    await query(`UPDATE matches SET status = 'cancelled' WHERE id = $1`, [row.id]);
    const { rows: accepts } = await query(
      'SELECT profile_id, accepted FROM match_accepts WHERE match_id = $1', [row.id],
    );
    const requeued = [];
    for (const a of accepts.filter((x) => x.accepted)) {
      const rating = await getRating(a.profile_id, row.game_id);
      await query(
        `INSERT INTO matchmaking_queue (profile_id, game_id, elo, joined_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (profile_id) DO UPDATE SET game_id = $2, elo = $3, joined_at = now()`,
        [a.profile_id, row.game_id, rating.elo],
      );
      requeued.push(a.profile_id);
    }
    const timedOut = accepts.filter((x) => !x.accepted).map((x) => x.profile_id);
    results.push({ matchId: row.id, gameId: row.game_id, participants: [...row.team_a, ...row.team_b], requeued, timedOut });
  }
  return results;
};
