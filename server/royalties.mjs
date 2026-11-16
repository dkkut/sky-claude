/**
 * Sky Royalties — авторские вознаграждения за прослушивания Sky Music (модель Pro Rata).
 *
 * Принципы (из задания и решений владельца):
 *  • Фонд = чистая выручка × процент. Prime: музыкальная доля стоимости (music_share_bp) минус налоги/комиссии/возвраты,
 *    затем prime_pool_bp (по умолчанию 15 %). Бесплатные: чистая рекламная выручка × ad_pool_bp. Фонды не смешиваются.
 *  • Вознаграждение трека = фонд сегмента × (прослушивания трека / все прослушивания сегмента). Сегмент = тип подписки × страна × период.
 *    Фиксированной цены прослушивания нет; цена «за прослушивание» — лишь следствие периода и в закрытый период не переносится.
 *  • Прослушивание считает сервер: «начало» и «конец» отмечаются отдельно, время между ними измеряет сервер, клиент секунды не присылает.
 *  • Подозрительное не отбрасывается по одному признаку: один признак — запись флага; два и больше — «на проверку». Деньги по ним
 *    удерживаются (held), а не теряются; решение сотрудника возвращает их автору или в нераспределённый остаток периода.
 *  • Баланс — только сумма журнала royalty_ledger (дописывается, правке и удалению не поддаётся). Деньги в копейках, расчёт — BigInt.
 *  • Закрытый период не меняется: выручка и расчётные поля начислений защищены триггерами; поправки идут отдельными записями журнала.
 *  • Выплата — только в кошелёк Sky (wallet.creditIn в одной транзакции со сменой статуса), подтверждает владелец с кодом.
 *    Внешние выплаты (банк, ЭДО, налоги за автора) здесь не имитируются: нужны договоры, проверка личности и платёжный партнёр.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { wallet } from './wallet.mjs';
import { hasPrime } from './skyid.mjs';
import { notifyGift } from './giftnotify.mjs';
import { effectiveRoyalty } from './musicroyalty.mjs';

const BP = 10000n;
const err = (e, extra = {}) => ({ error: e, ...extra });
export const monthOf = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const big = (v) => BigInt(v ?? 0);

/* ─── страна: то, что человек указал в профиле (геолокации по адресу в Sky нет) ───────────── */
const COUNTRY_NAMES = { россия: 'RU', russia: 'RU', 'рф': 'RU', беларусь: 'BY', белоруссия: 'BY', belarus: 'BY', казахстан: 'KZ', kazakhstan: 'KZ',
  украина: 'UA', ukraine: 'UA', армения: 'AM', armenia: 'AM', грузия: 'GE', georgia: 'GE', узбекистан: 'UZ', uzbekistan: 'UZ', кыргызстан: 'KG',
  киргизия: 'KG', азербайджан: 'AZ', молдова: 'MD', германия: 'DE', germany: 'DE', сша: 'US', usa: 'US', 'united states': 'US', турция: 'TR', turkey: 'TR' };
export const normalizeCountry = (raw) => {
  const s = String(raw ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return COUNTRY_NAMES[s.toLowerCase()] ?? 'ZZ';
};

/* ─── настройки ─────────────────────────────────────────────────────────────────────────── */
const FRAUD_DEFAULTS = { repeatPerDay: 12, dailyCap: 400, sharedDevices: 5, newAccountHours: 24, newAccountCardPlays: 20, concentrationMin: 60, concentrationShare: 0.9, metronomeRuns: 8 };
export const getSettings = async () => {
  const r = (await query('SELECT * FROM royalty_settings WHERE id=1')).rows[0];
  return {
    enabled: r.enabled, primePoolBp: r.prime_pool_bp, adPoolBp: r.ad_pool_bp, musicShareBp: r.music_share_bp,
    taxBp: r.tax_bp, storeBp: r.store_bp, paymentBp: r.payment_bp, minPayoutKopecks: Number(r.min_payout_kopecks), holdDays: r.hold_days,
    requireKyc: r.require_kyc, minListenSec: r.min_listen_sec, fraud: { ...FRAUD_DEFAULTS, ...(r.fraud ?? {}) }, updatedBy: r.updated_by, updatedAt: r.updated_at,
  };
};
const COLS = { enabled: 'enabled', primePoolBp: 'prime_pool_bp', adPoolBp: 'ad_pool_bp', musicShareBp: 'music_share_bp', taxBp: 'tax_bp', storeBp: 'store_bp',
  paymentBp: 'payment_bp', minPayoutKopecks: 'min_payout_kopecks', holdDays: 'hold_days', requireKyc: 'require_kyc', minListenSec: 'min_listen_sec' };
const BP_KEYS = new Set(['primePoolBp', 'adPoolBp', 'musicShareBp', 'taxBp', 'storeBp', 'paymentBp']);

/** Только владелец (проверяет маршрут) и с кодом. Закрытые периоды параметрами не меняются — у них свой снимок. */
export const saveSettings = async (actorId, patch = {}) => {
  const sets = []; const vals = []; const changed = {};
  const cur = await getSettings();
  for (const [k, col] of Object.entries(COLS)) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'enabled' || k === 'requireKyc') { if (typeof v !== 'boolean') return err('bad_value', { field: k }); }
    else if (v === null && (k === 'adPoolBp' || k === 'musicShareBp')) v = null;
    else { v = Number(v); if (!Number.isInteger(v) || v < 0) return err('bad_value', { field: k }); if (BP_KEYS.has(k) && v > 10000) return err('bad_value', { field: k }); }
    if (v !== cur[k]) { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); changed[k] = [cur[k], v]; }
  }
  if ('fraud' in patch && patch.fraud && typeof patch.fraud === 'object') {
    const f = { ...cur.fraud }; for (const k of Object.keys(FRAUD_DEFAULTS)) if (patch.fraud[k] != null && Number(patch.fraud[k]) > 0) f[k] = Number(patch.fraud[k]);
    sets.push(`fraud = $${vals.length + 1}::jsonb`); vals.push(JSON.stringify(f)); changed.fraud = true;
  }
  if (!sets.length) return { ok: true, changed: {} };
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`UPDATE royalty_settings SET ${sets.join(', ')}, updated_by = $${vals.length + 1}, updated_at = now() WHERE id = 1`, [...vals, actorId]);
    await audit(c, actorId, 'settings', 'royalty_settings', changed);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return { ok: true, changed };
};

/* ─── журнал критических действий (цепочка хешей) ─────────────────────────────────────────── */
/** Канонический вид (ключи по алфавиту): jsonb в базе хранит ключи в своём порядке, хеш от него не должен зависеть. */
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
export const audit = async (c, actorId, action, subject, detail = {}) => {
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['royalty_audit_chain']);
  const prev = (await c.query('SELECT hash FROM royalty_audit ORDER BY seq DESC LIMIT 1')).rows[0]?.hash ?? '';
  const at = new Date().toISOString();
  const body = JSON.stringify(canon({ at, actorId, action, subject, detail }));
  const hash = crypto.createHash('sha256').update(prev + body).digest('hex');
  await c.query('INSERT INTO royalty_audit (at, actor_id, action, subject, detail, prev_hash, hash) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)', [at, actorId, action, subject, JSON.stringify(detail), prev || null, hash]);
};
export const verifyAudit = async () => {
  const rows = (await query('SELECT seq, at, actor_id, action, subject, detail, prev_hash, hash FROM royalty_audit ORDER BY seq')).rows;
  let prev = '';
  for (const r of rows) {
    const body = JSON.stringify(canon({ at: new Date(r.at).toISOString(), actorId: r.actor_id, action: r.action, subject: r.subject, detail: r.detail }));
    if ((r.prev_hash ?? '') !== prev || crypto.createHash('sha256').update(prev + body).digest('hex') !== r.hash) return { ok: false, brokenAt: Number(r.seq) };
    prev = r.hash;
  }
  return { ok: true, entries: rows.length };
};

