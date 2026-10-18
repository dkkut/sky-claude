import { ExplicitBadge } from '@/labels/Labels';
/* -- Профиль артиста --------------------------------------- */
import { ArtistCardBlock } from '@/artists/ArtistCard';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Pause, Music2, Mic2, UserPlus, UserMinus } from 'lucide-react';
import { apiArtistByName, apiFollowArtist, type ServerArtist } from './musicApi';
import type { Track } from '@/platform/store';
import { getG, fmtPlays } from './utils';
import { Cover, TrackRow, Viz } from './MusicPrimitives';

interface Props {
  artist:   string;
  tracks:   Track[];
  favorites: string[];
  playing:  boolean;
  activeId: string | null;
  onPlay:   (t: Track, pool: Track[]) => void;
  onLike:   (id: string) => void;
  onAdd:    (id: string) => void;
  onClose:  () => void;
}

export const ArtistProfile = ({ artist, tracks, favorites, playing, activeId, onPlay, onLike, onAdd, onClose }: Props) => {
  const artTracks  = tracks.filter(t => t.artist === artist && t.status === 'published');
  const genres     = [...new Set(artTracks.map(t => t.genre))];
  const totalPlays = artTracks.reduce((a, t) => a + t.plays, 0);
  const sorted     = [...artTracks].sort((a, b) => b.plays - a.plays);
  const topTrack   = sorted[0] ?? null;
  const [c1, c2]   = topTrack ? getG(topTrack.id) : ['#0d1b2a', '#1a2a3a'];

  const byGenre = new Map<string, Track[]>();
  artTracks.forEach(t => { byGenre.set(t.genre, [...(byGenre.get(t.genre) ?? []), t]); });

  // Профиль артиста и подписка — с сервера. Прежняя кнопка писала
  // подписку в localStorage этого браузера, и о ней не знал никто.
  const [profile, setProfile] = useState<ServerArtist | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setProfile(null);
    void apiArtistByName(artist).then(a => { if (alive) setProfile(a); });
    return () => { alive = false; };
  }, [artist]);

  const toggleFollow = async () => {
    if (!profile || profile.own) return;
    setBusy(true);
    const fresh = await apiFollowArtist(profile.id, !profile.following);
    setBusy(false);
    if (fresh) setProfile(fresh);
  };

  const similarArtists = useMemo(() => {
    const others = new Map<string, Track[]>();
    tracks.filter(t => t.status === 'published' && t.artist !== artist && genres.includes(t.genre))
      .forEach(t => { others.set(t.artist, [...(others.get(t.artist) ?? []), t]); });
    return [...others.entries()].sort((a,b) => b[1].length - a[1].length).slice(0, 8);
  }, [tracks, artist, genres]);

  return (
    <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute inset-0 z-50 flex flex-col overflow-hidden"
      style={{ background: 'var(--bg)' }}>

      {/* Баннер */}
      <div className="relative shrink-0 overflow-hidden" style={{ height: 180 }}>
        <motion.div key={artist} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="absolute inset-0"
          style={{ background: `linear-gradient(160deg,${c1} 0%,${c2} 50%,var(--bg) 100%)` }}/>
        {[...Array(4)].map((_, i) => (
          <motion.div key={i}
            animate={{ scale: [1, 1.2, 1], opacity: [0.06, 0.14, 0.06] }}
            transition={{ duration: 3 + i * 0.8, repeat: Infinity, delay: i * 0.7 }}
            className="absolute rounded-full pointer-events-none"
            style={{ width: 80 + i * 60, height: 80 + i * 60, background: c2,
              left: `${15 + i * 20}%`, top: `${10 + i * 15}%`, transform: 'translate(-50%,-50%)' }}/>
        ))}
        <button type="button" onClick={onClose}
          className="absolute top-4 left-4 flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-xs font-medium"
          style={{ background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.7)' }}>
          <ArrowLeft size={13}/>Назад
        </button>
      </div>

      {/* Аватар + имя */}
      <div className="relative px-5 -mt-10 pb-3 shrink-0">
        <div className="flex items-end gap-4">
          <div className="grid h-20 w-20 place-items-center rounded-3xl text-4xl font-black text-white shrink-0"
            style={{ background: `linear-gradient(135deg,${c1},${c2})`,
              border: '3px solid var(--bg)', boxShadow: `0 8px 32px ${c1}99` }}>
            {artist[0]?.toUpperCase()}
          </div>
          <div className="pb-1 min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-xl font-black text-white truncate">{artist}</p>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {genres.slice(0, 2).map(g => (
                <span key={g} className="text-[10px] font-semibold rounded-full px-2 py-0.5"
                  style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>{g}</span>
              ))}
            </div>
          </div>
          {/* Кнопка появляется, только если у артиста есть профиль на
              сервере: подписываться иначе не на кого. */}
          {profile && !profile.own && (
            <motion.button type="button" whileTap={{ scale: 0.94 }} disabled={busy}
              onClick={() => void toggleFollow()}
              className="mb-1 flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-bold disabled:opacity-50"
              style={{ background: profile.following ? 'rgba(255,255,255,0.08)' : '#A855F7', color: '#fff' }}>
              {profile.following
                ? <><UserMinus size={13}/>Вы подписаны</>
                : <><UserPlus size={13}/>Подписаться</>}
            </motion.button>
          )}
        </div>

        {profile?.bio && (
          <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--t2)' }}>{profile.bio}</p>
        )}
        <div className="-mx-5 mt-3"><ArtistCardBlock name={artist} /></div>


        {/* Статистика */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          {[
            { label: 'Треков',      val: String(artTracks.length) },
            { label: 'Прослушиваний', val: fmtPlays(totalPlays) },
            { label: 'Подписчиков', val: String(profile?.followers ?? 0) },
          ].map(({ label, val }) => (
            <div key={label} className="rounded-2xl py-2.5 text-center"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <p className="text-base font-black text-white">{val}</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Контент */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-5">

        {/* Топ трек */}
        {topTrack && (
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--t3)' }}>
              Главный хит
            </p>
            <div className="flex items-center gap-3 rounded-2xl p-3"
              style={{ background: `${c2}18`, border: `1px solid ${c2}30` }}>
              <Cover track={topTrack} size={52} playing={playing} active={activeId === topTrack.id}/>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white truncate">{topTrack.title}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>
                  {topTrack.genre} · {fmtPlays(topTrack.plays)} прослушиваний
                </p>
              </div>
              <motion.button type="button" whileTap={{ scale: 0.88 }}
                onClick={() => onPlay(topTrack, artTracks)}
                className="grid h-11 w-11 place-items-center rounded-full shrink-0"
                style={{ background: '#A855F7', boxShadow: '0 4px 20px rgba(168,85,247,0.35)' }}>
                {playing && activeId === topTrack.id
                  ? <Pause size={18} fill="white" className="text-white"/>
                  : <Play  size={18} fill="white" className="text-white ml-0.5"/>}
              </motion.button>
            </div>
          </section>
        )}

        {/* Все треки */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>
              Все треки
            </p>
            <motion.button type="button" whileTap={{ scale: 0.95 }}
              onClick={() => artTracks[0] && onPlay(artTracks[0], artTracks)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white"
              style={{ background: '#A855F7' }}>
              <Play size={11} fill="white"/>Слушать всё
            </motion.button>
          </div>
          <div className="space-y-0.5">
            {sorted.map((t, i) => (
              <TrackRow key={t.id} track={t} index={i} isActive={activeId === t.id}
                isPlaying={playing && activeId === t.id}
                onPlay={() => onPlay(t, artTracks)}
                liked={favorites.includes(t.id)} onLike={() => onLike(t.id)} onAdd={() => onAdd(t.id)}/>
            ))}
          </div>
        </section>

        {/* По жанрам */}
        {byGenre.size > 1 && (
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--t3)' }}>
              По жанрам
            </p>
            {[...byGenre.entries()].map(([genre, ts]) => (
              <div key={genre} className="mb-4">
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--t2)' }}>{genre}</p>
                <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {ts.map(t => {
                    const [gc1, gc2] = getG(t.id);
                    return (
                      <motion.div key={t.id} whileTap={{ scale: 0.96 }}
                        className="shrink-0 cursor-pointer w-28"
                        onClick={() => onPlay(t, ts)}>
                        <div className="relative overflow-hidden rounded-2xl w-28 h-28 mb-2"
                          style={{ background: `linear-gradient(135deg,${gc1},${gc2})` }}>
                          {t.coverUrl && <img src={t.coverUrl} alt="" className="w-full h-full object-cover"/>}
                          {activeId === t.id && (
                            <div className="absolute inset-0 grid place-items-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
                              <Viz playing={playing} bars={5}/>
                            </div>
                          )}
                          {!t.coverUrl && activeId !== t.id && (
                            <div className="absolute inset-0 grid place-items-center">
                              <Music2 size={28} style={{ color: 'rgba(255,255,255,0.3)' }}/>
                            </div>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-white truncate">{t.title}<ExplicitBadge show={t.explicit} /></p>
                        <p className="flex items-center gap-1 text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}><Play size={9} fill="currentColor"/> {fmtPlays(t.plays)}</p>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Похожие исполнители */}
        {similarArtists.length > 0 && (
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--t3)' }}>
              Похожие исполнители
            </p>
            <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {similarArtists.map(([name, ts]) => {
                const [gc1, gc2] = getG(name);
                return (
                  <button key={name} type="button" onClick={() => ts[0] && onPlay(ts[0], ts)}
                    className="shrink-0 text-center" style={{ width: 84 }}>
                    <div className="mx-auto mb-1.5 grid h-16 w-16 place-items-center rounded-full"
                      style={{ background: `linear-gradient(135deg,${gc1},${gc2})` }}>
                      <Mic2 size={18} color="rgba(255,255,255,0.5)"/>
                    </div>
                    <p className="truncate text-[11px] font-semibold text-white">{name}</p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Концерты и клипы — пока нет данных, честная заглушка вместо выдуманных дат/ссылок */}
        <section className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl p-3 text-center" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <p className="text-[11px] font-semibold" style={{ color: 'var(--t3)' }}>Концерты</p>
            <p className="mt-1 text-[10.5px]" style={{ color: 'var(--t3)' }}>Пока не запланировано</p>
          </div>
          <div className="rounded-2xl p-3 text-center" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <p className="text-[11px] font-semibold" style={{ color: 'var(--t3)' }}>Клипы</p>
            <p className="mt-1 text-[10.5px]" style={{ color: 'var(--t3)' }}>Скоро появятся</p>
          </div>
        </section>

        {/* Комментариев здесь нет намеренно.
            Прежний блок складывал написанное в localStorage: человек
            видел свой «комментарий», а больше его не видел никто и
            никогда — ни артист, ни другие слушатели. Настоящие
            комментарии — это общий текст на сервере, а значит жалобы,
            блокировки и разбор споров; это отдельная работа, и делать
            вид, что она уже сделана, нельзя. */}
      </div>
    </motion.div>
  );
};
