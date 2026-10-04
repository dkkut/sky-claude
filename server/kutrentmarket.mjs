/**
 * KutRent Market — личный кабинет на сайте-партнёре (market.kutrent.online).
 *
 * Раньше это была касса-киоск: посетитель, не входя в Sky ID, вписывал
 * произвольный Sky-ник и пополнял его баланс — удобно, но получатель
 * определял клиент, а не сервер. По явному решению владельца эта схема
 * заменена: вход через Sky ID обязателен, и пополняется только свой же
 * баланс — получателя сервер больше не спрашивает у клиента никогда, он
 * вычисляется из сессии.
 *
 * Отдельный сайт, но не отдельный сервис: работает тем же API-процессом
 * и той же базой, что и весь Sky (см. server/routes/kutrentmarket.mjs и
 * nginx/market-template/market.conf.template) — пополнение баланса Sky
 * остаётся обычным внутрипроцессным вызовом wallet.credit(), без сети,
 * подписей и общих секретов между «сервисами», потому что сервисов тут
 * физически два домена одного процесса, а не два процесса.
 *
 * Передача личности между доменами. web.skymessenger.online и
 * market.kutrent.online — разные домены, кука Sky-сессии (HttpOnly,
 * этого же домена) туда не доезжает и не должна: иначе market.kutrent.online
 * мог бы читать главную Sky-сессию. Поэтому личность переносит не кука, а
 * одноразовый короткоживущий токен в адресе редиректа: SSO-эндпоинт на
 * основном домене (/sso/start, требует уже вошедшего в Sky профиля)
 * выпускает токен, market.kutrent.online гасит его (/sso/consume) и
 * заводит свою собственную сессию сайта — с этого момента куки сессии
 * Market и Sky никак не связаны и обе SameSite=Lax/Strict на своём
 * домене.
 *
 * Authenticator — не секрет и не токен сессии: это постоянный,
 * непредсказуемый, неизменяемый идентификатор пользователя Market,
 * который можно показать ему самому и найти по нему в поиске поддержки/
 * админки. Знание чужого Authenticator само по себе ничего не даёt —
 * он не участвует ни в одной проверке доступа.
 *
 * Оплата: подключённой кассы по-прежнему нет, но заказ больше не
 * «зависает» без единого шага — после создания покупателю показываются
 * реквизиты расчётного счёта (kutrent_market_requisites), он переводит
 * деньги и указывает номер телефона, с которого придёт перевод
 * (submitPaymentProof). Дальше администратор с правом 'finance' ищет
 * операцию в банке по этому номеру и оформляет заявку владельцу —
 * markOrderPaid() вызывается только подтверждённой заявкой (см.
 * server/adminsec.mjs, PENDING_KINDS.kutrent_mark_paid), то же правило,
 * что у любого другого начисления денег из ничего в этом проекте. Если
 * владелец перевод не нашёл — rejectOrderPaid() возвращает заказ
 * покупателю, а не хоронит его: номер телефона можно уточнить и
 * отправить заново.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { wallet } from './wallet.mjs';
import { isOwner } from './admin.mjs';
import { logAdmin, consumeStepUp } from './adminsec.mjs';

const MIN_AMOUNT = 10;
const MAX_AMOUNT = 500_000;
const SSO_TOKEN_TTL_MS = 2 * 60 * 1000;

/* ─── Authenticator ─────────────────────────────────────────────────── */

/** Непредсказуем (CSPRNG, 96 бит), не растёт по порядку, не секрет. */
const newAuthenticator = () => `KRA-${crypto.randomBytes(12).toString('base64url')}`;

/* ─── Пользователь Market ───────────────────────────────────────────── */

/**
 * Найти или завести пользователя Market для этого профиля Sky.
 * Authenticator выдаётся один раз, при первом входе, и дальше не
 * меняется — обычным API его поменять нельзя, этой функции тоже:
 * ON CONFLICT здесь ничего не трогает в существующей строке.
 */
