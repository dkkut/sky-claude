/**
 * Автоматическая модерация каналов (ноябрь-2026): выявление потенциально опасных ПУБЛИЧНЫХ каналов (с @адресом) по описанию, названию и публикациям + жалобам людей.
 * Это помощник модератора, а не судья:
 *  1) сканер ищет признаки по ключевым фразам и ОЦЕНИВАЕТ КОНТЕКСТ (новости, цитаты, предупреждения о мошенниках, книги/фильмы снижают вес; продажа, цена, контакты — повышают);
 *     одно слово без подкрепления до порога проверки не доходит; «серьёзной» угроза становится только при нескольких независимых признаках;
 *  2) спорное передаётся модератору (право `channel_mod`), он решает: отклонить, предупредить владельца или временно ограничить (только «серьёзное», с подтверждением и причиной);
 *  3) ограничение — временная заморозка канала (acctfreeze): данные не удаляются, владелец получает уведомление и может обжаловать (решает другой сотрудник);
 *  4) автоограничение без человека выключено по умолчанию; включает владелец, действует только на «серьёзное» с очень высоким баллом;
 *  5) жалобы весят по репутации жалобщика: новые аккаунты, много отклонённых жалоб, «налёт» (много жалоб за минуты) — вес снижается или обнуляется; одними жалобами дело открывается только при большом числе независимых людей;
 *  6) каждое действие пишется в историю дела и журнал администрации; содержимое приватных каналов не сканируется — там только жалобы.
 * Ключевые слова — грубая эвристика: возможны ошибки в обе стороны; поэтому последнее слово всегда за человеком.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { notifyGift } from './giftnotify.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { freezeChannel, liftFreeze, appeal as freezeAppeal, decideAppeal as freezeDecideAppeal } from './acctfreeze.mjs';

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const cid = () => `cmc-${crypto.randomUUID()}`;
export const CATEGORIES = { violence: 'Угрозы насилием', terror: 'Терроризм и экстремизм', drugs: 'Продажа наркотиков', fraud: 'Мошенничество и фишинг', weapons: 'Продажа оружия', child_safety: 'Безопасность детей' };
export const REPORT_REASONS = { violence: 'Угрозы насилием', drugs: 'Наркотики', fraud: 'Мошенничество', illegal: 'Незаконный контент', abuse: 'Оскорбления и травля', other: 'Другое' };

/* ─── Словарь ───────────────────────────────────────────────────────── */
// В JS \b и \w понимают только латиницу, поэтому для русского текста границы слов и \w заменяются на Юникод-варианты.
const rx = (re) => new RegExp(re.source.replace(/\\w/g, '[\\p{L}\\p{N}_]').replace(/\\b(.?)/g, (_, nxt) => (nxt === '(' ? '(?<![\\p{L}\\p{N}_])(' : `(?![\\p{L}\\p{N}_])${nxt}`)), 'iu');
// weight — вклад одного совпадения; severe — тяжёлая категория (даже без подкрепления идёт к модератору, но не «серьёзное» само по себе)
const RULES0 = [
  { c: 'violence', w: 28, re: /\b(убь[юё]|убьём|зарежу|расстреляю|придушу|повешу)\b/i },
  { c: 'violence', w: 30, re: /\b(взорву|подожгу|устрою (?:бойню|расправу))\b/i },
  { c: 'terror', w: 40, severe: true, re: /\b(теракт\w*|вербовк\w* в (?:ИГ|игил|джихад)\w*|присоединяйся к джихад\w*)\b/i },
  { c: 'terror', w: 32, re: /\b(взрывчатк\w*|самодельн\w+ взрывн\w+ устройств\w*|изготовлени\w+ бомб\w*)\b/i },
  { c: 'drugs', w: 24, re: /\b(закладк\w*|мефедрон\w*|амфетамин\w*|гашиш\w*|кокаин\w*|спайс\w*)\b/i },
  { c: 'drugs', w: 30, re: /\b(куплю|продам|продажа|заказать|купить)\b[^.\n]{0,40}\b(мефедрон|кокаин|амфетамин|гашиш|наркотик\w*|соль)\b/i },
  { c: 'fraud', w: 26, re: /(введите|сообщите|пришлите|отправьте)[^.\n]{0,40}(код из (?:смс|sms|сообщения)|пароль|cvv|cvc|пин-?код)/i },
  { c: 'fraud', w: 24, re: /(гарантированн\w+ (?:доход|прибыл\w*)|удво\w+ (?:ваши )?деньги|пассивный доход без вложений|вложи\w* и получ\w+)/i },
  { c: 'fraud', w: 22, re: /(ваш (?:аккаунт|счёт|счет|карта) (?:заблокирован\w*|взломан\w*)[^.\n]{0,40}(?:перейдите|введите|подтвердите))/i },
  { c: 'weapons', w: 30, re: /\b(продам|куплю|продажа|купить)\b[^.\n]{0,40}\b(пистолет\w*|автомат\w*|огнестрел\w*|патрон\w*|ствол\w*)\b/i },
  { c: 'child_safety', w: 55, severe: true, re: /(детск\w+ порно\w*|порно с детьми|секс с несовершеннолетн\w*)/i },
];
const RULES = RULES0.map((r) => ({ ...r, re: rx(r.re) }));
// контекст: снижает вес (ново­сти, цитаты, предупреждения, художественные и учебные тексты) и повышает (продажа, контакты)
const NEG = rx(/(новост|сообща(?:ет|ют)|по данным|полици\w+|задержан\w*|суд\w*|приговор|расследовани|фильм|сериал|роман|книг\w*|цитат\w*|«[^»]{3,}»|осуждаем|борьб\w+ с|профилактик\w*|предупреждаем|не (?:покупайте|верьте|вводите|сообщайте)|осторожн\w*|мошенник\w+ (?:рассылают|звонят)|как не стать|игра|в игре|геймплей|мем)/i);
const POS = rx(/(цена|руб\b|₽|\$|прайс|в наличии|заказ\w*|доставк\w*|пиши\w* в (?:лс|личку|тг)|t\.me\/|telegram|whatsapp|оплат\w*|скидк\w*|оптом|быстро и анонимно|надёжно|надежно)/i);

