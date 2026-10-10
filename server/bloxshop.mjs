/**
 * Sky Blox: внутриигровой магазин за Prime Points, платформенный API для
 * игровых серверов, вознаграждения и заявки на выплату.
 *
 * Деньги и баллы.
 *  · Валюта — Prime Points из wallet_accounts.points, единственная. Курса
 *    обмена здесь нет вообще: заработок разработчика считается в тех же
 *    баллах, а выплата — заявка в баллах, которую сотрудник исполняет
 *    вручную вне платформы. Сколько это в рублях и можно ли выплатить —
 *    решение владельца и юриста, а не этого кода; по умолчанию приём
 *    заявок на выплату выключен (blox_settings.payoutsEnabled).
 *  · Покупка, списание, начисление и запись в журнал вознаграждений идут
 *    в ОДНОЙ транзакции под блокировкой строки покупки: повтор запроса,
 *    параллельное подтверждение и подмена цены не удвоят списание.
 *  · Игровой сервер баланс не меняет и таблиц Sky не видит: он создаёт
 *    ЗАПРОС на покупку, платит игрок в интерфейсе Sky после явного
 *    подтверждения, сервер лишь узнаёт результат и подтверждает выдачу.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { generateId, rateLimit } from './security.mjs';
import { wallet } from './wallet.mjs';
import { can } from './admin.mjs';
import { logAdmin, consumeStepUp, beginStepUp } from './adminsec.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { marketText as text } from './market.mjs';
import { limit, loadLimits } from './bloxlimits.mjs';
import { readLaunchToken, playerIdFor, GAME_ID_RE, readGame, TERMS_VERSION } from './blox.mjs';

export const PRODUCT_ID_RE = /^bpr-[0-9a-f-]{36}$/;
export const PURCHASE_ID_RE = /^bpu-[0-9a-f-]{36}$/;
export const PAYOUT_ID_RE = /^bpo-[0-9a-f-]{36}$/;
export const STEP_UP_PURPOSE = 'blox_finance';
const iso = (d) => d?.toISOString?.() ?? null;
const isFinance = (a) => can(a, 'blox_finance');
const SKU_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

const tx = async (fn) => {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};

/* ═══ Товары ═══════════════════════════════════════════════════════ */

const productView = (r) => ({
  id: r.id, gameId: r.game_id, sku: r.sku, title: r.title, description: r.description,
  price: r.price_points, kind: r.kind, active: r.active,
});

const ownGame = async (devId, gameId) => {
  if (!GAME_ID_RE.test(String(gameId ?? ''))) return null;
  const { rows } = await query('SELECT * FROM blox_games WHERE id = $1 AND developer_id = $2', [gameId, devId]);
  return rows[0] ?? null;
};

export const listMyProducts = async (devId, gameId) => {
  if (!(await ownGame(devId, gameId))) return { error: 'not_found' };
  const { rows } = await query('SELECT * FROM blox_products WHERE game_id = $1 ORDER BY created_at', [gameId]);
  return { items: rows.map(productView) };
};

const validateProduct = (input, { partial = false } = {}) => {
  const out = {};
  if (!partial || input.sku !== undefined) { const s = String(input.sku ?? ''); if (!SKU_RE.test(s)) return { error: 'bad_sku' }; out.sku = s; }
  if (!partial || input.title !== undefined) { const t = text(input.title, 80); if (t.length < 2) return { error: 'bad_title' }; out.title = t; }
  if (input.description !== undefined) out.description = text(input.description, 500);
  if (!partial || input.price !== undefined) { const p = Number(input.price); if (!Number.isInteger(p) || p < 1 || p > 1_000_000) return { error: 'bad_price' }; out.price_points = p; }
  if (input.kind !== undefined) { if (!['consumable', 'durable'].includes(input.kind)) return { error: 'bad_kind' }; out.kind = input.kind; }
  if (input.active !== undefined) out.active = input.active === true;
  return { fields: out };
};

