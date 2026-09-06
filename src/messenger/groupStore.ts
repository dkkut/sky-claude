/* ===============================================================
   SKY MESSENGER — Группы: роли, права, антиспам/антифлуд, журнал
   действий, ссылки-приглашения, заявки на вступление.
=============================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';

export type GroupRole = 'owner' | 'admin' | 'moderator' | 'helper' | 'member';

export interface GroupPermissions {
  canChangeInfo:   boolean; // название/описание/аватар
  canPinMessages:  boolean;
  canDeleteOthers: boolean; // удалять чужие сообщения
  canRestrict:     boolean; // мут/ограничение участника
  canBan:          boolean; // кик/бан
  canInvite:       boolean; // создавать ссылки-приглашения
  canManageRoles:  boolean; // назначать роли (кроме владельца)
  canApproveJoins: boolean; // подтверждать заявки на вступление
}

export const ROLE_LABEL: Record<GroupRole, string> = {
  owner: 'Владелец', admin: 'Администратор', moderator: 'Модератор', helper: 'Помощник', member: 'Участник',
};
export const ROLE_COLOR: Record<GroupRole, string> = {
  owner: '#f5b942', admin: '#e0555f', moderator: '#5b9bd1', helper: '#8b7fd6', member: 'var(--t3)',
};
export const ROLE_ORDER: GroupRole[] = ['owner', 'admin', 'moderator', 'helper', 'member'];

export const DEFAULT_PERMISSIONS: Record<GroupRole, GroupPermissions> = {
  owner:     { canChangeInfo: true,  canPinMessages: true,  canDeleteOthers: true,  canRestrict: true,  canBan: true,  canInvite: true,  canManageRoles: true,  canApproveJoins: true  },
  admin:     { canChangeInfo: true,  canPinMessages: true,  canDeleteOthers: true,  canRestrict: true,  canBan: true,  canInvite: true,  canManageRoles: true,  canApproveJoins: true  },
  moderator: { canChangeInfo: false, canPinMessages: true,  canDeleteOthers: true,  canRestrict: true,  canBan: true,  canInvite: true,  canManageRoles: false, canApproveJoins: true  },
  helper:    { canChangeInfo: false, canPinMessages: true,  canDeleteOthers: false, canRestrict: false, canBan: false, canInvite: true,  canManageRoles: false, canApproveJoins: false },
  member:    { canChangeInfo: false, canPinMessages: false, canDeleteOthers: false, canRestrict: false, canBan: false, canInvite: false, canManageRoles: false, canApproveJoins: false },
};

export type LogActionType =
  | 'role_change' | 'kick' | 'ban' | 'unban' | 'mute' | 'unmute'
  | 'settings_change' | 'invite_created' | 'invite_revoked'
  | 'member_joined' | 'member_left' | 'join_approved' | 'join_rejected'
  | 'welcome_toggle';

export interface GroupLogEntry {
  id: string; groupId: string; actorId: string; type: LogActionType;
  text: string; targetUserId?: string; createdAt: string;
}

export interface GroupInvite {
  id: string; groupId: string; code: string; createdBy: string; createdAt: string;
  expiresAt?: string; maxUses?: number; uses: number; revoked?: boolean;
}

export interface GroupJoinRequest {
  id: string; groupId: string; userId: string; answer?: string;
  createdAt: string; status: 'pending' | 'approved' | 'rejected';
}

export interface GroupSettings {
  welcomeEnabled: boolean;
  welcomeMessage: string;
  requireApproval: boolean;   // заявки на вступление вместо мгновенного входа
  joinQuestion: string;       // вопрос перед вступлением
  captchaOnJoin: boolean;     // простая капча при вступлении
  antiFlood: boolean;
  antiFloodMaxPerMinute: number;
  antiSpamLinks: boolean;     // блокировать ссылки от участников без роли
  antiBot: boolean;           // блокировать явных ботов при вступлении (эвристика ника)
}

const DEFAULT_SETTINGS: GroupSettings = {
  welcomeEnabled: false, welcomeMessage: 'Добро пожаловать в группу! 👋',
  requireApproval: false, joinQuestion: '',
  captchaOnJoin: false,
  antiFlood: true, antiFloodMaxPerMinute: 20,
  antiSpamLinks: false, antiBot: false,
};

const SK = 'sky:messenger:groups:v1';
const W = typeof window !== 'undefined';
const load = () => { if (!W) return null; try { return JSON.parse(localStorage.getItem(SK) || 'null'); } catch { return null; } };
const persist = (d: object) => { if (!W) return; try { localStorage.setItem(SK, JSON.stringify(d)); } catch {} };
const genId = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`;
const me = () => useAuthStore.getState().currentUserId ?? '';

interface GroupState {
  roles:    Record<string, Record<string, GroupRole>>;       // groupId -> userId -> role
  settings: Record<string, GroupSettings>;                    // groupId -> settings
  logs:     GroupLogEntry[];
  invites:  GroupInvite[];
  requests: GroupJoinRequest[];
  msgTimestamps: Record<string, number[]>;                    // "groupId:userId" -> отправленные за последнюю минуту (антифлуд)

  getRole:        (groupId: string, userId: string, ownerId?: string) => GroupRole;
  getPermissions: (groupId: string, userId: string, ownerId?: string) => GroupPermissions;
  setRole:        (groupId: string, userId: string, role: GroupRole) => void;
  getSettings:    (groupId: string) => GroupSettings;
  updateSettings: (groupId: string, patch: Partial<GroupSettings>) => void;

  log:      (groupId: string, type: LogActionType, text: string, targetUserId?: string) => void;
  logsFor:  (groupId: string) => GroupLogEntry[];

  createInvite: (groupId: string, opts?: { maxUses?: number; expiresInHours?: number }) => GroupInvite;
  revokeInvite: (id: string) => void;
  invitesFor:   (groupId: string) => GroupInvite[];
  useInvite:    (code: string) => GroupInvite | null;

  createJoinRequest: (groupId: string, userId: string, answer?: string) => void;
  approveJoinRequest: (id: string) => void;
  rejectJoinRequest:  (id: string) => void;
  requestsFor: (groupId: string) => GroupJoinRequest[];

  /** true = сообщение разрешено; false = заблокировано антифлудом */
  checkFlood: (groupId: string, userId: string) => boolean;
}

