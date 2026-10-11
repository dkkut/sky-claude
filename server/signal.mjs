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
import { verifyToken, rateLimit, rateLimitPerHour } from './security.mjs';
import { sessionStore, onSessionRevoked } from './sessions.mjs';
import { query } from './db.mjs';
import { BETA_COOKIE, parseCookies } from './cookies.mjs';
import { originAllowed, clientIp } from './http.mjs';
import { getPrivacy, setPrivacy, presenceBetween, mayCall } from './privacy.mjs';
import {
  restrictionsOf, isBannedNow, isAdmin,
  restrictUser, setModerationNote,
  blockSkyId, skyIdBlockOf,
} from './admin.mjs';
import {
  rightsOf, can, myRights, requestMeta,
  logAdmin, logSecurityEvent, readAdminLog, readSecurityEvents, verifyAdminLog,
  beginStepUp, consumeStepUp,
  createPendingAction, listPendingActions, decidePendingAction,
  listAdminsWithRoles, findPerson, lockdownState, setLockdown,
  ROLE_NAMES, PERMISSIONS,
} from './adminsec.mjs';
import { grantForProposal } from './campaigns.mjs';
import { userMoneySummary } from './adminmoney.mjs';
import { adminGetOrder } from './kutrentmarket.mjs';
import { betaEnabled, betaHashLive } from './beta.mjs';
import { markActive, setOnlineSource } from './analytics.mjs';
import {
  listChats, listMessages, createChat, saveMessage,
  editMessage, deleteMessage, markRead, memberIds, isMember, toggleReaction,
  blockUser, unblockUser, listBlocked, addMember, leaveChat, trashChat, restoreChat, listTrashed, getChat, setMarkedUnread, setChatFlags, votePoll, consumeOnce, sweepExpired, toggleFavorite,
} from './chats.mjs';
import { applyCommand, sendRoomMessage } from './together.mjs';
import {
  getSettings, updateSettings, setRole, kickMember, unbanMember, muteMember,
  createInvite, revokeInvite, listInvites, joinByInvite,
  listJoinRequests, decideJoin, listLog, listMembers, markViewed, pinMessage,
  contextFor,
} from './chatadmin.mjs';
import {
  joinQueue, leaveQueue, acceptMatch, declineMatch, sweepStaleMatches, myActiveMatch,
  teamSizeFor, GAME_TITLE, reportResult, confirmResult, disputeResult,
} from './matchmaking.mjs';
import {
  joinRoom as vpJoinRoom, leaveRoom as vpLeaveRoom, leaveAllRooms as vpLeaveAllRooms,
  memberIds as vpMemberIds, isMember as vpIsMember, bothInRoom as vpBothInRoom, roomIdFromCallId as vpRoomIdFromCallId,
  setMuted as vpSetMuted, setHandRaised as vpSetHandRaised, setRole as vpSetRole,
  kick as vpKick, ban as vpBan, canModerate as vpCanModerate, isOwner as vpIsOwner, updatePermissions as vpUpdatePermissions,
  createRoom as vpCreateRoom,
} from './voiceparty.mjs';
import {
  join as liveJoin, leave as liveLeave, viewerIds as liveViewerIds, isViewer as liveIsViewer,
  sendChat as liveSendChat, react as liveReact, createPrediction as liveCreatePrediction,
  voteOnPrediction as liveVote, closePrediction as liveClosePrediction, ban as liveBan,
  endStreamsByDisconnect as liveEndByDisconnect, leaveAllStreams as liveLeaveAllStreams,
  getStream as liveGetStream,
} from './streams.mjs';

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
/**
 * Отдельный счётчик для «Вместе».
 *
 * Общего предела в 240 действий на минуту мало: перемотка ползунком
 * шлёт события пачкой, и без своего счётчика один человек с дёргающимся
 * пальцем выбирал бы весь лимит, после чего у него отвалилась бы
 * переписка. Здесь предел свой и последствие своё — отказ на команду, а
 * не разрыв соединения.
 */
const TOGETHER_PER_MIN = 120;
const togetherRate = new Map();
const allowTogether = (userId) => {
  const now = Date.now();
  const slot = togetherRate.get(userId);
  if (!slot || now - slot.at > 60_000) { togetherRate.set(userId, { at: now, n: 1 }); return true; }
  slot.n += 1;
  return slot.n <= TOGETHER_PER_MIN;
};

/** Чат комнаты — свой счётчик, отдельно от команд воспроизведения:
    кто-то, спамящий сообщениями, не должен мешать никому отправлять
    play/pause/seek, и наоборот. */
const TOGETHER_CHAT_PER_MIN = 30;
const togetherChatRate = new Map();
const allowTogetherChat = (userId) => {
  const now = Date.now();
  const slot = togetherChatRate.get(userId);
  if (!slot || now - slot.at > 60_000) { togetherChatRate.set(userId, { at: now, n: 1 }); return true; }
  slot.n += 1;
  return slot.n <= TOGETHER_CHAT_PER_MIN;
};

const pending = new Map();

// userId → набор соединений (у человека может быть открыто несколько вкладок)
const clients = new Map();
// Мониторинг считает онлайн по живым соединениям (server/analytics.mjs).
setOnlineSource(() => ({ users: clients.size, sessions: [...clients.values()].reduce((n, set) => n + set.size, 0) }));
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
/** Зрители + сам вещатель — он не входит в список зрителей (не смотрит
 *  свой же эфир), но должен видеть тот же чат/реакции/прогнозы. */
