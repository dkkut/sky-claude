/* ===========================================================
   SKY PODCASTS

   Было: четыре передачи и восемь выпусков, записанных прямо в коде
   экрана, и setInterval вместо звука — элемента <audio> в модуле не
   существовало вовсе. Полоса двигалась, слушать было нечего.
   Подписки и позиция жили в состоянии компонента и пропадали при
   уходе с экрана.

   Стало: каталог с сервера, настоящие файлы, расшифровка, пересказ по
   расшифровке и позиция, одинаковая на телефоне и на компьютере.

   Про честность состояний. Передача без выпусков не прячется и не
   притворяется полной — о ней так и написано. Пересказ, которого нет,
   не подменяется выдумкой: сказано, почему его нет.
=========================================================== */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Mic, Search, X, Play, Plus, Heart, Bell, BellRing, ChevronLeft, ChevronRight,
  Headphones, Video, Loader2, Upload, Image as ImageIcon, FileText, Send,
  Trash2, Clock, Sparkles, PenLine, Users,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { usePlayer, prefersReducedMotion } from './playerStore';
import { parseSubtitles } from './subtitles';
import { PodcastModeration } from './PodcastsAdmin';
import {
  ACCEPT_AUDIO, ACCEPT_VIDEO, ACCEPT_IMAGE, ACCEPT_SUBTITLES,
} from '@/shared/fileAccept';
import {
  apiCatalog, apiCategories, apiSearch, apiMine, apiPodcast, apiEpisodes,
  apiSubscriptions, apiSetSubscribed, apiFavorites, apiSetFavorite,
  apiContinue, apiNewFromSubscriptions, apiHistory,
  apiCreatePodcast, apiPatchPodcast, apiDeletePodcast, apiSubmitPodcast,
  apiCreateEpisode, apiPatchEpisode, apiDeleteEpisode,
  apiUploadMedia, apiUploadCover, apiSaveTranscript,
  apiMediaTicket,
  showCoverUrl, epCoverUrl, fmtDuration,
  type Podcast, type Episode,
} from './podcastApi';

const C = {
  bg: 'var(--bg)', l1: 'var(--bg-l1)', l2: 'var(--bg-l2)',
  border: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
  purple: '#a855f7', purpleSoft: 'rgba(168,85,247,0.16)', blue: '#4f6ef7',
};

const CATEGORIES = [
  'Технологии', 'Бизнес', 'Наука', 'Культура', 'Общество',
  'Игры', 'Дизайн', 'Здоровье', 'История', 'Спорт', 'Другое',
];

/* ─── Небо за содержимым ───────────────────────────────────────────── */

const Sky = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden">
    <div className="absolute -top-32 -left-16 h-80 w-80 rounded-full"
      style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.20), transparent 70%)' }}/>
    <div className="absolute top-40 -right-24 h-80 w-80 rounded-full"
      style={{ background: 'radial-gradient(circle, rgba(79,110,247,0.16), transparent 70%)' }}/>
    <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full"
      style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.10), transparent 70%)' }}/>
  </div>
);

/** Стекло: общая подложка карточек и панелей. */
const glass = {
  background: 'rgba(255,255,255,0.045)',
  backdropFilter: 'blur(18px) saturate(150%)',
  WebkitBackdropFilter: 'blur(18px) saturate(150%)',
  border: '1px solid rgba(255,255,255,0.08)',
};

/* ─── Обложки ──────────────────────────────────────────────────────── */

const ShowCover = ({ p, size = 'lg' }: { p: Podcast; size?: 'sm' | 'lg' }) => (
  <div className="relative w-full overflow-hidden rounded-2xl"
    style={{ aspectRatio: '1 / 1', background: `linear-gradient(140deg, ${p.accent}, rgba(0,0,0,0.55))` }}>
    {p.hasCover
      ? <img src={showCoverUrl(p.id)} alt="" loading="lazy" className="h-full w-full object-cover"/>
      : (
        <div className="grid h-full w-full place-items-center">
          <Mic size={size === 'lg' ? 34 : 22} className="text-white/75"/>
        </div>
      )}
  </div>
);

const EpisodeCover = ({ e, size = 56 }: { e: Episode; size?: number }) => (
  <div className="relative shrink-0 overflow-hidden rounded-xl"
    style={{ width: size, height: size, background: e.accent ?? C.purple }}>
    {e.hasCover
      ? <img src={epCoverUrl(e.id)} alt="" loading="lazy" className="h-full w-full object-cover"/>
      : <div className="grid h-full w-full place-items-center"><Headphones size={size * 0.34} className="text-white/75"/></div>}
  </div>
);

