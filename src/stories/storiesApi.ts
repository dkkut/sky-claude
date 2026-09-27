/* ===============================================================
   STORIES — разговор с сервером (server/stories.mjs).

   Ничего здесь не решается: кто автор, кому видна история, кто в
   «Близких друзьях» — решает только сервер. Этот файл только зовёт ручки.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export type StoryKind = 'text' | 'photo' | 'video';
export type StoryVisibility = 'all' | 'closeFriends';

export interface StoryPollOption { id: string; label: string; votes: string[]; }
export interface StoryPoll { question: string; options: StoryPollOption[]; }

export interface StoryQuestionAnswer {
  id: string; userId: string; userName: string; text: string; createdAt: number;
}
export interface StoryQuestion { prompt: string; answers: StoryQuestionAnswer[]; }

export interface StoryViewer { userId: string; userName: string; userAvatar?: string; }

export interface Story {
  id: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorAvatar?: string;
  kind: StoryKind;
  mediaUrl?: string;
  text?: string;
  bg: string;
  duration: number;
  createdAt: number;
  expiresAt: number;
  viewed: boolean;
  likes: string[];
  views: number;
  viewedBy?: StoryViewer[];
  visibility: StoryVisibility;
  mentions: string[];
  musicTrackId?: string;
  location?: string;
  poll?: StoryPoll;
  question?: StoryQuestion;
}

export const apiStoriesFeed = async (): Promise<Story[]> => {
  const r = await apiCall<{ stories: Story[] }>('/api/stories/feed');
  return r.ok ? r.data?.stories ?? [] : [];
};

export const apiStoriesArchive = async (): Promise<Story[]> => {
  const r = await apiCall<{ stories: Story[] }>('/api/stories/archive');
  return r.ok ? r.data?.stories ?? [] : [];
};

export const apiStoriesByAuthor = async (authorId: string): Promise<Story[]> => {
  const r = await apiCall<{ stories: Story[] }>(`/api/stories/author/${encodeURIComponent(authorId)}`);
  return r.ok ? r.data?.stories ?? [] : [];
};

export const apiStoryGet = async (storyId: string): Promise<Story | null> => {
  const r = await apiCall<{ story: Story }>(`/api/stories/${storyId}`);
  return r.ok ? r.data?.story ?? null : null;
};

export interface UploadedStoryMedia { mediaId: string; mime: string; kind: 'image' | 'video'; bytes: number; }
export const apiStoriesUploadMedia = async (file: File): Promise<UploadedStoryMedia | null> => {
  const r = await apiCall<UploadedStoryMedia>('/api/stories/media', {
    method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  return r.ok ? r.data ?? null : null;
};

export interface CreateStoryInput {
  text?: string;
  mediaId?: string;
  mediaMime?: string;
  bg?: string;
  duration?: number;
  visibility?: StoryVisibility;
  mentions?: string[];
  musicTrackId?: string;
  location?: string;
  poll?: { question: string; options: string[] };
  question?: { prompt: string };
}
export const apiStoriesCreate = async (input: CreateStoryInput): Promise<{ id: string } | { error: string }> => {
  const r = await apiCall<{ id: string }>('/api/stories', { method: 'POST', body: JSON.stringify(input) });
  return r.ok && r.data ? r.data : { error: r.error ?? 'failed' };
};

export const apiStoriesDelete = async (storyId: string): Promise<boolean> => {
  const r = await apiCall(`/api/stories/${storyId}`, { method: 'DELETE' });
  return r.ok;
};

export const apiStoriesLike = async (storyId: string): Promise<boolean | null> => {
  const r = await apiCall<{ liked: boolean }>(`/api/stories/${storyId}/like`, { method: 'POST' });
  return r.ok ? r.data?.liked ?? null : null;
};

export const apiStoriesView = async (storyId: string): Promise<void> => {
  await apiCall(`/api/stories/${storyId}/view`, { method: 'POST' });
};

export const apiStoriesVote = async (storyId: string, optionId: string): Promise<boolean> => {
  const r = await apiCall(`/api/stories/${storyId}/vote`, { method: 'POST', body: JSON.stringify({ optionId }) });
  return r.ok;
};

export const apiStoriesAnswer = async (storyId: string, text: string): Promise<{ id: string } | null> => {
  const r = await apiCall<{ id: string }>(`/api/stories/${storyId}/answer`, {
    method: 'POST', body: JSON.stringify({ text }),
  });
  return r.ok ? r.data ?? null : null;
};

export const apiStoriesCloseFriends = async (): Promise<string[]> => {
  const r = await apiCall<{ friendIds: string[] }>('/api/stories/close-friends');
  return r.ok ? r.data?.friendIds ?? [] : [];
};

export const apiStoriesSetCloseFriends = async (friendIds: string[]): Promise<string[]> => {
  const r = await apiCall<{ ok: true; friendIds: string[] }>('/api/stories/close-friends', {
    method: 'POST', body: JSON.stringify({ friendIds }),
  });
  return r.ok ? r.data?.friendIds ?? [] : [];
};