/* ─── баланс: сумма журнала ──────────────────────────────────────────────────────────────── */
const ledger = (c, holder, bucket, delta, kind, period, ref) =>
  c.query('INSERT INTO royalty_ledger (holder_id, bucket, delta, kind, period, ref) VALUES ($1,$2,$3,$4,$5,$6)', [holder, bucket, String(delta), kind, period, ref]);
export const balances = async (holder, c = null) => {
  const rows = (await (c ?? { query }).query('SELECT bucket, COALESCE(SUM(delta),0)::text AS s FROM royalty_ledger WHERE holder_id=$1 GROUP BY bucket', [holder])).rows;
  const out = { pending: 0n, available: 0n, held: 0n, unclaimed: 0n, reserved: 0n, paid: 0n };
  for (const r of rows) out[r.bucket] = BigInt(r.s);
  return out;
};
const num = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Number(v)]));

/* ─── прослушивания ──────────────────────────────────────────────────────────────────────── */
export const startListen = async (listenerId, trackId, playKey, { deviceHash = null } = {}) => {
  if (!KEY_RE.test(String(playKey ?? ''))) return err('bad_key');
  const t = (await query(`SELECT id, status, artist_card_id, duration_sec FROM music_tracks WHERE id=$1`, [String(trackId ?? '')])).rows[0];
  if (!t || t.status !== 'published') return err('not_found');
  const prof = (await query(`SELECT profile_extra->>'country' AS country FROM profiles WHERE id=$1`, [listenerId])).rows[0];
  const sub = (await hasPrime(listenerId)) ? 'prime' : 'free';
  const r = await query(
    `INSERT INTO royalty_plays (play_key, listener_id, track_id, card_id, period, country, sub_kind, device_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (listener_id, play_key) DO NOTHING RETURNING id`,
    [playKey, listenerId, t.id, t.artist_card_id, monthOf(), normalizeCountry(prof?.country), sub, deviceHash]);
  return { ok: true, duplicate: r.rowCount === 0 };
};