/* ─── Строка выпуска ───────────────────────────────────────────────── */

const EpisodeRow = ({ e, onPlay }: { e: Episode; onPlay: (mode?: 'audio' | 'video') => void }) => {
  const current = usePlayer((s) => s.episode?.id);
  const playing = usePlayer((s) => s.playing);
  const isNow = current === e.id;
  const left = e.position && e.duration ? Math.max(0, e.duration - e.position) : 0;
  const pct = e.duration > 0 && e.position ? Math.min(100, (e.position / e.duration) * 100) : 0;

  return (
    <div className="flex items-start gap-3 rounded-2xl p-2.5 transition-colors"
      style={{ background: isNow ? C.purpleSoft : 'transparent' }}>
      <button onClick={() => onPlay()} className="relative shrink-0" aria-label={`Слушать: ${e.title}`}>
        <EpisodeCover e={e}/>
        <span className="absolute inset-0 grid place-items-center rounded-xl" style={{ background: 'rgba(0,0,0,0.34)' }}>
          <Play size={16} className="ml-0.5 text-white" fill="#fff"/>
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <button onClick={() => onPlay()} className="block w-full text-left">
          <div className="truncate text-[13.5px] font-semibold" style={{ color: isNow ? C.purple : C.t1 }}>
            {e.number ? <span style={{ color: C.t3 }}>{e.number}. </span> : null}{e.title}
          </div>
          {e.description && (
            <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug" style={{ color: C.t3 }}>{e.description}</div>
          )}
        </button>

        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: C.t3 }}>
          <span className="flex items-center gap-1"><Clock size={11}/>{fmtDuration(e.duration)}</span>
          {e.hasVideo && (
            <button onClick={() => onPlay('video')} className="flex items-center gap-1 rounded-md px-1.5 py-0.5"
              style={{ background: C.l1, color: C.t2 }}>
              <Video size={11}/>Смотреть
            </button>
          )}
          {e.hasTranscript && <span className="flex items-center gap-1"><FileText size={11}/>Расшифровка</span>}
          {e.hasSummary && <span className="flex items-center gap-1"><Sparkles size={11}/>Пересказ</span>}
          {e.completed && <span style={{ color: '#22c55e' }}>Прослушано</span>}
          {!e.completed && left > 0 && pct > 2 && <span>Осталось {fmtDuration(left)}</span>}
          {!e.published && <span style={{ color: '#f59e0b' }}>Черновик</span>}
        </div>

        {pct > 2 && !e.completed && (
          <div className="mt-1.5 h-[3px] overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: C.purple }}/>
          </div>
        )}
      </div>

      {isNow && playing && (
        <span className="mt-1 shrink-0 text-[10px] font-semibold" style={{ color: C.purple }}>Играет</span>
      )}
    </div>
  );
};

/* ─── Карточка передачи ────────────────────────────────────────────── */

const ShowCard = ({ p, onOpen }: { p: Podcast; onOpen: () => void }) => (
  <motion.button whileHover={prefersReducedMotion() ? undefined : { y: -3 }}
    whileTap={{ scale: 0.98 }} onClick={onOpen}
    className="flex flex-col gap-2 rounded-2xl p-2.5 text-left" style={glass}>
    <ShowCover p={p}/>
    <div className="min-w-0">
      <div className="truncate text-[13px] font-semibold" style={{ color: C.t1 }}>{p.title}</div>
      <div className="truncate text-[11px]" style={{ color: C.t3 }}>
        {p.hosts?.[0]?.name ?? p.category} · {p.episodes} вып.
      </div>
    </div>
  </motion.button>
);

/* ─── Главная ──────────────────────────────────────────────────────── */

