/**
 * SkyKassa — проверка сотрудниками, подтверждение владельцем, зачисление, возвраты.
 *
 * Сотрудник с правом `skykassa` проверяет заявку и передаёт её владельцу.
 * Зачислить деньги (или выпустить код) может только владелец и только после
 * подтверждения личности (step-up). Зачисление — одна транзакция под
 * блокировкой платежа; уникальный ключ skykassa_credits не даёт зачислить дважды.
 */
import { awardIn } from './cashbackrules.mjs';
import { query } from './db.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin, beginStepUp, consumeStepUp } from './adminsec.mjs';
import { notifyOwnerRequest } from './ownernotify.mjs';
import { wallet } from './wallet.mjs';
import { codeHash, generateCanonical, prettyCode } from './skycodes.mjs';
import { paymentView, senderPublic } from './skykassa.mjs';
import {
  STATUS_LABEL, STATUSES, KErr, newId, clean, iso, seal, open, mask, inTx,
  getSettings, transition, lockPayment, notifyOnce, rub,
} from './skykassacore.mjs';

export const CONFIRM_PURPOSE = 'skykassa_confirm';
export const SETTINGS_PURPOSE = 'skykassa_settings';

const isStaff = (actorId) => can(actorId, 'skykassa');

/* ─── Зачисление (общее для владельца и проверенного платежа партнёра) ─── */

/**
 * Довести платёж до «Успешно завершён». Платёж взят FOR UPDATE вызывающим.
 * Допустимые входные статусы: awaiting_owner (владелец), awaiting_payment (подтверждённый
 * партнёром платёж), error (повтор).
 */
export const confirmAndCredit = async (c, pay, { actorId = null, actorKind = 'system', reason = '' } = {}) => {
  if (pay.status === 'awaiting_owner' || pay.status === 'awaiting_payment') {
    await transition(c, pay, 'confirmed', { actorId, actorKind, reason: reason || 'Платёж подтверждён', set: { owner_id: actorKind === 'owner' ? actorId : null, confirmed_at: new Date() } });
  }
  await transition(c, pay, 'crediting', { actorKind: 'system', reason: 'Зачисление' });

  const amount = Number(pay.amount);
  const ref = `skykassa:${pay.id}`;
  const ins = await c.query(
    `INSERT INTO skykassa_credits (payment_id, user_id, amount, destination, wallet_ref)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (payment_id) DO NOTHING`,
    [pay.id, pay.user_id, amount, pay.destination, ref]);
  if (!ins.rowCount) throw new KErr('already_credited');

  const set = { credited_at: new Date() };
  if (pay.destination === 'balance') {
    const r = await wallet.creditIn(c, pay.user_id, amount, 'skykassa_topup', `Пополнение из SkyKassa ${pay.number}`, ref);
    if (r.error) throw new KErr(r.error);
    set.balance_after = r.balance;
    await awardIn(c, { trigger: 'wallet_topup', profileId: pay.user_id, amountRub: amount, ref: `skykassa:${pay.id}` });
    await c.query('UPDATE skykassa_credits SET balance_after = $2 WHERE payment_id = $1', [pay.id, r.balance]);
  } else {
    const s = await getSettings(c);
    const batchId = `scb-${newId('x').slice(2)}`.slice(0, 40);
    const codeId = `scd-${newId('x').slice(2)}`.slice(0, 40);
    const expires = new Date(Date.now() + s.codeTtlDays * 86_400_000);
    await c.query(
      `INSERT INTO sky_code_batches (id, title, note, reward_type, reward_amount, max_uses, expires_at, code_count, created_by)
       VALUES ($1,$2,$3,'balance',$4,1,$5,1,$6)`,
      [batchId, `SkyKassa ${pay.number}`, 'Выпущен SkyKassa после подтверждённого платежа', amount, expires, actorId]);
    let canonical = generateCanonical();
    for (let i = 0; i < 5; i += 1) {
      const r = await c.query(
        'INSERT INTO sky_codes (id, batch_id, code_hash, hint) VALUES ($1,$2,$3,$4) ON CONFLICT (code_hash) DO NOTHING',
        [codeId, batchId, codeHash(canonical), canonical.slice(-4)]);
      if (r.rowCount) break;
      canonical = generateCanonical();
      if (i === 4) throw new KErr('code_generation_failed');
    }
    set.code_id = codeId;
    set.code_sealed = seal({ code: prettyCode(canonical) });
    set.code_expires_at = expires;
    await c.query('UPDATE skykassa_credits SET wallet_ref = $2 WHERE payment_id = $1', [pay.id, `code:${codeId}`]);
  }
  await transition(c, pay, 'completed', { actorKind: 'system', reason: pay.destination === 'code' ? 'Код пополнения выпущен' : 'Средства зачислены', set });
  return pay;
};

