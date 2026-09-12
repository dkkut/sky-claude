/**
 * Проверка подкастов: очередь заявок и решение по каждой.
 *
 * Живёт отдельным файлом, потому что показывается в двух местах: в
 * самих подкастах — тем, кто уже там, — и в общей админ-панели, где
 * администратор разбирает всё сразу и куда он идёт в первую очередь.
 * Панель одна и та же: два похожих экрана с одинаковыми кнопками
 * однажды разъезжаются, и один из них начинает врать.
 *
 * Очередь отдаёт сервер и только администратору. Проверка прав здесь
 * не дублируется: обычному человеку ручка отвечает отказом, и пустой
 * список — это не «мы спрятали», а «сервер не дал».
 *
 * Выпуски можно послушать не уходя с экрана: решать судьбу передачи,
 * не открыв ни одного выпуска, — это не проверка, а штамп.
 */
import { useState, useEffect, useCallback } from 'react';
import { Loader2, ShieldCheck, Check, Mic, Headphones, Play, Clock, Video } from 'lucide-react';
import { usePlayer } from './playerStore';
import {
  apiModerationQueue, apiModerate, apiEpisodes,
  showCoverUrl, epCoverUrl, fmtDuration,
  type Podcast, type Episode,
} from './podcastApi';

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

const Cover = ({ p }: { p: Podcast }) => (
  <div className="relative w-full overflow-hidden rounded-2xl"
    style={{ aspectRatio: '1 / 1', background: `linear-gradient(140deg, ${p.accent}, rgba(0,0,0,0.55))` }}>
    {p.hasCover
      ? <img src={showCoverUrl(p.id)} alt="" loading="lazy" className="h-full w-full object-cover"/>
      : <div className="grid h-full w-full place-items-center"><Mic size={22} className="text-white/75"/></div>}
  </div>
);

/** Строка выпуска в заявке: послушать до решения. */
const Row = ({ e, onPlay }: { e: Episode; onPlay: (mode?: 'audio' | 'video') => void }) => {
  const nowId = usePlayer((s) => s.episode?.id);
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5"
      style={{ background: nowId === e.id ? C.purpleSoft : 'transparent' }}>
      <button onClick={() => onPlay()} className="relative shrink-0" aria-label={`Послушать: ${e.title}`}>
        <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-lg"
          style={{ background: e.accent ?? C.purple }}>
          {e.hasCover
            ? <img src={epCoverUrl(e.id)} alt="" loading="lazy" className="h-full w-full object-cover"/>
            : <Headphones size={14} className="text-white/75"/>}
        </span>
        <span className="absolute inset-0 grid place-items-center rounded-lg" style={{ background: 'rgba(0,0,0,0.34)' }}>
          <Play size={12} className="ml-0.5 text-white" fill="#fff"/>
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px]" style={{ color: C.t1 }}>
          {e.number ? `${e.number}. ` : ''}{e.title}
        </div>
        <div className="flex items-center gap-2 text-[10.5px]" style={{ color: C.t3 }}>
          <span className="flex items-center gap-1"><Clock size={10}/>{fmtDuration(e.duration)}</span>
          {e.hasVideo && (
            <button onClick={() => onPlay('video')} className="flex items-center gap-1"
              style={{ color: C.t2 }}>
              <Video size={10}/>смотреть
            </button>
          )}
          {!e.hasAudio && !e.hasVideo && <span style={{ color: '#f59e0b' }}>без файла</span>}
        </div>
      </div>
    </div>
  );
};

export const PodcastModeration = () => {
  const [queue, setQueue] = useState<Podcast[] | null>(null);
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<Record<string, Episode[]>>({});
  const play = usePlayer((s) => s.play);

  const load = useCallback(async () => { setQueue(await apiModerationQueue()); }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    await apiModerate(id, approve, approve ? undefined : reason.trim());
    setBusy(''); setRejecting(null); setReason('');
    await load();
  };

  const toggleEpisodes = async (p: Podcast) => {
    if (episodes[p.id]) { setEpisodes({ ...episodes, [p.id]: [] }); return; }
    setEpisodes({ ...episodes, [p.id]: (await apiEpisodes(p.id, { limit: 50 })) ?? [] });
  };

  if (queue === null) {
    return <div className="py-8 text-center"><Loader2 size={20} className="inline animate-spin" style={{ color: C.t3 }}/></div>;
  }

  return (
    <div className="pb-8">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={16} style={{ color: C.purple }}/>
        <h3 className="text-[14px] font-bold" style={{ color: C.t1 }}>Подкасты на проверке</h3>
        {queue.length > 0 && (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: C.purpleSoft, color: C.purple }}>{queue.length}</span>
        )}
      </div>

      {queue.length === 0 && (
        <p className="py-8 text-center text-sm leading-relaxed" style={{ color: C.t3 }}>
          Заявок нет.<br/>
          Передача попадает сюда, когда автор отправляет её на проверку из своей студии.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {queue.map((p) => (
          // Признак с идентификатором — чтобы проверка работала именно с
          // нужной заявкой, а не с первой попавшейся: в очереди их много.
          <div key={p.id} data-moderation-card={p.id} className="rounded-2xl p-3" style={glass}>
            <div className="flex gap-3">
              <div className="w-16 shrink-0"><Cover p={p}/></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold" style={{ color: C.t1 }}>{p.title}</div>
                <div className="text-[11px]" style={{ color: C.t3 }}>
                  {p.category} · {p.episodes} вып.
                  {p.hosts?.length ? ` · ${p.hosts.map((h) => h.name).join(', ')}` : ''}
                </div>
                {p.description && (
                  <p className="mt-1 line-clamp-3 text-[12px] leading-snug" style={{ color: C.t2 }}>{p.description}</p>
                )}
                {p.explicit && (
                  <span className="mt-1 inline-block rounded-md px-1.5 py-0.5 text-[10px]"
                    style={{ background: C.l1, color: '#f59e0b' }}>18+</span>
                )}
              </div>
            </div>

            <button onClick={() => toggleEpisodes(p)} className="mt-2 text-[11px]" style={{ color: C.purple }}>
              {episodes[p.id]?.length ? 'Свернуть выпуски' : 'Послушать выпуски'}
            </button>
            {episodes[p.id]?.map((e) => (
              <Row key={e.id} e={e}
                onPlay={(mode) => void play({ ...e, podcastTitle: p.title, accent: p.accent }, { mode })}/>
            ))}

            {rejecting === p.id ? (
              <div className="mt-2 flex flex-col gap-2">
                <input value={reason} onChange={(ev) => setReason(ev.target.value)}
                  placeholder="Причина отказа — её увидит автор"
                  className="rounded-xl px-3 py-2 text-[12px] outline-none"
                  style={{ background: C.l1, color: C.t1 }}/>
                <div className="flex gap-2">
                  <button onClick={() => decide(p.id, false)} disabled={busy === p.id}
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
                <button onClick={() => decide(p.id, true)} disabled={busy === p.id}
                  className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] font-semibold"
                  style={{ background: '#22c55e', color: '#fff' }}>
                  {busy === p.id ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>}
                  Опубликовать
                </button>
                <button onClick={() => setRejecting(p.id)}
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

export default PodcastModeration;
