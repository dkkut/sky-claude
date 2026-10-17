/**
 * Заявки на восстановление доступа через общую техническую поддержку Sky.
 *
 * Не отдельная система тикетов: заявка = строка `recovery_cases` + обычный тикет `support_tickets` (`source = 'recovery'`), переписка лежит в
 * `support_messages`, сотрудники отвечают в той же очереди. Почта служит ТОЛЬКО уведомлением («есть новый ответ»): текста сообщений в письмах нет.
 *
 * Доступ к чату заявки у человека, потерявшего вход, — отдельный ограниченный ключ `<id>.<секрет>` (в базе хеш): он открывает ровно одну заявку —
 * читать переписку, писать, смотреть статус — и больше ничего (ни профиль, ни кошелёк, ни админку, ни чужие обращения). Ключ выдаётся при создании заявки
 * и при необходимости присылается заново на ПОДТВЕРЖДЁННУЮ контактную почту (при этом прежний ключ отзывается).
 *
 * Решение поддержки «Восстановление разрешено» само доступа не даёт: оно лишь добавляет в сценарий восстановления фактор `support_case`, после которого
 * действуют обычные проверки и ожидание. Заявки администраторов разрешает только владелец; заявки владельца через панель не разрешаются вовсе (консольный скрипт).
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { can, isOwner } from './admin.mjs';
import { sendEmail } from './notify.mjs';
import { L } from './lang.mjs';
import { findSkyIdByEmail, findSkyIdById, findSkyIdByPhone } from './skyid.mjs';
import { newId, randomSecret, hashSecret, safeEqual, attempt, ipHash, record, recoveryOrigin, EMAIL_RE, normEmail, maskEmail } from './recoverycore.mjs';
import { notifyStaff } from './staffnotify.mjs';

const err = (error, extra = {}) => ({ error, ...extra });
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const multi = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);

export const REASONS = {
  forgot_password: 'Забыл пароль', lost_backup_email: 'Потерял доступ к резервной почте', lost_authenticator: 'Потерял доступ к приложению-аутентификатору',
  lost_both: 'Потерял доступ к обоим факторам', lost_backup_codes: 'Потерял резервные коды', suspected_hack: 'Подозреваю взлом аккаунта',
  auto_failed: 'Не работает автоматическое восстановление', other: 'Другая причина',
};
const METHODS_LOST = ['password', 'primary_email', 'phone', 'backup_email', 'authenticator', 'backup_codes', 'admin_token', 'owner_secret', 'trusted_devices'];
export const STATUSES = {
  new: 'Ожидает рассмотрения', review: 'На рассмотрении', waiting_user: 'Ожидает ответа пользователя', security_check: 'На проверке безопасности',
  allowed: 'Восстановление разрешено', resolved: 'Решена', rejected: 'Отклонена', closed: 'Закрыта',
};
const DONE = new Set(['resolved', 'rejected', 'closed']);
const TICKET_STATUS = { new: 'open', review: 'in_progress', waiting_user: 'waiting', security_check: 'in_progress', allowed: 'in_progress', resolved: 'closed', rejected: 'closed', closed: 'closed' };
const MAX_MSG = 4000;

const accessKey = (c) => `${c.id}.${c.secret}`;
const hashAccess = (secret) => hashSecret('casekey', secret);

const log = (caseId, actorId, event, detail = '') => query('INSERT INTO recovery_case_log (case_id, actor_id, event, detail) VALUES ($1,$2,$3,$4)', [caseId, actorId ?? null, event, String(detail).slice(0, 300)]);

/* ─── Почта-уведомление ─────────────────────────────────────────────── */
const MAIL = {
  created: (n) => [L(`Sky — обращение №${n} создано`, `Sky — request #${n} created`), L(`Обращение №${n} по восстановлению доступа создано. Следите за статусом и общайтесь со специалистом в чате обращения. Когда специалист ответит, мы пришлём уведомление на эту почту.`, `Request #${n} about access recovery was created. Track its status and chat with the specialist in the request chat. We will notify this address when the specialist replies.`)],
  reply: (n) => [L(`Sky — новый ответ по обращению №${n}`, `Sky — new reply to request #${n}`), L(`По вашему обращению №${n} поступил новый ответ от технической поддержки Sky.\n\nЧтобы прочитать сообщение и ответить специалисту, откройте чат обращения. Это автоматическое уведомление. Переписка ведётся исключительно в чате поддержки.`, `A new reply arrived to your request #${n} from Sky support.\n\nOpen the request chat to read it and answer. This is an automatic notice; the conversation takes place only in the support chat.`)],
  status: (n, s) => [L(`Sky — статус обращения №${n} изменён`, `Sky — request #${n} status changed`), L(`Статус обращения №${n}: «${STATUSES[s]}». Подробности — в чате обращения.`, `Status of request #${n} changed. Details are in the request chat.`)],
  info: (n) => [L(`Sky — по обращению №${n} нужны сведения`, `Sky — more information needed for request #${n}`), L(`Специалист поддержки запросил дополнительные сведения по обращению №${n}. Ответьте в чате обращения.`, `A support specialist requested more information for request #${n}. Please reply in the request chat.`)],
  allowed: (n) => [L(`Sky — восстановление по обращению №${n} разрешено`, `Sky — recovery for request #${n} approved`), L(`По обращению №${n} разрешено восстановление. Доступ сам по себе не открывается: перейдите на сайт восстановления и пройдите защищённую процедуру.`, `Recovery for request #${n} is approved. Access does not open by itself: go to the recovery site and complete the secure procedure.`)],
  rejected: (n) => [L(`Sky — по обращению №${n} отказано`, `Sky — request #${n} declined`), L(`По обращению №${n} вынесено решение: в восстановлении отказано (недостаточно подтверждений). Подробности — в чате обращения.`, `A decision was made on request #${n}: recovery declined (not enough proof). Details are in the chat.`)],
  closed: (n) => [L(`Sky — обращение №${n} закрыто`, `Sky — request #${n} closed`), L(`Обращение №${n} закрыто. Если вопрос не решён, откройте чат обращения и напишите — его можно открыть повторно.`, `Request #${n} is closed. If the issue is not solved, open the request chat — it can be reopened.`)],
};