export const createProduct = async (devId, gameId, input = {}) => {
  const g = await ownGame(devId, gameId);
  if (!g) return { error: 'not_found' };
  if (['blocked', 'archived'].includes(g.moderation_status)) return { error: 'locked' };
  const v = validateProduct(input);
  if (v.error) return v;
  const { rows: n } = await query('SELECT count(*)::int AS n FROM blox_products WHERE game_id = $1', [gameId]);
  if (n[0].n >= (await limit('maxProductsPerGame'))) return { error: 'too_many_products' };
  const f = v.fields;
  const id = `bpr-${generateId()}`;
  try {
    await query(`INSERT INTO blox_products (id, game_id, sku, title, description, price_points, kind) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, gameId, f.sku, f.title, f.description ?? '', f.price_points, f.kind ?? 'consumable']);
  } catch (e) { if (e?.code === '23505') return { error: 'sku_taken' }; throw e; }
  const { rows } = await query('SELECT * FROM blox_products WHERE id = $1', [id]);
  return { product: productView(rows[0]) };
};

export const updateProduct = async (devId, productId, patch = {}) => {
  if (!PRODUCT_ID_RE.test(String(productId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT p.*, g.developer_id FROM blox_products p JOIN blox_games g ON g.id = p.game_id WHERE p.id = $1', [productId]);
  if (!rows[0] || rows[0].developer_id !== devId) return { error: 'not_found' };
  const v = validateProduct(patch, { partial: true });
  if (v.error) return v;
  delete v.fields.sku; // SKU после создания не меняется: на него ссылается игра
  const sets = []; const args = [productId];
  for (const [c, val] of Object.entries(v.fields)) { args.push(val); sets.push(`${c} = $${args.length}`); }
  if (sets.length) await query(`UPDATE blox_products SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  const { rows: r2 } = await query('SELECT * FROM blox_products WHERE id = $1', [productId]);
  return { product: productView(r2[0]) };
};

/** Каталог товаров игры для игроков: только цены и названия из базы. */
export const listShop = async (viewerId, gameId) => {
  const g = await readGame(viewerId, gameId);
  if (!g) return { error: 'not_found' };
  const { rows: gr } = await query('SELECT server_url, conn_status, moderation_status FROM blox_games WHERE id = $1', [gameId]);
  const sellable = gr[0].moderation_status === 'published' && gr[0].conn_status === 'ok' && gr[0].server_url !== '';
  const { rows } = await query('SELECT * FROM blox_products WHERE game_id = $1 AND active ORDER BY price_points', [gameId]);
  const owned = viewerId ? (await query('SELECT product_id, quantity FROM blox_entitlements WHERE user_id = $1 AND product_id = ANY($2)', [viewerId, rows.map((r) => r.id)])).rows : [];
  const q = new Map(owned.map((o) => [o.product_id, o.quantity]));
  return { sellable, items: rows.map((r) => ({ ...productView(r), owned: q.get(r.id) ?? 0 })) };
};

/* ═══ Покупки ══════════════════════════════════════════════════════ */

const purchaseView = (r) => ({
  id: r.id, gameId: r.game_id, productId: r.product_id, sku: r.sku, title: r.title, gameTitle: r.game_title,
  price: r.price_points ?? r.current_price, status: r.status, createdAt: iso(r.created_at), expiresAt: iso(r.intent_expires_at),
  paidAt: iso(r.paid_at), fulfilledAt: iso(r.fulfilled_at), refundedAt: iso(r.refunded_at), refundReason: r.refund_reason || undefined,
});

const PURCHASE_SELECT = `SELECT pu.*, p.sku, p.title, p.price_points AS current_price, g.title AS game_title
  FROM blox_purchases pu JOIN blox_products p ON p.id = pu.product_id JOIN blox_games g ON g.id = pu.game_id`;

const sellableGame = async (gameId) => {
  const { rows } = await query(
    `SELECT g.*, d.status AS dev_status FROM blox_games g JOIN blox_developers d ON d.profile_id = g.developer_id WHERE g.id = $1`, [gameId]);
  const g = rows[0];
  if (!g) return { error: 'not_found' };
  if (g.moderation_status !== 'published' || g.dev_status !== 'active') return { error: 'game_unavailable' };
  if (g.conn_status !== 'ok' || !g.server_url) return { error: 'shop_unavailable' };
  return { game: g };
};

/** Запрос на покупку. Игрок платит позже, подтвердив в интерфейсе Sky. */
const createIntent = async (userId, game, sku, idemKey) => {
  const ik = String(idemKey ?? '');
  if (!/^[A-Za-z0-9_.:-]{8,80}$/.test(ik)) return { error: 'bad_idempotency_key' };
  const { rows: pr } = await query('SELECT * FROM blox_products WHERE game_id = $1 AND sku = $2 AND active', [game.id, String(sku ?? '')]);
  const product = pr[0];
  if (!product) return { error: 'product_not_found' };
  const ttl = await limit('intentTtlSec');
  const id = `bpu-${generateId()}`;
  const { rows: pending } = await query(`SELECT count(*)::int AS n FROM blox_purchases WHERE user_id = $1 AND status = 'pending' AND intent_expires_at > now()`, [userId]);
  if (pending[0].n >= 10) return { error: 'too_many_pending' };
  const ins = await query(
    `INSERT INTO blox_purchases (id, game_id, product_id, user_id, idem_key, intent_expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' seconds')::interval)
     ON CONFLICT (game_id, idem_key) DO NOTHING RETURNING id`, [id, game.id, product.id, userId, ik, String(ttl)]);
  if (!ins.rowCount) {
    // Повтор того же запроса возвращает прежнюю запись; подмена товара или игрока — отказ.
    const { rows: ex } = await query('SELECT * FROM blox_purchases WHERE game_id = $1 AND idem_key = $2', [game.id, ik]);
    if (ex[0].product_id !== product.id || ex[0].user_id !== userId) return { error: 'idempotency_conflict' };
    return { purchaseId: ex[0].id, status: ex[0].status, replay: true };
  }
  return { purchaseId: id, status: 'pending', price: product.price_points, title: product.title };
};

export const createIntentForUser = async (userId, gameId, sku, idemKey) => {
  const s = await sellableGame(gameId);
  if (s.error) return s;
  if (s.game.developer_id === userId) return { error: 'own_game' };
  return createIntent(userId, s.game, sku, idemKey);
};

export const pendingIntents = async (userId) => {
  const { rows } = await query(`${PURCHASE_SELECT} WHERE pu.user_id = $1 AND pu.status = 'pending' AND pu.intent_expires_at > now() ORDER BY pu.created_at DESC LIMIT 20`, [userId]);
  return rows.map((r) => ({ ...purchaseView(r), price: r.current_price, kind: undefined }));
};

export const myPurchases = async (userId) => {
  const { rows } = await query(`${PURCHASE_SELECT} WHERE pu.user_id = $1 ORDER BY pu.created_at DESC LIMIT 100`, [userId]);
  return rows.map(purchaseView);
};

export const myEntitlements = async (userId) => {
  const { rows } = await query(
    `SELECT e.quantity, p.sku, p.title, p.kind, g.title AS game_title, g.id AS game_id FROM blox_entitlements e
       JOIN blox_products p ON p.id = e.product_id JOIN blox_games g ON g.id = p.game_id WHERE e.user_id = $1 AND e.quantity > 0 ORDER BY g.title, p.title`, [userId]);
  return rows.map((r) => ({ quantity: r.quantity, sku: r.sku, title: r.title, kind: r.kind, gameId: r.game_id, gameTitle: r.game_title }));
};

/**
 * Подтверждение покупки игроком. Всё — под блокировкой строки покупки:
 * цена берётся из базы, клиент присылает лишь ту цену, которую видел,
 * чтобы подмена или внезапное повышение дали отказ, а не списание.
 */
export const confirmPurchase = async (userId, purchaseId, expectedPrice) => {
  if (!PURCHASE_ID_RE.test(String(purchaseId ?? ''))) return { error: 'not_found' };
  const out = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM blox_purchases WHERE id = $1 FOR UPDATE', [purchaseId]);
    const pu = rows[0];
    if (!pu || pu.user_id !== userId) return { error: 'not_found' };
    if (pu.status !== 'pending') return { error: pu.status === 'paid' || pu.status === 'fulfilled' ? 'already_paid' : 'not_pending', status: pu.status };
    if (new Date(pu.intent_expires_at).getTime() <= Date.now()) {
      await c.query(`UPDATE blox_purchases SET status = 'expired' WHERE id = $1`, [purchaseId]);
      return { error: 'expired' };
    }
    const { rows: pr } = await c.query('SELECT * FROM blox_products WHERE id = $1', [pu.product_id]);
    const product = pr[0];
    if (!product || !product.active) return { error: 'product_unavailable' };
    const { rows: gr } = await c.query(
      `SELECT g.*, d.status AS dev_status FROM blox_games g JOIN blox_developers d ON d.profile_id = g.developer_id WHERE g.id = $1`, [pu.game_id]);
    const g = gr[0];
    if (!g || g.moderation_status !== 'published' || g.dev_status !== 'active' || g.conn_status !== 'ok') return { error: 'game_unavailable' };
    if (!Number.isInteger(expectedPrice) || expectedPrice !== product.price_points) return { error: 'price_changed', price: product.price_points };
    if (product.kind === 'durable') {
      const { rows: have } = await c.query('SELECT quantity FROM blox_entitlements WHERE user_id = $1 AND product_id = $2', [userId, product.id]);
      if (have[0]?.quantity > 0) return { error: 'already_owned' };
    }
    const price = product.price_points;
    const l = await loadLimits();
    const commission = Math.round((price * l.commissionPercent) / 100);
    const devPoints = price - commission;

    const spent = await wallet.spendPointsIn(c, userId, price, 'blox_purchase', `Sky Blox · ${g.title} · ${product.title}`, `blox:${purchaseId}`);
    if (spent.error) return { error: spent.error, points: spent.points };

    await c.query(
      `UPDATE blox_purchases SET status = 'paid', price_points = $2, commission_pct = $3, dev_points = $4, wallet_ref = $5, paid_at = now() WHERE id = $1`,
      [purchaseId, price, l.commissionPercent, devPoints, `blox:${purchaseId}`]);
    await c.query(
      `INSERT INTO blox_entitlements (user_id, product_id, quantity) VALUES ($1,$2,1)
       ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = ${product.kind === 'durable' ? '1' : 'blox_entitlements.quantity + 1'}, updated_at = now()`,
      [userId, product.id]);
    /* Начисление — одно на покупку (уникальный индекс): повтор не удвоит заработок.
       Сумма станет доступной к выплате только после удержания. */
    await c.query(
      `INSERT INTO blox_earnings (developer_id, game_id, purchase_id, kind, gross_points, commission_points, amount_points, available_at, note)
       VALUES ($1,$2,$3,'purchase',$4,$5,$6, now() + ($7 || ' days')::interval, $8)`,
      [g.developer_id, g.id, purchaseId, price, commission, devPoints, String(l.holdDays), `Покупка «${product.title}»`]);
    return { ok: true, status: 'paid', points: spent.points, price };
  });
  return out;
};

