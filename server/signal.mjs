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
import { sessionStore } from './sessions.mjs';
import {
  listChats, listMessages, createChat, saveMessage,
  editMessage, deleteMessage, markRead, memberIds, isMember, toggleReaction,
} from './chats.mjs';

const PORT = Number(process.env.SIGNAL_PORT || 8081);

/** Сколько ждём авторизации после подключения. */
const AUTH_TIMEOUT_MS = 10_000;
/** Потолок сообщений в минуту с одного соединения — против флуда. */
const MSG_RATE_PER_MIN = 240;
/** Потолок размера одного сообщения. */
const MAX_MESSAGE_BYTES = 256 * 1024;
/** Период проверки живости соединений. */
const HEARTBEAT_MS = 30_000;

// userId → набор соединений (у человека может быть открыто несколько вкладок)
const clients = new Map();

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

/** Как часто перепроверять, что сессия открытого сокета ещё жива. */
const SESSION_RECHECK_MS = 60_000;

/**
 * Отдаёт вошедшему его чаты и последние сообщения по каждому.
 *
 * Пустой чат тоже отправляется — пустым списком. Иначе клиент, у
 * которого в кэше остались сообщения из удалённой переписки, так бы их
 * и показывал: «ничего не прислали» он принимал за «ничего не менялось».
 */
const sendSnapshot = async (ws, userId) => {
  const chats = await listChats(userId);
  send(ws, { type: 'chats-snapshot', payload: { chats } });

  for (const chat of chats) {
    const messages = await listMessages(chat.id, userId, 50);
    send(ws, { type: 'messages-snapshot', payload: { chatId: chat.id, messages: messages ?? [] } });
  }
  send(ws, { type: 'snapshot-done' });
};

/** Кто из сейчас подключённых состоит с человеком в общем чате. */
const visibleOnline = async (userId) => {
  const out = [];
  for (const other of clients.keys()) {
    if (other !== userId && await shareAChat(userId, other)) out.push(other);
  }
  return out;
};

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
      broadcast(await memberIds(chatId),
        { type: 'user-typing', payload: { chatId, userId: me, username: payload.username, active: payload.active } },
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
      if (!created) {
        send(ws, { type: 'chat-rejected', payload: { chatId: chat.id } });
        return;
      }
      fanout(created.participants, { type: 'chat-created', payload: { chat: created } }, ws);
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

      const callId = String(payload?.callId ?? '');
      if (!callId || callId.length > 128) return;

      if (!(await shareAChat(me, to))) {
        // Звонить можно только тем, с кем есть общий чат: иначе по
        // одному лишь идентификатору можно было бы дозвониться до
        // любого. Звонящему отвечаем, чтобы он не слушал гудки.
        if (type === 'call-offer') send(ws, { type: 'call-unavailable', from: to, callId });
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

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const session = { userId: null, sessionId: null, count: 0, minute: 0 };
    // Долго живущий сокет проверяем не только на входе: вышли из Sky ID
    // или сменили профиль — соединение должно закрыться само.
    let recheck = null;

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
        const who = await identify(msg.payload?.token);
        if (!who) {
          send(ws, { type: 'auth-failed' });
          ws.close(4401, 'unauthorized');
          return;
        }
        const { userId } = who;
        session.userId = userId;
        session.sessionId = who.sessionId;
        clearTimeout(authTimer);
        addClient(userId, ws);

        recheck = setInterval(async () => {
          try {
            const stored = await sessionStore.get(session.sessionId);
            if (!stored || stored.profileId !== session.userId) ws.close(4401, 'session ended');
          } catch (err) {
            console.error('[ws] проверка сессии', err.message);
          }
        }, SESSION_RECHECK_MS);
        recheck.unref();

        // Список онлайна — только те, с кем есть общий чат: иначе по
        // одному подключению можно было бы снять всех, кто сейчас в сети.
        const online = await visibleOnline(userId);
        send(ws, { type: 'authorized', payload: { userId, onlineUsers: online } });
        for (const other of online) sendTo(other, { type: 'user-online', payload: { userId } });
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
      if (recheck) clearInterval(recheck);
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