/** Очередь писем: одно событие — одно письмо (ключ), ошибка доставки не теряет сообщение, письмо можно повторить. */
export const enqueueMail = async (c, kind, key, arg) => {
  const k = `${c.id}:${kind}:${key}`;
  const ins = await query(`INSERT INTO recovery_case_mail (event_key, case_id, kind) VALUES ($1,$2,$3) ON CONFLICT (event_key) DO NOTHING RETURNING event_key`, [k, c.id, kind]);
  if (!ins.rowCount) return { duplicate: true };
  return deliver(k, c, kind, arg);
};

const deliver = async (key, c, kind, arg) => {
  if (!c.contact_ok || !c.contact_email) {
    await query(`UPDATE recovery_case_mail SET status = 'failed', last_error = 'contact_not_confirmed', attempts = attempts + 1 WHERE event_key = $1`, [key]);
    return { ok: false, error: 'contact_not_confirmed' };
  }
  const [subj, body] = (MAIL[kind] ?? MAIL.status)(c.number, arg ?? c.status);
  const r = await sendEmail(c.contact_email, subj, `${body}\n\n${L('Открыть чат поддержки', 'Open the support chat')}: ${recoveryOrigin()}/case\n${L('Официальный сайт', 'Official site')}: ${recoveryOrigin()}`).catch((e) => ({ ok: false, error: e.message }));
  if (r?.ok === false) { await query(`UPDATE recovery_case_mail SET status = 'failed', last_error = $2, attempts = attempts + 1 WHERE event_key = $1`, [key, String(r.error ?? 'send_failed').slice(0, 160)]); return { ok: false, error: r.error }; }
  await query(`UPDATE recovery_case_mail SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = '' WHERE event_key = $1`, [key]);
  return { ok: true };
};

/** Повтор неудавшихся уведомлений (почасовая уборка). Не более 5 попыток на письмо. */
export const retryMail = async () => {
  const { rows } = await query(`SELECT m.event_key, m.kind, c.* FROM recovery_case_mail m JOIN recovery_cases c ON c.id = m.case_id WHERE m.status <> 'sent' AND m.attempts < 5 AND c.contact_ok ORDER BY m.created_at LIMIT 50`);
  let n = 0;
  for (const r of rows) { const d = await deliver(r.event_key, r, r.kind); if (d.ok) n += 1; }
  return n;
};

