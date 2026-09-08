/**
 * Управление группой и каналом — то, что решает сервер.
 *
 * Здесь только зеркало серверного состояния и отправка команд. Ни одно
 * право не проверяется в браузере: роль показывается, чтобы нарисовать
 * нужные кнопки, но нажатие всё равно проходит проверку на сервере.
 * До этого роли, права и настройки жили в localStorage — то есть их
 * можно было выставить себе самому.
 */
import { create } from 'zustand';
import { wireSend } from '@/core/wire';

export type ChatRole = 'owner' | 'admin' | 'moderator' | 'helper' | 'member';

export const ROLE_LABEL: Record<ChatRole, string> = {
  owner: 'Владелец', admin: 'Администратор', moderator: 'Модератор',
  helper: 'Помощник', member: 'Участник',
};
export const ROLE_COLOR: Record<ChatRole, string> = {
  owner: '#f5b942', admin: '#e0555f', moderator: '#5b9bd1',
  helper: '#8b7fd6', member: 'var(--t3)',
};
/** Кого можно назначить: владельца передают отдельно, здесь его нет. */
export const ASSIGNABLE: ChatRole[] = ['admin', 'moderator', 'helper', 'member'];

/**
 * Что позволено роли. Таблица повторяет серверную и нужна только для
 * того, чтобы не рисовать кнопки, которые всё равно не сработают.
 */
const PERMISSIONS: Record<ChatRole, Record<string, boolean>> = {
  owner:     { changeInfo: true,  pin: true,  deleteOthers: true,  restrict: true,  ban: true,  invite: true,  manageRoles: true,  approveJoins: true },
  admin:     { changeInfo: true,  pin: true,  deleteOthers: true,  restrict: true,  ban: true,  invite: true,  manageRoles: true,  approveJoins: true },
  moderator: { changeInfo: false, pin: true,  deleteOthers: true,  restrict: true,  ban: true,  invite: true,  manageRoles: false, approveJoins: true },
  helper:    { changeInfo: false, pin: true,  deleteOthers: false, restrict: false, ban: false, invite: true,  manageRoles: false, approveJoins: false },
  member:    { changeInfo: false, pin: false, deleteOthers: false, restrict: false, ban: false, invite: false, manageRoles: false, approveJoins: false },
};

export const canDo = (role: ChatRole | undefined, what: string): boolean =>
  Boolean(PERMISSIONS[role ?? 'member']?.[what]);

export interface ChatSettings {
  whoCanPost: 'all' | 'admins';
  welcomeEnabled: boolean;
  welcomeMessage: string;
  requireApproval: boolean;
  joinQuestion: string;
  antiFlood: boolean;
  antiFloodPerMin: number;
  antiSpamLinks: boolean;
  slowModeSec: number;
}

export interface ChatMember {
  id: string; role: ChatRole; name: string; username: string; mutedUntil?: string;
}
export interface ChatInvite {
  code: string; createdBy: string; maxUses?: number; uses: number;
  revoked: boolean; expiresAt?: string; createdAt: string;
}
export interface JoinRequest { userId: string; answer: string; createdAt: string }
export interface LogEntry {
  id: string; actorId: string; targetId?: string; type: string;
  detail: string; createdAt: string;
}

/** Понятные объяснения того, почему сервер отказал. */
export const ADMIN_ERRORS: Record<string, string> = {
  not_allowed:      'Недостаточно прав',
  not_found:        'Не найдено',
  too_many_invites: 'Слишком много активных ссылок',
  invalid_invite:   'Ссылка недействительна',
  banned:           'Вход в этот чат закрыт',
  chat_full:        'В чате уже максимум участников',
};

/** Почему сообщение не ушло. */
export const POST_ERRORS: Record<string, string> = {
  channel_readonly:  'В канале пишут только его администраторы',
  admins_only:       'Сейчас в группе пишут только администраторы',
  muted:             'Вам временно запрещено писать в этом чате',
  links_not_allowed: 'В этой группе участникам нельзя отправлять ссылки',
  slow_mode:         'Включён медленный режим — подождите немного',
  flood:             'Слишком много сообщений подряд',
  not_member:        'Вы больше не участник этого чата',
  not_accepting:     'Собеседник ограничил, кто может ему писать',
};