const detectSignals = async (play, s) => {
  const f = s.fraud; const flags = [];
  const day = (await query(
    `SELECT count(*) FILTER (WHERE track_id=$2)::int AS same, count(*)::int AS total
       FROM royalty_plays WHERE listener_id=$1 AND status IN ('valid','review') AND finished_at > now() - interval '24 hours'`, [play.listener_id, play.track_id])).rows[0];
  if (day.same + 1 > f.repeatPerDay) flags.push('repeat_track');
  if (day.total + 1 > f.dailyCap) flags.push('daily_cap');
  if (play.device_hash) {
    const d = (await query(`SELECT count(DISTINCT listener_id)::int AS n FROM royalty_plays WHERE device_hash=$1 AND started_at > now() - interval '30 days'`, [play.device_hash])).rows[0].n;
    if (d >= f.sharedDevices) flags.push('shared_device');
  }
  if (play.card_id) {
    const age = (await query(`SELECT created_at FROM profiles WHERE id=$1`, [play.listener_id])).rows[0]?.created_at;
    if (age && Date.now() - new Date(age).getTime() < f.newAccountHours * 3600_000) {
      const n = (await query(`SELECT count(*)::int AS n FROM royalty_plays WHERE listener_id=$1 AND card_id=$2 AND status IN ('valid','review')`, [play.listener_id, play.card_id])).rows[0].n;
      if (n + 1 > f.newAccountCardPlays) flags.push('new_account_burst');
    }
    const w = (await query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE card_id=$2)::int AS mine FROM royalty_plays WHERE listener_id=$1 AND status IN ('valid','review') AND finished_at > now() - interval '7 days'`, [play.listener_id, play.card_id])).rows[0];
    if (w.total >= f.concentrationMin && w.mine / w.total >= f.concentrationShare) flags.push('concentration');
  }
  const gaps = (await query(`SELECT finished_at FROM royalty_plays WHERE listener_id=$1 AND status IN ('valid','review') ORDER BY finished_at DESC LIMIT $2`, [play.listener_id, f.metronomeRuns + 1])).rows;
  if (gaps.length > f.metronomeRuns) {
    const d = []; for (let i = 0; i < gaps.length - 1; i++) d.push((new Date(gaps[i].finished_at) - new Date(gaps[i + 1].finished_at)) / 1000);
    if (d.every((x) => x >= s.minListenSec && x <= s.minListenSec + 3)) flags.push('metronome');
  }
  return flags;
};

/** Конец прослушивания: нужно прошедшее ВРЕМЯ (измеряет сервер). Слишком рано — ответ `too_early`, запись остаётся ждать. */
export const finishListen = async (listenerId, playKey) => {
  const s = await getSettings();
  const p = (await query(`SELECT * FROM royalty_plays WHERE listener_id=$1 AND play_key=$2`, [listenerId, String(playKey ?? '')])).rows[0];
  if (!p) return err('not_found');
  if (p.status !== 'started') return { ok: true, duplicate: true, status: p.status };
  const elapsed = (Date.now() - new Date(p.started_at).getTime()) / 1000;
  if (elapsed > 6 * 3600) { await query(`UPDATE royalty_plays SET status='abandoned' WHERE id=$1 AND status='started'`, [p.id]); return err('expired'); }
  const dur = Number((await query('SELECT duration_sec FROM music_tracks WHERE id=$1', [p.track_id])).rows[0]?.duration_sec ?? 0);
  const need = dur > 0 && dur < s.minListenSec ? Math.max(5, dur * 0.9) : s.minListenSec;
  if (elapsed < need) return err('too_early', { needSec: Math.ceil(need - elapsed) });
  // Правообладатель не может слушать «себя» за вознаграждение — это факт, а не подозрение.
  let owner = null;
  if (p.card_id) owner = (await query('SELECT owner_id FROM music_artist_cards WHERE id=$1', [p.card_id])).rows[0]?.owner_id ?? null;
  let status; let flags = [];
  if (owner && owner === listenerId) { status = 'invalid'; flags = ['self']; }
  else { flags = await detectSignals(p, s); status = flags.length >= 2 ? 'review' : 'valid'; }
  const upd = await query(`UPDATE royalty_plays SET status=$2, flags=$3, finished_at=now(), period=$4 WHERE id=$1 AND status='started' RETURNING id`, [p.id, status, flags, monthOf()]);
  return { ok: true, duplicate: upd.rowCount === 0, status };
};

/* ─── периоды и выручка ──────────────────────────────────────────────────────────────────── */
export const ensurePeriod = async (id, c = null) => {
  if (!PERIOD_RE.test(String(id ?? ''))) return err('bad_period');
  await (c ?? { query }).query('INSERT INTO royalty_periods (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
  return { ok: true };
};

/** Подсказка финансисту: сколько всего оплачено за Prime с кошелька за месяц (рубли → копейки). Это ориентир, не данные о выручке. */
export const suggestPrimeGross = async (period) => {
  if (!PERIOD_RE.test(String(period ?? ''))) return err('bad_period');
  const r = (await query(
    `SELECT COALESCE(SUM(-amount),0)::bigint AS s, count(*)::int AS n FROM wallet_transactions
      WHERE type='prime' AND amount < 0 AND to_char(created_at AT TIME ZONE 'UTC','YYYY-MM') = $1`, [period])).rows[0];
  return { period, grossKopecks: Number(r.s) * 100, operations: r.n, note: 'Оплаты Prime с кошелька за месяц (UTC); без внешних платежей, без возвратов, без налогов — ориентир для ввода' };
};

export const saveRevenue = async (actorId, { period, source, country = '*', grossKopecks, refundsKopecks = 0, note = '' } = {}) => {
  if (!PERIOD_RE.test(String(period ?? ''))) return err('bad_period');
  if (!['prime_music', 'ad_free'].includes(source)) return err('bad_source');
  const cc = country === '*' ? '*' : String(country ?? '').toUpperCase();
  if (cc !== '*' && !/^[A-Z]{2}$/.test(cc)) return err('bad_country');
  const g = Number(grossKopecks), rf = Number(refundsKopecks);
  if (!Number.isInteger(g) || g < 0 || !Number.isInteger(rf) || rf < 0) return err('bad_amount');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await ensurePeriod(period, c);
    const st = (await c.query('SELECT status FROM royalty_periods WHERE id=$1 FOR UPDATE', [period])).rows[0].status;
    if (st === 'closed') { await c.query('ROLLBACK'); return err('period_closed'); }
    const r = await c.query(
      `INSERT INTO royalty_revenue (period, source, country, gross_kopecks, refunds_kopecks, note, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (period, source, country) DO UPDATE SET gross_kopecks=$4, refunds_kopecks=$5, note=$6, entered_by=$7, status='draft', confirmed_by=NULL RETURNING id`,
      [period, source, cc, String(g), String(rf), String(note ?? '').slice(0, 300), actorId]);
    await audit(c, actorId, 'revenue_save', `${period}:${source}:${cc}`, { grossKopecks: g, refundsKopecks: rf });
    await c.query('COMMIT');
    return { ok: true, id: Number(r.rows[0].id) };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};

/** Подтверждает не тот, кто вводил (кроме владельца): две пары глаз на деньги. */
export const confirmRevenue = async (actorId, id, { owner = false } = {}) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = (await c.query('SELECT * FROM royalty_revenue WHERE id=$1 FOR UPDATE', [Number(id)])).rows[0];
    if (!r) { await c.query('ROLLBACK'); return err('not_found'); }
    if ((await c.query('SELECT status FROM royalty_periods WHERE id=$1', [r.period])).rows[0].status === 'closed') { await c.query('ROLLBACK'); return err('period_closed'); }
    if (r.entered_by === actorId && !owner) { await c.query('ROLLBACK'); return err('self_review'); }
    await c.query(`UPDATE royalty_revenue SET status='confirmed', confirmed_by=$2 WHERE id=$1`, [r.id, actorId]);
    await audit(c, actorId, 'revenue_confirm', `${r.period}:${r.source}:${r.country}`, { grossKopecks: Number(r.gross_kopecks) });
    await c.query('COMMIT');
    return { ok: true };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};

/** Фонд по строке выручки. null — не хватает параметров (доля музыки/процент фонда не заданы владельцем). */
export const fundOf = (line, s) => {
  const gross = big(line.gross_kopecks), refunds = big(line.refunds_kopecks);
  let net; let pool_bp;
  if (line.source === 'prime_music') {
    if (s.musicShareBp == null) return null;
    const music = gross * big(s.musicShareBp) / BP;
    net = music - music * big(s.taxBp + s.storeBp + s.paymentBp) / BP - refunds;
    pool_bp = s.primePoolBp;
  } else {
    if (s.adPoolBp == null) return null;
    net = gross - refunds; pool_bp = s.adPoolBp;
  }
  if (net < 0n) net = 0n;
  return { net, poolBp: pool_bp, fund: net * big(pool_bp) / BP };
};

/* ─── доли соавторов ─────────────────────────────────────────────────────────────────────── */
export const activeSplit = async (trackId, c = null) => {
  const q = c ?? { query };
  const sp = (await q.query(`SELECT id, version FROM royalty_splits WHERE track_id=$1 AND status='active'`, [trackId])).rows[0];
  if (!sp) return null;
  const parts = (await q.query('SELECT holder_id, bp FROM royalty_split_parts WHERE split_id=$1 ORDER BY holder_id', [sp.id])).rows;
  return { id: Number(sp.id), version: sp.version, parts: parts.map((p) => ({ holderId: p.holder_id, bp: p.bp })) };
};
const cardOwnerOfTrack = async (trackId, c = null) => (await (c ?? { query }).query(
  `SELECT t.artist_card_id AS card_id, k.owner_id FROM music_tracks t LEFT JOIN music_artist_cards k ON k.id = t.artist_card_id WHERE t.id=$1`, [trackId])).rows[0] ?? null;

export const proposeSplit = async (me, trackId, parts, note = '') => {
  const info = await cardOwnerOfTrack(String(trackId ?? ''));
  if (!info) return err('not_found');
  if (!info.owner_id || info.owner_id !== me) return err('not_rightsholder');
  const list = Array.isArray(parts) ? parts : [];
  if (list.length < 1 || list.length > 8) return err('bad_parts');
  const seen = new Set(); let sum = 0;
  for (const p of list) {
    const h = String(p?.holderId ?? ''); const bp = Number(p?.bp);
    if (!h || seen.has(h) || !Number.isInteger(bp) || bp < 1 || bp > 10000) return err('bad_parts');
    seen.add(h); sum += bp;
  }
  if (sum !== 10000) return err('sum_not_100', { sum });
  const ex = (await query('SELECT id FROM profiles WHERE id = ANY($1::text[])', [[...seen]])).rows.length;
  if (ex !== seen.size) return err('unknown_holder');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`royalty_split:${trackId}`]);
    if ((await c.query(`SELECT 1 FROM royalty_splits WHERE track_id=$1 AND status='proposed'`, [trackId])).rowCount) { await c.query('ROLLBACK'); return err('proposal_open'); }
    const act = await activeSplit(trackId, c);
    const ver = Number((await c.query('SELECT COALESCE(max(version),0)+1 AS v FROM royalty_splits WHERE track_id=$1', [trackId])).rows[0].v);
    const id = Number((await c.query(`INSERT INTO royalty_splits (track_id, version, proposed_by, note) VALUES ($1,$2,$3,$4) RETURNING id`, [trackId, ver, me, String(note ?? '').slice(0, 300)])).rows[0].id);
    for (const p of list) await c.query('INSERT INTO royalty_split_parts (split_id, holder_id, bp) VALUES ($1,$2,$3)', [id, p.holderId, p.bp]);
    // Принять должны все новые получатели и все действующие (или владелец карточки, если долей ещё не было).
    const need = new Set([...seen, ...(act ? act.parts.map((x) => x.holderId) : [info.owner_id])]);
    for (const h of need) await c.query('INSERT INTO royalty_split_ack (split_id, holder_id, accepted_at) VALUES ($1,$2,$3)', [id, h, h === me ? new Date() : null]);
    const done = await tryActivate(c, id, me);
    await audit(c, me, 'split_propose', `track:${trackId}`, { version: ver, parts: list, activated: done });
    await c.query('COMMIT');
    for (const h of need) if (h !== me) notifyGift(h, 'royalty', 'Предложение о долях роялти', 'Вас включили в распределение вознаграждения за трек. Откройте Sky Royalties, чтобы принять или отклонить.', `split:${id}`).catch(() => {});
    return { ok: true, splitId: id, version: ver, activated: done };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); if (e.code === '23505') return err('proposal_open'); throw e; } finally { c.release(); }
};
const tryActivate = async (c, splitId, actor) => {
  const left = (await c.query('SELECT count(*)::int AS n FROM royalty_split_ack WHERE split_id=$1 AND accepted_at IS NULL', [splitId])).rows[0].n;
  if (left > 0) return false;
  const sp = (await c.query('SELECT track_id FROM royalty_splits WHERE id=$1 FOR UPDATE', [splitId])).rows[0];
  await c.query(`UPDATE royalty_splits SET status='superseded' WHERE track_id=$1 AND status='active'`, [sp.track_id]);
  await c.query(`UPDATE royalty_splits SET status='active', activated_at=now() WHERE id=$1`, [splitId]);
  return true;
};
export const answerSplit = async (me, splitId, accept) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const sp = (await c.query('SELECT * FROM royalty_splits WHERE id=$1 FOR UPDATE', [Number(splitId)])).rows[0];
    if (!sp || sp.status !== 'proposed') { await c.query('ROLLBACK'); return err('not_found'); }
    const ack = (await c.query('SELECT accepted_at FROM royalty_split_ack WHERE split_id=$1 AND holder_id=$2', [sp.id, me])).rows[0];
    if (!ack) { await c.query('ROLLBACK'); return err('not_found'); }
    let activated = false;
    if (accept === true) {
      await c.query('UPDATE royalty_split_ack SET accepted_at = COALESCE(accepted_at, now()) WHERE split_id=$1 AND holder_id=$2', [sp.id, me]);
      activated = await tryActivate(c, sp.id, me);
    } else await c.query(`UPDATE royalty_splits SET status='rejected' WHERE id=$1`, [sp.id]);
    await audit(c, me, accept === true ? 'split_accept' : 'split_reject', `track:${sp.track_id}`, { splitId: Number(sp.id), activated });
    await c.query('COMMIT');
    return { ok: true, activated };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};
export const cancelSplit = async (me, splitId) => {
  const r = await query(`UPDATE royalty_splits SET status='rejected' WHERE id=$1 AND status='proposed' AND proposed_by=$2 RETURNING track_id`, [Number(splitId), me]);
  if (!r.rowCount) return err('not_found');
  await audit({ query }, me, 'split_cancel', `track:${r.rows[0].track_id}`, { splitId: Number(splitId) }).catch(() => {});
  return { ok: true };
};
export const splitHistory = async (me, trackId) => {
  const info = await cardOwnerOfTrack(String(trackId ?? ''));
  if (!info) return err('not_found');
  const act = await activeSplit(trackId);
  const allowed = info.owner_id === me || act?.parts.some((p) => p.holderId === me);
  const ver = (await query('SELECT id, version, status, proposed_by, note, created_at, activated_at FROM royalty_splits WHERE track_id=$1 ORDER BY version DESC', [trackId])).rows;
  const proposals = (await query(`SELECT s.id, s.version FROM royalty_splits s JOIN royalty_split_ack a ON a.split_id=s.id WHERE s.track_id=$1 AND s.status='proposed' AND a.holder_id=$2`, [trackId, me])).rows;
  if (!allowed && !proposals.length) return err('not_allowed');
  const out = [];
  for (const v of ver) {
    const parts = (await query('SELECT p.holder_id, p.bp, a.accepted_at FROM royalty_split_parts p LEFT JOIN royalty_split_ack a ON a.split_id=p.split_id AND a.holder_id=p.holder_id WHERE p.split_id=$1', [v.id])).rows;
    out.push({ id: Number(v.id), version: v.version, status: v.status, proposedBy: v.proposed_by, note: v.note, createdAt: v.created_at, activatedAt: v.activated_at, parts: parts.map((p) => ({ holderId: p.holder_id, bp: p.bp, accepted: !!p.accepted_at })) });
  }
  return { rightsholder: info.owner_id, active: act, versions: out };
};

/* ─── закрытие периода ───────────────────────────────────────────────────────────────────── */
const eligible = async (holder, cardId, cache) => {
  const k = `${holder}:${cardId}`;
  if (cache.has(k)) return cache.get(k);
  const enr = (await query(`SELECT status FROM royalty_enrollments WHERE profile_id=$1`, [holder])).rows[0];
  let ok = enr?.status === 'approved';
  if (ok && cardId) {
    const card = (await query('SELECT rights_verified_at FROM music_artist_cards WHERE id=$1', [cardId])).rows[0];
    ok = !!card?.rights_verified_at && (await effectiveRoyalty(cardId)).enabled;
  }
  cache.set(k, ok); return ok;
};

export const closePeriod = async (actorId, periodId, { asOf = new Date() } = {}) => {
  if (!PERIOD_RE.test(String(periodId ?? ''))) return err('bad_period');
  const s = await getSettings();
  if (!s.enabled) return err('disabled');
  if (periodId >= monthOf(asOf)) return err('period_not_finished');
  const lines = (await query(`SELECT * FROM royalty_revenue WHERE period=$1 AND status='confirmed'`, [periodId])).rows;
  if (!lines.length) return err('no_confirmed_revenue');
  const funds = [];
  for (const l of lines) { const f = fundOf(l, s); if (!f) return err('settings_incomplete', { source: l.source }); funds.push({ line: l, ...f }); }
  const cache = new Map();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await ensurePeriod(periodId, c);
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`royalty_close:${periodId}`]);
    const st = (await c.query('SELECT status FROM royalty_periods WHERE id=$1 FOR UPDATE', [periodId])).rows[0].status;
    if (st === 'closed') { await c.query('ROLLBACK'); return err('already_closed'); }
    await c.query(`UPDATE royalty_plays SET status='abandoned' WHERE period=$1 AND status='started'`, [periodId]);

    // Сегмент строки выручки: тип подписки + страна ('*' — все страны без собственной строки).
    const kindOf = { prime_music: 'prime', ad_free: 'free' };
    const segFund = new Map(); const countriesOf = { prime: new Set(), free: new Set() };
    for (const f of funds) { const k = kindOf[f.line.source]; const key = `${k}:${f.line.country}`; segFund.set(key, { ...f, kind: k, country: f.line.country, plays: 0n }); if (f.line.country !== '*') countriesOf[k].add(f.line.country); }
    const plays = (await c.query(
      `SELECT track_id, card_id, country, sub_kind, count(*) FILTER (WHERE status='valid')::bigint AS v, count(*) FILTER (WHERE status='review')::bigint AS r
         FROM royalty_plays WHERE period=$1 AND status IN ('valid','review') GROUP BY track_id, card_id, country, sub_kind`, [periodId])).rows;
    const trackSeg = new Map(); let unfunded = 0n;
    for (const p of plays) {
      const country = countriesOf[p.sub_kind].has(p.country) ? p.country : '*';
      const key = `${p.sub_kind}:${country}`;
      if (!segFund.has(key)) { unfunded += big(p.v) + big(p.r); continue; }
      segFund.get(key).plays += big(p.v) + big(p.r);
      const tk = `${key}|${p.track_id}`; const cur = trackSeg.get(tk) ?? { key, track: p.track_id, card: p.card_id, v: 0n, r: 0n };
      cur.v += big(p.v); cur.r += big(p.r); trackSeg.set(tk, cur);
    }
    let accruedAvail = 0n, heldTotal = 0n, unclaimedTotal = 0n, unattributed = 0n;
    const holdUntil = new Date(Date.now() + s.holdDays * 86400_000);
    for (const t of trackSeg.values()) {
      const sf = segFund.get(t.key); const T = sf.plays;
      const avail = sf.fund * t.v / T; const held = sf.fund * t.r / T;
      const split = await activeSplit(t.track, c);
      let parts = split?.parts;
      if (!parts) {
        const owner = (await c.query('SELECT owner_id FROM music_artist_cards WHERE id=$1', [t.card])).rows[0]?.owner_id ?? null;
        parts = owner ? [{ holderId: owner, bp: 10000 }] : [];
      }
      if (!parts.length) { unattributed += avail + held; continue; }
      for (const part of parts) {
        const a = avail * big(part.bp) / BP; const h = held * big(part.bp) / BP;
        if (a === 0n && h === 0n && t.r === 0n) continue;
        const ok = await eligible(part.holderId, t.card, cache);
        const state = ok ? 'pending' : 'unclaimed';
        const ins = await c.query(
          `INSERT INTO royalty_accruals (period, track_id, card_id, holder_id, seg_kind, seg_country, source, pool_bp, net_kopecks, fund_kopecks, seg_plays, track_plays, review_plays,
             split_bp, split_id, amount_kopecks, held_kopecks, review_left, state, release_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
          [periodId, t.track, t.card, part.holderId, sf.kind, sf.country, sf.line.source, sf.poolBp, String(sf.net), String(sf.fund), String(T), String(t.v + t.r), String(t.r),
           part.bp, split?.id ?? null, String(a), String(h), String(t.r), state, ok ? holdUntil : null]);
        const ref = `accrual:${ins.rows[0].id}`;
        if (a > 0n) await ledger(c, part.holderId, ok ? 'pending' : 'unclaimed', a, 'accrual', periodId, ref);
        if (h > 0n) await ledger(c, part.holderId, 'held', h, 'accrual_held', periodId, ref);
        accruedAvail += a; heldTotal += h; if (!ok) unclaimedTotal += a;
      }
    }
    const fundTotal = [...segFund.values()].reduce((x, f) => x + f.fund, 0n);
    const unallocated = fundTotal - accruedAvail - heldTotal;
    const recon = {
      fundTotal: String(fundTotal), accrued: String(accruedAvail), held: String(heldTotal), unclaimed: String(unclaimedTotal), unallocated: String(unallocated),
      unattributed: String(unattributed), reclaimed: '0', unfundedPlays: String(unfunded),
      segments: [...segFund.entries()].map(([k, f]) => ({ seg: k, source: f.line.source, net: String(f.net), poolBp: f.poolBp, fund: String(f.fund), plays: String(f.plays) })),
    };
    await c.query(`UPDATE royalty_periods SET status='closed', snapshot=$2::jsonb, recon=$3::jsonb, closed_by=$4, closed_at=now() WHERE id=$1`,
      [periodId, JSON.stringify({ settings: s, lines: lines.map((l) => ({ id: Number(l.id), source: l.source, country: l.country, gross: Number(l.gross_kopecks), refunds: Number(l.refunds_kopecks) })) }), JSON.stringify(recon), actorId]);
    await audit(c, actorId, 'period_close', periodId, { fundTotal: recon.fundTotal, accrued: recon.accrued, held: recon.held, unallocated: recon.unallocated });
    await c.query('COMMIT');
    return { ok: true, recon };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};

