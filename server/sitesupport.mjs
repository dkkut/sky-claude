/**
 * Тех. поддержка на лендинге. Не отдельная система: обращение с сайта — это обычный тикет из server/support.mjs
 * (та же очередь «Поддержка» в админке, те же статусы, ответственный, история). Отличия:
 *   — автора-профиля нет (человек может не иметь аккаунта — например, не может войти); `source = 'site'`;
 *   — контакт — почта (хранится зашифрованной, для поиска — HMAC-хеш); код обращения `SUP-XXXX-XXXX`;
 *   — по коду + почте человек смотрит статус и переписку и отвечает прямо на сайте; ответ поддержки дублируется ему на почту.
 * Ничего из того, что человек не вправе видеть, наружу не уходит: только его же сообщения и ответы поддержки по ЕГО тикету.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { sendEmail } from './notify.mjs';

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const cleanMulti = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => { const r = Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join(''); return `SUP-${r.slice(0, 4)}-${r.slice(4)}`; };
const emailHash = (e) => crypto.createHmac('sha256', `${config.jwtSecret}:site-support:v1`).update(String(e).toLowerCase()).digest('hex');
const newId = (p) => `${p}-${crypto.randomUUID()}`;

/** Темы формы → вид тикета и подпись в очереди. Список ведёт сервер. */
const TOPICS = {
  login: { kind: 'question', ru: 'Вход и аккаунт', en: 'Sign-in and account' },
  blocked: { kind: 'appeal', ru: 'Блокировка', en: 'Block' },
  payment: { kind: 'question', ru: 'Платежи и Prime', en: 'Payments and Prime' },
  bug: { kind: 'bug', ru: 'Ошибка в приложении', en: 'App bug' },
  download: { kind: 'bug', ru: 'Скачивание и установка', en: 'Download and install' },
  idea: { kind: 'idea', ru: 'Предложение', en: 'Suggestion' },
  other: { kind: 'question', ru: 'Другое', en: 'Other' },
};
const PLATFORMS = new Set(['web', 'android', 'windows', 'ios', 'macos', 'linux', 'other']);
const PER_EMAIL_PER_DAY = 5;

export const siteSupportTopics = () => Object.entries(TOPICS).map(([key, v]) => ({ key, ru: v.ru, en: v.en }));

export const submitSiteTicket = async (b, { ip }) => {
  const email = clean(b?.email, 254).toLowerCase();
  const topic = TOPICS[String(b?.topic)] ? String(b.topic) : '';
  const text = cleanMulti(b?.body, 4000);
  if (!EMAIL_RE.test(email)) return { error: 'bad_email' };
  if (!topic) return { error: 'bad_topic' };
  if (text.length < 10) return { error: 'text_too_short' };
  const lang = b?.lang === 'en' ? 'en' : 'ru';
  const h = emailHash(email);
  const { rows: recent } = await query(`SELECT count(*)::int AS n FROM support_tickets WHERE guest_hash = $1 AND created_at > now() - interval '1 day'`, [h]);
  if ((recent[0]?.n ?? 0) >= PER_EMAIL_PER_DAY) return { error: 'too_many' };

  const t = TOPICS[topic];
  const subject = clean(b?.subject, 120) || t.ru;
  const platform = PLATFORMS.has(String(b?.platform)) ? String(b.platform) : '';
  const lines = [
    'Источник: сайт (лендинг), без входа в аккаунт',
    `Тема: ${t.ru}`,
    `Ник в Sky (со слов человека, не проверен): ${clean(b?.username, 64).replace(/^@/, '') || '—'}`,
    `Платформа: ${platform || '—'}${clean(b?.version, 40) ? `, версия ${clean(b?.version, 40)}` : ''}`,
    `Язык сайта: ${lang}`,
    '',
    text,
  ];
  const id = newId('tk'); const code = newCode();
  await query(
    `INSERT INTO support_tickets (id, author_id, subject, kind, source, guest_email, guest_hash, guest_code, guest_lang)
     VALUES ($1, NULL, $2, $3, 'site', $4, $5, $6, $7)`,
    [id, encryptContent(`[Сайт] ${subject}`), t.kind, encryptContent(email), h, code, lang]);
  await query(`INSERT INTO support_messages (id, ticket_id, author_id, from_staff, body) VALUES ($1,$2,NULL,FALSE,$3)`,
    [newId('sm'), id, encryptContent(lines.join('\n'))]);
  await query(`INSERT INTO support_events (id, ticket_id, actor_id, type, detail) VALUES ($1,$2,NULL,'created',$3)`,
    [newId('se'), id, encryptContent('Обращение создано на сайте')]);
  await sendEmail(email,
    lang === 'en' ? `Sky support request received: ${code}` : `Обращение в поддержку Sky принято: ${code}`,
    lang === 'en'
      ? `We received your request. Number: ${code}\nYou can check the status and reply on the site (Support page) using this number and your email. Our answer will also arrive by email.`
      : `Мы получили ваше обращение. Номер: ${code}\nСтатус и ответы можно смотреть на сайте (страница «Поддержка») по этому номеру и вашей почте. Ответ поддержки придёт и на почту.`).catch(() => {});
  return { ok: true, code };
};

