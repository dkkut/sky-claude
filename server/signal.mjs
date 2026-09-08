/**
 * SKY WebSocket Hub — сообщения, онлайн-статус, сигналинг звонков.
 *
 * Два принципиальных отличия от прошлой версии:
 *
 *   1. Соединение обязано предъявить access-токен. Раньше клиент просто
 *      сообщал свой userId, и любой подключившийся мог назваться кем
 *      угодно и получить чужую переписку.
 *
 *   2. Чаты и сообщения лежат в PostgreSQL, а не в Map внутри процесса.
 *      Право читать и писать проверяется по участию в чате на каждой
 *      операции — в слое данных, а не здесь, чтобы нельзя было забыть
 *      проверку в одной из веток.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.mjs';
import { verifyToken } from './security.mjs';
import { sessionStore, onSessionRevoked } from './sessions.mjs';
import { query } from './db.mjs';
import { BETA_COOKIE, parseCookies } from './cookies.mjs';
import { getPrivacy, setPrivacy, presenceVisibleTo, presenceVisibleFrom, mayCall } from './privacy.mjs';
import { betaEnabled, betaHashLive } from './beta.mjs';
import {
  listChats, listMessages, createChat, saveMessage,
  editMessage, deleteMessage, markRead, memberIds, isMember, toggleReaction,
  blockUser, unblockUser, listBlocked, addMember, leaveChat, getChat,
} from './chats.mjs';
import {
  getSettings, updateSettings, setRole, kickMember, unbanMember, muteMember,
  createInvite, revokeInvite, listInvites, joinByInvite,
  listJoinRequests, decideJoin, listLog, listMembers, markViewed, pinMessage,
  contextFor,
} from './chatadmin.mjs';

const PORT = Number(process.env.SIGNAL_PORT || 8081);

/** Сколько ждём авторизации после подключения. */
const AUTH_TIMEOUT_MS = 10_000;
/**
 * Потолок сообщений в минуту — на человека, а не на соединение.
 *
 * Счётчик жил на сокете, и обойти его было нечем: открыть десять
 * соединений одной сессией и получить десятикратный лимит.
 */
const MSG_RATE_PER_MIN = 240;
/**
 * Сколько устройств одного человека хаб держит одновременно.
 *
 * Телефон, ноутбук, планшет, пара вкладок — с запасом. Без потолка одна
 * действительная сессия открывала тысячи сокетов, и каждый заставлял
 * сервер собирать снимок переписки из базы.
 */
const MAX_SOCKETS_PER_USER = 8;
/** Сколько неавторизованных соединений терпим с одного адреса. */
const MAX_PENDING_PER_IP = 20;
/** Потолок размера одного сообщения. */
const MAX_MESSAGE_BYTES = 256 * 1024;
/** Период проверки живости соединений. */
const HEARTBEAT_MS = 30_000;
/**
 * Как надолго доверяем прошлой проверке сессии.
 *
 * Перепроверка раз в минуту означала, что после выхода из Sky ID сокет
 * ещё минуту читал и писал переписку. Теперь проверка идёт перед каждой
 * операцией, а результат кэшируется на несколько секунд, чтобы не ходить
 * в Redis по сто раз в минуту.
 */
const SESSION_CACHE_MS = 5_000;

/**
 * Общий на все соединения счётчик действий.
 *
 * Ключ — идентификатор профиля, поэтому лимит нельзя размножить,
 * открыв ещё одно соединение.
 */
const userRate = new Map();
const allowAction = (userId) => {
  const minute = Math.floor(Date.now() / 60_000);
  const box = userRate.get(userId);
  if (!box || box.minute !== minute) {
    userRate.set(userId, { minute, count: 1 });
    return true;
  }
  box.count += 1;
  return box.count <= MSG_RATE_PER_MIN;
};
// Счётчики прошлых минут не нужны: чистим, чтобы карта не росла вечно.
setInterval(() => {
  const minute = Math.floor(Date.now() / 60_000);
  for (const [id, box] of userRate) if (box.minute !== minute) userRate.delete(id);
}, 60_000).unref();

/** Неавторизованные соединения по адресу — до предъявления токена. */
const pending = new Map();

// userId → набор соединений (у человека может быть открыто несколько вкладок)
const clients = new Map();
// sessionId → сокеты этой сессии: нужен, чтобы закрыть их при выходе,
// не дожидаясь очередной проверки.
const bySession = new Map();

