/* ===========================================================
   SKY PODCASTS на телевизоре

   Это не уменьшённый телефон и не увеличенный: телевизором управляют
   пультом, и отсюда всё устройство экрана.

   Слева — столбец передач, по которому ходят вверх-вниз; справа —
   выпуски выбранной. Сетка из плиток пультом непроходима, а один
   столбец — естественное движение.

   Звук идёт через тот же единственный проигрыватель, что и везде:
   своего элемента здесь нет и быть не должно, иначе на телевизоре
   заиграли бы сразу два. Внизу — полоса того, что звучит сейчас.

   Видеовыпуск показывается крупно, на весь экран; звуковой — обложкой
   и титрами: на телевизоре человек сидит далеко, и мелкий текст там
   не читается.
=========================================================== */
import { useAuthStore } from '@/core/auth/store';
import { Crown } from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Mic, Headphones, Play, Pause, Loader2, FileText, Video } from 'lucide-react';
import { TVFocusable } from './TVFocusable';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';
import { usePlayer } from '@/podcasts/playerStore';
import {
  apiCatalog, apiEpisodes, apiMediaTicket, showCoverUrl, epCoverUrl,
  fmtDuration, fmtTime, type Podcast, type Episode,
} from '@/podcasts/podcastApi';

const Cover = ({ p, size }: { p: Podcast; size: number }) => (
  <div className="grid shrink-0 place-items-center overflow-hidden rounded-xl"
    style={{ width: size, height: size, background: `linear-gradient(140deg, ${p.accent}, rgba(0,0,0,0.55))` }}>
    {p.hasCover
      ? <img src={showCoverUrl(p.id)} alt="" className="h-full w-full object-cover"/>
      : <Mic size={size * 0.4} className="text-white/75"/>}
  </div>
);

/* ─── Что звучит сейчас ────────────────────────────────────────────── */

const NowBar = () => {
  const { episode, playing, waiting, currentTime, duration, cues, cueIndex, cueStyle } = usePlayer();
  if (!episode) return null;
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const cue = cueIndex >= 0 ? cues[cueIndex] : null;

  return (
    <div className="shrink-0 border-t px-10 py-4"
      style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.5)' }}>
      {/* Титры крупно: на телевизоре сидят далеко. */}
      {cueStyle.on && cue && (
        <p className="mb-2 truncate text-center text-[20px]" style={{ color: '#fff' }}>
          {cue.speaker ? <b style={{ opacity: 0.7 }}>{cue.speaker}: </b> : null}{cue.text}
        </p>
      )}
      <div className="flex items-center gap-4">
        {playing ? <Pause size={22} style={{ color: 'var(--t1)' }}/>
          : waiting ? <Loader2 size={22} className="animate-spin" style={{ color: 'var(--t1)' }}/>
            : <Play size={22} style={{ color: 'var(--t1)' }}/>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[18px] font-semibold" style={{ color: 'var(--t1)' }}>{episode.title}</p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.14)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#a855f7' }}/>
          </div>
        </div>
        <span className="shrink-0 text-[15px] tabular-nums" style={{ color: 'var(--t3)' }}>
          {fmtTime(currentTime)} / {fmtTime(duration || episode.duration)}
        </span>
      </div>
    </div>
  );
};

/* ─── Картинка видеовыпуска на весь экран ──────────────────────────── */

const VideoStage = ({ onClose }: { onClose: () => void }) => {
  const attachVideo = usePlayer((s) => s.attachVideo);
  const toggle = usePlayer((s) => s.toggle);
  const skip = usePlayer((s) => s.skip);
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    attachVideo(slot.current);
    return () => attachVideo(null);
  }, [attachVideo]);

  // Пульт: середина — пауза, стрелки — перемотка, «назад» — выход.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-15); }
      if (e.key === 'ArrowRight') { e.preventDefault(); skip(30); }
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggle, skip, onClose]);

  return (
    <div className="fixed inset-0 z-[600] flex flex-col" style={{ background: '#000' }}>
      <div ref={slot} className="min-h-0 flex-1"/>
      <NowBar/>
    </div>
  );
};

/* ─── Экран ────────────────────────────────────────────────────────── */

/* Подкасты входят в Sky Prime (сервер отвечает 403 без подписки). Оформить её пультом/в машине неудобно — подсказываем где. */
export const TVPodcasts = () => {
  const accounts = useAuthStore((s) => s.accounts);
  const currentUserId = useAuthStore((s) => s.currentUserId);
  const me = accounts.find((a) => a.id === currentUserId);
  if (!(me?.isPrime ?? false) && !(me?.isAdmin ?? false)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-10 text-center">
        <Crown size={56} style={{ color: '#fbbf24' }} />
        <p className="text-3xl font-black text-white">Подкасты — только для Prime</p>
        <p className="text-xl" style={{ color: 'var(--t2)' }}>Оформите Sky Prime на телефоне или на сайте — здесь всё заработает само.</p>
      </div>
    );
  }
  return <TVPodcastsContent />;
};