export const cancelIntent = async (userId, purchaseId) => {
  if (!PURCHASE_ID_RE.test(String(purchaseId ?? ''))) return { error: 'not_found' };
  const { rowCount } = await query(`UPDATE blox_purchases SET status = 'failed', refund_reason = 'Отменено игроком' WHERE id = $1 AND user_id = $2 AND status = 'pending'`, [purchaseId, userId]);
  return rowCount ? { ok: true } : { error: 'not_found' };
};

/** Возврат баллов игроку и снятие начисления: одна транзакция, идемпотентно. */
const refundTx = async (c, pu, reason, actorId) => {
  const { rows } = await c.query('SELECT * FROM blox_purchases WHERE id = $1 FOR UPDATE', [pu.id]);
  const row = rows[0];
  if (row.status === 'refunded') return { ok: true, already: true };
  if (!['paid', 'fulfilled'].includes(row.status)) return { error: 'not_paid' };
  await wallet.creditPointsIn(c, row.user_id, row.price_points, 'blox_refund', `Sky Blox · возврат за покупку`, `blox:${row.id}:refund`);
  await c.query(`UPDATE blox_purchases SET status = 'refunded', refunded_at = now(), refund_reason = $2 WHERE id = $1`, [row.id, text(reason, 300)]);
  await c.query(
    `UPDATE blox_entitlements SET quantity = GREATEST(0, quantity - 1), updated_at = now() WHERE user_id = $1 AND product_id = $2`, [row.user_id, row.product_id]);
  const { rows: orig } = await c.query(`SELECT * FROM blox_earnings WHERE purchase_id = $1 AND kind = 'purchase'`, [row.id]);
  if (orig[0]) {
    // Возврат гасит начисление в тот же момент, когда оно стало бы доступным, — разность всегда ноль.
    await c.query(
      `INSERT INTO blox_earnings (developer_id, game_id, purchase_id, kind, gross_points, commission_points, amount_points, available_at, note, actor_id)
       VALUES ($1,$2,$3,'reversal',$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [orig[0].developer_id, orig[0].game_id, row.id, -orig[0].gross_points, -orig[0].commission_points, -orig[0].amount_points, orig[0].available_at, `Возврат: ${text(reason, 120)}`, actorId ?? null]);
  }
  return { ok: true };
};

export const adminRefund = async (actorId, purchaseId, reason, { meta = {} } = {}) => {
  if (!(await isFinance(actorId))) return { error: 'not_allowed' };
  if (!PURCHASE_ID_RE.test(String(purchaseId ?? ''))) return { error: 'not_found' };
  const why = text(reason, 300);
  if (why.length < 3) return { error: 'reason_required' };
  const { rows } = await query('SELECT * FROM blox_purchases WHERE id = $1', [purchaseId]);
  if (!rows[0]) return { error: 'not_found' };
  const r = await tx((c) => refundTx(c, rows[0], why, actorId));
  if (r.error) return r;
  await logAdmin({ actorId, targetId: purchaseId, targetType: 'blox_purchase', type: 'blox_purchase_refund', detail: why, meta });
  return { ok: true };
};

export const adminPurchases = async (actorId, { status } = {}) => {
  if (!(await isFinance(actorId)) && !(await can(actorId, 'blox'))) return { error: 'not_allowed' };
  const args = []; let where = '';
  if (status && ['pending', 'paid', 'fulfilled', 'refunded', 'expired', 'failed'].includes(status)) { args.push(status); where = 'WHERE pu.status = $1'; }
  const { rows } = await query(
    `SELECT pu.*, p.sku, p.title, p.price_points AS current_price, g.title AS game_title, u.username FROM blox_purchases pu
       JOIN blox_products p ON p.id = pu.product_id JOIN blox_games g ON g.id = pu.game_id JOIN profiles u ON u.id = pu.user_id
       ${where} ORDER BY pu.created_at DESC LIMIT 200`, args);
  return { items: rows.map((r) => ({ ...purchaseView(r), username: r.username, devPoints: r.dev_points, commissionPct: r.commission_pct == null ? null : Number(r.commission_pct) })) };
};

/* ═══ Платформенный API игровых серверов ═══════════════════════════ */

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/**
 * Проверка подписанного запроса игрового сервера.
 *
 * Канонический текст: МЕТОД \n ПУТЬ?ЗАПРОС \n ВРЕМЯ \n NONCE \n sha256(тело).
 * Подпись — HMAC-SHA256 секретом проекта. Время ±120 с; NONCE
 * одноразовый (повтор отклоняется), так что перехваченный запрос
 * нельзя воспроизвести. Секрет по сети не ходит.
 */
export const authenticateGame = async (req, rawBody, pathWithQuery) => {
  const keyId = String(req.headers['x-blox-key'] ?? '');
  const ts = Number(req.headers['x-blox-ts']);
  const nonce = String(req.headers['x-blox-nonce'] ?? '');
  const sig = String(req.headers['x-blox-sig'] ?? '').toLowerCase();
  if (!/^bk_[0-9a-f]{18}$/.test(keyId) || !Number.isFinite(ts) || !/^[A-Za-z0-9_-]{12,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) return { error: 'bad_auth' };
  const { rows } = await query(
    `SELECT g.*, d.status AS dev_status FROM blox_games g JOIN blox_developers d ON d.profile_id = g.developer_id WHERE g.key_id = $1`, [keyId]);
  const g = rows[0];
  if (!g) return { error: 'bad_auth' };
  const secret = decryptContent(g.secret_enc);
  const canonical = `${req.method}\n${pathWithQuery}\n${ts}\n${nonce}\n${crypto.createHash('sha256').update(rawBody ?? '').digest('hex')}`;
  if (!safeEq(sig, hmac(secret, canonical))) return { error: 'bad_signature' };
  if (Math.abs(Date.now() - ts) > 120_000) return { error: 'stale_request' };
  if (g.dev_status !== 'active' || ['blocked', 'archived'].includes(g.moderation_status)) return { error: 'game_disabled' };
  const rpm = await limit('apiRpmPerGame');
  if (!rateLimit(`blox:api:${g.id}`, rpm)) return { error: 'rate_limited' };
  const ins = await query('INSERT INTO blox_api_nonces (key_id, nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING', [keyId, nonce]);
  if (!ins.rowCount) return { error: 'replayed_request' };
  return { game: g };
};

export const pruneNonces = () => query(`DELETE FROM blox_api_nonces WHERE at < now() - interval '15 minutes'`);

/** Токен запуска → игрок. Токен одноразовый. */
export const apiVerifyToken = async (game, token) => {
  const p = readLaunchToken(token);
  if (!p || p.gid !== game.id) return { error: 'bad_token' };
  const { rows } = await query(`UPDATE blox_launches SET verified_at = now() WHERE jti = $1 AND game_id = $2 AND verified_at IS NULL RETURNING user_id, place_id`, [p.jti, game.id]);
  if (!rows[0]) return { error: 'token_used' };
  const playerId = playerIdFor(game.id, rows[0].user_id);
  await query(
    `INSERT INTO blox_players (game_id, player_id, user_id) VALUES ($1,$2,$3)
     ON CONFLICT (game_id, user_id) DO UPDATE SET verified_at = now()`, [game.id, playerId, rows[0].user_id]);
  const { rows: pr } = await query('SELECT name FROM profiles WHERE id = $1', [rows[0].user_id]);
  return { playerId, displayName: pr[0]?.name ?? '', placeId: rows[0].place_id, gameId: game.id };
};

const playerUser = async (game, playerId) => {
  const { rows } = await query(`SELECT user_id FROM blox_players WHERE game_id = $1 AND player_id = $2 AND verified_at > now() - interval '12 hours'`, [game.id, String(playerId ?? '')]);
  return rows[0]?.user_id ?? null;
};

export const apiProducts = async (game) => {
  const { rows } = await query('SELECT * FROM blox_products WHERE game_id = $1 AND active ORDER BY price_points', [game.id]);
  return { items: rows.map((r) => ({ sku: r.sku, title: r.title, description: r.description, price: r.price_points, kind: r.kind })) };
};

export const apiCreatePurchase = async (game, { playerId, sku, idempotencyKey } = {}) => {
  const s = await sellableGame(game.id);
  if (s.error) return s;
  const user = await playerUser(game, playerId);
  if (!user) return { error: 'unknown_player' };
  const r = await createIntent(user, s.game, sku, idempotencyKey);
  if (r.error) return r;
  return { purchaseId: r.purchaseId, status: r.status, confirmInSky: true, note: 'Игрок подтверждает покупку в интерфейсе Sky. Баланс сервер не меняет.' };
};

const ownPurchase = async (game, id) => {
  if (!PURCHASE_ID_RE.test(String(id ?? ''))) return null;
  const { rows } = await query('SELECT * FROM blox_purchases WHERE id = $1 AND game_id = $2', [id, game.id]);
  return rows[0] ?? null;
};

export const apiGetPurchase = async (game, id) => {
  const pu = await ownPurchase(game, id);
  if (!pu) return { error: 'not_found' };
  const { rows } = await query('SELECT sku FROM blox_products WHERE id = $1', [pu.product_id]);
  return { purchaseId: pu.id, status: pu.status, sku: rows[0]?.sku, price: pu.price_points, expiresAt: iso(pu.intent_expires_at), paidAt: iso(pu.paid_at), fulfilledAt: iso(pu.fulfilled_at) };
};

export const apiFulfill = async (game, id) => {
  const pu = await ownPurchase(game, id);
  if (!pu) return { error: 'not_found' };
  if (pu.status === 'fulfilled') return { ok: true, status: 'fulfilled', replay: true };
  const { rowCount } = await query(`UPDATE blox_purchases SET status = 'fulfilled', fulfilled_at = now() WHERE id = $1 AND status = 'paid'`, [id]);
  if (!rowCount) return { error: 'wrong_state', status: pu.status };
  return { ok: true, status: 'fulfilled' };
};

/** Игра сообщает, что выдать не смогла: оплаченную покупку возвращаем, неоплаченную закрываем. */
export const apiFail = async (game, id, reason) => {
  const pu = await ownPurchase(game, id);
  if (!pu) return { error: 'not_found' };
  if (pu.status === 'fulfilled') return { error: 'already_fulfilled' };
  if (pu.status === 'refunded') return { ok: true, status: 'refunded', replay: true };
  if (pu.status === 'pending') {
    await query(`UPDATE blox_purchases SET status = 'failed', refund_reason = $2 WHERE id = $1 AND status = 'pending'`, [id, text(reason, 200)]);
    return { ok: true, status: 'failed' };
  }
  if (pu.status !== 'paid') return { error: 'wrong_state', status: pu.status };
  const r = await tx((c) => refundTx(c, pu, `Техническая ошибка игры: ${text(reason, 150)}`, null));
  return r.error ? r : { ok: true, status: 'refunded' };
};

export const apiEntitlement = async (game, playerId, sku) => {
  const user = await playerUser(game, playerId);
  if (!user) return { error: 'unknown_player' };
  const { rows } = await query(
    `SELECT e.quantity, p.kind FROM blox_products p LEFT JOIN blox_entitlements e ON e.product_id = p.id AND e.user_id = $2 WHERE p.game_id = $1 AND p.sku = $3`,
    [game.id, user, String(sku ?? '')]);
  if (!rows[0]) return { error: 'product_not_found' };
  return { sku, owned: (rows[0].quantity ?? 0) > 0, quantity: rows[0].quantity ?? 0, kind: rows[0].kind };
};

/** Потратить расходуемый предмет. Атомарно; одноразовость запроса даёт nonce. */
export const apiConsume = async (game, { playerId, sku, amount } = {}) => {
  const n = Number(amount ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 1000) return { error: 'bad_amount' };
  const user = await playerUser(game, playerId);
  if (!user) return { error: 'unknown_player' };
  const { rows } = await query(
    `UPDATE blox_entitlements e SET quantity = quantity - $4, updated_at = now() FROM blox_products p
      WHERE e.product_id = p.id AND p.game_id = $1 AND p.sku = $2 AND p.kind = 'consumable' AND e.user_id = $3 AND e.quantity >= $4 RETURNING e.quantity`,
    [game.id, String(sku ?? ''), user, n]);
  if (!rows[0]) return { error: 'insufficient_quantity' };
  return { ok: true, quantity: rows[0].quantity };
};

/* ═══ Вознаграждения ═══════════════════════════════════════════════ */

/**
 * Сводка по разработчику. Все суммы выводятся из журнала начислений и
 * заявок; вымышленных чисел нет.
 *   начислено   — всё, что заработано (за вычетом возвратов и корректировок);
 *   удержано    — пока срок удержания не вышел;
 *   подтверждено — срок вышел;
 *   зарезервировано — под заявки в работе;
 *   выплачено   — заявки со статусом «выплачена»;
 *   доступно    — подтверждено − зарезервировано − выплачено.
 */
export const balancesFor = async (devId, client = null) => {
  const run = (sql, args) => (client ? client.query(sql, args) : query(sql, args));
  const { rows: e } = await run(
    `SELECT coalesce(sum(amount_points),0)::bigint AS total,
            coalesce(sum(amount_points) FILTER (WHERE available_at > now()),0)::bigint AS held,
            coalesce(sum(amount_points) FILTER (WHERE available_at <= now()),0)::bigint AS confirmed,
            coalesce(sum(commission_points),0)::bigint AS commission,
            coalesce(sum(gross_points),0)::bigint AS gross
       FROM blox_earnings WHERE developer_id = $1`, [devId]);
  const { rows: p } = await run(
    `SELECT coalesce(sum(amount_points) FILTER (WHERE status IN ('review','needs_info','approved','processing')),0)::bigint AS reserved,
            coalesce(sum(amount_points) FILTER (WHERE status = 'paid'),0)::bigint AS paid
       FROM blox_payouts WHERE developer_id = $1`, [devId]);
  const confirmed = Number(e[0].confirmed); const reserved = Number(p[0].reserved); const paid = Number(p[0].paid);
  return {
    accrued: Number(e[0].total), gross: Number(e[0].gross), commission: Number(e[0].commission),
    held: Number(e[0].held), confirmed, reserved, paid, available: Math.max(0, confirmed - reserved - paid),
  };
};

export const financeOverview = async (devId) => {
  const l = await loadLimits();
  const [balances, { rows: earn }, { rows: pay }] = await Promise.all([
    balancesFor(devId),
    query(`SELECT e.id, e.kind, e.gross_points, e.commission_points, e.amount_points, e.available_at, e.note, e.created_at, g.title AS game_title
             FROM blox_earnings e LEFT JOIN blox_games g ON g.id = e.game_id WHERE e.developer_id = $1 ORDER BY e.id DESC LIMIT 100`, [devId]),
    query('SELECT * FROM blox_payouts WHERE developer_id = $1 ORDER BY created_at DESC LIMIT 50', [devId]),
  ]);
  return {
    balances,
    rules: { commissionPercent: l.commissionPercent, holdDays: l.holdDays, minPayoutPoints: l.minPayoutPoints, payoutsEnabled: l.payoutsEnabled === 1, termsVersion: TERMS_VERSION },
    earnings: earn.map((r) => ({ id: r.id, kind: r.kind, gross: r.gross_points, commission: r.commission_points, amount: r.amount_points, availableAt: iso(r.available_at), held: new Date(r.available_at) > new Date(), note: r.note, gameTitle: r.game_title, at: iso(r.created_at) })),
    payouts: pay.map(payoutView),
  };
};

/* ═══ Заявки на выплату ════════════════════════════════════════════ */

const payoutView = (r) => ({
  id: r.id, amount: r.amount_points, status: r.status, requisitesTail: r.requisites_tail, adminComment: r.admin_comment,
  rejectReason: r.reject_reason, paidAt: iso(r.paid_at), paidRef: r.paid_ref, submittedAt: iso(r.submitted_at), createdAt: iso(r.created_at),
});

const cleanRequisites = (r) => {
  const method = text(r?.method, 40); const holder = text(r?.holder, 120); const account = text(r?.account, 80); const bank = text(r?.bank, 120);
  if (method.length < 2 || holder.length < 2 || account.length < 4) return null;
  return { method, holder, account, bank, note: text(r?.note, 200) };
};

export const payoutDraft = async (devId, { amount, requisites, payoutId } = {}) => {
  const a = Number(amount);
  if (!Number.isInteger(a) || a < 1) return { error: 'bad_amount' };
  const req = cleanRequisites(requisites);
  if (!req) return { error: 'bad_requisites' };
  const enc = encryptContent(JSON.stringify(req));
  const tail = req.account.slice(-4);
  if (payoutId) {
    if (!PAYOUT_ID_RE.test(String(payoutId))) return { error: 'not_found' };
    // Сумму меняет только черновик; после подачи она неизменна.
    const { rows } = await query(`UPDATE blox_payouts SET amount_points = $3, requisites_enc = $4, requisites_tail = $5, updated_at = now()
                                    WHERE id = $1 AND developer_id = $2 AND status = 'draft' RETURNING *`, [payoutId, devId, a, enc, tail]);
    return rows[0] ? { payout: payoutView(rows[0]) } : { error: 'locked' };
  }
  const { rows: open } = await query(`SELECT count(*)::int AS n FROM blox_payouts WHERE developer_id = $1 AND status IN ('draft','review','needs_info','approved','processing')`, [devId]);
  if (open[0].n >= 5) return { error: 'too_many_open' };
  const id = `bpo-${generateId()}`;
  const { rows } = await query(`INSERT INTO blox_payouts (id, developer_id, amount_points, requisites_enc, requisites_tail) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [id, devId, a, enc, tail]);
  await query(`INSERT INTO blox_payout_events (payout_id, actor_id, action, to_status) VALUES ($1,$2,'draft_created','draft')`, [id, devId]);
  return { payout: payoutView(rows[0]) };
};

/**
 * Подача заявки. В одной транзакции под замком разработчика: пересчёт
 * доступного остатка и перевод в «на рассмотрении» — то есть резерв
 * появляется атомарно, и две одновременные заявки на одни и те же
 * баллы невозможны.
 */
export const payoutSubmit = async (devId, payoutId, { idempotencyKey, acceptTerms } = {}) => {
  if (!PAYOUT_ID_RE.test(String(payoutId ?? ''))) return { error: 'not_found' };
  if (acceptTerms !== true) return { error: 'terms_required' };
  const l = await loadLimits();
  if (l.payoutsEnabled !== 1) return { error: 'payouts_disabled' };
  const ik = String(idempotencyKey ?? '');
  if (!/^[A-Za-z0-9_.:-]{8,80}$/.test(ik)) return { error: 'bad_idempotency_key' };
  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bloxpay:${devId}`]);
    const { rows } = await c.query('SELECT * FROM blox_payouts WHERE id = $1 AND developer_id = $2 FOR UPDATE', [payoutId, devId]);
    const po = rows[0];
    if (!po) return { error: 'not_found' };
    if (po.idem_key === ik && po.status !== 'draft') return { payout: payoutView(po), replay: true };
    if (!['draft', 'needs_info'].includes(po.status)) return { error: 'wrong_state' };
    if (!po.requisites_enc) return { error: 'bad_requisites' };
    if (po.amount_points < l.minPayoutPoints) return { error: 'below_minimum', min: l.minPayoutPoints };
    // Остаток считаем без этой заявки: если она в needs_info, её резерв уже учтён и перепроверяется честно.
    const b = await balancesFor(devId, c);
    const own = po.status === 'needs_info' ? po.amount_points : 0;
    if (po.amount_points > b.available + own) return { error: 'insufficient_available', available: b.available + own };
    let upd;
    try {
      upd = await c.query(`UPDATE blox_payouts SET status = 'review', idem_key = $2, terms_version = $3, submitted_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [payoutId, ik, TERMS_VERSION]);
    } catch (e) { if (e?.code === '23505') return { error: 'duplicate_request' }; throw e; }
    await c.query(`INSERT INTO blox_payout_events (payout_id, actor_id, action, from_status, to_status) VALUES ($1,$2,'submitted',$3,'review')`, [payoutId, devId, po.status]);
    return { payout: payoutView(upd.rows[0]) };
  });
};