let wss = null;

/* ─── отправка ─────────────────────────────────────────────────────────── */
const send = (ws, msg) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};
/** Возвращает число соединений, куда сообщение действительно ушло. */
const sendTo = (userId, msg) => {
  let n = 0;
  for (const ws of clients.get(userId) ?? []) { send(ws, msg); n += 1; }
  return n;
};
const broadcast = (userIds, msg, exceptId) => {
  for (const uid of userIds) if (uid !== exceptId) sendTo(uid, msg);
};
/**
 * Рассылка участникам чата, кроме того самого соединения, откуда пришло
 * действие.
 *
 * Исключать надо именно соединение, а не человека: у одного человека
 * открыт телефон и ноутбук, и раньше отправленное с телефона не
 * доходило до ноутбука — свои сокеты выбрасывались вместе с автором.
 * Само отправившее соединение уже показало действие у себя.
 */
const fanout = (userIds, msg, exceptWs) => {
  for (const uid of userIds) {
    for (const ws of clients.get(uid) ?? []) if (ws !== exceptWs) send(ws, msg);
  }
};

/**
 * Рассылает чат каждому в его собственном виде.
 *
 * Чат теперь несёт роль спрашивающего, а раньше всем уходил один и тот
 * же пакет — тот, что видит создатель. Приглашённый получал чужую роль
 * владельца и вместе с ней все кнопки управления.
 */
const sendChatToEach = async (chatId, userIds) => {
  // Правила чата идут вместе с ним: приглашённый должен сразу знать,
  // можно ли ему здесь писать, а не выяснять это отказом сервера.
  const settings = await getSettings(chatId);
  for (const uid of userIds) {
    if (!clients.has(uid)) continue;
    const view = await getChat(chatId, uid);
    if (!view) continue;
    sendTo(uid, { type: 'chat-created', payload: { chat: view } });
    if (settings) sendTo(uid, { type: 'chat-settings', payload: { chatId, settings } });
  }
};

const addClient = (userId, sessionId, ws) => {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(ws);
  if (!bySession.has(sessionId)) bySession.set(sessionId, new Set());
  bySession.get(sessionId).add(ws);
};
const removeClient = (userId, sessionId, ws) => {
  const bySess = bySession.get(sessionId);
  if (bySess) { bySess.delete(ws); if (bySess.size === 0) bySession.delete(sessionId); }
  const set = clients.get(userId);
  if (!set) return false;
  set.delete(ws);
  if (set.size > 0) return false;
  clients.delete(userId);
  return true; // последнее соединение закрылось — человек ушёл в офлайн
};

/*
 * Сессия закончилась — закрываем её сокеты немедленно, а не когда
 * подойдёт срок очередной проверки. Иначе после «Выйти» украденный
 * токен ещё несколько секунд читал переписку.
 */
onSessionRevoked((sessionId) => {
  for (const ws of bySession.get(sessionId) ?? []) {
    try { ws.close(4401, 'session ended'); } catch { /* уже закрыт */ }
  }
});

/* ─── авторизация ──────────────────────────────────────────────────────── */
/**
 * Хаб работает от имени профиля: идентификатор профиля — это тот же id,
 * на который ссылаются авторы сообщений и участники чатов. Пока профиль
 * не выбран, его нет, и подключение к хабу не имеет смысла.
 *
 * Подписи токена мало: после «Выйти из Sky ID» он остаётся формально
 * действительным до конца срока. Поэтому сверяемся с живой сессией и
 * профиль берём из неё же — тогда смена профиля в другой вкладке не
 * оставит сокет говорить от имени прежнего.
 *
 * Возвращает { userId, sessionId } либо null.
 */
const identify = async (token) => {
  const payload = verifyToken(token, config.jwtSecret);
  if (!payload || payload.typ !== 'access' || !payload.sky || !payload.sid) return null;

  const stored = await sessionStore.get(payload.sid);
  if (!stored || stored.userId !== payload.sky || !stored.profileId) return null;

  return { userId: stored.profileId, sessionId: payload.sid };
};

/**
 * Отдаёт вошедшему его чаты и последние сообщения по каждому.
 *
 * Пустой чат тоже отправляется — пустым списком. Иначе клиент, у
 * которого в кэше остались сообщения из удалённой переписки, так бы их
 * и показывал: «ничего не прислали» он принимал за «ничего не менялось».
 */
