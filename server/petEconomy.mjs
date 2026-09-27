/**
 * Экономика питомцев: Pet Coins (отдельная от Sky Money валюta —
 * никогда не рубли, не выводятся, не обмениваются на Sky Money и не
 * переводятся между пользователями напрямую), достижения, ежедневные
 * задания, сезонные события.
 *
 * Тот же приём блокировки строки, что и в server/wallet.mjs для
 * Sky Money: FOR UPDATE держит счёт до конца транзакции, поэтому два
 * одновременных списания не смогут увести баланс в минус.
 */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';

const MAX_AMOUNT = 10_000_000;
const validAmount = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_AMOUNT;

const inTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const ensureWallet = (c, profileId) =>
  c.query('INSERT INTO pet_wallets (profile_id) VALUES ($1) ON CONFLICT (profile_id) DO NOTHING', [profileId]);

const addTx = (c, profileId, type, amount, descr, ref, idempotencyKey) =>
  c.query(
    `INSERT INTO pet_currency_transactions (id, profile_id, type, amount, descr, ref, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [`pctx-${generateId()}`, profileId, type, amount, descr, ref ?? null, idempotencyKey ?? null],
  );

export const getWallet = async (profileId) => {
  const { rows } = await query(
    'INSERT INTO pet_wallets (profile_id) VALUES ($1) ON CONFLICT (profile_id) DO UPDATE SET profile_id = $1 RETURNING balance',
    [profileId],
  );
  return { balance: Number(rows[0].balance) };
};

export const getLedger = async (profileId, limit = 50) => {
  const { rows } = await query(
    `SELECT id, type, amount, descr, ref, created_at FROM pet_currency_transactions
      WHERE profile_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [profileId, Math.min(200, Math.max(1, Number(limit) || 50))],
  );
  return rows.map((r) => ({ id: r.id, type: r.type, amount: Number(r.amount), descr: r.descr, ref: r.ref ?? undefined, createdAt: r.created_at }));
};

/** Начисление Pet Coins — за уход/задания/достижения/события. */
export const earnCoins = async (profileId, amount, type, descr, ref) => {
  if (!validAmount(amount)) return { error: 'invalid_amount' };
  return inTransaction(async (c) => {
    await ensureWallet(c, profileId);
    const { rows } = await c.query(
      'UPDATE pet_wallets SET balance = balance + $2, updated_at = now() WHERE profile_id = $1 RETURNING balance',
      [profileId, amount],
    );
    await addTx(c, profileId, type, amount, descr, ref);
    return { balance: Number(rows[0].balance) };
  });
};

/** Списание Pet Coins — цену/тип всегда определяет вызывающий серверный
 *  код по ID товара, никогда напрямую тело запроса клиента. */
export const spendCoins = async (profileId, amount, type, descr, ref, idempotencyKey) => {
  if (!validAmount(amount)) return { error: 'invalid_amount' };
  return inTransaction(async (c) => {
    await ensureWallet(c, profileId);
    const { rows } = await c.query('SELECT balance FROM pet_wallets WHERE profile_id = $1 FOR UPDATE', [profileId]);
    const balance = Number(rows[0].balance);
    if (balance < amount) return { error: 'insufficient_coins', balance };
    const upd = await c.query(
      'UPDATE pet_wallets SET balance = balance - $2, updated_at = now() WHERE profile_id = $1 RETURNING balance',
      [profileId, amount],
    );
    await addTx(c, profileId, type, -amount, descr, ref, idempotencyKey);
    return { balance: Number(upd.rows[0].balance) };
  });
};

/* ─── Достижения / задания / события: общий счётчик прогресса ──────── */

/** Applies delta (or, если opts.max, "поднять максимум") к прогрессу
 *  всех активных достижений/сегодняшних заданий/событий с этой метрикой.
 *  Не начисляет награду сама — только помечает completed_at/unlocked_at,
 *  чтобы получение приза оставалось явным действием пользователя
 *  (см. claimQuestReward/claimAchievement) и никогда не было тихим. */