const findTicket = async (code, email) => {
  const e = clean(email, 254).toLowerCase();
  if (!EMAIL_RE.test(e)) return null;
  const { rows } = await query(`SELECT * FROM support_tickets WHERE guest_code = $1 AND guest_hash = $2`, [String(code ?? '').toUpperCase().trim(), emailHash(e)]);
  return rows[0] ?? null;
};

const STATUS = { open: 'Принято', in_progress: 'В работе', waiting: 'Ждём вашего ответа', closed: 'Закрыто' };

/** Статус и переписка по коду + почте. Чужого не отдаст: без верной пары — «не найдено». */
export const checkSiteTicket = async (code, email) => {
  const t = await findTicket(code, email);
  if (!t) return { error: 'not_found' };
  const { rows: msgs } = await query('SELECT from_staff, body, created_at FROM support_messages WHERE ticket_id = $1 ORDER BY created_at', [t.id]);
  return {
    ok: true, code: t.guest_code, status: t.status, statusText: STATUS[t.status] ?? t.status, createdAt: t.created_at.toISOString(),
    // Первое сообщение — служебная шапка с их же данными; показываем как есть: это то, что человек сам отправил.
    messages: msgs.map((m) => ({ fromStaff: m.from_staff, body: decryptContent(m.body) ?? '', createdAt: m.created_at.toISOString() })),
  };
};

export const replySiteTicket = async (code, email, body) => {
  const t = await findTicket(code, email);
  if (!t) return { error: 'not_found' };
  const text = cleanMulti(body, 4000);
  if (text.length < 2) return { error: 'text_too_short' };
  if (t.status === 'closed') return { error: 'closed' };
  const { rows: recent } = await query(`SELECT count(*)::int AS n FROM support_messages WHERE ticket_id = $1 AND NOT from_staff AND created_at > now() - interval '1 hour'`, [t.id]);
  if ((recent[0]?.n ?? 0) >= 20) return { error: 'too_many' };
  await query(`INSERT INTO support_messages (id, ticket_id, author_id, from_staff, body) VALUES ($1,$2,NULL,FALSE,$3)`, [newId('sm'), t.id, encryptContent(text)]);
  await query(`UPDATE support_tickets SET status = CASE WHEN status = 'waiting' THEN 'open' ELSE status END, updated_at = now() WHERE id = $1`, [t.id]);
  return { ok: true };
};

/** Ответ поддержки по тикету с сайта дублируется на почту человека (вызывается из support.mjs). */
export const emailGuestReply = async (ticketRow, text) => {
  try {
    if (ticketRow?.source !== 'site' || !ticketRow.guest_email) return;
    const to = decryptContent(ticketRow.guest_email);
    if (!to) return;
    const en = ticketRow.guest_lang === 'en';
    await sendEmail(to,
      en ? `Sky support replied: ${ticketRow.guest_code}` : `Поддержка Sky ответила: ${ticketRow.guest_code}`,
      `${String(text).slice(0, 3000)}\n\n— ${en ? `Request ${ticketRow.guest_code}. Reply on the site (Support page) with this number and your email.` : `Обращение ${ticketRow.guest_code}. Ответить можно на сайте (страница «Поддержка») по этому номеру и вашей почте.`}`);
  } catch { /* письмо не должно мешать ответу в очереди */ }
};
