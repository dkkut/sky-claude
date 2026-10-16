/**
 * SkyKassa — общее: статусы и переходы, настройки, шифрование, уведомления.
 *
 * Деньги — целые рубли, как в кошельке. Баланс один: кошелёк Sky. Статус меняет
 * только сервер, и только по таблице TRANSITIONS; каждый переход пишется в
 * skykassa_status_log. Данные карт/телефонов/счетов лежат зашифрованными.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { generateId } from './security.mjs';
import { notifyGift } from './giftnotify.mjs';
import { pushToOffline } from './webpush.mjs';

export const CURRENCY = 'RUB';
export const APPS = ['web', 'android', 'windows', 'ios', 'tv', 'console', 'car'];
export const DESTINATIONS = ['balance', 'code'];
export const ID_KINDS = ['card', 'phone', 'account', 'other'];

/** 19 статусов. Подписи — для человека; ключи — то, что хранит сервер. */
export const STATUS_LABEL = {
  created: 'Создан',
  awaiting_payment: 'Ожидает оплаты',
  user_reported: 'Пользователь сообщил об оплате',
  awaiting_review: 'Ожидает проверки',
  in_review: 'На проверке',
  awaiting_owner: 'Ожидает подтверждения владельца',
  confirmed: 'Подтверждён',
  crediting: 'Зачисление обрабатывается',
  completed: 'Успешно завершён',
  rejected: 'Отклонён',
  cancelled_user: 'Отменён пользователем',
  cancelled_system: 'Отменён системой',
  expired: 'Истёк срок действия',
  need_info: 'Требуются дополнительные сведения',
  refund_requested: 'Возврат запрошен',
  refund_processing: 'Возврат обрабатывается',
  refunded_partial: 'Возвращён частично',
  refunded_full: 'Возвращён полностью',
  error: 'Ошибка обработки',
};
export const STATUSES = Object.keys(STATUS_LABEL);

export const TRANSITIONS = {
  created: ['awaiting_payment', 'cancelled_user', 'cancelled_system', 'expired'],
  awaiting_payment: ['user_reported', 'confirmed', 'cancelled_user', 'cancelled_system', 'expired'],
  user_reported: ['awaiting_review', 'cancelled_system'],
  awaiting_review: ['in_review', 'need_info', 'rejected', 'cancelled_user'],
  in_review: ['awaiting_owner', 'need_info', 'rejected'],
  need_info: ['in_review', 'rejected', 'cancelled_user'],
  awaiting_owner: ['confirmed', 'rejected', 'in_review'],
  confirmed: ['crediting', 'error'],
  crediting: ['completed', 'error'],
  error: ['crediting', 'rejected'],
  completed: ['refund_requested'],
  refund_requested: ['refund_processing', 'completed', 'refunded_partial'],
  refund_processing: ['refunded_partial', 'refunded_full', 'completed'],
  refunded_partial: ['refund_requested'],
  rejected: [], cancelled_user: [], cancelled_system: [], expired: [], refunded_full: [],
};
export const TERMINAL = new Set(['rejected', 'cancelled_user', 'cancelled_system', 'expired', 'refunded_full']);
/** Статусы, когда платёж ещё можно оплатить (идёт срок действия). */
export const PAYABLE = new Set(['created', 'awaiting_payment']);

export const newId = (p) => `${p}-${generateId()}`;
const NUM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const newNumber = () => {
  let s = 'SK-';
  for (let i = 0; i < 8; i += 1) s += NUM_ALPHABET[crypto.randomInt(NUM_ALPHABET.length)];
  return s;
};

export const clean = (v, max) =>
  String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const isInt = (v) => Number.isSafeInteger(v);
export const iso = (d) => (d ? new Date(d).toISOString() : null);

export const seal = (obj) => encryptContent(JSON.stringify(obj ?? {}));
export const open = (blob) => { if (!blob) return {}; try { return JSON.parse(decryptContent(blob) ?? '{}'); } catch { return {}; } };

export const tail4 = (s) => String(s ?? '').replace(/[^0-9A-Za-zА-Яа-я]/g, '').slice(-4);
export const mask = (tail) => (tail ? `•••• ${tail}` : '••••');

/** Транзакция с откатом при любой ошибке. */
export const inTx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

export class KErr extends Error {
  constructor(code, extra = {}) { super(code); this.kcode = code; this.extra = extra; }
}

/* ─── Настройки ────────────────────────────────────────────────────── */

export const DEFAULT_SETTINGS = {
  paused: false,
  pauseMessage: '',
  notice: '',
  apps: Object.fromEntries(APPS.map((a) => [a, true])),
  minAmount: 100,
  maxAmount: 100000,
  ttlMinutes: 30,
  codeTtlDays: 30,
  partnersEnabled: true,
};