export const scanText = (raw) => {
  const text = String(raw ?? '').slice(0, 4000); if (text.length < 4) return { signals: [], score: 0 };
  const neg = NEG.test(text), pos = POS.test(text);
  const signals = [];
  for (const r of RULES) {
    const m = r.re.exec(text); if (!m) continue;
    let w = r.w; const ctx = [];
    if (neg) { w *= 0.3; ctx.push('смягчающий контекст'); }
    if (pos) { w *= 1.4; ctx.push('признаки продажи/контакта'); }
    const i = Math.max(0, m.index - 40);
    signals.push({ kind: 'text', category: r.c, term: m[0].slice(0, 40), weight: Math.round(w * 10) / 10, ctx, severe: Boolean(r.severe), ex: text.slice(i, i + 160) });
  }
  return { signals, score: signals.reduce((a, s) => a + s.weight, 0) };
};

/** Свод по каналу: по каждой категории — самый сильный признак; серьёзность — не менее двух независимых источников/категорий. */
export const aggregate = (signals, reportScore = 0) => {
  const byCat = new Map();
  for (const s of signals) { const cur = byCat.get(s.category); if (!cur || s.weight > cur.weight) byCat.set(s.category, s); }
  let score = [...byCat.values()].reduce((a, s) => a + s.weight, 0);
  const msgs = new Set(signals.filter((s) => s.msgId).map((s) => s.msgId)).size;
  if (msgs >= 3) score += 10;                     // повторяемость: не единичный случай
  score += reportScore;
  const sources = new Set(); for (const s of signals) sources.add(`${s.category}:${s.kind}`); if (reportScore >= 20) sources.add('reports');
  const independent = byCat.size + (reportScore >= 20 ? 1 : 0);
  return { score: Math.min(100, Math.round(score)), independent, categories: [...byCat.keys()], sourceCount: sources.size };
};