/** Исправление реквизитов по запросу уточнений (сумма не меняется). */
export const payoutUpdateInfo = async (devId, payoutId, { requisites, comment } = {}) => {
  if (!PAYOUT_ID_RE.test(String(payoutId ?? ''))) return { error: 'not_found' };
  const req = cleanRequisites(requisites);
  if (!req) return { error: 'bad_requisites' };
  const { rows } = await query(`UPDATE blox_payouts SET requisites_enc = $3, requisites_tail = $4, status = 'review', updated_at = now()
                                  WHERE id = $1 AND developer_id = $2 AND status = 'needs_info' RETURNING *`, [payoutId, devId, encryptContent(JSON.stringify(req)), req.account.slice(-4)]);
  if (!rows[0]) return { error: 'wrong_state' };
  await query(`INSERT INTO blox_payout_events (payout_id, actor_id, action, from_status, to_status, comment) VALUES ($1,$2,'info_provided','needs_info','review',$3)`, [payoutId, devId, text(comment, 300)]);
  return { payout: payoutView(rows[0]) };
};

export const payoutCancel = async (devId, payoutId) => {
  if (!PAYOUT_ID_RE.test(String(payoutId ?? ''))) return { error: 'not_found' };
  const { rows } = await query(`UPDATE blox_payouts SET status = 'cancelled', updated_at = now() WHERE id = $1 AND developer_id = $2 AND status IN ('draft','review','needs_info') RETURNING status`, [payoutId, devId]);
  if (!rows[0]) return { error: 'wrong_state' };
  await query(`INSERT INTO blox_payout_events (payout_id, actor_id, action, to_status) VALUES ($1,$2,'cancelled','cancelled')`, [payoutId, devId]);
  return { ok: true };
};