export const getSettings = async (c = null) => {
  const q = c ? c.query.bind(c) : query;
  const { rows } = await q("SELECT value FROM skykassa_settings WHERE key = 'main'");
  const v = rows[0]?.value ?? {};
  return {
    ...DEFAULT_SETTINGS, ...v,
    apps: { ...DEFAULT_SETTINGS.apps, ...(v.apps ?? {}) },
  };
};

export const saveSettings = async (actorId, patch) => {
  const cur = await getSettings();
  const next = { ...cur };
  const bad = (field) => ({ error: 'bad_field', field });
  if ('paused' in patch) next.paused = patch.paused === true;
  if ('pauseMessage' in patch) next.pauseMessage = clean(patch.pauseMessage, 300);
  if ('notice' in patch) next.notice = clean(patch.notice, 300);
  if ('partnersEnabled' in patch) next.partnersEnabled = patch.partnersEnabled === true;
  if ('apps' in patch && patch.apps && typeof patch.apps === 'object') {
    for (const a of APPS) if (a in patch.apps) next.apps[a] = patch.apps[a] === true;
  }
  for (const [k, lo, hi] of [['minAmount', 1, 10_000_000], ['maxAmount', 1, 10_000_000], ['ttlMinutes', 5, 1440], ['codeTtlDays', 1, 365]]) {
    if (k in patch) {
      const n = Number(patch[k]);
      if (!isInt(n) || n < lo || n > hi) return bad(k);
      next[k] = n;
    }
  }
  if (next.minAmount > next.maxAmount) return bad('maxAmount');
  await query(
    `INSERT INTO skykassa_settings (key, value, updated_by, updated_at) VALUES ('main', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(next), actorId]);
  return { settings: next };
};

/* ─── Переход статуса ──────────────────────────────────────────────── */

/**
 * Перевести платёж (строка уже взята FOR UPDATE этой же транзакцией).
 * Недопустимый переход — ошибка, а не молчаливое «как получится».
 */
export const transition = async (c, pay, to, { actorId = null, actorKind = 'system', reason = '', set = {} } = {}) => {
  if (!STATUS_LABEL[to]) throw new KErr('bad_status');
  if (!(TRANSITIONS[pay.status] ?? []).includes(to)) throw new KErr('bad_transition', { from: pay.status, to });
  const cols = ['status = $2', 'updated_at = now()'];
  const args = [pay.id, to];
  for (const [k, v] of Object.entries(set)) {
    if (!/^[a-z_]+$/.test(k)) throw new KErr('bad_column');
    args.push(v);
    cols.push(`${k} = $${args.length}`);
  }
  await c.query(`UPDATE skykassa_payments SET ${cols.join(', ')} WHERE id = $1`, args);
  await c.query(
    `INSERT INTO skykassa_status_log (id, payment_id, from_status, to_status, actor_id, actor_kind, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId('skl'), pay.id, pay.status, to, actorId, actorKind, clean(reason, 300)]);
  pay.status = to;
  Object.assign(pay, Object.fromEntries(Object.entries(set)));
  return pay;
};

export const lockPayment = async (c, id) => {
  const { rows } = await c.query('SELECT * FROM skykassa_payments WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ?? null;
};

/** Истёк срок — сразу фиксируем, в той же транзакции. Возвращает true, если истёк. */
export const expireIfDue = async (c, pay) => {
  if (!PAYABLE.has(pay.status) || new Date(pay.expires_at).getTime() > Date.now()) return false;
  /* Платёж уже создан у партнёра — срок ведёт партнёр; локально гасим лишь забытые (сутки сверху). */
  if (pay.partner_ref && Date.now() < new Date(pay.expires_at).getTime() + 86_400_000) return false;
  await transition(c, pay, 'expired', { actorKind: 'system', reason: 'Срок действия истёк' });
  return true;
};

/* ─── Уведомления (без полных номеров карт/счетов/телефонов) ───────── */

const sentBefore = async (userId, refId) => {
  const { rows } = await query(
    "SELECT 1 FROM gift_notifications WHERE user_id = $1 AND kind = 'skykassa' AND ref_id = $2 LIMIT 1", [userId, refId]);
  return rows.length > 0;
};

/** Одно событие — одно уведомление: повтор с тем же ключом молча пропускается. */
export const notifyOnce = async (userId, dedupe, title, body, { push = true } = {}) => {
  if (!userId) return false;
  try {
    if (await sentBefore(userId, dedupe)) return false;
    await notifyGift(userId, 'skykassa', title, body, dedupe);
    if (push) void pushToOffline([userId], { title, body, url: '/?skykassa=1', tag: `skykassa:${dedupe}` }).catch(() => {});
    return true;
  } catch (err) {
    console.error('[skykassa] уведомление:', err.message);
    return false;
  }
};

export const rub = (n) => `${Number(n).toLocaleString('ru-RU')} ₽`;