/* ─── Создание ──────────────────────────────────────────────────────── */

const resolveAccount = async (input) => {
  const v = clean(input, 200); if (!v) return null;
  if (v.includes('@') && !v.startsWith('@')) return findSkyIdByEmail(v.toLowerCase());
  if (/^\+?[\d\s()-]{7,20}$/.test(v)) return findSkyIdByPhone(v.replace(/[\s()-]/g, ''));
  if (/^sky-[a-z0-9-]{8,}$/i.test(v)) return findSkyIdById(v);
  const { rows } = await query('SELECT sky_id FROM profiles WHERE lower(username) = $1 AND deleted_at IS NULL LIMIT 1', [v.replace(/^@/, '').toLowerCase()]);
  return rows[0] ? findSkyIdById(rows[0].sky_id) : null;
};

/** Бланк. `session` — { skyId, profileId } вошедшего человека (тогда данные аккаунта берутся из сессии, а не из полей формы). */
export const createCase = async (b, { ip, session }) => {
  if (b?.website) return { ok: true, number: 'SR-00000', accessKey: 'x.x' };              // ловушка для ботов: делаем вид, что приняли
  const h = ipHash(ip);
  if (!(await attempt(`case:ip:${h}`, 10, 3600)) || !(await attempt(`case:ipd:${h}`, 30, 86400))) return err('too_many_requests');
  const reason = Object.hasOwn(REASONS, b?.reason) ? b.reason : null; if (!reason) return err('bad_field', { field: 'reason' });
  const description = multi(b?.description, 3000); if (description.length < 20) return err('bad_field', { field: 'description' });
  const accountType = ['user', 'admin', 'owner'].includes(b?.accountType) ? b.accountType : 'user';
  const lost = Array.isArray(b?.lostMethods) ? b.lostMethods.filter((x) => METHODS_LOST.includes(x)).slice(0, 9) : [];
  const idem = clean(b?.idempotencyKey, 64);

  let row = null; let profileId = null; let contact = ''; let contactOk = false;
  if (session?.skyId) {
    row = await findSkyIdById(session.skyId); profileId = session.profileId ?? null;
    if (row?.email && row.email_verified) { contact = normEmail(row.email); contactOk = true; }
  } else row = await resolveAccount(b?.skyId);
  const typed = normEmail(b?.newNotifyEmail || b?.contactEmail);
  if (!contactOk) { if (!EMAIL_RE.test(typed)) return err('bad_field', { field: 'contactEmail' }); contact = typed; }
  if (!(await attempt(`case:mail:${contact}`, 3, 86400))) return err('too_many_requests');

  if (idem) { const d = await query('SELECT number FROM recovery_cases WHERE idem_key = $1', [idem]); if (d.rows[0]) return { ok: true, duplicate: true, number: d.rows[0].number }; }
  // Незакрытая заявка по тому же аккаунту/почте и той же причине — не плодим дубль.
  const dup = await query(`SELECT number FROM recovery_cases WHERE (($1::text IS NOT NULL AND sky_id = $1) OR contact_email = $2) AND reason = $3 AND account_kind = $4 AND status NOT IN ('resolved','rejected','closed') AND created_at > now() - interval '3 days' LIMIT 1`, [row?.id ?? null, contact, reason, accountType]);
  if (dup.rows[0]) return { ok: true, duplicate: true, number: dup.rows[0].number };

  const id = newId('rcs'); const secret = randomSecret(24);
  const { rows: seq } = await query(`SELECT nextval('recovery_case_seq') AS n`);
  const number = `SR-${seq[0].n}`;
  const confirm = contactOk ? null : randomSecret(24);
  const form = { skyIdTyped: clean(b?.skyId, 200), profileName: clean(b?.profileName, 120), accountType, reason, lastLogin: clean(b?.lastLogin, 80), whenStarted: clean(b?.whenStarted, 120),
    lost, attempts: multi(b?.attempts, 1500), description, extra: multi(b?.extra, 1500), oldMailAccess: b?.oldMailAccess === 'yes' ? 'yes' : 'no', lang: b?.lang === 'en' ? 'en' : 'ru' };
  const tid = newId('tk');
  await query(`INSERT INTO support_tickets (id, author_id, subject, kind, source) VALUES ($1,$2,$3,'appeal','recovery')`, [tid, profileId, encryptContent(`[Восстановление] ${number} — ${REASONS[reason]}`)]);
  const first = [`Заявка на восстановление доступа ${number}`, `Тип аккаунта: ${accountType === 'owner' ? 'владелец Sky' : accountType === 'admin' ? 'администратор' : 'пользователь'}`, `Причина: ${REASONS[reason]}`, `Недоступные способы: ${lost.join(', ') || '—'}`, '', description].join('\n');
  await query(`INSERT INTO support_messages (id, ticket_id, author_id, from_staff, body) VALUES ($1,$2,$3,FALSE,$4)`, [newId('sm'), tid, profileId, encryptContent(first)]);
  await query(`INSERT INTO recovery_cases (id, number, sky_id, profile_id, account_kind, reason, form_enc, contact_email, contact_ok, contact_hash, ticket_id, access_hash, idem_key, ip_hash, unread_staff, last_message_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1, now())`,
    [id, number, row?.id ?? null, profileId, accountType, reason, encryptContent(JSON.stringify(form)), contact, contactOk, confirm ? hashSecret('casecontact', confirm) : null, tid, hashAccess(secret), idem || null, h]);
  await log(id, profileId, 'created', `${accountType}/${reason}`);
  void notifyStaff('recovery', { title: 'Новая заявка на восстановление доступа', body: `Заявка ${number}`, dedupe: id, except: profileId });
  await record({ skyId: row?.id ?? null, kind: accountType, event: 'case_created', ip, detail: number });
  const c = (await query('SELECT * FROM recovery_cases WHERE id = $1', [id])).rows[0];
  if (contactOk) await enqueueMail(c, 'created', '1');
  else sendEmail(contact, L(`Sky — подтвердите почту для уведомлений (${number})`, `Sky — confirm your email for notifications (${number})`),
    L(`Чтобы получать уведомления о новых ответах по обращению ${number}, подтвердите этот адрес:\n${recoveryOrigin()}/case-contact#t=${confirm}\n\nПодтверждение адреса не подтверждает владение аккаунтом. Если вы ничего не создавали — проигнорируйте письмо.`,
      `To receive notifications about replies to request ${number}, confirm this address:\n${recoveryOrigin()}/case-contact#t=${confirm}\n\nConfirming the address does not prove ownership of the account. If you did nothing, ignore this email.`)).catch(() => {});
  return { ok: true, number, accessKey: accessKey({ id, secret }), contactConfirmed: contactOk };
};