const sendSnapshot = async (ws, userId) => {
  // Приватность приходит с сервера, а не берётся из памяти браузера:
  // иначе на новом устройстве галочка показывала бы не то, что на самом
  // деле настроено.
  send(ws, { type: 'privacy', payload: await getPrivacy(userId) });

  const chats = await listChats(userId);
  // Список запретов приезжает вместе с чатами: он теперь серверный, и
  // браузер не должен решать его самостоятельно.
  send(ws, { type: 'chats-snapshot', payload: { chats, blocked: await listBlocked(userId) } });

  for (const chat of chats) {
    const messages = await listMessages(chat.id, userId, 50);
    send(ws, { type: 'messages-snapshot', payload: { chatId: chat.id, messages: messages ?? [] } });
    // Правила чата нужны каждому участнику, а не только тем, кто
    // открывал панель управления: иначе тот, кому писать уже нельзя,
    // видит поле ввода и узнаёт об этом только по отказу сервера.
    if (chat.type !== 'direct') {
      const settings = await getSettings(chat.id);
      if (settings) send(ws, { type: 'chat-settings', payload: { chatId: chat.id, settings } });
    }
  }
  send(ws, { type: 'snapshot-done' });
};

/**
 * Кто из сейчас подключённых состоит с человеком в общем чате.
 *
 * Одним запросом на всех: раньше на каждое подключение уходил отдельный
 * запрос про каждого, кто сейчас в сети. При сотне подключённых это сто
 * запросов на вход — и квадратичная нагрузка на базу, которой хватало,
 * чтобы положить её одним скриптом.
 */
const nearbyOnline = async (userId) => {
  const others = [...clients.keys()].filter((id) => id !== userId);
  if (others.length === 0) return [];
  const { rows } = await query(
    `SELECT DISTINCT y.user_id FROM chat_members x
       JOIN chat_members y ON y.chat_id = x.chat_id
      WHERE x.user_id = $1 AND y.user_id = ANY($2::text[])`,
    [userId, others],
  );
  return rows.map((r) => r.user_id);
};

/**
 * Кого этот человек видит в сети.
 *
 * Мало быть в общем чате: у каждого своя настройка «кто видит в сети»,
 * и решает её сервер. Раньше настройка жила галочкой в браузере и не
 * значила ничего.
 */
const visibleOnline = async (userId) =>
  presenceVisibleFrom(userId, await nearbyOnline(userId));

/** Кому видно, что этот человек подключился или отключился. */
const presenceAudience = async (userId) =>
  presenceVisibleTo(userId, await nearbyOnline(userId));

