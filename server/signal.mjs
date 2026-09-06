/**
 * SKY WebSocket Hub — порт 8081
 * Обрабатывает: сообщения, онлайн-статус, звонки (WebRTC signaling)
 */
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.SIGNAL_PORT || 8081);

// userId → WebSocket
const clients = new Map();

// Хранилище чатов и сообщений в памяти сервера (персистентность — при перезапуске теряется)
// Для production нужна БД, но для MVP это работает пока сервер запущен
const chats    = new Map(); // chatId → ChatItem
const messages = new Map(); // chatId → MessageItem[]

// Хаб поднимается не при импорте, а из server.mjs после того, как готовы
// БД и Redis: иначе клиенты успевают подключиться к ещё не готовому серверу.
let wss = null;

/* ─── helpers ──────────────────────────────────────────────────────────── */
const send = (ws, msg) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};
const sendTo = (userId, msg) => {
  const ws = clients.get(userId);
  if (ws) send(ws, msg);
};
const broadcast = (userIds, msg, exceptId) => {
  for (const uid of userIds) {
    if (uid !== exceptId) sendTo(uid, msg);
  }
};
const broadcastAll = (msg, exceptId) => {
  for (const [uid, ws] of clients) {
    if (uid !== exceptId) send(ws, msg);
  }
};

/* ─── chat helpers ─────────────────────────────────────────────────────── */
const getChatMembers = (chatId) => {
  const chat = chats.get(chatId);
  if (!chat) return [];
  if (chat.type === 'direct') return chat.participants || [];
  // groups/channels — все онлайн-пользователи знают о публичных чатах
  return [...clients.keys()];
};

const getMsgs = (chatId) => messages.get(chatId) || [];
const addMsg  = (chatId, msg) => {
  const arr = messages.get(chatId) || [];
  arr.push(msg);
  // Храним последние 1000 сообщений на чат
  if (arr.length > 1000) arr.splice(0, arr.length - 1000);
  messages.set(chatId, arr);
};

/* ─── connection ───────────────────────────────────────────────────────── */
export const startSignalHub = () => {
  wss = new WebSocketServer({ port: PORT });

  wss.on('connection', (ws) => {
  let myUserId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type, payload } = msg;

    switch (type) {

      /* ── AUTH ── */
      case 'register': {
        myUserId = String(payload?.userId || '');
        if (!myUserId) return;
        clients.set(myUserId, ws);

        // Сообщаем всем что этот юзер онлайн
        broadcastAll({ type: 'user-online', payload: { userId: myUserId } }, myUserId);

        // Отправляем текущий список онлайн
        send(ws, {
          type: 'registered',
          payload: {
            userId: myUserId,
            onlineUsers: [...clients.keys()],
          },
        });

        // Отправляем чаты и последние сообщения юзера
        const userChats = [...chats.values()].filter(c =>
          !c.participants || c.participants.includes(myUserId) || c.type !== 'direct'
        );
        send(ws, { type: 'chats-snapshot', payload: { chats: userChats } });

        // Отправляем последние сообщения по каждому чату
        for (const chat of userChats) {
          const msgs = getMsgs(chat.id).slice(-50);
          if (msgs.length > 0) {
            send(ws, { type: 'messages-snapshot', payload: { chatId: chat.id, messages: msgs } });
          }
        }

        console.log(`[ws] +${myUserId} (${clients.size} online)`);
        break;
      }

      /* ── MESSAGES ── */
      case 'send-message': {
        if (!myUserId) return;
        const { message, chatId } = payload;
        if (!message || !chatId) return;

        // Сохраняем
        addMsg(chatId, message);

        // Рассылаем всем участникам
        const members = getChatMembers(chatId);
        broadcast(members, {
          type: 'new-message',
          payload: { message, chatId },
        }, myUserId);

        // Подтверждение отправителю
        send(ws, { type: 'message-sent', payload: { messageId: message.id, chatId } });
        break;
      }

      case 'edit-message': {
        if (!myUserId) return;
        const { messageId, chatId, text } = payload;
        const msgs = getMsgs(chatId);
        const idx = msgs.findIndex(m => m.id === messageId);
        if (idx >= 0) {
          msgs[idx] = { ...msgs[idx], text, editedAt: new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) };
        }
        broadcast(getChatMembers(chatId), { type: 'message-edited', payload }, myUserId);
        break;
      }

      case 'delete-message': {
        if (!myUserId) return;
        const { messageId, chatId } = payload;
        const msgs = getMsgs(chatId);
        const idx = msgs.findIndex(m => m.id === messageId);
        if (idx >= 0) msgs[idx] = { ...msgs[idx], deleted: true, text: 'Сообщение удалено', mediaUrl: undefined };
        broadcast(getChatMembers(chatId), { type: 'message-deleted', payload: { messageId, chatId } }, myUserId);
        break;
      }

      case 'react-message': {
        if (!myUserId) return;
        broadcast(getChatMembers(payload.chatId), { type: 'message-reaction', payload }, myUserId);
        break;
      }

      case 'typing': {
        if (!myUserId) return;
        broadcast(getChatMembers(payload.chatId), {
          type: 'user-typing',
          payload: { chatId: payload.chatId, userId: myUserId, username: payload.username, active: payload.active },
        }, myUserId);
        break;
      }

      case 'read-messages': {
        if (!myUserId) return;
        broadcast(getChatMembers(payload.chatId), {
          type: 'messages-read',
          payload: { chatId: payload.chatId, byUserId: myUserId },
        }, myUserId);
        break;
      }

      /* ── CHATS ── */
      case 'create-chat': {
        if (!myUserId) return;
        const { chat } = payload;
        chats.set(chat.id, chat);
        // Уведомить всех участников
        const members = chat.participants || [];
        broadcast(members, { type: 'chat-created', payload: { chat } }, myUserId);
        send(ws, { type: 'chat-created', payload: { chat } });
        break;
      }

      case 'get-messages': {
        if (!myUserId) return;
        const msgs = getMsgs(payload.chatId).slice(-100);
        send(ws, { type: 'messages-snapshot', payload: { chatId: payload.chatId, messages: msgs } });
        break;
      }

      /* ── CALLS (WebRTC signaling) ── */
      case 'call-offer':     sendTo(payload.to, { type:'call-incoming',  from:myUserId, callId:payload.callId, payload }); break;
      case 'call-answer':    sendTo(payload.to, { type:'call-answered',  from:myUserId, callId:payload.callId, payload }); break;
      case 'ice-candidate':  sendTo(payload.to, { type:'ice-candidate',  from:myUserId, callId:payload.callId, payload }); break;
      case 'call-reject':    sendTo(payload.to, { type:'call-rejected',  from:myUserId, callId:payload.callId }); break;
      case 'call-end':       sendTo(payload.to, { type:'call-ended',     from:myUserId, callId:payload.callId }); break;
    }
  });

  ws.on('close', () => {
    if (myUserId) {
      clients.delete(myUserId);
      broadcastAll({ type: 'user-offline', payload: { userId: myUserId } });
      console.log(`[ws] -${myUserId} (${clients.size} online)`);
    }
  });

    ws.on('error', (e) => console.error('[ws]', e.message));
  });

  console.log(`[ws] Hub on :${PORT}`);

  return {
    /** Закрывает соединения и слушающий сокет — нужно для штатной остановки. */
    close: () => new Promise((resolve) => {
      for (const ws of clients.values()) ws.close(1001, 'server shutting down');
      clients.clear();
      wss.close(() => resolve());
      wss = null;
    }),
  };
};