export const confirmContact = async (token) => {
  if (typeof token !== 'string' || token.length < 20) return err('invalid_link');
  const { rows } = await query(`UPDATE recovery_cases SET contact_ok = TRUE, contact_hash = NULL WHERE contact_hash = $1 RETURNING *`, [hashSecret('casecontact', token)]);
  if (!rows[0]) return err('invalid_link');
  await log(rows[0].id, null, 'contact_confirmed', maskEmail(rows[0].contact_email));
  await enqueueMail(rows[0], 'created', '1');
  return { ok: true, number: rows[0].number };
};

/** Новый ключ доступа к чату — на подтверждённую контактную почту; прежний ключ отзывается. Ответ одинаков при любом исходе. */
export const resendAccess = async ({ number, email, ip }) => {
  const h = ipHash(ip);
  if (!(await attempt(`caseacc:ip:${h}`, 6, 3600)) || !(await attempt(`caseacc:n:${String(number).slice(0, 20)}`, 4, 3600))) return err('too_many_requests');
  const { rows } = await query('SELECT * FROM recovery_cases WHERE number = $1', [clean(number, 20).toUpperCase()]);
  const c = rows[0];
  if (c && c.contact_ok && c.contact_email === normEmail(email)) {
    const secret = randomSecret(24);
    await query('UPDATE recovery_cases SET access_hash = $2 WHERE id = $1', [c.id, hashAccess(secret)]);
    sendEmail(c.contact_email, L(`Sky — доступ к чату обращения ${c.number}`, `Sky — access to the chat of request ${c.number}`),
      L(`Ссылка для входа в чат обращения ${c.number} (прежние ссылки отозваны):\n${recoveryOrigin()}/case#k=${accessKey({ id: c.id, secret })}\n\nСсылка открывает только это обращение.`, `Link to the chat of request ${c.number} (older links are revoked):\n${recoveryOrigin()}/case#k=${accessKey({ id: c.id, secret })}\n\nThe link opens only this request.`)).catch(() => {});
    await log(c.id, null, 'access_resent');
  }
  return { ok: true, message: 'Если обращение найдено и почта подтверждена, мы отправили новую ссылку.' };
};