export const ensureMarketUser = async (profileId, skyId) => {
  const id = `krmu-${generateId()}`;
  const authenticator = newAuthenticator();
  const { rows } = await query(
    `INSERT INTO kutrent_market_users (id, profile_id, sky_id, authenticator, last_login_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (profile_id) DO UPDATE SET last_login_at = now()
     RETURNING *`,
    [id, profileId, skyId, authenticator],
  );
  return rows[0];
};

export const marketUserByProfile = async (profileId) => {
  const { rows } = await query(
    'SELECT * FROM kutrent_market_users WHERE profile_id = $1', [String(profileId ?? '')]);
  return rows[0] ?? null;
};

/* ─── Передача личности Sky ID → Market (SSO) ──────────────────────── */

const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

/**
 * Выпустить одноразовый токен для уже вошедшего в Sky профиля.
 * Вызывается с основного домена (requireProfile — там и только там
 * есть настоящая Sky-сессия); 2 минуты и один проход — ровно то время,
 * за которое браузер успевает долететь до market.kutrent.online.
 */
export const issueSsoToken = async (profileId) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = `krsso-${generateId()}`;
  await query(
    `INSERT INTO kutrent_market_sso_tokens (id, profile_id, token_hash, expires_at)
     VALUES ($1,$2,$3, now() + ($4 || ' milliseconds')::interval)`,
    [id, profileId, hashToken(token), String(SSO_TOKEN_TTL_MS)],
  );
  return token;
};

/**
 * Погасить токен и завести (или найти) пользователя Market. Токен
 * одноразовый: UPDATE с условием used_at IS NULL срабатывает ровно один
 * раз, гонка из двух параллельных запросов погасит его только для
 * одного из них.
 */
export const consumeSsoToken = async (rawToken) => {
  const token = String(rawToken ?? '');
  if (!token) return { error: 'bad_token' };

  const { rows } = await query(
    `UPDATE kutrent_market_sso_tokens SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING profile_id`,
    [hashToken(token)],
  );
  const profileId = rows[0]?.profile_id;
  if (!profileId) return { error: 'invalid_or_expired' };

  const { rows: who } = await query(
    `SELECT p.id AS profile_id, p.username, p.name, s.id AS sky_id, s.blocked_until
       FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE p.id = $1`, [profileId]);
  const person = who[0];
  if (!person) return { error: 'not_found' };
  if (person.blocked_until && new Date(person.blocked_until) > new Date()) {
    return { error: 'account_blocked' };
  }

  const marketUser = await ensureMarketUser(person.profile_id, person.sky_id);
  return { ok: true, marketUser, profile: { username: person.username, name: person.name } };
};

/* ─── Сессия сайта ──────────────────────────────────────────────────── */

export const createMarketSession = async (marketUserId) => {
  const id = `krms-${generateId()}`;
  await query(
    'INSERT INTO kutrent_market_sessions (id, market_user_id) VALUES ($1,$2)',
    [id, marketUserId],
  );
  return id;
};

/**
 * Пользователь текущей сессии сайта — или null, если сессии нет,
 * отозвана, либо сам Market-аккаунт приостановлен (см. suspend ниже).
 * Спрашивается у базы на каждый запрос: отозванная/приостановленная
 * сессия должна перестать работать сразу, а не до следующего логина.
 */