interface S {
  settings: Record<string, ChatSettings>;
  members:  Record<string, { members?: ChatMember[]; hidden?: boolean; count?: number }>;
  invites:  Record<string, ChatInvite[]>;
  requests: Record<string, JoinRequest[]>;
  log:      Record<string, LogEntry[]>;
  /** Последний отказ сервера — показывается и гаснет. */
  notice:   string | null;
  /**
   * Просьба открыть управление чатом. Ставится из списка чатов, а
   * панель живёт в окне чата — иначе пришлось бы держать две её копии.
   */
  manageFor: string | null;

  /* ── Команды ── */
  loadSettings: (chatId: string) => void;
  loadMembers:  (chatId: string) => void;
  loadInvites:  (chatId: string) => void;
  loadRequests: (chatId: string) => void;
  loadLog:      (chatId: string) => void;

  saveSettings: (chatId: string, patch: Partial<ChatSettings>) => void;
  setRole:      (chatId: string, userId: string, role: ChatRole) => void;
  kick:         (chatId: string, userId: string) => void;
  ban:          (chatId: string, userId: string) => void;
  mute:         (chatId: string, userId: string, minutes: number) => void;
  createInvite: (chatId: string, opts?: { maxUses?: number; expiresInHours?: number }) => void;
  revokeInvite: (code: string) => void;
  decideJoin:   (chatId: string, userId: string, approve: boolean) => void;
  joinByInvite: (code: string, answer?: string) => void;
  pinMessage:   (chatId: string, messageId: string, pinned: boolean) => void;
  markViewed:   (chatId: string, messageIds: string[]) => void;

  /* ── Приходит с сервера ── */
  applySettings: (chatId: string, settings: ChatSettings) => void;
  applyMembers:  (chatId: string, data: { members?: ChatMember[]; hidden?: boolean; count?: number }) => void;
  applyInvites:  (chatId: string, invites: ChatInvite[]) => void;
  applyRequests: (chatId: string, requests: JoinRequest[]) => void;
  applyLog:      (chatId: string, entries: LogEntry[]) => void;
  notify:        (text: string | null) => void;
  openManage:    (chatId: string | null) => void;
}

const cmd = (chatId: string, action: string, extra: Record<string, unknown> = {}) =>
  wireSend({ type: 'chat-admin', payload: { chatId, action, ...extra } });

export const useAdminStore = create<S>((set) => ({
  settings: {}, members: {}, invites: {}, requests: {}, log: {}, notice: null,
  manageFor: null,

  loadSettings: (chatId) => cmd(chatId, 'get-settings'),
  loadMembers:  (chatId) => cmd(chatId, 'members'),
  loadInvites:  (chatId) => cmd(chatId, 'invites'),
  loadRequests: (chatId) => cmd(chatId, 'requests'),
  loadLog:      (chatId) => cmd(chatId, 'log'),

  saveSettings: (chatId, patch) => cmd(chatId, 'set-settings', { settings: patch }),
  setRole:      (chatId, userId, role) => cmd(chatId, 'set-role', { userId, role }),
  kick:         (chatId, userId) => cmd(chatId, 'kick', { userId }),
  ban:          (chatId, userId) => cmd(chatId, 'ban', { userId }),
  mute:         (chatId, userId, minutes) => cmd(chatId, 'mute', { userId, minutes }),
  createInvite: (chatId, opts = {}) => cmd(chatId, 'create-invite', opts),
  revokeInvite: (code) => wireSend({ type: 'revoke-invite', payload: { code } }),
  decideJoin:   (chatId, userId, approve) =>
    cmd(chatId, approve ? 'approve-join' : 'reject-join', { userId }),
  joinByInvite: (code, answer) => wireSend({ type: 'join-invite', payload: { code, answer } }),
  pinMessage:   (chatId, messageId, pinned) =>
    wireSend({ type: 'pin-message', payload: { chatId, messageId, pinned } }),
  markViewed:   (chatId, messageIds) =>
    wireSend({ type: 'viewed', payload: { chatId, messageIds } }),

  applySettings: (chatId, settings) => set(s => ({ settings: { ...s.settings, [chatId]: settings } })),
  applyMembers:  (chatId, data)     => set(s => ({ members:  { ...s.members,  [chatId]: data } })),
  applyInvites:  (chatId, invites)  => set(s => ({ invites:  { ...s.invites,  [chatId]: invites } })),
  applyRequests: (chatId, requests) => set(s => ({ requests: { ...s.requests, [chatId]: requests } })),
  applyLog:      (chatId, entries)  => set(s => ({ log:      { ...s.log,      [chatId]: entries } })),
  notify:        (text)             => set({ notice: text }),
  openManage:    (chatId)           => set({ manageFor: chatId }),
}));