/* ─── обработка сообщений ──────────────────────────────────────────────── */
const handle = async (ws, session, msg) => {
  const { type, payload } = msg;
  const me = session.userId;

  switch (type) {
    case 'ping': {
      // Браузер не умеет слать протокольный ping, поэтому клиент
      // проверяет живость соединения обычным сообщением.
      send(ws, { type: 'pong' });
      break;
    }

    case 'send-message': {
      const { chatId, message } = payload ?? {};
      if (!chatId || !message) return;

      const saved = await saveMessage(chatId, me, message);
      // null значит «не участник» — молча игнорируем, чтобы по ответу
      // нельзя было выяснять, какие чаты существуют.
      if (!saved) return;
      // А вот причину отказа по правилам чата отправитель знать должен:
      // иначе непонятно, почему сообщение не ушло.
      if (saved.error) {
        send(ws, { type: 'message-rejected', payload: { chatId, messageId: message?.id, reason: saved.error } });
        return;
      }

      fanout(await memberIds(chatId), { type: 'new-message', payload: { chatId, message: saved } }, ws);
      send(ws, { type: 'message-sent', payload: { messageId: saved.id, chatId, message: saved } });
      break;
    }

    case 'edit-message': {
      const { messageId, text } = payload ?? {};
      const edited = await editMessage(messageId, me, text);
      if (!edited) return;
      fanout(await memberIds(edited.chatId), {
        type: 'message-edited',
        payload: { messageId: edited.id, chatId: edited.chatId, text: String(text ?? ''), editedAt: edited.editedAt },
      }, ws);
      break;
    }

    case 'delete-message': {
      const { messageId } = payload ?? {};
      const removed = await deleteMessage(messageId, me);
      if (!removed) return;
      fanout(await memberIds(removed.chatId),
        { type: 'message-deleted', payload: { messageId: removed.id, chatId: removed.chatId } }, ws);
      break;
    }

    case 'react-message': {
      const { messageId } = payload ?? {};
      // Реакция сохраняется, а не только рассылается: иначе она
      // исчезала после перезагрузки страницы и никогда не доезжала до
      // второго устройства того же человека.
      const result = await toggleReaction(messageId, me, payload?.emoji);
      if (!result) return;
      fanout(await memberIds(result.chatId), {
        type: 'message-reaction',
        payload: { messageId, chatId: result.chatId, emoji: result.emoji, userId: me, removed: result.removed },
      }, ws);
      break;
    }

    case 'typing': {
      const chatId = payload?.chatId;
      if (!chatId || !(await isMember(chatId, me))) return;
      // В канале «печатает…» не показываем: у записи один автор и
      // тысяча читателей, и рассылать это всем — только шум.
      const ctxT = await contextFor(chatId, me);
      if (ctxT?.type === 'channel') return;
      // Имя набирающего не пересылаем: клиент присылал его сам, и в
      // строке «печатает…» можно было назваться кем угодно. Получатель
      // подставит имя из своего же списка участников чата.
      broadcast(await memberIds(chatId),
        { type: 'user-typing', payload: { chatId, userId: me, active: payload?.active === true } },
        me);
      break;
    }

    case 'read-messages': {
      const chatId = payload?.chatId;
      if (!chatId) return;
      const changed = await markRead(chatId, me);
      if (!changed) return;
      // Пустой список значит «нового ничего не прочитано» — рассылать
      // нечего, авторы уже видят свои галочки.
      if (changed.length === 0) return;
      fanout(await memberIds(chatId),
        { type: 'messages-read', payload: { chatId, byUserId: me, messageIds: changed } }, ws);
      break;
    }

    case 'create-chat': {
      const chat = payload?.chat;
      if (!chat?.id || !chat?.type) return;
      const created = await createChat(chat, me);
      if (!created || created.error) {
        send(ws, {
          type: 'chat-rejected',
          payload: { chatId: chat.id, reason: created?.error ?? undefined },
        });
        return;
      }
      // Каждому — его собственный вид чата: в нём есть роль, и она у
      // всех разная.
      await sendChatToEach(created.id, created.participants.filter((id) => id !== me));
      send(ws, { type: 'chat-created', payload: { chat: created } });
      break;
    }

    case 'get-messages': {
      const chatId = payload?.chatId;
      const messages = await listMessages(chatId, me, payload?.limit ?? 100, payload?.before ?? null);
      if (!messages) return;
      // «Догрузка» отличается от снимка: клиент дописывает её к началу
      // ленты, а не заменяет ею всё, что уже показано.
      send(ws, {
        type: payload?.before ? 'messages-older' : 'messages-snapshot',
        payload: { chatId, messages, before: payload?.before ?? null, done: messages.length === 0 },
      });
      break;
    }

    /* ── Состав чата ── */
    case 'add-member': {
      const { chatId, userId } = payload ?? {};
      if (!chatId || !userId) return;
      const result = await addMember(chatId, me, userId);
      if (result.error) { send(ws, { type: 'chat-error', payload: { chatId, error: result.error } }); return; }
      // Новому участнику чат нужен целиком, остальным — обновлённый состав.
      await sendChatToEach(chatId, result.chat.participants);
      break;
    }

    case 'leave-chat': {
      const chatId = payload?.chatId;
      if (!chatId) return;
      const result = await leaveChat(chatId, me);
      if (!result) return;
      // Сообщаем всем, кто был в чате на момент выхода: у оставшихся
      // должен пропасть участник, а при роспуске — весь чат.
      for (const uid of result.members) {
        sendTo(uid, {
          type: result.dissolved ? 'chat-removed' : 'chat-left',
          payload: { chatId, userId: me },
        });
      }
      break;
    }

    /* ── Запреты ── */
    case 'block-user':
    case 'unblock-user': {
      const target = payload?.userId;
      if (!target || target === me) return;
      const done = type === 'block-user'
        ? await blockUser(me, target)
        : await unblockUser(me, target);
      if (!done) return;
      // Отвечаем только самому запретившему: собеседник не должен
      // узнавать, что его заблокировали.
      send(ws, { type: 'blocked-changed', payload: { blocked: await listBlocked(me) } });
      break;
    }


    /* ── Приватность профиля ───────────────────────────────────────
       Настройка защищает человека от других, поэтому живёт на сервере,
       а не галочкой в браузере: свой клиент можно переписать. ── */

    case 'privacy': {
      const patch = (payload && typeof payload === 'object') ? payload : {};
      const changesPresence = patch.whoSeesOnline !== undefined;
      const next = await setPrivacy(me, patch);

      // Присутствие меняется прямо сейчас: иначе кружок «в сети» висел
      // бы у собеседников до их следующего подключения. Считаем, кто
      // видит человека теперь, и остальным рядом говорим, что он ушёл.
      if (changesPresence) {
        const near = await nearbyOnline(me);
        const seeing = new Set(await presenceVisibleTo(me, near));
        for (const other of near) {
          sendTo(other, {
            type: seeing.has(other) ? 'user-online' : 'user-offline',
            payload: { userId: me },
          });
        }
      }
      send(ws, { type: 'privacy', payload: next });
      break;
    }

    /* ── Управление группой и каналом ──────────────────────────────
       Каждое действие проверяет право на сервере: присланная клиентом
       роль здесь ничего не значит. ── */

    case 'chat-admin': {
      const chatId = payload?.chatId;
      const action = String(payload?.action ?? '');
      if (!chatId || !action) return;

      /** Отправить обновлённый чат всем, кто в нём состоит. */
      const pushChat = async (ids) => sendChatToEach(chatId, ids ?? await memberIds(chatId));
      const fail = (error) => send(ws, { type: 'chat-error', payload: { chatId, action, error } });

      switch (action) {
        case 'get-settings': {
          const settings = await getSettings(chatId);
          if (!settings || !(await isMember(chatId, me))) return fail('not_found');
          return send(ws, { type: 'chat-settings', payload: { chatId, settings } });
        }

        case 'set-settings': {
          const result = await updateSettings(chatId, me, payload?.settings ?? {});
          if (result.error) return fail(result.error);
          // Настройки касаются всех: рассылаем всем участникам.
          for (const uid of await memberIds(chatId)) {
            sendTo(uid, { type: 'chat-settings', payload: { chatId, settings: result.settings } });
          }
          break;
        }

        case 'members': {
          const list = await listMembers(chatId, me);
          if (!list) return fail('not_found');
          return send(ws, { type: 'chat-members', payload: { chatId, ...list } });
        }

        case 'set-role': {
          const result = await setRole(chatId, me, String(payload?.userId ?? ''), String(payload?.role ?? ''));
          if (result.error) return fail(result.error);
          await pushChat();
          break;
        }

        case 'kick':
        case 'ban': {
          const target = String(payload?.userId ?? '');
          const result = await kickMember(chatId, me, target, { ban: action === 'ban' });
          if (result.error) return fail(result.error);
          // Исключённому чат больше не принадлежит; остальным — новый состав.
          sendTo(target, { type: 'chat-removed', payload: { chatId } });
          await pushChat((result.members ?? []).filter((id) => id !== target));
          break;
        }

        case 'unban': {
          const result = await unbanMember(chatId, me, String(payload?.userId ?? ''));
          if (result.error) return fail(result.error);
          break;
        }

        case 'mute': {
          const result = await muteMember(chatId, me, String(payload?.userId ?? ''), payload?.minutes);
          if (result.error) return fail(result.error);
          const list = await listMembers(chatId, me);
          if (list) send(ws, { type: 'chat-members', payload: { chatId, ...list } });
          break;
        }

        case 'invites': {
          const invites = await listInvites(chatId, me);
          if (!invites) return fail('not_allowed');
          return send(ws, { type: 'chat-invites', payload: { chatId, invites } });
        }

        case 'create-invite': {
          const result = await createInvite(chatId, me, {
            maxUses: payload?.maxUses, expiresInHours: payload?.expiresInHours,
          });
          if (result.error) return fail(result.error);
          const invites = await listInvites(chatId, me);
          return send(ws, { type: 'chat-invites', payload: { chatId, invites: invites ?? [] } });
        }

        case 'requests': {
          const requests = await listJoinRequests(chatId, me);
          if (!requests) return fail('not_allowed');
          return send(ws, { type: 'chat-requests', payload: { chatId, requests } });
        }

        case 'approve-join':
        case 'reject-join': {
          const target = String(payload?.userId ?? '');
          const result = await decideJoin(chatId, me, target, action === 'approve-join');
          if (result.error) return fail(result.error);
          if (result.joined) await sendChatToEach(chatId, await memberIds(chatId));
          const requests = await listJoinRequests(chatId, me);
          send(ws, { type: 'chat-requests', payload: { chatId, requests: requests ?? [] } });
          break;
        }

        case 'log': {
          const entries = await listLog(chatId, me, payload?.limit);
          if (!entries) return fail('not_allowed');
          return send(ws, { type: 'chat-log', payload: { chatId, entries } });
        }
      }
      break;
    }

    case 'revoke-invite': {
      const result = await revokeInvite(payload?.code, me);
      if (result.error) return;
      const invites = await listInvites(result.chatId, me);
      send(ws, { type: 'chat-invites', payload: { chatId: result.chatId, invites: invites ?? [] } });
      break;
    }

    case 'join-invite': {
      const result = await joinByInvite(payload?.code, me, payload?.answer);
      if (result.error) {
        send(ws, { type: 'join-result', payload: { error: result.error } });
        return;
      }
      if (result.pending) {
        send(ws, { type: 'join-result', payload: { chatId: result.chatId, pending: true } });
        // Управляющим — обновлённый список заявок.
        for (const uid of await memberIds(result.chatId)) {
          const list = await listJoinRequests(result.chatId, uid);
          if (list) sendTo(uid, { type: 'chat-requests', payload: { chatId: result.chatId, requests: list } });
        }
        return;
      }
      send(ws, { type: 'join-result', payload: { chatId: result.chatId, joined: true } });
      await sendChatToEach(result.chatId, await memberIds(result.chatId));
      break;
    }

    case 'pin-message': {
      const result = await pinMessage(payload?.chatId, me, payload?.messageId, payload?.pinned !== false);
      if (result.error) return;
      broadcast(await memberIds(payload.chatId), {
        type: 'message-pinned',
        payload: { chatId: payload.chatId, messageId: result.messageId, pinned: result.pinned },
      });
      send(ws, { type: 'message-pinned', payload: { chatId: payload.chatId, messageId: result.messageId, pinned: result.pinned } });
      break;
    }

    case 'viewed': {
      // Просмотры записей канала: считаются уникальные читатели.
      const counts = await markViewed(payload?.chatId, me, payload?.messageIds);
      if (!counts?.length) return;
      broadcast(await memberIds(payload.chatId),
        { type: 'message-views', payload: { chatId: payload.chatId, counts } });
      send(ws, { type: 'message-views', payload: { chatId: payload.chatId, counts } });
      break;
    }

    /* ── Звонки. Сигналинг идёт только между участниками общего чата,
          иначе по WebRTC можно было бы дозвониться до кого угодно. ── */
    case 'call-offer':
    case 'call-answer':
    case 'ice-candidate':
    case 'call-reject':
    case 'call-end': {
      const to = payload?.to;
      if (!to || to === me) return;

      const callId = String(payload?.callId ?? '');
      if (!callId || callId.length > 128) return;

      if (!(await shareAChat(me, to))) {
        // Звонить можно только тем, с кем есть общий чат: иначе по
        // одному лишь идентификатору можно было бы дозвониться до
        // любого. Звонящему отвечаем, чтобы он не слушал гудки.
        if (type === 'call-offer') send(ws, { type: 'call-unavailable', from: to, callId });
        return;
      }

      // Настройка «кто может звонить» получателя. Проверяется на первом
      // приглашении: дальше идут ответ и обмен адресами уже начатого
      // разговора, и гонять запрос на каждый кандидат ICE незачем.
      if (type === 'call-offer' && !(await mayCall(to, me))) {
        send(ws, { type: 'call-unavailable', from: to, callId });
        return;
      }

      // Пересылаем только то, что нужно самому WebRTC. Имени звонящего
      // здесь нет намеренно: пришли его клиент, и на экране входящего
      // можно было бы представиться кем угодно. Получатель подписывает
      // звонок сам — общий чат у них есть, иначе звонок бы не дошёл.
      const relay = { callId };
      if (type === 'call-offer') {
        relay.sdp  = payload.sdp;
        relay.mode = payload.mode === 'video' ? 'video' : 'voice';
      }
      if (type === 'call-answer')   relay.sdp = payload.sdp;
      if (type === 'ice-candidate') relay.candidate = payload.candidate;

      const kind = {
        'call-offer':    'call-incoming',
        'call-answer':   'call-answered',
        'ice-candidate': 'ice-candidate',
        'call-reject':   'call-rejected',
        'call-end':      'call-ended',
      }[type];
      const delivered = sendTo(to, { type: kind, from: me, callId, payload: relay });

      // Звонок в закрытое приложение иначе означал бы гудки без конца.
      if (!delivered && type === 'call-offer') {
        send(ws, { type: 'call-unavailable', from: to, callId });
      }
      break;
    }
  }
};

