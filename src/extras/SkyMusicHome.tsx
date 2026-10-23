import { ExplicitBadge } from '@/labels/Labels';
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Music2, ListMusic, Mic2, Sparkles, Disc3, Play, Search, ChevronRight, X } from 'lucide-react';
import type { Track } from '@/platform/store';
import { getG } from '@/music/utils';
import { useMusicStore } from '@/music/serverStore';
import { apiArtistFeed, toClientTrack } from '@/music/musicApi';
import { SkySphere } from '@/music/SkySphere';
import { FlowHero } from './FlowHero';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 6)  return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
};

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { duration: 0.45, delay: Math.min(i, 6) * 0.05, ease: [0.22, 1, 0.36, 1] } }),
};

/* -- Крупная карточка трека, премиальный тайминг/тени в духе Yandex Music -- */
const TrackTile = ({ t, onPlay, active, playing }: { t: Track; onPlay: () => void; active: boolean; playing: boolean }) => {
  const [c1, c2] = getG(t.id);
  return (
    <motion.button type="button" onClick={onPlay} whileTap={{ scale: 0.95 }}
      className="shrink-0 text-left group" style={{ width: 156 }}>
      <div className="relative overflow-hidden rounded-2xl transition-transform duration-300 group-active:scale-[0.98]" style={{
        height: 156, background: t.coverUrl ? undefined : `linear-gradient(150deg,${c1},${c2})`,
        boxShadow: active ? '0 12px 32px -8px rgba(255,255,255,0.12)' : '0 4px 16px -4px rgba(0,0,0,0.4)',
      }}>
        {t.coverUrl
          ? <img src={t.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
          : <div className="grid h-full w-full place-items-center"><Music2 size={32} color="rgba(255,255,255,0.3)"/></div>}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          style={{ background: 'linear-gradient(0deg,rgba(0,0,0,0.55) 0%,transparent 45%)' }}/>
        <div className="absolute bottom-2.5 right-2.5 grid h-9 w-9 place-items-center rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0"
          style={{ background: 'rgba(255,255,255,0.95)' }}>
          <Play size={15} fill="#0a0a0f" color="#0a0a0f" style={{ marginLeft: 1 }}/>
        </div>
        {active && playing && (
          <div className="absolute inset-0 grid place-items-center" style={{ background: 'rgba(8,8,12,0.45)' }}>
            <div className="flex h-5 items-end gap-[3px]">
              {[0,1,2].map(j => <div key={j} style={{ width: 3, borderRadius: 2, background: '#fff', height: 5+j*4, animation: `skyMusicEq ${0.5+j*0.15}s ease-in-out infinite alternate` }}/>)}
            </div>
          </div>
        )}
      </div>
      <p className="mt-2.5 truncate text-[13.5px] font-semibold" style={{ color: active ? '#fff' : '#f0f1f4', letterSpacing: '-0.01em' }}>{t.title}<ExplicitBadge show={t.explicit} /></p>
      <p className="truncate text-[12px] mt-0.5" style={{ color: '#7d818c' }}>{t.artist}</p>
    </motion.button>
  );
};

/**
 * Подборка «Мой поток».
 *
 * Открывается нажатием на карточку: человек видит, из чего состоит
 * поток, и может начать с любого места. Плеер при этом остаётся тем же
 * самым — отсюда вызывается ровно тот же onPlay, что и из остальных
 * списков.
 */
const WaveSheet = ({ pool, c1, c2, playing, activeId, onPlay, onClose }: {
  pool: Track[]; c1: string; c2: string; playing: boolean; activeId: string | null;
  onPlay: (t: Track) => void; onClose: () => void;
}) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    className="absolute inset-0 z-40 flex flex-col" style={{ background: 'var(--bg)' }}>
    <div className="relative shrink-0 overflow-hidden" style={{ height: 208 }}>
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <SkySphere color1={c1} color2={c2} active={playing}/>
      </div>
      <div className="absolute inset-0" style={{ zIndex: 1,
        background: 'linear-gradient(to top, #0a0a0f 0%, rgba(10,10,15,0.35) 50%, transparent 80%)' }}/>
      <button type="button" onClick={onClose} aria-label="Закрыть"
        className="absolute right-4 grid h-9 w-9 place-items-center rounded-full"
        style={{ top: 16, zIndex: 2, background: 'rgba(0,0,0,0.45)' }}>
        <X size={17} color="#fff"/>
      </button>
      <div className="absolute bottom-4 left-5 right-5" style={{ zIndex: 2 }}>
        <p className="text-[28px] font-extrabold text-white"
          style={{ letterSpacing: '-0.03em', textShadow: '0 2px 18px rgba(0,0,0,0.55)' }}>Мой поток</p>
        <p className="text-[12.5px] mt-0.5" style={{ color: 'rgba(255,255,255,0.72)' }}>
          {pool.length} {pool.length === 1 ? 'трек' : pool.length < 5 ? 'трека' : 'треков'} · обновляется каждый раз
        </p>
      </div>
    </div>

    <div className="shrink-0 px-5 pb-3">
      <button type="button" onClick={() => pool[0] && onPlay(pool[0])}
        className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-bold"
        style={{ background: '#fff', color: '#0a0a0f' }}>
        <Play size={16} fill="#0a0a0f" color="#0a0a0f"/> Слушать поток
      </button>
    </div>

    <div className="flex-1 overflow-y-auto px-2 pb-6" style={{ scrollbarWidth: 'none' }}>
      {pool.length === 0 && (
        <p className="py-10 text-center text-[13px]" style={{ color: '#7d818c' }}>
          Пока нечего слушать
        </p>
      )}
      {pool.map((t, i) => {
        const active = activeId === t.id;
        const [g1, g2] = getG(t.id);
        return (
          <button key={t.id} type="button" onClick={() => onPlay(t)}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-white/[0.04]">
            <span className="w-5 shrink-0 text-center text-[12px] tabular-nums"
              style={{ color: active ? '#fff' : '#5c606b' }}>{i + 1}</span>
            <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl"
              style={{ background: t.coverUrl ? undefined : `linear-gradient(150deg,${g1},${g2})` }}>
              {t.coverUrl
                ? <img src={t.coverUrl} alt="" className="h-full w-full object-cover"/>
                : <Music2 size={17} color="rgba(255,255,255,0.32)"/>}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold"
                style={{ color: active ? '#fff' : '#f0f1f4' }}>{t.title}<ExplicitBadge show={t.explicit} /></span>
              <span className="block truncate text-[12px]" style={{ color: '#7d818c' }}>{t.artist}</span>
            </span>
            {active && playing && <Sparkles size={14} style={{ color: '#8b7dff' }}/>}
          </button>
        );
      })}
    </div>
  </motion.div>
);