/** Сверка: фонд = начислено + удержано + нераспределено (+ возвращено по решениям проверки). */
export const reconcile = async (periodId) => {
  const p = (await query('SELECT status, recon FROM royalty_periods WHERE id=$1', [periodId])).rows[0];
  if (!p?.recon) return err('not_closed');
  const r = p.recon; const sum = (await query(`SELECT COALESCE(SUM(amount_kopecks),0)::text AS a, COALESCE(SUM(held_kopecks),0)::text AS h FROM royalty_accruals WHERE period=$1`, [periodId])).rows[0];
  const reclaimed = big(r.reclaimed);
  const heldNow = BigInt(sum.h);
  const total = BigInt(sum.a) + heldNow + big(r.unallocated) + reclaimed + (big(r.held) - heldNow - reclaimed >= 0n ? 0n : 0n);
  // Удержанное при закрытии (r.held) = ещё удержанное + выпущенное автору после проверки + возвращённое в остаток; выпущенное лежит в extra_kopecks.
  const extra = BigInt((await query('SELECT COALESCE(SUM(extra_kopecks),0)::text AS e FROM royalty_accruals WHERE period=$1', [periodId])).rows[0].e);
  const lhs = BigInt(sum.a) + heldNow + extra + big(r.unallocated) + reclaimed;
  return { ok: lhs === big(r.fundTotal), fundTotal: Number(big(r.fundTotal)), accrued: Number(BigInt(sum.a)), heldNow: Number(heldNow), releasedAfterReview: Number(extra), unallocated: Number(big(r.unallocated)), reclaimed: Number(reclaimed), diff: Number(lhs - big(r.fundTotal)), total: Number(total) };
};