/** Есть ли у двоих общий чат — условие для звонка. */
const shareAChat = async (a, b) => {
  const { rows } = await query(
    `SELECT 1 FROM chat_members x JOIN chat_members y ON x.chat_id = y.chat_id
      WHERE x.user_id = $1 AND y.user_id = $2 LIMIT 1`,
    [a, b],
  );
  return rows.length > 0;
};

/* ─── запуск ───────────────────────────────────────────────────────────── */

/**
 * Откуда разрешено открывать сокет.
 *
 * Рукопожатие WebSocket не подчиняется правилам обмена между сайтами:
 * страница злоумышленника может открыть соединение к нашему хабу из
 * браузера жертвы. Предъявить токен она не сможет — он лежит в памяти
 * нашей вкладки, а не в куке, — но открывать соединения пачками вполне.
 */
const originAllowed = (origin) => {
  if (!origin) return true;            // не браузер: свои проверки, curl
  const allowed = [config.publicOrigin, ...(config.extraOrigins ?? [])].filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(origin);
};

/**
 * Калитка закрытой беты действует и на сокете.
 *
 * HTTP-слой её проверяет, а хаб — нет, и укравший токен обходил бы
 * калитку через сокет. Проверка та же самая, что и в server.mjs.
 */
const betaAllowed = (req) => {
  if (!betaEnabled()) return true;
  const token = parseCookies(req.headers.cookie)[BETA_COOKIE];
  const payload = verifyToken(token ?? '', config.jwtSecret);
  return Boolean(payload && payload.typ === 'beta' && betaHashLive(payload.k));
};

