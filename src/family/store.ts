/* ===========================================================
   SKY FAMILY STORE

   Семья, участники, роли, приглашения, владение и Sky Prime Family —
   реальная серверная сущность (server/family.mjs): кто в семье, кто
   владелец, кому какая роль и активен ли Prime, решает сервер, а не
   этот файл.

   Общий счёт Sky Money, цели, баллы, достижения, лента, список
   покупок, календарь, SOS, геопозиция, карманные деньги, сейф и
   капсулы времени — отдельная, гораздо более крупная задача не по
   текущему ТЗ (см. финальный отчёт). Они остаются как были: локальным
   состоянием этой вкладки, просто теперь пристёгнутым к настоящему
   id семьи и настоящему списку участников, а не к выдуманным.
=========================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import { useMoney } from '@/wallet/store';
import { useMessengerStore } from '@/messenger/store';
import { useModuleStore } from '@/data/state/modules';
import type {
  FamilyMember, FamilyRole, FamilyTx, FamilyGoal, ApprovalRequest,
  FamilyAchievement, ActivityItem, AutoTopupFreq, FamilyShoppingItem,
  FamilyCalendarEvent, SOSAlert, MemberLocation, Allowance, AllowanceFreq, SafeItem, TimeCapsule,
  PermissionKey, TripPlan, ChecklistItem,
} from './types';
import { CASHBACK_TIERS, AVATAR_COLORS, PERMISSIONS } from './types';
import {
  apiMyFamily, apiCreateFamily, apiCloseFamily, apiMyInvitations,
  apiInviteMember, apiCancelInvitation, apiAcceptInvitation, apiRejectInvitation,
  apiAddPlaceholderMember, apiRemoveMember, apiUpdateMember, apiLeaveFamily, apiTransferOwnership,
  apiPurchaseFamilyPrime, apiFamilyWallet, apiFamilyWalletOp,
  type ServerFamily, type ServerFamilyMember, type FamilyInvitation, type ServerFamilyStatus,
} from './familyApi';

const ACH_TEMPLATES: Omit<FamilyAchievement,'unlocked'|'unlockedAt'>[] = [
  { id:'first_topup',  title:'Первая покупка',        desc:'Пополните семейный счёт впервые',        kind:'trophy', reward:'Тема «Рассвет»' },
  { id:'purchases_10', title:'10 операций',           desc:'Совершите 10 операций по семейному счёту',kind:'target', reward:'Рамка профиля «Клевер»' },
  { id:'topup_month',  title:'Пополнение месяца',     desc:'Пополняйте счёт 4 недели подряд',         kind:'calendar', reward:'Анимация «Звёздная пыль»' },
  { id:'million',      title:'Миллион оборота',       desc:'Общий оборот семьи достиг 1 000 000 ₽',   kind:'gem', reward:'Бейдж «Sky Dynasty»' },
  { id:'first_goal',   title:'Первая цель',           desc:'Создайте семейную цель накопления',       kind:'gift', reward:'Фон «Облака»' },
  { id:'goal_done',    title:'Цель достигнута',       desc:'Полностью накопите на семейную цель',     kind:'done', reward:'Салют в приложении' },
  { id:'active_family',title:'Самая активная семья',  desc:'50 операций за всё время',                kind:'zap', reward:'Золотой бейдж семьи' },
];

const nowISO = () => new Date().toISOString();
const me = () => useAuthStore.getState().currentUserId ?? '';
const myName = () => useAuthStore.getState().accounts.find(a=>a.id===me())?.name ?? 'Вы';
const hashStr = (s: string) => { let h=0; for (let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h; };
const HOME_POINT = { x: 50, y: 50 };

export interface Family {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  /** Настоящий статус допуска семьи — решает сервер (active/closed/suspended). */
  status: ServerFamilyStatus;
  memberLimit: number;
  adultLimit: number;
  members: FamilyMember[];
  balance: number;
  transactions: FamilyTx[];
  goals: FamilyGoal[];
  approvalRequests: ApprovalRequest[];
  achievements: FamilyAchievement[];
  activity: ActivityItem[];
  autoTopup: { freq: AutoTopupFreq; amount: number; memberId: string } | null;
  totalTurnover: number;
  primeUntil?: string;
  shoppingList: FamilyShoppingItem[];
  calendar: FamilyCalendarEvent[];
  sosAlerts: SOSAlert[];
  locations: MemberLocation[];
  allowances: Allowance[];
  safe: SafeItem[];
  capsules: TimeCapsule[];
  familyChatId?: string;
  trips: TripPlan[];
}

/* Локальный кэш — только «довесок», которого нет на сервере (счёт,
   цели, достижения и т.п.). Идентичность (id/имя/владелец/участники/
   роли/Prime) на каждой загрузке перезаписывается ответом сервера. */