/* ─── Чат (ограниченный доступ по ключу) ───────────────────────────── */

export const byKey = async (key) => {
  const [id, secret] = String(key ?? '').split('.');
  if (!id || !secret || id.length > 64 || secret.length > 128) return null;
  const { rows } = await query('SELECT * FROM recovery_cases WHERE id = $1', [id]);
  return rows[0] && safeEqual(rows[0].access_hash, hashAccess(secret)) ? rows[0] : null;
};

const messagesOf = async (c) => {
  const { rows } = await query('SELECT id, from_staff, body, created_at FROM support_messages WHERE ticket_id = $1 ORDER BY created_at', [c.ticket_id]);
  return rows.map((m) => ({ id: m.id, fromStaff: m.from_staff, author: m.from_staff ? 'Поддержка Sky' : 'Вы', body: decryptContent(m.body) ?? '', at: m.created_at.toISOString() }));
};

export const viewForUser = async (c, { markRead = true } = {}) => {
  if (markRead && c.unread_user) await query('UPDATE recovery_cases SET unread_user = 0 WHERE id = $1', [c.id]);
  const { rows: ev } = await query('SELECT event, created_at FROM recovery_case_log WHERE case_id = $1 AND event LIKE \'status:%\' ORDER BY id', [c.id]);
  return { number: c.number, status: c.status, statusLabel: STATUSES[c.status], reason: REASONS[c.reason], accountKind: c.account_kind, createdAt: c.created_at.toISOString(), contactConfirmed: c.contact_ok,
    canReply: !['closed'].includes(c.status), canReopen: DONE.has(c.status), history: ev.map((e) => ({ status: e.event.slice(7), label: STATUSES[e.event.slice(7)], at: e.created_at.toISOString() })), messages: await messagesOf(c) };
};

export const userMessage = async (c, text, ip) => {
  const body = multi(text, MAX_MSG); if (!body) return err('empty');
  if (c.status === 'closed') return err('closed');
  if (!(await attempt(`casemsg:${c.id}`, 20, 3600)) || !(await attempt(`casemsg:ip:${ipHash(ip)}`, 60, 3600))) return err('too_many_requests');
  await query(`INSERT INTO support_messages (id, ticket_id, author_id, from_staff, body) VALUES ($1,$2,$3,FALSE,$4)`, [newId('sm'), c.ticket_id, c.profile_id, encryptContent(body)]);
  const next = c.status === 'waiting_user' ? 'review' : c.status;
  await query(`UPDATE recovery_cases SET unread_staff = unread_staff + 1, last_message_at = now(), updated_at = now(), status = $2 WHERE id = $1`, [c.id, next]);
  await query(`UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1`, [c.ticket_id, TICKET_STATUS[next]]);
  if (next !== c.status) await log(c.id, null, `status:${next}`, 'ответ пользователя');
  return { ok: true };
};

export const reopen = async (c) => {
  if (!DONE.has(c.status)) return err('not_closed');
  if (c.updated_at < new Date(Date.now() - 30 * 86400_000)) return err('too_old');
  await query(`UPDATE recovery_cases SET status = 'review', updated_at = now(), unread_staff = unread_staff + 1 WHERE id = $1`, [c.id]);
  await query(`UPDATE support_tickets SET status = 'open', closed_at = NULL, updated_at = now() WHERE id = $1`, [c.ticket_id]);
  await log(c.id, null, 'status:review', 'повторно открыто пользователем');
  return { ok: true };
};

/* ─── Сотрудники ────────────────────────────────────────────────────── */

const canSeeKind = async (staffId, kind) => (kind === 'user' ? can(staffId, 'support') : can(staffId, 'security'));