/* ─── выпуск и подтверждение ─────────────────────────────────────────────────────────────── */
/** Начисления, у которых прошло время удержания, становятся доступными. Идемпотентно (условный UPDATE). */
export const releaseDue = async () => {
  const due = (await query(`SELECT id FROM royalty_accruals WHERE state='pending' AND release_at <= now() ORDER BY id LIMIT 500`)).rows;
  let n = 0;
  for (const d of due) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = (await c.query(`UPDATE royalty_accruals SET state='available' WHERE id=$1 AND state='pending' RETURNING holder_id, period, amount_kopecks, extra_kopecks`, [d.id])).rows[0];
      if (r) {
        const amt = BigInt(r.amount_kopecks) + BigInt(r.extra_kopecks);
        if (amt > 0n) { await ledger(c, r.holder_id, 'pending', -amt, 'release', r.period, `release:${d.id}`); await ledger(c, r.holder_id, 'available', amt, 'release', r.period, `release:${d.id}`); }
        n++;
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); } finally { c.release(); }
  }
  return { released: n };
};

/** Автор стал участником (заявка одобрена, права на карточке подтверждены) — «ожидающие допуска» начисления идут в обычный путь. */
export const claimUnclaimed = async (holder) => {
  const s = await getSettings(); const cache = new Map(); let n = 0;
  const rows = (await query(`SELECT id, card_id, period, amount_kopecks, extra_kopecks FROM royalty_accruals WHERE holder_id=$1 AND state='unclaimed' ORDER BY id`, [holder])).rows;
  for (const r of rows) {
    if (!(await eligible(holder, r.card_id, cache))) continue;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const u = await c.query(`UPDATE royalty_accruals SET state='pending', release_at=$2 WHERE id=$1 AND state='unclaimed' RETURNING id`, [r.id, new Date(Date.now() + s.holdDays * 86400_000)]);
      if (u.rowCount) { const amt = BigInt(r.amount_kopecks) + BigInt(r.extra_kopecks); if (amt > 0n) { await ledger(c, holder, 'unclaimed', -amt, 'claim', r.period, `claim:${r.id}`); await ledger(c, holder, 'pending', amt, 'claim', r.period, `claim:${r.id}`); } n++; }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); } finally { c.release(); }
  }
  return { claimed: n };
};