export const marketUserForSession = async (sessionId) => {
  const id = String(sessionId ?? '');
  if (!id) return null;
  const { rows } = await query(
    `SELECT u.*, p.username, p.name
       FROM kutrent_market_sessions s
       JOIN kutrent_market_users u ON u.id = s.market_user_id
       JOIN profiles p ON p.id = u.profile_id
      WHERE s.id = $1 AND s.revoked_at IS NULL AND u.status = 'active'`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  await query('UPDATE kutrent_market_sessions SET last_seen = now() WHERE id = $1', [id]);
  return row;
};

export const revokeMarketSession = async (sessionId) => {
  await query('UPDATE kutrent_market_sessions SET revoked_at = now() WHERE id = $1', [String(sessionId ?? '')]);
};

/** Для приостановки пользователя администрацией: рвёт все его сессии сайта. */
export const revokeAllSessionsForMarketUser = async (marketUserId) => {
  const { rowCount } = await query(
    `UPDATE kutrent_market_sessions SET revoked_at = now()
      WHERE market_user_id = $1 AND revoked_at IS NULL`, [marketUserId]);
  return rowCount;
};

/* ─── Заказы ─────────────────────────────────────────────────────────── */

/**
 * Завести заказ на пополнение. Получатель — всегда сам пользователь
 * текущей сессии: ни username, ни profileId, ни authenticator в это
 * тело не попадают, потому что их здесь никто не спрашивает.
 */
export const createSkyTopupOrder = async (marketUser, amountRub) => {
  const amount = Math.trunc(Number(amountRub));
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return { error: 'invalid_amount' };
  }
  const id = `krm-${generateId()}`;
  await query(
    `INSERT INTO kutrent_market_orders
       (id, market_user_id, kind, amount_rub, sky_recipient_username, sky_recipient_profile_id)
     VALUES ($1,$2,'sky_topup',$3,$4,$5)`,
    [id, marketUser.id, amount, marketUser.username, marketUser.profile_id],
  );
  return { ok: true, order: await getOrder(marketUser.id, id) };
};

const toView = (r) => ({
  id: r.id, kind: r.kind, amount: Number(r.amount_rub), status: r.status,
  createdAt: r.created_at.toISOString(),
  paidAt: r.paid_at ? r.paid_at.toISOString() : null,
  senderPhone: r.sender_phone ?? null,
  proofSubmittedAt: r.proof_submitted_at ? r.proof_submitted_at.toISOString() : null,
});

export const getOrder = async (marketUserId, orderId) => {
  const { rows } = await query(
    `SELECT * FROM kutrent_market_orders WHERE id = $1 AND market_user_id = $2`,
    [orderId, marketUserId],
  );
  return rows[0] ? toView(rows[0]) : null;
};

export const listOrders = async (marketUserId, limit = 50) => {
  const { rows } = await query(
    `SELECT * FROM kutrent_market_orders WHERE market_user_id = $1
      ORDER BY created_at DESC LIMIT $2`,
    [marketUserId, limit],
  );
  return rows.map(toView);
};

/** Для админ-панели/заявки на подтверждение — без привязки к сессии. */
export const adminGetOrder = async (orderId) => {
  const { rows } = await query('SELECT * FROM kutrent_market_orders WHERE id = $1', [String(orderId ?? '')]);
  return rows[0] ?? null;
};

/**
 * Настоящее подтверждение оплаты — единственная точка входа для любой
 * кассы (сейчас не подключена ни одна, см. шапку файла) и для заявки
 * администратора, подтверждённой владельцем. Идемпотентно: гонка из
 * нескольких одновременных вызовов по одному заказу зачислит баланс
 * ровно один раз — один guard-UPDATE со сменой статуса, дальше уже не
 * пройти второй раз.
 */
export const markOrderPaid = async (orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE kutrent_market_orders SET status = 'paid', paid_at = now()
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [orderId],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      const { rows: existing } = await query('SELECT status FROM kutrent_market_orders WHERE id = $1', [orderId]);
      if (!existing[0]) return { error: 'not_found' };
      return { error: existing[0].status === 'paid' ? 'already_paid' : 'not_pending' };
    }
    await client.query('COMMIT');

    const order = rows[0];
    const credit = await wallet.credit(
      order.sky_recipient_profile_id, Number(order.amount_rub), 'kutrent_topup',
      `Пополнение через KutRent Market (${order.id})`, order.id,
    );
    return { ok: true, order: toView(order), balance: credit.balance };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Подтверждение платежа покупателем ─────────────────────────────── */

const PHONE_RE = /^[0-9+()\s-]{5,20}$/;

/**
 * Покупатель перевёл деньги по реквизитам (getRequisites ниже) и
 * указывает номер телефона, с которого придёт перевод — администратор
 * потом ищет по нему операцию в банке, прежде чем просить владельца
 * подтвердить (createPendingAction 'kutrent_mark_paid'). Разрешено и
 * для уже отклонённого заказа ('rejected' → 'pending'): то, что владелец
 * не нашёл перевод с первого раза, не значит, что заказ закрыт навсегда
 * — покупатель может уточнить номер и отправить его заново.
 */