const KEY = 'sky:family:v1';
const loadLocal = (): Family | null => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const persist = (f: Family | null) => { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* локальный кэш недоступен — не критично */ } };

const roleDefaults = (role: FamilyRole) => ({
  canWithdraw: role !== 'child',
  canDepositOnly: role === 'child',
  dailyLimit: role === 'child' ? 500 : role === 'teen' ? 2000 : undefined,
  maxTransfer: role === 'child' ? 500 : role === 'teen' ? 3000 : undefined,
  requireApprovalOver: role === 'child' ? 300 : role === 'teen' ? 2000 : undefined,
});

/** Серверный участник → форма, которую рисуют существующие экраны. Локальные «довески» (лимиты, баллы) сохраняются между обновлениями по id участника. */
const mapMember = (m: ServerFamilyMember, prevById: Record<string, FamilyMember>): FamilyMember => {
  const prev = prevById[m.id];
  const defaults = roleDefaults(m.role);
  return {
    id: m.id,
    accountId: m.profileId ?? undefined,
    name: m.name,
    avatarColor: prev?.avatarColor ?? AVATAR_COLORS[hashStr(m.id) % AVATAR_COLORS.length],
    role: m.role,
    joinedAt: m.joinedAt ?? nowISO(),
    points: prev?.points ?? 0,
    canWithdraw: prev?.canWithdraw ?? defaults.canWithdraw,
    canDepositOnly: prev?.canDepositOnly ?? defaults.canDepositOnly,
    dailyLimit: prev?.dailyLimit ?? defaults.dailyLimit,
    weeklyLimit: prev?.weeklyLimit,
    monthlyLimit: prev?.monthlyLimit,
    maxTransfer: prev?.maxTransfer ?? defaults.maxTransfer,
    requireApprovalOver: prev?.requireApprovalOver ?? defaults.requireApprovalOver,
    permissions: m.permissions as Partial<Record<PermissionKey, boolean>>,
  };
};

const hydrate = (serverFamily: ServerFamily, members: ServerFamilyMember[], prevLocal: Family | null): Family => {
  const sameFamily = prevLocal && prevLocal.id === serverFamily.id;
  const base: Family = sameFamily ? prevLocal! : {
    id: serverFamily.id, name: serverFamily.name, ownerId: serverFamily.ownerId, createdAt: serverFamily.createdAt ?? nowISO(),
    status: serverFamily.status, memberLimit: serverFamily.memberLimit, adultLimit: serverFamily.adultLimit,
    members: [], balance: 0, transactions: [], goals: [], approvalRequests: [],
    achievements: ACH_TEMPLATES.map(a => ({ ...a, unlocked: false })),
    activity: [{ id: crypto.randomUUID(), memberId: serverFamily.ownerId, memberName: '', text: `семья «${serverFamily.name}» создана`, kind: 'home', createdAt: nowISO() }],
    autoTopup: null, totalTurnover: 0, shoppingList: [], calendar: [], sosAlerts: [],
    locations: [], allowances: [], safe: [], capsules: [], trips: [],
  };
  const prevById = Object.fromEntries((sameFamily ? prevLocal!.members : []).map(m => [m.id, m]));
  return {
    ...base,
    id: serverFamily.id, name: serverFamily.name, ownerId: serverFamily.ownerId,
    status: serverFamily.status, memberLimit: serverFamily.memberLimit, adultLimit: serverFamily.adultLimit,
    primeUntil: serverFamily.primeUntil ?? undefined,
    members: members.map(m => mapMember(m, prevById)),
  };
};

interface FamilyState {
  family: Family | null;
  /** Приглашения, ждущие моего решения (я — получатель). */
  invitations: FamilyInvitation[];
  /** Только у владельца: разосланные и ещё не решённые приглашения. */
  pendingInvitations: FamilyInvitation[];
  loaded: boolean;
  busy: boolean;
  lastError: string | null;

  load: () => Promise<void>;

  // computed
  cashbackPct: () => number;
  familyLevel: () => { level: number; xp: number; xpForNext: number };
  myMember: () => FamilyMember | null;
  isAdult: (memberId: string) => boolean;
  isOwner: () => boolean;

  // жизненный цикл семьи — реальный, серверный
  createFamily: (name: string) => Promise<boolean>;
  closeFamily: () => Promise<boolean>;

  // приглашения — реальные, серверные
  inviteMember: (recipientId: string, role: 'adult'|'teen'|'guest') => Promise<{ ok: boolean; error?: string }>;
  cancelInvitation: (invitationId: string) => Promise<void>;
  acceptInvitation: (invitationId: string) => Promise<{ ok: boolean; error?: string }>;
  rejectInvitation: (invitationId: string) => Promise<void>;

