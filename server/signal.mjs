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
import {
  listChats, listMessages, createChat, saveMessage,
  editMessage, deleteMessage, markRead, memberIds, isMember,
} from './chats.mjs';

const PORT = Number(process.env.SIGNAL_PORT || 8081);

/** Сколько ждём авторизации после подключения. */
const AUTH_TIMEOUT_MS = 10_000;
/** Потолок сообщений в минуту с одного соединения — против флуда. */
const MSG_RATE_PER_MIN = 240;
/** Потолок размера одного сообщения. */
const MAX_MESSAGE_BYTES = 256 * 1024;

// userId → набор соединений (у человека может быть открыто несколько вкладок)
const clients = new Map();

let wss = null;

/* ─── отправка ─────────────────────────────────────────────────────────── */
const send = (ws, msg) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};
const sendTo = (userId, msg) => {
  for (const ws of clients.get(userId) ?? []) send(ws, msg);
};
const broadcast = (userIds, msg, exceptId) => {
  for (const uid of userIds) if (uid !== exceptId) sendTo(uid, msg);
};

const addClient = (userId, ws) => {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(ws);
};
const removeClient = (userId, ws) => {
  const set = clients.get(userId);
  if (!set) return false;
  set.delete(ws);
  if (set.size > 0) return false;
  clients.delete(userId);
  return true; // последнее соединение закрылось — человек ушёл в офлайн
};

/* ─── авторизация ──────────────────────────────────────────────────────── */
const userIdFromToken = (token) => {
  const payload = verifyToken(token, config.jwtSecret);
  return payload && payload.typ === 'access' ? payload.sub : null;
};

/** Отдаёт вошедшему его чаты и последние сообщения по каждому. */
const sendSnapshot = async (ws, userId) => {
  const chats = await listChats(userId);
  send(ws, { type: 'chats-snapshot', payload: { chats } });

  for (const chat of chats) {
    const messages = await listMessages(chat.id, userId, 50);
    if (messages?.length) {
      send(ws, { type: 'messages-snapshot', payload: { chatId: chat.id, messages } });
    }
  }
};

/* ─── обработка сообщений ──────────────────────────────────────────────── */
const handle = async (ws, session, msg) => {
  const { type, payload } = msg;
  const me = session.userId;

  switch (type) {
    case 'send-message': {
      const { chatId, message } = payload ?? {};
      if (!chatId || !message) return;

      const saved = await saveMessage(chatId, me, message);
      // null значит «не участник» — молча игнорируем, чтобы по ответу
      // нельзя было выяснять, какие чаты существуют.
      if (!saved) return;

      broadcast(await memberIds(chatId), { type: 'new-message', payload: { chatId, message: saved } }, me);
      send(ws, { type: 'message-sent', payload: { messageId: saved.id, chatId } });
      break;
    }

    case 'edit-message': {
      const { messageId, chatId, text } = payload ?? {};
      const edited = await editMessage(messageId, me, text);
      if (!edited) return;
      broadcast(await memberIds(edited.chatId), { type: 'message-edited', payload: { messageId, chatId, text } }, me);
      break;
    }

    case 'delete-message': {
      const { messageId } = payload ?? {};
      const removed = await deleteMessage(messageId, me);
      if (!removed) return;
      broadcast(await memberIds(removed.chatId),
        { type: 'message-deleted', payload: { messageId, chatId: removed.chatId } }, me);
      break;
    }

    case 'react-message':
    case 'typing': {
      const chatId = payload?.chatId;
      if (!chatId || !(await isMember(chatId, me))) return;
      const out = type === 'typing'
        ? { type: 'user-typing', payload: { chatId, userId: me, username: payload.username, active: payload.active } }
        : { type: 'message-reaction', payload: { ...payload, userId: me } };
      broadcast(await memberIds(chatId), out, me);
      break;
    }

    case 'read-messages': {
      const chatId = payload?.chatId;
      if (!chatId || !(await markRead(chatId, me))) return;
      broadcast(await memberIds(chatId), { type: 'messages-read', payload: { chatId, byUserId: me } }, me);
      break;
    }

    case 'create-chat': {
      const chat = payload?.chat;
      if (!chat?.id || !chat?.type) return;
      const created = await createChat(chat, me);
      if (!created) return;
      broadcast(created.participants, { type: 'chat-created', payload: { chat: created } }, me);
      send(ws, { type: 'chat-created', payload: { chat: created } });
      break;
    }

    case 'get-messages': {
      const chatId = payload?.chatId;
      const messages = await listMessages(chatId, me, payload?.limit ?? 100);
      if (!messages) return;
      send(ws, { type: 'messages-snapshot', payload: { chatId, messages } });
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
      if (!(await shareAChat(me, to))) return;

      const kind = {
        'call-offer':    'call-incoming',
        'call-answer':   'call-answered',
        'ice-candidate': 'ice-candidate',
        'call-reject':   'call-rejected',
        'call-end':      'call-ended',
      }[type];
      sendTo(to, { type: kind, from: me, callId: payload.callId, payload });
      break;
    }
  }
};

