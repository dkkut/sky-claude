/** Предел массовой загрузки (файлов за один раз) из настроек администрации. 0 — без ограничения. Сбой запроса = без ограничения. */
import { apiCall } from '@/core/auth/api';

let cache: { at: number; v: Record<string, number> } | null = null;

export const batchLimit = async (kind: 'music' | 'film'): Promise<number> => {
  if (!cache || Date.now() - cache.at > 60_000) {
    const r = await apiCall<{ personal?: Record<string, { maxBatch?: number }> }>('/api/upload-limits');
    const p = r.ok ? r.data?.personal ?? {} : {};
    cache = { at: Date.now(), v: { music: Number(p.music?.maxBatch) || 0, film: Number(p.film?.maxBatch) || 0 } };
  }
  return cache.v[kind] ?? 0;
};
