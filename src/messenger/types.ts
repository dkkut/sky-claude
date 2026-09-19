export type ChatType    = 'direct' | 'group' | 'channel';
export type MessageKind = 'text' | 'photo' | 'voice' | 'video-note' | 'file' | 'system' | 'pet' | 'gift' | 'prime_gift' | 'poll' | 'location';
export type ChatFolder  = 'all' | 'work' | 'social' | 'news' | 'support';

export interface ChatItem {
  id: string;
  name: string;
  username: string;
  avatar: string;
  online: boolean;
  pinned?: boolean;
  archived?: boolean;
  muted?: boolean;
  type: ChatType;
  members?: number;
  participants?: string[];
  folder?: Exclude<ChatFolder, 'all'>;
  description?: string;
  ownerId?: string;
  /** Помечен непрочитанным вручную — приходит с сервера. */
  markedUnread?: boolean;
  /** Роль спрашивающего в этом чате — приходит с сервера. */
  myRole?: 'owner' | 'admin' | 'moderator' | 'helper' | 'member';
}

export interface MessageReaction { emoji: string; userIds: string[]; }

export interface MessageItem {
  id: string;
  clientId: string;
  chatId: string;
  fromMe: boolean;
  authorId: string;
  kind: MessageKind;
  text: string;
  mediaUrl?: string;
  fileName?: string;
  bytes?: number;
  mimeType?: string;
  replyToId?: string;
  editedAt?: string;
  deleted?: boolean;
  pinned?: boolean;
  reactions: MessageReaction[];
  time: string;
  timestamp: number;
  status: 'queued' | 'sent' | 'delivered' | 'read';
  // Новые поля
  once?:          boolean;            // однократный просмотр
  selfDestruct?:  number;             // секунды до удаления (0 = отключено)
  destroyAt?:     number;             // timestamp когда удалить
  isSilent?:      boolean;            // тихое сообщение
  spoiler?:       boolean;            // текст под спойлером
  scheduledAt?:   number;             // timestamp запланированной отправки
  isScheduled?:   boolean;
  favorited?:     boolean;            // сохранено в «Избранное»
  viewedBy?:      string[];           // userId — реальные просмотры (для каналов)
  views?:         number;             // уникальные читатели записи канала (считает сервер)
  pinnedBy?:      string;             // кто закрепил
  fileId?:        string;             // вложение на сервере
  // Sky Gifts: сообщение несёт только id доставки — реальные данные
  // (цена, картинка, состояние) карточка получает отдельным запросом,
  // который сервер отдаёт только участнику этой доставки.
  giftInstanceId?:      string;
  primeGiftInstanceId?: string;
  // Опрос
  poll?: {
    question:  string;
    options:   { id: string; text: string; votes: string[] }[];
    multiple:  boolean;
    anonymous: boolean;
    closed:    boolean;
  };
}

export interface Report {
  id: string;
  chatId: string;
  messageId?: string;
  reporterId: string;
  reportedId?: string;
  reason: string;
  comment?: string;
  createdAt: string;
  status: 'pending' | 'reviewed' | 'dismissed';
  // Feedback types (from settings)
  feedbackType?: 'report' | 'suggestion' | 'bug';
  feedbackTitle?: string;
  priority?: 'low' | 'normal' | 'high';
}
