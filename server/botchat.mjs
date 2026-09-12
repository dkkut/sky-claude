/**
 * Разговор человека с ботом.
 *
 * Бот не отдельная сущность с собственной перепиской: у него обычный
 * профиль, а разговор — обычный личный чат. Из-за этого всё, что уже
 * есть в мессенджере, работает и здесь само: участие в чате, запреты,
 * шифрование текста, рассылка по сокету на все устройства, история
 * после перезагрузки страницы.
 *
 * Порядок такой:
 *
 *   человек пишет  →  сообщение сохраняется от его имени
 *                  →  событие кладётся в очередь бота
 *                  →  сервер ВЛАДЕЛЬЦА забирает событие и думает
 *                  →  он же присылает ответ через Bot API
 *                  →  ответ сохраняется от имени профиля-бота
 *                  →  расходится по сокету, как любое сообщение.
 *
 * Ни на одном шаге Sky не выполняет код бота. Между «событие положено»
 * и «пришёл ответ» на стороне Sky не происходит ничего.
 */
import { query } from './db.mjs';
import {
  directChatId, createChat, saveMessage, listMessages, isMember, memberIds,
} from './chats.mjs';
import { botProfileId, markBotUser, logBot, BOT_ID_RE } from './bots.mjs';
import { enqueue } from './botevents.mjs';

/** Форма идентификатора сообщения та же, что и в мессенджере. */
const newMessageId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * Находит или заводит чат человека с ботом.
 *
 * Идентификатор личного чата выводится из пары участников, поэтому
 * подобрать чужой нельзя: он всегда получится тем же самым.
 */
export const openDialog = async (botId, userId) => {
  if (!BOT_ID_RE.test(String(botId ?? ''))) return { error: 'not_found' };

  const { rows } = await query(
    "SELECT profile_id, status, owner_id, name FROM bots WHERE id = $1", [botId],
  );
  const bot = rows[0];
  if (!bot) return { error: 'not_found' };

  const chatId = directChatId(userId, bot.profile_id);
  const already = await isMember(chatId, userId);

  /*
   * Новый разговор заводится только с опубликованным ботом: иначе
   * писать в чужой черновик мог бы кто угодно, зная идентификатор.
   * Своему — можно, это и есть проверка до публикации.
   *
   * А вот НАЧАТЫЙ разговор не обрывается, когда бота сняли с
   * публикации или владелец отвязал свой сервер. Переписка уже
   * существует, и превращать её в «такого бота нет» неправильно:
   * человек видел бы пропавший чат вместо понятного «бот офлайн».
   * Сообщения при этом просто ждут в очереди.
   */
  if (!already && bot.status !== 'published' && bot.owner_id !== userId) {
    return { error: 'not_found' };
  }

  if (!already) {
    const made = await createChat(
      { id: chatId, type: 'direct', participants: [bot.profile_id] }, userId,
    );
    if (!made || made.error) return { error: made?.error ?? 'chat_failed' };
    await logBot(botId, 'info', 'dialog.started', 'новый собеседник');
    await enqueue(botId, 'start', { chatId, userId }, chatId);
  }
  await markBotUser(botId, userId);
  return { chatId, profileId: bot.profile_id };
};

/** История разговора. Право читать проверяет listMessages по участию. */
export const dialogHistory = async (botId, userId, limit = 50, before = null) => {
  const opened = await openDialog(botId, userId);
  if (opened.error) return opened;
  const messages = await listMessages(opened.chatId, userId, limit, before);
  if (messages === null) return { error: 'not_found' };
  return { chatId: opened.chatId, botProfileId: opened.profileId, messages };
};

/**
 * Человек пишет боту.
 *
 * Автор — человек, и берётся он из сессии. Событие уходит серверу
 * владельца; ответа здесь не ждём — он придёт отдельным запросом от
 * этого сервера, когда тот его сформирует.
 */
export const sendToBot = async (botId, userId, userName, rawText) => {
  const opened = await openDialog(botId, userId);
  if (opened.error) return opened;

  const body = String(rawText ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (!body) return { error: 'empty' };

  const saved = await saveMessage(opened.chatId, userId, {
    id: newMessageId(), text: body.slice(0, 4000), kind: 'text',
  });
  if (!saved) return { error: 'not_allowed' };
  if (saved.error) return { error: saved.error };

  const command = /^\/[a-zA-Z0-9_]{1,30}/.exec(body)?.[0]?.toLowerCase() ?? null;
  const queued = await enqueue(botId, 'message', {
    chatId: opened.chatId,
    messageId: saved.id,
    from: { id: userId, name: userName ?? '' },
    text: body.slice(0, 4000),
    command,
    args: command ? body.slice(command.length).trim() : body,
  }, opened.chatId);

  return { chatId: opened.chatId, message: saved, queued: queued !== null };
};

/**
 * Бот отвечает.
 *
 * Вызывается только из Bot API, и botId туда приходит из токена
 * программы, а не из тела запроса: подставить чужого бота нечем.
 * Профиль-автор выводится из botId здесь же — значит, программа не
 * может назначить автором кого-то другого.
 *
 * Право писать проверяет saveMessage по участию в чате: бот, которого
 * в чат не звали, ничего туда не напишет.
 */
export const botSend = async (botId, chatId, payload = {}) => {
  const profileId = await botProfileId(botId);
  if (!profileId) return { error: 'not_found' };

  const body = String(payload.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (!body) return { error: 'empty_text' };

  /* Вид сообщения ограничен текстом намеренно: прислать 'system'
     значило бы написать в чат от имени самого приложения, а вложения
     требуют загруженного файла, которого у программы нет. */
  const saved = await saveMessage(chatId, profileId, {
    id: newMessageId(), text: body.slice(0, 4000), kind: 'text',
    ...(payload.replyTo ? { replyTo: String(payload.replyTo).slice(0, 64) } : {}),
  });
  if (!saved) return { error: 'not_a_member' };
  if (saved.error) return { error: saved.error };

  return { chatId, message: saved, members: await memberIds(chatId) };
};

/** Чаты, где бот состоит: чтобы программа знала, куда ей вообще можно писать. */
export const botChats = async (botId) => {
  const profileId = await botProfileId(botId);
  if (!profileId) return [];
  const { rows } = await query(
    `SELECT c.id, c.type FROM chat_members m JOIN chats c ON c.id = m.chat_id
      WHERE m.user_id = $1 ORDER BY c.created_at DESC LIMIT 200`,
    [profileId],
  );
  return rows.map((r) => ({ chatId: r.id, type: r.type }));
};

/**
 * Проверка «бот состоит в этом чате».
 *
 * Нужна до того, как класть событие или принимать действие: иначе
 * программа могла бы слать сообщения в чат, куда её не звали, просто
 * зная его идентификатор.
 */
export const botInChat = async (botId, chatId) => {
  const profileId = await botProfileId(botId);
  if (!profileId) return false;
  return isMember(String(chatId ?? ''), profileId);
};
