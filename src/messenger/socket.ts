/**
 * Связь мессенджера с сервером.
 *
 * Раньше здесь был BroadcastChannel: сообщение доходило только до
 * соседней вкладки того же браузера, а с телефона на ноутбук — никуда.
 * Теперь это настоящий WebSocket до хаба (server/signal.mjs): сервер
 * хранит переписку и рассылает её всем устройствам участников.
 *
 * Правила модуля прежние: сокет меняет стор через его же действия, стор
 * о сокете ничего не знает (отправку получает через wire.ts), а
 * UI-компоненты как звали broadcast.*, так и зовут.
 */
import { useMessengerStore } from './store';
import { getAccessToken, apiRefreshSession } from '@/core/auth/api';
import { setWireSink, type Outgoing } from '@/core/wire';
import { bsignal, type SignalMsg } from '@/calls/webrtc';
import type { MessageItem, ChatItem, ChatType } from './types';

/* ─── Приведение серверных данных к виду интерфейса ───────────────────── */

interface Person { id: string; name: string; username: string; avatar?: string }

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const initials = (s: string) => (s || '?').slice(0, 2).toUpperCase();

/**
 * Личный чат каждый участник видит своим собеседником: сервер шлёт обоим
 * один и тот же список людей, а подпись выбираем здесь — зная, кто из
 * них мы сами.
 */
const toChatItem = (raw: any, myId: string, prev?: ChatItem): ChatItem => {
  const people: Person[] = raw.people ?? [];
  const peer = raw.type === 'direct' ? people.find(p => p.id !== myId) : undefined;
  const name = peer ? peer.name : (raw.name || 'Без названия');
  return {
    id:       raw.id,
    type:     raw.type as ChatType,
    name,
    username: peer ? peer.username : (raw.username ?? ''),
    avatar:   initials(name),
    online:   prev?.online ?? false,
    members:  raw.type === 'direct' ? undefined : people.length,
    participants: raw.participants ?? people.map(p => p.id),
    description:  raw.description,
    ownerId:      raw.ownerId,
    // Закрепление, архив и звук — настройки этого устройства, сервер о
    // них не знает и не должен их затирать при каждой синхронизации.
    pinned:   prev?.pinned,
    archived: prev?.archived,
    muted:    prev?.muted,
    folder:   prev?.folder,
  };
};

const toMessageItem = (raw: any, myId: string): MessageItem => {
  const ts = Date.parse(raw.createdAt) || Date.now();
  const mine = raw.authorId === myId && raw.kind !== 'system';
  return {
    // Поля, которых нет в колонках таблицы (ответ, вложение, опрос),
    // сервер возвращает как есть — берём их первыми.
    ...raw,
    id:        raw.id,
    clientId:  raw.clientId ?? raw.id,
    chatId:    raw.chatId,
    authorId:  raw.authorId,
    kind:      raw.kind,
    text:      raw.text ?? '',
    deleted:   Boolean(raw.deleted),
    editedAt:  raw.editedAt,
    reactions: raw.reactions ?? [],
    fromMe:    mine,
    time:      fmtTime(ts),
    timestamp: ts,
    // Статус своего сообщения знает только сервер: он видит, кто его
    // открыл. Чужое пришло — значит доставлено.
    status:    mine ? (raw.readByAll ? 'read' : 'sent') : 'delivered',
    // Локальные пометки на сервере не живут — они не должны приезжать
    // обратно как чужие.
    isScheduled: false,
    scheduledAt: undefined,
  };
};

/* ─── Состояние соединения ────────────────────────────────────────────── */

const WS_URL = () =>
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

/** Пауза перед повторной попыткой: растёт до полуминуты. */
const RECONNECT_MIN = 1_000;
const RECONNECT_MAX = 30_000;
/** Как часто спрашиваем сервер, жив ли он. */
const PING_MS = 25_000;
/** Сколько ждём ответа на ping, прежде чем считать связь оборванной. */
const PONG_TIMEOUT_MS = 10_000;
/** Потолок очереди неотправленного: дальше нет смысла копить. */
const QUEUE_MAX = 200;