/** Уведомить человека о завершении (без номеров карт и счетов). */
const notifyDone = async (pay) => {
  if (pay.destination === 'code') {
    await notifyOnce(pay.user_id, `${pay.id}:completed`, 'SkyKassa', `Платёж ${pay.number} подтверждён. Код пополнения на ${rub(pay.amount)} готов — он в карточке платежа.`);
  } else {
    await notifyOnce(pay.user_id, `${pay.id}:completed`, 'SkyKassa', `Средства зачислены: +${rub(pay.amount)} (заявка ${pay.number}).`);
  }
};
export const notifyCompleted = notifyDone;

/* ─── Шаги подтверждения личности ──────────────────────────────────── */

export const ownerStepUp = async (actorId, meta) => {
  if (!(await isOwner(actorId))) return { error: 'owner_only' };
  return beginStepUp(actorId, CONFIRM_PURPOSE, { meta });
};
export const settingsStepUp = async (actorId, meta) => {
  if (!(await can(actorId, 'skykassa_settings'))) return { error: 'not_allowed' };
  return beginStepUp(actorId, SETTINGS_PURPOSE, { meta });
};

/* ─── Очередь и карточка (сотрудники) ──────────────────────────────── */

export const queue = async (actorId, { status, q, limit = 50, offset = 0 } = {}) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  const args = []; const where = [];
  if (status && STATUSES.includes(status)) { args.push(status); where.push(`p.status = $${args.length}`); }
  const text = clean(q, 60);
  if (text) { args.push(`%${text.replace(/[%_\\]/g, '')}%`); where.push(`(p.number ILIKE $${args.length} OR pr.username ILIKE $${args.length} OR pr.name ILIKE $${args.length})`); }
  args.push(Math.min(Math.max(Number(limit) || 50, 1), 200), Math.max(Number(offset) || 0, 0));
  const { rows } = await query(
    `SELECT p.id, p.number, p.status, p.amount, p.currency, p.kind, p.destination, p.method_title, p.partner_title,
            p.app, p.created_at, p.reported_at, p.reviewer_id, pr.username, pr.name
       FROM skykassa_payments p JOIN profiles pr ON pr.id = p.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (p.status IN ('awaiting_review','awaiting_owner','refund_requested','error')) DESC, COALESCE(p.reported_at, p.created_at) DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
  const { rows: counts } = await query('SELECT status, count(*)::int AS n FROM skykassa_payments GROUP BY status');
  return {
    items: rows.map((r) => ({
      id: r.id, number: r.number, status: r.status, statusLabel: STATUS_LABEL[r.status], amount: Number(r.amount),
      currency: r.currency, kind: r.kind, destination: r.destination, methodTitle: r.method_title || r.partner_title,
      app: r.app, createdAt: iso(r.created_at), reportedAt: iso(r.reported_at), username: r.username, name: r.name,
      reviewerId: r.reviewer_id,
    })),
    counts: Object.fromEntries(counts.map((x) => [x.status, x.n])),
  };
};

export const detail = async (actorId, id, meta) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT * FROM skykassa_payments WHERE id = $1', [String(id).slice(0, 80)]);
  const pay = rows[0];
  if (!pay) return { error: 'not_found' };
  const view = await paymentView(pay, { staff: true });
  const [user, log, reviews, sender, changes] = await Promise.all([
    query('SELECT id, name, username FROM profiles WHERE id = $1', [pay.user_id]),
    query(`SELECT l.from_status, l.to_status, l.actor_kind, l.reason, l.created_at, p.username FROM skykassa_status_log l
             LEFT JOIN profiles p ON p.id = l.actor_id WHERE l.payment_id = $1 ORDER BY l.seq`, [pay.id]),
    query(`SELECT r.decision, r.note, r.created_at, p.username FROM skykassa_reviews r
             LEFT JOIN profiles p ON p.id = r.reviewer_id WHERE r.payment_id = $1 ORDER BY r.created_at`, [pay.id]),
    query('SELECT * FROM skykassa_sender WHERE payment_id = $1', [pay.id]),
    query(`SELECT c.reason, c.before_sealed, c.after_sealed, c.created_at, p.username FROM skykassa_sender_changes c
             LEFT JOIN profiles p ON p.id = c.author_id WHERE c.payment_id = $1 ORDER BY c.created_at`, [pay.id]),
  ]);
  let senderFull = null;
  if (sender.rows[0]) {
    const d = open(sender.rows[0].data_sealed);
    const first = open(sender.rows[0].submitted_sealed);
    senderFull = {
      ...senderPublic(sender.rows[0]), idNumber: d.idNumber ?? '', extra: d.extra ?? {},
      submitted: sender.rows[0].submitted_sealed ? { fio: first.fio, idKind: first.idKind, idNumber: first.idNumber, extra: first.extra ?? {} } : null,
      changes: changes.rows.map((x) => {
        const b = open(x.before_sealed); const a = open(x.after_sealed);
        return { at: iso(x.created_at), by: x.username, reason: x.reason, before: { fio: b.fio, idKind: b.idKind, idNumber: b.idNumber }, after: { fio: a.fio, idKind: a.idKind, idNumber: a.idNumber } };
      }),
    };
    await logAdmin({ actorId, targetId: pay.user_id, targetType: 'skykassa', type: 'skykassa_view_sender', detail: `Заявка ${pay.number}: просмотр данных отправителя`, meta });
  }
  const snap = open(pay.requisite_sealed);
  return {
    payment: { ...view, requisites: snap.recipient ? { methodTitle: snap.methodTitle, recipient: snap.recipient, bank: snap.bank, idKind: snap.idKind, identifier: mask(snap.tail), purpose: snap.purpose, amount: snap.amount } : null, sender: senderFull },
    user: user.rows[0] ?? null,
    reviewerId: pay.reviewer_id,
    statusLog: log.rows.map((x) => ({ from: x.from_status, to: x.to_status, kind: x.actor_kind, by: x.username, reason: x.reason, at: iso(x.created_at) })),
    reviews: reviews.rows.map((x) => ({ decision: x.decision, note: x.note, by: x.username, at: iso(x.created_at) })),
  };
};

/* ─── Действия сотрудников и владельца ─────────────────────────────── */

const note = (c, payId, actorId, decision, text) =>
  c.query('INSERT INTO skykassa_reviews (id, payment_id, reviewer_id, decision, note) VALUES ($1,$2,$3,$4,$5)', [newId('skr'), payId, actorId, decision, clean(text, 500)]);

const audit = (actorId, pay, type, detail, meta, result = 'ok') =>
  logAdmin({ actorId, targetId: pay.user_id, targetType: 'skykassa', type, detail: `${pay.number}: ${detail}`.slice(0, 280), result, meta });

/**
 * Одно действие над заявкой. action: take | request_info | forward | reject | owner_confirm |
 * owner_reject | owner_return | owner_retry
 */
export const act = async (actorId, id, action, body, meta) => {
  const owner = await isOwner(actorId);
  const staff = owner || await isStaff(actorId);
  if (!staff) return { error: 'not_allowed' };
  const ownerOnly = ['owner_confirm', 'owner_reject', 'owner_return', 'owner_retry'].includes(action);
  if (ownerOnly && !owner) return { error: 'owner_only' };
  const text = clean(body?.note ?? body?.reason ?? body?.message, 500);

  if (['request_info', 'reject', 'owner_reject'].includes(action) && text.length < 5) return { error: 'reason_required' };

  /* Подтверждение личности — до транзакции: код тратится один раз. */
  if (action === 'owner_confirm' || action === 'owner_retry') {
    const { rows } = await query('SELECT status FROM skykassa_payments WHERE id = $1', [String(id).slice(0, 80)]);
    const want = action === 'owner_confirm' ? 'awaiting_owner' : 'error';
    if (!rows[0]) return { error: 'not_found' };
    if (rows[0].status !== want) return { error: 'bad_state' };
    const step = await consumeStepUp(actorId, CONFIRM_PURPOSE, body?.stepUpCode, { meta });
    if (step.error) return step;
  }

  let after = null; let completed = false; let failed = null;
  try {
    after = await inTx(async (c) => {
      const pay = await lockPayment(c, String(id).slice(0, 80));
      if (!pay) throw new KErr('not_found');
      if (pay.user_id === actorId && !owner) throw new KErr('self_review');
      const s = pay.status;

      if (action === 'take') {
        if (s !== 'awaiting_review') throw new KErr('bad_state');
        await transition(c, pay, 'in_review', { actorId, actorKind: 'staff', reason: 'Взято в работу', set: { reviewer_id: actorId } });
        await note(c, pay.id, actorId, 'take', '');
      } else if (action === 'request_info') {
        if (s !== 'in_review' || (pay.reviewer_id !== actorId && !owner)) throw new KErr('bad_state');
        const mid = newId('skm');
        await c.query('INSERT INTO skykassa_messages (id, payment_id, author_id, from_staff, body) VALUES ($1,$2,$3,TRUE,$4)', [mid, pay.id, actorId, text]);
        await transition(c, pay, 'need_info', { actorId, actorKind: 'staff', reason: 'Запрошены сведения' });
        await note(c, pay.id, actorId, 'request_info', text);
        pay._mid = mid;
      } else if (action === 'forward') {
        if (s !== 'in_review' || (pay.reviewer_id !== actorId && !owner)) throw new KErr('bad_state');
        await transition(c, pay, 'awaiting_owner', { actorId, actorKind: 'staff', reason: 'Передано владельцу', set: { review_note: text } });
        await note(c, pay.id, actorId, 'forward', text);
      } else if (action === 'reject') {
        if (!['awaiting_review', 'in_review', 'need_info'].includes(s)) throw new KErr('bad_state');
        if (s !== 'awaiting_review' && pay.reviewer_id !== actorId && !owner) throw new KErr('bad_state');
        await transition(c, pay, 'rejected', { actorId, actorKind: 'staff', reason: text, set: { reject_reason: text, reviewer_id: pay.reviewer_id ?? actorId } });
        await note(c, pay.id, actorId, 'reject', text);
      } else if (action === 'owner_reject') {
        if (!['awaiting_owner', 'error'].includes(s)) throw new KErr('bad_state');
        await transition(c, pay, 'rejected', { actorId, actorKind: 'owner', reason: text, set: { reject_reason: text } });
        await note(c, pay.id, actorId, 'owner_reject', text);
      } else if (action === 'owner_return') {
        if (s !== 'awaiting_owner') throw new KErr('bad_state');
        await transition(c, pay, 'in_review', { actorId, actorKind: 'owner', reason: text || 'Возвращено на проверку' });
        await note(c, pay.id, actorId, 'owner_return', text);
      } else if (action === 'owner_confirm' || action === 'owner_retry') {
        if (s !== (action === 'owner_confirm' ? 'awaiting_owner' : 'error')) throw new KErr('bad_state');
        await confirmAndCredit(c, pay, { actorId, actorKind: 'owner', reason: text });
        await note(c, pay.id, actorId, 'owner_confirm', text);
        completed = true;
      } else throw new KErr('bad_action');
      return pay;
    });
  } catch (err) {
    if (!(err instanceof KErr)) {
      failed = err;
    } else if (['already_credited', 'code_generation_failed'].includes(err.kcode) || err.kcode === 'invalid_amount') {
      failed = err;
    } else {
      await audit(actorId, { user_id: null, number: String(id).slice(0, 12) }, `skykassa_${action}`, `отказ: ${err.kcode}`, meta, 'denied').catch(() => {});
      return { error: err.kcode, ...err.extra };
    }
  }
  if (failed) {
    /* Откат вернул платёж в прежний статус; фиксируем «Ошибка обработки» отдельной транзакцией. */
    console.error('[skykassa] зачисление не удалось:', failed.message);
    await inTx(async (c) => {
      const pay = await lockPayment(c, String(id).slice(0, 80));
      if (pay && ['awaiting_owner', 'error'].includes(pay.status)) {
        if (pay.status === 'awaiting_owner') await transition(c, pay, 'confirmed', { actorId, actorKind: 'owner', reason: 'Подтверждён владельцем', set: { owner_id: actorId, confirmed_at: new Date() } });
        await transition(c, pay, 'error', { actorKind: 'system', reason: 'Ошибка при зачислении', set: { error_text: clean(failed.kcode ?? failed.message, 200) } });
      }
    }).catch(() => {});
    await audit(actorId, { user_id: null, number: String(id).slice(0, 12) }, `skykassa_${action}`, `ошибка: ${failed.kcode ?? failed.message}`, meta, 'error').catch(() => {});
    return { error: 'processing_error' };
  }

  await audit(actorId, after, `skykassa_${action}`, text || STATUS_LABEL[after.status], meta);
  if (action === 'owner_confirm' || action === 'owner_retry') {
    if (completed) await notifyDone(after);
  } else if (action === 'forward') {
    await notifyOwnerRequest(actorId, `SkyKassa: заявка ${after.number} на ${rub(after.amount)} ждёт подтверждения`, after.id);
  } else if (action === 'request_info') {
    await notifyOnce(after.user_id, `${after.id}:need_info:${after._mid}`, 'SkyKassa', `По заявке ${after.number} нужны дополнительные сведения. Откройте платёж, чтобы ответить.`);
  } else if (action === 'reject' || action === 'owner_reject') {
    await notifyOnce(after.user_id, `${after.id}:rejected`, 'SkyKassa', `Заявка ${after.number} отклонена: ${text}`);
  } else if (action === 'take') {
    await notifyOnce(after.user_id, `${after.id}:in_review`, 'SkyKassa', `Заявка ${after.number} на проверке.`, { push: false });
  }
  return { ok: true, status: after.status, statusLabel: STATUS_LABEL[after.status] };
};

/* ─── Возвраты ─────────────────────────────────────────────────────── */

const refundedSum = async (c, payId, statuses) => {
  const { rows } = await c.query(
    'SELECT COALESCE(sum(amount),0)::bigint AS s FROM skykassa_refunds WHERE payment_id = $1 AND status = ANY($2::text[])', [payId, statuses]);
  return Number(rows[0].s);
};

export const requestRefund = async ({ actorId, asStaff }, id, body, meta) => {
  const reason = clean(body?.reason, 300);
  if (reason.length < 5) return { error: 'reason_required' };
  if (asStaff && !(await isStaff(actorId))) return { error: 'not_allowed' };
  let out;
  try {
    out = await inTx(async (c) => {
      const pay = await lockPayment(c, String(id).slice(0, 80));
      if (!pay || (!asStaff && pay.user_id !== actorId)) throw new KErr('not_found');
      if (!['completed', 'refunded_partial'].includes(pay.status)) throw new KErr('bad_state');
      const used = await refundedSum(c, pay.id, ['requested', 'processing', 'done']);
      const left = Number(pay.amount) - used;
      const amount = body?.amount == null ? left : Number(body.amount);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > left) throw new KErr('bad_amount', { left });
      if (pay.destination === 'code') {
        if (amount !== Number(pay.amount) || used > 0) throw new KErr('code_full_only');
        const { rows: u } = await c.query('SELECT 1 FROM sky_code_redemptions WHERE code_id = $1 LIMIT 1', [pay.code_id]);
        if (u.length) throw new KErr('code_already_used');
      }
      const rid = newId('skf');
      try {
        await c.query('INSERT INTO skykassa_refunds (id, payment_id, amount, reason, requested_by) VALUES ($1,$2,$3,$4,$5)', [rid, pay.id, amount, reason, actorId]);
      } catch (e) { if (e.code === '23505') throw new KErr('refund_open'); throw e; }
      await transition(c, pay, 'refund_requested', { actorId, actorKind: asStaff ? 'staff' : 'user', reason });
      pay._rid = rid; pay._amount = amount;
      return pay;
    });
  } catch (err) {
    if (err instanceof KErr) return { error: err.kcode, ...err.extra };
    throw err;
  }
  if (asStaff) await audit(actorId, out, 'skykassa_refund_request', `${rub(out._amount)}: ${reason}`, meta);
  await notifyOwnerRequest(actorId, `SkyKassa: запрошен возврат по заявке ${out.number} на ${rub(out._amount)}`, out.id);
  await notifyOnce(out.user_id, `${out.id}:refund_requested:${out._rid}`, 'SkyKassa', `Возврат по заявке ${out.number} запрошен.`, { push: false });
  return { ok: true, refundId: out._rid };
};

/** Владелец: process (списать зачисленное и перевести в обработку) | finish (деньги возвращены) | decline */
export const refundAct = async (actorId, id, refundId, action, body, meta) => {
  if (!(await isOwner(actorId))) return { error: 'owner_only' };
  const text = clean(body?.reason ?? body?.note, 300);
  if (action === 'decline' && text.length < 5) return { error: 'reason_required' };
  if (!['process', 'finish', 'decline'].includes(action)) return { error: 'bad_action' };
  if (action !== 'decline') {
    const step = await consumeStepUp(actorId, CONFIRM_PURPOSE, body?.stepUpCode, { meta });
    if (step.error) return step;
  }
  let pay;
  try {
    pay = await inTx(async (c) => {
      const p = await lockPayment(c, String(id).slice(0, 80));
      if (!p) throw new KErr('not_found');
      const { rows } = await c.query('SELECT * FROM skykassa_refunds WHERE id = $1 AND payment_id = $2 FOR UPDATE', [String(refundId).slice(0, 80), p.id]);
      const rf = rows[0];
      if (!rf) throw new KErr('not_found');
      const amount = Number(rf.amount);

      if (action === 'process') {
        if (rf.status !== 'requested' || p.status !== 'refund_requested') throw new KErr('bad_state');
        const ref = `skykassa-refund:${rf.id}`;
        if (p.destination === 'code') {
          const { rows: u } = await c.query('SELECT 1 FROM sky_code_redemptions WHERE code_id = $1 LIMIT 1', [p.code_id]);
          if (u.length) throw new KErr('code_already_used');
          await c.query("UPDATE sky_codes SET status = 'revoked', revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1", [p.code_id, actorId, `Возврат ${p.number}`]);
        } else {
          const r = await wallet.spendIn(c, p.user_id, amount, 'skykassa_refund', `Возврат SkyKassa ${p.number}`, ref);
          if (r.error) throw new KErr(r.error === 'insufficient_funds' ? 'refund_insufficient_funds' : r.error, { balance: r.balance });
        }
        await c.query("UPDATE skykassa_refunds SET status = 'processing', processed_by = $2, wallet_ref = $3, updated_at = now() WHERE id = $1", [rf.id, actorId, ref]);
        await transition(c, p, 'refund_processing', { actorId, actorKind: 'owner', reason: 'Возврат принят в обработку' });
      } else if (action === 'finish') {
        if (rf.status !== 'processing' || p.status !== 'refund_processing') throw new KErr('bad_state');
        await c.query("UPDATE skykassa_refunds SET status = 'done', processed_by = $2, updated_at = now() WHERE id = $1", [rf.id, actorId]);
        const done = await refundedSum(c, p.id, ['done']);
        await transition(c, p, done >= Number(p.amount) ? 'refunded_full' : 'refunded_partial', { actorId, actorKind: 'owner', reason: 'Возврат выполнен' });
      } else {
        if (rf.status !== 'requested' || p.status !== 'refund_requested') throw new KErr('bad_state');
        await c.query("UPDATE skykassa_refunds SET status = 'declined', decline_reason = $2, processed_by = $3, updated_at = now() WHERE id = $1", [rf.id, text, actorId]);
        const done = await refundedSum(c, p.id, ['done']);
        await transition(c, p, done > 0 ? 'refunded_partial' : 'completed', { actorId, actorKind: 'owner', reason: `Возврат отклонён: ${text}` });
      }
      p._amount = amount;
      return p;
    });
  } catch (err) {
    if (err instanceof KErr) return { error: err.kcode, ...err.extra };
    throw err;
  }
  await audit(actorId, pay, `skykassa_refund_${action}`, `${rub(pay._amount)} ${text}`.trim(), meta);
  const msg = { process: `Возврат по заявке ${pay.number} принят в обработку.`, finish: `Возврат по заявке ${pay.number} выполнен.`, decline: `Возврат по заявке ${pay.number} отклонён: ${text}` }[action];
  await notifyOnce(pay.user_id, `${pay.id}:refund_${action}:${refundId}`, 'SkyKassa', msg);
  return { ok: true, status: pay.status, statusLabel: STATUS_LABEL[pay.status] };
};