/* ─── проверка подозрительных прослушиваний ──────────────────────────────────────────────── */
export const reviewQueue = async ({ limit = 50 } = {}) => (await query(
  `SELECT listener_id, count(*)::int AS plays, array_agg(DISTINCT f) AS flags, min(started_at) AS first_at, max(finished_at) AS last_at, array_agg(id ORDER BY id) AS ids
     FROM royalty_plays, unnest(flags) f WHERE status='review' GROUP BY listener_id ORDER BY count(*) DESC LIMIT $1`, [Math.min(200, Math.max(1, Number(limit) || 50))])).rows
  .map((r) => ({ listenerId: r.listener_id, plays: r.plays, flags: r.flags, firstAt: r.first_at, lastAt: r.last_at, ids: r.ids.map(Number).slice(0, 500) }));

export const resolveReview = async (actorId, playIds, verdict, note = '') => {
  if (!['valid', 'invalid'].includes(verdict)) return err('bad_verdict');
  const ids = [...new Set((Array.isArray(playIds) ? playIds : []).map(Number).filter(Number.isInteger))].slice(0, 2000);
  if (!ids.length) return err('no_plays');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const rows = (await c.query(`SELECT id, track_id, period, country, sub_kind FROM royalty_plays WHERE id = ANY($1::bigint[]) AND status='review' FOR UPDATE`, [ids])).rows;
    if (!rows.length) { await c.query('ROLLBACK'); return err('not_found'); }
    await c.query(`UPDATE royalty_plays SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id = ANY($1::bigint[]) AND status='review'`, [rows.map((r) => r.id), verdict, actorId]);
    // Прослушивания закрытых периодов: освобождаем удержанное. Группа = период + трек + тип подписки + сегмент страны.
    const groups = new Map();
    for (const p of rows) { const k = `${p.period}|${p.track_id}|${p.sub_kind}|${p.country}`; groups.set(k, (groups.get(k) ?? 0) + 1); }
    let released = 0n, reclaimed = 0n;
    for (const [k, count] of groups) {
      const [period, track, kind, country] = k.split('|');
      if ((await c.query('SELECT status FROM royalty_periods WHERE id=$1', [period])).rows[0]?.status !== 'closed') continue;
      let segCountry = country;
      const has = (await c.query(`SELECT 1 FROM royalty_accruals WHERE period=$1 AND track_id=$2 AND seg_kind=$3 AND seg_country=$4 LIMIT 1`, [period, track, kind, country])).rowCount;
      if (!has) segCountry = '*';
      const acc = (await c.query(`SELECT * FROM royalty_accruals WHERE period=$1 AND track_id=$2 AND seg_kind=$3 AND seg_country=$4 AND review_left > 0 FOR UPDATE`, [period, track, kind, segCountry])).rows;
      for (const a of acc) {
        const left = BigInt(a.review_left); const k2 = BigInt(Math.min(Number(left), count));
        const heldPart = k2 >= left ? BigInt(a.held_kopecks) : BigInt(a.held_kopecks) * k2 / left;
        const validPart = verdict === 'valid' ? heldPart : 0n; const invalidPart = heldPart - validPart;
        await c.query('UPDATE royalty_accruals SET held_kopecks = held_kopecks - $2, review_left = review_left - $3, extra_kopecks = extra_kopecks + $4 WHERE id=$1', [a.id, String(heldPart), String(k2), String(validPart)]);
        if (heldPart > 0n) await ledger(c, a.holder_id, 'held', -heldPart, 'review_resolved', period, `review:${a.id}:${actorId}:${Date.now()}`);
        if (validPart > 0n) { await ledger(c, a.holder_id, a.state === 'available' ? 'available' : a.state === 'unclaimed' ? 'unclaimed' : 'pending', validPart, 'review_valid', period, `review:${a.id}:v`); released += validPart; }
        reclaimed += invalidPart;
      }
      if (reclaimed > 0n) await c.query(`UPDATE royalty_periods SET recon = jsonb_set(recon, '{reclaimed}', to_jsonb((COALESCE(recon->>'reclaimed','0')::bigint + $2::bigint)::text)) WHERE id=$1`, [period, String(reclaimed)]);
    }
    await audit(c, actorId, 'review_resolve', `plays:${rows.length}`, { verdict, note: String(note ?? '').slice(0, 200), released: String(released), reclaimed: String(reclaimed) });
    await c.query('COMMIT');
    return { ok: true, resolved: rows.length, released: Number(released), reclaimed: Number(reclaimed) };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};

/* ─── заявка автора, проверка личности ───────────────────────────────────────────────────── */
export const enrollmentChecks = async (me) => {
  const cards = (await query('SELECT id, rights_verified_at FROM music_artist_cards WHERE owner_id=$1 AND merged_into IS NULL AND NOT hidden', [me])).rows;
  const verified = cards.filter((c) => c.rights_verified_at).map((c) => c.id);
  const tracks = verified.length ? (await query(`SELECT count(*)::int AS n FROM music_tracks WHERE artist_card_id = ANY($1::text[]) AND status='published'`, [verified])).rows[0].n : 0;
  const created = (await query('SELECT created_at FROM profiles WHERE id=$1', [me])).rows[0]?.created_at;
  const ageDays = created ? Math.floor((Date.now() - new Date(created).getTime()) / 86400_000) : 0;
  const roy = []; for (const id of verified) roy.push((await effectiveRoyalty(id)).enabled);
  return { cards: cards.length, rightsVerifiedCards: verified.length, publishedTracks: tracks, accountAgeDays: ageDays, royaltyEnabledCards: roy.filter(Boolean).length };
};
const ckPass = (ch) => ch.rightsVerifiedCards > 0 && ch.publishedTracks > 0 && ch.royaltyEnabledCards > 0 && ch.accountAgeDays >= 7;
const ckReasons = (ch) => [
  ch.rightsVerifiedCards < 1 && 'Нет карточки музыканта с подтверждёнными правами',
  ch.publishedTracks < 1 && 'Нет опубликованных треков на такой карточке',
  ch.royaltyEnabledCards < 1 && 'Роялти не включено на карточке (включает владелец карточки)',
  ch.accountAgeDays < 7 && 'Аккаунту меньше 7 дней',
].filter(Boolean);