const Rail = ({ title, children, action }: {
  title: string; children: React.ReactNode; action?: React.ReactNode;
}) => (
  <section className="mb-6">
    <div className="mb-2.5 flex items-center justify-between px-0.5">
      <h3 className="text-[14px] font-bold" style={{ color: C.t1 }}>{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

/* ─── Страница передачи ────────────────────────────────────────────── */

const ShowPage = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const [show, setShow] = useState<Podcast | null>(null);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const play = usePlayer((s) => s.play);

  const load = useCallback(async () => {
    const p = await apiPodcast(id);
    if (!p) { setNotFound(true); return; }
    setShow(p);
    setEpisodes(await apiEpisodes(id, { limit: 200 }));
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !episodes) return episodes ?? [];
    return episodes.filter((e) => e.title.toLowerCase().includes(needle));
  }, [episodes, q]);

  if (notFound) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <Mic size={34} style={{ color: C.t3, margin: '0 auto 12px' }}/>
          <p className="mb-3 text-sm" style={{ color: C.t3 }}>Такой передачи нет или она закрыта автором.</p>
          <button onClick={onBack} className="rounded-xl px-4 py-2 text-sm" style={{ background: C.l1, color: C.t2 }}>
            Назад
          </button>
        </div>
      </div>
    );
  }

  if (!show) {
    return <div className="grid h-full place-items-center"><Loader2 size={22} className="animate-spin" style={{ color: C.t3 }}/></div>;
  }

  const toggleSub = async () => {
    setBusy(true);
    const r = await apiSetSubscribed(show.id, !show.subscribed);
    setBusy(false);
    if (r) setShow({ ...show, subscribed: !show.subscribed });
  };

  const toggleFav = async () => {
    const r = await apiSetFavorite({ podcastId: show.id }, !show.favorite);
    if (r) setShow({ ...show, favorite: !show.favorite });
  };

  return (
    <div className="pb-28">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={onBack} aria-label="Назад"
          className="grid h-9 w-9 place-items-center rounded-full" style={{ background: C.l1 }}>
          <ChevronLeft size={18} style={{ color: C.t2 }}/>
        </button>
        <span className="truncate text-[12px]" style={{ color: C.t3 }}>{show.category}</span>
      </div>

      <div className="mb-5 flex gap-4">
        <div className="w-28 shrink-0 sm:w-36"><ShowCover p={show}/></div>
        <div className="min-w-0 flex-1">
          <h2 className="mb-1 text-[18px] font-bold leading-tight" style={{ color: C.t1 }}>{show.title}</h2>
          {show.hosts && show.hosts.length > 0 && (
            <p className="mb-1.5 flex items-center gap-1.5 text-[12px]" style={{ color: C.t2 }}>
              <Users size={12}/>{show.hosts.map((h) => h.name).join(', ')}
            </p>
          )}
          <p className="mb-3 text-[11px]" style={{ color: C.t3 }}>
            {show.episodes} выпусков · {show.subscribers} подписчиков
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={toggleSub} disabled={busy}
              className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-semibold"
              style={{ background: show.subscribed ? C.l1 : C.purple,
                color: show.subscribed ? C.t2 : '#fff' }}>
              {show.subscribed ? <BellRing size={13}/> : <Bell size={13}/>}
              {show.subscribed ? 'Вы подписаны' : 'Подписаться'}
            </button>
            <button onClick={toggleFav} aria-label="В избранное"
              className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: C.l1 }}>
              <Heart size={15} style={{ color: show.favorite ? '#ef4444' : C.t3 }}
                fill={show.favorite ? '#ef4444' : 'none'}/>
            </button>
          </div>
        </div>
      </div>

      {show.description && (
        <p className="mb-5 whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: C.t2 }}>
          {show.description}
        </p>
      )}

      {(episodes?.length ?? 0) > 6 && (
        <div className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2" style={glass}>
          <Search size={14} style={{ color: C.t3 }}/>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по выпускам"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ color: C.t1 }}/>
        </div>
      )}

      <h3 className="mb-1.5 px-0.5 text-[14px] font-bold" style={{ color: C.t1 }}>Выпуски</h3>
      {episodes === null && <div className="py-6 text-center"><Loader2 size={18} className="animate-spin inline" style={{ color: C.t3 }}/></div>}
      {episodes !== null && shown.length === 0 && (
        <p className="py-8 text-center text-sm leading-relaxed" style={{ color: C.t3 }}>
          {q ? 'Ничего не нашлось.' : 'Выпусков пока нет. Как только автор добавит первый, он появится здесь.'}
        </p>
      )}
      <div className="flex flex-col">
        {shown.map((e) => (
          <EpisodeRow key={e.id} e={e}
            onPlay={(mode) => void play({ ...e, podcastTitle: show.title, accent: show.accent }, { mode })}/>
        ))}
      </div>
    </div>
  );
};

/* ─── Студия автора ────────────────────────────────────────────────── */

const UploadRow = ({ label, hint, accept, onPick, progress, busy }: {
  label: string; hint: string; accept: string;
  onPick: (f: File) => void; progress?: number; busy?: boolean;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl p-2.5" style={{ background: C.l1 }}>
      <div className="flex items-center gap-2">
        <button onClick={() => ref.current?.click()} disabled={busy}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
          style={{ background: C.l2, color: C.t2, opacity: busy ? 0.6 : 1 }}>
          {busy ? <Loader2 size={12} className="animate-spin"/> : <Upload size={12}/>}{label}
        </button>
        <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: C.t3 }}>{hint}</span>
      </div>
      {typeof progress === 'number' && progress > 0 && progress < 100 && (
        <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
          <div className="h-full rounded-full" style={{ width: `${progress}%`, background: C.purple }}/>
        </div>
      )}
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }}/>
    </div>
  );
};