export const submitPaymentProof = async (marketUser, orderId, rawPhone) => {
  const phone = String(rawPhone ?? '').trim();
  if (!PHONE_RE.test(phone)) return { error: 'bad_phone' };

  const { rows } = await query(
    `UPDATE kutrent_market_orders
        SET sender_phone = $1, proof_submitted_at = now(),
            status = CASE WHEN status = 'rejected' THEN 'pending' ELSE status END
      WHERE id = $2 AND market_user_id = $3 AND status IN ('pending', 'rejected')
      RETURNING *`,
    [phone, orderId, marketUser.id],
  );
  if (!rows[0]) {
    const { rows: existing } = await query(
      'SELECT status FROM kutrent_market_orders WHERE id = $1 AND market_user_id = $2',
      [orderId, marketUser.id],
    );
    if (!existing[0]) return { error: 'not_found' };
    return { error: existing[0].status === 'paid' ? 'already_paid' : 'not_pending' };
  }
  return { ok: true, order: toView(rows[0]) };
};

/**
 * Владелец не нашёл перевод по заявке администратора — заказ
 * возвращается покупателю (не остаётся «Ожидание подтверждения»
 * навечно), тот увидит отказ и сможет указать номер телефона заново
 * (submitPaymentProof выше). Вызывается только из decidePendingAction
 * при отклонении заявки 'kutrent_mark_paid' (server/adminsec.mjs).
 */
export const rejectOrderPaid = async (orderId) => {
  const { rows } = await query(
    `UPDATE kutrent_market_orders SET status = 'rejected' WHERE id = $1 AND status = 'pending' RETURNING *`,
    [orderId],
  );
  return rows[0] ? { ok: true, order: toView(rows[0]) } : { error: 'not_pending' };
};

/* ─── Реквизиты расчётного счёта ─────────────────────────────────────
   Показываются каждому покупателю сразу после создания заказа — это не
   секрет, это номер счёта, на который и так переводят деньги все
   покупатели. Изменить их может только владелец, с повторным
   подтверждением личности: это ровно то место, куда идут настоящие
   переводы, подменить его — украсть деньги у всех будущих покупателей
   разом (тот же принцип, что у server/platform.mjs::setShutdown). */

const toRequisites = (r) => ({
  accountNumber: r.account_number, bankName: r.bank_name, bik: r.bik,
  bankInn: r.bank_inn, bankKpp: r.bank_kpp, corrAccount: r.corr_account,
  recipientName: r.recipient_name,
  updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
});

export const getRequisites = async () => {
  const { rows } = await query('SELECT * FROM kutrent_market_requisites WHERE id');
  return rows[0] ? toRequisites(rows[0]) : null;
};

const REQ_FIELD_MAX = 200;
const cleanField = (v) => String(v ?? '').trim().slice(0, REQ_FIELD_MAX);

export const setRequisites = async (actorId, fields, stepUpCode) => {
  if (!(await isOwner(actorId))) {
    await logAdmin({ actorId, type: 'kutrent_requisites', targetType: 'system',
      result: 'denied', detail: 'Не владелец' });
    return { error: 'owner_only' };
  }
  const step = await consumeStepUp(actorId, 'kutrent_requisites', stepUpCode);
  if (step.error) return { error: step.error };

  const clean = {
    accountNumber: cleanField(fields?.accountNumber),
    bankName: cleanField(fields?.bankName),
    bik: cleanField(fields?.bik),
    bankInn: cleanField(fields?.bankInn),
    bankKpp: cleanField(fields?.bankKpp),
    corrAccount: cleanField(fields?.corrAccount),
    recipientName: cleanField(fields?.recipientName),
  };
  await query(
    `UPDATE kutrent_market_requisites SET
       account_number = $1, bank_name = $2, bik = $3, bank_inn = $4,
       bank_kpp = $5, corr_account = $6, recipient_name = $7,
       updated_by = $8, updated_at = now()
     WHERE id`,
    [clean.accountNumber, clean.bankName, clean.bik, clean.bankInn,
      clean.bankKpp, clean.corrAccount, clean.recipientName, actorId],
  );
  await logAdmin({ actorId, type: 'kutrent_requisites_set', targetType: 'system',
    detail: 'Изменены реквизиты оплаты KutRent Market' });
  return { ok: true, requisites: await getRequisites() };
};