export const staffList = async (staffId, { tab = 'all', q = '', type = '', sort = 'activity', limit = 100 } = {}) => {
  if (!(await can(staffId, 'support'))) return err('not_allowed');
  const w = []; const a = [];
  const seeAll = await can(staffId, 'security');
  if (!seeAll) w.push(`account_kind = 'user'`);
  const TABS = { new: ['new'], review: ['review'], waiting_user: ['waiting_user'], security_check: ['security_check'], allowed: ['allowed'], resolved: ['resolved'], closed: ['closed', 'rejected'] };
  if (TABS[tab]) { a.push(TABS[tab]); w.push(`status = ANY($${a.length})`); }
  if (['user', 'admin', 'owner'].includes(type)) { a.push(type); w.push(`account_kind = $${a.length}`); }
  const qq = clean(q, 80);
  if (qq) { a.push(`%${qq.toLowerCase()}%`); w.push(`(lower(number) LIKE $${a.length} OR lower(coalesce(sky_id,'')) LIKE $${a.length})`); }
  a.push(Math.min(200, Math.max(1, limit)));
  const order = sort === 'created' ? 'created_at DESC' : 'coalesce(last_message_at, created_at) DESC';
  const { rows } = await query(`SELECT * FROM recovery_cases ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY ${order} LIMIT $${a.length}`, a);
  return { items: rows.map((c) => ({ id: c.id, number: c.number, skyId: c.sky_id, accountKind: c.account_kind, reason: REASONS[c.reason], createdAt: c.created_at.toISOString(), lastMessageAt: c.last_message_at?.toISOString?.() ?? null,
    status: c.status, statusLabel: STATUSES[c.status], assigneeId: c.assignee_id, unread: c.unread_staff })) };
};

export const staffDetail = async (staffId, id) => {
  if (!(await can(staffId, 'support'))) return err('not_allowed');
  const c = (await query('SELECT * FROM recovery_cases WHERE id = $1', [String(id)])).rows[0];
  if (!c) return err('not_found');
  if (!(await canSeeKind(staffId, c.account_kind))) return err('not_allowed');
  await query('UPDATE recovery_cases SET unread_staff = 0 WHERE id = $1', [c.id]);
  const { rows: ev } = await query('SELECT actor_id, event, detail, created_at FROM recovery_case_log WHERE case_id = $1 ORDER BY id', [c.id]);
  const hist = c.sky_id ? (await query('SELECT kind, event, factor, result, created_at FROM recovery_history WHERE sky_id = $1 ORDER BY id DESC LIMIT 40', [c.sky_id])).rows : [];
  let form = {}; try { form = JSON.parse(decryptContent(c.form_enc) ?? '{}'); } catch { /* повреждённый бланк показываем пустым */ }
  return { id: c.id, number: c.number, skyId: c.sky_id, accountKind: c.account_kind, reasonLabel: REASONS[c.reason], status: c.status, statusLabel: STATUSES[c.status], assigneeId: c.assignee_id, contactEmail: maskEmail(c.contact_email), contactConfirmed: c.contact_ok,
    createdAt: c.created_at.toISOString(), form, messages: await messagesOf(c),
    events: ev.map((e) => ({ actorId: e.actor_id, event: e.event, detail: e.detail, at: e.created_at.toISOString() })),
    securityHistory: hist.map((h) => ({ kind: h.kind, event: h.event, factor: h.factor || undefined, result: h.result, at: h.created_at.toISOString() })),
    mail: (await query('SELECT kind, status, attempts, last_error FROM recovery_case_mail WHERE case_id = $1 ORDER BY created_at DESC LIMIT 20', [c.id])).rows,
    statuses: Object.entries(STATUSES).map(([k, v]) => ({ key: k, label: v })) };
};

export const staffReply = async (staffId, id, text) => {
  const c = (await query('SELECT * FROM recovery_cases WHERE id = $1', [String(id)])).rows[0]; if (!c) return err('not_found');
  if (!(await can(staffId, 'support')) || !(await canSeeKind(staffId, c.account_kind))) return err('not_allowed');
  const body = multi(text, MAX_MSG); if (!body) return err('empty');
  if (c.status === 'closed') return err('closed');
  const mid = newId('sm');
  await query(`INSERT INTO support_messages (id, ticket_id, author_id, from_staff, body) VALUES ($1,$2,$3,TRUE,$4)`, [mid, c.ticket_id, staffId, encryptContent(body)]);
  const next = c.status === 'new' ? 'review' : c.status;
  await query(`UPDATE recovery_cases SET unread_user = unread_user + 1, last_message_at = now(), updated_at = now(), status = $2, assignee_id = coalesce(assignee_id, $3) WHERE id = $1`, [c.id, next, staffId]);
  await query(`UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1`, [c.ticket_id, TICKET_STATUS[next]]);
  if (next !== c.status) await log(c.id, staffId, `status:${next}`);
  await log(c.id, staffId, 'reply', mid);
  const mail = await enqueueMail({ ...c, status: next }, 'reply', mid);
  return { ok: true, mail: mail.ok === false ? 'failed' : mail.duplicate ? 'duplicate' : 'sent' };
};