const EpisodeEditor = ({ e, onChanged }: { e: Episode; onChanged: () => void }) => {
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState<'' | 'audio' | 'video' | 'cover' | 'cues'>('');
  const [note, setNote] = useState<string | null>(null);

  /**
   * Длительность берём у самого файла, а не спрашиваем у автора: он
   * ошибётся, а полоса и «осталось» считаются по этому числу.
   *
   * Чем измерять — решает кнопка, на которую нажали, а не file.type.
   * У файла с незнакомым системе расширением тип пустой, и по нему
   * видеовыпуск измерялся бы звуковым элементом: длительность вышла бы
   * верной, а размер кадра потерялся.
   */
  const measure = (file: File, kind: 'audio' | 'video'):
  Promise<{ duration: number; width?: number; height?: number }> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const probe = document.createElement(kind) as HTMLVideoElement;
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        const out = {
          duration: Number.isFinite(probe.duration) ? Math.round(probe.duration) : 0,
          width: probe.videoWidth || undefined,
          height: probe.videoHeight || undefined,
        };
        URL.revokeObjectURL(url);
        resolve(out);
      };
      probe.onerror = () => { URL.revokeObjectURL(url); resolve({ duration: 0 }); };
      probe.src = url;
    });

  const upload = async (kind: 'audio' | 'video', file: File) => {
    setBusy(kind); setNote(null); setProgress(0);
    const meta = await measure(file, kind);
    const { promise } = apiUploadMedia(e.id, kind, file, meta, setProgress);
    const r = await promise;
    if (r.ok && meta.duration > 0) await apiPatchEpisode(e.id, { duration: meta.duration });
    setBusy(''); setProgress(0);
    setNote(r.ok ? null : r.reason ?? 'Не получилось');
    onChanged();
  };

  const uploadCues = async (file: File) => {
    setBusy('cues'); setNote(null);
    const text = await file.text();
    const cues = parseSubtitles(text);
    if (cues.length === 0) {
      setBusy('');
      setNote('В файле не нашлось ни одной строки с временем. Нужен WebVTT или SRT.');
      return;
    }
    const saved = await apiSaveTranscript(e.id, cues);
    setBusy('');
    setNote(saved === null ? 'Расшифровка не сохранилась'
      : `Расшифровка сохранена: строк ${saved}`);
    onChanged();
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      <UploadRow label="Звук" accept={ACCEPT_AUDIO} busy={busy === 'audio'} progress={busy === 'audio' ? progress : undefined}
        hint={e.hasAudio ? 'Загружен — можно заменить' : 'MP3, M4A, OGG, WAV или FLAC'}
        onPick={(f) => void upload('audio', f)}/>
      <UploadRow label="Видео" accept={ACCEPT_VIDEO} busy={busy === 'video'} progress={busy === 'video' ? progress : undefined}
        hint={e.hasVideo ? 'Загружено — можно заменить' : 'MP4, WebM или MOV — необязательно'}
        onPick={(f) => void upload('video', f)}/>
      <UploadRow label="Обложка" accept={ACCEPT_IMAGE} busy={busy === 'cover'}
        hint={e.hasCover ? 'Есть' : 'JPEG, PNG или WebP'}
        onPick={async (f) => {
          setBusy('cover');
          const ok = await apiUploadCover({ episodeId: e.id }, f);
          setBusy(''); setNote(ok ? null : 'Обложка не загрузилась'); onChanged();
        }}/>
      <UploadRow label="Расшифровка" accept={ACCEPT_SUBTITLES} busy={busy === 'cues'}
        hint={e.hasTranscript ? 'Есть — можно заменить' : 'Файл WebVTT или SRT'}
        onPick={(f) => void uploadCues(f)}/>

      {note && (
        <p className="px-1 text-[11px] leading-snug" style={{ color: note.startsWith('Расшифровка сохранена') ? '#22c55e' : '#f59e0b' }}>
          {note}
        </p>
      )}

      <div className="flex flex-wrap gap-2 px-1">
        <button onClick={async () => { await apiPatchEpisode(e.id, { published: !e.published }); onChanged(); }}
          className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: C.l1, color: C.t2 }}>
          {e.published ? 'Убрать из показа' : 'Показывать выпуск'}
        </button>
        <button onClick={async () => {
          if (!window.confirm(`Удалить выпуск «${e.title}»? Файлы тоже будут удалены.`)) return;
          await apiDeleteEpisode(e.id); onChanged();
        }}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px]"
        style={{ background: C.l1, color: '#ef4444' }}>
          <Trash2 size={11}/>Удалить
        </button>
      </div>
    </div>
  );
};