const Section = ({ title, icon: Icon, index, children, empty }: {
  title: string; icon: React.FC<any>; index: number; children?: React.ReactNode; empty?: string;
}) => (
  <motion.section custom={index} variants={fadeUp} initial="hidden" animate="show" className="mb-8">
    <div className="mb-3.5 flex items-center justify-between px-5">
      <div className="flex items-center gap-2">
        <Icon size={14} strokeWidth={2.2} style={{ color: '#8a8f9a' }}/>
        <p className="text-[16px] font-bold" style={{ color: '#fafafb', letterSpacing: '-0.015em' }}>{title}</p>
      </div>
      {!empty && <ChevronRight size={16} style={{ color: '#4a4d55' }}/>}
    </div>
    {empty ? (
      <p className="px-5 text-[13px]" style={{ color: '#5c626e' }}>{empty}</p>
    ) : (
      <div className="flex gap-3.5 overflow-x-auto px-5 pb-1" style={{ scrollbarWidth: 'none' }}>{children}</div>
    )}
  </motion.section>
);

export const SkyMusicHome = ({
  tracks, favorites, playing, activeId, onPlay, loading, error, onRetry, onUpload, onSearch, cur, onTogglePlay, onLike, onOpenPlayer,
}: {
  tracks: Track[]; favorites: string[]; playing: boolean; activeId: string | null;
  onPlay: (t: Track, pool: Track[]) => void;
  cur: Track | null; onTogglePlay: () => void; onLike: (id: string) => void; onOpenPlayer: () => void;
  loading?: boolean; error?: string | null;
  onRetry?: () => void; onUpload?: () => void; onSearch?: () => void;
}) => {
  const pub = useMemo(() => tracks.filter(t => t.status === 'published'), [tracks]);
  const fresh = useMemo(() => [...pub].sort((a,b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 10), [pub]);
  const popularNow = useMemo(() => [...pub].sort((a,b) => b.plays - a.plays).slice(0, 10), [pub]);
  const likedTracks = useMemo(() => pub.filter(t => favorites.includes(t.id)), [pub, favorites]);

  // Недавнее — с сервера: на другом устройстве список тот же.
  const historyIds = useMusicStore(st => st.history).map(h => h.id);
  const recentlyPlayed = useMemo(
    () => historyIds.map(id => pub.find(t => t.id === id)).filter(Boolean).slice(0, 10) as Track[],
    [historyIds, pub],
  );

  // Недослушанный трек прошлого раза (плеер пуст): карточка «Мой поток» показывает его с тихой волной.
  const progressMap = useMusicStore(st => st.progress);
  const lastUnfinished = useMemo(() => {
    if (cur) return null;
    const t = recentlyPlayed[0];
    return t && (progressMap[t.id] ?? 0) > 5 ? t : null;
  }, [cur, recentlyPlayed, progressMap]);

  const forYou = useMemo(() => {
    // без ИИ — простое ранжирование по любимым жанрам/исполнителям
    const genreCount: Record<string, number> = {}; const artistCount: Record<string, number> = {};
    pub.filter(t => favorites.includes(t.id)).forEach(t => {
      genreCount[t.genre] = (genreCount[t.genre] ?? 0) + 1;
      artistCount[t.artist] = (artistCount[t.artist] ?? 0) + 1;
    });
    return [...pub].sort((a, b) => {
      const sa = (genreCount[a.genre] ?? 0) * 2 + (artistCount[a.artist] ?? 0) * 3 + Math.log1p(a.plays);
      const sb = (genreCount[b.genre] ?? 0) * 2 + (artistCount[b.artist] ?? 0) * 3 + Math.log1p(b.plays);
      return sb - sa;
    }).slice(0, 10);
  }, [pub, favorites]);

  const favoriteArtists = useMemo(() => {
    const byArtist: Record<string, Track[]> = {};
    pub.forEach(t => { (byArtist[t.artist] ??= []).push(t); });
    return Object.entries(byArtist).sort((a,b) => b[1].length - a[1].length).slice(0, 8);
  }, [pub]);

  const albums = useMemo(() => {
    // Явной модели "альбом" пока нет — группируем треки по исполнителю+жанру как псевдо-альбом.
    const map: Record<string, Track[]> = {};
    pub.forEach(t => { (map[`${t.artist} · ${t.genre}`] ??= []).push(t); });
    return Object.entries(map).filter(([,ts]) => ts.length >= 1).slice(0, 10);
  }, [pub]);

  // Новое у тех, на кого человек подписан. Пусто — раздела нет: пустой
  // заголовок ничего не объясняет.
  const [feed, setFeed] = useState<Track[]>([]);
  useEffect(() => {
    let alive = true;
    void apiArtistFeed().then(list => {
      if (alive && list) setFeed(list.map(toClientTrack));
    });
    return () => { alive = false; };
  }, []);

  const [waveOpen, setWaveOpen] = useState(false);
  const wavePool = useMemo(() => [...pub].sort(() => Math.random() - 0.5), [pub]);
  const startWave = () => { if (wavePool[0]) onPlay(wavePool[0], wavePool); };
  const [c1, c2] = wavePool[0] ? getG(wavePool[0].id) : ['#6a3de8', '#2563eb'];

  // Три состояния, которых у экрана раньше быть не могло: каталог лежал
  // в самом браузере и не умел ни грузиться, ни отказывать.
  if (loading && tracks.length === 0) {
    return (
      <div className="sky-music-scope grid h-full place-items-center" style={{ background: 'var(--bg)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-white/10 border-t-white/60 sky-spin"/>
          <p className="text-[13px]" style={{ color: '#7d818c' }}>Загружаем музыку…</p>
        </div>
      </div>
    );
  }

  if (error && tracks.length === 0) {
    return (
      <div className="sky-music-scope grid h-full place-items-center px-8 text-center" style={{ background: 'var(--bg)' }}>
        <div>
          <p className="text-[15px] font-bold" style={{ color: '#fafafb' }}>Музыка не загрузилась</p>
          <p className="mt-1.5 text-[13px]" style={{ color: '#7d818c' }}>{error}</p>
          {onRetry && (
            <button type="button" onClick={onRetry}
              className="mt-4 rounded-2xl px-5 py-2.5 text-[13px] font-bold"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#fafafb' }}>
              Повторить
            </button>
          )}
        </div>
      </div>
    );
  }

  if (pub.length === 0) {
    return (
      <div className="sky-music-scope relative h-full" style={{ background: 'var(--bg)' }}>
        <div className="absolute inset-x-0 top-0 h-56">
          <SkySphere color1={c1} color2={c2} active={playing}/>
        </div>
        <div className="relative flex h-full flex-col items-center justify-center px-8 text-center">
          <p className="text-[20px] font-extrabold" style={{ color: '#fafafb', letterSpacing: '-0.02em' }}>
            Здесь пока тихо
          </p>
          <p className="mt-2 max-w-xs text-[13px] leading-relaxed" style={{ color: '#7d818c' }}>
            В каталоге ещё нет опубликованных треков. Загрузите свои — они появятся
            здесь и будут слышны с любого устройства.
          </p>
          {onUpload && (
            <button type="button" onClick={onUpload}
              className="mt-5 rounded-2xl px-5 py-3 text-[13px] font-bold"
              style={{ background: '#fff', color: '#0a0a0f' }}>
              Загрузить трек
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sky-music-scope relative h-full" style={{ background: 'var(--bg)' }}>
      <div className="h-full overflow-y-auto pb-8" style={{ scrollbarWidth: 'none' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-1">
        <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="text-[24px] font-extrabold" style={{ color: '#fafafb', letterSpacing: '-0.03em' }}>
          {greeting()}
        </motion.p>
        <button type="button" onClick={onSearch} aria-label="Поиск" className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <Search size={16} style={{ color: '#c7ccd6' }}/>
        </button>
      </div>

      {/* «Мой поток»: спокойная волна, пока тихо; при музыке — движение, лучи, исполнитель и мини-плеер (FlowHero). */}
      <div className="px-5 pt-4 pb-1">
        <FlowHero cur={cur} last={lastUnfinished} playing={playing} liked={Boolean((cur ?? lastUnfinished) && favorites.includes((cur ?? lastUnfinished)!.id))}
          c1={c1} c2={c2} onStart={startWave} onOpenWave={() => setWaveOpen(true)} onOpenPlayer={onOpenPlayer}
          onToggle={() => { if (cur) onTogglePlay(); else if (lastUnfinished) onPlay(lastUnfinished, [lastUnfinished]); }}
          onLike={() => { const x = cur ?? lastUnfinished; if (x) onLike(x.id); }} />
      </div>


      <div className="h-2"/>

      {feed.length > 0 && (
        <Section title="Новое у ваших артистов" icon={Sparkles} index={0}>
          {feed.map(t => (
            <TrackTile key={t.id} t={t} active={activeId===t.id} playing={playing} onPlay={() => onPlay(t, feed)}/>
          ))}
        </Section>
      )}

      <Section title="Недавно слушали" icon={Disc3} index={1} empty={recentlyPlayed.length===0 ? 'Пока ничего не прослушано' : undefined}>
        {recentlyPlayed.map(t => (
          <TrackTile key={t.id} t={t} active={activeId===t.id} playing={playing} onPlay={() => onPlay(t, recentlyPlayed)}/>
        ))}
      </Section>

      <Section title="Для вас" icon={Sparkles} index={2}>
        {forYou.map(t => (
          <TrackTile key={t.id} t={t} active={activeId===t.id} playing={playing} onPlay={() => onPlay(t, forYou)}/>
        ))}
      </Section>

      <Section title="Новые релизы" icon={Disc3} index={3}>
        {fresh.map(t => (
          <TrackTile key={t.id} t={t} active={activeId===t.id} playing={playing} onPlay={() => onPlay(t, fresh)}/>
        ))}
      </Section>

      <Section title="Любимые исполнители" icon={Mic2} index={4}>
        {favoriteArtists.map(([artist, ts]) => (
          <motion.div key={artist} whileTap={{ scale: 0.95 }} className="shrink-0 text-center" style={{ width: 100 }}>
            <div className="mx-auto mb-2.5 grid h-24 w-24 place-items-center rounded-full"
              style={{ background: `linear-gradient(150deg,${getG(artist)[0]},${getG(artist)[1]})`, boxShadow: '0 6px 20px -6px rgba(0,0,0,0.5)' }}>
              <Mic2 size={24} color="rgba(255,255,255,0.45)"/>
            </div>
            <p className="truncate text-[12.5px] font-semibold" style={{ color: '#f0f1f4' }}>{artist}</p>
            <p className="text-[11px] mt-0.5" style={{ color: '#5c626e' }}>{ts.length} тр.</p>
          </motion.div>
        ))}
      </Section>

      <Section title="Альбомы" icon={ListMusic} index={5}>
        {albums.map(([name, ts]) => (
          <button key={name} type="button" onClick={() => ts[0] && onPlay(ts[0], ts)} className="shrink-0 text-left" style={{ width: 148 }}>
            <div className="grid h-[148px] w-[148px] place-items-center rounded-2xl" style={{
              background: `linear-gradient(150deg,${getG(name)[0]},${getG(name)[1]})`,
              boxShadow: '0 4px 16px -4px rgba(0,0,0,0.4)',
            }}>
              <ListMusic size={28} color="rgba(255,255,255,0.3)"/>
            </div>
            <p className="mt-2.5 truncate text-[13.5px] font-semibold" style={{ color: '#f0f1f4' }}>{name.split(' · ')[0]}</p>
            <p className="truncate text-[12px] mt-0.5" style={{ color: '#5c626e' }}>{name.split(' · ')[1]}</p>
          </button>
        ))}
      </Section>

      <Section title="Популярное сейчас" icon={Heart} index={9}>
        {popularNow.map(t => (
          <TrackTile key={t.id} t={t} active={activeId===t.id} playing={playing} onPlay={() => onPlay(t, popularNow)}/>
        ))}
      </Section>

      <style>{`@keyframes skyMusicEq { from { transform: scaleY(0.4); } to { transform: scaleY(1.6); } }`}</style>
      </div>

      <AnimatePresence>
        {waveOpen && (
          <WaveSheet pool={wavePool} c1={c1} c2={c2} playing={playing} activeId={activeId}
            onPlay={(t) => { onPlay(t, wavePool); }}
            onClose={() => setWaveOpen(false)}/>
        )}
      </AnimatePresence>
    </div>
  );
};