/** Заявка: систему проверяет сама. Подходит — одобряется; нет — «нужны данные» с причинами (сотрудник может решить вручную). */
export const applyEnrollment = async (me) => {
  const ch = await enrollmentChecks(me);
  const ok = ckPass(ch);
  const status = ok ? 'approved' : 'needs_info';
  const reason = ok ? null : ckReasons(ch).join('; ');
  await query(
    `INSERT INTO royalty_enrollments (profile_id, status, checks, reason, decided_by, decided_at) VALUES ($1,$2,$3::jsonb,$4,$5,now())
     ON CONFLICT (profile_id) DO UPDATE SET status = CASE WHEN royalty_enrollments.status='rejected' THEN 'rejected' ELSE $2 END, checks=$3::jsonb, reason=$4, decided_by=$5, decided_at=now()`,
    [me, status, JSON.stringify(ch), reason, ok ? 'system' : null]);
  const cur = (await query('SELECT status FROM royalty_enrollments WHERE profile_id=$1', [me])).rows[0].status;
  if (cur === 'approved') await claimUnclaimed(me);
  return { ok: true, status: cur, checks: ch, reasons: ok ? [] : ckReasons(ch), estimate: await estimateMonthly(me) };
};
export const decideEnrollment = async (actorId, profileId, status, reason = '') => {
  if (!['approved', 'rejected', 'needs_info'].includes(status)) return err('bad_status');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(`UPDATE royalty_enrollments SET status=$2, reason=$3, decided_by=$4, decided_at=now() WHERE profile_id=$1 RETURNING profile_id`, [profileId, status, String(reason ?? '').slice(0, 300), actorId]);
    if (!r.rowCount) { await c.query('ROLLBACK'); return err('not_found'); }
    await audit(c, actorId, 'enrollment_decide', profileId, { status, reason: String(reason ?? '').slice(0, 200) });
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  if (status === 'approved') await claimUnclaimed(profileId);
  notifyGift(profileId, 'royalty', 'Заявка на роялти', status === 'approved' ? 'Заявка одобрена.' : status === 'rejected' ? 'Заявка отклонена.' : 'Нужны дополнительные данные.', `enroll:${status}`).catch(() => {});
  return { ok: true };
};
export const submitKyc = async (me) => {
  await query(`INSERT INTO royalty_profiles (profile_id, kyc_status) VALUES ($1,'pending') ON CONFLICT (profile_id) DO UPDATE SET kyc_status = CASE WHEN royalty_profiles.kyc_status='verified' THEN 'verified' ELSE 'pending' END, updated_at=now()`, [me]);
  return { ok: true };
};
export const setKyc = async (actorId, profileId, status, note = '') => {
  if (!['pending', 'verified', 'rejected', 'none'].includes(status)) return err('bad_status');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`INSERT INTO royalty_profiles (profile_id, kyc_status, kyc_note, kyc_by, kyc_at) VALUES ($1,$2,$3,$4,now())
                   ON CONFLICT (profile_id) DO UPDATE SET kyc_status=$2, kyc_note=$3, kyc_by=$4, kyc_at=now(), updated_at=now()`, [profileId, status, String(note ?? '').slice(0, 300), actorId]);
    await audit(c, actorId, 'kyc_set', profileId, { status });
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return { ok: true };
};

/* ─── оценка месячного роялти (НЕ обещание) ──────────────────────────────────────────────── */
/** Опирается на настоящие прослушивания текущего месяца и на «стоимость прослушивания» последнего закрытого периода по тому же сегменту. Нет закрытого периода — «не рассчитано». */
export const estimateMonthly = async (me) => {
  const cards = (await query('SELECT id FROM music_artist_cards WHERE owner_id=$1 AND merged_into IS NULL', [me])).rows.map((r) => r.id);
  const period = monthOf();
  const mine = cards.length ? (await query(
    `SELECT sub_kind, country, count(*) FILTER (WHERE status='valid')::bigint AS v, count(*) FILTER (WHERE status='review')::bigint AS r
       FROM royalty_plays WHERE card_id = ANY($1::text[]) AND period=$2 AND status IN ('valid','review') GROUP BY sub_kind, country`, [cards, period])).rows : [];
  const plays = mine.reduce((a, r) => a + Number(r.v), 0);
  const last = (await query(`SELECT id, recon FROM royalty_periods WHERE status='closed' ORDER BY id DESC LIMIT 1`)).rows[0];
  if (!last) return { computed: false, reason: 'no_closed_period', period, plays, note: 'Оценка появится после первого закрытого отчётного периода: сумма зависит от фонда и числа всех прослушиваний.' };
  const segs = new Map((last.recon.segments ?? []).map((s) => [s.seg, s]));
  const now = new Date(); const dayOfMonth = now.getUTCDate(); const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const factor = days / Math.max(1, dayOfMonth);
  let kop = 0;
  for (const r of mine) {
    const seg = segs.get(`${r.sub_kind}:${r.country}`) ?? segs.get(`${r.sub_kind}:*`);
    if (!seg || !BigInt(seg.plays)) continue;
    kop += Number(BigInt(seg.fund)) / Number(BigInt(seg.plays)) * Number(r.v) * factor;
  }
  return { computed: true, period, basedOnPeriod: last.id, plays, estimateKopecks: Math.floor(kop), projected: dayOfMonth < days,
    note: 'Предположительная сумма: прослушивания этого месяца с расчётом на месяц целиком × стоимость прослушивания последнего закрытого периода. Итог зависит от фонда и прослушиваний других авторов и может отличаться.' };
};

/* ─── выплаты ────────────────────────────────────────────────────────────────────────────── */
export const requestPayout = async (me, idemKey) => {
  if (!KEY_RE.test(String(idemKey ?? ''))) return err('bad_key');
  const s = await getSettings();
  const enr = (await query('SELECT status FROM royalty_enrollments WHERE profile_id=$1', [me])).rows[0];
  if (enr?.status !== 'approved') return err('not_enrolled');
  if (s.requireKyc && (await query(`SELECT kyc_status FROM royalty_profiles WHERE profile_id=$1`, [me])).rows[0]?.kyc_status !== 'verified') return err('kyc_required');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`royalty_holder:${me}`]);
    const dup = (await c.query('SELECT id, status, amount_kopecks FROM royalty_payouts WHERE holder_id=$1 AND idem_key=$2', [me, idemKey])).rows[0];
    if (dup) { await c.query('ROLLBACK'); return { ok: true, duplicate: true, payoutId: dup.id, status: dup.status, amountKopecks: Number(dup.amount_kopecks) }; }
    if ((await c.query(`SELECT 1 FROM royalty_payouts WHERE holder_id=$1 AND status='requested'`, [me])).rowCount) { await c.query('ROLLBACK'); return err('payout_open'); }
    const b = await balances(me, c);
    const whole = (b.available / 100n) * 100n;
    if (whole < BigInt(s.minPayoutKopecks) || whole <= 0n) { await c.query('ROLLBACK'); return err('below_minimum', { availableKopecks: Number(b.available), minKopecks: s.minPayoutKopecks }); }
    const id = `rp-${crypto.randomBytes(10).toString('hex')}`;
    await c.query(`INSERT INTO royalty_payouts (id, holder_id, amount_kopecks, idem_key) VALUES ($1,$2,$3,$4)`, [id, me, String(whole), idemKey]);
    await ledger(c, me, 'available', -whole, 'payout_reserve', null, `payout:${id}:reserve`);
    await ledger(c, me, 'reserved', whole, 'payout_reserve', null, `payout:${id}:reserve`);
    await audit(c, me, 'payout_request', id, { amountKopecks: String(whole) });
    await c.query('COMMIT');
    return { ok: true, payoutId: id, amountKopecks: Number(whole) };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};