export const payoutEvents = async (devId, payoutId) => {
  const { rows: o } = await query('SELECT developer_id FROM blox_payouts WHERE id = $1', [payoutId]);
  if (!o[0] || o[0].developer_id !== devId) return { error: 'not_found' };
  const { rows } = await query('SELECT action, from_status, to_status, comment, actor_role, created_at FROM blox_payout_events WHERE payout_id = $1 ORDER BY id DESC', [payoutId]);
  return { items: rows.map((r) => ({ action: r.action, from: r.from_status, to: r.to_status, comment: r.comment, by: r.actor_role, at: iso(r.created_at) })) };
};

/* ─── Финансовые сотрудники ────────────────────────────────────────── */

export const financeStepUp = async (actorId, meta) => {
  if (!(await isFinance(actorId))) return { error: 'not_allowed' };
  return beginStepUp(actorId, STEP_UP_PURPOSE, { meta });
};

export const adminPayouts = async (actorId, { status = 'review' } = {}) => {
  if (!(await isFinance(actorId))) return { error: 'not_allowed' };
  const args = []; let where = '';
  if (status !== 'all') { args.push(status); where = 'WHERE po.status = $1'; }
  const { rows } = await query(
    `SELECT po.*, d.display_name, p.username FROM blox_payouts po JOIN blox_developers d ON d.profile_id = po.developer_id JOIN profiles p ON p.id = po.developer_id
      ${where} ORDER BY po.submitted_at NULLS LAST, po.created_at LIMIT 200`, args);
  return { items: rows.map((r) => ({ ...payoutView(r), developerId: r.developer_id, developerName: r.display_name, username: r.username })) };
};