/* ─── Настройки ─── */
export const getSettings = async () => { const r = (await query('SELECT * FROM chan_mod_settings WHERE id')).rows[0]; return { enabled: r.enabled, reviewScore: r.review_score, seriousScore: r.serious_score, autoRestrict: r.auto_restrict, restrictHours: r.restrict_hours }; };
export const saveSettings = async (actorId, b = {}, { codeOk = false } = {}) => {
  if (!(await can(actorId, 'channel_mod'))) return { error: 'not_allowed' };
  const cur = await getSettings();
  const n = (v, d, lo, hi) => (v === undefined ? d : Math.max(lo, Math.min(hi, Math.trunc(Number(v)) || 0)));
  const next = { enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.enabled, reviewScore: n(b.reviewScore, cur.reviewScore, 30, 95), seriousScore: n(b.seriousScore, cur.seriousScore, 50, 100), autoRestrict: typeof b.autoRestrict === 'boolean' ? b.autoRestrict : cur.autoRestrict, restrictHours: n(b.restrictHours, cur.restrictHours, 1, 720) };
  if (next.seriousScore < next.reviewScore + 10) return { error: 'bad_settings' };
  // Порог ниже 30 одним словом открывал бы дела — запрещён; автоограничение и послабление порогов — только владелец с кодом.
  const weaken = next.autoRestrict !== cur.autoRestrict || next.reviewScore < cur.reviewScore || next.seriousScore < cur.seriousScore;
  if (weaken) { if (!(await isOwner(actorId))) return { error: 'owner_only' }; if (!codeOk) return { error: 'code_required' }; }
  await query('UPDATE chan_mod_settings SET enabled=$1, review_score=$2, serious_score=$3, auto_restrict=$4, restrict_hours=$5, updated_by=$6, updated_at=now() WHERE id', [next.enabled, next.reviewScore, next.seriousScore, next.autoRestrict, next.restrictHours, actorId]);
  await logAdmin({ actorId, targetType: 'system', type: 'chan_mod_settings', detail: `вкл ${next.enabled}; проверка от ${next.reviewScore}; серьёзное от ${next.seriousScore}; авто ${next.autoRestrict}` });
  return { ok: true, settings: await getSettings() };
};

const log = (caseId, actor, action, detail) => query('INSERT INTO chan_mod_log (case_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [caseId, actor ?? null, action, clean(detail, 500)]);

/* ─── Жалобы с защитой от налётов ─── */
export const report = async (me, chatId, reason) => {
  const why = Object.hasOwn(REPORT_REASONS, String(reason)) ? String(reason) : null; if (!why) return { error: 'bad_reason' };
  const c = (await query("SELECT id, owner_id, type FROM chats WHERE id = $1 AND type = 'channel' AND trashed_at IS NULL", [String(chatId ?? '')])).rows[0]; if (!c) return { error: 'not_found' };
  if (c.owner_id === me) return { error: 'own_channel' };
  if (!(await query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [c.id, me])).rowCount) return { error: 'not_member' };
  const day = Number((await query(`SELECT count(*)::int n FROM chan_mod_reports WHERE reporter_id = $1 AND at > now() - interval '24 hours'`, [me])).rows[0].n);
  if (day >= 10) return { error: 'too_many_reports' };
  const prof = (await query('SELECT created_at FROM profiles WHERE id = $1', [me])).rows[0];
  const ageDays = (Date.now() - new Date(prof?.created_at ?? Date.now()).getTime()) / 86_400_000;
  const dismissed = Number((await query(`SELECT count(*)::int n FROM chan_mod_reports WHERE reporter_id = $1 AND outcome = 'dismissed' AND at > now() - interval '30 days'`, [me])).rows[0].n);
  let weight = 1;
  if (ageDays < 7) weight = 0.3;
  if (dismissed >= 3) weight = 0;
  else if (dismissed >= 1) weight = Math.min(weight, 0.6);
  if (day >= 5) weight *= 0.5;
  try { await query('INSERT INTO chan_mod_reports (chat_id, reporter_id, reason, weight) VALUES ($1,$2,$3,$4)', [c.id, me, why, weight]); }
  catch (e) { if (e.code === '23505') return { error: 'already_reported' }; throw e; }
  await evaluateReports(c.id);
  return { ok: true };
};
/** «Налёт»: много жалоб от свежих аккаунтов за короткое время — все их веса обнуляются. */
const evaluateReports = async (chatId) => {
  const burst = (await query(`SELECT r.reporter_id FROM chan_mod_reports r JOIN profiles p ON p.id = r.reporter_id WHERE r.chat_id = $1 AND r.at > now() - interval '10 minutes' AND p.created_at > now() - interval '7 days'`, [chatId])).rows;
  if (burst.length >= 5) {
    await query(`UPDATE chan_mod_reports SET weight = 0 WHERE chat_id = $1 AND reporter_id = ANY($2)`, [chatId, burst.map((x) => x.reporter_id)]);
    const open = (await query("SELECT id FROM chan_mod_cases WHERE chat_id = $1 AND status = 'review'", [chatId])).rows[0];
    if (open) await log(open.id, null, 'brigade_suspected', `${burst.length} жалоб от новых аккаунтов за 10 минут — вес обнулён`);
  }
  const total = Number((await query('SELECT COALESCE(sum(weight),0) AS w FROM chan_mod_reports WHERE chat_id = $1', [chatId])).rows[0].w);
  if (total * 5 >= 40) await scanChannel(chatId);
};
const reportScoreOf = async (chatId) => Math.min(45, Math.round(Number((await query(`SELECT COALESCE(sum(weight),0) AS w FROM chan_mod_reports WHERE chat_id = $1 AND outcome IS NULL`, [chatId])).rows[0].w) * 5));

