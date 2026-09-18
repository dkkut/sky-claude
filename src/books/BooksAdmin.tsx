/**
 * Проверка книг: очередь заявок и решение по каждой.
 *
 * То же устройство, что у проверки подкастов: очередь отдаёт сервер и
 * только администратору с правом content, а первую главу можно
 * прочитать не уходя с экрана — решать судьбу книги, не открыв ни
 * одной страницы, было бы штампом, а не проверкой.
 */
import { useState, useEffect, useCallback } from 'react';
import { Loader2, ShieldCheck, Check, BookOpen, Headphones, Clock } from 'lucide-react';
import {
  apiModerationQueue, apiModerate, apiChapters, apiChapter,
  bookCoverUrl, fmtWords, fmtAudioDuration,
  type Book, type ChapterMeta,
} from './booksApi';

const C = {
  l1: 'var(--bg-l1)', border: 'var(--border)',
  t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
  purple: '#a855f7', purpleSoft: 'rgba(168,85,247,0.16)',
};

const glass = {
  background: 'rgba(255,255,255,0.045)',
  backdropFilter: 'blur(18px) saturate(150%)',
  WebkitBackdropFilter: 'blur(18px) saturate(150%)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const Cover = ({ b }: { b: Book }) => (
  <div className="relative w-full overflow-hidden rounded-2xl"
    style={{ aspectRatio: '2 / 3', background: `linear-gradient(140deg, ${b.accent}, rgba(0,0,0,0.55))` }}>
    {b.hasCover
      ? <img src={bookCoverUrl(b.id)} alt="" loading="lazy" className="h-full w-full object-cover"/>
      : <div className="grid h-full w-full place-items-center"><BookOpen size={22} className="text-white/75"/></div>}
  </div>
);

/** Первая глава заявки, прямо в очереди — прочитать перед решением. */
const FirstChapter = ({ meta }: { meta: ChapterMeta }) => {
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void apiChapter(meta.id).then((c) => { if (alive) setContent(c?.content ?? ''); });
    return () => { alive = false; };
  }, [meta.id]);

  return (
    <div className="mt-2 rounded-xl p-3" style={{ background: C.l1 }}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px]" style={{ color: C.t3 }}>
        <span>{meta.number}. {meta.title || `Глава ${meta.number}`}</span>
        {meta.hasText && <span className="flex items-center gap-1"><BookOpen size={11}/>{fmtWords(meta.wordCount)}</span>}
        {meta.hasAudio && <span className="flex items-center gap-1"><Headphones size={11}/>{fmtAudioDuration(meta.audioSeconds)}</span>}
      </div>
      {content === null ? (
        <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }}/>
      ) : content ? (
        <p className="line-clamp-6 text-[12px] leading-relaxed" style={{ color: C.t2 }}>{content}</p>
      ) : (
        <p className="text-[12px]" style={{ color: C.t3 }}>У этой главы нет текста — только озвучка.</p>
      )}
    </div>
  );
};

export const BookModeration = () => {
  const [queue, setQueue] = useState<Book[] | null>(null);
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Record<string, ChapterMeta[]>>({});

  const load = useCallback(async () => { setQueue(await apiModerationQueue()); }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    await apiModerate(id, approve, approve ? undefined : reason.trim());
    setBusy(''); setRejecting(null); setReason('');
    await load();
  };

  const toggleChapters = async (b: Book) => {
    if (chapters[b.id]) { setChapters({ ...chapters, [b.id]: [] }); return; }
    setChapters({ ...chapters, [b.id]: (await apiChapters(b.id)) ?? [] });
  };

  if (queue === null) {
    return <div className="py-8 text-center"><Loader2 size={20} className="inline animate-spin" style={{ color: C.t3 }}/></div>;
  }

  return (
    <div className="pb-8">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={16} style={{ color: C.purple }}/>
        <h3 className="text-[14px] font-bold" style={{ color: C.t1 }}>Книги на проверке</h3>
        {queue.length > 0 && (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: C.purpleSoft, color: C.purple }}>{queue.length}</span>
        )}
      </div>

      {queue.length === 0 && (
        <p className="py-8 text-center text-sm leading-relaxed" style={{ color: C.t3 }}>
          Заявок нет.<br/>
          Книга попадает сюда, когда автор отправляет её на проверку из Sky Studio.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {queue.map((b) => (
          <div key={b.id} data-moderation-card={b.id} className="rounded-2xl p-3" style={glass}>
            <div className="flex gap-3">
              <div className="w-16 shrink-0"><Cover b={b}/></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold" style={{ color: C.t1 }}>{b.title}</div>
                <div className="text-[11px]" style={{ color: C.t3 }}>
                  {b.category} · {b.chapters} гл. · {b.authorName ?? 'Sky'}
                </div>
                {b.description && (
                  <p className="mt-1 line-clamp-3 text-[12px] leading-snug" style={{ color: C.t2 }}>{b.description}</p>
                )}
                {b.explicit && (
                  <span className="mt-1 inline-block rounded-md px-1.5 py-0.5 text-[10px]"
                    style={{ background: C.l1, color: '#f59e0b' }}>18+</span>
                )}
              </div>
            </div>

            <button onClick={() => toggleChapters(b)} className="mt-2 flex items-center gap-1 text-[11px]" style={{ color: C.purple }}>
              <Clock size={11}/>{chapters[b.id]?.length ? 'Свернуть главы' : 'Посмотреть главы'}
            </button>
            {(chapters[b.id]?.length ?? 0) > 0 && (
              <FirstChapter meta={chapters[b.id][0]}/>
            )}

            {rejecting === b.id ? (
              <div className="mt-2 flex flex-col gap-2">
                <input value={reason} onChange={(ev) => setReason(ev.target.value)}
                  placeholder="Причина отказа — её увидит автор"
                  className="rounded-xl px-3 py-2 text-[12px] outline-none"
                  style={{ background: C.l1, color: C.t1 }}/>
                <div className="flex gap-2">
                  <button onClick={() => decide(b.id, false)} disabled={busy === b.id}
                    className="rounded-xl px-3 py-1.5 text-[12px]" style={{ background: '#ef4444', color: '#fff' }}>
                    Отклонить
                  </button>
                  <button onClick={() => { setRejecting(null); setReason(''); }}
                    className="rounded-xl px-3 py-1.5 text-[12px]" style={{ background: C.l1, color: C.t2 }}>
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button onClick={() => decide(b.id, true)} disabled={busy === b.id}
                  className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] font-semibold"
                  style={{ background: '#22c55e', color: '#fff' }}>
                  {busy === b.id ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>}
                  Опубликовать
                </button>
                <button onClick={() => setRejecting(b.id)}
                  className="rounded-xl px-3 py-1.5 text-[12px]" style={{ background: C.l1, color: C.t2 }}>
                  Отклонить
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BookModeration;