let ws: WebSocket | null = null;
let myId = '';
let wantOpen = false;
let authorized = false;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pongTimer: ReturnType<typeof setTimeout> | null = null;
/** Уже пробовали обновить протухший токен на этой попытке подключения. */
let refreshed = false;

const queue: Outgoing[] = [];
const online = new Set<string>();
const onlineWatchers = new Set<(ids: Set<string>) => void>();

const notifyOnline = () => {
  const snapshot = new Set(online);
  onlineWatchers.forEach(fn => { try { fn(snapshot); } catch { /* слушатель упал — не наша беда */ } });
  // Точка в списке чатов рисуется по чату, а не по человеку.
  useMessengerStore.getState().applyOnline(snapshot);
};

const send = (msg: Outgoing) => {
  if (authorized && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return;
  }
  if (queue.length >= QUEUE_MAX) queue.shift();
  queue.push(msg);
};

const flushQueue = () => {
  while (queue.length && authorized && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(queue.shift()));
  }
};

const stopTimers = () => {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
};

const startPing = () => {
  stopTimers();
  pingTimer = setInterval(() => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'ping' }));
    if (pongTimer) clearTimeout(pongTimer);
    // Молчание в ответ означает, что соединение оборвалось незаметно
    // (уснувший телефон, смена сети): закрываем и переподключаемся.
    pongTimer = setTimeout(() => ws?.close(4000, 'no pong'), PONG_TIMEOUT_MS);
  }, PING_MS);
};

const scheduleReconnect = () => {
  if (!wantOpen || reconnectTimer) return;
  const base = Math.min(RECONNECT_MIN * 2 ** attempt, RECONNECT_MAX);
  // Разброс, чтобы после падения сервера все вкладки не пришли разом.
  const delay = base / 2 + Math.random() * (base / 2);
  attempt += 1;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; open(); }, delay);
};

/* ─── Входящие события ────────────────────────────────────────────────── */

const senderName = (msg: MessageItem): string => {
  const chat = useMessengerStore.getState().chats.find(c => c.id === msg.chatId);
  const person = useMessengerStore.getState().people[msg.authorId];
  if (person) return person.name;
  return chat?.type === 'direct' ? chat.name : 'Кто-то';
};

/**
 * Уведомления берут входящее отсюда, а не из BroadcastChannel: канал
 * между вкладками больше не источник сообщений, и на нём NotifBridge
 * молчал бы.
 */
const announce = (msg: MessageItem) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('sky:incoming-message', {
    detail: { message: msg, senderName: senderName(msg) },
  }));
};

/**
 * Как подписать входящий звонок.
 *
 * Имя приходит не от звонящего: сервер его не пересылает, иначе на
 * экране входящего можно было бы представиться кем угодно. Берём его из
 * своего же справочника — общий чат у нас с ним есть, иначе звонок сюда
 * бы не дошёл.
 */
const callerOf = (userId: string) => {
  const store = useMessengerStore.getState();
  const person = store.people[userId];
  if (person) return { name: person.name, avatar: (person.name || '?').slice(0, 1).toUpperCase() };
  const chat = store.chats.find(c => c.type === 'direct' && (c.participants ?? []).includes(userId));
  const name = chat?.name || 'Неизвестный';
  return { name, avatar: name.slice(0, 1).toUpperCase() };
};