const ShowStudio = ({ p, onChanged }: { p: Podcast; onChanged: () => void }) => {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setEpisodes((await apiEpisodes(p.id, { limit: 200 })) ?? []);
  }, [p.id]);
  useEffect(() => { void load(); }, [load]);

  const addEpisode = async () => {
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    const next = episodes.reduce((m, e) => Math.max(m, e.number ?? 0), 0) + 1;
    const made = await apiCreateEpisode(p.id, { title: t, number: next });
    setBusy(false);
    if (made) { setTitle(''); setOpen(made.id); await load(); onChanged(); }
  };

  const submit = async () => {
    setNote(null);
    const r = await apiSubmitPodcast(p.id);
    setNote(r.ok ? 'Отправлено на проверку' : r.reason);
    onChanged();
  };

  const STATUS: Record<string, { text: string; color: string }> = {
    private: { text: 'Черновик — видите только вы', color: C.t3 },
    pending: { text: 'На проверке', color: '#f59e0b' },
    published: { text: 'Опубликовано', color: '#22c55e' },
    rejected: { text: 'Отклонено', color: '#ef4444' },
  };
  const st = STATUS[p.status] ?? STATUS.private;

  return (
    <div className="rounded-2xl p-3" style={glass}>
      <div className="flex gap-3">
        <div className="w-16 shrink-0"><ShowCover p={p} size="sm"/></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold" style={{ color: C.t1 }}>{p.title}</div>
          <div className="text-[11px]" style={{ color: st.color }}>{st.text}</div>
          {p.status === 'rejected' && p.rejectReason && (
            <div className="mt-1 text-[11px] leading-snug" style={{ color: C.t3 }}>Причина: {p.rejectReason}</div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <UploadCoverButton podcastId={p.id} has={p.hasCover} onDone={onChanged}/>
            {(p.status === 'private' || p.status === 'rejected') && (
              <button onClick={submit}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium"
                style={{ background: C.purple, color: '#fff' }}>
                <Send size={11}/>На проверку
              </button>
            )}
            {p.status === 'published' && (
              <button onClick={async () => { await apiPatchPodcast(p.id, { status: 'private' }); onChanged(); }}
                className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: C.l1, color: C.t2 }}>
                Снять с показа
              </button>
            )}
            <button onClick={async () => {
              if (!window.confirm(`Удалить передачу «${p.title}» со всеми выпусками?`)) return;
              await apiDeletePodcast(p.id); onChanged();
            }}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px]"
            style={{ background: C.l1, color: '#ef4444' }}>
              <Trash2 size={11}/>Удалить
            </button>
          </div>
          {note && <p className="mt-1.5 text-[11px]" style={{ color: '#f59e0b' }}>{note}</p>}
        </div>
      </div>

      <div className="mt-3 border-t pt-3" style={{ borderColor: C.border }}>
        <div className="mb-2 flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addEpisode(); }}
            placeholder="Название нового выпуска"
            className="min-w-0 flex-1 rounded-xl px-3 py-2 text-[13px] outline-none"
            style={{ background: C.l1, color: C.t1 }}/>
          <button onClick={addEpisode} disabled={busy || !title.trim()}
            className="flex shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-[12px] font-medium"
            style={{ background: C.purple, color: '#fff', opacity: busy || !title.trim() ? 0.5 : 1 }}>
            <Plus size={13}/>Выпуск
          </button>
        </div>

        {episodes.length === 0 && (
          <p className="py-3 text-center text-[12px]" style={{ color: C.t3 }}>
            Выпусков пока нет. Передачу нельзя отправить на проверку, пока нет хотя бы одного выпуска с файлом.
          </p>
        )}

        {episodes.map((e) => (
          <div key={e.id} className="border-b py-2 last:border-0" style={{ borderColor: C.border }}>
            <button onClick={() => setOpen(open === e.id ? null : e.id)}
              className="flex w-full items-center gap-2 text-left">
              <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: C.t1 }}>
                {e.number ? `${e.number}. ` : ''}{e.title}
              </span>
              <span className="shrink-0 text-[10px]" style={{ color: e.hasAudio || e.hasVideo ? '#22c55e' : '#f59e0b' }}>
                {e.hasAudio || e.hasVideo ? 'с файлом' : 'без файла'}
              </span>
              <ChevronRight size={14} style={{ color: C.t3,
                transform: open === e.id ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}/>
            </button>
            {open === e.id && <EpisodeEditor e={e} onChanged={() => { void load(); onChanged(); }}/>}
          </div>
        ))}
      </div>
    </div>
  );
};

