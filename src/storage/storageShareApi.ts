/**
 * Sky Personal Storage: «Поделиться» — разговор с сервером.
 *
 * Права решает сервер; здесь только вызовы. VIEW подразумевается самим
 * фактом записи, DOWNLOAD — отдельным флагом (см. server/storageshare.mjs).
 */
import { apiCall } from '@/core/auth/api';

export type FileKind = 'movie' | 'track';

export interface ShareEntry {
  id: string;
  userId: string;
  username: string;
  name: string;
  canDownload: boolean;
  createdAt: string;
  expiresAt?: string | null;
}

export const apiStorageShare = (kind: FileKind, fileId: string, userId: string, canDownload = false) =>
  apiCall<{ ok: true }>(`/api/storage/files/${kind}/${encodeURIComponent(fileId)}/share`,
    { method: 'POST', body: JSON.stringify({ userId, canDownload }) });

export const apiStorageRevoke = (kind: FileKind, fileId: string, userId: string) =>
  apiCall<{ ok: true }>(
    `/api/storage/files/${kind}/${encodeURIComponent(fileId)}/share/${encodeURIComponent(userId)}`,
    { method: 'DELETE' });

export const apiStorageShares = (kind: FileKind, fileId: string) =>
  apiCall<{ shares: ShareEntry[] }>(`/api/storage/files/${kind}/${encodeURIComponent(fileId)}/share`);

export interface SharedMovie { id: string; title: string; can_download: boolean; owner_username: string }
export interface SharedTrack { id: string; title: string; artist: string; can_download: boolean; owner_username: string }

export const apiSharedWithMe = () =>
  apiCall<{ movies: SharedMovie[]; tracks: SharedTrack[] }>('/api/storage/shared-with-me');

export const STORAGE_SHARE_ERRORS: Record<string, string> = {
  invalid_kind: 'Так делиться нельзя.',
  invalid_recipient: 'Выберите, с кем поделиться.',
  recipient_not_found: 'Такого человека нет.',
  not_found: 'Файл не найден или это не ваш файл.',
  rate_limited: 'Слишком часто. Подождите немного.',
};

export const explainStorageShare = (code?: string) =>
  (code && STORAGE_SHARE_ERRORS[code]) || 'Не получилось. Попробуйте ещё раз.';