/* ─── Сканирование ─── */
export const scanChannel = async (chatId, { now = new Date() } = {}) => {
  const s = await getSettings(); if (!s.enabled) return { skipped: 'disabled' };
  const c = (await query("SELECT id, name, description, username, owner_id FROM chats WHERE id = $1 AND type = 'channel' AND trashed_at IS NULL", [String(chatId)])).rows[0]; if (!c) return { skipped: 'not_found' };
  const isPublic = Boolean(c.username);
  const signals = [];
  if (isPublic) {
    const name = decryptContent(c.name) ?? c.name ?? '', desc = c.description ? (decryptContent(c.description) ?? '') : '';
    for (const sg of scanText(`${name}. ${desc}`).signals) signals.push({ ...sg, source: 'description' });
    const posts = (await query(`SELECT id, text FROM messages WHERE chat_id = $1 AND deleted = FALSE AND kind = 'text' AND created_at > $2 ORDER BY created_at DESC LIMIT 60`, [c.id, new Date(now.getTime() - 7 * 86_400_000)])).rows;
    for (const m of posts) { const t = decryptContent(m.text) ?? ''; for (const sg of scanText(t).signals) signals.push({ ...sg, source: 'post', msgId: m.id }); }
  }
  const rep = await reportScoreOf(c.id);
  const agg = aggregate(signals, rep);
  if (agg.score < s.reviewScore) return { score: agg.score, case: null };
  const serious = agg.score >= s.seriousScore && agg.independent >= 2;
  const open = (await query("SELECT * FROM chan_mod_cases WHERE chat_id = $1 AND status IN ('review','restricted','appealed')", [c.id])).rows[0];
  const stored = signals.slice(0, 12).map((x) => ({ kind: x.kind, category: x.category, source: x.source, term: x.term, weight: x.weight, ctx: x.ctx, ex: encryptContent(x.ex), msgId: x.msgId }));
  if (open) { if (open.status === 'review') await query('UPDATE chan_mod_cases SET score=$2, signals=$3::jsonb, serious=$4, updated_at=now() WHERE id=$1', [open.id, agg.score, JSON.stringify(stored), serious]); return { score: agg.score, case: open.id, updated: true }; }
  // недавно отклонённое без заметного роста признаков заново не открываем
  const dis = (await query("SELECT score FROM chan_mod_cases WHERE chat_id = $1 AND status IN ('dismissed','closed') AND decided_at > now() - interval '7 days' ORDER BY decided_at DESC LIMIT 1", [c.id])).rows[0];
  if (dis && agg.score < Number(dis.score) + 25) return { score: agg.score, case: null, recentlyDismissed: true };
  const id = cid();
  try { await query(`INSERT INTO chan_mod_cases (id, chat_id, source, score, signals, serious) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`, [id, c.id, signals.length ? 'scan' : 'reports', agg.score, JSON.stringify(stored), serious]); }
  catch (e) { if (e.code === '23505') return { score: agg.score, case: null }; throw e; }
  await log(id, null, 'opened', `${agg.score} баллов; ${agg.categories.join(', ') || 'жалобы'}; независимых признаков ${agg.independent}`);
  void notifyStaff('channel_mod_case', { title: serious ? 'Серьёзный случай в канале' : 'Канал на проверке', body: 'Новое дело в очереди автомодерации.', dedupe: id });
  if (serious && s.autoRestrict && agg.score >= 90) await restrictNow('system', id, c.id, `Автоматическое временное ограничение: ${agg.score} баллов, независимых признаков ${agg.independent}`, s.restrictHours);
  return { score: agg.score, case: id, serious };
};