  // участники — реальные
  addChildMember: (name: string, role: 'child'|'teen') => Promise<boolean>;
  removeMember: (memberId: string) => Promise<void>;
  leaveFamily: () => Promise<{ ok: boolean; error?: string }>;
  transferOwnership: (memberId: string) => Promise<{ ok: boolean; error?: string }>;
  updateMemberRole: (memberId: string, role: 'adult'|'teen'|'child'|'guest') => Promise<{ ok: boolean; error?: string }>;
  updateMemberLimits: (memberId: string, patch: Partial<Pick<FamilyMember,'dailyLimit'|'weeklyLimit'|'monthlyLimit'|'maxTransfer'|'canWithdraw'|'canDepositOnly'|'requireApprovalOver'>>) => void;

  // счёт (локально — вне текущего ТЗ)
  /** Общий счёт живёт на сервере: пополнение/вывод — запросы, ответ сервера — истина. */
  topUp: (amount: number) => Promise<{ ok: boolean; error?: string }>;
  withdraw: (amount: number, reason: string) => Promise<{ ok: boolean; error?: string; needsApproval?: boolean }>;
  loadWallet: () => Promise<void>;
  setAutoTopup: (cfg: Family['autoTopup']) => void;

  // цели (локально)
  createGoal: (title: string, kind: string, targetAmount: number, deadline?: string) => void;
  contributeToGoal: (goalId: string, amount: number) => Promise<boolean>;
  deleteGoal: (goalId: string) => void;

  // баллы / достижения (локально)
  addPoints: (memberId: string, amount: number, reason: string) => void;
  totalPoints: () => number;

  // запросы на одобрение (локально)
  requestApproval: (kind: ApprovalRequest['kind'], itemTitle: string, amount: number, reason?: string, category?: string) => void;
  resolveApproval: (id: string, approve: boolean) => void;

  // Sky Prime Family — реально, через сервер
  isPrimeFamilyActive: () => boolean;
  purchaseFamilyPrime: (planId: string) => Promise<boolean>;

  // список покупок (локально)
  addShoppingItem: (title: string, price?: number, store?: string, assignedTo?: string) => void;
  toggleBought: (id: string) => void;
  removeShoppingItem: (id: string) => void;
  clearBought: () => void;

  // календарь (локально)
  addEvent: (title: string, kind: FamilyCalendarEvent['kind'], date: string, note?: string) => void;
  removeEvent: (id: string) => void;
  upcomingEvents: () => FamilyCalendarEvent[];

  // SOS и безопасность (локально)
  triggerSOS: () => void;
  resolveSOS: (id: string) => void;
  blockMemberAccess: (memberId: string) => void;
  unblockMemberAccess: (memberId: string) => void;
  logoutMemberEverywhere: (memberId: string) => void;
  securityFeed: () => { memberId: string; memberName: string; text: string; type: string; at: string }[];

  // геопозиция (локально)
  toggleShareLocation: (share: boolean) => void;
  markImHome: () => void;
  locationFor: (memberId: string) => MemberLocation | null;

  // карманные деньги (локально)
  setAllowance: (memberId: string, amount: number, freq: AllowanceFreq) => void;
  cancelAllowance: (memberId: string) => void;
  checkDuePayouts: () => void;
  payoutNow: (memberId: string) => Promise<boolean>;

  // семейный сейф (локально)
  addSafeItem: (kind: SafeItem['kind'], title: string, content: string, visibility: SafeItem['visibility']) => void;
  removeSafeItem: (id: string) => void;
  visibleSafeItems: () => SafeItem[];

  // капсула времени (локально)
  createCapsule: (title: string, message: string, unlockAt: string) => void;
  openCapsule: (id: string) => void;

  // разрешения (локально; серверно сохраняется role, permissions — заготовка на будущее)
  hasPermission: (memberId: string, key: PermissionKey) => boolean;
  updateMemberPermission: (memberId: string, key: PermissionKey, value: boolean) => void;

  // семейный чат
  openOrCreateFamilyChat: () => string;

  // режим путешествий (локально)
  createTrip: (title: string, destination: string, startDate: string, endDate: string, budget?: number) => void;
  deleteTrip: (id: string) => void;
  addChecklistItem: (tripId: string, text: string) => void;
  toggleChecklistItem: (tripId: string, itemId: string) => void;
  removeChecklistItem: (tripId: string, itemId: string) => void;
  updateTripNotes: (tripId: string, notes: string) => void;

  _log: (text: string, kind: string) => void;
  _checkAchievements: () => void;
}

