/* -- Страница исполнителя (карточка музыканта) --------------------------------
 * Крупное фото сверху, имя, кнопки (подписка · моя волна · слушать), затем: новый релиз, популярные треки,
 * «Моя волна по артисту», альбомы, «Об исполнителе», похожие исполнители. Управление карточкой (владелец,
 * заявка на владение, фото и баннер) — прежний блок ArtistCardBlock в самом низу; его логика не менялась.
 * Только настоящие данные: прослушивания, подписчики и альбомы берутся из каталога и с сервера. */
import { ExplicitBadge } from '@/labels/Labels';
import { ArtistCardBlock, useArtistCard } from '@/artists/ArtistCard';
import { useCardImage } from '@/artists/CardImages';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Heart, Headphones, Music2, Play, Pause, AudioLines, Sparkles } from 'lucide-react';
import { apiArtistByName, apiFollowArtist, type ServerArtist } from './musicApi';
import type { Track } from '@/platform/store';
import { getG, fmtPlays } from './utils';

interface Props {
  artist: string; tracks: Track[]; favorites: string[]; playing: boolean; activeId: string | null;
  onPlay: (t: Track, pool: Track[]) => void; onLike: (id: string) => void; onAdd: (id: string) => void;
  onArtist?: (name: string) => void; onClose: () => void;
}

const ACCENT = '#c4b5fd';
const kind = (n: number) => (n === 1 ? 'трек' : n < 5 ? 'трека' : 'треков');

const Cover = ({ t, size, radius = 10 }: { t?: Track; size: number; radius?: number }) => {
  const [a, b] = getG(t?.id ?? 'x');
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden" style={{ width: size, height: size, borderRadius: radius, background: `linear-gradient(135deg,${a},${b})` }}>
      {t?.coverUrl ? <img src={t.coverUrl} alt="" className="h-full w-full object-cover" /> : <Music2 size={Math.round(size / 3)} color="rgba(255,255,255,0.45)" />}
    </span>
  );
};

const Title = ({ children, onMore }: { children: string; onMore?: () => void }) => (
  <h2 className="mb-3 flex items-center gap-1 px-5 text-[22px] font-black tracking-tight" style={{ color: 'var(--t1)' }}>
    {onMore ? <button type="button" onClick={onMore} className="flex items-center gap-1 font-black">{children}<ChevronRight size={20} /></button> : children}
  </h2>
);

/** Имя исполнителя без регистра, лишних пробелов и «ё»; «А, Б», «А feat. Б», «А & Б» — это несколько исполнителей. */
const normName = (v: string) => v.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const nameParts = (v: string) => v.split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b|×)\s*/i).map(normName).filter(Boolean);
const hasArtist = (trackArtist: string, artist: string) => {
  const a = normName(artist);
  return normName(trackArtist) === a || nameParts(trackArtist).includes(a);
};