const TVPodcastsContent = () => {
  const { lastFocusedId } = useTVRestoreState();
  const [shows, setShows] = useState<Podcast[] | null>(null);
  const [selected, setSelected] = useState<Podcast | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [stage, setStage] = useState(false);
  const play = usePlayer((s) => s.play);
  const nowId = usePlayer((s) => s.episode?.id);
  const mode = usePlayer((s) => s.mode);

  useEffect(() => {
    void apiMediaTicket();
    void apiCatalog({ limit: 60 }).then((r) => setShows(r ?? []));
  }, []);

  useEffect(() => { tvFocusManager.focusDefault(lastFocusedId); }, [shows]);

  useEffect(() => {
    if (selected || !shows || shows.length === 0) return;
    setSelected(shows[0]);
  }, [shows, selected]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setEpisodes([]);
    void apiEpisodes(selected.id, { limit: 100 }).then((r) => { if (alive) setEpisodes(r ?? []); });
    return () => { alive = false; };
  }, [selected?.id]);

  const open = useCallback(async (e: Episode) => {
    await play({ ...e, podcastTitle: selected?.title, accent: selected?.accent });
    // Развёрнутый проигрыватель телефона на телевизоре не нужен: здесь
    // свой экран. Но картинку видео показать надо.
    usePlayer.getState().setExpanded(false);
    if (e.hasVideo) setStage(true);
  }, [play, selected]);

  if (stage && mode === 'video') return <VideoStage onClose={() => setStage(false)}/>;

  if (shows === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Mic size={40} style={{ color: 'var(--t3)' }}/>
        <p className="text-[18px]" style={{ color: 'var(--t3)' }}>Загружаем подкасты…</p>
      </div>
    );
  }

  if (shows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Передач пока нет</p>
        <p className="text-sm" style={{ color: 'var(--t3)' }}>
          Они появятся здесь после проверки — завести свою можно с телефона
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 gap-8 px-10 pb-6 pt-4">

        {/* Передачи: один столбец, по нему ходят вверх-вниз */}
        <div className="flex w-[400px] shrink-0 flex-col gap-2 overflow-y-auto pr-1"
          style={{ scrollbarWidth: 'none' }}>
          <p className="px-1 pb-1 pt-2 text-[13px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--t3)' }}>Передачи</p>
          {shows.map((p, i) => (
            <TVFocusable key={p.id} id={`tvpod-show-${p.id}`}
              autoFocusPriority={i === 0 ? 0 : undefined}
              onEnter={() => setSelected(p)}>
              {({ focused }) => {
                if (focused && selected?.id !== p.id) setTimeout(() => setSelected(p), 0);
                return (
                  <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5"
                    style={{
                      background: focused ? 'rgba(255,255,255,0.14)' : 'transparent',
                      boxShadow: focused ? `0 0 0 3px ${p.accent}` : 'none',
                      transform: focused ? 'scale(1.02)' : 'scale(1)',
                      transition: 'transform 0.15s, background 0.15s',
                    }}>
                    <Cover p={p} size={52}/>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[17px] font-semibold" style={{ color: 'var(--t1)' }}>{p.title}</p>
                      <p className="truncate text-[13px]" style={{ color: 'var(--t3)' }}>
                        {p.category} · {p.episodes} вып.
                      </p>
                    </div>
                  </div>
                );
              }}
            </TVFocusable>
          ))}
        </div>

        {/* Выпуски выбранной передачи */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {selected && (
            <>
              <h2 className="text-[26px] font-bold" style={{ color: 'var(--t1)' }}>{selected.title}</h2>
              {selected.description && (
                <p className="line-clamp-2 text-[15px]" style={{ color: 'var(--t3)' }}>{selected.description}</p>
              )}
              {episodes.length === 0 && (
                <p className="py-8 text-[16px]" style={{ color: 'var(--t3)' }}>
                  Выпусков пока нет.
                </p>
              )}
              {episodes.map((e) => (
                <TVFocusable key={e.id} id={`tvpod-ep-${e.id}`} onEnter={() => void open(e)}>
                  {({ focused }) => (
                    <div className="flex items-center gap-4 rounded-2xl px-4 py-3"
                      style={{
                        background: focused ? 'rgba(255,255,255,0.14)'
                          : nowId === e.id ? 'rgba(168,85,247,0.16)' : 'transparent',
                        boxShadow: focused ? '0 0 0 3px #a855f7' : 'none',
                        transform: focused ? 'scale(1.01)' : 'scale(1)',
                        transition: 'transform 0.15s, background 0.15s',
                      }}>
                      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl"
                        style={{ background: e.accent ?? '#a855f7' }}>
                        {e.hasCover
                          ? <img src={epCoverUrl(e.id)} alt="" className="h-full w-full object-cover"/>
                          : <Headphones size={22} className="text-white/75"/>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[19px] font-semibold" style={{ color: 'var(--t1)' }}>
                          {e.number ? `${e.number}. ` : ''}{e.title}
                        </p>
                        <p className="flex items-center gap-3 text-[14px]" style={{ color: 'var(--t3)' }}>
                          <span>{fmtDuration(e.duration)}</span>
                          {e.hasVideo && <span className="flex items-center gap-1"><Video size={13}/>видео</span>}
                          {e.hasTranscript && <span className="flex items-center gap-1"><FileText size={13}/>титры</span>}
                          {e.completed && <span style={{ color: '#22c55e' }}>прослушано</span>}
                          {!e.completed && (e.position ?? 0) > 20
                            && <span>осталось {fmtDuration(e.duration - (e.position ?? 0))}</span>}
                        </p>
                      </div>
                      {nowId === e.id && (
                        <span className="shrink-0 text-[14px] font-semibold" style={{ color: '#a855f7' }}>звучит</span>
                      )}
                    </div>
                  )}
                </TVFocusable>
              ))}
            </>
          )}
        </div>
      </div>

      <NowBar/>
    </div>
  );
};