export const adminPayoutDetail = async (actorId, payoutId, { meta = {} } = {}) => {
  if (!(await isFinance(actorId))) return { error: 'not_allowed' };
  if (!PAYOUT_ID_RE.test(String(payoutId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT * FROM blox_payouts WHERE id = $1', [payoutId]);
  const po = rows[0];
  if (!po) return { error: 'not_found' };
  let requisites = null;
  try { requisites = JSON.parse(decryptContent(po.requisites_enc) || 'null'); } catch { /* повреждено */ }
  /* Полные реквизиты открываются явно и остаются в журнале. */
  await logAdmin({ actorId, targetId: payoutId, targetType: 'blox_payout', type: 'blox_payout_view', detail: `…${po.requisites_tail}`, meta });
  const b = await balancesFor(po.developer_id);
  const { rows: ev } = await query('SELECT action, from_status, to_status, comment, actor_role, created_at FROM blox_payout_events WHERE payout_id = $1 ORDER BY id DESC', [payoutId]);
  const { rows: earn } = await query(`SELECT kind, gross_points, commission_points, amount_points, available_at, created_at, note FROM blox_earnings WHERE developer_id = $1 ORDER BY id DESC LIMIT 50`, [po.developer_id]);
  return {
    payout: payoutView(po), requisites, developerId: po.developer_id, balances: b,
    earnings: earn.map((r) => ({ kind: r.kind, gross: r.gross_points, commission: r.commission_points, amount: r.amount_points, availableAt: iso(r.available_at), note: r.note, at: iso(r.created_at) })),
    history: ev.map((e) => ({ action: e.action, from: e.from_status, to: e.to_status, comment: e.comment, by: e.actor_role, at: iso(e.created_at) })),
  };
};

/**
 * Решения по заявке. «Одобрена» не означает «выплачена»: факт выплаты
 * вносится отдельно, с подтверждением личности сотрудника, ссылкой на
 * операцию и повторной проверкой суммы.
 */
export const adminPayoutAction = async (actorId, payoutId, action, input = {}, { meta = {} } = {}) => {
  if (!(await isFinance(actorId))) return { error: 'not_allowed' };
  if (!PAYOUT_ID_RE.test(String(payoutId ?? ''))) return { error: 'not_found' };
  const comment = text(input.comment, 500);
  const SPEC = {
    request_info: { from: ['review', 'approved'], to: 'needs_info', needText: true },
    approve:      { from: ['review'], to: 'approved' },
    start:        { from: ['approved'], to: 'processing' },
    reject:       { from: ['review', 'needs_info', 'approved', 'processing'], to: 'rejected', needText: true },
    paid:         { from: ['processing'], to: 'paid', step: true },
  }[action];
  if (!SPEC) return { error: 'bad_action' };
  if (SPEC.needText && comment.length < 3) return { error: 'reason_required' };
  /* Сначала состояние (без траты попытки подтверждения), потом личность. */
  const { rows: cur } = await query('SELECT status, developer_id FROM blox_payouts WHERE id = $1', [payoutId]);
  if (!cur[0]) return { error: 'not_found' };
  if (cur[0].developer_id === actorId) return { error: 'own_payout' };
  if (!SPEC.from.includes(cur[0].status)) return { error: 'wrong_state', status: cur[0].status };
  if (SPEC.step) {
    const ref = text(input.paidRef, 120);
    if (ref.length < 3) return { error: 'paid_ref_required' };
    const st = await consumeStepUp(actorId, STEP_UP_PURPOSE, input.stepUpCode, { meta });
    if (st.error) return st;
  }
  const result = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM blox_payouts WHERE id = $1 FOR UPDATE', [payoutId]);
    const po = rows[0];
    if (!po) return { error: 'not_found' };
    if (po.developer_id === actorId) return { error: 'own_payout' };
    if (!SPEC.from.includes(po.status)) return { error: 'wrong_state', status: po.status };
    if (action === 'paid') {
      /* Перед выплатой сумма проверяется заново: возвраты могли уменьшить
         подтверждённые начисления с момента одобрения. */
      const b = await balancesFor(po.developer_id, c);
      const others = b.reserved - po.amount_points;
      if (b.confirmed - b.paid - others < po.amount_points) return { error: 'insufficient_earnings', confirmed: b.confirmed };
      const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
      if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 86400_000) return { error: 'bad_date' };
      await c.query(`UPDATE blox_payouts SET status = 'paid', paid_by = $2, paid_at = $3, paid_ref = $4, paid_note = $5, updated_at = now() WHERE id = $1`,
        [payoutId, actorId, paidAt, text(input.paidRef, 120), comment]);
    } else {
      await c.query(
        `UPDATE blox_payouts SET status = $2, reviewer_id = $3, admin_comment = $4,
                reject_reason = CASE WHEN $2 = 'rejected' THEN $4 ELSE reject_reason END, updated_at = now() WHERE id = $1`,
        [payoutId, SPEC.to, actorId, comment]);
    }
    await c.query(`INSERT INTO blox_payout_events (payout_id, actor_id, actor_role, action, from_status, to_status, comment) VALUES ($1,$2,'staff',$3,$4,$5,$6)`,
      [payoutId, actorId, action, po.status, SPEC.to, action === 'paid' ? `${text(input.paidRef, 120)}${comment ? ` · ${comment}` : ''}` : comment]);
    return { ok: true, status: SPEC.to };
  });
  if (result.error) return result;
  await logAdmin({ actorId, targetId: payoutId, targetType: 'blox_payout', type: `blox_payout_${action}`, detail: `${SPEC.to}${comment ? ` · ${comment}` : ''}${action === 'paid' ? ` · ref ${text(input.paidRef, 120)}` : ''}`, meta });
  return result;
};