/** Событие хаба → сообщение сигналинга звонков в его собственном виде. */
const toSignal = (type: string, data: any): SignalMsg | null => {
  const from   = String(data?.from ?? '');
  const callId = String(data?.callId ?? data?.payload?.callId ?? '');
  const p      = data?.payload ?? {};
  if (!from || !callId) return null;
  const base = { callId, from, to: myId };

  switch (type) {
    case 'call-incoming': {
      const who = callerOf(from);
      return { ...base, type: 'offer', sdp: p.sdp, mode: p.mode === 'video' ? 'video' : 'voice',
               callerName: who.name, callerAvatar: who.avatar };
    }
    case 'call-answered':   return { ...base, type: 'answer', sdp: p.sdp };
    case 'ice-candidate':   return { ...base, type: 'ice', candidate: p.candidate };
    case 'call-rejected':   return { ...base, type: 'reject' };
    case 'call-ended':      return { ...base, type: 'end' };
    case 'call-unavailable':return { ...base, type: 'unavailable' };
    default: return null;
  }
};

const handle = (data: any) => {
  const store = useMessengerStore.getState();
  const { type, payload } = data ?? {};

  switch (type) {
    case 'authorized': {
      authorized = true;
      attempt = 0;
      refreshed = false;
      online.clear();
      (payload?.onlineUsers ?? []).forEach((id: string) => online.add(id));
      notifyOnline();
      flushQueue();
      break;
    }

    case 'pong':
      if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
      break;

    case 'auth-failed':
      // Токен не приняли. Одна попытка обновить его — и, если сессии
      // действительно нет, дальше молчим: следующий вход подключит снова.
      authorized = false;
      if (!refreshed) {
        refreshed = true;
        void apiRefreshSession().then(r => { if (r.ok) open(); });
      } else {
        wantOpen = false;
      }
      break;

    case 'chats-snapshot': {
      const raw: any[] = payload?.chats ?? [];
      store.applyChats(
        raw.map(c => toChatItem(c, myId, store.chats.find(p => p.id === c.id))),
        raw.flatMap(c => c.people ?? []),
      );
      break;
    }

    case 'messages-snapshot':
      store.applyMessages(payload?.chatId, (payload?.messages ?? []).map((m: any) => toMessageItem(m, myId)));
      break;

    case 'snapshot-done':
      store.markSynced();
      break;

    case 'chat-created': {
      const raw = payload?.chat;
      if (!raw?.id) break;
      store.applyChat(toChatItem(raw, myId, store.chats.find(c => c.id === raw.id)), raw.people ?? []);
      break;
    }

    case 'chat-rejected':
      // Сервер не дал создать чат (занятый id, несуществующий участник).
      // Убираем оптимистично добавленный, чтобы список не врал.
      store.dropChat(payload?.chatId);
      break;

    case 'new-message': {
      const msg = toMessageItem(payload?.message, myId);
      store.applyIncoming(msg);
      if (!msg.fromMe) announce(msg);
      break;
    }

    case 'message-sent':
      store.applyConfirmed(toMessageItem(payload?.message, myId));
      break;

    case 'message-edited':
      store.applyEdited(payload?.messageId, payload?.text, payload?.editedAt);
      break;

    case 'message-deleted':
      store.applyDeleted(payload?.messageId);
      break;

    case 'message-reaction':
      store.applyReaction(payload?.messageId, payload?.emoji, payload?.userId, Boolean(payload?.removed));
      break;

    case 'user-typing':
      store.setTyping(payload?.chatId, payload?.username || payload?.userId, Boolean(payload?.active));
      break;

    case 'messages-read':
      store.applyRead(payload?.messageIds ?? []);
      break;

    case 'user-online':
      if (payload?.userId) { online.add(payload.userId); notifyOnline(); }
      break;

    case 'user-offline':
      if (payload?.userId) { online.delete(payload.userId); notifyOnline(); }
      break;

    /* Звонки идут по тому же сокету — отдельного соединения им не нужно. */
    case 'call-incoming':
    case 'call-answered':
    case 'ice-candidate':
    case 'call-rejected':
    case 'call-ended':
    case 'call-unavailable': {
      const signal = toSignal(type, data);
      if (signal) bsignal.receive(signal);
      break;
    }
  }
};

