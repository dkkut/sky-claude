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
import { refreshIceServers } from '@/shared/rtcConfig';
import { emitGoOrder } from '@/go/live';
import { useMessengerStore } from './store';
import { getAccessToken, apiRefreshSession } from '@/core/auth/api';
import { NATIVE_APP, API_ORIGIN, getApiOrigin, failoverApiOrigin } from '@/core/nativeApp';
import { setWireSink, setVolatileSink, type Outgoing } from '@/core/wire';
import { bsignal, type SignalMsg } from '@/calls/webrtc';
import { receiveTogether } from '@/together/togetherState';
import { useAdminStore, ADMIN_ERRORS, POST_ERRORS } from './adminStore';
import { useTrashStore } from './trashStore';
import { useSettings } from '@/settings/store';
import { useAuthStore } from '@/core/auth/store';
import { usePrivacyStore } from '@/profile/privacyStore';
import { useGamingStore, type MatchInfo, type MatchResultChange } from '@/gaming/store';
import { useVoicePartyStore } from '@/voiceparty/store';
import { useGameServers } from '@/gaming/serversStore';
import { toClientRoom, toClientParticipant } from '@/voiceparty/api';
import { useStreamsStore } from '@/streams/store';
import { receiveLiveSignal } from '@/streams/webrtc';
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
  // Собеседник мог убрать переписку у себя — тогда его в составе чата
  // уже нет. Название при этом менять не на что: оставляем прежнее,
  // иначе человек увидел бы в списке своё собственное имя.
  const name = peer ? peer.name
    : raw.type === 'direct' ? (prev?.name || raw.name || 'Собеседник')
    : (raw.name || 'Без названия');
  return {
    id:       raw.id,
    type:     raw.type as ChatType,
    name,
    username: peer ? peer.username : (prev?.username ?? raw.username ?? ''),
    avatar:   initials(name),
    online:   prev?.online ?? false,
    members:  raw.type === 'direct' ? undefined : people.length,
    participants: raw.participants ?? people.map(p => p.id),
    description:  raw.description,
    ownerId:      raw.ownerId,
    // Роль решает сервер; интерфейс по ней только рисует кнопки.
    myRole:       raw.myRole,
    // Пометка «оставить непрочитанным» — с сервера, своя у каждого.
    markedUnread: Boolean(raw.markedUnread),
    // Закрепление, архив и звук приходят с сервера: это пометки
    // участника, одинаковые на всех его устройствах.
    pinned:   Boolean(raw.pinned),
    archived: Boolean(raw.archived),
    muted:    Boolean(raw.muted),
    // Папка пока нигде не выставляется — оставляем как было.
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
    // открыл. У чужого важно другое — прочитал ли его я сам; сервер
    // теперь это сообщает, и счётчик непрочитанного больше не воскресает
    // после перезагрузки страницы.
    status:    mine ? (raw.readByAll ? 'read' : 'sent')
                    : (raw.readByMe ? 'read' : 'delivered'),
    // Локальные пометки на сервере не живут — они не должны приезжать
    // обратно как чужие.
    isScheduled: false,
    scheduledAt: undefined,
  };
};

/* ─── Состояние соединения ────────────────────────────────────────────── */

/**
 * Родное приложение открыто со своего origin (вшитый бандл, не боевой
 * домен) — location.host там ничего не значит, хаб берём из того же
 * абсолютного адреса, что и REST API (см. src/core/nativeApp.ts).
 */
const WS_URL = () => {
  if (NATIVE_APP && API_ORIGIN) {
    return `${getApiOrigin().replace(/^http/, 'ws')}/ws`;
  }
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
};

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

/**
 * Сообщения со статусом «в очереди» лежат в сохранённой переписке: очередь выше живёт только в памяти
 * вкладки и пропадает при перезагрузке. После подключения досылаем и их — иначе написанное без сети
 * так и осталось бы «ожидает отправки». Сервер вставляет сообщение по id один раз (ON CONFLICT DO NOTHING),
 * так что повтор безвреден.
 */
