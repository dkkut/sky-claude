/** Отметки верификации: «Подтверждено» и «Официальный». Данные — с сервера (`/api/verification/marks`), показ — только то, что он подтвердил. */
import { useEffect } from 'react';
import { create } from 'zustand';
import { BadgeCheck } from 'lucide-react';
import { apiCall } from '@/core/auth/api';

export type MarkType = 'user' | 'chat_group' | 'chat_channel' | 'video_channel';
type Mark = 'verified' | 'official' | null;

interface MarksState { marks: Record<string, { mark: Mark; at: number }>; version: number }
const TTL = 5 * 60_000;
const useStore = create<MarksState>(() => ({ marks: {}, version: 0 }));
const key = (t: string, id: string) => `${t}:${id}`;

const pending: Record<string, Set<string>> = {};
let timer: number | null = null;
const flush = () => {
  timer = null;
  for (const [type, ids] of Object.entries(pending)) {
    const list = [...ids]; ids.clear();
    if (!list.length) continue;
    for (let i = 0; i < list.length; i += 100) {
      const part = list.slice(i, i + 100);
      void apiCall<{ marks: Record<string, 'verified' | 'official'> }>(`/api/verification/marks?type=${type}&ids=${part.map(encodeURIComponent).join(',')}`).then((r) => {
        const got = r.ok ? (r.data?.marks ?? {}) : null;
        if (!got) return;
        const now = Date.now();
        useStore.setState((s) => {
          const next = { ...s.marks };
          for (const id of part) next[key(type, id)] = { mark: got[id] ?? null, at: now };
          return { marks: next, version: s.version + 1 };
        });
      });
    }
  }
};
/** Запросить отметки для списка (собираются в один запрос). */
export const ensureMarks = (type: MarkType, ids: (string | undefined)[]) => {
  const now = Date.now();
  const marks = useStore.getState().marks;
  for (const id of ids) {
    if (!id) continue;
    const c = marks[key(type, id)];
    if (c && now - c.at < TTL) continue;
    (pending[type] ??= new Set()).add(id);
  }
  if (!timer && Object.values(pending).some((s) => s.size)) timer = window.setTimeout(flush, 40);
};

export const useMark = (type: MarkType, id?: string): Mark => {
  const mark = useStore((s) => (id ? s.marks[key(type, id)]?.mark ?? null : null));
  useEffect(() => { ensureMarks(type, [id]); }, [type, id]);
  return mark;
};

/** Все отметки — синие, одним цветом (в любой теме и при любом акценте); различаются подсказкой. */
export const MARK_BLUE = '#1d9bf0';

export const markLabel = (m: 'verified' | 'official') => (m === 'official' ? 'Официальный аккаунт Sky' : 'Подтверждено Sky');

/** Значок рядом с именем. Ничего не рисует без подтверждения сервера. */
export const VerifiedBadge = ({ type, id, size = 14 }: { type: MarkType; id?: string; size?: number }) => {
  const m = useMark(type, id);
  if (!m) return null;
  return (
    <span title={markLabel(m)} aria-label={markLabel(m)} role="img" data-verified-mark={m}
      className="ml-1 inline-flex shrink-0 translate-y-[1px] align-middle" style={{ color: MARK_BLUE }}>
      <BadgeCheck size={size} />
    </span>
  );
};