/* ─── Поиск и списки для админ-панели (просмотр, право 'kutrent_market') ─ */

/** По Authenticator — точное совпадение, или по Sky-нику — частичное. */
export const adminSearchUsers = async (q, limit = 50) => {
  const clean = String(q ?? '').trim();
  const n = Math.min(100, Math.max(1, Number(limit) || 50));
  if (!clean) {
    const { rows } = await query(
      `SELECT u.*, p.username, p.name FROM kutrent_market_users u
         JOIN profiles p ON p.id = u.profile_id
        ORDER BY u.created_at DESC LIMIT $1`, [n]);
    return rows.map(adminUserView);
  }
  const { rows } = await query(
    `SELECT u.*, p.username, p.name FROM kutrent_market_users u
       JOIN profiles p ON p.id = u.profile_id
      WHERE u.authenticator = $1 OR lower(p.username) LIKE lower($2)
      ORDER BY u.created_at DESC LIMIT $3`,
    [clean, `%${clean.replace(/^@/, '')}%`, n],
  );
  return rows.map(adminUserView);
};

const adminUserView = (r) => ({
  id: r.id, profileId: r.profile_id, skyId: r.sky_id,
  authenticator: r.authenticator, status: r.status,
  username: r.username, name: r.name,
  createdAt: r.created_at.toISOString(),
  lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
});

export const adminGetUser = async (marketUserId) => {
  const { rows } = await query(
    `SELECT u.*, p.username, p.name FROM kutrent_market_users u
       JOIN profiles p ON p.id = u.profile_id WHERE u.id = $1`, [String(marketUserId ?? '')]);
  if (!rows[0]) return null;
  const orders = await listOrders(rows[0].id, 100);
  return { ...adminUserView(rows[0]), orders };
};

export const adminListOrders = async ({ status, q, limit } = {}) => {
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  const args = [];
  const where = [];
  if (['pending', 'paid', 'cancelled'].includes(String(status ?? ''))) {
    args.push(status); where.push(`o.status = $${args.length}`);
  }
  const clean = String(q ?? '').trim();
  if (clean) {
    args.push(`%${clean.replace(/^@/, '')}%`);
    const likeArg = args.length;
    args.push(clean);
    const eqArg = args.length;
    where.push(`(lower(p.username) LIKE lower($${likeArg}) OR o.id = $${eqArg} OR u.authenticator = $${eqArg})`);
  }
  args.push(n);
  const { rows } = await query(
    `SELECT o.*, p.username, u.authenticator, u.sky_id FROM kutrent_market_orders o
       LEFT JOIN kutrent_market_users u ON u.id = o.market_user_id
       LEFT JOIN profiles p ON p.id = u.profile_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY o.created_at DESC LIMIT $${args.length}`,
    args,
  );
  return rows.map((r) => ({
    ...toView(r), username: r.username ?? undefined, authenticator: r.authenticator ?? undefined,
    skyId: r.sky_id ?? undefined,
  }));
};

/** Приостановка/восстановление пользователя Market. Рвёт сессии сайта
 *  сразу — то же правило, что у блокировки Sky ID: снятое и выданное
 *  ограничение должно действовать немедленно, а не со следующего входа. */
export const setMarketUserStatus = async (marketUserId, status) => {
  const clean = status === 'suspended' ? 'suspended' : 'active';
  const { rowCount } = await query(
    'UPDATE kutrent_market_users SET status = $2, updated_at = now() WHERE id = $1',
    [marketUserId, clean],
  );
  if (!rowCount) return { error: 'not_found' };
  if (clean === 'suspended') await revokeAllSessionsForMarketUser(marketUserId);
  return { ok: true, status: clean };
};