/** Корректировка начислений: только финансовый сотрудник, причина и подтверждение личности обязательны. */
export const adminAdjust = async (actorId, devId, amount, reason, stepUpCode, { meta = {} } = {}) => {
  if (!(await isFinance(actorId))) return { error: 'not_allowed' };
  if (devId === actorId) return { error: 'own_target' };
  const n = Number(amount);
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 10_000_000) return { error: 'bad_amount' };
  const why = text(reason, 300);
  if (why.length < 5) return { error: 'reason_required' };
  const st = await consumeStepUp(actorId, STEP_UP_PURPOSE, stepUpCode, { meta });
  if (st.error) return st;
  const r = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bloxpay:${devId}`]);
    const { rows } = await c.query('SELECT 1 FROM blox_developers WHERE profile_id = $1', [devId]);
    if (!rows[0]) return { error: 'not_found' };
    if (n < 0) {
      const b = await balancesFor(devId, c);
      if (b.available + n < 0) return { error: 'would_go_negative', available: b.available };
    }
    await c.query(
      `INSERT INTO blox_earnings (developer_id, kind, amount_points, available_at, note, actor_id) VALUES ($1,'adjustment',$2, now(), $3, $4)`,
      [devId, n, why, actorId]);
    return { ok: true };
  });
  if (r.error) return r;
  await logAdmin({ actorId, targetId: devId, targetType: 'blox_developer', type: 'blox_earnings_adjust', detail: `${n > 0 ? '+' : ''}${n} · ${why}`, meta });
  return r;
};

export const adminDeveloperFinance = async (actorId, devId) => {
  if (!(await isFinance(actorId))) return { error: 'not_allowed' };
  return financeOverview(devId);
};

export const adminEarningsSummary = async (actorId) => {
  if (!(await isFinance(actorId)) && !(await can(actorId, 'blox'))) return { error: 'not_allowed' };
  const { rows } = await query(
    `SELECT d.profile_id, d.display_name, p.username,
            coalesce(sum(e.amount_points),0)::int AS total,
            coalesce(sum(e.amount_points) FILTER (WHERE e.available_at > now()),0)::int AS held,
            coalesce(sum(e.commission_points),0)::int AS commission,
            coalesce(sum(e.gross_points),0)::int AS gross
       FROM blox_developers d JOIN profiles p ON p.id = d.profile_id LEFT JOIN blox_earnings e ON e.developer_id = d.profile_id
      GROUP BY d.profile_id, d.display_name, p.username ORDER BY total DESC LIMIT 200`);
  return { items: rows.map((r) => ({ developerId: r.profile_id, displayName: r.display_name, username: r.username, accrued: r.total, held: r.held, commission: r.commission, gross: r.gross })) };
};
