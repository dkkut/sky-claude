/**
 * Sky Books: разговор с сервером.
 *
 * Только вызовы. Кому что можно, решает сервер — этот файл живёт в
 * браузере и ни одна проверка отсюда его решение не заменяет.
 */
import { apiCall, getAccessToken, uploadUrl, nativeXhrHeaders } from '@/core/auth/api';
import { NATIVE_APP } from '@/core/nativeApp';

export interface Book {
  id: string;
  title: string;
  description?: string;
  category: string;
  genre?: string;
  language: string;
  accent: string;
  hasCover: boolean;
  status: 'private' | 'pending' | 'published' | 'rejected';
  private: boolean;
  explicit?: boolean;
  chapters: number;
  words: number;
  audioSeconds: number;
  hasText: boolean;
  hasAudio: boolean;
  reads: number;
  listens: number;
  authorName?: string;
  own?: boolean;
  onShelf?: boolean;
  createdAt?: string;
  rejectReason?: string;
}

export interface ChapterMeta {
  id: string;
  bookId: string;
  number: number;
  title: string;
  wordCount: number;
  hasText: boolean;
  hasAudio: boolean;
  audioSeconds: number;
}

export interface Chapter extends ChapterMeta {
  content: string;
}

export interface Progress {
  lastMode: 'text' | 'audio';
  textChapter: number;
  textOffset: number;
  audioChapter: number;
  audioPosition: number;
  completed: boolean;
}

export const CATEGORIES = [
  'Все', 'Художественная литература', 'Фантастика', 'Детектив', 'Бизнес',
  'Саморазвитие', 'История', 'Наука', 'Биография', 'Поэзия', 'Другое',
];

/* ─── Адреса файлов ────────────────────────────────────────────────── */

export const chapterAudioUrl = (id: string) => `/api/books/chapter/${encodeURIComponent(id)}/audio`;
export const bookCoverUrl = (id: string) => `/api/books/book/${encodeURIComponent(id)}/cover`;

/** Тег <audio> и <img> не шлют Authorization — сервер узнаёт по куке. */
export const apiMediaTicket = async () => {
  const r = await apiCall('/api/books/ticket', { method: 'POST', body: '{}' });
  return r.ok;
};

/* ─── Каталог ──────────────────────────────────────────────────────── */

export const apiCatalog = async (opts: {
  q?: string; category?: string; limit?: number; offset?: number; sort?: 'new' | 'popular';
} = {}) => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.category && opts.category !== 'Все') p.set('category', opts.category);
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.offset) p.set('offset', String(opts.offset));
  if (opts.sort) p.set('sort', opts.sort);
  const qs = p.toString();
  const r = await apiCall<{ books: Book[] }>(`/api/books/catalog${qs ? `?${qs}` : ''}`);
  return r.ok ? (r.data?.books ?? []) : null;
};

export const apiCategories = async () => {
  const r = await apiCall<{ categories: { name: string; count: number }[] }>('/api/books/categories');
  return r.ok ? (r.data?.categories ?? []) : [];
};

export const apiMine = async () => {
  const r = await apiCall<{ books: Book[] }>('/api/books/mine');
  return r.ok ? (r.data?.books ?? []) : [];
};

export const apiBook = async (id: string) => {
  const r = await apiCall<{ book: Book }>(`/api/books/book/${encodeURIComponent(id)}`);
  return r.ok ? (r.data?.book ?? null) : null;
};

export const apiChapters = async (bookId: string) => {
  const r = await apiCall<{ chapters: ChapterMeta[] }>(`/api/books/book/${encodeURIComponent(bookId)}/chapters`);
  return r.ok ? (r.data?.chapters ?? null) : null;
};

export const apiChapter = async (id: string) => {
  const r = await apiCall<{ chapter: Chapter }>(`/api/books/chapter/${encodeURIComponent(id)}`);
  return r.ok ? (r.data?.chapter ?? null) : null;
};

/* ─── Полка ────────────────────────────────────────────────────────── */

export const apiShelf = async () => {
  const r = await apiCall<{ books: Book[] }>('/api/books/shelf');
  return r.ok ? (r.data?.books ?? []) : [];
};

export const apiSetShelf = async (bookId: string, on: boolean) => {
  const r = await apiCall<{ books: Book[] }>('/api/books/shelf',
    { method: 'POST', body: JSON.stringify({ bookId, on }) });
  return r.ok ? (r.data?.books ?? null) : null;
};

/* ─── Прогресс ─────────────────────────────────────────────────────── */

export const apiProgress = async (bookId: string) => {
  const r = await apiCall<{ progress: Progress | null }>(`/api/books/book/${encodeURIComponent(bookId)}/progress`);
  return r.ok ? (r.data?.progress ?? null) : null;
};

export const apiSetProgress = async (bookId: string, patch: {
  mode: 'text' | 'audio'; textChapter?: number; textOffset?: number;
  audioChapter?: number; audioPosition?: number; completed?: boolean;
}) => {
  const r = await apiCall(`/api/books/book/${encodeURIComponent(bookId)}/progress`, {
    method: 'POST', body: JSON.stringify(patch), keepalive: true,
  });
  return r.ok;
};