export const ArtistProfile = ({ artist, tracks, favorites, playing, activeId, onPlay, onLike, onAdd, onArtist, onClose }: Props) => {
  const artTracks = useMemo(() => tracks.filter((t) => hasArtist(t.artist, artist) && t.status === 'published'), [tracks, artist]);
  const sorted = useMemo(() => [...artTracks].sort((a, b) => b.plays - a.plays), [artTracks]);
  const totalPlays = artTracks.reduce((a, t) => a + t.plays, 0);
  const genres = useMemo(() => [...new Set(artTracks.map((t) => t.genre).filter(Boolean))], [artTracks]);
  const newest = useMemo(() => [...artTracks].sort((a, b) => b.addedAt.localeCompare(a.addedAt))[0], [artTracks]);
  const [showAll, setShowAll] = useState(false);
  const [more, setMore] = useState(false);

  const card = useArtistCard(artist);
  const photo = useCardImage(card?.id ?? '', 'photo', Boolean(card?.hasPhoto));
  const banner = useCardImage(card?.id ?? '', 'banner', Boolean(card?.hasBanner));
  const heroCover = sorted.find((t) => t.coverUrl)?.coverUrl;
  const hero = photo ?? banner ?? heroCover ?? null;
  const [g1, g2] = getG(artist);

  // Подписка — на сервере (кнопка только если у артиста есть профиль).
  const [profile, setProfile] = useState<ServerArtist | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; setProfile(null); setShowAll(false); setMore(false); void apiArtistByName(artist).then((a) => { if (alive) setProfile(a); }); return () => { alive = false; }; }, [artist]);
  const follow = async () => {
    if (!profile || profile.own || busy) return;
    setBusy(true); const fresh = await apiFollowArtist(profile.id, !profile.following); setBusy(false); if (fresh) setProfile(fresh);
  };

  const albums = useMemo(() => {
    const m = new Map<string, Track[]>();
    artTracks.forEach((t) => { if (t.album?.trim()) (m.get(t.album.trim()) ?? m.set(t.album.trim(), []).get(t.album.trim())!).push(t); });
    return [...m.entries()].sort((a, b) => b[1].reduce((s, t) => s + t.plays, 0) - a[1].reduce((s, t) => s + t.plays, 0)).slice(0, 10);
  }, [artTracks]);

  const similar = useMemo(() => {
    const m = new Map<string, Track[]>();
    tracks.filter((t) => t.status === 'published' && !hasArtist(t.artist, artist) && genres.includes(t.genre)).forEach((t) => { (m.get(t.artist) ?? m.set(t.artist, []).get(t.artist)!).push(t); });
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
  }, [tracks, artist, genres]);

  /** «Моя волна по артисту»: песни артиста, затем похожие по жанру. */
  const waveByArtist = () => {
    const rest = similar.flatMap(([, ts]) => ts).sort(() => Math.random() - 0.5);
    const pool = [...sorted, ...rest];
    if (pool[0]) onPlay(pool[0], pool);
  };

  const topN = showAll ? sorted : sorted.slice(0, 5);
  const isCur = (t: Track) => activeId === t.id;
  const playAll = () => { if (sorted[0]) onPlay(sorted[0], sorted); };

  return (
    <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute inset-0 z-50 overflow-y-auto" style={{ background: 'var(--bg)', scrollbarWidth: 'none' }}>
      {/* Фото */}
      <div className="relative" style={{ height: 440, background: `linear-gradient(160deg,${g1},${g2})` }}>
        {hero && <img src={hero} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ filter: photo ? undefined : 'saturate(.9)' }} />}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.38) 0%, transparent 28%, transparent 48%, rgba(10,8,24,0.78) 100%)' }} />
        <button type="button" onClick={onClose} aria-label="Назад" className="absolute left-3 grid h-10 w-10 place-items-center rounded-full" style={{ top: 'calc(env(safe-area-inset-top) + 10px)', background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)', color: '#fff' }}><ChevronLeft size={22} /></button>
        <div className="absolute inset-x-0 bottom-0 px-5 pb-5 text-center">
          <h1 translate="no" className="break-words text-[40px] font-black leading-[1.05] tracking-tight text-white" style={{ textShadow: '0 2px 18px rgba(0,0,0,0.35)' }}>{artist}</h1>
          <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[15px] font-semibold text-white/85"><Headphones size={16} />{fmtPlays(totalPlays)} прослушиваний</p>
          <div className="mt-4 flex items-start justify-center gap-7">
            {profile && !profile.own && (
              <div className="flex w-[72px] flex-col items-center gap-1.5">
                <button type="button" disabled={busy} onClick={() => void follow()} aria-pressed={profile.following} aria-label={profile.following ? 'Отписаться' : 'Подписаться'} className="grid h-[64px] w-[64px] place-items-center rounded-full disabled:opacity-60" style={{ background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(10px)' }}>
                  <Heart size={28} color="#fff" fill={profile.following ? '#fff' : 'none'} />
                </button>
                <span className="text-[13px] font-semibold text-white/85">{profile.followers}</span>
              </div>)}
            <div className="flex w-[72px] flex-col items-center gap-1.5">
              <button type="button" onClick={waveByArtist} aria-label="Моя волна по артисту" className="grid h-[64px] w-[64px] place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(10px)' }}><AudioLines size={28} color="#fff" /></button>
              <span className="text-[13px] font-semibold text-white/85">Волна</span>
            </div>
            <div className="flex w-[72px] flex-col items-center gap-1.5">
              <button type="button" onClick={playAll} aria-label="Слушать" className="grid h-[64px] w-[64px] place-items-center rounded-full" style={{ background: 'linear-gradient(135deg,#fff,#e9d5ff)', boxShadow: '0 8px 26px rgba(167,139,250,0.5)' }}><Play size={26} fill="#111" color="#111" style={{ marginLeft: 3 }} /></button>
              <span className="text-[13px] font-semibold text-white/85">Слушать</span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-8 pb-28 pt-7">
        {artTracks.length === 0 && <p className="px-5 text-[14px]" style={{ color: 'var(--t3)' }}>У этого исполнителя пока нет опубликованных треков.</p>}

        {newest && (
          <section>
            <Title>Новый релиз</Title>
            <button type="button" onClick={() => onPlay(newest, [newest])} className="flex w-full items-center gap-4 px-5 text-left">
              <Cover t={newest} size={84} radius={14} />
              <span className="min-w-0 flex-1">
                <span translate="no" className="block truncate text-[18px] font-semibold" style={{ color: 'var(--t1)' }}>{newest.album?.trim() || newest.title}</span>
                <span className="mt-0.5 block text-[14px]" style={{ color: 'var(--t3)' }}>{new Date(newest.addedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                <span className="block text-[12px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>{(albums.find(([n]) => n === (newest.album ?? '').trim())?.[1].length ?? 0) > 1 ? 'альбом' : 'сингл'}</span>
              </span>
              <ChevronRight size={20} style={{ color: 'var(--t3)' }} />
            </button>
          </section>)}

        {sorted.length > 0 && (
          <section>
            <Title onMore={sorted.length > 5 ? () => setShowAll((v) => !v) : undefined}>Популярные треки</Title>
            <div>
              {topN.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-2" style={{ background: isCur(t) ? 'rgba(168,85,247,0.12)' : 'transparent' }}>
                  <button type="button" onClick={() => onPlay(t, sorted)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="relative"><Cover t={t} size={54} />
                      {isCur(t) && <span className="absolute inset-0 grid place-items-center rounded-[10px]" style={{ background: 'rgba(0,0,0,0.45)' }}>{playing ? <Pause size={18} fill="#fff" color="#fff" /> : <Play size={18} fill="#fff" color="#fff" />}</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span translate="no" className="block truncate text-[16px] font-medium" style={{ color: 'var(--t1)' }}>{t.title}<ExplicitBadge show={t.explicit} /></span>
                      <span className="flex items-center gap-1 text-[13px]" style={{ color: 'var(--t3)' }}><Play size={9} fill="currentColor" />{fmtPlays(t.plays)}</span>
                    </span>
                  </button>
                  <button type="button" onClick={() => onLike(t.id)} aria-label="В избранное" aria-pressed={favorites.includes(t.id)} className="grid h-9 w-9 place-items-center"><Heart size={20} color={favorites.includes(t.id) ? '#ff4d6d' : 'var(--t3)'} fill={favorites.includes(t.id) ? '#ff4d6d' : 'none'} /></button>
                  <button type="button" onClick={() => onAdd(t.id)} aria-label="Добавить в плейлист" className="grid h-9 w-9 place-items-center text-[20px] font-black" style={{ color: 'var(--t3)' }}>⋯</button>
                </div>))}
            </div>
            {sorted.length > 5 && <button type="button" onClick={() => setShowAll((v) => !v)} className="mx-5 mt-2 text-[13px] font-bold" style={{ color: ACCENT }}>{showAll ? 'Свернуть' : `Показать все (${sorted.length})`}</button>}
          </section>)}

        {sorted.length > 0 && (
          <section>
            <Title>Моя волна по артисту</Title>
            <button type="button" onClick={waveByArtist} className="mx-5 block w-[calc(100%-40px)] overflow-hidden rounded-[22px] py-4 text-center" style={{ background: 'linear-gradient(120deg,#5b21b6,#c026d3 55%,#3b82f6)', color: '#fff' }}>
              <span className="block text-[14px] font-semibold opacity-85">Моя волна по артисту</span>
              <span translate="no" className="mt-0.5 flex items-center justify-center gap-1.5 text-[22px] font-black"><Play size={16} fill="#fff" color="#fff" />{artist}</span>
            </button>
            <p className="mx-5 mt-1.5 text-[11.5px]" style={{ color: 'var(--t3)' }}>Песни артиста, затем похожие по жанру.</p>
          </section>)}

        {albums.length > 0 && (
          <section>
            <Title>Популярные альбомы</Title>
            <div className="flex gap-4 overflow-x-auto px-5 pb-1" style={{ scrollbarWidth: 'none' }}>
              {albums.map(([name, ts]) => (
                <button key={name} type="button" onClick={() => ts[0] && onPlay(ts[0], ts)} className="shrink-0 text-left" style={{ width: 168 }}>
                  <Cover t={ts.find((x) => x.coverUrl) ?? ts[0]} size={168} radius={18} />
                  <span translate="no" className="mt-2 block truncate text-[16px] font-medium" style={{ color: 'var(--t1)' }}>{name}</span>
                  <span className="block text-[13px]" style={{ color: 'var(--t3)' }}>{ts.length} {kind(ts.length)}</span>
                </button>))}
            </div>
          </section>)}

        <section>
          <button type="button" onClick={() => setMore((v) => !v)} className="relative mx-5 block w-[calc(100%-40px)] overflow-hidden rounded-[22px] text-left" style={{ minHeight: 190, background: `linear-gradient(160deg,${g1},${g2})` }}>
            {(banner ?? photo ?? heroCover) && <img src={(banner ?? photo ?? heroCover)!} alt="" className="absolute inset-0 h-full w-full object-cover" />}
            <span className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(10,8,24,0.85), rgba(10,8,24,0.15) 70%)' }} />
            <span className="absolute inset-x-0 bottom-0 p-5 text-white">
              <span className="block text-[22px] font-black">Об исполнителе</span>
              <span className="block text-[14px] font-semibold opacity-70">{more ? 'Свернуть' : 'Ещё'}</span>
            </span>
          </button>
          {more && (
            <div className="mx-5 mt-3 space-y-2 text-[14px] leading-relaxed" style={{ color: 'var(--t2)' }}>
              {(profile?.bio || card?.bio) ? <p translate="no">{profile?.bio || card?.bio}</p> : <p style={{ color: 'var(--t3)' }}>Исполнитель пока ничего не рассказал о себе.</p>}
              {genres.length > 0 && <p><b style={{ color: 'var(--t1)' }}>Жанры:</b> <span translate="no">{genres.join(', ')}</span></p>}
              <p><b style={{ color: 'var(--t1)' }}>В каталоге:</b> {artTracks.length} {kind(artTracks.length)}, {fmtPlays(totalPlays)} прослушиваний</p>
            </div>)}
        </section>

        {similar.length > 0 && (
          <section>
            <Title>Похожие исполнители</Title>
            <div className="flex gap-4 overflow-x-auto px-5 pb-1" style={{ scrollbarWidth: 'none' }}>
              {similar.map(([name, ts]) => (
                <button key={name} type="button" onClick={() => (onArtist ? onArtist(name) : ts[0] && onPlay(ts[0], ts))} className="shrink-0 text-center" style={{ width: 150 }}>
                  <span className="mx-auto block overflow-hidden rounded-full" style={{ width: 150, height: 150 }}><Cover t={ts.find((x) => x.coverUrl) ?? ts[0]} size={150} radius={75} /></span>
                  <span translate="no" className="mt-2 block truncate text-[15px] font-medium" style={{ color: 'var(--t1)' }}>{name}</span>
                </button>))}
            </div>
          </section>)}

        <section>
          <h2 className="mb-2 flex items-center gap-1.5 px-5 text-[13px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}><Sparkles size={13} />Карточка музыканта</h2>
          <ArtistCardBlock name={artist} />
        </section>
      </div>
    </motion.div>
  );
};
