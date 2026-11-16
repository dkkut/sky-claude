/* ===============================================================
   BLOOM — разговор с сервером (server/bloom.mjs).

   Ничего здесь не решается: кто автор, что можно удалить, сколько
   стоит подарок — решает только сервер. Этот файл только зовёт ручки.
=============================================================== */
import { apiCall } from '@/core/auth/api';
import type { BloomPost, BloomComment, ReactionKey, FeedTab } from './store';

export const apiBloomFeed = async (tab: FeedTab, tag?: string | null): Promise<BloomPost[]> => {
  const q = new URLSearchParams({ tab });
  if (tag) q.set('tag', tag);
  const r = await apiCall<{ posts: BloomPost[] }>(`/api/bloom/feed?${q.toString()}`);
  return r.ok ? r.data?.posts ?? [] : [];
};

/** Посты конкретного автора — для карточки его профиля в общем вьюере. */
export const apiBloomAuthorPosts = async (userId: string): Promise<BloomPost[]> => {
  const r = await apiCall<{ posts: BloomPost[] }>(`/api/bloom/author/${encodeURIComponent(userId)}`);
  return r.ok ? r.data?.posts ?? [] : [];
};

export const apiBloomTrending = async (): Promise<string[][]> => {
  const r = await apiCall<{ trending: string[][] }>('/api/bloom/trending');
  return r.ok ? r.data?.trending ?? [] : [];
};

export const apiBloomSuggested = async (): Promise<string[]> => {
  const r = await apiCall<{ userIds: string[] }>('/api/bloom/suggested');
  return r.ok ? r.data?.userIds ?? [] : [];
};

export const apiBloomHotComments = async (): Promise<{ post: BloomPost; comment: BloomComment }[]> => {
  const r = await apiCall<{ items: { post: BloomPost; comment: BloomComment }[] }>('/api/bloom/hot-comments');
  return r.ok ? r.data?.items ?? [] : [];
};

export const apiBloomNotifCount = async (): Promise<number> => {
  const r = await apiCall<{ count: number }>('/api/bloom/notifications-count');
  return r.ok ? r.data?.count ?? 0 : 0;
};

