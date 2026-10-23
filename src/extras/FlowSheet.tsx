/**
 * Окошко внутри карточки «Мой поток» (открывается по нажатию на «Мои любимые»): три вкладки —
 * плейлисты человека, очередь (следующие треки можно менять местами) и сборки волны по вкусу, настроению и исполнителю.
 */
import { useMemo, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { ChevronLeft, GripVertical, Music2, Play, Sparkles, X } from 'lucide-react';
import type { Track } from '@/platform/store';
import { useMusicStore } from '@/music/serverStore';
import { usePlayerStore, type PlayerItem } from '@/player/playerStore';
import { buildTaste, recommend, moodOf, MOODS } from '@/music/taste';

type Tab = 'playlists' | 'queue' | 'waves';
const TABS: { id: Tab; label: string }[] = [{ id: 'playlists', label: 'Плейлисты' }, { id: 'queue', label: 'Очередь' }, { id: 'waves', label: 'Сборки волны' }];
const YELLOW = '#e9d5ff';

const Cover = ({ url, size = 40 }: { url?: string; size?: number }) => (
  <span className="grid shrink-0 place-items-center overflow-hidden rounded-[10px]" style={{ width: size, height: size, background: 'rgba(255,255,255,0.1)' }}>
    {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <Music2 size={size * 0.42} color="rgba(255,255,255,0.45)" />}
  </span>
);

const Row = ({ cover, title, sub, onClick, right }: { cover?: string; title: string; sub?: string; onClick?: () => void; right?: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-left active:bg-white/10">
    <Cover url={cover} />
    <span className="min-w-0 flex-1"><span translate="no" className="block truncate text-[13.5px] font-semibold text-white">{title}</span>
      {sub && <span translate="no" className="block truncate text-[11.5px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{sub}</span>}</span>
    {right}
  </button>
);

/* ── Плейлисты ─────────────────────────────────────────────────────── */
const Playlists = ({ onPlay }: { onPlay: (t: Track, pool: Track[]) => void }) => {
  const playlists = useMusicStore((s) => s.playlists);
  const [openId, setOpenId] = useState<string | null>(null);
  const pl = playlists.find((p) => p.id === openId) ?? null;
  if (pl) {
    return (
      <div>
        <button type="button" onClick={() => setOpenId(null)} className="mb-1 flex items-center gap-1 text-[12px] font-bold" style={{ color: YELLOW }}><ChevronLeft size={15} /> Плейлисты</button>
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div className="min-w-0"><p translate="no" className="truncate text-[15px] font-extrabold text-white">{pl.name}</p>
            <p className="text-[11.5px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{pl.tracks.length} {pl.tracks.length === 1 ? 'трек' : pl.tracks.length < 5 ? 'трека' : 'треков'}</p></div>
          {pl.tracks.length > 0 && (
            <button type="button" onClick={() => onPlay(pl.tracks[0], pl.tracks)} className="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold" style={{ background: YELLOW, color: '#111' }}>
              <Play size={13} fill="#111" color="#111" /> Слушать
            </button>
          )}
        </div>
        {pl.tracks.length === 0 && <p className="px-1 py-4 text-[12.5px]" style={{ color: 'rgba(255,255,255,0.6)' }}>В плейлисте пока нет песен.</p>}
        {pl.tracks.map((t) => <Row key={t.id} cover={t.coverUrl} title={t.title} sub={t.artist} onClick={() => onPlay(t, pl.tracks)} />)}
      </div>
    );
  }
  if (playlists.length === 0) return <p className="px-1 py-6 text-center text-[12.5px]" style={{ color: 'rgba(255,255,255,0.6)' }}>У вас пока нет плейлистов. Создайте плейлист в «Коллекции».</p>;
  return (
    <div>
      {playlists.map((p) => (
        <Row key={p.id} cover={p.tracks[0]?.coverUrl} title={p.name} sub={`${p.count} ${p.count === 1 ? 'трек' : p.count < 5 ? 'трека' : 'треков'}`} onClick={() => setOpenId(p.id)}
          right={<ChevronLeft size={16} color="rgba(255,255,255,0.4)" style={{ transform: 'rotate(180deg)' }} />} />
      ))}
    </div>
  );
};

/* ── Очередь ───────────────────────────────────────────────────────── */
const QueueRow = ({ q, onPlay }: { q: PlayerItem; onPlay: () => void }) => {
  const controls = useDragControls();
  return (
    <Reorder.Item value={q.id} dragListener={false} dragControls={controls} className="list-none" style={{ position: 'relative' }}>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-1.5 text-left active:bg-white/10">
          <Cover url={q.coverUrl} />
          <span className="min-w-0 flex-1"><span translate="no" className="block truncate text-[13.5px] font-semibold text-white">{q.title}</span>
            <span translate="no" className="block truncate text-[11.5px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{q.author}</span></span>
        </button>
        <span onPointerDown={(e) => { e.preventDefault(); controls.start(e); }} role="img" aria-label="Перетащить" className="grid h-10 w-9 shrink-0 cursor-grab place-items-center touch-none" style={{ color: 'rgba(255,255,255,0.5)' }}>
          <GripVertical size={18} />
        </span>
      </div>
    </Reorder.Item>
  );
};

const Queue = () => {
  const item = usePlayerStore((s) => s.item); const shuffle = usePlayerStore((s) => s.shuffle);
  const reorder = usePlayerStore((s) => s.reorderUpcoming); const playAt = usePlayerStore((s) => s.playQueueIndex);
  const queue = item?.queue ?? []; const cur = item?.qIdx ?? 0;
  const upcoming = queue.slice(cur + 1);
  if (!item || queue.length === 0) return <p className="px-1 py-6 text-center text-[12.5px]" style={{ color: 'rgba(255,255,255,0.6)' }}>Очередь пуста — включите песню или поток.</p>;
  return (
    <div>
      <p className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.45)' }}>Сейчас</p>
      <Row cover={item.coverUrl} title={item.title} sub={item.author} right={<Sparkles size={15} color={YELLOW} />} />
      <p className="px-1 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.45)' }}>Дальше{upcoming.length ? ` · ${upcoming.length}` : ''}</p>
      {shuffle && <p className="mb-1 rounded-xl px-3 py-2 text-[11.5px]" style={{ background: 'rgba(196,181,253,0.14)', color: YELLOW }}>Включено перемешивание — следующий трек выбирается случайно, порядок ниже не учитывается.</p>}
      {upcoming.length === 0 ? <p className="px-1 py-2 text-[12.5px]" style={{ color: 'rgba(255,255,255,0.6)' }}>Дальше ничего нет.</p> : (
        <Reorder.Group axis="y" values={upcoming.map((q) => q.id)} onReorder={reorder} className="m-0 p-0">
          {upcoming.map((q, i) => <QueueRow key={q.id} q={q} onPlay={() => playAt(cur + 1 + i)} />)}
        </Reorder.Group>
      )}
      <p className="px-1 pt-2 text-[10.5px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Порядок меняется только в очереди; плейлист остаётся как был.</p>
    </div>
  );
};

/* ── Сборки волны ──────────────────────────────────────────────────── */
const Waves = ({ tracks, favorites, onPlay }: { tracks: Track[]; favorites: string[]; onPlay: (t: Track, pool: Track[]) => void }) => {
  const history = useMusicStore((s) => s.history);
  const pub = useMemo(() => tracks.filter((t) => t.status === 'published'), [tracks]);
  const taste = useMemo(() => buildTaste(history, tracks.filter((t) => favorites.includes(t.id))), [history, tracks, favorites]);
  const heard = useMemo(() => new Set(history.map((t) => t.id)), [history]);
  const share = (genre?: string) => taste.genres.find((x) => x.genre === (genre ?? 'другое').trim().toLowerCase())?.share ?? 0;

  const styleWave = useMemo(() => (taste.total > 0 ? recommend(pub, taste, heard, 40) as Track[] : []), [pub, taste, heard]);
  const moods = useMemo(() => MOODS.map((m) => {
    const list = pub.filter((t) => moodOf(t).some((x) => x.id === m.id));
    const affinity = list.reduce((s, t) => s + share(t.genre), 0);
    return { ...m, list: taste.total > 0 ? (recommend(list, taste, heard, 40) as Track[]) : list, affinity };
  }).filter((m) => m.list.length > 0).sort((a, b) => b.affinity - a.affinity), // eslint-disable-next-line react-hooks/exhaustive-deps
  [pub, taste, heard]);
  const artists = useMemo(() => {
    const byName = new Map<string, Track[]>(); pub.forEach((t) => { const k = (t.artist ?? '').trim(); if (k) byName.set(k, [...(byName.get(k) ?? []), t]); });
    const ranked = taste.total > 0 ? taste.artists.map((a) => a.artist) : [...byName.keys()].sort((a, b) => (byName.get(b)?.length ?? 0) - (byName.get(a)?.length ?? 0));
    return ranked.filter((a) => byName.has(a)).slice(0, 8).map((a) => {
      const own = byName.get(a)!; const g = own[0].genre;
      // Волна исполнителя: его песни, затем похожие по жанру.
      const similar = (recommend(pub.filter((t) => t.artist !== a && (t.genre ?? '') === (g ?? '')), taste, heard, 20) as Track[]);
      return { name: a, own, list: [...own, ...similar], cover: own[0].coverUrl };
    });
  }, [pub, taste, heard]);

  const go = (list: Track[]) => { if (list[0]) onPlay(list[0], list); };
  const top = taste.genres[0];
  const Head = ({ children }: { children: React.ReactNode }) => <p className="px-1 pb-1.5 pt-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.45)' }}>{children}</p>;
  return (
    <div>
      <button type="button" disabled={styleWave.length === 0} onClick={() => go(styleWave)} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left disabled:opacity-60" style={{ background: 'linear-gradient(120deg, rgba(255,229,0,0.2), rgba(255,31,240,0.22))' }}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: YELLOW }}><Play size={16} fill="#111" color="#111" style={{ marginLeft: 2 }} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-extrabold text-white">Волна по вашему стилю</span>
          <span className="block text-[11.5px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {top ? <>Больше всего вы слушаете: <b translate="no">{top.genre}</b> — {Math.round(top.share * 100)}%</> : 'Послушайте несколько песен — и здесь появится волна по вашему вкусу.'}
          </span>
        </span>
      </button>

      {moods.length > 0 && <>
        <Head>По настроению</Head>
        <div className="flex flex-wrap gap-2 px-1">
          {moods.map((m) => (
            <button key={m.id} type="button" onClick={() => go(m.list)} className="rounded-full px-3.5 py-1.5 text-[12.5px] font-bold text-white" style={{ background: 'rgba(255,255,255,0.14)' }}>
              {m.name} <span style={{ color: 'rgba(255,255,255,0.5)' }}>{m.list.length}</span>
            </button>
          ))}
        </div>
        <p className="px-1 pt-1.5 text-[10.5px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Настроение определяется по жанру трека; звук не анализируется.</p>
      </>}

      {artists.length > 0 && <>
        <Head>По исполнителю</Head>
        {artists.map((a) => (
          <Row key={a.name} cover={a.cover} title={a.name} sub={a.own.length === 1 ? '1 песня + похожие' : a.own.length < 5 ? `${a.own.length} песни + похожие` : `${a.own.length} песен + похожие`} onClick={() => go(a.list)}
            right={<span className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.14)' }}><Play size={13} fill="#fff" color="#fff" style={{ marginLeft: 1 }} /></span>} />
        ))}
      </>}
      {pub.length === 0 && <p className="px-1 py-6 text-center text-[12.5px]" style={{ color: 'rgba(255,255,255,0.6)' }}>В каталоге пока нет опубликованных треков.</p>}
    </div>
  );
};

export const FlowSheet = ({ tracks, favorites, onPlay, onClose }: {
  tracks: Track[]; favorites: string[]; onPlay: (t: Track, pool: Track[]) => void; onClose: () => void;
}) => {
  const [tab, setTab] = useState<Tab>('playlists');
  const play = (t: Track, pool: Track[]) => { onPlay(t, pool); onClose(); };
  return (
    <div className="absolute inset-0 flex flex-col" style={{ zIndex: 30, background: 'rgba(16,8,38,0.95)', backdropFilter: 'blur(18px)' }} onClick={(e) => e.stopPropagation()}>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
        <div role="tablist" className="flex min-w-0 flex-1 gap-1 rounded-full p-1" style={{ background: 'rgba(255,255,255,0.1)' }}>
          {TABS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
              className="min-w-0 flex-1 whitespace-nowrap rounded-full px-1 py-1.5 text-[11.5px] font-bold" style={{ background: tab === x.id ? YELLOW : 'transparent', color: tab === x.id ? '#111' : 'rgba(255,255,255,0.8)' }}>{x.label}</button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}><X size={17} color="#fff" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" style={{ scrollbarWidth: 'none' }}>
        {tab === 'playlists' && <Playlists onPlay={play} />}
        {tab === 'queue' && <Queue />}
        {tab === 'waves' && <Waves tracks={tracks} favorites={favorites} onPlay={play} />}
      </div>
    </div>
  );
};