/** Решение по выплате: только владелец (проверяет маршрут, с кодом). Оплата — зачисление в кошелёк Sky в той же транзакции. */
export const decidePayout = async (actorId, payoutId, action, note = '') => {
  if (!['pay', 'reject'].includes(action)) return err('bad_action');
  const c = await pool.connect();
  let holder = null; let rub = 0;
  try {
    await c.query('BEGIN');
    const p = (await c.query('SELECT * FROM royalty_payouts WHERE id=$1 FOR UPDATE', [String(payoutId ?? '')])).rows[0];
    if (!p) { await c.query('ROLLBACK'); return err('not_found'); }
    if (p.status !== 'requested') { await c.query('ROLLBACK'); return { ok: true, duplicate: true, status: p.status }; }
    if (p.holder_id === actorId) { await c.query('ROLLBACK'); return err('self_review'); }
    const amt = BigInt(p.amount_kopecks); holder = p.holder_id;
    if (action === 'pay') {
      rub = Number(amt / 100n);
      await wallet.creditIn(c, p.holder_id, rub, 'royalty_payout', 'Sky Royalties · выплата авторского вознаграждения', `royalty:payout:${p.id}`);
      await ledger(c, p.holder_id, 'reserved', -amt, 'payout_paid', null, `payout:${p.id}:paid`);
      await ledger(c, p.holder_id, 'paid', amt, 'payout_paid', null, `payout:${p.id}:paid`);
      await c.query(`UPDATE royalty_payouts SET status='paid', decided_by=$2, decided_at=now(), note=$3 WHERE id=$1`, [p.id, actorId, String(note ?? '').slice(0, 200)]);
    } else {
      await ledger(c, p.holder_id, 'reserved', -amt, 'payout_return', null, `payout:${p.id}:return`);
      await ledger(c, p.holder_id, 'available', amt, 'payout_return', null, `payout:${p.id}:return`);
      await c.query(`UPDATE royalty_payouts SET status='rejected', decided_by=$2, decided_at=now(), note=$3 WHERE id=$1`, [p.id, actorId, String(note ?? '').slice(0, 200)]);
    }
    await audit(c, actorId, `payout_${action}`, p.id, { holder: p.holder_id, amountKopecks: String(amt) });
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  notifyGift(holder, 'royalty', action === 'pay' ? 'Выплата роялти' : 'Выплата отклонена', action === 'pay' ? `На кошелёк Sky зачислено ${rub} ₽.` : 'Заявка на выплату отклонена, сумма возвращена в доступные.', `payout:${payoutId}`).catch(() => {});
  return { ok: true };
};

/* ─── кабинет автора и обзор администрации ──────────────────────────────────────────────── */
export const cabinet = async (me) => {
  const [b, s, enr, prof] = await Promise.all([balances(me), getSettings(), query('SELECT status, reason, checks FROM royalty_enrollments WHERE profile_id=$1', [me]), query('SELECT kyc_status FROM royalty_profiles WHERE profile_id=$1', [me])]);
  const cards = (await query(`SELECT id, name, rights_verified_at, royalty_enabled FROM music_artist_cards WHERE owner_id=$1 AND merged_into IS NULL AND NOT hidden`, [me])).rows;
  const perTrack = (await query(
    `SELECT a.track_id, t.title, SUM(a.amount_kopecks + a.extra_kopecks)::text AS earned, SUM(a.held_kopecks)::text AS held FROM royalty_accruals a JOIN music_tracks t ON t.id=a.track_id
      WHERE a.holder_id=$1 GROUP BY a.track_id, t.title ORDER BY SUM(a.amount_kopecks + a.extra_kopecks) DESC LIMIT 100`, [me])).rows;
  const perPeriod = (await query(
    `SELECT period, SUM(amount_kopecks + extra_kopecks)::text AS amount, SUM(held_kopecks)::text AS held, SUM(CASE WHEN state='unclaimed' THEN amount_kopecks + extra_kopecks ELSE 0 END)::text AS unclaimed
       FROM royalty_accruals WHERE holder_id=$1 GROUP BY period ORDER BY period DESC LIMIT 24`, [me])).rows;
  const payouts = (await query('SELECT id, amount_kopecks, status, requested_at, decided_at, note FROM royalty_payouts WHERE holder_id=$1 ORDER BY requested_at DESC LIMIT 50', [me])).rows;
  const cur = monthOf();
  const plays = cards.length ? (await query(`SELECT count(*) FILTER (WHERE status='valid')::int AS valid, count(*) FILTER (WHERE status='review')::int AS review FROM royalty_plays WHERE card_id = ANY($1::text[]) AND period=$2`, [cards.map((c) => c.id), cur])).rows[0] : { valid: 0, review: 0 };
  return {
    enabled: s.enabled, balances: num(b), minPayoutKopecks: s.minPayoutKopecks, holdDays: s.holdDays, requireKyc: s.requireKyc,
    enrollment: enr.rows[0] ? { status: enr.rows[0].status, reason: enr.rows[0].reason } : null, kyc: prof.rows[0]?.kyc_status ?? 'none',
    cards: cards.map((c) => ({ id: c.id, name: c.name, rightsVerified: !!c.rights_verified_at, royaltyEnabled: c.royalty_enabled })),
    month: { period: cur, validPlays: plays.valid, reviewPlays: plays.review }, estimate: await estimateMonthly(me),
    tracks: perTrack.map((t) => ({ trackId: t.track_id, title: t.title, earnedKopecks: Number(t.earned), heldKopecks: Number(t.held) })),
    periods: perPeriod.map((p) => ({ period: p.period, amountKopecks: Number(p.amount), heldKopecks: Number(p.held), unclaimedKopecks: Number(p.unclaimed) })),
    payouts: payouts.map((p) => ({ id: p.id, amountKopecks: Number(p.amount_kopecks), status: p.status, requestedAt: p.requested_at, decidedAt: p.decided_at, note: p.note })),
  };
};

export const adminOverview = async () => {
  const s = await getSettings();
  const periods = (await query('SELECT id, status, recon, closed_at, closed_by FROM royalty_periods ORDER BY id DESC LIMIT 24')).rows;
  const revenue = (await query('SELECT id, period, source, country, gross_kopecks, refunds_kopecks, status, entered_by, confirmed_by, note FROM royalty_revenue ORDER BY period DESC, id DESC LIMIT 100')).rows;
  const payouts = (await query(`SELECT id, holder_id, amount_kopecks, status, requested_at FROM royalty_payouts ORDER BY (status='requested') DESC, requested_at DESC LIMIT 100`)).rows;
  const enrolls = (await query(`SELECT profile_id, status, reason, checks FROM royalty_enrollments ORDER BY (status IN ('new','needs_info')) DESC, created_at DESC LIMIT 100`)).rows;
  const kyc = (await query(`SELECT profile_id, kyc_status FROM royalty_profiles WHERE kyc_status='pending' LIMIT 100`)).rows;
  const stats = (await query(`SELECT count(*) FILTER (WHERE status='valid')::int AS valid, count(*) FILTER (WHERE status='review')::int AS review, count(*) FILTER (WHERE status='invalid')::int AS invalid FROM royalty_plays WHERE period=$1`, [monthOf()])).rows[0];
  return { settings: s, currentPeriod: monthOf(), stats, review: await reviewQueue({ limit: 30 }),
    periods: periods.map((p) => ({ id: p.id, status: p.status, closedAt: p.closed_at, closedBy: p.closed_by, recon: p.recon })),
    revenue: revenue.map((r) => ({ id: Number(r.id), period: r.period, source: r.source, country: r.country, grossKopecks: Number(r.gross_kopecks), refundsKopecks: Number(r.refunds_kopecks), status: r.status, enteredBy: r.entered_by, confirmedBy: r.confirmed_by, note: r.note })),
    payouts: payouts.map((p) => ({ id: p.id, holderId: p.holder_id, amountKopecks: Number(p.amount_kopecks), status: p.status, requestedAt: p.requested_at })),
    enrollments: enrolls, kycPending: kyc };
};