export interface UploadedMedia { mediaId: string; mime: string; kind: 'image' | 'video'; bytes: number; }
export const apiBloomUploadMedia = async (file: File): Promise<UploadedMedia | null> => {
  const r = await apiCall<UploadedMedia>('/api/bloom/media', {
    method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  return r.ok ? r.data ?? null : null;
};

export interface CreatePostInput {
  text: string;
  mediaId?: string;
  mediaMime?: string;
  mediaAspect?: number;
  tags?: string[];
  location?: string;
  poll?: { question: string; options: string[] };
  isBlog?: boolean; title?: string; isAd?: boolean; adNote?: string;
}
export const apiBloomCreatePost = async (input: CreatePostInput): Promise<{ id: string } | { error: string }> => {
  const r = await apiCall<{ id: string }>('/api/bloom/post', { method: 'POST', body: JSON.stringify(input) });
  return r.ok && r.data ? r.data : { error: r.error ?? 'failed' };
};

export const apiBloomGetPost = async (postId: string): Promise<BloomPost | null> => {
  const r = await apiCall<{ post: BloomPost }>(`/api/bloom/post/${postId}`);
  return r.ok ? r.data?.post ?? null : null;
};

export const apiBloomDeletePost = async (postId: string): Promise<boolean> => {
  const r = await apiCall(`/api/bloom/post/${postId}`, { method: 'DELETE' });
  return r.ok;
};

export const apiBloomReact = async (postId: string, emoji: ReactionKey): Promise<boolean | null> => {
  const r = await apiCall<{ reacted: boolean }>(`/api/bloom/post/${postId}/react`, {
    method: 'POST', body: JSON.stringify({ emoji }),
  });
  return r.ok ? r.data?.reacted ?? null : null;
};

export const apiBloomComment = async (postId: string, text: string): Promise<{ id: string } | null> => {
  const r = await apiCall<{ id: string }>(`/api/bloom/post/${postId}/comment`, {
    method: 'POST', body: JSON.stringify({ text }),
  });
  return r.ok ? r.data ?? null : null;
};

export const apiBloomDeleteComment = async (commentId: string): Promise<boolean> => {
  const r = await apiCall(`/api/bloom/comment/${commentId}`, { method: 'DELETE' });
  return r.ok;
};

export const apiBloomLikeComment = async (commentId: string): Promise<boolean | null> => {
  const r = await apiCall<{ liked: boolean }>(`/api/bloom/comment/${commentId}/like`, { method: 'POST' });
  return r.ok ? r.data?.liked ?? null : null;
};

export const apiBloomToggleSave = async (postId: string): Promise<boolean | null> => {
  const r = await apiCall<{ saved: boolean }>(`/api/bloom/post/${postId}/save`, { method: 'POST' });
  return r.ok ? r.data?.saved ?? null : null;
};

export const apiBloomRepost = async (postId: string): Promise<boolean | null> => {
  const r = await apiCall<{ reposted: boolean }>(`/api/bloom/post/${postId}/repost`, { method: 'POST' });
  return r.ok ? r.data?.reposted ?? null : null;
};

export const apiBloomView = async (postId: string): Promise<void> => {
  await apiCall(`/api/bloom/post/${postId}/view`, { method: 'POST' });
};

export const apiBloomVote = async (postId: string, optionId: string): Promise<boolean> => {
  const r = await apiCall(`/api/bloom/post/${postId}/vote`, { method: 'POST', body: JSON.stringify({ optionId }) });
  return r.ok;
};

export const apiBloomGift = async (postId: string, modelKey: string): Promise<{ ok: true } | { error: string }> => {
  const r = await apiCall<{ ok: true }>(`/api/bloom/post/${postId}/gift`, {
    method: 'POST', body: JSON.stringify({ modelKey }),
  });
  return r.ok ? { ok: true } : { error: r.error ?? 'failed' };
};

export const apiBloomHidden = async (): Promise<string[]> => {
  const r = await apiCall<{ hiddenIds: string[] }>('/api/bloom/hidden');
  return r.ok ? r.data?.hiddenIds ?? [] : [];
};

export const apiBloomToggleHide = async (authorId: string): Promise<boolean | null> => {
  const r = await apiCall<{ hidden: boolean }>(`/api/bloom/hide/${authorId}`, { method: 'POST' });
  return r.ok ? r.data?.hidden ?? null : null;
};

export interface BloomEvent {
  kind: 'like' | 'comment' | 'follow';
  actorId: string; actorName: string;
  postId?: string; text?: string; createdAt: string;
}
/** Реальные новые события (лайк/комментарий/подписка) — источник для
 *  push() в существующий useNotifStore (см. NotifBridge.tsx). */
export const apiBloomEvents = async (sinceMs: number): Promise<{ events: BloomEvent[]; now: number }> => {
  const r = await apiCall<{ events: BloomEvent[]; now: number }>(`/api/bloom/events?since=${sinceMs}`);
  return r.ok && r.data ? r.data : { events: [], now: Date.now() };
};

/** Bloom → «Написать» → открывает существующий чат Sky Messenger. */
export const apiBloomWrite = async (userId: string): Promise<{ chatId: string } | { error: string }> => {
  const r = await apiCall<{ chatId: string }>(`/api/bloom/write/${userId}`, { method: 'POST' });
  return r.ok && r.data ? r.data : { error: r.error ?? 'failed' };
};

/* ─── Админка: региональная доступность постов ────────────────────── */

export interface AdminBloomPost {
  id: string;
  authorId: string;
  authorName?: string;
  authorUsername?: string;
  text: string;
  kind: string;
  blockedRegions: string[];
  createdAt: string;
}

export const apiBloomAdminSearchPosts = async (q?: string): Promise<AdminBloomPost[]> => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const r = await apiCall<{ items: AdminBloomPost[] }>(`/api/bloom/admin/posts?${params}`);
  return r.ok ? r.data?.items ?? [] : [];
};

export const apiBloomSetPostRegions = async (postId: string, blockedRegions: string[], reason?: string) =>
  apiCall<{ ok: true; blockedRegions: string[] }>(`/api/bloom/post/${postId}/regions`, {
    method: 'POST', body: JSON.stringify({ blockedRegions, reason }),
  });

export const apiBloomEditPost = async (postId: string, patch: { text?: string; title?: string; isAd?: boolean; adNote?: string }): Promise<{ post: BloomPost } | { error: string }> => {
  const r = await apiCall<{ post: BloomPost }>(`/api/bloom/post/${postId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return r.ok && r.data ? r.data : { error: r.error ?? 'failed' };
};