export const trackMetric = async (profileId, metric, delta = 1, opts = {}) => {
  const bump = (cur) => (opts.max ? Math.max(cur, delta) : cur + delta);

  const { rows: achRows } = await query(
    `SELECT a.id, a.goal, ua.progress FROM pet_achievements a
       LEFT JOIN pet_user_achievements ua ON ua.achievement_id = a.id AND ua.profile_id = $1
      WHERE a.status = 'active' AND a.metric = $2`,
    [profileId, metric],
  );
  for (const a of achRows) {
    const progress = Math.min(a.goal, bump(a.progress ?? 0));
    const unlockedNow = progress >= a.goal;
    await query(
      `INSERT INTO pet_user_achievements (profile_id, achievement_id, progress, unlocked_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (profile_id, achievement_id) DO UPDATE SET
         progress = $3, unlocked_at = COALESCE(pet_user_achievements.unlocked_at, $4)`,
      [profileId, a.id, progress, unlockedNow ? new Date() : null],
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const { rows: questRows } = await query(
    `SELECT uq.id, uq.progress, q.goal FROM pet_user_quests uq
       JOIN pet_quests q ON q.id = uq.quest_id
      WHERE uq.profile_id = $1 AND uq.assigned_on = $2 AND q.metric = $3 AND uq.completed_at IS NULL`,
    [profileId, today, metric],
  );
  for (const q of questRows) {
    const progress = Math.min(q.goal, bump(q.progress));
    await query(
      `UPDATE pet_user_quests SET progress = $2, completed_at = CASE WHEN $2 >= $3 THEN now() ELSE completed_at END WHERE id = $1`,
      [q.id, progress, q.goal],
    );
  }

  const { rows: evRows } = await query(
    `SELECT p.reward_id, p.progress, r.goal FROM pet_event_progress p
       JOIN pet_event_rewards r ON r.id = p.reward_id
       JOIN pet_events e ON e.id = r.event_id
      WHERE p.profile_id = $1 AND r.metric = $2 AND e.status = 'active'`,
    [profileId, metric],
  );
  for (const e of evRows) {
    const progress = Math.min(e.goal, bump(e.progress));
    await query('UPDATE pet_event_progress SET progress = $2 WHERE profile_id = $1 AND reward_id = $3', [profileId, progress, e.reward_id]);
  }
  // Первое обращение к событию для профиля — строка в pet_event_progress
  // создаётся при выдаче списка событий (см. getActiveEvents), не здесь.
};

const grantReward = async (profileId, { xp, coins, itemId }) => {
  if (coins > 0) await earnCoins(profileId, coins, 'earn_achievement', 'Награда');
  if (xp > 0) {
    const { rows } = await query('SELECT id FROM pets WHERE profile_id = $1 AND is_active', [profileId]);
    if (rows[0]) {
      // XP начисляется тем же путём, что и обычный уход — через careForPet
      // нельзя (нет действия), поэтому напрямую с той же формулой уровня.
      const { addXpDirect } = await import('./pets.mjs');
      await addXpDirect(rows[0].id, xp);
    }
  }
  if (itemId) {
    await query(
      `INSERT INTO skin_inventory (id, profile_id, item_id, acquired_via)
       VALUES ($1,$2,$3,'achievement') ON CONFLICT (profile_id, item_id) DO NOTHING`,
      [`sinv-${generateId()}`, profileId, itemId],
    );
  }
};

export const listAchievements = async (profileId) => {
  const { rows } = await query(
    `SELECT a.*, ua.progress AS my_progress, ua.unlocked_at AS my_unlocked_at
       FROM pet_achievements a
       LEFT JOIN pet_user_achievements ua ON ua.achievement_id = a.id AND ua.profile_id = $1
      WHERE a.status = 'active' ORDER BY a.created_at`,
    [profileId],
  );
  return rows.map((r) => ({
    id: r.id, title: r.title, description: r.description, goal: r.goal,
    rewardXp: r.reward_xp, rewardCoins: r.reward_coins, rewardItemId: r.reward_item_id,
    progress: r.my_progress ?? 0, unlockedAt: r.my_unlocked_at ?? null,
  }));
};

export const claimAchievement = async (profileId, achievementId) => {
  const { rows } = await query(
    `SELECT a.reward_xp, a.reward_coins, a.reward_item_id, ua.unlocked_at, ua.claimed_at
       FROM pet_achievements a JOIN pet_user_achievements ua ON ua.achievement_id = a.id
      WHERE a.id = $1 AND ua.profile_id = $2`,
    [achievementId, profileId],
  );
  const row = rows[0];
  if (!row || !row.unlocked_at) return { error: 'not_unlocked' };
  if (row.claimed_at) return { error: 'already_claimed' };
  await query('UPDATE pet_user_achievements SET claimed_at = now() WHERE profile_id = $1 AND achievement_id = $2', [profileId, achievementId]);
  await grantReward(profileId, { xp: row.reward_xp, coins: row.reward_coins, itemId: row.reward_item_id });
  return { ok: true };
};

/** Три (или сколько задано в конфиге) задания в сутки — назначаются
 *  один раз в день лениво, при первом обращении. */
export const getDailyQuests = async (profileId) => {
  const today = new Date().toISOString().slice(0, 10);
  const { rows: existing } = await query(
    `SELECT uq.*, q.title, q.description, q.metric, q.goal, q.reward_xp, q.reward_coins, q.reward_item_id
       FROM pet_user_quests uq JOIN pet_quests q ON q.id = uq.quest_id
      WHERE uq.profile_id = $1 AND uq.assigned_on = $2`,
    [profileId, today],
  );
  if (existing.length === 0) {
    const { rows: cfg } = await query("SELECT value FROM pet_config WHERE key = 'daily_quest_count'", []);
    const count = Number(cfg[0]?.value ?? 3);
    const { rows: pool_ } = await query(`SELECT id FROM pet_quests WHERE status = 'active' ORDER BY random() LIMIT $1`, [count]);
    for (const q of pool_) {
      await query(
        `INSERT INTO pet_user_quests (id, profile_id, quest_id, assigned_on) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [`puq-${generateId()}`, profileId, q.id, today],
      );
    }
    const { rows: assigned } = await query(
      `SELECT uq.*, q.title, q.description, q.metric, q.goal, q.reward_xp, q.reward_coins, q.reward_item_id
         FROM pet_user_quests uq JOIN pet_quests q ON q.id = uq.quest_id
        WHERE uq.profile_id = $1 AND uq.assigned_on = $2`,
      [profileId, today],
    );
    return assigned.map(toQuestView);
  }
  return existing.map(toQuestView);
};

const toQuestView = (r) => ({
  id: r.id, title: r.title, description: r.description, goal: r.goal,
  progress: r.progress, rewardXp: r.reward_xp, rewardCoins: r.reward_coins, rewardItemId: r.reward_item_id,
  completedAt: r.completed_at, claimedAt: r.claimed_at,
});

export const claimQuest = async (profileId, userQuestId) => {
  const { rows } = await query(
    `SELECT uq.completed_at, uq.claimed_at, q.reward_xp, q.reward_coins, q.reward_item_id
       FROM pet_user_quests uq JOIN pet_quests q ON q.id = uq.quest_id
      WHERE uq.id = $1 AND uq.profile_id = $2`,
    [userQuestId, profileId],
  );
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (!row.completed_at) return { error: 'not_completed' };
  if (row.claimed_at) return { error: 'already_claimed' };
  await query('UPDATE pet_user_quests SET claimed_at = now() WHERE id = $1', [userQuestId]);
  await grantReward(profileId, { xp: row.reward_xp, coins: row.reward_coins, itemId: row.reward_item_id });
  return { ok: true };
};

/* ─── Сезонные события ──────────────────────────────────────────────── */

export const getActiveEvents = async (profileId) => {
  await query(`UPDATE pet_events SET status = 'active' WHERE status = 'scheduled' AND starts_at <= now() AND ends_at > now()`);
  await query(`UPDATE pet_events SET status = 'ended' WHERE status = 'active' AND ends_at <= now()`);
  const { rows: events } = await query(`SELECT * FROM pet_events WHERE status = 'active' ORDER BY starts_at`);
  const out = [];
  for (const e of events) {
    const { rows: rewards } = await query('SELECT * FROM pet_event_rewards WHERE event_id = $1', [e.id]);
    for (const r of rewards) {
      await query(
        `INSERT INTO pet_event_progress (profile_id, reward_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [profileId, r.id],
      );
    }
    const { rows: progress } = await query(
      `SELECT reward_id, progress, claimed_at FROM pet_event_progress WHERE profile_id = $1 AND reward_id = ANY($2)`,
      [profileId, rewards.map((r) => r.id)],
    );
    const byReward = new Map(progress.map((p) => [p.reward_id, p]));
    out.push({
      id: e.id, name: e.name, description: e.description, endsAt: e.ends_at,
      rewards: rewards.map((r) => ({
        id: r.id, metric: r.metric, goal: r.goal, rewardXp: r.reward_xp, rewardCoins: r.reward_coins, rewardItemId: r.reward_item_id,
        progress: byReward.get(r.id)?.progress ?? 0, claimedAt: byReward.get(r.id)?.claimed_at ?? null,
      })),
    });
  }
  return out;
};

export const claimEventReward = async (profileId, rewardId) => {
  const { rows } = await query(
    `SELECT p.progress, p.claimed_at, r.goal, r.reward_xp, r.reward_coins, r.reward_item_id
       FROM pet_event_progress p JOIN pet_event_rewards r ON r.id = p.reward_id
      WHERE p.profile_id = $1 AND p.reward_id = $2`,
    [profileId, rewardId],
  );
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.progress < row.goal) return { error: 'not_completed' };
  if (row.claimed_at) return { error: 'already_claimed' };
  await query('UPDATE pet_event_progress SET claimed_at = now() WHERE profile_id = $1 AND reward_id = $2', [profileId, rewardId]);
  await grantReward(profileId, { xp: row.reward_xp, coins: row.reward_coins, itemId: row.reward_item_id });
  return { ok: true };
};

/* ─── Админка: экономика, достижения, задания, события ──────────────── */

export const adminEconomyStats = async (actorId) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS generated,
      COALESCE(SUM(-amount) FILTER (WHERE amount < 0 AND type LIKE 'spend_%'), 0) AS spent,
      COALESCE(SUM(-amount) FILTER (WHERE type = 'burn_fee'), 0) AS burned
    FROM pet_currency_transactions
  `);
  const { rows: circ } = await query('SELECT COALESCE(SUM(balance),0) AS circulating FROM pet_wallets');
  return {
    generated: Number(rows[0].generated), spent: Number(rows[0].spent), burned: Number(rows[0].burned),
    circulating: Number(circ[0].circulating),
  };
};

/* Массовая/разовая выдача Pet Coins администратором — опасное
 * действие, поэтому своего исполнителя здесь нет: заявка оформляется
 * через adminsec.createPendingAction(actorId, 'grant_pet_coins', ...),
 * а выдаёт earnCoins уже adminsec.decidePendingAction после того, как
 * повернёт второй ключ владелец (см. server/adminsec.mjs). Прямого
 * пути «право content → сразу баланс» нарочно не существует. */
