/**
 * «Продолжить на другом устройстве» — клиентская часть. Не плеер и не новый прогресс: сервер (server/handoff.mjs) только передаёт «открой это на том же месте»
 * между устройствами ОДНОГО Sky ID и профиля, а место остановки лежит в прежних прогрессах (музыка, кино, подкасты, книги, Sky Video).
 * Реестр устройств — общий с Sky Transfer.
 */
import { create } from 'zustand';
import { apiCall } from '@/core/auth/api';
import { detectKind, defaultName } from '@/transfer/transferApi';
import { visibleTick } from '@/shared/visibleTick';

export type HKind = 'music' | 'film' | 'video' | 'podcast' | 'book';
export interface HDevice { id: string; name: string; kind: string; current: boolean; online: boolean; sameProfile: boolean; canReceive: boolean; problem: string | null; lastSeen: string | null }
export interface Handoff {
  id: string; kind: HKind; itemId: string; title: string; position: number; duration: number; extra: Record<string, number | string | null>;
  state: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'superseded' | 'failed'; reason: string | null;
  fromDevice: string; toDevice: string; fromName: string; toName: string; keepPlaying: boolean; live?: boolean; groupId?: string | null; createdAt: string; expiresAt: string;
}
export interface ContinueItem { kind: HKind; itemId: string; title: string; subtitle: string; position: number; duration: number; at: string }

const A = '/api/handoff';
export const HO = {
  register: () => apiCall<{ id: string; status: string }>(`${A}/device/register`, { method: 'POST', body: JSON.stringify({ name: defaultName(), kind: detectKind() }) }),
  heartbeat: () => apiCall(`${A}/device/heartbeat`, { method: 'POST', body: '{}' }),
  devices: () => apiCall<{ me: { id: string; status: string; name: string; kind: string }; devices: HDevice[]; pendingApproval: number; prefs: { accept: 'ask' | 'off'; historyDays: number } }>(`${A}/devices`),
  send: (b: { toDevice: string; kind: HKind; itemId: string; title: string; position: number; duration: number; extra?: Record<string, number | string>; keepPlaying?: boolean; live?: boolean; groupId?: string; idemKey: string }) =>
    apiCall<{ handoff: Handoff; duplicate?: boolean; name?: string }>(`${A}/send`, { method: 'POST', body: JSON.stringify(b) }),
  pending: () => apiCall<{ handoffs: Handoff[] }>(`${A}/pending`),
  status: (id: string) => apiCall<{ handoff: Handoff }>(`${A}/${id}`),
  accept: (id: string) => apiCall<{ handoff: Handoff; newerElsewhere?: boolean }>(`${A}/${id}/accept`, { method: 'POST', body: '{}' }),
  decline: (id: string) => apiCall(`${A}/${id}/decline`, { method: 'POST', body: '{}' }),
  cancel: (id: string) => apiCall(`${A}/${id}/cancel`, { method: 'POST', body: '{}' }),
  history: () => apiCall<{ history: Handoff[] }>(`${A}/history`),
  clearHistory: () => apiCall(`${A}/history`, { method: 'DELETE' }),
  cont: () => apiCall<{ items: ContinueItem[] }>(`${A}/continue`),
  setPrefs: (accept: 'ask' | 'off') => apiCall(`${A}/prefs`, { method: 'PUT', body: JSON.stringify({ accept }) }),
  videoProgress: (id: string) => apiCall<{ progress: { position: number; duration: number } | null }>(`${A}/video-progress/${encodeURIComponent(id)}`),
  setVideoProgress: (id: string, position: number, duration: number) => apiCall(`${A}/video-progress/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ position, duration }) }),
};

const REASON: Record<string, string> = {
  device_offline: 'Устройство сейчас не на связи. Откройте на нём Sky и повторите.',
  other_profile: 'На этом устройстве выбран другой профиль. Переключите профиль и повторите.',
  recipient_not_trusted: 'Устройство ещё не подтверждено. Подтвердите его в разделе «Передача файлов».',
  unsupported_here: 'Это устройство не умеет открывать такой материал.',
  handoff_disabled: 'Передача воспроизведения выключена в настройках.',
  not_found: 'Материал недоступен (его могли убрать, или нужна подписка).',
  same_device: 'Выберите другое устройство.',
  unknown_device: 'Это устройство ещё не зарегистрировано. Повторите через несколько секунд.',
  device_not_approved: 'Это устройство ждёт подтверждения с другого вашего устройства.',
  rate_limited: 'Слишком часто. Подождите немного и повторите.',
  expired: 'Время ожидания вышло. Повторите.',
  bad_state: 'Передача уже завершена.',
};
export const hReason = (e?: string) => REASON[e ?? ''] ?? 'Не получилось. Проверьте связь и повторите.';

export const KIND_LABEL: Record<HKind, string> = { music: 'Музыка', film: 'Кино', video: 'Видео', podcast: 'Подкаст', book: 'Книга' };
export const fmtPos = (s: number) => { const n = Math.max(0, Math.floor(s)); const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60); const x = n % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
interface S {
  meId: string | null;
  incoming: Handoff[];
  /** Состояния отправленных передач: отправитель следит за ответом. */
  sent: Record<string, Handoff>;
  setIncoming: (l: Handoff[]) => void;
  upsert: (h: Handoff) => void;
  setMe: (id: string | null) => void;
}
export const useHandoff = create<S>((set) => ({
  meId: null, incoming: [], sent: {},
  setIncoming: (l) => set({ incoming: l }),
  setMe: (id) => set({ meId: id }),
  upsert: (h) => set((s) => {
    const mine = s.meId;
    const sent = h.fromDevice === mine ? { ...s.sent, [h.id]: h } : s.sent;
    let incoming = s.incoming;
    if (h.toDevice === mine) incoming = h.state === 'pending' ? [h, ...s.incoming.filter((x) => x.id !== h.id)].slice(0, 3) : s.incoming.filter((x) => x.id !== h.id);
    return { sent, incoming };
  }),
}));

let started = false;
/** Регистрирует это устройство и держит его «на связи». Вызывать один раз после входа; без входа ничего не делает. */
export const startHandoff = (): (() => void) => {
  if (started) return () => {};
  started = true;
  let dead = false;
  const sync = async () => {
    const r = await HO.pending();
    if (!dead && r.ok) useHandoff.getState().setIncoming((r.data?.handoffs ?? []).filter((h) => h.state === 'pending'));
  };
  const beat = async () => { const r = await HO.heartbeat(); if (!r.ok && (r.error === 'unknown_device')) await reg(); };
  const reg = async () => {
    const r = await HO.register();
    if (r.ok && r.data) {
      const d = await HO.devices();
      if (d.ok && d.data) useHandoff.getState().setMe(d.data.me.id);
    }
  };
  const onEvt = (e: Event) => {
    const { type, payload } = (e as CustomEvent).detail ?? {};
    if (type === 'handoff:incoming' || type === 'handoff:update') useHandoff.getState().upsert(payload as Handoff);
  };
  window.addEventListener('sky:handoff', onEvt);
  void reg().then(sync);
  const b = setInterval(visibleTick(beat), 30_000);
  const p = setInterval(visibleTick(sync), 10_000);
  const vis = () => { if (!document.hidden) { void beat(); void sync(); } };
  document.addEventListener('visibilitychange', vis);
  return () => { dead = true; started = false; clearInterval(b); clearInterval(p); window.removeEventListener('sky:handoff', onEvt); document.removeEventListener('visibilitychange', vis); };
};
