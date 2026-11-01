/**
 * Email-коммуникации Sky: шаблоны, очередь отправки, рассылки, автоуведомления Prime и SkyMoney, адресная отправка из админки, статистика ОФД.
 *
 * Своей почты нет: письмо уходит через notify.sendEmail (тот же SMTP/Resend/webhook, что и коды входа). Здесь — только то, что вокруг:
 * очередь с повторами и защитой от дублей, отрисовка (emailtpl.mjs), проверка АКТУАЛЬНОГО состояния перед отправкой и учёт.
 * Платёжную и подписочную логику модуль не меняет: он ЧИТАЕТ уже совершённые операции (уборщиками), поэтому сбой почты не может сломать платёж.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { macOf } from './crypto.mjs';
import { sendEmail } from './notify.mjs';
import { PRIME_PRICES } from './skyid.mjs';
import { DEFAULT_TEMPLATES, renderNewsletter, renderPrime, renderMoney, VARIABLES, clean, safeUrl, heroStyleIds, senderNameOf } from './emailtpl.mjs';

const nid = (p) => `${p}-${crypto.randomBytes(10).toString('hex')}`;
const KINDS = ['newsletter', 'prime', 'money'];
const MAX_ATTEMPTS = 5;

/* ─── настройки ─── */
const DEFAULTS = {
  timezone: 'Europe/Moscow', primeAuto: false, moneyAuto: false, perMinute: 60,
  supportUrl: '', privacyUrl: '', ofdTaxRatePct: 6, ofdIncludeTopups: false,
};
let settingsCache = null; let settingsAt = 0;
export const getSettings = async () => {
  if (settingsCache && Date.now() - settingsAt < 5000) return settingsCache;
  const { rows } = await query(`SELECT key, value FROM email_settings`);
  const s = { ...DEFAULTS, autoSince: null };
  for (const r of rows) s[r.key] = r.value;
  settingsCache = s; settingsAt = Date.now();
  return s;
};
const setKey = async (key, value, by) => {
  await query(`INSERT INTO email_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [key, JSON.stringify(value), by]);
};
export const saveSettings = async (by, patch = {}) => {
  const cur = await getSettings();
  const out = {};
  if ('timezone' in patch) {
    try { new Intl.DateTimeFormat('ru', { timeZone: String(patch.timezone) }); out.timezone = String(patch.timezone); } catch { return { error: 'bad_timezone' }; }
  }
  for (const k of ['primeAuto', 'moneyAuto', 'ofdIncludeTopups']) if (k in patch) out[k] = patch[k] === true;
  if ('perMinute' in patch) { const n = Number(patch.perMinute); if (!Number.isInteger(n) || n < 1 || n > 600) return { error: 'bad_rate' }; out.perMinute = n; }
  if ('ofdTaxRatePct' in patch) { const n = Number(patch.ofdTaxRatePct); if (!(n >= 0 && n <= 100)) return { error: 'bad_rate' }; out.ofdTaxRatePct = n; }
  for (const k of ['supportUrl', 'privacyUrl']) if (k in patch) { const u = patch[k] ? safeUrl(patch[k]) : ''; if (patch[k] && !u) return { error: 'bad_url' }; out[k] = u; }
  // Деньги не рассылаем «задним числом»: автоотправка по SkyMoney считает только пополнения, зачисленные после включения.
  if (out.moneyAuto === true && !cur.moneyAuto) out.autoSince = new Date().toISOString();
  for (const [k, v] of Object.entries(out)) await setKey(k, v, by);
  settingsCache = null;
  return { settings: await getSettings() };
};
export const senderInfo = () => ({ mode: config.emailMode, from: config.emailFrom || '', configured: config.emailMode === 'log' ? false : !!config.emailFrom });

const ctxBase = async () => {
  const s = await getSettings();
  const app = config.publicOrigin || '';
  return { appUrl: app ? `${app}/` : '', supportUrl: s.supportUrl || (app ? `${app}/?open=support` : ''), privacyUrl: s.privacyUrl || (app ? `${app}/?open=privacy` : '') };
};

/* ─── токены ссылок ─── */
const sig = (label, v) => macOf(`email-${label}`, v).slice(0, 32);
export const unsubToken = (skyId) => `${skyId}.${sig('unsub', skyId)}`;
export const verifyUnsubToken = (t) => {
  const s = String(t || ''); const i = s.lastIndexOf('.'); if (i < 1) return null;
  const id = s.slice(0, i); const ok = crypto.timingSafeEqual(Buffer.from(sig('unsub', id)), Buffer.from(s.slice(i + 1).padEnd(32, '_').slice(0, 32)));
  return ok ? id : null;
};
export const receiptToken = (paymentId) => `${paymentId}.${sig('receipt', paymentId)}`;
export const verifyReceiptToken = (t) => {
  const s = String(t || ''); const i = s.lastIndexOf('.'); if (i < 1) return null;
  const id = s.slice(0, i); const ok = crypto.timingSafeEqual(Buffer.from(sig('receipt', id)), Buffer.from(s.slice(i + 1).padEnd(32, '_').slice(0, 32)));
  return ok ? id : null;
};

/* ─── шаблоны ─── */
export const ensureTemplates = async () => {
  for (const t of DEFAULT_TEMPLATES) {
    await query(`INSERT INTO email_templates (key, kind, name, subject, preheader, content, auto) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (key) DO NOTHING`,
      [t.key, t.kind, t.name, t.subject, t.preheader, JSON.stringify(t.content), t.auto]);
  }
};
export const listTemplates = async () => { await ensureTemplates(); const { rows } = await query(`SELECT * FROM email_templates ORDER BY kind, key`); return rows; };
const getTemplate = async (key) => { await ensureTemplates(); const { rows } = await query(`SELECT * FROM email_templates WHERE key = $1`, [key]); return rows[0] ?? null; };

const cleanContent = (c = {}) => {
  const o = {
    label: clean(c.label, 40), title: clean(c.title, 200), subtitle: clean(c.subtitle, 300), body: clean(c.body, 6000),
    imageUrl: c.imageUrl ? safeUrl(c.imageUrl) : '',
    cards: (Array.isArray(c.cards) ? c.cards : []).slice(0, 4).map((x) => ({ title: clean(x?.title, 80), text: clean(x?.text, 240) })).filter((x) => x.title || x.text),
    cta: { label: clean(c.cta?.label, 60), url: c.cta?.url ? safeUrl(c.cta.url) : '' },
    brand: clean(c.brand, 24).trim(),
    hero: heroStyleIds.includes(c.hero) ? c.hero : 'gradient', emoji: clean(c.emoji, 8).trim(), align: c.align === 'center' ? 'center' : 'left',
    // Своё оформление: HTML-файл администратора. Хранится как загружен (до 200 КБ), а чистится при КАЖДОЙ отрисовке — см. sanitizeEmailHtml.
    customHtml: typeof c.customHtml === 'string' ? clean(c.customHtml, 200_000) : '',
  };
  if (c.customHtml && String(c.customHtml).length > 200_000) return { error: 'design_too_big' };
  if (c.imageUrl && !o.imageUrl) return { error: 'bad_url' };
  if (c.cta?.url && !o.cta.url) return { error: 'bad_url' };
  return o;
};
export const saveTemplate = async (by, key, patch = {}) => {
  const t = await getTemplate(key); if (!t) return { error: 'not_found' };
  const content = 'content' in patch ? cleanContent({ ...t.content, ...patch.content }) : t.content;
  if (content.error) return content;
  const subject = 'subject' in patch ? clean(patch.subject, 200) : t.subject;
  if (!subject.trim()) return { error: 'subject_required' };
  const preheader = 'preheader' in patch ? clean(patch.preheader, 200) : t.preheader;
  const enabled = 'enabled' in patch ? patch.enabled === true : t.enabled;
  const auto = 'auto' in patch ? patch.auto === true : t.auto;
  const name = 'name' in patch ? clean(patch.name, 80) || t.name : t.name;
  await query(`UPDATE email_templates SET name=$2, subject=$3, preheader=$4, content=$5::jsonb, enabled=$6, auto=$7, updated_by=$8, updated_at=now() WHERE key=$1`,
    [key, name, subject, preheader, JSON.stringify(content), enabled, auto, by]);
  return { template: await getTemplate(key) };
};

/* ─── данные получателя ─── */
const person = async (profileId) => {
  const { rows } = await query(
    `SELECT p.id, p.name, p.username, p.sky_id, s.email, s.email_verified FROM profiles p LEFT JOIN sky_ids s ON s.id = p.sky_id WHERE p.id = $1`, [profileId]);
  return rows[0] ?? null;
};
export const maskEmail = (e) => { const m = String(e || '').match(/^(.)(.*)(@.+)$/); return m ? `${m[1]}${'•'.repeat(Math.min(5, m[2].length))}${m[3]}` : ''; };
export const isUnsubscribed = async (skyId) => !!skyId && (await query(`SELECT 1 FROM email_unsubscribes WHERE sky_id = $1`, [skyId])).rowCount > 0;

/* ─── форматирование ─── */
const fmtDate = (d, tz, withTime = false) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(d));
const dayKey = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
export const calendarDaysLeft = (expiresAt, now, tz) => Math.round((Date.parse(dayKey(expiresAt, tz)) - Date.parse(dayKey(now, tz))) / 86400000);
const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k > 1 && k < 5 ? b : k === 1 ? a : c; };
export const daysText = (d) => d <= 0 ? 'сегодня' : d === 1 ? 'завтра' : `${d} ${plural(d, 'день', 'дня', 'дней')}`;
const rub = (n) => `${Number(n).toLocaleString('ru-RU')} ₽`;
export const primeBucket = (d) => (d < 0 || d > 7 ? null : d === 0 ? 0 : d === 1 ? 1 : d <= 3 ? 3 : 7);

/* ─── данные для писем (только из БД) ─── */
const primeState = async (profileId) => {
  const { rows } = await query(`SELECT status, expires_at FROM prime_subscriptions WHERE profile_id = $1 AND status = 'active'`, [profileId]);
  if (!rows.length) return null;
  if (rows.some((r) => r.expires_at === null)) return { lifetime: true };
  return { lifetime: false, expiresAt: new Date(Math.max(...rows.map((r) => +new Date(r.expires_at)))) };
};
const primeVars = async (per, st, settings) => {
  const now = new Date(); const d = calendarDaysLeft(st.expiresAt, now, settings.timezone);
  const app = config.publicOrigin || '';
  return {
    username: per.name || per.username || '', subscription_name: 'Sky Prime', expiration_date: fmtDate(st.expiresAt, settings.timezone),
    days_remaining: daysText(d), renewal_amount: `${rub(PRIME_PRICES[30])} за 30 дней`, renewal_link: app ? `${app}/?open=prime` : '',
  };
};
const paymentOf = async (paymentId) => {
  const { rows } = await query(
    `SELECT p.id, p.number, p.user_id, p.amount, p.currency, p.fee, p.total, p.method_title, p.status, p.destination, p.credited_at, c.created_at AS credit_at
       FROM skykassa_payments p JOIN skykassa_credits c ON c.payment_id = p.id WHERE p.id = $1`, [paymentId]);
  return rows[0] ?? null;
};
const moneyVars = (per, pay, settings) => ({
  username: per.name || per.username || '', amount: Number(pay.amount).toLocaleString('ru-RU'), currency: pay.currency === 'RUB' ? '₽' : pay.currency,
  transaction_id: pay.number, payment_method: pay.method_title || 'SkyKassa', commission: rub(pay.fee || 0),
  total_amount: `${Number(pay.total).toLocaleString('ru-RU')} ${pay.currency === 'RUB' ? '₽' : pay.currency}`, transaction_date: fmtDate(pay.credit_at || pay.credited_at, settings.timezone, true),
});

/* ─── отрисовка ─── */
const renderRow = async (row, tpl, { forcedVars } = {}) => {
  const settings = await getSettings(); const base = await ctxBase();
  const per = row.profile_id ? await person(row.profile_id) : null;
  const ctx = { ...base, messageId: row.message_id, subject: tpl.subject, preheader: tpl.preheader };
  if (row.kind === 'newsletter') {
    const unsub = per?.sky_id ? `${base.appUrl.replace(/\/$/, '')}/api/email/unsubscribe?t=${encodeURIComponent(unsubToken(per.sky_id))}` : '';
    const content = { ...tpl.content, ...(row.payload?.content || {}) };
    if (content.cta && !content.cta.url) content.cta = { ...content.cta, url: base.appUrl };
    return renderNewsletter(content, { ...ctx, username: per?.name || per?.username || '', unsubUrl: row.payload?.noUnsub ? '' : unsub, subject: row.payload?.subject || tpl.subject, preheader: row.payload?.preheader ?? tpl.preheader });
  }
  const vars = forcedVars || row.payload?.vars || {};
  if (row.kind === 'prime') {
    const content = { ...tpl.content, cta: { ...tpl.content.cta, url: vars.renewal_link } };
    return renderPrime(content, vars, { ...ctx, variant: row.template_key === 'prime_renewed' ? 'renewed' : 'reminder' });
  }
  const origin = (config.publicOrigin || '').replace(/\/$/, '');
  return renderMoney(tpl.content, vars, { ...ctx, operationUrl: origin ? `${origin}/?open=wallet` : base.appUrl, receiptUrl: row.payload?.paymentId && origin ? `${origin}/api/email/receipt/${encodeURIComponent(receiptToken(row.payload.paymentId))}` : '' });
};

/* ─── очередь ─── */
export const enqueue = async ({ kind, templateKey, profileId, skyId = null, payload = {}, dedupeKey = null, manual = false, isTest = false, campaignId = null, createdBy = null, subject = '' }) => {
  if (!KINDS.includes(kind)) return { error: 'bad_kind' };
  const per = await person(profileId);
  if (!per) return { error: 'not_found' };
  const id = nid('eo'); const messageId = `sky-${crypto.randomBytes(9).toString('hex')}`;
  const r = await query(
    `INSERT INTO email_outbox (id, message_id, kind, template_key, campaign_id, profile_id, sky_id, email_mask, subject, payload, dedupe_key, manual, is_test, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [id, messageId, kind, templateKey, campaignId, profileId, skyId || per.sky_id, maskEmail(per.email), subject, JSON.stringify(payload), dedupeKey, manual, isTest, createdBy]);
  return r.rowCount ? { id, messageId } : { duplicate: true };
};
const finish = (id, status, err = '') => query(`UPDATE email_outbox SET status=$2, last_error=$3, sent_at = CASE WHEN $2='sent' THEN now() ELSE sent_at END WHERE id=$1`, [id, status, err]);

/** Проверяет актуальное состояние ПЕРЕД отправкой: устаревшее и ненастоящее не уходит. Возвращает { skip } или { vars }. */
const verifyBeforeSend = async (row, per, settings) => {
  if (row.kind === 'newsletter') {
    if (!row.is_test && row.sky_id && await isUnsubscribed(row.sky_id)) return { skip: 'unsubscribed' };
    return {};
  }
  if (row.kind === 'prime') {
    const st = await primeState(row.profile_id);
    if (row.template_key === 'prime_renewed') {
      if (!st) return { skip: 'no_active_subscription' };
      if (st.lifetime) return { skip: 'lifetime' };
      return { vars: await primeVars(per, st, settings) };
    }
    if (!st) return { skip: 'no_active_subscription' };
    if (st.lifetime) return { skip: 'lifetime' };
    const now = new Date(); const d = calendarDaysLeft(st.expiresAt, now, settings.timezone);
    if (st.expiresAt <= now) return { skip: 'expired' };
    const want = Number(String(row.template_key).match(/prime_(\d)d/)?.[1]);
    if (!row.manual && (row.payload?.expiry && +new Date(row.payload.expiry) !== +st.expiresAt)) return { skip: 'subscription_changed' };
    if (!row.manual && primeBucket(d) !== want) return { skip: 'stale' };
    return { vars: await primeVars(per, st, settings) };
  }
  const pay = await paymentOf(row.payload?.paymentId);
  if (!pay || pay.user_id !== row.profile_id || pay.destination !== 'balance' || !['completed', 'refunded_partial', 'refunded_full', 'refund_requested', 'refund_processing'].includes(pay.status)) return { skip: 'payment_not_credited' };
  return { vars: moneyVars(per, pay, settings) };
};

const backoffMin = (n) => Math.min(60, 2 ** n);
const deliver = async (row) => {
  const settings = await getSettings();
  const tpl = await getTemplate(row.template_key);
  if (!tpl) return finish(row.id, 'failed', 'template_missing');
  if (!tpl.enabled && !row.manual && !row.is_test) return finish(row.id, 'skipped', 'template_disabled');
  const per = await person(row.profile_id);
  if (!per) return finish(row.id, 'skipped', 'profile_deleted');
  if (!per.email || !per.email_verified) return finish(row.id, 'skipped', 'no_verified_email');
  const v = await verifyBeforeSend(row, per, settings);
  if (v.skip) return finish(row.id, 'skipped', v.skip);
  const out = await renderRow(row, tpl, { forcedVars: v.vars });
  const base = await ctxBase(); const host = (config.publicOrigin || 'sky.local').replace(/^https?:\/\//, '');
  const headers = { 'X-Sky-Message-ID': row.message_id, 'Message-ID': `<${row.message_id}@${host}>`, 'X-Auto-Response-Suppress': 'All', Precedence: 'bulk' };
  if (row.kind === 'newsletter' && per.sky_id && base.appUrl) {
    const u = `${base.appUrl.replace(/\/$/, '')}/api/email/unsubscribe?t=${encodeURIComponent(unsubToken(per.sky_id))}`;
    headers['List-Unsubscribe'] = `<${u}>`; headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  } else delete headers.Precedence;
  const subject = `${row.is_test ? '[Тест] ' : ''}${out.subject}`;
  const r = await sendEmail(per.email, subject, out.text, { html: out.html, headers, fromName: senderNameOf(row.kind, out.brand) });
  if (r.ok) { await query(`UPDATE email_outbox SET subject=$2 WHERE id=$1`, [row.id, subject.slice(0, 200)]); return finish(row.id, 'sent'); }
  const attempts = row.attempts + 1;
  if (r.error === 'email_not_configured' || attempts >= MAX_ATTEMPTS) return query(`UPDATE email_outbox SET status='failed', attempts=$2, last_error=$3 WHERE id=$1`, [row.id, attempts, r.error || 'send_failed']);
  return query(`UPDATE email_outbox SET status='pending', attempts=$2, last_error=$3, next_attempt_at = now() + ($4 || ' minutes')::interval WHERE id=$1`, [row.id, attempts, r.error || 'send_failed', String(backoffMin(attempts))]);
};

let working = false;
export const processOutbox = async () => {
  if (working) return 0; working = true;
  try {
    const settings = await getSettings(); const limit = Math.max(1, Math.min(100, Math.ceil(settings.perMinute / 3)));
    // зависшие «в отправке» (процесс упал) возвращаем в очередь
    await query(`UPDATE email_outbox SET status='pending' WHERE status='sending' AND next_attempt_at < now() - interval '10 minutes'`);
    const { rows } = await query(
      `UPDATE email_outbox SET status='sending', next_attempt_at = now() WHERE id IN (
         SELECT id FROM email_outbox WHERE status='pending' AND next_attempt_at <= now() ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *`, [limit]);
    for (const row of rows) { try { await deliver(row); } catch (e) { console.error('[email] сбой доставки:', e.message); await query(`UPDATE email_outbox SET status='pending', attempts=attempts+1, last_error=$2, next_attempt_at = now() + interval '5 minutes' WHERE id=$1 AND attempts < $3`, [row.id, String(e.message).slice(0, 120), MAX_ATTEMPTS]); await query(`UPDATE email_outbox SET status='failed' WHERE id=$1 AND attempts >= $2`, [row.id, MAX_ATTEMPTS]); } }
    return rows.length;
  } finally { working = false; }
};

/* ─── автоматика: Prime ─── */
export const sweepPrime = async () => {
  const s = await getSettings(); if (!s.primeAuto) return 0;
  const tpls = new Map((await listTemplates()).filter((t) => t.kind === 'prime' && t.enabled && t.auto).map((t) => [t.key, t]));
  const { rows } = await query(
    `SELECT profile_id, max(expires_at) AS exp FROM prime_subscriptions WHERE status='active' GROUP BY profile_id
     HAVING bool_and(expires_at IS NOT NULL) AND max(expires_at) BETWEEN now() AND now() + interval '9 days'`);
  let n = 0; const now = new Date();
  for (const r of rows) {
    const b = primeBucket(calendarDaysLeft(r.exp, now, s.timezone)); if (b === null) continue;
    const key = `prime_${b}d`; if (!tpls.has(key)) continue;
    const e = await enqueue({ kind: 'prime', templateKey: key, profileId: r.profile_id, payload: { expiry: new Date(r.exp).toISOString() }, dedupeKey: `prime:${r.profile_id}:${+new Date(r.exp)}:${b}` });
    if (e.id) n++;
  }
  // подтверждение продления: списание «Sky Prime» за последние сутки
  if (tpls.has('prime_renewed') || (await getTemplate('prime_renewed'))?.enabled) {
    const t = await getTemplate('prime_renewed');
    if (t?.enabled && t.auto) {
      const since = s.autoSince && s.autoSince > new Date(Date.now() - 864e5).toISOString() ? s.autoSince : new Date(Date.now() - 864e5).toISOString();
      const tx = await query(`SELECT id, user_id FROM wallet_transactions WHERE type='prime' AND amount < 0 AND created_at > $1`, [since]);
      for (const x of tx.rows) { const e = await enqueue({ kind: 'prime', templateKey: 'prime_renewed', profileId: x.user_id, payload: {}, dedupeKey: `primeren:${x.id}` }); if (e.id) n++; }
    }
  }
  return n;
};

/* ─── автоматика: SkyMoney ─── */
export const sweepMoney = async () => {
  const s = await getSettings(); if (!s.moneyAuto || !s.autoSince) return 0;
  const t = await getTemplate('money_topup'); if (!t?.enabled || !t.auto) return 0;
  const { rows } = await query(
    `SELECT p.id, p.user_id FROM skykassa_payments p JOIN skykassa_credits c ON c.payment_id = p.id
      WHERE p.destination='balance' AND p.status IN ('completed','refunded_partial','refunded_full') AND c.created_at > $1 AND c.created_at > now() - interval '2 days' LIMIT 200`, [s.autoSince]);
  let n = 0;
  for (const r of rows) { const e = await enqueue({ kind: 'money', templateKey: 'money_topup', profileId: r.user_id, payload: { paymentId: r.id }, dedupeKey: `money:${r.id}` }); if (e.id) n++; }
  return n;
};

/* ─── рассылки ─── */
const audienceRows = async (aud = {}, limit = 50000) => {
  const mode = ['all', 'prime', 'nonprime', 'list'].includes(aud.mode) ? aud.mode : 'all';
  const ids = Array.isArray(aud.ids) ? aud.ids.map(String).slice(0, 2000) : [];
  const params = []; let where = `s.email_verified AND s.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM email_unsubscribes u WHERE u.sky_id = s.id)`;
  if (mode === 'prime') where += ` AND EXISTS (SELECT 1 FROM prime_subscriptions ps WHERE ps.profile_id = p.id AND ps.status='active' AND (ps.expires_at IS NULL OR ps.expires_at > now()))`;
  if (mode === 'nonprime') where += ` AND NOT EXISTS (SELECT 1 FROM prime_subscriptions ps WHERE ps.profile_id = p.id AND ps.status='active' AND (ps.expires_at IS NULL OR ps.expires_at > now()))`;
  if (mode === 'list') { params.push(ids); where += ` AND p.id = ANY($1)`; }
  const { rows } = await query(`SELECT DISTINCT ON (s.id) p.id AS profile_id, s.id AS sky_id FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE ${where} ORDER BY s.id, p.created_at LIMIT ${Number(limit)}`, params);
  return rows;
};
export const audienceCount = async (aud) => (await audienceRows(aud)).length;

export const saveCampaign = async (by, id, b = {}) => {
  const content = cleanContent(b.content || {}); if (content.error) return content;
  const audience = { mode: ['all', 'prime', 'nonprime', 'list'].includes(b.audience?.mode) ? b.audience.mode : 'all', ids: Array.isArray(b.audience?.ids) ? b.audience.ids.map(String).slice(0, 2000) : [] };
  const f = { name: clean(b.name, 120) || 'Без названия', subject: clean(b.subject, 200), preheader: clean(b.preheader, 200), isTemplate: b.isTemplate === true };
  if (id) {
    const cur = (await query(`SELECT status FROM email_campaigns WHERE id=$1`, [id])).rows[0];
    if (!cur) return { error: 'not_found' }; if (!['draft', 'scheduled'].includes(cur.status)) return { error: 'locked' };
    await query(`UPDATE email_campaigns SET name=$2, subject=$3, preheader=$4, content=$5::jsonb, audience=$6::jsonb, is_template=$7, updated_at=now() WHERE id=$1`, [id, f.name, f.subject, f.preheader, JSON.stringify(content), JSON.stringify(audience), f.isTemplate]);
    return { id };
  }
  const nidc = nid('ec');
  await query(`INSERT INTO email_campaigns (id, name, subject, preheader, content, audience, is_template, created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`, [nidc, f.name, f.subject, f.preheader, JSON.stringify(content), JSON.stringify(audience), f.isTemplate, by]);
  return { id: nidc };
};
export const listCampaigns = async () => (await query(
  `SELECT c.*, (SELECT count(*) FROM email_outbox o WHERE o.campaign_id = c.id AND o.status='sent')::int AS sent,
          (SELECT count(*) FROM email_outbox o WHERE o.campaign_id = c.id AND o.status='failed')::int AS failed,
          (SELECT count(*) FROM email_outbox o WHERE o.campaign_id = c.id AND o.status='skipped')::int AS skipped,
          (SELECT count(*) FROM email_outbox o WHERE o.campaign_id = c.id AND o.status IN ('pending','sending'))::int AS pending
     FROM email_campaigns c ORDER BY c.created_at DESC LIMIT 100`)).rows;
export const getCampaign = async (id) => (await query(`SELECT * FROM email_campaigns WHERE id=$1`, [id])).rows[0] ?? null;
export const deleteCampaign = async (id) => { const c = await getCampaign(id); if (!c) return { error: 'not_found' }; if (!['draft', 'cancelled'].includes(c.status) && !c.is_template) return { error: 'locked' }; await query(`DELETE FROM email_campaigns WHERE id=$1`, [id]); return { ok: true }; };

export const scheduleCampaign = async (id, whenIso) => {
  const c = await getCampaign(id); if (!c) return { error: 'not_found' };
  if (!['draft', 'scheduled'].includes(c.status)) return { error: 'locked' };
  if (!c.subject.trim() || !c.content?.title) return { error: 'incomplete' };
  const t = whenIso ? new Date(whenIso) : new Date();
  if (Number.isNaN(+t)) return { error: 'bad_date' };
  await query(`UPDATE email_campaigns SET status='scheduled', scheduled_at=$2, updated_at=now() WHERE id=$1`, [id, t.toISOString()]);
  return { ok: true };
};
export const cancelCampaign = async (id) => {
  const c = await getCampaign(id); if (!c) return { error: 'not_found' };
  if (!['scheduled', 'sending'].includes(c.status)) return { error: 'locked' };
  await query(`UPDATE email_outbox SET status='skipped', last_error='cancelled' WHERE campaign_id=$1 AND status='pending'`, [id]);
  await query(`UPDATE email_campaigns SET status='cancelled', finished_at=now(), updated_at=now() WHERE id=$1`, [id]);
  return { ok: true };
};
const launch = async (c) => {
  const claimed = await query(`UPDATE email_campaigns SET status='sending', started_at=now() WHERE id=$1 AND status='scheduled' RETURNING id`, [c.id]);
  if (!claimed.rowCount) return 0;
  const rows = await audienceRows(c.audience); let n = 0;
  await ensureTemplates();
  for (const r of rows) {
    const e = await enqueue({ kind: 'newsletter', templateKey: 'newsletter_default', profileId: r.profile_id, skyId: r.sky_id, campaignId: c.id, dedupeKey: `camp:${c.id}:${r.sky_id}`, payload: { content: c.content, subject: c.subject, preheader: c.preheader }, createdBy: c.created_by, subject: c.subject });
    if (e.id) n++;
  }
  await query(`UPDATE email_campaigns SET total=$2 WHERE id=$1`, [c.id, n]);
  return n;
};
export const tickCampaigns = async () => {
  const due = await query(`SELECT * FROM email_campaigns WHERE status='scheduled' AND scheduled_at <= now() LIMIT 3`);
  for (const c of due.rows) await launch(c);
  const run = await query(`SELECT id FROM email_campaigns WHERE status='sending'`);
  for (const c of run.rows) {
    const open = await query(`SELECT 1 FROM email_outbox WHERE campaign_id=$1 AND status IN ('pending','sending') LIMIT 1`, [c.id]);
    if (!open.rowCount) await query(`UPDATE email_campaigns SET status='sent', finished_at=now() WHERE id=$1 AND status='sending'`, [c.id]);
  }
};

/* ─── предпросмотр и тест ─── */
const SAMPLE = {
  prime: { username: 'Алексей', subscription_name: 'Sky Prime', expiration_date: '15 ноября 2026 г.', days_remaining: '3 дня', renewal_amount: '399 ₽ за 30 дней', renewal_link: 'https://example.com/prime' },
  money: { username: 'Алексей', amount: '1 500', currency: '₽', transaction_id: 'SK-EXAMPLE1', payment_method: 'СБП', commission: '0 ₽', total_amount: '1 500 ₽', transaction_date: '15 ноября 2026 г., 12:30' },
};
/** Предпросмотр: данные ПРИМЕРНЫЕ и в письме не маскируются под настоящие — только экран администратора и тест на его собственный адрес. */
export const preview = async ({ templateKey, content, subject, preheader }) => {
  const t = await getTemplate(templateKey); if (!t) return { error: 'not_found' };
  const c = content ? cleanContent({ ...t.content, ...content }) : t.content; if (c.error) return c;
  const base = await ctxBase(); const ctx = { ...base, messageId: 'sky-preview', subject: subject || t.subject, preheader: preheader ?? t.preheader };
  let out;
  if (t.kind === 'newsletter') out = renderNewsletter(c.cta?.label && !c.cta.url ? { ...c, cta: { ...c.cta, url: base.appUrl } } : c, { ...ctx, username: 'Алексей', unsubUrl: base.appUrl });
  else if (t.kind === 'prime') out = renderPrime(c, SAMPLE.prime, { ...ctx, variant: templateKey === 'prime_renewed' ? 'renewed' : 'reminder' });
  else out = renderMoney(c, SAMPLE.money, { ...ctx, operationUrl: base.appUrl, receiptUrl: base.appUrl });
  return { ...out, example: t.kind !== 'newsletter', variables: VARIABLES[t.kind] };
};
export const sendTest = async (by, { templateKey, content, subject, preheader }) => {
  const t = await getTemplate(templateKey); if (!t) return { error: 'not_found' };
  const me = await person(by); if (!me?.email || !me.email_verified) return { error: 'no_verified_email' };
  const p = await preview({ templateKey, content, subject, preheader }); if (p.error) return p;
  const r = await sendEmail(me.email, `[Тест] ${p.subject}`, p.text, { html: p.html, fromName: senderNameOf(t.kind, p.brand), headers: { 'X-Sky-Message-ID': `sky-test-${crypto.randomBytes(6).toString('hex')}` } });
  await query(`INSERT INTO email_outbox (id, message_id, kind, template_key, profile_id, sky_id, email_mask, subject, status, manual, is_test, created_by, sent_at, last_error)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,TRUE,$5,CASE WHEN $9='sent' THEN now() END,$10)`,
    [nid('eo'), `sky-${crypto.randomBytes(9).toString('hex')}`, t.kind, templateKey, by, me.sky_id, maskEmail(me.email), `[Тест] ${p.subject}`.slice(0, 200), r.ok ? 'sent' : 'failed', r.ok ? '' : (r.error || 'send_failed')]);
  return r.ok ? { ok: true, to: maskEmail(me.email) } : { error: r.error || 'send_failed' };
};

/* ─── адресная отправка ─── */
export const searchUsers = async (q) => {
  const s = clean(q, 80).trim(); if (s.length < 2) return [];
  const like = `%${s.replace(/[%_\\]/g, '\\$&')}%`;
  const { rows } = await query(
    `SELECT p.id, p.name, p.username, p.sky_id, s.email, s.email_verified,
            EXISTS (SELECT 1 FROM prime_subscriptions ps WHERE ps.profile_id=p.id AND ps.status='active' AND (ps.expires_at IS NULL OR ps.expires_at > now())) AS prime
       FROM profiles p LEFT JOIN sky_ids s ON s.id = p.sky_id
      WHERE p.id = $1 OR p.sky_id = $1 OR p.username ILIKE $2 OR p.name ILIKE $2 OR lower(s.email) = lower($1) OR s.email ILIKE $2 LIMIT 20`, [s, like]);
  return rows.map((r) => ({ id: r.id, name: r.name, username: r.username, skyId: r.sky_id, email: maskEmail(r.email), verified: !!r.email_verified, prime: r.prime }));
};
export const userMoneyPayments = async (profileId) => (await query(
  `SELECT p.id, p.number, p.amount, p.currency, p.status, c.created_at AS credited_at FROM skykassa_payments p JOIN skykassa_credits c ON c.payment_id=p.id
    WHERE p.user_id=$1 AND p.destination='balance' ORDER BY c.created_at DESC LIMIT 20`, [profileId])).rows;
export const userPrimeInfo = async (profileId) => { const st = await primeState(profileId); if (!st) return { active: false }; const s = await getSettings(); return st.lifetime ? { active: true, lifetime: true } : { active: true, expiresAt: st.expiresAt, daysLeft: calendarDaysLeft(st.expiresAt, new Date(), s.timezone) }; };

const HOURLY_CAP = 300;
export const manualSend = async (actorId, { kind, templateKey, profileIds, paymentId, content, subject, preheader }) => {
  if (!KINDS.includes(kind)) return { error: 'bad_kind' };
  const ids = [...new Set((Array.isArray(profileIds) ? profileIds : []).map(String))].slice(0, 200);
  if (!ids.length) return { error: 'no_recipients' };
  const used = (await query(`SELECT count(*)::int AS n FROM email_outbox WHERE manual AND NOT is_test AND created_by=$1 AND created_at > now() - interval '1 hour'`, [actorId])).rows[0].n;
  if (used + ids.length > HOURLY_CAP) return { error: 'hourly_limit' };
  const tpl = await getTemplate(templateKey || (kind === 'newsletter' ? 'newsletter_default' : kind === 'money' ? 'money_topup' : 'prime_3d'));
  if (!tpl || tpl.kind !== kind) return { error: 'bad_template' };
  if (kind === 'money' && ids.length !== 1) return { error: 'money_single_recipient' };
  let cc = null;
  if (kind === 'newsletter') { cc = cleanContent({ ...tpl.content, ...(content || {}) }); if (cc.error) return cc; if (!cc.title) return { error: 'incomplete' }; }
  const results = [];
  for (const pid of ids) {
    const per = await person(pid);
    if (!per) { results.push({ profileId: pid, status: 'error', reason: 'not_found' }); continue; }
    if (!per.email || !per.email_verified) { results.push({ profileId: pid, status: 'error', reason: 'no_verified_email' }); continue; }
    let payload = {}; let dedupeKey = null;
    if (kind === 'newsletter') payload = { content: cc, subject: clean(subject, 200) || tpl.subject, preheader: preheader ?? tpl.preheader };
    else if (kind === 'prime') {
      const st = await primeState(pid);
      if (!st) { results.push({ profileId: pid, status: 'error', reason: 'no_active_subscription' }); continue; }
      if (st.lifetime) { results.push({ profileId: pid, status: 'error', reason: 'lifetime' }); continue; }
      if (st.expiresAt <= new Date()) { results.push({ profileId: pid, status: 'error', reason: 'expired' }); continue; }
      payload = { expiry: st.expiresAt.toISOString() };
    } else {
      const pay = await paymentOf(paymentId);
      if (!pay || pay.user_id !== pid || pay.destination !== 'balance' || !['completed', 'refunded_partial', 'refunded_full'].includes(pay.status)) { results.push({ profileId: pid, status: 'error', reason: 'payment_not_credited' }); continue; }
      payload = { paymentId }; dedupeKey = `moneyman:${paymentId}:${Math.floor(Date.now() / 60000)}`;
    }
    const e = await enqueue({ kind, templateKey: tpl.key, profileId: pid, payload, dedupeKey, manual: true, createdBy: actorId, subject: payload.subject || tpl.subject });
    results.push({ profileId: pid, status: e.error ? 'error' : e.duplicate ? 'duplicate' : 'queued', reason: e.error || undefined, messageId: e.messageId });
  }
  void processOutbox().catch(() => {});
  return { results };
};

/* ─── журнал и статистика ─── */
export const journal = async ({ kind, status, q, limit = 100, offset = 0 } = {}) => {
  const p = []; const w = [];
  if (KINDS.includes(kind)) { p.push(kind); w.push(`o.kind = $${p.length}`); }
  if (['pending', 'sending', 'sent', 'failed', 'skipped'].includes(status)) { p.push(status); w.push(`o.status = $${p.length}`); }
  if (q) { p.push(`%${clean(q, 60).replace(/[%_\\]/g, '\\$&')}%`); w.push(`(o.sky_id ILIKE $${p.length} OR o.profile_id ILIKE $${p.length} OR o.message_id ILIKE $${p.length} OR pr.username ILIKE $${p.length} OR pr.name ILIKE $${p.length})`); }
  p.push(Math.min(200, Math.max(1, Number(limit) || 100)), Math.max(0, Number(offset) || 0));
  const { rows } = await query(
    `SELECT o.id, o.message_id, o.kind, o.template_key, o.profile_id, o.sky_id, o.email_mask, o.subject, o.status, o.attempts, o.last_error, o.manual, o.is_test, o.created_by, o.created_at, o.sent_at, o.campaign_id,
            pr.username, pr.name, ad.username AS admin_username
       FROM email_outbox o LEFT JOIN profiles pr ON pr.id = o.profile_id LEFT JOIN profiles ad ON ad.id = o.created_by
      ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  return rows;
};
export const stats = async () => {
  const { rows } = await query(`SELECT kind, status, count(*)::int AS n FROM email_outbox WHERE created_at > now() - interval '30 days' AND NOT is_test GROUP BY kind, status`);
  const byDay = (await query(`SELECT date_trunc('day', created_at)::date AS day, count(*) FILTER (WHERE status='sent')::int AS sent, count(*) FILTER (WHERE status='failed')::int AS failed FROM email_outbox WHERE created_at > now() - interval '14 days' AND NOT is_test GROUP BY 1 ORDER BY 1`)).rows;
  const unsub = (await query(`SELECT count(*)::int AS n FROM email_unsubscribes`)).rows[0].n;
  return { rows, byDay, unsubscribed: unsub };
};

/* ─── отписка и квитанция ─── */
export const unsubscribe = async (token, source = 'link') => {
  const id = verifyUnsubToken(token); if (!id) return { error: 'bad_token' };
  if (!(await query(`SELECT 1 FROM sky_ids WHERE id=$1`, [id])).rowCount) return { error: 'bad_token' };
  await query(`INSERT INTO email_unsubscribes (sky_id, source) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, source]);
  return { ok: true };
};
export const receiptData = async (token) => {
  const id = verifyReceiptToken(token); if (!id) return null;
  const pay = await paymentOf(id); if (!pay || pay.destination !== 'balance') return null;
  const s = await getSettings();
  return { number: pay.number, amount: Number(pay.amount).toLocaleString('ru-RU'), currency: pay.currency === 'RUB' ? '₽' : pay.currency, commission: rub(pay.fee || 0), total: `${Number(pay.total).toLocaleString('ru-RU')} ${pay.currency === 'RUB' ? '₽' : pay.currency}`, method: pay.method_title || 'SkyKassa', date: fmtDate(pay.credit_at || pay.credited_at, s.timezone, true), status: 'Зачислено' };
};

/* ─── ОФД-сводка (справочная, не налоговая отчётность) ─── */
export const ofdSummary = async ({ from, to } = {}) => {
  const s = await getSettings(); const tz = s.timezone;
  const today = dayKey(new Date(), tz);
  const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : today; const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : f;
  const range = `(created_at AT TIME ZONE '${tz.replace(/'/g, '')}')::date BETWEEN $1::date AND $2::date`;
  const topups = (await query(
    `SELECT p.id, p.number, p.user_id, p.amount, p.fee, c.created_at AS at, pr.username FROM skykassa_payments p JOIN skykassa_credits c ON c.payment_id=p.id LEFT JOIN profiles pr ON pr.id=p.user_id
      WHERE p.destination='balance' AND (c.created_at AT TIME ZONE '${tz.replace(/'/g, '')}')::date BETWEEN $1::date AND $2::date ORDER BY c.created_at DESC LIMIT 500`, [f, t])).rows;
  const prime = (await query(
    `SELECT w.id, w.user_id, -w.amount AS amount, w.created_at AS at, pr.username FROM wallet_transactions w LEFT JOIN profiles pr ON pr.id=w.user_id
      WHERE w.type='prime' AND w.amount < 0 AND (w.created_at AT TIME ZONE '${tz.replace(/'/g, '')}')::date BETWEEN $1::date AND $2::date ORDER BY w.created_at DESC LIMIT 500`, [f, t])).rows;
  const cnt = async (sql) => Number((await query(sql, [f, t])).rows[0].n);
  const orders = {
    market: await cnt(`SELECT count(*) AS n FROM market_orders WHERE ${range}`),
    business: await cnt(`SELECT count(*) AS n FROM kb_orders WHERE ${range}`),
    go: await cnt(`SELECT count(*) AS n FROM go_orders WHERE ${range}`),
  };
  const receipts = await cnt(`SELECT count(*) AS n FROM email_outbox WHERE kind='money' AND status='sent' AND NOT is_test AND (sent_at AT TIME ZONE '${tz.replace(/'/g, '')}')::date BETWEEN $1::date AND $2::date`);
  const topupSum = topups.reduce((a, x) => a + Number(x.amount), 0); const feeSum = topups.reduce((a, x) => a + Number(x.fee || 0), 0); const primeSum = prime.reduce((a, x) => a + Number(x.amount), 0);
  const revenue = primeSum + feeSum; const base = revenue + (s.ofdIncludeTopups ? topupSum : 0);
  const tax = Math.round(base * Number(s.ofdTaxRatePct) / 100 * 100) / 100;
  const entries = [
    ...topups.map((x) => ({ at: x.at, kind: 'topup', ref: x.number, who: x.username, amount: Number(x.amount) })),
    ...prime.map((x) => ({ at: x.at, kind: 'prime', ref: x.id, who: x.username, amount: Number(x.amount) })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  return { from: f, to: t, today, tz, receiptsSent: receipts, orders: { ...orders, total: orders.market + orders.business + orders.go }, topupSum, feeSum, primeSum, revenue, taxBase: base, taxRatePct: Number(s.ofdTaxRatePct), includeTopups: s.ofdIncludeTopups, tax, entries };
};

/* ─── диагностика: почему автоматические письма не уходят ─── */
export const diagnose = async () => {
  const out = []; const add = (level, id, text) => out.push({ level, id, text });
  const s = await getSettings(); const sender = senderInfo();
  if (config.emailMode === 'log') add('bad', 'mode_log', 'Почта в режиме «log»: письма только печатаются в журнал сервера и никому не уходят. Настройте отправку: scripts/set-email.sh (SMTP или Resend), затем docker compose up -d api.');
  else if (!sender.configured) add('bad', 'not_configured', `Почта не настроена (режим ${config.emailMode}, адрес «От» ${sender.from || 'не задан'}). Проверьте scripts/set-email.sh.`);
  else add('ok', 'mail', `Почта настроена: режим ${config.emailMode}, «От» ${sender.from}.`);
  if (!config.publicOrigin) add('warn', 'origin', 'DOMAIN не задан: ссылки и логотип в письмах будут пустыми.');

  if (!s.primeAuto) add('bad', 'prime_off', 'Автоматические напоминания о Sky Prime ВЫКЛЮЧЕНЫ. Включите галочку в «Настройки отправителя» (только владелец).');
  if (!s.moneyAuto) add('bad', 'money_off', 'Автоуведомления о пополнении SkyMoney ВЫКЛЮЧЕНЫ. Включите галочку в «Настройки отправителя» (только владелец): письма уйдут только за пополнения ПОСЛЕ включения.');
  else if (!s.autoSince) add('bad', 'money_since', 'Автоуведомления SkyMoney включены, но нет отметки времени включения. Выключите и включите галочку заново.');

  const tpls = await listTemplates();
  const off = tpls.filter((t) => t.kind !== 'newsletter' && (!t.enabled || !t.auto)).map((t) => `${t.name} (${!t.enabled ? 'выключено' : 'не автоматическое'})`);
  if (off.length) add('warn', 'templates', `Шаблоны, которые не отправляются автоматически: ${off.join(', ')}. Это вкладки «Sky Prime» и «SkyMoney» → переключатели шаблонов.`);

  const q = await query(`SELECT status, count(*)::int AS n FROM email_outbox WHERE created_at > now() - interval '7 days' GROUP BY status`);
  const by = Object.fromEntries(q.rows.map((r) => [r.status, r.n]));
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  add(total ? 'ok' : 'warn', 'outbox', total ? `За 7 дней в очереди: отправлено ${by.sent ?? 0}, ждут ${by.pending ?? 0}, ошибок ${by.failed ?? 0}, пропущено ${by.skipped ?? 0}.` : 'За 7 дней в очередь не попало ни одного письма: автоматика ничего не ставила (см. причины выше и кандидатов ниже).');
  const stuck = (await query(`SELECT count(*)::int AS n FROM email_outbox WHERE status='pending' AND created_at < now() - interval '15 minutes'`)).rows[0].n;
  if (stuck) add('bad', 'stuck', `В очереди застряло ${stuck} писем старше 15 минут: воркер не отправляет. Смотрите ошибки ниже и docker compose logs api | grep "\\[email".`);
  const errs = await query(`SELECT last_error, count(*)::int AS n FROM email_outbox WHERE status IN ('failed','pending') AND last_error <> '' AND created_at > now() - interval '7 days' GROUP BY last_error ORDER BY n DESC LIMIT 5`);
  for (const e of errs.rows) add('bad', 'error', `Ошибка отправки «${e.last_error}»: ${e.n} шт.${e.last_error === 'email_not_configured' ? ' Почта не настроена.' : e.last_error === 'email_delivery_failed' ? ' Почтовый сервер отказал: смотрите журнал api, строки [email:…].' : ''}`);
  const skipped = await query(`SELECT last_error, count(*)::int AS n FROM email_outbox WHERE status='skipped' AND created_at > now() - interval '7 days' GROUP BY last_error ORDER BY n DESC LIMIT 5`);
  const WHY = { no_verified_email: 'у человека нет подтверждённой почты', unsubscribed: 'отписался от рассылок', stale: 'письмо устарело к моменту отправки', subscription_changed: 'подписку продлили', expired: 'подписка уже закончилась', lifetime: 'бессрочный Prime', no_active_subscription: 'нет активной подписки', payment_not_credited: 'платёж не зачислен', template_disabled: 'шаблон выключен' };
  for (const e of skipped.rows) add('warn', 'skipped', `Пропущено ${e.n}: ${WHY[e.last_error] ?? e.last_error}.`);

  const prime = (await query(`SELECT count(*)::int AS n FROM (SELECT profile_id FROM prime_subscriptions WHERE status='active' GROUP BY profile_id HAVING bool_and(expires_at IS NOT NULL) AND max(expires_at) BETWEEN now() AND now() + interval '9 days') x`)).rows[0].n;
  add(prime ? 'ok' : 'warn', 'prime_cand', prime ? `Подписок Prime, которые заканчиваются в ближайшие 9 дней: ${prime} (напоминания идут при 7, 3, 1 и 0 днях).` : 'Нет подписок Prime, заканчивающихся в ближайшие 9 дней: напоминать пока некому.');
  if (s.autoSince) {
    const m = (await query(`SELECT count(*)::int AS n FROM skykassa_payments p JOIN skykassa_credits c ON c.payment_id = p.id WHERE p.destination='balance' AND c.created_at > $1 AND c.created_at > now() - interval '2 days'`, [s.autoSince])).rows[0].n;
    add('ok', 'money_cand', `Зачисленных пополнений после включения за последние 2 дня: ${m}.`);
  }
  const last = (await query(`SELECT max(sent_at) AS t FROM email_outbox WHERE status='sent'`)).rows[0].t;
  add(last ? 'ok' : 'warn', 'last_sent', last ? `Последнее отправленное письмо: ${new Date(last).toLocaleString('ru-RU', { timeZone: s.timezone })}.` : 'Ни одно письмо через очередь ещё не отправлено.');
  return { checks: out, bad: out.filter((x) => x.level === 'bad').length };
};