/* ─── Жизненный цикл ──────────────────────────────────────────────────── */

const open = () => {
  if (!wantOpen || typeof WebSocket === 'undefined') return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  let socket: WebSocket;
  try {
    socket = new WebSocket(WS_URL());
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onopen = async () => {
    // Токен не кладём в адрес: адреса попадают в логи прокси и в
    // историю браузера. Первым сообщением — и только по открытому TLS.
    let token = getAccessToken();
    if (!token) {
      const r = await apiRefreshSession();
      token = r.ok ? getAccessToken() : null;
    }
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!token) { socket.close(4401, 'no token'); return; }
    socket.send(JSON.stringify({ type: 'auth', payload: { token } }));
    startPing();
  };

  socket.onmessage = (ev) => {
    let data: any;
    try { data = JSON.parse(String(ev.data)); } catch { return; }
    handle(data);
  };

  socket.onclose = () => {
    if (ws === socket) { ws = null; authorized = false; }
    stopTimers();
    if (online.size) { online.clear(); notifyOnline(); }
    useMessengerStore.getState().setConnected(false);
    scheduleReconnect();
  };

  socket.onerror = () => { /* onclose придёт следом и всё разберёт */ };
};

export const connectSocket = (uid: string) => {
  if (!uid) return;
  if (wantOpen && myId === uid && ws) return;
  disconnectSocket();
  myId = uid;
  wantOpen = true;
  attempt = 0;
  refreshed = false;
  open();
};

export const disconnectSocket = () => {
  wantOpen = false;
  authorized = false;
  queue.length = 0;
  stopTimers();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { const s = ws; ws = null; try { s.close(1000, 'bye'); } catch { /* уже закрыт */ } }
  if (online.size) { online.clear(); notifyOnline(); }
};

/* ─── Публичное API для UI-компонентов ────────────────────────────────── */

export const broadcast = {
  /** Вызывается из ChatWindow после sendMessage() */
  message(msg: MessageItem) {
    // Отложенное уходит не сейчас, а когда наступит его срок: иначе
    // «отправить в 9 утра» означало бы «отправить немедленно».
    if (msg.isScheduled) return;
    send({ type: 'send-message', payload: { chatId: msg.chatId, message: msg } });
  },

  /** Вызывается из ChatWindow при вводе текста */
  typing(chatId: string, username: string, active: boolean) {
    send({ type: 'typing', payload: { chatId, username, active } });
  },

  /** Вызывается из ChatList/store при создании нового чата */
  newChat(chat: ChatItem) {
    send({ type: 'create-chat', payload: { chat: {
      id: chat.id, type: chat.type, name: chat.name,
      username: chat.username, avatar: chat.avatar,
      description: chat.description, participants: chat.participants ?? [],
    } } });
  },

  /** Реакция на сообщение */
  react(msgId: string, emoji: string, _userId: string) {
    send({ type: 'react-message', payload: { messageId: msgId, emoji } });
  },

  /** Редактирование сообщения */
  edit(id: string, text: string, _editedAt: string) {
    send({ type: 'edit-message', payload: { messageId: id, text } });
  },

  /** Удаление сообщения */
  delete(id: string) {
    send({ type: 'delete-message', payload: { messageId: id } });
  },

  /** Прочтение чата — из него сервер считает галочки у отправителя. */
  read(chatId: string) {
    send({ type: 'read-messages', payload: { chatId } });
  },
};

// Стор отправляет через ту же очередь (отложенные сообщения, прочтение).
setWireSink(send);

export const wsApi = broadcast;

/** Подписка на список тех, кто сейчас в сети. Возвращает отписку. */
export const subscribeOnline = (fn: (ids: Set<string>) => void) => {
  onlineWatchers.add(fn);
  fn(new Set(online));
  return () => { onlineWatchers.delete(fn); };
};

export const getOnlineUsers = () => new Set(online);

export { toChatItem, toMessageItem };
