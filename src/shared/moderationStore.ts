/**
 * Пометки и блокировки контента (видео-каналы, каналы мессенджера,
 * фильмы) — источник правды теперь сервер (server/contentflags.mjs),
 * а не localStorage браузера. Раньше «Заблокировать за скам» писал
 * только в собственный localStorage администратора: сам блок и badge
 * с причиной видел только тот же браузер, что нажал кнопку — другой
 * администратор и тем более обычный пользователь об этом никогда не
 * узнавали, хотя кнопка выглядела как настоящая модерация.
 */
import { create } from 'zustand';
import { apiCall } from '@/core/auth/api';

export type ModDomain = 'video-channel' | 'messenger-channel' | 'movie';
export type WarningKind = 'casino' | '18+' | 'casino18' | null;

interface ModFlag {
  warning: WarningKind;
  blocked: boolean;
  blockReason?: string;
  blockedAt?: string;
  blockedBy?: string;
}

const flagKey = (domain: ModDomain, targetId: string) => `${domain}:${targetId}`;

const W = typeof window !== 'undefined';

// Подтверждение баннера "я понял, продолжить" — чисто локальное UI-
// состояние показа (не модерация), поэтому остаётся в sessionStorage,
// как и было.
const ACK_KEY = 'sky:moderation:ack:v1';
const loadAck = (): string[] => { if (!W) return []; try { return JSON.parse(sessionStorage.getItem(ACK_KEY) || '[]'); } catch { return []; } };
const saveAck = (a: string[]) => { if (!W) return; try { sessionStorage.setItem(ACK_KEY, JSON.stringify(a)); } catch {} };

interface ServerFlag {
  domain: ModDomain; targetId: string; warning: WarningKind; blocked: boolean;
  blockReason?: string; blockedAt?: string; blockedBy?: string;
}

interface ModerationState {
  flags: Record<string, ModFlag>;
  loaded: boolean;
  loading: boolean;
  fetchFlags: () => Promise<void>;
  acknowledged: string[];

  warningFor:   (domain: ModDomain, targetId: string) => WarningKind;
  setWarning:   (domain: ModDomain, targetId: string, warning: WarningKind) => Promise<void>;
  isBlocked:    (domain: ModDomain, targetId: string) => boolean;
  blockReason:  (domain: ModDomain, targetId: string) => string | undefined;
  blockForScam: (domain: ModDomain, targetId: string, moderatorId: string, reason?: string) => Promise<void>;
  unblock:      (domain: ModDomain, targetId: string) => Promise<void>;

  isAcknowledged: (domain: ModDomain, targetId: string) => boolean;
  acknowledge:    (domain: ModDomain, targetId: string) => void;
}

export const useModerationStore = create<ModerationState>((set, get) => ({
  flags: {},
  loaded: false,
  loading: false,
  acknowledged: loadAck(),

  fetchFlags: async () => {
    set({ loading: true });
    const r = await apiCall<{ flags: ServerFlag[] }>('/api/moderation/flags');
    if (!r.ok) { set({ loading: false }); return; }
    const flags: Record<string, ModFlag> = {};
    for (const f of r.data?.flags ?? []) {
      flags[flagKey(f.domain, f.targetId)] = {
        warning: f.warning, blocked: f.blocked,
        blockReason: f.blockReason, blockedAt: f.blockedAt, blockedBy: f.blockedBy,
      };
    }
    set({ flags, loaded: true, loading: false });
  },

  warningFor: (domain, targetId) => get().flags[flagKey(domain, targetId)]?.warning ?? null,

  setWarning: async (domain, targetId, warning) => {
    const r = await apiCall('/api/moderation/flags/warning', {
      method: 'POST', body: JSON.stringify({ domain, targetId, warning }),
    });
    if (!r.ok) return;
    set((s) => {
      const k = flagKey(domain, targetId);
      return { flags: { ...s.flags, [k]: { ...(s.flags[k] ?? { blocked: false }), warning } } };
    });
  },

  isBlocked:   (domain, targetId) => !!get().flags[flagKey(domain, targetId)]?.blocked,
  blockReason: (domain, targetId) => get().flags[flagKey(domain, targetId)]?.blockReason,

  blockForScam: async (domain, targetId, moderatorId, reason = 'Мошенничество / нарушение правил платформы (казино, скам)') => {
    void moderatorId; // сервер сам знает модератора по сессии, см. isFollowing в social.ts
    const r = await apiCall('/api/moderation/flags/block', {
      method: 'POST', body: JSON.stringify({ domain, targetId, blocked: true, reason }),
    });
    if (!r.ok) return;
    void get().fetchFlags();
  },

  unblock: async (domain, targetId) => {
    const r = await apiCall('/api/moderation/flags/block', {
      method: 'POST', body: JSON.stringify({ domain, targetId, blocked: false }),
    });
    if (!r.ok) return;
    set((s) => {
      const k = flagKey(domain, targetId);
      const prev = s.flags[k]; if (!prev) return {};
      return { flags: { ...s.flags, [k]: { ...prev, blocked: false, blockReason: undefined, blockedAt: undefined, blockedBy: undefined } } };
    });
  },

  isAcknowledged: (domain, targetId) => get().acknowledged.includes(flagKey(domain, targetId)),
  acknowledge: (domain, targetId) => set((s) => {
    const k = flagKey(domain, targetId);
    if (s.acknowledged.includes(k)) return {};
    const acknowledged = [...s.acknowledged, k]; saveAck(acknowledged); return { acknowledged };
  }),
}));