/** Есть ли у двоих общий чат — условие для звонка. */
const shareAChat = async (a, b) => {
  const { rows } = await (await import('./db.mjs')).query(
    `SELECT 1 FROM chat_members x JOIN chat_members y ON x.chat_id = y.chat_id
      WHERE x.user_id = $1 AND y.user_id = $2 LIMIT 1`,
    [a, b],
  );
  return rows.length > 0;
};

/* ─── запуск ───────────────────────────────────────────────────────────── */
export const startSignalHub = () => {
  wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (ws) => {
    const session = { userId: null, count: 0, minute: 0 };

    // Неавторизованное соединение живёт ограниченное время: иначе можно
    // держать тысячи открытых сокетов, ничего не предъявляя.
    const authTimer = setTimeout(() => {
      if (!session.userId) ws.close(4401, 'auth timeout');
    }, AUTH_TIMEOUT_MS);

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;

      /* ── Авторизация ── */
      if (msg.type === 'auth') {
        if (session.userId) return;
        const userId = userIdFromToken(msg.payload?.token);
        if (!userId) {
          send(ws, { type: 'auth-failed' });
          ws.close(4401, 'unauthorized');
          return;
        }
        session.userId = userId;
        clearTimeout(authTimer);
        addClient(userId, ws);

        send(ws, { type: 'authorized', payload: { userId, onlineUsers: [...clients.keys()] } });
        // Об онлайне сообщаем только тем, с кем есть общий чат.
        for (const other of clients.keys()) {
          if (other !== userId && await shareAChat(userId, other)) {
            sendTo(other, { type: 'user-online', payload: { userId } });
          }
        }
        await sendSnapshot(ws, userId);
        console.log(`[ws] +${userId} (${clients.size} online)`);
        return;
      }

      // Всё остальное — только после авторизации.
      if (!session.userId) return;

      // Простой счётчик на минуту: перебор закрывает соединение.
      const minute = Math.floor(Date.now() / 60_000);
      if (minute !== session.minute) { session.minute = minute; session.count = 0; }
      if (++session.count > MSG_RATE_PER_MIN) {
        ws.close(4429, 'rate limited');
        return;
      }

      try {
        await handle(ws, session, msg);
      } catch (err) {
        console.error('[ws] ошибка обработки', msg.type, err.message);
      }
    });

    ws.on('close', async () => {
      clearTimeout(authTimer);
      const uid = session.userId;
      if (!uid) return;
      const wentOffline = removeClient(uid, ws);
      if (!wentOffline) return;
      for (const other of clients.keys()) {
        if (await shareAChat(uid, other)) sendTo(other, { type: 'user-offline', payload: { userId: uid } });
      }
      console.log(`[ws] -${uid} (${clients.size} online)`);
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