const liveAudience = async (streamId) => {
  const stream = await liveGetStream(streamId);
  const ids = liveViewerIds(streamId);
  return stream ? [...new Set([...ids, stream.authorId])] : ids;
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

  // Если человек обновил страницу или переподключился с телефона, пока
  // матч ждал подтверждения (или уже подтверждён) — он не должен
  // потерять его из вида и залипнуть в пустой очереди.
  const activeMatch = await myActiveMatch(userId);
  if (activeMatch) {
    const type = activeMatch.status === 'reported' ? 'mm:reported'
      : activeMatch.status === 'confirmed' ? 'mm:confirmed' : 'mm:found';
    send(ws, { type, payload: { match: activeMatch } });
  }

  const chats = await listChats(userId);
  // Список запретов приезжает вместе с чатами: он теперь серверный, и
  // браузер не должен решать его самостоятельно.
  send(ws, { type: 'chats-snapshot', payload: { chats, blocked: await listBlocked(userId) } });

  for (const chat of chats) {
    // Сбой на одном чате не должен оставлять человека без снимка вовсе:
    // без завершающего события клиент ждёт молча и бесконечно. Лучше
    // отдать остальное и записать сбой в журнал.
    let messages = [];
    try {
      messages = await listMessages(chat.id, userId, 50) ?? [];
    } catch (err) {
      console.error('[ws] снимок чата', chat.id, err.message);
    }
    send(ws, { type: 'messages-snapshot', payload: { chatId: chat.id, messages } });
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
 * С кем этот человек виден друг другу.
 *
 * Мало быть в общем чате: у каждого своя настройка «кто видит в сети»,
 * и решает её сервер. Присутствие взаимно — спрятавшись, человек
 * перестаёт видеть и чужое, — поэтому «кого вижу я» и «кто видит меня»
 * это один и тот же список.
 */
const presenceCircle = async (userId) =>
  presenceBetween(userId, await nearbyOnline(userId));

const visibleOnline = presenceCircle;
const presenceAudience = presenceCircle;

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

      // Без предела отсюда можно было слать сколько угодно сообщений в
      // секунду — ни один administrative-запрет этого не ловит, это не
      // бан, а обычный поток. Предел щедрый для живого человека и тесен
      // для скрипта: 120/мин — вдвое больше, чем у vp:chat/live:chat,
      // потому что это основной мессенджер, а не комментарии к эфиру.
      if (!rateLimit(`msg:send:${me}`, 120)) return;

      // Наказания администратора. Раньше сервер о них не знал вовсе:
      // забаненный продолжал писать как ни в чём не бывало.
      const limits = await restrictionsOf(me);
      if (limits.bannedUntil) { ws.close(4403, 'banned'); return; }
      if (limits.spamUntil) {
        send(ws, { type: 'message-rejected',
          payload: { chatId, messageId: message?.id, reason: 'spam_blocked' } });
        return;
      }
      // «Запрет говорить» — про голос: голосовые и кружки.
      if (limits.mutedUntil && (message?.kind === 'voice' || message?.kind === 'video-note')) {
        send(ws, { type: 'message-rejected',
          payload: { chatId, messageId: message?.id, reason: 'voice_muted' } });
        return;
      }

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
      if (!rateLimit(`msg:edit:${me}`, 60)) return;
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
      if (!rateLimit(`msg:delete:${me}`, 60)) return;
      const { messageId } = payload ?? {};
      const removed = await deleteMessage(messageId, me);
      if (!removed) return;
      fanout(await memberIds(removed.chatId),
        { type: 'message-deleted', payload: { messageId: removed.id, chatId: removed.chatId } }, ws);
      break;
    }

    case 'react-message': {
      if (!rateLimit(`msg:react:${me}`, 120)) return;
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
      // Рассылается всем участникам чата и ничего не пишет в базу —
      // дешевле всего отправить и дороже всего разослать большой группе.
      // Без предела этим можно было устроить шторм рассылок практически
      // бесплатно для отправителя.
      if (!rateLimit(`msg:typing:${me}`, 120)) return;
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
      if (!rateLimit(`msg:read:${me}`, 120)) return;
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
      if (!rateLimit(`chat:create:${me}`, 30)) return;
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
      if (!rateLimit(`msg:list:${me}`, 120)) return;
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
      if (!rateLimit(`chat:member:${me}`, 30)) return;
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

    /* ── Удаление у всех и корзина (30 дней) ── */
    case 'delete-chat': {
      if (!rateLimit(`chat:trash:${me}`, 30)) return;
      const chatId = payload?.chatId;
      if (!chatId) return;
      const result = await trashChat(chatId, me);
      if (result.error) { send(ws, { type: 'chat-error', payload: { chatId, error: result.error } }); return; }
      // У всех участников чат исчезает; в корзине он появится по запросу.
      for (const uid of result.members) sendTo(uid, { type: 'chat-trashed', payload: { chatId, by: me } });
      break;
    }

    case 'get-trash': {
      if (!rateLimit(`chat:trashlist:${me}`, 60)) return;
      send(ws, { type: 'trash-snapshot', payload: { chats: await listTrashed(me) } });
      break;
    }

    case 'restore-chat': {
      if (!rateLimit(`chat:restore:${me}`, 30)) return;
      const chatId = payload?.chatId;
      if (!chatId) return;
      const result = await restoreChat(chatId, me);
      if (result.error) { send(ws, { type: 'chat-error', payload: { chatId, error: result.error } }); return; }
      await sendChatToEach(chatId, result.members);
      for (const uid of result.members) sendTo(uid, { type: 'chat-restored', payload: { chatId } });
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


    /* ── Панель администратора ─────────────────────────────────────
       Право спрашивается у базы на каждом действии, а не берётся из
       токена: снятые права должны действовать сразу. Раньше эта панель
       меняла записи в localStorage нажавшего и не значила ничего. ── */

    case 'admin': {
      const action = String(payload?.action ?? '');
      const target = String(payload?.userId ?? '');
      const meta = ws.adminMeta ?? {};
      const failAdm = (error, extra = {}) =>
        send(ws, { type: 'admin-error', payload: { action, error, ...extra } });

      // Единственный ответ незнающему: «нельзя». По разнице ответов
      // нельзя выяснять, кто есть в базе, а кто нет.
      const rights = await rightsOf(me);
      if (!rights.admin) {
        await logSecurityEvent(me, 'admin_probe', action, meta);
        return failAdm('not_allowed');
      }

      /* Пределы раздельные: читать панель можно часто, менять — реже,
         подтверждать личность — совсем редко. Один общий предел либо
         мешает работе, либо не мешает подбору. */
      const READS = new Set(['whoami', 'log', 'security-events', 'pending', 'admins',
        'lockdown', 'find', 'user-money']);
      const limitOk = READS.has(action)
        ? rateLimit(`adm:r:${me}`, 120)
        : action === 'step-up'
          ? rateLimitPerHour(`adm:su:${me}`, 20)
          : rateLimit(`adm:w:${me}`, 30);
      if (!limitOk) {
        await logSecurityEvent(me, 'admin_rate_limited', action, meta);
        return failAdm('too_many_requests');
      }

      /* Аварийный режим закрывает панель целиком. Владелец проходит:
         иначе включивший остался бы без способа выключить. */
      if (!rights.owner && !READS.has(action)) {
        const lock = await lockdownState();
        if (lock.active) {
          await logSecurityEvent(me, 'admin_lockdown_block', action, meta);
          return failAdm('lockdown');
        }
      }

      switch (action) {
        case 'whoami': {
          return send(ws, { type: 'admin-me', payload: await myRights(me) });
        }

        /* ── Повторное подтверждение личности ──────────────────────
           Выдаётся под конкретное действие и живёт минуты. Годное на
           всё и навсегда равно отсутствию подтверждения. */
        case 'step-up': {
          const r = await beginStepUp(me, String(payload?.purpose ?? ''), { meta });
          if (r.error) return failAdm(r.error);
          return send(ws, { type: 'admin-step-up', payload: r });
        }

        /* ── Права и роли: только через подтверждение владельца ─────
           Раньше один администратор в одиночку заводил второго. Теперь
           он оформляет заявку, а поворачивает второй ключ владелец. */
        case 'set-admin': {
          const r = await createPendingAction(
            me, payload?.value === false ? 'admin_revoke' : 'admin_grant', target,
            { role: payload?.role },
            { stepUpCode: payload?.code, reason: payload?.reason, meta });
          if (r.error) return failAdm(r.error);
          return send(ws, { type: 'admin-pending', payload: r });
        }
        case 'set-role': {
          const r = await createPendingAction(me, 'role_set', target,
            { role: payload?.role },
            { stepUpCode: payload?.code, reason: payload?.reason, meta });
          if (r.error) return failAdm(r.error);
          return send(ws, { type: 'admin-pending', payload: r });
        }

        /* ── Начисления: деньги, баллы, Prime ──────────────────────
           Тоже два ключа. Деньги из ничего — это ровно то, ради чего
           административный аккаунт и крадут. */
        case 'grant': {
          const kind = { money: 'grant_money', points: 'grant_points', prime: 'grant_prime' }[
            String(payload?.what ?? '')];
          if (!kind) return failAdm('bad_kind');
          const r = await createPendingAction(me, kind, target,
            { amount: payload?.amount, days: payload?.days, plan: payload?.plan },
            { stepUpCode: payload?.code, reason: payload?.reason, meta });
          if (r.error) return failAdm(r.error);
          return send(ws, { type: 'admin-pending', payload: r });
        }

        /* ── Деньги человека: сводка и правки ───────────────────────
           Сводка — чтение (право finance). Любая правка — заявка того же
           вида, что и начисление: оформляет сотрудник, подтверждает
           владелец с кодом (adminsec.mjs, server/adminmoney.mjs). */
        case 'user-money': {
          if (!(await can(me, 'finance'))) return failAdm('not_allowed');
          const qv = String(payload?.query ?? '').trim().replace(/^@/, '').slice(0, 80);
          if (!qv) return failAdm('not_found');
          const { rows } = await query(
            'SELECT id FROM profiles WHERE id = $1 OR lower(username) = lower($1) LIMIT 1', [qv]);
          if (!rows[0]) return failAdm('not_found');
          const data = await userMoneySummary(rows[0].id);
          if (!data) return failAdm('not_found');
          return send(ws, { type: 'admin-user-money', payload: data });
        }

        case 'money-op': {
          const kind = {
            adjust: 'adjust_balance', reverse: 'reverse_tx', revoke_prime: 'revoke_prime',
            revoke_gift: 'revoke_gift', cancel_subscription: 'cancel_subscription',
          }[String(payload?.op ?? '')];
          if (!kind) return failAdm('bad_kind');
          const r = await createPendingAction(me, kind, target,
            { amount: payload?.amount, currency: payload?.currency, txId: payload?.txId,
              refund: payload?.refund, instanceId: payload?.instanceId, what: payload?.what,
              reason: payload?.reason },
            { stepUpCode: payload?.code, reason: payload?.reason, meta });
          if (r.error) return failAdm(r.error);
          return send(ws, { type: 'admin-pending', payload: r });
        }

        /* ── Мероприятия: предложить награду ────────────────────────
           Тот же приём, что и остальные начисления: получателя не
           берём из того, что прислал клиент, — только из самой заявки
           на награду, чтобы чужой userId в запросе не мог перенаправить
           чужую награду на другой счёт. adminsec.mjs перепроверяет то
           же самое ещё раз перед тем, как заморозить содержимое заявки. */
        case 'propose-campaign-reward': {
          const grantId = String(payload?.grantId ?? '');
          const grant = await grantForProposal(grantId);
          if (!grant) return failAdm('not_found');
          const r = await createPendingAction(me, 'campaign_reward', grant.profile_id,
            { grantId },
            { stepUpCode: payload?.code, reason: payload?.reason, meta });
          if (r.error) return failAdm(r.error);
          return send(ws, { type: 'admin-pending', payload: r });
        }

        /* ── KutRent Market: запросить подтверждение оплаты ─────────
           Подключённой кассы по-прежнему нет: покупатель переводит
           деньги по реквизитам сам и указывает номер телефона, с
           которого придёт перевод (submitPaymentProof); эта заявка —
           чтобы администратор, нашедший операцию в банке по этому
           номеру, попросил владельца подтвердить. createPendingAction
           сам проверит, что номер телефона уже есть (payment proof),
           и добавит его вместе с суммой в заявку, которую увидит
           владелец. Получателя не берём из того, что прислал клиент —
           только из самого заказа, чтобы чужой userId в запросе не мог
           перенаправить зачисление на другой счёт. */
        case 'kutrent-mark-paid': {
          const orderId = String(payload?.orderId ?? '');
          const order = await adminGetOrder(orderId);
          if (!order) return failAdm('not_found');
          const r = await createPendingAction(me, 'kutrent_mark_paid', order.sky_recipient_profile_id,
            { orderId },
            { stepUpCode: payload?.code, reason: payload?.reason, meta });
          if (r.error) return failAdm(r.error);
          return send(ws, { type: 'admin-pending', payload: r });
        }

        /* ── Sky Video: корректировка дохода по ролику ─────────────
           Тот же приём, что и денежные начисления: заявка на владельца
           ролика, второй ключ поворачивает владелец панели. */
        case 'skyvideo-revenue-adjust': {
          const r = await createPendingAction(me, 'skyvideo_revenue_adjust', target,
            { videoId: payload?.videoId, amountKopecks: payload?.amountKopecks, note: payload?.note },
            { stepUpCode: payload?.code, reason: payload?.reason, meta });
          if (r.error) return failAdm(r.error);
          return send(ws, { type: 'admin-pending', payload: r });
        }

        /* ── Очередь заявок ────────────────────────────────────────
           Владелец видит все, администратор — только свои. */
        case 'pending': {
          const list = await listPendingActions(me, {
            status: payload?.status, limit: payload?.limit });
          if (list === null) return failAdm('not_allowed');
          return send(ws, { type: 'admin-pending-list', payload: { actions: list } });
        }
        case 'decide': {
          const r = await decidePendingAction(me, String(payload?.id ?? ''),
            payload?.approve === true,
            { stepUpCode: payload?.code, note: payload?.note, meta });
          if (r.error) return failAdm(r.error, r.action ? { action: r.action } : {});
          return send(ws, { type: 'admin-done', payload: { action, ...r } });
        }

        /* ── Ограничения ───────────────────────────────────────────
           Повседневная работа модерации остаётся немедленной: запирать
           её за подтверждением владельца значит остановить модерацию.
           Но ограничить другого администратора — это уже не модерация,
           а борьба внутри панели: для неё нужны право безопасности и
           подтверждение личности. */
        case 'restrict': {
          if (!(await can(me, 'moderation'))) {
            await logAdmin({ actorId: me, targetId: target, type: 'restrict',
              result: 'denied', detail: 'Нет права модерации', meta });
            return failAdm('not_allowed');
          }
          if (await isAdmin(target)) {
            if (!(await can(me, 'security'))) {
              await logAdmin({ actorId: me, targetId: target, type: 'restrict_admin',
                result: 'denied', detail: 'Ограничение администратора без права безопасности', meta });
              return failAdm('admin_protected');
            }
            const step = await consumeStepUp(me, 'restrict:admin', payload?.code, { meta });
            if (step.error) return failAdm(step.error);
          }
          /* Журнал пишет сама restrictUser — одной записью и через ту
             же цепочку. Второй записи здесь быть не должно: два писателя
             рвут цепочку, и разрыв выглядит как подделка. */
          const r = await restrictUser(me, target, String(payload?.kind ?? ''),
            payload?.minutes, { meta });
          if (r.error) {
            await logAdmin({ actorId: me, targetId: target, type: 'restrict',
              result: 'denied', detail: r.error, meta });
            return failAdm(r.error);
          }
          // Забаненного отключаем сразу, а не когда он сам уйдёт.
          if (r.kind === 'ban' && r.minutes > 0) {
            for (const sock of clients.get(target) ?? []) sock.close(4403, 'banned');
          }
          return send(ws, { type: 'admin-done', payload: { action, userId: target, ...r } });
        }
        /* ── Блокировка учётной записи ─────────────────────────────
           Не замена бану профиля, а решение потяжелее: бан закрывает
           одну витрину, блокировка — человека целиком, со всеми его
           профилями и теми, что он заведёт после. Поэтому сверх права
           модерации спрашивается подтверждение личности. */
        case 'block-account': {
          if (!(await can(me, 'moderation'))) {
            await logAdmin({ actorId: me, targetId: target, type: 'skyid_block',
              result: 'denied', detail: 'Нет права модерации', meta });
            return failAdm('not_allowed');
          }
          const minutes = Number(payload?.minutes);
          /* Снятие подтверждения личности не требует: вернуть человеку
             доступ — не то действие, от которого надо защищаться. */
          if (minutes > 0) {
            const step = await consumeStepUp(me, 'block:account', payload?.code, { meta });
            if (step.error) return failAdm(step.error);
          }
          const r = await blockSkyId(me, target, minutes, payload?.reason, { meta });
          if (r.error) {
            await logAdmin({ actorId: me, targetId: target, type: 'skyid_block',
              result: 'denied', detail: r.error, meta });
            return failAdm(r.error);
          }
          /* Закрываем открытые подключения всех его профилей сразу: иначе
             заблокированный доработает начатое до конца сессии. */
          if (r.minutes > 0) {
            const { rows: mine } = await query(
              'SELECT id FROM profiles WHERE sky_id = $1', [r.skyId]);
            for (const row of mine) {
              for (const sock of clients.get(row.id) ?? []) sock.close(4403, 'account blocked');
            }
          }
          return send(ws, { type: 'admin-done', payload: { action, userId: target, ...r } });
        }

        case 'note': {
          if (!(await can(me, 'moderation'))) return failAdm('not_allowed');
          const r = await setModerationNote(me, target, payload?.text, { meta });
          if (r.error) {
            await logAdmin({ actorId: me, targetId: target, type: 'note',
              result: 'denied', detail: r.error, meta });
            return failAdm(r.error);
          }
          return send(ws, { type: 'admin-done', payload: { action, userId: target, ...r } });
        }

        /* ── Журнал и события ──────────────────────────────────────
           Раньше журнал читал любой администратор. Список того, кто кого
           забанил, — это и список того, кого стоит бояться. */
        case 'log': {
          const entries = await readAdminLog(me, { limit: payload?.limit });
          if (entries === null) return failAdm('not_allowed');
          return send(ws, { type: 'admin-log', payload: { entries } });
        }
        case 'security-events': {
          const events = await readSecurityEvents(me, { limit: payload?.limit });
          if (events === null) return failAdm('not_allowed');
          return send(ws, { type: 'admin-security-events', payload: { events } });
        }
        case 'verify-log': {
          const r = await verifyAdminLog(me, { limit: payload?.limit });
          if (r.error) return failAdm(r.error);
          return send(ws, { type: 'admin-log-verified', payload: r });
        }
        /* Поиск человека: чтобы запрет применяли к тому, кого искали, а
           не к тому, чей идентификатор набрали с опечаткой. */
        case 'find': {
          const people = await findPerson(me, payload?.q);
          if (people === null) return failAdm('not_allowed');
          return send(ws, { type: 'admin-people', payload: { people } });
        }

        case 'admins': {
          const list = await listAdminsWithRoles(me);
          if (list === null) return failAdm('not_allowed');
          return send(ws, { type: 'admin-list', payload: {
            admins: list, roles: ROLE_NAMES, permissions: PERMISSIONS } });
        }

        /* ── Аварийный режим ───────────────────────────────────────
           Только владелец. Обычная жизнь сервиса при этом продолжается:
           страдать оттого, что у нас что-то случилось, должны мы. */
        case 'lockdown': {
          return send(ws, { type: 'admin-lockdown', payload: await lockdownState() });
        }
        case 'set-lockdown': {
          const step = await consumeStepUp(me, 'lockdown', payload?.code, { meta });
          if (step.error) return failAdm(step.error);
          const r = await setLockdown(me, payload?.on === true, payload?.reason, { meta });
          if (r.error) return failAdm(r.error);
          /* Закрыли панель — закрываем и открытые административные
             сокеты: иначе тот, кого мы закрываем, доработает начатое. */
          if (r.active) {
            for (const [uid, socks] of clients) {
              if (uid === me) continue;
              if (await isAdmin(uid)) for (const sock of socks) sock.close(4403, 'lockdown');
            }
          }
          return send(ws, { type: 'admin-lockdown', payload: r });
        }
      }
      await logSecurityEvent(me, 'admin_unknown_action', action, meta);
      return failAdm('not_allowed');
    }

    /* ── Избранное ─────────────────────────────────────────────────
       Своё у каждого, поэтому уходит только на свои устройства. ── */

    case 'favorite-message': {
      if (!rateLimit(`msg:favorite:${me}`, 120)) return;
      const result = await toggleFavorite(payload?.messageId, me);
      if (!result) return;
      sendTo(me, { type: 'message-favorited', payload: result });
      break;
    }

    /* ── Просмотр один раз ─────────────────────────────────────────
       Получатель открыл — сообщение гаснет у всех. Гасит сервер: раньше
       его прятал только браузер, а сама запись лежала вечно. ── */

    case 'consume-once': {
      if (!rateLimit(`msg:consume:${me}`, 60)) return;
      const result = await consumeOnce(payload?.messageId, me);
      if (!result) return;
      broadcast(await memberIds(result.chatId), {
        type: 'message-burned',
        payload: { chatId: result.chatId, messageId: result.messageId },
      });
      send(ws, {
        type: 'message-burned',
        payload: { chatId: result.chatId, messageId: result.messageId },
      });
      break;
    }

    /* ── Голос в опросе ────────────────────────────────────────────
       Право голосовать — участие в чате, вариант проверяется по самому
       сообщению. Раньше голос никуда не уходил вовсе. ── */

    case 'poll-vote': {
      if (!rateLimit(`msg:poll:${me}`, 60)) return;
      const result = await votePoll(payload?.messageId, me, payload?.optionId);
      if (!result) return;
      broadcast(await memberIds(result.chatId), {
        type: 'poll-votes',
        payload: { chatId: result.chatId, messageId: result.messageId, votes: result.votes },
      });
      send(ws, {
        type: 'poll-votes',
        payload: { chatId: result.chatId, messageId: result.messageId, votes: result.votes },
      });
      break;
    }

    /* ── Закрепление, архив и звук ─────────────────────────────────
       Пометки участника: меняя их, человек меняет свой вид чата и ничей
       больше. Раньше они жили в localStorage, и чат, убранный в архив с
       телефона, оставался на месте на компьютере. ── */

    case 'chat-flags': {
      const chatId = payload?.chatId;
      if (!chatId) return;
      if (!rateLimit(`chat:flags:${me}`, 60)) return;
      const ok = await setChatFlags(chatId, me, payload ?? {});
      if (!ok) return;
      const view = await getChat(chatId, me);
      if (view) sendTo(me, { type: 'chat-created', payload: { chat: view } });
      break;
    }

    /* ── «Пометить как новое» ──────────────────────────────────────
       Пометка своя у каждого участника и живёт на сервере, поэтому
       видна на всех его устройствах. ── */

    case 'mark-unread': {
      const chatId = payload?.chatId;
      if (!chatId) return;
      if (!rateLimit(`chat:unread:${me}`, 60)) return;
      const ok = await setMarkedUnread(chatId, me, payload?.value !== false);
      if (!ok) return;
      // Свой вид чата — на все свои устройства: пометка их касается.
      const view = await getChat(chatId, me);
      if (view) sendTo(me, { type: 'chat-created', payload: { chat: view } });
      break;
    }

    /* ── Матчмейкинг Sky Games ────────────────────────────────────
       gameId/matchId приходят от клиента, но "кто я" — всегда me
       (проверенная личность соединения, см. identify выше), никогда
       payload.profileId. Иначе одно соединение могло бы поставить в
       очередь или принять матч за другого человека. ── */

    case 'mm:join': {
      const gameId = String(payload?.gameId ?? '');
      if (!gameId) return;
      if (!rateLimit(`mm:write:${me}`, 30)) return;
      const r = await joinQueue(me, gameId);
      if (r.error) { send(ws, { type: 'mm:error', payload: r }); break; }
      if (r.matched) {
        send(ws, { type: 'mm:found', payload: { match: r.match } });
        // Остальные участники матча (своя команда и соперники) уже
        // ждали в очереди на других соединениях — то же событие уходит
        // каждому из них, не только тому, кто только что зашёл и нашёл
        // весь состав.
        for (const uid of r.opponentIds) sendTo(uid, { type: 'mm:found', payload: { match: r.match } });
      } else {
        send(ws, { type: 'mm:queued', payload: { gameId } });
      }
      break;
    }

    case 'mm:leave': {
      if (!rateLimit(`mm:write:${me}`, 30)) return;
      await leaveQueue(me);
      send(ws, { type: 'mm:left' });
      break;
    }

    case 'mm:accept': {
      const matchId = String(payload?.matchId ?? '');
      if (!matchId) return;
      if (!rateLimit(`mm:write:${me}`, 30)) return;
      const r = await acceptMatch(me, matchId);
      if (r.error) { send(ws, { type: 'mm:error', payload: r }); break; }
      if (r.confirmed) {
        // Войс-пати команды открываем сами, а не ждём, пока кто-то
        // зайдёт во вкладку «Войс-пати» и создаст комнату руками: игроки
        // должны договариваться до и во время игры, а не после того как
        // кто-то вспомнит, что можно созвониться. Отдельная комната на
        // каждую команду — соперник не должен слышать чужую связь.
        // «Владелец» комнаты — чисто техническое требование схемы
        // (voice_rooms.owner_id NOT NULL): первый в списке команды, не
        // более того — комната всё равно закроется сама, как только все
        // разойдутся (endIfEmpty).
        const title = GAME_TITLE[r.match.gameId] ?? r.match.gameId;
        const teams = teamSizeFor(r.match.gameId) > 1
          ? [r.match.teamA, r.match.teamB]
          : [];
        const roomIdByUser = new Map();
        for (const team of teams) {
          if (team.length < 2) continue;
          const created = await vpCreateRoom(team[0], {
            title: `${title} — команда`,
            description: 'Автоматическая комната для матча Sky Games',
            category: 'gaming',
            isPrivate: true,
            maxParticipants: team.length,
          });
          if (created.room) for (const uid of team) roomIdByUser.set(uid, created.room.id);
        }
        // Обеим сторонам сразу: кто принял вторым, узнаёт об этом же
        // событием, а не только по своему ответу.
        for (const uid of [...r.match.teamA, ...r.match.teamB]) {
          sendTo(uid, { type: 'mm:confirmed', payload: { match: r.match, voiceRoomId: roomIdByUser.get(uid) ?? null } });
        }
      } else {
        send(ws, { type: 'mm:waiting', payload: { match: r.match } });
      }
      break;
    }

    /* ── Самоотчёт о результате: заявляет любой участник, подтверждает
       или оспаривает — обязательно кто-то из другой команды (проверка
       внутри matchmaking.mjs). Рейтинг меняется только в confirm. ── */
    case 'mm:report': {
      const matchId = String(payload?.matchId ?? '');
      const winnerTeam = payload?.winnerTeam;
      if (!matchId) return;
      if (!rateLimit(`mm:write:${me}`, 30)) return;
      const r = await reportResult(me, matchId, winnerTeam);
      if (r.error) { send(ws, { type: 'mm:error', payload: r }); break; }
      for (const uid of [...r.match.teamA, ...r.match.teamB]) {
        sendTo(uid, { type: 'mm:reported', payload: { match: r.match } });
      }
      break;
    }

    case 'mm:confirm-result': {
      const matchId = String(payload?.matchId ?? '');
      if (!matchId) return;
      if (!rateLimit(`mm:write:${me}`, 30)) return;
      const r = await confirmResult(me, matchId);
      if (r.error) { send(ws, { type: 'mm:error', payload: r }); break; }
      for (const uid of r.participants) {
        sendTo(uid, {
          type: 'mm:result-confirmed',
          payload: { matchId: r.matchId, gameId: r.gameId, winnerTeam: r.winnerTeam, change: r.changes[uid] },
        });
      }
      break;
    }

    case 'mm:dispute-result': {
      const matchId = String(payload?.matchId ?? '');
      if (!matchId) return;
      if (!rateLimit(`mm:write:${me}`, 30)) return;
      const r = await disputeResult(me, matchId);
      if (r.error) { send(ws, { type: 'mm:error', payload: r }); break; }
      for (const uid of r.participants) {
        sendTo(uid, { type: 'mm:result-disputed', payload: { matchId: r.matchId } });
      }
      break;
    }

    case 'mm:decline': {
      const matchId = String(payload?.matchId ?? '');
      if (!matchId) return;
      if (!rateLimit(`mm:write:${me}`, 30)) return;
      const r = await declineMatch(me, matchId);
      if (r.error) { send(ws, { type: 'mm:error', payload: r }); break; }
      send(ws, { type: 'mm:cancelled', payload: { matchId } });
      for (const uid of r.requeued) {
        sendTo(uid, { type: 'mm:cancelled-requeued', payload: { matchId, gameId: r.gameId } });
      }
      break;
    }

    /* ── Войс-пати ────────────────────────────────────────────────
       Кто в комнате — держит этот же хаб в памяти (server/voiceparty.mjs),
       а не localStorage браузера. roomId/targetId приходят от клиента,
       но действие всегда проверяется от имени me — так же, как в
       матчмейкинге выше. ── */

    case 'vp:join': {
      const roomId = String(payload?.roomId ?? '');
      if (!roomId) return;
      if (!rateLimit(`vp:write:${me}`, 30)) return;
      const r = await vpJoinRoom(me, roomId);
      if (r.error) { send(ws, { type: 'vp:error', payload: r }); break; }
      send(ws, { type: 'vp:joined', payload: { room: r.room, participants: r.participants, myRole: r.myRole } });
      const mine = r.participants.find((p) => p.id === me);
      broadcast(vpMemberIds(roomId), { type: 'vp:participant-joined', payload: { roomId, participant: mine } }, me);
      break;
    }

    case 'vp:leave': {
      const roomId = String(payload?.roomId ?? '');
      // Без проверки членства и лимита частоты vp:leave для чужой или
      // покинутой комнаты рассылал бы vp:participant-left всем её
      // участникам бесплатно для отправителя — тот же усилитель, что уже
      // учтён ниже в live:leave этого файла.
      if (!roomId || !vpIsMember(roomId, me)) return;
      if (!rateLimit(`vp:write:${me}`, 30)) return;
      const others = vpMemberIds(roomId).filter((id) => id !== me);
      await vpLeaveRoom(me, roomId);
      send(ws, { type: 'vp:left', payload: { roomId } });
      broadcast(others, { type: 'vp:participant-left', payload: { roomId, profileId: me } });
      break;
    }

    case 'vp:mute':
    case 'vp:hand': {
      const roomId = String(payload?.roomId ?? '');
      if (!roomId || !vpIsMember(roomId, me)) return;
      if (!rateLimit(`vp:write:${me}`, 60)) return;
      const ok = type === 'vp:mute'
        ? vpSetMuted(roomId, me, Boolean(payload?.muted))
        : vpSetHandRaised(roomId, me, Boolean(payload?.raised));
      if (!ok) return;
      broadcast(vpMemberIds(roomId), {
        type: 'vp:participant-updated',
        payload: { roomId, profileId: me, patch: type === 'vp:mute' ? { muted: Boolean(payload?.muted) } : { handRaised: Boolean(payload?.raised) } },
      });
      break;
    }

    case 'vp:role': {
      const roomId = String(payload?.roomId ?? '');
      const targetId = String(payload?.targetId ?? '');
      const role = String(payload?.role ?? '');
      if (!roomId || !targetId) return;
      if (!rateLimit(`vp:write:${me}`, 30)) return;
      const needsOwner = role === 'admin' || role === 'moderator';
      const allowed = needsOwner ? await vpIsOwner(roomId, me) : vpCanModerate(roomId, me);
      if (!allowed) { send(ws, { type: 'vp:error', payload: { error: 'not_allowed' } }); break; }
      if (!vpSetRole(roomId, targetId, role)) { send(ws, { type: 'vp:error', payload: { error: 'not_found' } }); break; }
      broadcast(vpMemberIds(roomId), { type: 'vp:participant-updated', payload: { roomId, profileId: targetId, patch: { role } } });
      break;
    }

    case 'vp:kick':
    case 'vp:ban': {
      const roomId = String(payload?.roomId ?? '');
      const targetId = String(payload?.targetId ?? '');
      if (!roomId || !targetId || targetId === me) return;
      if (!rateLimit(`vp:write:${me}`, 30)) return;
      const allowed = type === 'vp:ban' ? await vpIsOwner(roomId, me) : vpCanModerate(roomId, me);
      if (!allowed) { send(ws, { type: 'vp:error', payload: { error: 'not_allowed' } }); break; }
      const others = vpMemberIds(roomId).filter((id) => id !== targetId);
      const ok = type === 'vp:ban' ? await vpBan(roomId, targetId) : vpKick(roomId, targetId);
      if (!ok) { send(ws, { type: 'vp:error', payload: { error: 'not_found' } }); break; }
      sendTo(targetId, { type: 'vp:kicked', payload: { roomId, banned: type === 'vp:ban' } });
      broadcast(others, { type: 'vp:participant-left', payload: { roomId, profileId: targetId } });
      break;
    }

    case 'vp:permissions': {
      const roomId = String(payload?.roomId ?? '');
      if (!roomId || !(await vpIsOwner(roomId, me))) return;
      if (!rateLimit(`vp:write:${me}`, 30)) return;
      const next = await vpUpdatePermissions(roomId, payload?.patch ?? {});
      if (!next) return;
      broadcast(vpMemberIds(roomId), { type: 'vp:room-updated', payload: { roomId, permissions: next } });
      break;
    }

    case 'vp:chat': {
      const roomId = String(payload?.roomId ?? '');
      const text = String(payload?.text ?? '').trim().slice(0, 500);
      if (!roomId || !text || !vpIsMember(roomId, me)) return;
      if (!rateLimit(`vp:chat:${me}`, 60)) return;
      const message = { id: crypto.randomUUID(), authorId: me, text, createdAt: new Date().toISOString() };
      broadcast(vpMemberIds(roomId), { type: 'vp:chat', payload: { roomId, message } });
      break;
    }

    case 'vp:pin': {
      const roomId = String(payload?.roomId ?? '');
      const messageId = String(payload?.messageId ?? '');
      if (!roomId || !messageId || !vpCanModerate(roomId, me)) return;
      if (!rateLimit(`vp:write:${me}`, 30)) return;
      broadcast(vpMemberIds(roomId), { type: 'vp:pin', payload: { roomId, messageId, pinned: Boolean(payload?.pinned) } });
      break;
    }

    case 'vp:reaction': {
      const roomId = String(payload?.roomId ?? '');
      const emoji = String(payload?.emoji ?? '').slice(0, 8);
      if (!roomId || !emoji || !vpIsMember(roomId, me)) return;
      if (!rateLimit(`vp:react:${me}`, 60)) return;
      broadcast(vpMemberIds(roomId), {
        type: 'vp:reaction',
        payload: { roomId, reaction: { id: crypto.randomUUID(), emoji, memberId: me, createdAt: new Date().toISOString() } },
      });
      break;
    }

    /* ── Трансляции ───────────────────────────────────────────────
       Кто сейчас смотрит эфир — живое состояние в памяти хаба
       (server/streams.mjs), метаданные самого эфира — в базе. Сам
       видеопоток идёт через свой собственный протокол сигналинга
       (offer/answer/ice/viewer-request с явным `to`) — не пересекается
       с 1:1-звонками (case 'call-offer' и т.п.) и с войс-пати. ── */

    case 'live:join': {
      const streamId = String(payload?.streamId ?? '');
      if (!streamId) return;
      if (!rateLimit(`live:write:${me}`, 30)) return;
      const r = await liveJoin(me, streamId);
      if (r.error) { send(ws, { type: 'live:error', payload: r }); break; }
      send(ws, { type: 'live:joined', payload: { stream: r.stream } });
      const others = liveViewerIds(streamId).filter((id) => id !== me);
      broadcast(others, { type: 'live:viewer-joined', payload: { streamId, viewerId: me, viewerCount: r.stream.viewerCount } });
      // Автору эфира нужно узнать о новом зрителе, даже если сам автор
      // не входит в список зрителей (он вещает, а не смотрит).
      const stream = await liveGetStream(streamId);
      if (stream && stream.authorId !== me) sendTo(stream.authorId, { type: 'live:viewer-request', payload: { streamId, from: me } });
      break;
    }

    case 'live:leave': {
      const streamId = String(payload?.streamId ?? '');
      // Без проверки членства и лимита частоты повторный live:leave от
      // того, кто уже вышел (или никогда не заходил), рассылал бы
      // live:viewer-left всем зрителям эфира бесплатно для отправителя —
      // усилитель для флуда чужих соединений.
      if (!streamId || !liveIsViewer(streamId, me)) return;
      if (!rateLimit(`live:write:${me}`, 30)) return;
      const others = liveViewerIds(streamId).filter((id) => id !== me);
      liveLeave(me, streamId);
      broadcast(others, { type: 'live:viewer-left', payload: { streamId, viewerId: me } });
      break;
    }

    case 'live:chat': {
      const streamId = String(payload?.streamId ?? '');
      const text = String(payload?.text ?? '');
      if (!streamId || !liveIsViewer(streamId, me)) return;
      if (!rateLimit(`live:chat:${me}`, 60)) return;
      const r = await liveSendChat(streamId, me, text);
      if (r.error) return;
      broadcast(await liveAudience(streamId), { type: 'live:chat', payload: { streamId, message: r.msg } });
      break;
    }

    case 'live:react': {
      const streamId = String(payload?.streamId ?? '');
      const emoji = String(payload?.emoji ?? '');
      if (!streamId || !liveIsViewer(streamId, me)) return;
      if (!rateLimit(`live:react:${me}`, 60)) return;
      const r = liveReact(streamId, emoji);
      if (r.error) return;
      broadcast(await liveAudience(streamId), { type: 'live:react', payload: { streamId, emoji: r.emoji, count: r.count } });
      break;
    }

    case 'live:predict-create': {
      const streamId = String(payload?.streamId ?? '');
      if (!streamId) return;
      if (!rateLimit(`live:write:${me}`, 30)) return;
      const r = await liveCreatePrediction(me, streamId, payload?.question, payload?.options);
      if (r.error) { send(ws, { type: 'live:error', payload: r }); break; }
      broadcast(await liveAudience(streamId), { type: 'live:predict-create', payload: { streamId, prediction: r.prediction } });
      break;
    }

    case 'live:predict-vote': {
      const streamId = String(payload?.streamId ?? '');
      const predictionId = String(payload?.predictionId ?? '');
      const optIdx = Math.trunc(Number(payload?.optIdx));
      if (!streamId || !predictionId || !liveIsViewer(streamId, me)) return;
      if (!rateLimit(`live:predict:${me}`, 60)) return;
      const r = liveVote(streamId, predictionId, me, optIdx);
      if (r.error) { send(ws, { type: 'live:error', payload: r }); break; }
      broadcast(await liveAudience(streamId), { type: 'live:predict-update', payload: { streamId, prediction: r.prediction } });
      break;
    }

    case 'live:predict-close': {
      const streamId = String(payload?.streamId ?? '');
      const predictionId = String(payload?.predictionId ?? '');
      if (!streamId || !predictionId) return;
      if (!rateLimit(`live:write:${me}`, 30)) return;
      const r = await liveClosePrediction(me, streamId, predictionId);
      if (r.error) { send(ws, { type: 'live:error', payload: r }); break; }
      broadcast(await liveAudience(streamId), { type: 'live:predict-update', payload: { streamId, prediction: r.prediction } });
      break;
    }

    case 'live:kick':
    case 'live:ban': {
      const streamId = String(payload?.streamId ?? '');
      const targetId = String(payload?.targetId ?? '');
      if (!streamId || !targetId || targetId === me) return;
      if (!rateLimit(`live:write:${me}`, 30)) return;
      if (type === 'live:kick') {
        const stream = await liveGetStream(streamId);
        if (!stream || stream.authorId !== me) { send(ws, { type: 'live:error', payload: { error: 'not_allowed' } }); break; }
        liveLeave(targetId, streamId);
      } else {
        const r = await liveBan(me, streamId, targetId);
        if (r.error) { send(ws, { type: 'live:error', payload: r }); break; }
      }
      sendTo(targetId, { type: 'live:kicked', payload: { streamId, banned: type === 'live:ban' } });
      broadcast(liveViewerIds(streamId), { type: 'live:viewer-left', payload: { streamId, viewerId: targetId } });
      break;
    }

    /* Видео/аудио идёт напрямую зритель↔вещатель, сервер только
       передаёт сигналы дальше — тот же relay-приём, что и у 1:1-звонков,
       но со своим адресатом (`to`), а не парой из callId. */
    case 'live:offer':
    case 'live:answer':
    case 'live:ice': {
      const streamId = String(payload?.streamId ?? '');
      const to = String(payload?.to ?? '');
      if (!streamId || !to || to === me) return;
      // ice на один relay-канал легитимно частый, offer/answer — по
      // разу на подключение зрителя; тот же раздельный предел, что у
      // call-offer/ice-candidate выше.
      if (!rateLimit(type === 'live:ice' ? `live:ice:${me}` : `live:rtc:${me}`,
        type === 'live:ice' ? 300 : 60)) return;
      // Пересылаем только внутри пары автор↔зритель одного и того же
      // эфира — иначе по одному лишь streamId можно было бы прислать
      // WebRTC-сигнал произвольному человеку, который этот эфир даже
      // не смотрит (тот же принцип, что и у call-offer: shareAChat).
      const stream = await liveGetStream(streamId);
      if (!stream) return;
      const meOk = stream.authorId === me || liveIsViewer(streamId, me);
      const toOk = stream.authorId === to || liveIsViewer(streamId, to);
      if (!meOk || !toOk) return;
      sendTo(to, { type, payload: { ...payload, from: me } });
      break;
    }

    case 'live:viewer-request': {
      const streamId = String(payload?.streamId ?? '');
      if (!streamId) return;
      const stream = await liveGetStream(streamId);
      if (!stream || !liveIsViewer(streamId, me)) return;
      if (!rateLimit(`live:rtc:${me}`, 60)) return;
      sendTo(stream.authorId, { type: 'live:viewer-request', payload: { streamId, from: me } });
      break;
    }

    /* ── Приватность профиля ───────────────────────────────────────
       Настройка защищает человека от других, поэтому живёт на сервере,
       а не галочкой в браузере: свой клиент можно переписать. ── */

    case 'privacy': {
      if (!rateLimit(`privacy:${me}`, 30)) return;
      const patch = (payload && typeof payload === 'object') ? payload : {};
      const changesPresence = patch.whoSeesOnline !== undefined;
      const next = await setPrivacy(me, patch);

      // Присутствие меняется прямо сейчас: иначе кружок «в сети» висел
      // бы у собеседников до их следующего подключения. Считаем, кто
      // видит человека теперь, и остальным рядом говорим, что он ушёл.
      if (changesPresence) {
        const near = await nearbyOnline(me);
        const circle = new Set(await presenceBetween(me, near));
        for (const other of near) {
          sendTo(other, {
            type: circle.has(other) ? 'user-online' : 'user-offline',
            payload: { userId: me },
          });
        }
        // Свой список тоже пересобираем: спрятавшись, человек перестаёт
        // видеть чужое присутствие, и кружки должны погаснуть сразу, а
        // не до следующего подключения.
        send(ws, { type: 'online-reset', payload: { onlineUsers: [...circle] } });
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

      // Та же раздельная схема пределов, что у случая 'admin' выше:
      // читать настройки/список участников можно часто, менять
      // роль/банить/мьютить — реже. Без этого любое из действий ниже
      // (все пишут в базу, некоторые рассылают всему чату) можно было
      // дёргать без всякого предела.
      const READ_ACTIONS = new Set(['get-settings', 'members', 'invites', 'requests', 'log']);
      if (!rateLimit(READ_ACTIONS.has(action) ? `chatadm:r:${me}` : `chatadm:w:${me}`,
        READ_ACTIONS.has(action) ? 120 : 30)) return;

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
      if (!rateLimit(`chat:invite:${me}`, 30)) return;
      const result = await revokeInvite(payload?.code, me);
      if (result.error) return;
      const invites = await listInvites(result.chatId, me);
      send(ws, { type: 'chat-invites', payload: { chatId: result.chatId, invites: invites ?? [] } });
      break;
    }

    case 'join-invite': {
      // Код приглашения — 18 байт из crypto.randomBytes (createInvite в
      // chatadmin.mjs), подбором его не найти; лимит здесь — та же
      // защита от бесплатного перебора записи в базе, что и у остальных
      // пишущих действий этого файла.
      if (!rateLimit(`chat:invite:${me}`, 20)) return;
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
      if (!rateLimit(`msg:pin:${me}`, 60)) return;
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
      if (!rateLimit(`msg:viewed:${me}`, 120)) return;
      const counts = await markViewed(payload?.chatId, me, payload?.messageIds);
      if (!counts?.length) return;
      broadcast(await memberIds(payload.chatId),
        { type: 'message-views', payload: { chatId: payload.chatId, counts } });
      send(ws, { type: 'message-views', payload: { chatId: payload.chatId, counts } });
      break;
    }

    /* ── Звонки. Сигналинг идёт только между участниками общего чата,
          иначе по WebRTC можно было бы дозвониться до кого угодно. ── */
    /*
     * Совместный просмотр и совместное прослушивание.
     *
     * Отдельного соединения этому не нужно, и отдельной «комнаты» в
     * памяти хаба тоже: рассылка идёт по списку участников из базы, а
     * этот список — то же самое право, по которому сессия вообще
     * открыта. Поэтому вышедший перестаёт получать события ровно тогда,
     * когда его строка сменила состояние: он просто не попадает в
     * список.
     *
     * Ни одной проверки права здесь нет — и это не упущение. Их делает
     * applyCommand: у сессии два входа, обычный запрос и этот сокет, и
     * правило у них обязано быть одно. Здесь только форма сообщения и
     * частота.
     */
    case 'together': {
      const sessionId = String(payload?.sessionId ?? '');
      const action = String(payload?.action ?? '');
      if (!sessionId || !action) return;

      /* Свой счётчик поверх общего. Перемотка идёт частыми событиями, и
         отдельный предел на сессию не даёт одному человеку выбрать весь
         общий лимит собственным дёрганьем ползунка. */
      if (!allowTogether(me)) {
        send(ws, { type: 'together-error', payload: { sessionId, error: 'rate_limited' } });
        return;
      }

      const result = await applyCommand(sessionId, me, {
        action,
        positionMs: payload?.positionMs,
        rate: payload?.rate,
        index: payload?.index,
      });

      if (result.error) {
        /* Отказ видит только тот, кто попросил: остальным о чужой
           неудачной попытке знать незачем. */
        send(ws, { type: 'together-error', payload: { sessionId, error: result.error } });
        return;
      }

      /* Ответ на «расскажи, что сейчас» уходит только спросившему: это
         чтение, и рассылать его всем значило бы будить людей ради
         чужой сверки часов. */
      if (!result.event) {
        send(ws, { type: 'together-state', payload: { action: 'sync', state: result.shared } });
        return;
      }

      /* Состояние уходит целиком, а не «прибавьте три секунды».
         Отставший или пропустивший событие клиент выравнивается по
         следующему же сообщению, а не копит расхождение. */
      broadcast(result.recipients, {
        type: 'together-state',
        payload: { action: result.event, by: me, state: result.shared },
      });
      break;
    }

    /* Чат комнаты. Проверка прав — та же, что у applyCommand: один
       источник правды для обычного запроса и для сокета, только здесь
       входа по HTTP для отправки нет вовсе (history — да, отправка —
       только отсюда). */
    case 'together-chat': {
      const sessionId = String(payload?.sessionId ?? '');
      if (!sessionId) return;

      if (!allowTogetherChat(me)) {
        send(ws, { type: 'together-chat-error', payload: { sessionId, error: 'rate_limited' } });
        return;
      }

      const result = await sendRoomMessage(sessionId, me, payload?.text);
      if (result.error) {
        send(ws, { type: 'together-chat-error', payload: { sessionId, error: result.error } });
        return;
      }

      broadcast(result.recipients, {
        type: 'together-chat',
        payload: { sessionId, message: result.message },
      });
      break;
    }

    case 'call-offer':
    case 'call-answer':
    case 'ice-candidate':
    case 'call-reject':
    case 'call-end': {
      const to = payload?.to;
      if (!to || to === me) return;

      const callId = String(payload?.callId ?? '');
      if (!callId || callId.length > 128) return;

      // call-offer — звонок, который звонит у получателя: без предела
      // вызывающего можно было бы бесконечно «обзванивать» бесплатно для
      // него самого. ICE-кандидатов на один звонок легитимно много, им
      // отдельный, щедрый предел; answer/reject/end — по одному на звонок.
      if (!rateLimit(type === 'call-offer' ? `call:offer:${me}`
        : type === 'ice-candidate' ? `call:ice:${me}` : `call:ctrl:${me}`,
        type === 'call-offer' ? 20 : type === 'ice-candidate' ? 300 : 60)) return;

      // Войс-пати: звонить можно тем, кто прямо сейчас в той же комнате
      // (roomId зашит в сам callId) — это уже проверенное сервером
      // членство (server/voiceparty.mjs), не общий чат и не настройка
      // «кто может звонить»: заходя в публичную комнату, человек уже
      // согласился слышать её участников.
      const partyRoom = vpRoomIdFromCallId(callId);
      const isParty = partyRoom !== null;

      if (isParty ? !vpBothInRoom(partyRoom, me, to) : !(await shareAChat(me, to))) {
        // Звонить можно только тем, с кем есть общий чат (или общая
        // войс-комната): иначе по одному лишь идентификатору можно было
        // бы дозвониться до любого. Звонящему отвечаем, чтобы он не
        // слушал гудки.
        if (type === 'call-offer') send(ws, { type: 'call-unavailable', from: to, callId });
        return;
      }

      // «Запрет говорить» касается и звонков: без этого наказание
      // обходилось бы одним нажатием на трубку.
      if (type === 'call-offer') {
        const lim = await restrictionsOf(me);
        if (lim.bannedUntil || lim.mutedUntil) {
          send(ws, { type: 'call-unavailable', from: to, callId });
          return;
        }
      }

      // Настройка «кто может звонить» получателя — касается личных
      // звонков. В войс-пати её нет: человек уже сам зашёл в комнату.
      if (!isParty && type === 'call-offer' && !(await mayCall(to, me))) {
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
 * Откуда разрешено открывать сокет — та же проверка origin, что и у HTTP
 * CORS (см. originAllowed в http.mjs): рукопожатие WebSocket не
 * подчиняется правилам обмена между сайтами, и без неё страница
 * злоумышленника открывала бы соединение к нашему хабу из браузера жертвы.
 * Предъявить токен она не сможет — он лежит в памяти нашей вкладки, а не в
 * куке, — но открывать соединения пачками вполне.
 */

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
  return clientIp(req);
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

    /* Обезличенные приметы запроса. Нужны журналу безопасности: по ним
       видно «тот же источник или другой», а самого адреса в журнале нет
       — это данные о человеке, и хранить их ради удобства нельзя. */
    ws.adminMeta = requestMeta(req);

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

        // Забаненный не подключается вовсе. Проверяем у базы, а не по
        // токену: бан выдают тогда, когда ждать конца сессии нельзя.
        // Спрашиваем ДО учёта соединения и до проверки числа устройств:
        // всё, что стоит между проверкой и учётом, — окно для гонки.
        if (await isBannedNow(userId)) { ws.close(4403, 'banned'); return; }
        // Блокировка учётной записи закрывает все профили человека, а не
        // один: бан второго профиля не спасал — на него и переходили.
        if (await skyIdBlockOf(userId)) { ws.close(4403, 'account blocked'); return; }

        // Больше устройств, чем бывает у человека, — это скрипт.
        // Проверка и учёт идут подряд, без единого await между ними,
        // иначе десяток одновременных подключений успевает пройти
        // проверку раньше, чем хоть одно будет посчитано.
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
        markActive(userId);

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
      // Отключился совсем (ни одной вкладки) — из очереди матчмейкинга
      // тоже убираем: иначе после «Найти матч» и закрытия браузера
      // человек оставался бы в очереди до перезапуска сервера, и его
      // мог бы «найти» кто-то ещё, кому отвечать уже некому.
      leaveQueue(uid).catch(() => {});
      // Полный оффлайн — выходим из всех войс-комнат сразу: иначе
      // закрывший браузер человек оставался бы в списке участников
      // навсегда, и комната с одним «призраком» никогда бы не считалась
      // пустой.
      vpLeaveAllRooms(uid).then((rooms) => {
        for (const roomId of rooms) broadcast(vpMemberIds(roomId), { type: 'vp:participant-left', payload: { roomId, profileId: uid } });
      }).catch(() => {});
      // Трансляции: полный оффлайн зрителя — убрать его из всех эфиров,
      // которые он смотрел; полный оффлайн автора — сам эфир без
      // источника видео продолжаться не может, завершить его тоже.
      for (const streamId of liveLeaveAllStreams(uid)) {
        broadcast(liveViewerIds(streamId), { type: 'live:viewer-left', payload: { streamId, viewerId: uid } });
      }
      liveEndByDisconnect(uid).then((ended) => {
        for (const e of ended) broadcast(e.viewerIds, { type: 'live:ended', payload: { streamId: e.id } });
      }).catch(() => {});
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

  // Просроченные гасим здесь, а не отдельным заданием: хаб знает, кому
  // сказать, что сообщение исчезло, — иначе оно пропадало бы только
  // после перезагрузки страницы.
  const sweeper = setInterval(() => {
    sweepExpired().then((burned) => {
      for (const b of burned) {
        memberIds(b.chatId).then((ids) => broadcast(ids, {
          type: 'message-burned', payload: { chatId: b.chatId, messageId: b.messageId },
        })).catch(() => { /* чат исчез — рассказывать некому */ });
      }
    }).catch((err) => console.error('[ws] уборка просроченных', err.message));
  }, 5000);
  sweeper.unref();

  // Матчи, которые повисли без ответа обеих сторон дольше таймаута —
  // та самая защита от «застрявших игроков»: принявшего возвращаем в
  // очередь и говорим ему об этом, неответившего просто выпускаем.
  const mmSweeper = setInterval(() => {
    sweepStaleMatches().then((expired) => {
      for (const e of expired) {
        for (const uid of e.requeued) {
          sendTo(uid, { type: 'mm:cancelled-requeued', payload: { matchId: e.matchId, gameId: e.gameId } });
        }
        for (const uid of e.timedOut) {
          sendTo(uid, { type: 'mm:cancelled', payload: { matchId: e.matchId } });
        }
      }
    }).catch((err) => console.error('[ws] уборка матчмейкинга', err.message));
  }, 5000);
  mmSweeper.unref();

  console.log(`[ws] Hub on :${PORT}`);

  return {
    close: () => new Promise((resolve) => {
      clearInterval(sweeper);
      clearInterval(mmSweeper);
      for (const set of clients.values()) {
        for (const ws of set) ws.close(1001, 'server shutting down');
      }
      clients.clear();
      wss.close(() => resolve());
      wss = null;
    }),
  };
};

/**
 * Рассылка сообщения участникам чата из HTTP-слоя.
 *
 * Нужна ботам: их ответы приходят не по сокету, а обычным запросом от
 * сервера владельца, и без этого собеседник увидел бы ответ только
 * после перезагрузки страницы. Список соединений живёт в этом модуле,
 * поэтому и функция здесь, а не в маршрутах.
 *
 * Ничего не решает про права: кому можно видеть сообщение, уже решил
 * слой данных, а сюда приходит готовый список участников.
 */
/**
 * Событие «Вместе» из HTTP-слоя.
 *
 * Вход, выход, приглашение и завершение приходят обычным запросом, а
 * рассказать о них надо тем, кто сейчас на связи. Кому именно — решил
 * слой данных: сюда приходит готовый список участников, и права здесь
 * не проверяются, потому что уже проверены.
 */
/**
 * На связи ли человек прямо сейчас.
 *
 * Нужно уборке «Вместе»: показ личной записи держится на том, кто её
 * показывает, и если владелец ушёл совсем — показ пора закрывать. Хаб
 * единственный, кто про это знает: список соединений живёт здесь.
 */
export const isOnline = (userId) => (clients.get(userId)?.size ?? 0) > 0;

export const pushTogether = (userIds, msg) => {
  broadcast(Array.isArray(userIds) ? userIds : [], msg);
};

/**
 * Sky Market: уведомление о сделке и сообщение чата сделки.
 *
 * Отдельный путь и отдельные типы событий. Сообщения чата сделки не
 * идут через pushNewMessage намеренно: обработчик мессенджера положил
 * бы их в список диалогов, а чат сделки — не диалог.
 */
export const pushMarket = (userIds, msg) => {
  broadcast(Array.isArray(userIds) ? userIds : [], msg);
};

export const pushNewMessage = (userIds, chatId, message) => {
  broadcast(userIds, { type: 'new-message', payload: { chatId, message } });
};

/**
 * Sky Gifts: уведомление о подарке/Prime/передаче NFT, когда событие
 * не приходит собственным сообщением в чат (обычный подарок «в чат»
 * и подарок Prime и так поднимают уведомление через новое сообщение —
 * см. server/giftnotify.mjs).
 */
export const pushGiftNotification = (userIds, note) => {
  broadcast(Array.isArray(userIds) ? userIds : [], { type: 'gift-notification', payload: note });
};

/** Тем же путём уходит новоиспечённый чат с ботом. */
export const pushChatCreated = async (userIds, chatId) => {
  await sendChatToEach(chatId, userIds);
};

/** Sky Family: приглашение, решение, изменение владения, Prime. */
export const pushFamily = (userIds, msg) => {
  broadcast(Array.isArray(userIds) ? userIds : [], msg);
};

/** Sky Garant: создание сделки, депозит, подтверждение, спор, решение. */
export const pushGarant = (userIds, msg) => {
  broadcast(Array.isArray(userIds) ? userIds : [], msg);
};

/** Нарушения и штрафы Market/Warehouse/PVZ: фиксация, решение, апелляция. */
export const pushViolation = (userIds, msg) => {
  broadcast(Array.isArray(userIds) ? userIds : [], msg);
};

/** Игровые серверы: новое сообщение канала, правки устройства сервера. */
export const pushGameServer = (userIds, msg) => {
  broadcast(Array.isArray(userIds) ? userIds : [], msg);
};

/** Sky Трансляции: донат — списание/зачисление идёт HTTP-ручкой (нужен
 *  чёткий ответ и idempotency-key), а увидеть его в чате остальные
 *  зрители должны сразу же, поэтому уведомление уходит в тот же WS-хаб,
 *  что и живые live:* события. */
export const pushLive = (userIds, msg) => {
  broadcast(Array.isArray(userIds) ? userIds : [], msg);
};
