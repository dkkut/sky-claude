/**
 * SKY Real-time через BroadcastChannel (между вкладками одного браузера).
 * Архитектура: socket НИКОГДА не импортирует из store  -  только setState.
 * Store НИКОГДА не импортирует из socket.
 * Только UI-компоненты импортируют broadcast и вызывают его после мутаций.
 */
import { useMessengerStore, saveToGlobal } from './store';
import { useAuthStore } from '@/core/auth/store';
import type { MessageItem, ChatItem } from './types';

const CHANNEL = 'sky:realtime:v2';
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;

if (bc) {
  bc.onmessage = (e) => {
    const { type, payload, from, to } = e.data ?? {};
    const myId = useAuthStore.getState().currentUserId;
    if (!type || from === myId) return; // своё сообщение  -  всегда игнорируем

    switch (type) {

      // -- Входящее сообщение ---------------------------------------------
      case 'msg': {
        const msg: MessageItem = payload;
        const store = useMessengerStore.getState();

        // Убеждаемся что чат существует у получателя
        if (!store.chats.find(c => c.id === msg.chatId)) {
          // Для DM  -  создаём чат автоматически если отправитель известен
          const sender = useAuthStore.getState().accounts.find(a => a.id === msg.authorId);
          if (sender && msg.chatId.startsWith('dm-')) {
            const newChat: ChatItem = {
              id: msg.chatId,
              name: sender.name,
              username: sender.username,
              avatar: sender.name.slice(0, 2).toUpperCase(),
              online: true,
              type: 'direct',
              participants: [myId ?? '', msg.authorId],
              folder: 'social',
            };
            useMessengerStore.setState(s => ({ chats: [newChat, ...s.chats] }));
          }
        }
        useMessengerStore.getState().injectMessage(msg);
        break;
      }

      // -- Typing ---------------------------------------------------------
      case 'typing': {
        useMessengerStore.getState().setTyping(payload.chatId, payload.username, payload.active);
        break;
      }

      // -- Новый чат создан -----------------------------------------------
      case 'chat-new': {
        const chat: ChatItem = payload;
        // Добавляем только если мы участники
        const myId2 = useAuthStore.getState().currentUserId;
        const isParticipant = !chat.participants || chat.participants.includes(myId2 ?? '');
        if (isParticipant) {
          useMessengerStore.setState(s => {
            if (s.chats.find(c => c.id === chat.id)) return {};
            return { chats: [chat, ...s.chats] };
          });
        }
        break;
      }

      // -- Реакция на сообщение -------------------------------------------
      case 'react': {
        const { msgId, emoji, userId } = payload;
        useMessengerStore.setState(s => ({
          messages: s.messages.map(msg => {
            if (msg.id !== msgId) return msg;
            const ex = msg.reactions.find(r => r.emoji === emoji);
            if (!ex) return { ...msg, reactions: [...msg.reactions, { emoji, userIds: [userId] }] };
            const ids = ex.userIds.includes(userId)
              ? ex.userIds.filter(u => u !== userId)
              : [...ex.userIds, userId];
            return { ...msg, reactions: ids.length === 0
              ? msg.reactions.filter(r => r.emoji !== emoji)
              : msg.reactions.map(r => r.emoji === emoji ? { ...r, userIds: ids } : r) };
          }),
        }));
        break;
      }

      // -- Редактирование сообщения ----------------------------------------
      case 'edit': {
        useMessengerStore.setState(s => ({
          messages: s.messages.map(m => m.id === payload.id
            ? { ...m, text: payload.text, editedAt: payload.editedAt }
            : m
          ),
        }));
        break;
      }

      // -- Удаление сообщения ----------------------------------------------
      case 'delete': {
        useMessengerStore.setState(s => ({
          messages: s.messages.map(m => m.id === payload.id
            ? { ...m, deleted: true, text: 'Сообщение удалено', mediaUrl: undefined }
            : m
          ),
        }));
        break;
      }

      // Звонки теперь обрабатываются через bsignal в calls/store.ts (WebRTC signaling)
      // Этот канал используется только для чатов и типинга
    }
  };
}

const myId = () => useAuthStore.getState().currentUserId ?? '';

// -- Публичное API для UI-компонентов --------------------------------------
export const broadcast = {

  /** Вызывается из ChatWindow после sendMessage() */
  message(msg: MessageItem) {
    bc?.postMessage({ type: 'msg', payload: msg, from: myId() });
    saveToGlobal(msg); // для случая когда другая вкладка не открыта
  },

  /** Вызывается из ChatWindow при вводе текста */
  typing(chatId: string, username: string, active: boolean) {
    bc?.postMessage({ type: 'typing', payload: { chatId, username, active }, from: myId() });
  },

  /** Вызывается из ChatList/store при создании нового чата */
  newChat(chat: ChatItem) {
    bc?.postMessage({ type: 'chat-new', payload: chat, from: myId() });
  },

  /** Реакция на сообщение */
  react(msgId: string, emoji: string, userId: string) {
    bc?.postMessage({ type: 'react', payload: { msgId, emoji, userId }, from: myId() });
  },

  /** Редактирование сообщения */
  edit(id: string, text: string, editedAt: string) {
    bc?.postMessage({ type: 'edit', payload: { id, text, editedAt }, from: myId() });
  },

  /** Удаление сообщения */
  delete(id: string) {
    bc?.postMessage({ type: 'delete', payload: { id }, from: myId() });
  },

  // startCall / endCall удалены  -  теперь через bsignal (WebRTC)
};

// Stubs  -  main.tsx и другие могут импортировать эти
export const connectSocket    = (_uid: string) => {};
export const disconnectSocket = () => {};
export const wsApi = broadcast;
export const subscribeOnline  = (_fn: any) => () => {};
export const getOnlineUsers   = () => new Set<string>();
