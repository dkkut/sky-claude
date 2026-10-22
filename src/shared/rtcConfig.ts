/**
 * STUN/TURN для WebRTC (звонки, трансляции, голосовые комнаты) — с сервера (`GET /api/rtc/config`, server/rtc.mjs).
 * Без TURN соединение не устанавливается при симметричном NAT и в мобильных сетях. Пока ответа нет (или сервер недоступен) —
 * публичные STUN, как раньше. Учётные данные TURN временные; список обновляется заранее, до истечения.
 */
import { apiCall } from '@/core/auth/api';

const DEFAULT: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
let current: RTCIceServer[] = DEFAULT;
let fetchedAt = 0; let ttlMs = 3_600_000; let inflight: Promise<void> | null = null;

export const refreshIceServers = (force = false): Promise<void> => {
  if (!force && Date.now() - fetchedAt < ttlMs / 2) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    const r = await apiCall<{ iceServers: RTCIceServer[]; ttl: number }>('/api/rtc/config');
    if (r.ok && r.data?.iceServers?.length) { current = r.data.iceServers; ttlMs = Math.max(600, r.data.ttl || 3600) * 1000; fetchedAt = Date.now(); }
  })().catch(() => undefined).finally(() => { inflight = null; });
  return inflight;
};

/** Синхронно: то, что известно сейчас. Устаревший список обновляется в фоне для следующего соединения. */
export const getIceServers = (): RTCIceServer[] => { void refreshIceServers(); return current; };