const UploadCoverButton = ({ podcastId, has, onDone }: { podcastId: string; has: boolean; onDone: () => void }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button onClick={() => ref.current?.click()} disabled={busy}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px]"
        style={{ background: C.l1, color: C.t2 }}>
        {busy ? <Loader2 size={11} className="animate-spin"/> : <ImageIcon size={11}/>}
        {has ? 'Заменить обложку' : 'Обложка'}
      </button>
      <input ref={ref} type="file" accept={ACCEPT_IMAGE} className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          setBusy(true); await apiUploadCover({ podcastId }, f); setBusy(false); onDone();
        }}/>
    </>
  );
};

const Studio = () => {
  const [mine, setMine] = useState<Podcast[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Технологии');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => { setMine(await apiMine()); }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const t = title.trim();
    if (!t) return;
    const made = await apiCreatePodcast({ title: t, category, description: description.trim() || undefined });
    if (made) { setTitle(''); setDescription(''); setCreating(false); await load(); }
  };

  return (
    <div className="pb-28">
      <div className="mb-4 rounded-2xl p-3.5" style={glass}>
        <div className="mb-1 flex items-center gap-2">
          <PenLine size={15} style={{ color: C.purple }}/>
          <h3 className="text-[14px] font-bold" style={{ color: C.t1 }}>Своя передача</h3>
        </div>
        <p className="mb-3 text-[11.5px] leading-relaxed" style={{ color: C.t3 }}>
          Новая передача сразу закрыта: её видите только вы. В общий каталог она
          попадает после проверки, и для этого нужен хотя бы один выпуск с файлом.
        </p>

        {!creating ? (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-semibold"
            style={{ background: C.purple, color: '#fff' }}>
            <Plus size={14}/>Создать передачу
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название передачи"
              className="rounded-xl px-3 py-2 text-[13px] outline-none" style={{ background: C.l1, color: C.t1 }}/>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="О чём она" rows={3}
              className="resize-none rounded-xl px-3 py-2 text-[13px] outline-none" style={{ background: C.l1, color: C.t1 }}/>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(c)}
                  className="rounded-lg px-2.5 py-1 text-[11px]"
                  style={{ background: category === c ? C.purpleSoft : C.l1,
                    color: category === c ? C.purple : C.t3 }}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={create} disabled={!title.trim()}
                className="rounded-xl px-3.5 py-2 text-[12px] font-semibold"
                style={{ background: C.purple, color: '#fff', opacity: title.trim() ? 1 : 0.5 }}>
                Создать
              </button>
              <button onClick={() => setCreating(false)}
                className="rounded-xl px-3.5 py-2 text-[12px]" style={{ background: C.l1, color: C.t2 }}>
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>

      {mine === null && <div className="py-8 text-center"><Loader2 size={20} className="animate-spin inline" style={{ color: C.t3 }}/></div>}
      {mine?.length === 0 && (
        <p className="py-6 text-center text-sm" style={{ color: C.t3 }}>У вас пока нет своих передач.</p>
      )}
      <div className="flex flex-col gap-3">
        {mine?.map((p) => <ShowStudio key={p.id} p={p} onChanged={load}/>)}
      </div>
    </div>
  );
};

/* ─── Главный экран ────────────────────────────────────────────────── */

type Tab = 'home' | 'subs' | 'favorites' | 'studio' | 'moderation';

export const SkyPodcasts = () => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find((a) => a.id === currentUserId);
  const isAdmin = me?.isAdmin ?? false;

  const [tab, setTab] = useState<Tab>('home');
  const [openShow, setOpenShow] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('Все');

  const [catalog, setCatalog] = useState<Podcast[] | null>(null);
  const [more, setMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cats, setCats] = useState<{ name: string; count: number }[]>([]);
  const [continueList, setContinueList] = useState<Episode[]>([]);
  const [fresh, setFresh] = useState<Episode[]>([]);
  const [subs, setSubs] = useState<Podcast[]>([]);
  const [favs, setFavs] = useState<{ podcasts: Podcast[]; episodes: Episode[] }>({ podcasts: [], episodes: [] });
  const [history, setHistory] = useState<Episode[]>([]);
  const [found, setFound] = useState<{ podcasts: Podcast[]; episodes: Episode[] } | null>(null);
  const [searching, setSearching] = useState(false);

  const play = usePlayer((s) => s.play);

  /* Пропуск для медиа — один раз при открытии модуля. */
  useEffect(() => { void apiMediaTicket(); }, []);

  /* Поиск ждёт, пока человек допечатает: запрос на каждую букву — это
     и лишняя работа серверу, и мигающий список под пальцами. */
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 320);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (debounced.length < 2) { setFound(null); return undefined; }
    let alive = true;
    setSearching(true);
    void apiSearch(debounced).then((r) => {
      if (!alive) return;
      setFound(r);
      setSearching(false);
    });
    return () => { alive = false; };
  }, [debounced]);

  const loadHome = useCallback(async () => {
    setCatalog(null); setMore(true);
    const [list, categories, cont, nw] = await Promise.all([
      apiCatalog({ category, limit: 24 }),
      apiCategories(),
      apiContinue(),
      apiNewFromSubscriptions(),
    ]);
    setCatalog(list ?? []);
    setMore((list?.length ?? 0) >= 24);
    setCats(categories);
    setContinueList(cont);
    setFresh(nw);
  }, [category]);

  useEffect(() => { void loadHome(); }, [loadHome]);

  useEffect(() => {
    if (tab === 'subs') void apiSubscriptions().then(setSubs);
    if (tab === 'favorites') {
      void apiFavorites().then(setFavs);
      void apiHistory().then(setHistory);
    }
  }, [tab]);

  const loadMore = async () => {
    if (!catalog || loadingMore) return;
    setLoadingMore(true);
    const next = await apiCatalog({ category, limit: 24, offset: catalog.length });
    setLoadingMore(false);
    if (!next || next.length === 0) { setMore(false); return; }
    setCatalog([...catalog, ...next]);
    if (next.length < 24) setMore(false);
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'home', label: 'Обзор' },
    { id: 'subs', label: 'Подписки' },
    { id: 'favorites', label: 'Избранное' },
    { id: 'studio', label: 'Моя студия' },
    ...(isAdmin ? [{ id: 'moderation' as Tab, label: 'Проверка' }] : []),
  ];

  return (
    <div className="relative h-full overflow-y-auto" style={{ background: C.bg }}>
      <Sky/>

      <div className="relative px-4 pb-24 pt-4">
        {/* Шапка. Без значка: в кино и на телевидении его тоже нет —
            там название и есть опознавательный знак раздела. */}
        <div className="mb-4">
          <h1 className="text-xl font-black leading-none tracking-tight">
            <span style={{ color: C.t1 }}>Sky</span>
            <span style={{ color: C.purple }}>Подкасты</span>
          </h1>
          <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Слушать и смотреть</p>
        </div>

        {/* Поиск */}
        <div className="mb-3 flex items-center gap-2 rounded-2xl px-3 py-2.5" style={glass}>
          <Search size={15} style={{ color: C.t3 }}/>
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Передачи и выпуски"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" style={{ color: C.t1 }}/>
          {searching && <Loader2 size={13} className="animate-spin" style={{ color: C.t3 }}/>}
          {q && <button onClick={() => setQ('')} aria-label="Очистить"><X size={14} style={{ color: C.t3 }}/></button>}
        </div>

        {/* Вкладки */}
        {!found && !openShow && (
          <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="shrink-0 rounded-xl px-3 py-1.5 text-[12px] font-medium"
                style={{ background: tab === t.id ? C.purpleSoft : 'rgba(255,255,255,0.05)',
                  color: tab === t.id ? C.purple : C.t3 }}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Найденное */}
        {found && (
          <div className="pb-28">
            {found.podcasts.length === 0 && found.episodes.length === 0 && (
              <p className="py-10 text-center text-sm" style={{ color: C.t3 }}>Ничего не нашлось.</p>
            )}
            {found.podcasts.length > 0 && (
              <Rail title="Передачи">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {found.podcasts.map((p) => (
                    <ShowCard key={p.id} p={p} onOpen={() => { setOpenShow(p.id); setQ(''); }}/>
                  ))}
                </div>
              </Rail>
            )}
            {found.episodes.length > 0 && (
              <Rail title="Выпуски">
                <div className="flex flex-col">
                  {found.episodes.map((e) => (
                    <EpisodeRow key={e.id} e={e} onPlay={(mode) => void play(e, { mode })}/>
                  ))}
                </div>
              </Rail>
            )}
          </div>
        )}

        {/* Страница передачи */}
        {!found && openShow && <ShowPage id={openShow} onBack={() => setOpenShow(null)}/>}

        {/* Обзор */}
        {!found && !openShow && tab === 'home' && (
          <div className="pb-28">
            {continueList.length > 0 && (
              <Rail title="Продолжить">
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {continueList.map((e) => (
                    <button key={e.id} onClick={() => void play(e)}
                      className="flex w-56 shrink-0 items-center gap-2.5 rounded-2xl p-2.5 text-left" style={glass}>
                      <EpisodeCover e={e} size={44}/>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-semibold" style={{ color: C.t1 }}>{e.title}</div>
                        <div className="truncate text-[10.5px]" style={{ color: C.t3 }}>
                          осталось {fmtDuration(Math.max(0, e.duration - (e.position ?? 0)))}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </Rail>
            )}

            {fresh.length > 0 && (
              <Rail title="Новое у ваших подписок">
                <div className="flex flex-col">
                  {fresh.slice(0, 5).map((e) => (
                    <EpisodeRow key={e.id} e={e} onPlay={(mode) => void play(e, { mode })}/>
                  ))}
                </div>
              </Rail>
            )}

            {cats.length > 0 && (
              <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
                {['Все', ...cats.map((c) => c.name)].map((c) => (
                  <button key={c} onClick={() => setCategory(c)}
                    className="shrink-0 rounded-xl px-3 py-1.5 text-[11.5px]"
                    style={{ background: category === c ? C.purpleSoft : 'rgba(255,255,255,0.05)',
                      color: category === c ? C.purple : C.t3 }}>
                    {c}
                  </button>
                ))}
              </div>
            )}

            <Rail title={category === 'Все' ? 'Все передачи' : category}>
              {catalog === null && <div className="py-8 text-center"><Loader2 size={20} className="animate-spin inline" style={{ color: C.t3 }}/></div>}
              {catalog?.length === 0 && (
                <div className="rounded-2xl px-4 py-8 text-center" style={glass}>
                  <Mic size={26} style={{ color: C.t3, margin: '0 auto 10px' }}/>
                  <p className="mx-auto max-w-xs text-[13px] leading-relaxed" style={{ color: C.t3 }}>
                    В каталоге пока пусто. Передачи появляются здесь после проверки —
                    свою можно завести во вкладке «Моя студия».
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {catalog?.map((p) => <ShowCard key={p.id} p={p} onOpen={() => setOpenShow(p.id)}/>)}
              </div>
              {catalog && catalog.length > 0 && more && (
                <button onClick={loadMore} disabled={loadingMore}
                  className="mx-auto mt-3 flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px]"
                  style={{ background: C.l1, color: C.t2 }}>
                  {loadingMore && <Loader2 size={12} className="animate-spin"/>}
                  Показать ещё
                </button>
              )}
            </Rail>
          </div>
        )}

        {/* Подписки */}
        {!found && !openShow && tab === 'subs' && (
          <div className="pb-28">
            {subs.length === 0
              ? (
                <p className="py-10 text-center text-sm leading-relaxed" style={{ color: C.t3 }}>
                  Вы пока ни на что не подписаны.<br/>Подписка — это «следить за новым».
                </p>
              )
              : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {subs.map((p) => <ShowCard key={p.id} p={p} onOpen={() => setOpenShow(p.id)}/>)}
                </div>
              )}
          </div>
        )}

        {/* Избранное и история */}
        {!found && !openShow && tab === 'favorites' && (
          <div className="pb-28">
            {favs.podcasts.length > 0 && (
              <Rail title="Передачи">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {favs.podcasts.map((p) => <ShowCard key={p.id} p={p} onOpen={() => setOpenShow(p.id)}/>)}
                </div>
              </Rail>
            )}
            {favs.episodes.length > 0 && (
              <Rail title="Выпуски">
                <div className="flex flex-col">
                  {favs.episodes.map((e) => <EpisodeRow key={e.id} e={e} onPlay={(mode) => void play(e, { mode })}/>)}
                </div>
              </Rail>
            )}
            {favs.podcasts.length === 0 && favs.episodes.length === 0 && (
              <p className="py-8 text-center text-sm leading-relaxed" style={{ color: C.t3 }}>
                В избранном пусто.<br/>Избранное — это «вернуться к этому», в отличие от подписки.
              </p>
            )}
            {history.length > 0 && (
              <Rail title="Вы слушали">
                <div className="flex flex-col">
                  {history.slice(0, 10).map((e) => <EpisodeRow key={e.id} e={e} onPlay={(mode) => void play(e, { mode })}/>)}
                </div>
              </Rail>
            )}
          </div>
        )}

        {!found && !openShow && tab === 'studio' && <Studio/>}
        {!found && !openShow && tab === 'moderation' && isAdmin && <PodcastModeration/>}
      </div>
    </div>
  );
};

export default SkyPodcasts;
