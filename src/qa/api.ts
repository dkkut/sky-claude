import { apiCall } from '@/core/auth/api';

export interface QaAuthor { id: string; name: string; username: string; rep?: number }
export interface QaQuestion { id: string; title: string; body: string; tags: string[]; answers: number; views: number; createdAt: string; hasBest: boolean; mine: boolean; author: QaAuthor }
export interface QaAnswer { id: string; body: string; score: number; createdAt: string; mine: boolean; myVote: number; best: boolean; author: QaAuthor }
export type QaSort = 'new' | 'unanswered' | 'top';

const qs = (o: Record<string, string | number | undefined>) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
const post = (path: string, b: unknown) => apiCall<{ ok?: boolean; id?: string; score?: number; myVote?: number }>(path, { method: 'POST', body: JSON.stringify(b) });

export const qaApi = {
  list: (p: { sort?: QaSort; q?: string; tag?: string; mine?: boolean; offset?: number }) =>
    apiCall<{ items: QaQuestion[]; hasMore: boolean }>(`/api/qa/questions?${qs({ sort: p.sort, q: p.q, tag: p.tag, mine: p.mine ? 1 : undefined, offset: p.offset })}`),
  tags: () => apiCall<{ tags: { tag: string; n: number }[] }>('/api/qa/tags'),
  me: () => apiCall<{ reputation: number }>('/api/qa/me'),
  get: (id: string) => apiCall<{ question: QaQuestion; answers: QaAnswer[] }>(`/api/qa/questions/${id}`),
  ask: (b: { title: string; body: string; tags: string[] }) => post('/api/qa/questions', b),
  answer: (id: string, body: string) => post(`/api/qa/questions/${id}/answers`, { body }),
  vote: (aid: string, value: number) => post(`/api/qa/answers/${aid}/vote`, { value }),
  accept: (id: string, answerId: string) => post(`/api/qa/questions/${id}/accept`, { answerId }),
  unaccept: (id: string) => post(`/api/qa/questions/${id}/unaccept`, {}),
  removeQuestion: (id: string) => apiCall<{ ok?: boolean }>(`/api/qa/questions/${id}`, { method: 'DELETE' }),
  removeAnswer: (id: string) => apiCall<{ ok?: boolean }>(`/api/qa/answers/${id}`, { method: 'DELETE' }),
  report: (kind: 'question' | 'answer', id: string, reason: string) => post('/api/qa/report', { kind, id, reason }),
};