export const sweepChannels = async () => {
  const s = await getSettings(); if (!s.enabled) return 0;
  const st = (await query('SELECT last_scan FROM chan_mod_state WHERE id')).rows[0]; const from = st.last_scan; const started = new Date();
  const ids = (await query(`SELECT DISTINCT m.chat_id AS id FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.type = 'channel' AND COALESCE(c.username,'') <> '' AND m.created_at > $1 LIMIT 60`, [from])).rows.map((r) => r.id);
  let n = 0; for (const id of ids) { try { await scanChannel(id); n++; } catch (e) { console.error('[chanmod]', e.message); } }
  await query('UPDATE chan_mod_state SET last_scan = $1 WHERE id', [started]);
  // апелляцию могли подать и через общий экран заморозки — дело должно это видеть
  await query(`UPDATE chan_mod_cases c SET status = 'appealed', updated_at = now() WHERE status = 'restricted' AND freeze_id IS NOT NULL AND EXISTS (SELECT 1 FROM acct_freeze_appeals a WHERE a.freeze_id = c.freeze_id AND a.status = 'open')`);
  // ограничение закончилось само — закрыть дело
  await query(`UPDATE chan_mod_cases c SET status = 'closed', updated_at = now(), decided_at = COALESCE(decided_at, now()) WHERE status IN ('restricted','appealed') AND freeze_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM acct_freezes f WHERE f.id = c.freeze_id AND f.status = 'active' AND (f.expires_at IS NULL OR f.expires_at > now()))`);
  return n;
};
export const startChanMod = () => { setInterval(() => { sweepChannels().catch((e) => console.error('[chanmod]', e.message)); }, 120_000).unref?.(); };