export const useFamilyStore = create<FamilyState>((set, get) => {
  const mut = (fn: (f: Family) => Family) => {
    const f = get().family;
    if (!f) return;
    const next = fn(f);
    set({ family: next });
    persist(next);
  };

  return {
    family: null,
    invitations: [],
    pendingInvitations: [],
    loaded: false,
    busy: false,
    lastError: null,

    load: async () => {
      const [famRes, invRes] = await Promise.all([apiMyFamily(), apiMyInvitations()]);
      const data = famRes.ok ? famRes.data?.data ?? null : null;
      if (!data) {
        set({ family: null, invitations: invRes.ok ? invRes.data?.invitations ?? [] : [], pendingInvitations: [], loaded: true });
        persist(null);
        return;
      }
      const prevLocal = loadLocal();
      const hydrated = hydrate(data.family, data.members, prevLocal);
      set({
        family: hydrated,
        invitations: invRes.ok ? invRes.data?.invitations ?? [] : [],
        pendingInvitations: data.pendingInvitations ?? [],
        loaded: true,
      });
      persist(hydrated);
      void get().loadWallet();
    },

    loadWallet: async () => {
      const f = get().family;
      if (!f) return;
      const r = await apiFamilyWallet(f.id);
      if (!r.ok || !r.data) return;
      const w = r.data;
      mut(fm => ({ ...fm, balance: w.balance, totalTurnover: w.turnover, transactions: w.transactions.map(t => ({ id: t.id, memberId: t.memberId ?? '', memberName: t.memberName, kind: t.kind, amount: t.amount, desc: t.desc, createdAt: t.createdAt })) }));
    },

    cashbackPct: () => {
      const f = get().family;
      if (!f) return 0;
      const monthSpend = f.transactions
        .filter(t => (t.kind === 'spend' || t.kind === 'withdraw') && daysAgo(t.createdAt) <= 30)
        .reduce((a,t) => a + t.amount, 0);
      let pct = CASHBACK_TIERS[0].pct;
      for (const t of CASHBACK_TIERS) if (monthSpend >= t.min) pct = t.pct;
      return pct;
    },

    familyLevel: () => {
      const f = get().family;
      const xp = f ? f.totalTurnover / 100 + (f.achievements.filter(a=>a.unlocked).length * 200) : 0;
      const level = Math.max(1, Math.floor(xp / 500) + 1);
      const xpForNext = level * 500;
      return { level, xp: Math.round(xp), xpForNext };
    },

    myMember: () => get().family?.members.find(m => m.accountId === me()) ?? null,
    isAdult: (memberId) => {
      const m = get().family?.members.find(x => x.id === memberId);
      return m?.role === 'owner' || m?.role === 'adult';
    },
    isOwner: () => get().family?.ownerId === me(),

    createFamily: async (name) => {
      set({ busy: true, lastError: null });
      const r = await apiCreateFamily(name);
      set({ busy: false });
      if (!r.ok || !r.data) { set({ lastError: r.error ?? 'error' }); return false; }
      const hydrated = hydrate(r.data.data.family, r.data.data.members, null);
      set({ family: hydrated, pendingInvitations: r.data.data.pendingInvitations ?? [] });
      persist(hydrated);
      return true;
    },

    closeFamily: async () => {
      const f = get().family;
      if (!f) return false;
      const r = await apiCloseFamily(f.id);
      if (!r.ok) { set({ lastError: r.error }); return false; }
      set({ family: null, pendingInvitations: [] });
      persist(null);
      return true;
    },

    inviteMember: async (recipientId, role) => {
      const f = get().family;
      if (!f) return { ok: false, error: 'no_family' };
      const r = await apiInviteMember(f.id, recipientId, role);
      if (!r.ok) return { ok: false, error: r.error };
      await get().load();
      return { ok: true };
    },

    cancelInvitation: async (invitationId) => {
      await apiCancelInvitation(invitationId);
      await get().load();
    },

    acceptInvitation: async (invitationId) => {
      const r = await apiAcceptInvitation(invitationId);
      if (!r.ok) return { ok: false, error: r.error };
      await get().load();
      return { ok: true };
    },

    rejectInvitation: async (invitationId) => {
      await apiRejectInvitation(invitationId);
      await get().load();
    },

    addChildMember: async (name, role) => {
      const f = get().family;
      if (!f) return false;
      const r = await apiAddPlaceholderMember(f.id, name, role);
      if (!r.ok) { set({ lastError: r.error }); return false; }
      await get().load();
      get()._log(`добавил(а) ребёнка «${name}» в семью`, 'child');
      return true;
    },

    removeMember: async (memberId) => {
      const f = get().family;
      if (!f) return;
      await apiRemoveMember(f.id, memberId);
      await get().load();
    },

    leaveFamily: async () => {
      const r = await apiLeaveFamily();
      if (!r.ok) return { ok: false, error: r.error };
      set({ family: null, pendingInvitations: [] });
      persist(null);
      return { ok: true };
    },

    transferOwnership: async (memberId) => {
      const f = get().family;
      if (!f) return { ok: false, error: 'no_family' };
      const r = await apiTransferOwnership(f.id, memberId);
      if (!r.ok) return { ok: false, error: r.error };
      await get().load();
      return { ok: true };
    },

    updateMemberRole: async (memberId, role) => {
      const f = get().family;
      if (!f) return { ok: false, error: 'no_family' };
      const r = await apiUpdateMember(f.id, memberId, { role });
      if (!r.ok) return { ok: false, error: r.error };
      await get().load();
      return { ok: true };
    },

    updateMemberLimits: (memberId, patch) => {
      mut(f => ({ ...f, members: f.members.map(m => m.id === memberId ? { ...m, ...patch } : m) }));
    },

    topUp: async (amount) => {
      const f = get().family;
      if (!f || amount <= 0) return { ok: false, error: 'invalid_amount' };
      const uid = me();
      const r = await apiFamilyWalletOp(f.id, 'topup', { amount });
      if (!r.ok) return { ok: false, error: r.error };
      await Promise.all([get().loadWallet(), useMoney.getState().refresh()]);
      get()._log(`пополнил(а) семейный счёт на ${amount.toLocaleString('ru')} ₽`, 'topup');
      get().addPoints(uid, Math.round(amount/100), 'Пополнение семейного счёта');
      get()._checkAchievements();
      return { ok: true };
    },

    withdraw: async (amount, reason) => {
      const f = get().family;
      const uid = me();
      const member = f?.members.find(m => m.accountId === uid);
      if (!f || !member || amount <= 0) return { ok: false, error: 'invalid_amount' };
      if (amount > f.balance) return { ok: false, error: 'insufficient_family_funds' };
      if (member.canDepositOnly || !member.canWithdraw) return { ok: false, error: 'not_allowed' };
      if (member.maxTransfer && amount > member.maxTransfer) return { ok: false, error: 'limit' };

      if (member.requireApprovalOver && amount > member.requireApprovalOver && member.role !== 'owner' && member.role !== 'adult') {
        get().requestApproval('withdraw', reason || 'Вывод средств с семейного счёта', amount, reason);
        return { ok: false, needsApproval: true };
      }
      const r = await apiFamilyWalletOp(f.id, 'withdraw', { amount, desc: reason || 'Вывод на личный счёт' });
      if (!r.ok) return { ok: false, error: r.error };
      await Promise.all([get().loadWallet(), useMoney.getState().refresh()]);
      get()._log(`перевёл(а) ${amount.toLocaleString('ru')} ₽ на личный счёт`, 'transfer');
      return { ok: true };
    },

    setAutoTopup: (cfg) => mut(f => ({ ...f, autoTopup: cfg })),

    createGoal: (title, kind, targetAmount, deadline) => {
      const uid = me();
      const goal: FamilyGoal = { id: crypto.randomUUID(), title, kind, targetAmount, savedAmount: 0, deadline, createdBy: uid, createdAt: nowISO(), contributors: [] };
      mut(f => ({ ...f, goals: [goal, ...f.goals] }));
      get()._log(`создал(а) цель «${title}»`, 'goal');
      get()._checkAchievements();
    },

    contributeToGoal: async (goalId, amount) => {
      const f = get().family;
      if (!f || amount <= 0 || amount > f.balance) return false;
      const uid = me();
      const g0 = f.goals.find(g => g.id === goalId);
      const r = await apiFamilyWalletOp(f.id, 'contribute', { amount, desc: `Взнос в цель${g0 ? ` «${g0.title}»` : ''}` });
      if (!r.ok) return false;
      let achievedNow = false;
      mut(fm => ({
        ...fm,
        goals: fm.goals.map(g => {
          if (g.id !== goalId) return g;
          const saved = Math.min(g.targetAmount, g.savedAmount + amount);
          if (saved >= g.targetAmount && !g.achieved) achievedNow = true;
          return { ...g, savedAmount: saved, achieved: saved >= g.targetAmount, contributors: g.contributors.includes(uid) ? g.contributors : [...g.contributors, uid] };
        }),
      }));
      await get().loadWallet();
      get()._log(`внёс(ла) ${amount.toLocaleString('ru')} ₽ в семейную цель`, 'goalAdd');
      if (achievedNow) { get()._log('Семья достигла цели!', 'done'); }
      get()._checkAchievements();
      return true;
    },

    deleteGoal: (goalId) => mut(f => ({ ...f, goals: f.goals.filter(g => g.id !== goalId) })),

    addPoints: (memberId, amount) => {
      if (amount <= 0) return;
      mut(f => ({ ...f, members: f.members.map(m => m.id === memberId ? { ...m, points: m.points + amount } : m) }));
    },
    totalPoints: () => get().family?.members.reduce((a,m) => a+m.points, 0) ?? 0,

    requestApproval: (kind, itemTitle, amount, reason, category) => {
      const uid = me();
      const req: ApprovalRequest = {
        id: crypto.randomUUID(), memberId: uid, memberName: myName(), kind, itemTitle, amount, reason, category,
        status: 'pending', createdAt: nowISO(),
      };
      mut(f => ({ ...f, approvalRequests: [req, ...f.approvalRequests] }));
      get()._log(`запросил(а) разрешение: ${itemTitle}`, 'request');
    },

    resolveApproval: (id, approve) => {
      const uid = me();
      const f = get().family;
      const req = f?.approvalRequests.find(r => r.id === id);
      mut(fam => ({ ...fam, approvalRequests: fam.approvalRequests.map(r => r.id === id ? { ...r, status: approve ? 'approved' : 'denied', resolvedAt: nowISO(), resolvedBy: uid } : r) }));
      if (req && approve && req.kind === 'withdraw' && f) {
        const member = f.members.find(m => m.accountId === req.memberId);
        if (member && req.amount <= f.balance) {
          void apiFamilyWalletOp(f.id, 'withdraw', { amount: req.amount, desc: `${req.itemTitle} (одобрено)`, toProfileId: req.memberId, idemKey: `approval:${req.id}` })
            .then(() => get().loadWallet());
        }
      }
      get()._log(approve ? `одобрил(а) запрос «${req?.itemTitle}»` : `отклонил(а) запрос «${req?.itemTitle}»`, approve ? 'approve' : 'reject');
    },

    isPrimeFamilyActive: () => {
      const until = get().family?.primeUntil;
      return !!until && new Date(until).getTime() > Date.now();
    },

    purchaseFamilyPrime: async (planId) => {
      const f = get().family;
      if (!f) return false;
      const r = await apiPurchaseFamilyPrime(f.id, planId);
      if (!r.ok) { set({ lastError: r.error }); return false; }
      await get().load();
      get()._log(`оформил(а) Sky Prime Family — Prime теперь у всей семьи`, 'prime');
      return true;
    },

    addShoppingItem: (title, price, store, assignedTo) => {
      const uid = me();
      const item: FamilyShoppingItem = { id: crypto.randomUUID(), title, price, store, assignedTo, addedBy: uid, bought: false, createdAt: nowISO() };
      mut(f => ({ ...f, shoppingList: [item, ...f.shoppingList] }));
    },
    toggleBought: (id) => mut(f => ({ ...f, shoppingList: f.shoppingList.map(i => i.id === id ? { ...i, bought: !i.bought } : i) })),
    removeShoppingItem: (id) => mut(f => ({ ...f, shoppingList: f.shoppingList.filter(i => i.id !== id) })),
    clearBought: () => mut(f => ({ ...f, shoppingList: f.shoppingList.filter(i => !i.bought) })),

    addEvent: (title, kind, date, note) => {
      const uid = me();
      const ev: FamilyCalendarEvent = { id: crypto.randomUUID(), title, kind, date, note, createdBy: uid, createdAt: nowISO() };
      mut(f => ({ ...f, calendar: [...f.calendar, ev] }));
      get()._log(`добавил(а) в календарь: ${title}`, 'calendar');
    },
    removeEvent: (id) => mut(f => ({ ...f, calendar: f.calendar.filter(e => e.id !== id) })),
    upcomingEvents: () => {
      const f = get().family;
      if (!f) return [];
      return [...f.calendar].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    },

    triggerSOS: () => {
      const uid = me();
      const alert: SOSAlert = { id: crypto.randomUUID(), memberId: uid, memberName: myName(), createdAt: nowISO(), resolved: false };
      mut(f => ({ ...f, sosAlerts: [alert, ...f.sosAlerts] }));
      get()._log('нажал(а) кнопку SOS — все взрослые уведомлены', 'sos');
    },
    resolveSOS: (id) => mut(f => ({ ...f, sosAlerts: f.sosAlerts.map(a => a.id === id ? { ...a, resolved: true, resolvedAt: nowISO() } : a) })),

    blockMemberAccess: (memberId) => {
      const f = get().family;
      const member = f?.members.find(m => m.id === memberId);
      if (member?.accountId) useAuthStore.getState().spamBlock(member.accountId, 60 * 24 * 365);
      get()._log(`заблокировал(а) доступ участнику ${member?.name ?? ''}`, 'lock');
    },
    unblockMemberAccess: (memberId) => {
      const f = get().family;
      const member = f?.members.find(m => m.id === memberId);
      if (member?.accountId) useAuthStore.getState().spamBlock(member.accountId, 0);
      get()._log(`восстановил(а) доступ участнику ${member?.name ?? ''}`, 'unlock');
    },
    logoutMemberEverywhere: (memberId) => {
      const f = get().family;
      const member = f?.members.find(m => m.id === memberId);
      if (member?.accountId) useAuthStore.getState().logoutAll(member.accountId);
      get()._log(`завершил(а) все сессии участника ${member?.name ?? ''}`, 'logout');
    },
    securityFeed: () => {
      const f = get().family;
      if (!f) return [];
      const accounts = useAuthStore.getState().accounts;
      const rows: { memberId: string; memberName: string; text: string; type: string; at: string }[] = [];
      f.members.forEach(m => {
        if (!m.accountId) return;
        const acc = accounts.find(a => a.id === m.accountId);
        (acc?.securityLog ?? []).forEach(e => rows.push({ memberId: m.id, memberName: m.name, text: e.text, type: e.type, at: e.at }));
      });
      return rows.sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 40);
    },

    toggleShareLocation: (share) => {
      const uid = me();
      const seed = uid + 'loc';
      mut(f => {
        const existing = f.locations.find(l => l.memberId === uid);
        const point = existing?.point ?? { x: 20 + (hashStr(seed) % 60), y: 20 + (hashStr(seed+'y') % 60) };
        const loc: MemberLocation = { memberId: uid, point, battery: existing?.battery ?? 60 + (hashStr(seed+'b') % 40), updatedAt: nowISO(), atHome: existing?.atHome ?? false, sharing: share };
        return { ...f, locations: [...f.locations.filter(l => l.memberId !== uid), loc] };
      });
    },
    markImHome: () => {
      const uid = me();
      mut(f => ({ ...f, locations: f.locations.map(l => l.memberId === uid ? { ...l, point: HOME_POINT, atHome: true, updatedAt: nowISO() } : l) }));
      get()._log(`отметил(а) "Я дома"`, 'home');
    },
    locationFor: (memberId) => get().family?.locations.find(l => l.memberId === memberId) ?? null,

    setAllowance: (memberId, amount, freq) => {
      const days = freq === 'weekly' ? 7 : 30;
      const next: Allowance = { memberId, amount, freq, nextPayoutAt: new Date(Date.now() + days*86400000).toISOString(), active: true };
      mut(f => ({ ...f, allowances: [...f.allowances.filter(a => a.memberId !== memberId), next] }));
      get()._log(`настроил(а) карманные деньги`, 'money');
    },
    cancelAllowance: (memberId) => mut(f => ({ ...f, allowances: f.allowances.map(a => a.memberId === memberId ? { ...a, active: false } : a) })),

    payoutNow: async (memberId) => {
      const f = get().family;
      const a = f?.allowances.find(x => x.memberId === memberId);
      const member = f?.members.find(m => m.id === memberId);
      if (!f || !a || !member || f.balance < a.amount || !member.accountId) return false;
      const r = await apiFamilyWalletOp(f.id, 'withdraw', { amount: a.amount, desc: 'Карманные деньги', toProfileId: member.accountId, idemKey: `allowance:${memberId}:${a.nextPayoutAt}` });
      if (!r.ok) return false;
      const days = a.freq === 'weekly' ? 7 : 30;
      mut(fm => ({
        ...fm,
        allowances: fm.allowances.map(x => x.memberId === memberId ? { ...x, nextPayoutAt: new Date(Date.now()+days*86400000).toISOString() } : x),
      }));
      await Promise.all([get().loadWallet(), useMoney.getState().refresh()]);
      get()._log(`получил(а) карманные деньги: ${a.amount.toLocaleString('ru')} ₽`, 'money');
      get().addPoints(memberId, Math.round(a.amount/50), 'Карманные деньги');
      return true;
    },
    checkDuePayouts: () => {
      const f = get().family;
      if (!f) return;
      f.allowances.filter(a => a.active && new Date(a.nextPayoutAt).getTime() <= Date.now()).forEach(a => { void get().payoutNow(a.memberId); });
    },

    addSafeItem: (kind, title, content, visibility) => {
      const uid = me();
      const item: SafeItem = { id: crypto.randomUUID(), kind, title, content, visibility, ownerId: uid, createdAt: nowISO() };
      mut(f => ({ ...f, safe: [item, ...f.safe] }));
      get()._log(`добавил(а) в семейный сейф: ${title}`, 'safe');
    },
    removeSafeItem: (id) => mut(f => ({ ...f, safe: f.safe.filter(i => i.id !== id) })),
    visibleSafeItems: () => {
      const f = get().family;
      if (!f) return [];
      const uid = me();
      const adult = get().isAdult(f.members.find(m => m.accountId === uid)?.id ?? uid);
      return f.safe.filter(i => i.visibility === 'everyone' || i.ownerId === uid || (i.visibility === 'adults' && adult));
    },

    createCapsule: (title, message, unlockAt) => {
      const uid = me();
      const capsule: TimeCapsule = { id: crypto.randomUUID(), title, message, authorId: uid, authorName: myName(), createdAt: nowISO(), unlockAt, opened: false };
      mut(f => ({ ...f, capsules: [capsule, ...f.capsules] }));
      get()._log(`создал(а) капсулу времени «${title}»`, 'capsule');
    },
    openCapsule: (id) => {
      const f = get().family;
      const cap = f?.capsules.find(c => c.id === id);
      if (!cap || new Date(cap.unlockAt).getTime() > Date.now()) return;
      mut(fm => ({ ...fm, capsules: fm.capsules.map(c => c.id === id ? { ...c, opened: true } : c) }));
    },

    hasPermission: (memberId, key) => {
      const f = get().family;
      const m = f?.members.find(x => x.id === memberId);
      if (!m) return false;
      if (m.role === 'owner' || m.role === 'adult') return true;
      if (m.permissions && key in m.permissions) return !!m.permissions[key];
      const def = PERMISSIONS.find(p => p.key === key);
      if (!def) return false;
      return m.role === 'teen' ? def.defaultTeen : m.role === 'child' ? def.defaultChild : false;
    },

    updateMemberPermission: (memberId, key, value) => {
      mut(f => ({ ...f, members: f.members.map(m => m.id === memberId ? { ...m, permissions: { ...m.permissions, [key]: value } } : m) }));
      const b = get().family;
      const target = b?.members.find(m => m.id === memberId);
      if (b && target) void apiUpdateMember(b.id, memberId, { permissions: { ...target.permissions, [key]: value } as Record<string, boolean> });
    },

    openOrCreateFamilyChat: () => {
      const f = get().family;
      if (!f) return '';
      const existing = useMessengerStore.getState().chats.find(c => c.id === f.familyChatId);
      let chatId = f.familyChatId;
      if (!existing) {
        const memberIds = f.members.map(m => m.accountId).filter((x): x is string => !!x && x !== me());
        chatId = useMessengerStore.getState().createChat({ name: f.name, type: 'group', description: 'Семейный чат Sky Family', memberIds });
        mut(fm => ({ ...fm, familyChatId: chatId }));
      } else {
        useMessengerStore.setState({ activeChatId: chatId });
      }
      useModuleStore.getState().setActiveModule('messages');
      return chatId!;
    },

    createTrip: (title, destination, startDate, endDate, budget) => {
      const uid = me();
      const trip: TripPlan = { id: crypto.randomUUID(), title, destination, startDate, endDate, budget, checklist: [], notes: '', createdBy: uid, createdAt: nowISO() };
      mut(f => ({ ...f, trips: [trip, ...f.trips] }));
      get()._log(`запланировал(а) поездку «${title}»`, 'trip');
      get().addEvent(`Поездка: ${title}`, 'trip', startDate, destination);
    },
    deleteTrip: (id) => mut(f => ({ ...f, trips: f.trips.filter(t => t.id !== id) })),
    addChecklistItem: (tripId, text) => {
      const item: ChecklistItem = { id: crypto.randomUUID(), text, done: false };
      mut(f => ({ ...f, trips: f.trips.map(t => t.id === tripId ? { ...t, checklist: [...t.checklist, item] } : t) }));
    },
    toggleChecklistItem: (tripId, itemId) => {
      mut(f => ({ ...f, trips: f.trips.map(t => t.id === tripId ? { ...t, checklist: t.checklist.map(c => c.id === itemId ? { ...c, done: !c.done } : c) } : t) }));
    },
    removeChecklistItem: (tripId, itemId) => {
      mut(f => ({ ...f, trips: f.trips.map(t => t.id === tripId ? { ...t, checklist: t.checklist.filter(c => c.id !== itemId) } : t) }));
    },
    updateTripNotes: (tripId, notes) => {
      mut(f => ({ ...f, trips: f.trips.map(t => t.id === tripId ? { ...t, notes } : t) }));
    },

    _log: (text, kind) => {
      const uid = me();
      mut(f => ({ ...f, activity: [{ id: crypto.randomUUID(), memberId: uid, memberName: myName(), text, kind, createdAt: nowISO() }, ...f.activity].slice(0, 100) }));
    },

    _checkAchievements: () => {
      const f = get().family;
      if (!f) return;
      const txCount = f.transactions.length;
      const unlock = (id: string) => {
        mut(fam => ({ ...fam, achievements: fam.achievements.map(a => a.id === id && !a.unlocked ? { ...a, unlocked: true, unlockedAt: nowISO() } : a) }));
      };
      if (f.transactions.some(t => t.kind === 'topup')) unlock('first_topup');
      if (txCount >= 10) unlock('purchases_10');
      if (txCount >= 50) unlock('active_family');
      if (f.totalTurnover >= 1000000) unlock('million');
      if (f.goals.length >= 1) unlock('first_goal');
      if (f.goals.some(g => g.achieved)) unlock('goal_done');
    },
  };
});

function daysAgo(iso: string) { return (Date.now() - new Date(iso).getTime()) / 86400000; }
