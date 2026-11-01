/**
 * Официальный бот «Sky» в мессенджере.
 *
 * Обычный профиль-бот (is_bot) и обычный личный чат с человеком: шифрование, сокет, история и пуши — штатные.
 * Пишет только сервер Sky, человеку отвечать боту нельзя (saveMessage отказывает с bot_readonly).
 * Что приходит: рассылки администрации, коды входа (на 15 минут), входы в Sky ID, неверные коды, отклонённые попытки,
 * сообщения «код нельзя передавать». Любой сбой бота ничего не ломает — вызывающий код ждёт не больше, чем нужно, и глотает ошибку.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { encryptContent } from './crypto.mjs';
import { directChatId, saveMessage, memberIds, deleteMessage } from './chats.mjs';
import { pushNewMessage, pushTogether } from './signal.mjs';
import { pushToOffline } from './webpush.mjs';
import { L } from './lang.mjs';
import { SKYBOT_PROFILE, SKYBOT_USERNAME, SKYBOT_NAME } from './skybotid.mjs';
export { SKYBOT_PROFILE };

let ready = false;
const ensureBot = async () => {
  if (ready) return;
  await query(
    `INSERT INTO profiles (id, sky_id, username, name, is_bot) VALUES ($1, NULL, $2, $3, TRUE) ON CONFLICT DO NOTHING`,
    [SKYBOT_PROFILE, SKYBOT_USERNAME, SKYBOT_NAME]);
  ready = true;
};

const newMsgId = () => `m${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;

const stat = (kind, ok) => query(
  `INSERT INTO skybot_stats (day, kind, sent, failed) VALUES (CURRENT_DATE, $1, $2, $3)
   ON CONFLICT (day, kind) DO UPDATE SET sent = skybot_stats.sent + $2, failed = skybot_stats.failed + $3`,
  [kind, ok ? 1 : 0, ok ? 0 : 1]).catch(() => {});

const openChat = async (profileId) => {
  const chatId = directChatId(profileId, SKYBOT_PROFILE);
  const { rowCount } = await query('SELECT 1 FROM chats WHERE id = $1', [chatId]);
  if (!rowCount) {
    await query(
      `INSERT INTO chats (id, type, name, username, avatar, owner_id) VALUES ($1,'direct',$2,'','',$3) ON CONFLICT (id) DO NOTHING`,
      [chatId, encryptContent(''), SKYBOT_PROFILE]);
  }
  await query(
    `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'member'),($1,$3,'member') ON CONFLICT DO NOTHING`,
    [chatId, profileId, SKYBOT_PROFILE]);
  return chatId;
};

/**
 * Отправить человеку (профилю) сообщение от бота.
 * opts: kind — для статистики; expireMin — убрать сообщение через N минут (коды); pushBody — текст пуша (по умолчанию общий, без содержимого).
 * Возвращает сохранённое сообщение или null (человек заблокировал бота, чат в корзине и т. п.).
 */
export const sendFromBot = async (profileId, text, { kind = 'info', expireMin = 0, pushBody = null } = {}) => {
  try {
    if (!profileId || profileId === SKYBOT_PROFILE) return null;
    await ensureBot();
    const chatId = await openChat(profileId);
    const saved = await saveMessage(chatId, SKYBOT_PROFILE, { id: newMsgId(), text: String(text).slice(0, 3900), kind: 'text' });
    if (!saved || saved.error) { await stat(kind, false); return null; }
    pushNewMessage(await memberIds(chatId), chatId, saved);
    if (expireMin > 0) {
      await query(`INSERT INTO skybot_ephemeral (message_id, chat_id, delete_at) VALUES ($1,$2, now() + ($3 || ' minutes')::interval) ON CONFLICT DO NOTHING`,
        [saved.id, chatId, String(expireMin)]);
    }
    void pushToOffline([profileId], {
      title: SKYBOT_NAME, body: pushBody ?? L('Новое сообщение от Sky', 'New message from Sky'), url: '/', tag: `skybot:${kind}`, urgent: kind === 'login_code' || kind === 'security',
    }).catch(() => {});
    await stat(kind, true);
    return saved;
  } catch (e) { console.error('[skybot]', kind, e.message); await stat(kind, false); return null; }
};

/** Все профили одного Sky ID (не удалённые). */
export const profilesOfSky = async (skyId) => {
  const { rows } = await query('SELECT id FROM profiles WHERE sky_id = $1 AND deleted_at IS NULL', [skyId]);
  return rows.map((r) => r.id);
};

export const sendToSky = async (skyId, text, opts) => {
  const ids = await profilesOfSky(skyId);
  const out = await Promise.all(ids.map((id) => sendFromBot(id, text, opts)));
  return out.filter(Boolean).length;
};

/* ── Готовые сообщения ───────────────────────────────────────────── */

