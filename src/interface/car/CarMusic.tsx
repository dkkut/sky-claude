import { ExplicitBadge } from '@/labels/Labels';
/* ===========================================================
   SKY CAR — Музыка. Тот же серверный каталог, история, избранное,
   личная коллекция и плейлисты (useMusicStore), что и в Sky Music;
   запуск собирает очередь и кладёт её в ЕДИНЫЙ плеер.
=========================================================== */
import { useEffect, useMemo, useState } from 'react';
import { Music2, Heart, History, Library, ListMusic, Disc3, RefreshCw } from 'lucide-react';
import { useMusicStore } from '@/music/serverStore';
import { playMusicQueue } from '@/music/useMusicSync';
import { usePlayerStore } from '@/player/playerStore';
import type { Track } from '@/platform/store';
import { CAR_ACCENT, CAR_BLUR, CAR_GLASS, CAR_GLASS_BORDER } from './carTheme';

type Tab = 'recent' | 'fav' | 'mine' | 'playlists' | 'all';
const TABS: { key: Tab; label: string; icon: typeof Heart }[] = [
  { key: 'recent', label: 'Недавние', icon: History }, { key: 'fav', label: 'Любимые', icon: Heart },
  { key: 'mine', label: 'Моя музыка', icon: Library }, { key: 'playlists', label: 'Плейлисты', icon: ListMusic }, { key: 'all', label: 'Каталог', icon: Disc3 },
];

const Row = ({ t, active, onPlay }: { t: Track; active: boolean; onPlay: () => void }) => (
  <button type="button" onClick={onPlay} aria-label={`${t.title} — ${t.artist}`} className="flex w-full items-center gap-5 rounded-3xl px-4 text-left outline-none transition active:scale-[0.985] focus-visible:ring-4 focus-visible:ring-violet-300"
    style={{ minHeight: 96, background: active ? 'rgba(139,124,255,0.22)' : 'transparent' }}>
    <span className="grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-2xl" style={{ background: t.coverUrl ? `center/cover no-repeat url(${t.coverUrl})` : 'linear-gradient(160deg,#4f2e8a,#1a0e33)' }}>
      {!t.coverUrl && <Music2 size={28} color="rgba(255,255,255,0.45)" />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[26px] font-bold" style={{ color: active ? '#d5ceff' : '#fff' }} translate="no">{t.title}<ExplicitBadge show={t.explicit} /></span>
      <span className="block truncate text-[19px]" style={{ color: 'rgba(255,255,255,0.55)' }} translate="no">{t.artist}</span>
    </span>
    <span className="shrink-0 text-[18px] tabular-nums text-white/40">{t.duration}</span>
  </button>
);

export const CarMusic = () => {
  const tracks = useMusicStore((s) => s.tracks);
  const favorites = useMusicStore((s) => s.favorites);
  const history = useMusicStore((s) => s.history);
  const playlists = useMusicStore((s) => s.playlists);
  const loaded = useMusicStore((s) => s.loaded);
  const error = useMusicStore((s) => s.error);
  const load = useMusicStore((s) => s.load);
  const currentId = usePlayerStore((s) => (s.item?.kind === 'music' ? s.item.id : null));
  const [tab, setTab] = useState<Tab>('recent');
  const [plId, setPlId] = useState<string | null>(null);

  useEffect(() => { void load(); }, [load]);

  const lists = useMemo(() => ({
    recent: history, fav: tracks.filter((t) => favorites.includes(t.id)), mine: tracks.filter((t) => t.uploadedBy === 'me'), all: tracks,
  }), [tracks, favorites, history]);
  const pl = plId ? playlists.find((p) => p.id === plId) : null;
  const pool: Track[] = tab === 'playlists' ? (pl?.tracks ?? []) : lists[tab];

  if (error && !loaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5">
        <Music2 size={56} color="rgba(255,255,255,0.4)" />
        <p className="text-[28px] font-bold text-white">{error}</p>
        <button type="button" onClick={() => { void load({ force: true }); }} className="flex items-center gap-3 rounded-full px-10 text-[24px] font-bold text-[#0b0b14]" style={{ minHeight: 84, background: '#fff' }}><RefreshCw size={26} /> Повторить</button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div role="tablist" aria-label="Разделы музыки" className="flex shrink-0 gap-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setPlId(null); }}
            className="flex shrink-0 items-center gap-3 rounded-full px-7 text-[22px] font-bold outline-none focus-visible:ring-4 focus-visible:ring-violet-300"
            style={{ minHeight: 76, background: tab === t.key ? CAR_ACCENT : CAR_GLASS, color: '#fff', border: CAR_GLASS_BORDER }}>
            <t.icon size={26} /> {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-[32px] p-3" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR, scrollbarWidth: 'none' }}>
        {tab === 'playlists' && !pl && (
          playlists.length === 0 ? <p className="p-8 text-[22px] text-white/55">Плейлистов пока нет — создайте их в приложении</p> : playlists.map((p) => (
            <button key={p.id} type="button" onClick={() => setPlId(p.id)} className="flex w-full items-center gap-5 rounded-3xl px-5 text-left outline-none focus-visible:ring-4 focus-visible:ring-violet-300" style={{ minHeight: 96 }}>
              <ListMusic size={34} color="#c4baff" />
              <span className="min-w-0 flex-1"><span className="block truncate text-[26px] font-bold text-white" translate="no">{p.name}</span><span className="text-[19px] text-white/55">{p.count} треков</span></span>
            </button>
          ))
        )}
        {tab === 'playlists' && pl && (
          <button type="button" onClick={() => setPlId(null)} className="mb-2 flex items-center gap-3 rounded-full px-6 text-[22px] font-semibold text-white" style={{ minHeight: 72, background: 'rgba(255,255,255,0.1)' }}>‹ Плейлисты</button>
        )}
        {(tab !== 'playlists' || pl) && (pool.length === 0
          ? <p className="p-8 text-[22px] text-white/55" role="status">{!loaded ? 'Загружаем…' : tab === 'fav' ? 'Отмечайте любимое сердцем — оно появится здесь' : tab === 'mine' ? 'Ваших загрузок пока нет' : tab === 'recent' ? 'История прослушивания пуста' : 'Здесь пока пусто'}</p>
          : pool.map((t) => <Row key={t.id} t={t} active={t.id === currentId} onPlay={() => playMusicQueue(pool, t.id)} />))}
      </div>
    </div>
  );
};