const ipOf = (req) => {
  // За nginx настоящий адрес приходит заголовком; сам nginx его
  // перезаписывает, поэтому подделать его снаружи нельзя.
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
};

export const startSignalHub = () => {
  wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE_BYTES });

  /*
   * Оборванное соединение (потеря сети, закрытая крышка ноутбука) не
   * всегда приводит к событию close: сокет остаётся в списке, человек
   * числится в сети, и ему продолжают уходить сообщения в никуда.
   * Раз в HEARTBEAT_MS шлём протокольный ping и закрываем то, что не
   * ответило до следующего круга.
   */
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* сокет уже закрыт */ }
    }
  }, HEARTBEAT_MS);
  beat.unref();
  wss.on('close', () => clearInterval(beat));

  wss.on('connection', (ws, req) => {
    if (!originAllowed(req.headers.origin)) { ws.close(4403, 'origin'); return; }
    if (!betaAllowed(req)) { ws.close(4403, 'beta required'); return; }

    const ip = ipOf(req);
    const openFromIp = (pending.get(ip) ?? 0) + 1;
    if (openFromIp > MAX_PENDING_PER_IP) { ws.close(4429, 'too many connections'); return; }
    pending.set(ip, openFromIp);
    let counted = true;
    const uncount = () => {
      if (!counted) return;
      counted = false;
      const left = (pending.get(ip) ?? 1) - 1;
      if (left > 0) pending.set(ip, left); else pending.delete(ip);
    };

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const session = { userId: null, sessionId: null, checkedAt: 0 };

    // Неавторизованное соединение живёт ограниченное время: иначе можно
    // держать тысячи открытых сокетов, ничего не предъявляя.
    const authTimer = setTimeout(() => {
      if (!session.userId) ws.close(4401, 'auth timeout');
    }, AUTH_TIMEOUT_MS);

    /**
     * Сессия ещё жива и профиль тот же?
     *
     * Проверяем перед каждой операцией, но не чаще раза в несколько
     * секунд: сокет живёт часами, а «Выйти из Sky ID» должно закрывать
     * его сразу, а не когда-нибудь.
     */
    const sessionAlive = async () => {
      const now = Date.now();
      if (now - session.checkedAt < SESSION_CACHE_MS) return true;
      try {
        const stored = await sessionStore.get(session.sessionId);
        if (!stored || stored.profileId !== session.userId) return false;
      } catch (err) {
        // Не смогли убедиться, что сессия жива, — значит не работаем.
        console.error('[ws] проверка сессии', err.message);
        return false;
      }
      session.checkedAt = now;
      return true;
    };

    /*
     * Весь разбор входящего — внутри try. В обработчике много обращений
     * к базе и к Redis, и любое из них может отказать: незамеченная
     * ошибка в асинхронном обработчике роняет весь процесс, а вместе с
     * ним и всех остальных. Одно упавшее соединение не должно стоить
     * сервера.
     */
    const onMessage = async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;

      /* ── Авторизация ── */
      if (msg.type === 'auth') {
        if (session.userId) return;
        const who = await identify(msg.payload?.token);
        if (!who) {
          send(ws, { type: 'auth-failed' });
          ws.close(4401, 'unauthorized');
          return;
        }
        const { userId } = who;

        // Больше устройств, чем бывает у человека, — это скрипт.
        if ((clients.get(userId)?.size ?? 0) >= MAX_SOCKETS_PER_USER) {
          send(ws, { type: 'too-many-devices' });
          ws.close(4429, 'too many devices');
          return;
        }

        session.userId = userId;
        session.sessionId = who.sessionId;
        session.checkedAt = Date.now();
        clearTimeout(authTimer);
        uncount();                       // соединение больше не «ожидающее»
        addClient(userId, who.sessionId, ws);

        // Список онлайна — только те, с кем есть общий чат: иначе по
        // одному подключению можно было бы снять всех, кто сейчас в сети.
        const online = await visibleOnline(userId);
        send(ws, { type: 'authorized', payload: { userId, onlineUsers: online } });
        // Кого вижу я и кто видит меня — разные списки: я мог скрыться,
        // не переставая видеть остальных.
        for (const other of await presenceAudience(userId)) {
          sendTo(other, { type: 'user-online', payload: { userId } });
        }
        await sendSnapshot(ws, userId);
        console.log(`[ws] +${userId} (${clients.size} online)`);
        return;
      }

      // Всё остальное — только после авторизации.
      if (!session.userId) return;

      // Счётчик общий на все устройства человека: открыть второй сокет
      // и получить второй лимит не выйдет.
      if (!allowAction(session.userId)) {
        ws.close(4429, 'rate limited');
        return;
      }

      // Вышли из Sky ID или сменили профиль — соединение закрывается,
      // не дожидаясь, пока истечёт срок токена.
      if (!(await sessionAlive())) { ws.close(4401, 'session ended'); return; }

      await handle(ws, session, msg);
    };

    ws.on('message', (raw) => {
      onMessage(raw).catch((err) => {
        // Сообщение об ошибке — в журнал, наружу не отдаём: в нём
        // бывают подробности устройства базы.
        console.error('[ws] ошибка обработки', err.message);
      });
    });

    const onClose = async () => {
      clearTimeout(authTimer);
      uncount();
      const uid = session.userId;
      if (!uid) return;
      const wentOffline = removeClient(uid, session.sessionId, ws);
      if (!wentOffline) return;
      // Тот же список, что и при входе: скрывшийся не «уходит» у других,
      // потому что он у них и не появлялся.
      for (const other of await presenceAudience(uid)) {
        sendTo(other, { type: 'user-offline', payload: { userId: uid } });
      }
      console.log(`[ws] -${uid} (${clients.size} online)`);
    };

    ws.on('close', () => {
      onClose().catch((err) => console.error('[ws] закрытие', err.message));
    });

    ws.on('error', (e) => console.error('[ws]', e.message));
  });

  console.log(`[ws] Hub on :${PORT}`);

  return {
    close: () => new Promise((resolve) => {
      for (const set of clients.values()) {
        for (const ws of set) ws.close(1001, 'server shutting down');
      }
      clients.clear();
      wss.close(() => resolve());
      wss = null;
    }),
  };
};