/* ─── Модератор ─── */
const guard = async (actor) => (await can(actor, 'channel_mod')) ? null : { error: 'not_allowed' };
const safeSignals = (arr) => (Array.isArray(arr) ? arr : []).map((s) => ({ ...s, ex: s.ex ? (decryptContent(s.ex) ?? '') : undefined }));
export const queue = async (actor, { status = 'review' } = {}) => {
  const g = await guard(actor); if (g) return g;
  const st = ['review', 'restricted', 'appealed', 'dismissed', 'restored', 'closed'].includes(status) ? status : 'review';
  const rows = (await query(`SELECT c.*, ch.name, ch.username FROM chan_mod_cases c LEFT JOIN chats ch ON ch.id = c.chat_id WHERE c.status = $1 ORDER BY c.serious DESC, c.score DESC, c.created_at LIMIT 200`, [st])).rows;
  return { items: rows.map((r) => ({ id: r.id, chatId: r.chat_id, title: decryptContent(r.name) ?? r.name, handle: r.username ? `@${r.username}` : undefined, source: r.source, score: r.score, serious: r.serious, status: r.status, categories: [...new Set((r.signals ?? []).map((s) => s.category))], createdAt: r.created_at.toISOString() })) };
};
export const detail = async (actor, caseId) => {
  const g = await guard(actor); if (g) return g;
  const r = (await query('SELECT * FROM chan_mod_cases WHERE id = $1', [String(caseId ?? '')])).rows[0]; if (!r) return { error: 'not_found' };
  const reports = (await query(`SELECT reason, weight, at FROM chan_mod_reports WHERE chat_id = $1 ORDER BY at DESC LIMIT 100`, [r.chat_id])).rows;
  const hist = (await query('SELECT h.at, h.action, h.detail, p.username FROM chan_mod_log h LEFT JOIN profiles p ON p.id = h.actor WHERE h.case_id = $1 ORDER BY h.id', [r.id])).rows;
  await log(r.id, actor, 'viewed', '');
  return { id: r.id, chatId: r.chat_id, score: r.score, serious: r.serious, status: r.status, signals: safeSignals(r.signals), reports: reports.map((x) => ({ reason: REPORT_REASONS[x.reason] ?? x.reason, weight: Number(x.weight), at: x.at.toISOString() })), decision: r.decision ?? undefined, history: hist.map((x) => ({ at: x.at.toISOString(), action: x.action, detail: x.detail, actor: x.username ? `@${x.username}` : 'система' })) };
};
const restrictNow = async (actor, caseId, chatId, reason, hours) => {
  const label = REPORT_REASONS.other; void label;
  const fr = await freezeChannel(actor === 'system' ? 'system:chanmod' : actor, { chatId, reason, publicReason: 'Временное ограничение: подозрение на серьёзное нарушение правил. Дело передано на проверку.', showReason: true, expiresAt: new Date(Date.now() + hours * 3600_000).toISOString() });
  if (fr.error) return fr;
  await query(`UPDATE chan_mod_cases SET status = 'restricted', freeze_id = $2, decided_by = $3, decision = $4, decided_at = now(), updated_at = now() WHERE id = $1`, [caseId, fr.id, actor === 'system' ? null : actor, clean(reason, 500)]);
  await query(`UPDATE chan_mod_reports SET outcome = 'confirmed' WHERE chat_id = $1 AND outcome IS NULL`, [chatId]);
  await log(caseId, actor === 'system' ? null : actor, 'restricted', `${hours} ч: ${reason}`);
  return { ok: true, freezeId: fr.id };
};
export const decide = async (actor, caseId, { action, reason, hours, confirm } = {}) => {
  const g = await guard(actor); if (g) return g;
  const r = (await query('SELECT * FROM chan_mod_cases WHERE id = $1', [String(caseId ?? '')])).rows[0]; if (!r) return { error: 'not_found' };
  if (r.status !== 'review') return { error: 'bad_state' };
  const ch = (await query('SELECT owner_id FROM chats WHERE id = $1', [r.chat_id])).rows[0];
  if (ch?.owner_id === actor || (await query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [r.chat_id, actor])).rowCount) return { error: 'self_review' };
  const why = clean(reason, 500); const s = await getSettings();
  if (action === 'dismiss') {
    if (why.length < 5) return { error: 'reason_required' };
    const u = await query(`UPDATE chan_mod_cases SET status='dismissed', decided_by=$2, decision=$3, decided_at=now(), updated_at=now() WHERE id=$1 AND status='review'`, [r.id, actor, why]); if (!u.rowCount) return { error: 'bad_state' };
    await query(`UPDATE chan_mod_reports SET outcome = 'dismissed' WHERE chat_id = $1 AND outcome IS NULL`, [r.chat_id]);
    await log(r.id, actor, 'dismissed', why); await logAdmin({ actorId: actor, targetType: 'channel', targetId: r.chat_id, type: 'chan_mod_dismiss', detail: why.slice(0, 200) });
    return { ok: true, status: 'dismissed' };
  }
  if (action === 'warn') {
    if (why.length < 10) return { error: 'reason_required' };
    const u = await query(`UPDATE chan_mod_cases SET status='closed', decided_by=$2, decision=$3, decided_at=now(), updated_at=now() WHERE id=$1 AND status='review'`, [r.id, actor, `Предупреждение: ${why}`]); if (!u.rowCount) return { error: 'bad_state' };
    if (ch?.owner_id) void notifyGift(ch.owner_id, 'chan_mod', 'Предупреждение по каналу', `Администрация заметила возможные нарушения правил в вашем канале: ${why}`, r.id).catch(() => {});
    await log(r.id, actor, 'warned', why); await logAdmin({ actorId: actor, targetType: 'channel', targetId: r.chat_id, type: 'chan_mod_warn', detail: why.slice(0, 200) });
    return { ok: true, status: 'closed' };
  }
  if (action === 'restrict') {
    if (!r.serious) return { error: 'not_serious' };
    if (confirm !== true) return { error: 'confirm_required' };
    if (why.length < 10) return { error: 'reason_required' };
    const h = Math.max(1, Math.min(720, Math.trunc(Number(hours)) || s.restrictHours));
    const out = await restrictNow(actor, r.id, r.chat_id, why, h);
    if (out.error) return out;
    await logAdmin({ actorId: actor, targetType: 'channel', targetId: r.chat_id, type: 'chan_mod_restrict', detail: `${h} ч: ${why}`.slice(0, 200) });
    return { ok: true, status: 'restricted', hours: h };
  }
  return { error: 'bad_action' };
};