const maskIp = (ip) => {
  const s = String(ip ?? '');
  if (s.includes(':')) return s.split(':').slice(0, 3).join(':') + ':…';
  const p = s.split('.'); return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.*` : L('неизвестен', 'unknown');
};
const clipUa = (ua) => String(ua || L('неизвестно', 'unknown')).replace(/[\u0000-\u001f]/g, ' ').slice(0, 120);
const when = () => new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

/** Код входа — виден 15 минут. */
export const botLoginCode = (profileIds, code) => Promise.all(profileIds.map((id) => sendFromBot(id,
  L(`🔐 Код для входа в Sky: ${code}\n\nНикому его не сообщайте — сотрудники Sky его не спрашивают. Если вы не входите в Sky, не вводите код: кто-то пытается войти в ваш аккаунт.`,
    `🔐 Sky sign-in code: ${code}\n\nDo not share it with anyone — Sky staff never ask for it. If you are not signing in, do not enter it: someone is trying to access your account.`),
  { kind: 'login_code', expireMin: 15, pushBody: L('Код для входа в Sky — откройте чат', 'Sky sign-in code — open the chat') })));

/** Успешный вход в Sky ID. */
export const botSignIn = (skyId, meta, { newDevice = false, via = null } = {}) => sendToSky(skyId,
  L(`${newDevice ? '⚠️ Вход с нового устройства' : '✅ Вход в Sky ID'}\n\nКогда: ${when()}\nУстройство: ${clipUa(meta.ua)}\nАдрес: ${maskIp(meta.ip)}${via ? `\nСпособ: ${via}` : ''}\n\nЭто вы? Если нет — откройте Профиль → Sky ID → Устройства, завершите эту сессию и включите заморозку новых входов.`,
    `${newDevice ? '⚠️ Sign-in from a new device' : '✅ Signed in to Sky ID'}\n\nWhen: ${when()}\nDevice: ${clipUa(meta.ua)}\nAddress: ${maskIp(meta.ip)}${via ? `\nMethod: ${via}` : ''}\n\nWas it you? If not, open Profile → Sky ID → Devices, end this session and freeze new sign-ins.`),
  { kind: newDevice ? 'security' : 'signin' });

const lastAlert = new Map();
const once = (key, ms) => { const t = Date.now(); if ((lastAlert.get(key) ?? 0) > t - ms) return false; lastAlert.set(key, t); if (lastAlert.size > 5000) lastAlert.clear(); return true; };

/** Неверный код входа (не чаще раза в 10 минут на аккаунт). exhausted — попытки закончились. */
export const botBadCode = (skyId, { exhausted = false, left = null, ip = null } = {}) => {
  if (!once(`bad:${skyId}:${exhausted}`, 10 * 60_000)) return null;
  return sendToSky(skyId,
    L(`${exhausted ? '🚫 Попытки ввода кода исчерпаны' : '⚠️ Неверный код входа'}\n\nКто-то ввёл неверный код для входа в ваш аккаунт${ip ? ` (адрес ${maskIp(ip)})` : ''}.${left != null ? ` Осталось попыток: ${left}.` : ''}\n\nЕсли это были не вы — никому не сообщайте коды и при необходимости включите заморозку новых входов.`,
      `${exhausted ? '🚫 Code attempts used up' : '⚠️ Wrong sign-in code'}\n\nSomeone entered a wrong sign-in code for your account${ip ? ` (address ${maskIp(ip)})` : ''}.${left != null ? ` Attempts left: ${left}.` : ''}\n\nIf it was not you, do not share codes with anyone and consider freezing new sign-ins.`),
    { kind: 'security' });
};

/** Вход отклонён (заморозка новых входов, ограничение). */
export const botLoginRejected = (skyId, reason, meta = {}) => {
  if (!once(`rej:${skyId}:${reason}`, 10 * 60_000)) return null;
  const why = reason === 'frozen' ? L('новые входы заморожены', 'new sign-ins are frozen') : reason === 'blocked' ? L('вход заблокирован', 'sign-in is blocked') : reason;
  return sendToSky(skyId,
    L(`🚫 Попытка входа отклонена\n\nПричина: ${why}.\nКогда: ${when()}\nУстройство: ${clipUa(meta.ua)}\nАдрес: ${maskIp(meta.ip)}`,
      `🚫 Sign-in attempt rejected\n\nReason: ${why}.\nWhen: ${when()}\nDevice: ${clipUa(meta.ua)}\nAddress: ${maskIp(meta.ip)}`),
    { kind: 'security' });
};

/** Человек отправил свой код в чат — сообщение отклонено. */
export const botCodeShared = (profileId, hours) => sendFromBot(profileId,
  L(`⛔ Сообщение не отправлено\n\nВ нём был ваш действующий код подтверждения. Его просят мошенники именно ради входа в ваш аккаунт. Код отменён, новые входы заморожены на ${hours} ч. Уже открытые сессии работают.\n\nСотрудники Sky никогда не спрашивают код.`,
    `⛔ Message not sent\n\nIt contained your valid verification code. Scammers ask for it to get into your account. The code is cancelled and new sign-ins are frozen for ${hours} h. Open sessions keep working.\n\nSky staff never ask for codes.`),
  { kind: 'security' });

/** Рассылка администрации — копией в чат с ботом. */
export const botBroadcast = async (profileIds, title, body) => {
  const text = `📣 ${title}\n\n${body}`;
  let sent = 0;
  for (let i = 0; i < profileIds.length; i += 20) {
    const part = profileIds.slice(i, i + 20);
    const res = await Promise.all(part.map((id) => sendFromBot(id, text, { kind: 'broadcast', pushBody: null })));
    sent += res.filter(Boolean).length;
  }
  return sent;
};

/** Уборка: удаляет сообщения с кодами по сроку. */
export const sweepSkyBot = async () => {
  const { rows } = await query('SELECT message_id, chat_id FROM skybot_ephemeral WHERE delete_at <= now() LIMIT 200');
  for (const r of rows) {
    try {
      const removed = await deleteMessage(r.message_id, SKYBOT_PROFILE);
      if (removed) pushTogether(await memberIds(r.chat_id), { type: 'message-deleted', payload: { messageId: removed.id, chatId: removed.chatId } });
    } catch { /* уберём в следующий раз */ }
    await query('DELETE FROM skybot_ephemeral WHERE message_id = $1', [r.message_id]);
  }
  await query(`DELETE FROM skybot_stats WHERE day < CURRENT_DATE - 60`).catch(() => {});
  return rows.length;
};
