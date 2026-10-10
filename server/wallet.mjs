/**
 * Кошелёк: балансы, баллы и журнал операций.
 *
 * Все изменения баланса идут только отсюда и только внутри транзакции
 * с блокировкой строки (SELECT ... FOR UPDATE). Без блокировки два
 * одновременных списания могли бы прочитать один и тот же баланс и
 * увести счёт в минус.
 *
 * Владельца операции определяет вызывающий код по токену — идентификатор
 * пользователя из тела запроса сюда попадать не должен.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';

/** Курс обмена рублей в баллы. Раньше жил в двух местах и расходился. */
export const POINTS_PER_RUBLE = 10;

const MAX_AMOUNT = 10_000_000; // потолок на одну операцию, страховка от опечаток и переполнения

/** Сумма должна быть целым числом в разумных пределах. */
const validAmount = (value) =>
  Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT;

/** Заводит счёт при первом обращении, чтобы не заводить его отдельным шагом. */
const ensureAccount = async (client, userId) => {
  await client.query(
    'INSERT INTO wallet_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
    [userId],
  );
};

const addTx = (client, userId, type, amount, descr, ref = null) =>
  client.query(
    'INSERT INTO wallet_transactions (id, user_id, type, amount, descr, ref) VALUES ($1,$2,$3,$4,$5,$6)',
    [`tx-${generateId()}`, userId, type, amount, descr, ref],
  );

/** Выполняет fn в транзакции, откатывая изменения при любой ошибке. */
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

const creditTx = async (c, userId, amount, type, descr, ref) => {
  await ensureAccount(c, userId);
  const { rows } = await c.query(
    'UPDATE wallet_accounts SET balance = balance + $2, updated_at = now() WHERE user_id = $1 RETURNING balance',
    [userId, amount],
  );
  await addTx(c, userId, type, amount, descr, ref ?? null);
  return { balance: Number(rows[0].balance) };
};

const creditPointsTx = async (c, userId, amount, type, descr, ref) => {
  await ensureAccount(c, userId);
  const { rows } = await c.query(
    'UPDATE wallet_accounts SET points = points + $2, updated_at = now() WHERE user_id = $1 RETURNING points',
    [userId, amount],
  );
  await addTx(c, userId, type, amount, descr, ref ?? null);
  return { points: Number(rows[0].points) };
};