export const apiNotePlayed = async (bookId: string, kind: 'text' | 'audio') => {
  const r = await apiCall(`/api/books/book/${encodeURIComponent(bookId)}/${kind === 'audio' ? 'listen' : 'read'}`,
    { method: 'POST', body: '{}' });
  return r.ok;
};

/* ─── Своё хозяйство ───────────────────────────────────────────────── */

export const apiCreateBook = async (meta: {
  title: string; description?: string; category?: string; genre?: string; accent?: string; explicit?: boolean;
}) => {
  const r = await apiCall<{ book: Book }>('/api/books/book', { method: 'POST', body: JSON.stringify(meta) });
  return r.ok ? (r.data?.book ?? null) : null;
};

export const apiPatchBook = async (id: string, patch: Partial<{
  title: string; description: string; category: string; genre: string; accent: string; explicit: boolean; status: 'private';
}>) => {
  const r = await apiCall<{ book: Book }>(`/api/books/book/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) });
  return r.ok ? (r.data?.book ?? null) : null;
};

export const apiDeleteBook = async (id: string) => {
  const r = await apiCall(`/api/books/book/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return r.ok;
};

export const apiCreateChapter = async (bookId: string, meta: { title?: string; content?: string }) => {
  const r = await apiCall<{ id: string; number: number }>(`/api/books/book/${encodeURIComponent(bookId)}/chapter`,
    { method: 'POST', body: JSON.stringify(meta) });
  return r.ok ? r.data ?? null : null;
};

export const apiPatchChapter = async (id: string, patch: { title?: string; content?: string }) => {
  const r = await apiCall<{ chapter: Chapter }>(`/api/books/chapter/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) });
  return r.ok ? (r.data?.chapter ?? null) : null;
};

export const apiDeleteChapter = async (id: string) => {
  const r = await apiCall(`/api/books/chapter/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return r.ok;
};

export const apiSubmitBook = async (id: string): Promise<
{ ok: true; book: Book | null } | { ok: false; reason: string }> => {
  const r = await apiCall<{ book: Book }>(`/api/books/book/${encodeURIComponent(id)}/submit`,
    { method: 'POST', body: '{}' });
  if (r.ok) return { ok: true, book: r.data?.book ?? null };
  return { ok: false, reason: SUBMIT_REASONS[r.error ?? ''] ?? 'Не получилось' };
};

const SUBMIT_REASONS: Record<string, string> = {
  no_chapters: 'Нужна хотя бы одна глава: пустую книгу показывать нечем',
  already_pending: 'Книга уже ждёт проверки',
  already_published: 'Книга уже опубликована',
};

export const apiModerationQueue = async () => {
  const r = await apiCall<{ books: Book[] }>('/api/books/moderation');
  return r.ok ? (r.data?.books ?? null) : null;
};

export const apiModerate = async (id: string, approve: boolean, reason?: string) => {
  const r = await apiCall(`/api/books/book/${encodeURIComponent(id)}/moderate`,
    { method: 'POST', body: JSON.stringify({ approve, reason }) });
  return r.ok;
};

/* ─── Загрузка файлов ──────────────────────────────────────────────── */

const UPLOAD_REASONS: Record<string, string> = {
  unsupported_type: 'Такой файл не подходит',
  file_too_large: 'Файл слишком большой',
  upload_interrupted: 'Загрузка оборвалась — попробуйте ещё раз',
  empty_file: 'Файл пустой',
  storage_unavailable: 'На сервере нет места — сообщите владельцу',
  rate_limited: 'Слишком часто. Попробуйте позже',
};

export const apiUploadChapterAudio = (
  chapterId: string, file: Blob, durationSec: number, onProgress?: (percent: number) => void,
): { promise: Promise<{ ok: boolean; chapter?: Chapter; reason?: string }>; cancel: () => void } => {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ ok: boolean; chapter?: Chapter; reason?: string }>((resolve) => {
    xhr.open('POST', uploadUrl(`${chapterAudioUrl(chapterId)}?duration=${Math.round(durationSec)}`));
    xhr.withCredentials = !NATIVE_APP;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    Object.entries(nativeXhrHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let data: { chapter?: Chapter; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* тела может не быть */ }
      if (xhr.status === 201) { onProgress?.(100); resolve({ ok: true, chapter: data.chapter }); return; }
      if (xhr.status === 413) { resolve({ ok: false, reason: UPLOAD_REASONS.file_too_large }); return; }
      resolve({ ok: false, reason: UPLOAD_REASONS[data.error ?? ''] ?? `Не получилось (${xhr.status})` });
    };
    xhr.onerror = () => resolve({ ok: false, reason: 'Нет связи с сервером' });
    xhr.onabort = () => resolve({ ok: false, reason: 'Загрузка отменена' });
    xhr.send(file);
  });

  return { promise, cancel: () => xhr.abort() };
};

export const apiUploadCover = async (bookId: string, file: Blob) => {
  const r = await apiCall(`/api/books/book/${encodeURIComponent(bookId)}/cover`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
  return r.ok;
};

/* ─── Мелочи ───────────────────────────────────────────────────────── */

export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
};

export const fmtAudioDuration = (sec: number) => {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин`;
};

export const fmtWords = (n: number) => {
  if (n < 1000) return `${n} слов`;
  return `${Math.round(n / 100) / 10}к слов`;
};