/* ─── Владелец канала: статус и обжалование ─── */
export const ownerCases = async (me) => {
  const rows = (await query(`SELECT c.id, c.chat_id, c.status, c.freeze_id, c.created_at, ch.name, f.expires_at, f.public_reason FROM chan_mod_cases c JOIN chats ch ON ch.id = c.chat_id LEFT JOIN acct_freezes f ON f.id = c.freeze_id
    WHERE ch.owner_id = $1 AND c.status IN ('restricted','appealed','restored','closed') ORDER BY c.created_at DESC LIMIT 20`, [me])).rows;
  return { items: rows.map((r) => ({ id: r.id, chatId: r.chat_id, title: decryptContent(r.name) ?? r.name, status: r.status, until: r.expires_at ?? undefined, reason: r.public_reason || undefined, canAppeal: r.status === 'restricted' && Boolean(r.freeze_id) })) };
};
export const appealCase = async (me, caseId, text) => {
  const r = (await query('SELECT c.*, ch.owner_id FROM chan_mod_cases c JOIN chats ch ON ch.id = c.chat_id WHERE c.id = $1', [String(caseId ?? '')])).rows[0];
  if (!r || r.owner_id !== me) return { error: 'not_found' };
  if (r.status !== 'restricted' || !r.freeze_id) return { error: 'bad_state' };
  const a = await freezeAppeal(me, { freezeId: r.freeze_id, text });
  if (a.error) return a;
  await query(`UPDATE chan_mod_cases SET status = 'appealed', updated_at = now() WHERE id = $1 AND status = 'restricted'`, [r.id]);
  await log(r.id, me, 'appealed', '');
  void notifyStaff('channel_mod_case', { title: 'Апелляция владельца канала', body: 'Нужно решение по апелляции.', dedupe: `${r.id}:appeal` });
  return { ok: true };
};
export const decideCaseAppeal = async (actor, caseId, { outcome, note } = {}) => {
  const g = await guard(actor); if (g) return g;
  const r = (await query('SELECT * FROM chan_mod_cases WHERE id = $1', [String(caseId ?? '')])).rows[0]; if (!r) return { error: 'not_found' };
  if (!['appealed', 'restricted'].includes(r.status)) return { error: 'bad_state' };
  const a = (await query(`SELECT id FROM acct_freeze_appeals WHERE freeze_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 1`, [r.freeze_id])).rows[0]; if (!a) return { error: 'bad_state' };
  const owner = await isOwner(actor);
  const d = await freezeDecideAppeal(actor, a.id, outcome === 'accepted' ? 'accepted' : 'rejected', note, { owner });
  if (d.error) return d;
  await query(`UPDATE chan_mod_cases SET status = $2, updated_at = now() WHERE id = $1`, [r.id, outcome === 'accepted' ? 'restored' : 'restricted']);
  if (outcome === 'accepted') await query(`UPDATE chan_mod_reports SET outcome = 'dismissed' WHERE chat_id = $1`, [r.chat_id]);
  await log(r.id, actor, outcome === 'accepted' ? 'appeal_accepted' : 'appeal_rejected', clean(note, 300));
  return { ok: true, status: outcome === 'accepted' ? 'restored' : 'restricted' };
};