const resendPersistedQueued = () => {
  const inMemory = new Set(queue.map((m) => (m as { payload?: { message?: { id?: string } } }).payload?.message?.id).filter(Boolean));
  flushQueue();
  const me = useAuthStore.getState().currentUserId;
  if (!me) return;
  for (const m of useMessengerStore.getState().messages) {
    if (!m.fromMe || m.status !== 'queued' || m.isScheduled || inMemory.has(m.id)) continue;
    if (!authorized || ws?.readyState !== WebSocket.OPEN) break;
    ws.send(JSON.stringify({ type: 'send-message', payload: { chatId: m.chatId, message: m } }));
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
  // Основной адрес не отвечает уже несколько попыток — пробуем запасной (родное приложение)
  if (NATIVE_APP && attempt >= 2) void failoverApiOrigin();
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

/**
 * Слушатели панели администратора.
 *
 * Панель живёт на том же сокете, но в общем разборе ей делать нечего:
 * её сообщения нужны только ей, и ждёт она их по одному на запрос.
 */
type AdminMessage = { type: string; payload: any };
const adminWatchers = new Set<(m: AdminMessage) => void>();

export const onAdminMessage = (fn: (m: AdminMessage) => void) => {
  adminWatchers.add(fn);
  return () => adminWatchers.delete(fn);
};

const handle = (data: any) => {
  const store = useMessengerStore.getState();
  const { type, payload } = data ?? {};

  if (typeof type === 'string' && type.startsWith('admin-')) {
    for (const fn of adminWatchers) {
      try { fn({ type, payload }); } catch { /* слушатель панели упал — не наше дело */ }
    }
    return;
  }

  switch (type) {
    case 'authorized': {
      void refreshIceServers(true);   // STUN/TURN для звонков и трансляций
      authorized = true;
      attempt = 0;
      refreshed = false;
      online.clear();
      (payload?.onlineUsers ?? []).forEach((id: string) => online.add(id));
      notifyOnline();
      resendPersistedQueued();
      break;
    }

    /* Ограниченный доступ (устройство не подтверждено): сокет не открыт для чатов; запрос входа с нового устройства */
    case 'limited':
      authorized = false; wantOpen = false;
      window.dispatchEvent(new CustomEvent('sky:limited'));
      break;
    case 'limited:pending':
      window.dispatchEvent(new CustomEvent('sky:limited-pending'));
      break;

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
      // Список запретов ведёт сервер: браузер его только отображает.
      if (Array.isArray(payload?.blocked)) store.applyBlocked(payload.blocked);
      break;
    }

    case 'blocked-changed':
      store.applyBlocked(payload?.blocked ?? []);
      break;

    /* ── Подарки: сервер сам решает, кому и когда (server/giftnotify.mjs) ── */
    case 'gift-notification':
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sky:gift-notification', { detail: payload }));
      }
      break;

    /* Заказы Market, сделки Garant, Family, нарушения: раньше событие приходило,
       но пользователь его не видел. Теперь оно попадает в «Уведомления». */
    case 'market-notification':
    case 'garant-notification':
    case 'family-notification':
    case 'violation-notification':
      if (typeof window !== 'undefined') {
        const title = payload?.title ?? ({
          'market-notification': 'Sky Market', 'garant-notification': 'Sky Garant',
          'family-notification': 'Sky Family', 'violation-notification': 'Нарушение',
        } as Record<string, string>)[type];
        window.dispatchEvent(new CustomEvent('sky:server-notification', {
          detail: { title, body: payload?.body ?? payload?.text ?? '', id: payload?.id },
        }));
      }
      break;

    /* Логистика: сервер шлёт событие, но список уведомлений курьера сам не
       обновлялся — новое появлялось только после перезахода на вкладку. */
    case 'logi-notification':
      void import('@/marketplace/logistics/courierStore')
        .then((m) => m.useCourierStore.getState().pushNotification())
        .catch(() => {});
      break;

    case 'messages-older':
      store.applyOlder(payload?.chatId,
        (payload?.messages ?? []).map((m: any) => toMessageItem(m, myId)),
        Boolean(payload?.done));
      break;

    case 'chat-removed':
    case 'chat-left':
      // Чат распустили, или из него вышли мы сами. У остальных
      // участников чат остаётся — им приходит обновлённый состав.
      if (type === 'chat-removed' || payload?.userId === myId) store.applyChatGone(payload?.chatId);
      break;

    case 'chat-trashed':
      // Чат удалён у всех: убираем из списка, а корзину, если её уже
      // открывали, просим обновить.
      store.applyChatGone(payload?.chatId);
      if (useTrashStore.getState().loaded) store.loadTrash();
      break;

    case 'trash-snapshot':
      useTrashStore.getState().set((payload?.chats ?? []).map((raw: any) => {
        const c = toChatItem(raw, myId);
        return { id: c.id, name: c.name, type: c.type, trashedAt: raw.trashedAt, canRestore: raw.canRestore === true };
      }));
      break;

    case 'chat-restored':
      useTrashStore.getState().drop(payload?.chatId);
      break;

    /* ── Приватность профиля: решает сервер ── */
    case 'privacy':
      usePrivacyStore.getState().apply(payload ?? {});
      // «Скрыть был(а) в сети» на экране настроек — тот же самый
      // переключатель, только короткий: «никто» против «все».
      useSettings.getState().applyServerPrivacy(payload?.whoSeesOnline === 'nobody');
      break;

    /* ── Матчмейкинг Sky Games: решает сервер (server/matchmaking.mjs) ── */
    case 'mm:queued':
      useGamingStore.getState().applyQueued(payload?.gameId);
      break;
    case 'mm:found':
      useGamingStore.getState().applyFound(payload?.match as MatchInfo);
      break;
    case 'mm:waiting':
      useGamingStore.getState().applyWaiting(payload?.match as MatchInfo);
      break;
    case 'mm:confirmed':
      useGamingStore.getState().applyConfirmed(payload?.match as MatchInfo, payload?.voiceRoomId ?? null);
      break;
    case 'mm:reported':
      useGamingStore.getState().applyReported(payload?.match as MatchInfo);
      break;
    case 'mm:result-confirmed':
      useGamingStore.getState().applyResultConfirmed(payload?.change as MatchResultChange);
      break;
    case 'mm:result-disputed':
      useGamingStore.getState().applyResultDisputed();
      break;
    case 'mm:cancelled':
      useGamingStore.getState().applyCancelled();
      break;
    case 'mm:cancelled-requeued':
      useGamingStore.getState().applyCancelledRequeued(payload?.gameId);
      break;
    case 'mm:error':
      useGamingStore.getState().applyMmError();
      break;

    /* ── Sky GO: заказ изменился — открытые экраны перечитают его ── */
    case 'go:order':
      emitGoOrder(payload?.orderId, payload?.status);
      break;
    case 'go:offer':   // водителю предложили заказ — список заказов перечитывается сразу
      emitGoOrder(payload?.orderId, 'offer');
      break;

    /* ── Игровые серверы: сообщения каналов и перемены на сервере ── */
    case 'gs:message':
      useGameServers.getState().applyMessage(payload?.serverId, payload?.message);
      break;
    case 'gs:message-deleted':
      useGameServers.getState().applyMessageDeleted(payload?.channelId, payload?.id);
      break;
    case 'gs:changed':
      useGameServers.getState().applyChanged(payload?.serverId);
      break;
    case 'gs:removed':
      useGameServers.getState().applyRemoved(payload?.serverId);
      break;

    /* ── Войс-пати: кто внутри и живое состояние комнаты — с сервера ── */
    case 'vp:joined':
      useVoicePartyStore.getState().applyJoined(toClientRoom(payload?.room));
      break;
    case 'vp:participant-joined':
      useVoicePartyStore.getState().applyParticipantJoined(payload?.roomId, toClientParticipant(payload?.participant));
      break;
    case 'vp:participant-left':
      useVoicePartyStore.getState().applyParticipantLeft(payload?.roomId, payload?.profileId);
      break;
    case 'vp:participant-updated':
      useVoicePartyStore.getState().applyParticipantUpdated(payload?.roomId, payload?.profileId, payload?.patch ?? {});
      break;
    case 'vp:room-updated':
      useVoicePartyStore.getState().applyRoomUpdated(payload?.roomId, payload?.permissions);
      break;
    case 'vp:chat':
      useVoicePartyStore.getState().applyChat(payload?.roomId, payload?.message);
      break;
    case 'vp:pin':
      useVoicePartyStore.getState().applyPin(payload?.roomId, payload?.messageId, Boolean(payload?.pinned));
      break;
    case 'vp:reaction':
      useVoicePartyStore.getState().applyReaction(payload?.roomId, payload?.reaction);
      break;
    case 'vp:kicked':
      useVoicePartyStore.getState().applyKicked();
      break;
    case 'vp:left':
    case 'vp:error':
      break;

    /* ── Трансляции: живое состояние — с сервера ── */
    case 'live:joined':
      useStreamsStore.getState().applyJoined(payload?.stream);
      break;
    case 'live:viewer-joined':
      useStreamsStore.getState().applyViewerJoined(payload?.streamId, payload?.viewerId, payload?.viewerCount);
      break;
    case 'live:viewer-left':
      useStreamsStore.getState().applyViewerLeft(payload?.streamId, payload?.viewerCount);
      break;
    case 'live:chat':
      useStreamsStore.getState().applyChat(payload?.streamId, payload?.message);
      break;
    case 'live:react':
      useStreamsStore.getState().applyReact(payload?.streamId, payload?.emoji, payload?.count);
      break;
    case 'live:predict-create':
      useStreamsStore.getState().applyPredictionCreate(payload?.streamId, payload?.prediction);
      break;
    case 'live:predict-update':
      useStreamsStore.getState().applyPredictionUpdate(payload?.streamId, payload?.prediction);
      break;
    case 'live:kicked':
      useStreamsStore.getState().applyKicked(payload?.streamId);
      break;
    case 'live:ended':
      useStreamsStore.getState().applyEnded(payload?.streamId);
      break;
    case 'live:donation':
      useStreamsStore.getState().applyDonation(payload?.streamId, payload?.message ?? null, payload?.totalDonationsPoints);
      break;
    case 'live:error':
      break;
    case 'live:offer':
      receiveLiveSignal({ type: 'offer', streamId: payload?.streamId, from: payload?.from, to: payload?.to, sdp: payload?.sdp });
      break;
    case 'live:answer':
      receiveLiveSignal({ type: 'answer', streamId: payload?.streamId, from: payload?.from, to: payload?.to, sdp: payload?.sdp });
      break;
    case 'live:ice':
      receiveLiveSignal({ type: 'ice', streamId: payload?.streamId, from: payload?.from, to: payload?.to, candidate: payload?.candidate });
      break;
    case 'live:viewer-request':
      receiveLiveSignal({ type: 'viewer-request', streamId: payload?.streamId, from: payload?.from });
      break;

    /* ── Управление группой и каналом ── */
    case 'chat-settings':
      useAdminStore.getState().applySettings(payload?.chatId, payload?.settings);
      break;

    case 'chat-members':
      useAdminStore.getState().applyMembers(payload?.chatId, {
        members: payload?.members, hidden: payload?.hidden, count: payload?.count,
      });
      break;

    case 'chat-invites':
      useAdminStore.getState().applyInvites(payload?.chatId, payload?.invites ?? []);
      break;

    case 'chat-requests':
      useAdminStore.getState().applyRequests(payload?.chatId, payload?.requests ?? []);
      break;

    case 'chat-log':
      useAdminStore.getState().applyLog(payload?.chatId, payload?.entries ?? []);
      break;

    case 'chat-error':
      // Отказ показываем словами: молчаливое бездействие кнопки хуже,
      // чем объяснение, почему она не сработала.
      useAdminStore.getState().notify(ADMIN_ERRORS[payload?.error] ?? 'Не получилось');
      break;

    case 'message-rejected':
      useAdminStore.getState().notify(POST_ERRORS[payload?.reason] ?? 'Сообщение не отправлено');
      store.dropMessage(payload?.messageId);
      break;

    case 'join-result':
      if (payload?.error) {
        useAdminStore.getState().notify(ADMIN_ERRORS[payload.error] ?? 'Не получилось войти');
      } else if (payload?.pending) {
        useAdminStore.getState().notify('Заявка отправлена — ждите одобрения');
      }
      break;

    case 'message-pinned':
      store.applyPinned(payload?.messageId, Boolean(payload?.pinned));
      break;

    case 'message-favorited':
      store.applyFavorite(payload?.messageId, Boolean(payload?.favorited));
      break;

    case 'message-burned':
      // Сгорело по сроку или после просмотра — у всех одинаково.
      store.deleteMessage(payload?.messageId);
      break;

    case 'poll-votes':
      store.applyPollVotes(payload?.messageId, payload?.votes ?? {});
      break;

    case 'message-views':
      store.applyViews(payload?.counts ?? []);
      break;

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
      // Сервер не дал создать чат (занятый id, несуществующий участник,
      // или собеседник ограничил, кто может ему писать).
      // Убираем оптимистично добавленный, чтобы список не врал.
      store.dropChat(payload?.chatId);
      if (payload?.reason) {
        useAdminStore.getState().notify(
          POST_ERRORS[payload.reason] ?? 'Не получилось начать переписку');
      }
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

    case 'user-typing': {
      // Имя набирающего сервер не пересылает — его присылал сам клиент,
      // и назваться можно было кем угодно. Берём из списка участников.
      const who = payload?.userId ? store.people[payload.userId] : undefined;
      const label = who?.username || who?.name || 'Кто-то';
      store.setTyping(payload?.chatId, label, Boolean(payload?.active));
      break;
    }

    case 'messages-read':
      store.applyRead(payload?.messageIds ?? []);
      break;

    case 'online-reset':
      // Сменили настройку присутствия: сервер прислал заново весь круг
      // тех, с кем мы видны друг другу. Спрятавшись, человек перестаёт
      // видеть и чужое — кружки должны погаснуть сразу.
      online.clear();
      for (const id of payload?.onlineUsers ?? []) online.add(id);
      notifyOnline();
      break;

    case 'user-online':
      if (payload?.userId) { online.add(payload.userId); notifyOnline(); }
      break;

    case 'user-offline':
      if (payload?.userId) { online.delete(payload.userId); notifyOnline(); }
      break;

    /* Совместный просмотр идёт по тому же сокету: второго соединения
       и второй системы связи для него не заводили. */
    case 'together-state':
    case 'together-join':
    case 'together-leave':
    case 'together-decline':
    case 'together-end':
    case 'together-settings':
    case 'together-invited':
    case 'together-error':
    case 'together-chat':
    case 'together-chat-error':
      receiveTogether(type, payload);
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

/* Сеть вернулась — не ждём конца паузы переподключения: человек написал сообщения без связи и ждёт их отправки. */
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (!wantOpen || authorized) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    attempt = 0;
    open();
  });
}

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

/*
 * Летучая отправка: без очереди.
 *
 * Команды совместного просмотра устаревают за секунды. Досланная после
 * восстановления связи «пауза» относилась бы к моменту, которого давно
 * нет, и сбила бы строй всем остальным. Поэтому нет связи — команда
 * пропадает, а состояние подтянет ближайшая сверка.
 */
setVolatileSink((msg) => {
  if (authorized && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
});

export const wsApi = broadcast;

/** Подписка на список тех, кто сейчас в сети. Возвращает отписку. */
export const subscribeOnline = (fn: (ids: Set<string>) => void) => {
  onlineWatchers.add(fn);
  fn(new Set(online));
  return () => { onlineWatchers.delete(fn); };
};

export const getOnlineUsers = () => new Set(online);

export { toChatItem, toMessageItem };