export const wallet = {
  async getState(userId, txLimit = 50) {
    await inTransaction((c) => ensureAccount(c, userId));

    const [acc, txs] = await Promise.all([
      query('SELECT balance, points FROM wallet_accounts WHERE user_id = $1', [userId]),
      query(
        `SELECT id, type, amount, descr, ref, created_at
           FROM wallet_transactions WHERE user_id = $1
          ORDER BY created_at DESC LIMIT $2`,
        [userId, txLimit],
      ),
    ]);

    return {
      balance: Number(acc.rows[0]?.balance ?? 0),
      points:  Number(acc.rows[0]?.points  ?? 0),
      transactions: txs.rows.map((r) => ({
        id: r.id, userId, type: r.type,
        amount: Number(r.amount), desc: r.descr,
        ref: r.ref ?? undefined, createdAt: r.created_at.toISOString(),
      })),
    };
  },

  /**
   * Пополнение. Создаёт деньги из ничего, поэтому вызывать его вправе
   * только тот, кто подтвердил платёж, — см. проверку режима в server.mjs.
   */
  async topUp(userId, amount, method) {
    if (!validAmount(amount)) return { error: 'invalid_amount' };

    return inTransaction(async (c) => {
      await ensureAccount(c, userId);
      const { rows } = await c.query(
        'UPDATE wallet_accounts SET balance = balance + $2, updated_at = now() WHERE user_id = $1 RETURNING balance',
        [userId, amount],
      );
      await addTx(c, userId, 'topup', amount, `Пополнение через ${method}`);
      return { balance: Number(rows[0].balance) };
    });
  },

  /**
   * Возврат средств. Как и пополнение, увеличивает баланс, поэтому
   * открыт только в демо-режиме: источник возврата (семейный счёт)
   * пока живёт в браузере и доверять ему нельзя.
   */
  async refund(userId, amount, descr, ref) {
    if (!validAmount(amount)) return { error: 'invalid_amount' };

    return inTransaction(async (c) => {
      await ensureAccount(c, userId);
      const { rows } = await c.query(
        'UPDATE wallet_accounts SET balance = balance + $2, updated_at = now() WHERE user_id = $1 RETURNING balance',
        [userId, amount],
      );
      await addTx(c, userId, 'refund', amount, descr, ref);
      return { balance: Number(rows[0].balance) };
    });
  },

  /**
   * Начисление администрацией по решению владельца.
   *
   * Создаёт ценность из ничего — как пополнение, но по другому поводу:
   * не «человек заплатил», а «владелец распорядился». Поэтому отдельный
   * вид записи в журнале кошелька: по нему видно, откуда деньги.
   *
   * Своего пути к балансу у панели администратора нет: она зовёт это, а
   * это ходит той же транзакцией с той же блокировкой строки, что и всё
   * остальное. Два пути к одному счёту однажды разойдутся.
   *
   * Право решить проверяется не здесь, а там, где поворачивается второй
   * ключ: сюда попадает уже подтверждённое владельцем действие.
   */
  async adminGrant(userId, amount, what, descr, ref) {
    if (!validAmount(amount)) return { error: 'invalid_amount' };
    const points = what === 'points';

    return inTransaction(async (c) => {
      await ensureAccount(c, userId);
      const column = points ? 'points' : 'balance';
      const { rows } = await c.query(
        `UPDATE wallet_accounts SET ${column} = ${column} + $2, updated_at = now()
          WHERE user_id = $1 RETURNING balance, points`,
        [userId, amount],
      );
      await addTx(c, userId, points ? 'admin_points' : 'admin_grant', amount, descr, ref ?? null);
      return { balance: Number(rows[0].balance), points: Number(rows[0].points) };
    });
  },

  /**
   * Заработок курьера за подтверждённую доставку.
   *
   * Увеличивает баланс так же, как adminGrant, но по другому поводу:
   * не решение администратора, а собственная работа человека,
   * подтверждённая сервером (см. server/courierdelivery.mjs::
   * confirmDelivery) — отдельный вид записи в журнале кошелька, чтобы
   * по истории транзакций было видно, откуда деньги, не открывая
   * заказ.
   */
  async earnDelivery(userId, amount, descr, ref) {
    if (!validAmount(amount)) return { error: 'invalid_amount' };

    return inTransaction(async (c) => {
      await ensureAccount(c, userId);
      const { rows } = await c.query(
        'UPDATE wallet_accounts SET balance = balance + $2, updated_at = now() WHERE user_id = $1 RETURNING balance',
        [userId, amount],
      );
      await addTx(c, userId, 'courier_earning', amount, descr, ref);
      return { balance: Number(rows[0].balance) };
    });
  },

  /**
   * Зачисление с указанным типом операции — для случаев, где деньги не
   * дарит администратор и не платформа за работу (для этого уже есть
   * adminGrant/earnDelivery), а высвобождает уже удержанный на счету
   * другого участника эскроу (см. server/garant.mjs): статьи в журнале
   * должны называться по смыслу, а не одним и тем же "courier_earning"
   * для всего подряд.
   */
  async credit(userId, amount, type, descr, ref) {
    if (!validAmount(amount)) return { error: 'invalid_amount' };
    return inTransaction((c) => creditTx(c, userId, amount, type, descr, ref));
  },

  /**
   * То же начисление, но внутри ЧУЖОЙ транзакции: вызывающий сам держит
   * BEGIN/COMMIT. Нужно там, где деньги и другое действие обязаны
   * случиться вместе или не случиться вовсе (активация кода Sky Codes:
   * пометить код использованным и начислить — одним целым).
   */
  creditIn(client, userId, amount, type, descr, ref) {
    if (!validAmount(amount)) return Promise.resolve({ error: 'invalid_amount' });
    return creditTx(client, userId, amount, type, descr, ref);
  },

  /** Начисление баллов. Тоже создаёт ценность — гейт тот же. */
  async earnPoints(userId, amount, descr) {
    if (!validAmount(amount)) return { error: 'invalid_amount' };

    return inTransaction(async (c) => {
      await ensureAccount(c, userId);
      const { rows } = await c.query(
        'UPDATE wallet_accounts SET points = points + $2, updated_at = now() WHERE user_id = $1 RETURNING points',
        [userId, amount],
      );
      await addTx(c, userId, 'points_earn', amount, descr);
      return { points: Number(rows[0].points) };
    });
  },

  /** Списание со своего счёта. Чужой баланс уменьшить нельзя: userId приходит из токена. */
  async spend(userId, amount, type, descr, ref) {
    if (!validAmount(amount)) return { error: 'invalid_amount' };

    return inTransaction(async (c) => {
      await ensureAccount(c, userId);
      // FOR UPDATE держит строку до конца транзакции: параллельное
      // списание подождёт и увидит уже уменьшенный баланс.
      const { rows } = await c.query(
        'SELECT balance FROM wallet_accounts WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      const balance = Number(rows[0].balance);
      if (balance < amount) return { error: 'insufficient_funds', balance };

      const upd = await c.query(
        'UPDATE wallet_accounts SET balance = balance - $2, updated_at = now() WHERE user_id = $1 RETURNING balance',
        [userId, amount],
      );
      await addTx(c, userId, type, -amount, descr, ref);
      return { balance: Number(upd.rows[0].balance) };
    });
  },

  /** Обмен рублей на баллы по фиксированному курсу. */
  async exchangeToPoints(userId, rubles) {
    if (!validAmount(rubles)) return { error: 'invalid_amount' };

    return inTransaction(async (c) => {
      await ensureAccount(c, userId);
      const { rows } = await c.query('SELECT balance FROM wallet_accounts WHERE user_id = $1 FOR UPDATE', [userId]);
      const balance = Number(rows[0].balance);
      if (balance < rubles) return { error: 'insufficient_funds', balance };

      const points = rubles * POINTS_PER_RUBLE;
      const upd = await c.query(
        `UPDATE wallet_accounts SET balance = balance - $2, points = points + $3, updated_at = now()
          WHERE user_id = $1 RETURNING balance, points`,
        [userId, rubles, points],
      );
      await addTx(c, userId, 'points_earn', points,
        `Обмен ${rubles.toLocaleString('ru')} ₽ → ${points.toLocaleString('ru')} баллов`);
      return { balance: Number(upd.rows[0].balance), points: Number(upd.rows[0].points) };
    });
  },

  /** Зачисление баллов с указанным типом — баллный аналог credit(). */
  async creditPoints(userId, amount, type, descr, ref) {
    if (!validAmount(amount)) return { error: 'invalid_amount' };
    return inTransaction((c) => creditPointsTx(c, userId, amount, type, descr, ref));
  },

  /** creditPoints внутри чужой транзакции — см. creditIn. */
  creditPointsIn(client, userId, amount, type, descr, ref) {
    if (!validAmount(amount)) return Promise.resolve({ error: 'invalid_amount' });
    return creditPointsTx(client, userId, amount, type, descr, ref);
  },

  /**
   * Списание баллов внутри чужой транзакции — чтобы покупка и списание
   * подтверждались или откатывались вместе. Счёт блокируется строкой, а
   * CHECK (points >= 0) в базе не даёт уйти в минус даже при гонке.
   */
  async spendPointsIn(client, userId, amount, type, descr, ref) {
    if (!validAmount(amount)) return { error: 'invalid_amount' };
    await ensureAccount(client, userId);
    const { rows } = await client.query('SELECT points FROM wallet_accounts WHERE user_id = $1 FOR UPDATE', [userId]);
    if (Number(rows[0].points) < amount) return { error: 'insufficient_points', points: Number(rows[0].points) };
    const upd = await client.query(
      'UPDATE wallet_accounts SET points = points - $2, updated_at = now() WHERE user_id = $1 RETURNING points', [userId, amount]);
    await addTx(client, userId, type, -amount, descr, ref ?? null);
    return { points: Number(upd.rows[0].points) };
  },

  async spendPoints(userId, amount, descr, ref) {
    if (!validAmount(amount)) return { error: 'invalid_amount' };

    return inTransaction(async (c) => {
      await ensureAccount(c, userId);
      const { rows } = await c.query('SELECT points FROM wallet_accounts WHERE user_id = $1 FOR UPDATE', [userId]);
      if (Number(rows[0].points) < amount) return { error: 'insufficient_points', points: Number(rows[0].points) };

      const upd = await c.query(
        'UPDATE wallet_accounts SET points = points - $2, updated_at = now() WHERE user_id = $1 RETURNING points',
        [userId, amount],
      );
      await addTx(c, userId, 'points_spend', -amount, descr, ref);
      return { points: Number(upd.rows[0].points) };
    });
  },
};
