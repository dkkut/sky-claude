/* ===============================================================
   STREAMS — разговор с сервером (server/streams.mjs).

   Кто автор, кто сейчас смотрит, кому можно донатить — решает
   только сервер. Этот файл только зовёт HTTP-ручки; всё живое
   (чат/реакции/прогнозы/WebRTC) идёт через WS, см. wireSend в store.ts.
=============================================================== */
import { apiCall } from '@/core/auth/api';
import type { StreamCategory, LiveStreamEntry } from './store';

export const apiStreamsList = async (): Promise<LiveStreamEntry[]> => {
  const r = await apiCall<{ streams: LiveStreamEntry[] }>('/api/streams');
  return r.ok ? r.data?.streams ?? [] : [];
};

export const apiStreamGet = async (streamId: string): Promise<LiveStreamEntry | null> => {
  const r = await apiCall<{ stream: LiveStreamEntry }>(`/api/streams/${streamId}`);
  return r.ok ? r.data?.stream ?? null : null;
};

export interface CreateStreamInput {
  title: string;
  description?: string;
  category: StreamCategory;
  tags: string[];
  source: 'camera' | 'screen';
}
export const apiStreamCreate = async (input: CreateStreamInput): Promise<LiveStreamEntry | { error: string }> => {
  const r = await apiCall<{ stream: LiveStreamEntry }>('/api/streams', { method: 'POST', body: JSON.stringify(input) });
  return r.ok && r.data ? r.data.stream : { error: r.error ?? 'failed' };
};

export const apiStreamEnd = async (streamId: string): Promise<boolean> => {
  const r = await apiCall(`/api/streams/${streamId}/end`, { method: 'POST' });
  return r.ok;
};

export const apiStreamDonate = async (
  streamId: string, amount: number, message: string, idempotencyKey: string,
): Promise<{ ok: true } | { error: string }> => {
  const r = await apiCall<{ ok: true }>(`/api/streams/${streamId}/donate`, {
    method: 'POST', body: JSON.stringify({ amount, message, idempotencyKey }),
  });
  return r.ok ? { ok: true } : { error: r.error ?? 'failed' };
};