export const staffSetStatus = async (staffId, id, status, note = '') => {
  if (!Object.hasOwn(STATUSES, status)) return err('bad_status');
  const c = (await query('SELECT * FROM recovery_cases WHERE id = $1', [String(id)])).rows[0]; if (!c) return err('not_found');
  if (!(await can(staffId, 'support')) || !(await canSeeKind(staffId, c.account_kind))) return err('not_allowed');
  if (status === 'allowed') {
    if (c.account_kind === 'owner') return err('console_only');                 // заявки владельца через панель не разрешаются
    if (c.account_kind === 'admin' ? !(await isOwner(staffId)) : !(await can(staffId, 'security'))) return err('not_allowed');
    if (!c.sky_id) return err('account_not_linked');
  }
  if (c.assignee_id === null) await query('UPDATE recovery_cases SET assignee_id = $2 WHERE id = $1', [c.id, staffId]);
  await query(`UPDATE recovery_cases SET status = $2, updated_at = now(), unread_user = unread_user + 1 WHERE id = $1`, [c.id, status]);
  await query(`UPDATE support_tickets SET status = $2, closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1`, [c.ticket_id, TICKET_STATUS[status]]);
  await log(c.id, staffId, `status:${status}`, clean(note, 200));
  await record({ skyId: c.sky_id, kind: c.account_kind, event: `case_${status}`, detail: c.number, level: status === 'allowed' ? 'WARN' : 'INFO' });
  const mk = { waiting_user: 'info', allowed: 'allowed', rejected: 'rejected', closed: 'closed' }[status] ?? 'status';
  await enqueueMail({ ...c, status }, mk, `${status}:${Date.now()}`, status);
  return { ok: true };
};

/** Факт для сценария восстановления: заявка этого аккаунта разрешена; ключ чата предъявляет сам человек. */
export const verifyCaseFactor = async (skyId, key, kind) => {
  const c = await byKey(key);
  if (!c || c.sky_id !== skyId || c.status !== 'allowed' || c.account_kind !== kind) return false;
  if (kind === 'owner') { const { rows } = await query(`SELECT 1 FROM recovery_case_log WHERE case_id = $1 AND event = 'console_approved'`, [c.id]); if (!rows[0]) return false; }
  return true;
};

export const sweepCases = async () => {
  // Давно решённые заявки закрываются сами; сообщения остаются.
  await query(`UPDATE recovery_cases SET status = 'closed', updated_at = now() WHERE status IN ('resolved','rejected') AND updated_at < now() - interval '14 days'`);
  return retryMail();
};

/** Ответ в тикете восстановления из ОБЩЕГО интерфейса поддержки (support.mjs): заявка и письмо-уведомление обновляются так же, как при ответе из своей панели. */
export const onTicketReply = async (ticketId, fromStaff, messageKey) => {
  const c = (await query('SELECT * FROM recovery_cases WHERE ticket_id = $1', [ticketId])).rows[0];
  if (!c) return;
  if (fromStaff) {
    const next = c.status === 'new' ? 'review' : c.status;
    await query(`UPDATE recovery_cases SET unread_user = unread_user + 1, last_message_at = now(), updated_at = now(), status = $2 WHERE id = $1`, [c.id, next]);
    await enqueueMail({ ...c, status: next }, 'reply', String(messageKey));
  } else {
    await query(`UPDATE recovery_cases SET unread_staff = unread_staff + 1, last_message_at = now(), updated_at = now() WHERE id = $1`, [c.id]);
  }
};

export const caseKind = async (id) => (await query('SELECT account_kind FROM recovery_cases WHERE id = $1', [String(id)])).rows[0]?.account_kind ?? null;