const stored = load();

export const useGroupStore = create<GroupState>((set, get) => {
  const flush = () => {
    const s = get();
    persist({ roles: s.roles, settings: s.settings, logs: s.logs, invites: s.invites, requests: s.requests });
  };

  return {
    roles:    stored?.roles    ?? {},
    settings: stored?.settings ?? {},
    logs:     stored?.logs     ?? [],
    invites:  stored?.invites  ?? [],
    requests: stored?.requests ?? [],
    msgTimestamps: {},

    getRole: (groupId, userId, ownerId) => {
      if (ownerId && userId === ownerId) return 'owner';
      return get().roles[groupId]?.[userId] ?? 'member';
    },
    getPermissions: (groupId, userId, ownerId) => DEFAULT_PERMISSIONS[get().getRole(groupId, userId, ownerId)],

    setRole: (groupId, userId, role) => {
      set(s => ({ roles: { ...s.roles, [groupId]: { ...s.roles[groupId], [userId]: role } } }));
      get().log(groupId, 'role_change', `Роль изменена на «${ROLE_LABEL[role]}»`, userId);
      flush();
    },

    getSettings: (groupId) => get().settings[groupId] ?? DEFAULT_SETTINGS,
    updateSettings: (groupId, patch) => {
      set(s => ({ settings: { ...s.settings, [groupId]: { ...(s.settings[groupId] ?? DEFAULT_SETTINGS), ...patch } } }));
      get().log(groupId, 'settings_change', 'Настройки группы изменены');
      flush();
    },

    log: (groupId, type, text, targetUserId) => {
      const entry: GroupLogEntry = { id: genId('glog'), groupId, actorId: me(), type, text, targetUserId, createdAt: new Date().toISOString() };
      set(s => ({ logs: [entry, ...s.logs].slice(0, 500) }));
      flush();
    },
    logsFor: (groupId) => get().logs.filter(l => l.groupId === groupId),

    createInvite: (groupId, opts) => {
      const invite: GroupInvite = {
        id: genId('inv'), groupId, code: crypto.randomUUID().replace(/-/g, '').slice(0, 10),
        createdBy: me(), createdAt: new Date().toISOString(), uses: 0,
        maxUses: opts?.maxUses,
        expiresAt: opts?.expiresInHours ? new Date(Date.now() + opts.expiresInHours * 3600_000).toISOString() : undefined,
      };
      set(s => ({ invites: [...s.invites, invite] }));
      get().log(groupId, 'invite_created', opts?.maxUses ? `Создана ссылка (лимит ${opts.maxUses})` : 'Создана постоянная ссылка-приглашение');
      flush();
      return invite;
    },
    revokeInvite: (id) => {
      const inv = get().invites.find(i => i.id === id);
      set(s => ({ invites: s.invites.map(i => i.id === id ? { ...i, revoked: true } : i) }));
      if (inv) get().log(inv.groupId, 'invite_revoked', 'Ссылка-приглашение отозвана');
      flush();
    },
    invitesFor: (groupId) => get().invites.filter(i => i.groupId === groupId),

    useInvite: (code) => {
      const inv = get().invites.find(i => i.code === code && !i.revoked);
      if (!inv) return null;
      if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) return null;
      if (inv.maxUses && inv.uses >= inv.maxUses) return null;
      set(s => ({ invites: s.invites.map(i => i.id === inv.id ? { ...i, uses: i.uses + 1 } : i) }));
      flush();
      return inv;
    },

    createJoinRequest: (groupId, userId, answer) => {
      const req: GroupJoinRequest = { id: genId('jreq'), groupId, userId, answer, createdAt: new Date().toISOString(), status: 'pending' };
      set(s => ({ requests: [...s.requests, req] }));
      flush();
    },
    approveJoinRequest: (id) => {
      const req = get().requests.find(r => r.id === id);
      set(s => ({ requests: s.requests.map(r => r.id === id ? { ...r, status: 'approved' } : r) }));
      if (req) get().log(req.groupId, 'join_approved', 'Заявка на вступление одобрена', req.userId);
      flush();
    },
    rejectJoinRequest: (id) => {
      const req = get().requests.find(r => r.id === id);
      set(s => ({ requests: s.requests.map(r => r.id === id ? { ...r, status: 'rejected' } : r) }));
      if (req) get().log(req.groupId, 'join_rejected', 'Заявка на вступление отклонена', req.userId);
      flush();
    },
    requestsFor: (groupId) => get().requests.filter(r => r.groupId === groupId),

    checkFlood: (groupId, userId) => {
      const settings = get().getSettings(groupId);
      if (!settings.antiFlood) return true;
      const key = `${groupId}:${userId}`;
      const now = Date.now();
      const recent = (get().msgTimestamps[key] ?? []).filter(t => now - t < 60_000);
      if (recent.length >= settings.antiFloodMaxPerMinute) return false;
      set(s => ({ msgTimestamps: { ...s.msgTimestamps, [key]: [...recent, now] } }));
      return true;
    },
  };
});
