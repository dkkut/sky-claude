import { create } from 'zustand';

export type ModDomain = 'video-channel' | 'messenger-channel' | 'movie';
export type WarningKind = 'casino' | '18+' | 'casino18' | null;

interface ModFlag {
  warning: WarningKind;
  blocked: boolean;
  blockReason?: string;
  blockedAt?: string;
  blockedBy?: string;
}

const KEY = 'sky:moderation:v1';
const W = typeof window !== 'undefined';
const load = (): Record<string, ModFlag> => { if (!W) return {}; try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = (d: Record<string, ModFlag>) => { if (!W) return; try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
const flagKey = (domain: ModDomain, targetId: string) => `${domain}:${targetId}`;

// Подтверждение баннера "я понял, продолжить" — на сессию, чтобы не
// показывать заново при каждом ре-рендере, но и не забывать навсегда.
const ACK_KEY = 'sky:moderation:ack:v1';
const loadAck = (): string[] => { if (!W) return []; try { return JSON.parse(sessionStorage.getItem(ACK_KEY) || '[]'); } catch { return []; } };
const saveAck = (a: string[]) => { if (!W) return; try { sessionStorage.setItem(ACK_KEY, JSON.stringify(a)); } catch {} };

interface ModerationState {
  flags: Record<string, ModFlag>;
  acknowledged: string[];

  warningFor:   (domain: ModDomain, targetId: string) => WarningKind;
  setWarning:   (domain: ModDomain, targetId: string, warning: WarningKind) => void;
  isBlocked:    (domain: ModDomain, targetId: string) => boolean;
  blockReason:  (domain: ModDomain, targetId: string) => string | undefined;
  blockForScam: (domain: ModDomain, targetId: string, moderatorId: string, reason?: string) => void;
  unblock:      (domain: ModDomain, targetId: string) => void;

  isAcknowledged: (domain: ModDomain, targetId: string) => boolean;
  acknowledge:    (domain: ModDomain, targetId: string) => void;
}

export const useModerationStore = create<ModerationState>((set, get) => ({
  flags: load(),
  acknowledged: loadAck(),

  warningFor: (domain, targetId) => get().flags[flagKey(domain, targetId)]?.warning ?? null,
  setWarning: (domain, targetId, warning) => set(s => {
    const k = flagKey(domain, targetId);
    const flags = { ...s.flags, [k]: { ...(s.flags[k] ?? { blocked: false }), warning } };
    save(flags); return { flags };
  }),

  isBlocked:   (domain, targetId) => !!get().flags[flagKey(domain, targetId)]?.blocked,
  blockReason: (domain, targetId) => get().flags[flagKey(domain, targetId)]?.blockReason,
  blockForScam: (domain, targetId, moderatorId, reason = 'Мошенничество / нарушение правил платформы (казино, скам)') => set(s => {
    const k = flagKey(domain, targetId);
    const flags = { ...s.flags, [k]: { ...(s.flags[k] ?? { warning: null }), blocked: true, blockReason: reason, blockedAt: new Date().toISOString(), blockedBy: moderatorId } };
    save(flags); return { flags };
  }),
  unblock: (domain, targetId) => set(s => {
    const k = flagKey(domain, targetId);
    const prev = s.flags[k]; if (!prev) return {};
    const flags = { ...s.flags, [k]: { ...prev, blocked: false, blockReason: undefined, blockedAt: undefined, blockedBy: undefined } };
    save(flags); return { flags };
  }),

  isAcknowledged: (domain, targetId) => get().acknowledged.includes(flagKey(domain, targetId)),
  acknowledge: (domain, targetId) => set(s => {
    const k = flagKey(domain, targetId);
    if (s.acknowledged.includes(k)) return {};
    const acknowledged = [...s.acknowledged, k]; saveAck(acknowledged); return { acknowledged };
  }),
}));
