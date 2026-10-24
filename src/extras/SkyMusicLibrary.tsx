import { ExplicitBadge } from '@/labels/Labels';
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart, Download, ListMusic, Mic2, History as HistoryIcon, Radio, BookOpen,
  Pin, Check, ArrowUpDown, ChevronLeft, Play, Trash2, X, FolderLock, Upload, CheckCircle, Pencil, Music2,
} from 'lucide-react';
import type { Track } from '@/platform/store';
import { useMusicStore } from '@/music/serverStore';
import { PrivateUpload } from '@/music/PrivateUpload';
import { TrackEditor } from '@/music/TrackEditor';
import { getG } from '@/music/utils';
import { useOfflineMusic } from '@/offline/musicOffline';

type Category = 'liked'|'mine'|'downloaded'|'albums'|'artists'|'playlists'|'history'|'podcasts'|'audiobooks';
type SortKey = 'added'|'title'|'artist';

/** Три главные кнопки сверху: то, ради чего сюда заходят чаще всего. */
const MAIN: { key: Category; label: string; icon: React.FC<any> }[] = [
  { key:'liked',     label:'Избранное',  icon:Heart },
  { key:'playlists', label:'Плейлисты',  icon:ListMusic },
  { key:'mine',      label:'Моя музыка', icon:FolderLock },
];

/** Остальное — второй строкой, чтобы не спорить с главными кнопками. */
const CATS: { key: Category; label: string; icon: React.FC<any> }[] = [
  { key:'downloaded', label:'Скачанные',  icon:Download },
  { key:'albums',     label:'Альбомы',    icon:ListMusic },
  { key:'artists',    label:'Исполнители',icon:Mic2 },
  { key:'history',    label:'История',    icon:HistoryIcon },
  { key:'podcasts',   label:'Подкасты',   icon:Radio },
  { key:'audiobooks', label:'Аудиокниги', icon:BookOpen },
];

const PIN_KEY = 'sky:music:pins:v1';
const loadPins = (): string[] => { try { return JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); } catch { return []; } };
const savePins = (ids: string[]) => { try { localStorage.setItem(PIN_KEY, JSON.stringify(ids)); } catch {} };

const Row = ({ t, active, playing, onPlay, liked, onLike, selectMode, selected, onToggleSelect, note, offline, onEdit }: {
  onEdit?: () => void;
  /** Скачан на устройство — играет без сети. */
  offline?: boolean;
  t: Track; active: boolean; playing: boolean; onPlay: () => void; liked: boolean; onLike: () => void;
  selectMode: boolean; selected: boolean; onToggleSelect: () => void;
  /** Подпись справа: например, лежит ли трек в общем каталоге. */
  note?: string;
}) => {
  const [c1, c2] = getG(t.id);
  return (
    <button type="button" onClick={selectMode ? onToggleSelect : onPlay}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]">
      {selectMode && (
        <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
          style={{ background: selected ? '#4fe3d0' : 'transparent', border: selected ? 'none' : '1.5px solid #444851' }}>
          {selected && <Check size={12} color="#0a0a0f"/>}
        </div>
      )}
      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl"
        style={{ background: t.coverUrl ? undefined : `linear-gradient(145deg,${c1},${c2})` }}>
        {t.coverUrl ? <img src={t.coverUrl} alt="" className="h-full w-full rounded-xl object-cover"/> : <Music2 size={18} color="rgba(255,255,255,0.65)"/>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium" style={{ color: active ? '#4fe3d0' : '#f2f5f8' }}>{t.title}<ExplicitBadge show={t.explicit} /></p>
        <p className="truncate text-[11.5px]" style={{ color: '#8a8f9a' }}>{t.artist}</p>
      </div>
      {offline && <CheckCircle size={14} className="shrink-0" style={{ color:'#4fe3d0' }} aria-label="Скачано"/>}
      {note && (
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px]"
          style={{ background:'rgba(255,255,255,0.05)', color:'#8a8f9a' }}>{note}</span>
      )}
      {!selectMode && onEdit && (
        <span role="button" tabIndex={0} aria-label="Изменить трек" onClick={e => { e.stopPropagation(); onEdit(); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onEdit(); } }} className="shrink-0 cursor-pointer p-1.5">
          <Pencil size={15} color="#8a8f9a"/>
        </span>
      )}
      {!selectMode && (
        <button type="button" onClick={e => { e.stopPropagation(); onLike(); }} className="shrink-0 p-1">
          <Heart size={16} fill={liked ? '#f43f5e' : 'none'} color={liked ? '#f43f5e' : '#5c626e'}/>
        </button>
      )}
    </button>
  );
};

/** Скачивание в офлайн: «Скачать всё» для списка, прогресс пачки и место на устройстве. */
const fmtMb = (b: number) => b >= 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(1)} ГБ` : `${Math.max(1, Math.round(b / 1024 / 1024))} МБ`;
const OfflineBar = ({ cat, list, ids, bytes, bulk, progress, onDownload, onCancel, onRemoveAll }: {
  cat: Category; list: Track[]; ids: Set<string>; bytes: number; bulk: import('@/offline/musicOffline').BulkState;
  progress: Record<string, number>; onDownload: () => void; onCancel: () => void; onRemoveAll: () => void;
}) => {
  const todo = list.filter(t => !t.isLocal && !ids.has(t.id)).length;
  const running = bulk?.running === true;
  const part = running ? Object.values(progress).reduce((a, b) => a + b, 0) : 0;
  const pct = running && bulk!.total > 0 ? Math.min(100, Math.round(((bulk!.done + bulk!.failed + part) / bulk!.total) * 100)) : 0;
  const card = { background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)' } as const;

  if (cat === 'downloaded') {
    return (
      <div className="mx-4 mb-2 mt-1 flex items-center gap-2 rounded-2xl px-3 py-2.5" style={card}>
        <Download size={15} style={{ color:'#4fe3d0' }}/>
        <p className="flex-1 text-[12px]" style={{ color:'#c7ccd6' }}>
          {ids.size > 0 ? `На устройстве ${ids.size} · ${fmtMb(bytes)}. Играют без сети.` : 'Пока ничего не скачано.'}
        </p>
        {ids.size > 0 && (
          <button type="button" onClick={onRemoveAll} className="rounded-xl px-2.5 py-1.5 text-[11.5px] font-medium" style={{ background:'rgba(255,255,255,0.06)', color:'#c7ccd6' }}>
            Удалить все
          </button>
        )}
      </div>
    );
  }
  if (list.length === 0) return null;
  return (
    <div className="mx-4 mb-2 mt-1 rounded-2xl px-3 py-2.5" style={card}>
      {running ? (
        <>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[12px]" style={{ color:'#c7ccd6' }}>
              {bulk!.failed > 0
                ? `Скачано ${bulk!.done} из ${bulk!.total}, ошибок ${bulk!.failed}`
                : `Скачано ${bulk!.done} из ${bulk!.total}`}
            </p>
            <button type="button" onClick={onCancel} className="rounded-xl px-2.5 py-1.5 text-[11.5px] font-medium" style={{ background:'rgba(255,255,255,0.06)', color:'#c7ccd6' }}>
              Отмена
            </button>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background:'rgba(255,255,255,0.1)' }}>
            <div className="h-full rounded-full" style={{ width:`${pct}%`, background:'#4fe3d0', transition:'width 0.3s' }}/>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[12px]" style={{ color:'#8a8f9a' }}>
            {todo > 0 ? `Не скачано ${todo} из ${list.length}. После скачивания играют без сети.` : `Все ${list.length} скачаны — играют без сети.`}
          </p>
          {todo > 0 && (
            <button type="button" onClick={onDownload} className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold" style={{ background:'#4fe3d0', color:'#0a0a0f' }}>
              <Download size={13}/>Скачать всё
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const SkyMusicLibrary = ({
  tracks, favorites, playing, activeId, onPlay, onLike, onOpenImport, onOpenUpload, onArtist,
}: {
  tracks: Track[]; favorites: string[]; playing: boolean; activeId: string | null;
  onPlay: (t: Track, pool: Track[]) => void; onLike: (id: string) => void;
  onOpenImport?: () => void; onOpenUpload?: () => void; onArtist?: (name: string) => void;
}) => {
  const playlists = useMusicStore(st => st.playlists);
  const createPlaylist = useMusicStore(st => st.createPlaylist);
  const deletePlaylist = useMusicStore(st => st.deletePlaylist);
  const renamePlaylist = useMusicStore(st => st.renamePlaylist);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const offIds    = useOfflineMusic(st => st.ids);
  const offBytes  = useOfflineMusic(st => st.bytes);
  const offBulk   = useOfflineMusic(st => st.bulk);
  const offProg   = useOfflineMusic(st => st.progress);
  const offStore  = useOfflineMusic;
  useEffect(() => { void offStore.getState().hydrate(); }, []);
  const [cat, setCat] = useState<Category>('liked');
  const [sort, setSort] = useState<SortKey>('added');
  const [genreFilter, setGenreFilter] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [editing, setEditing] = useState<Track | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pins, setPins] = useState<string[]>([]);
  const [openPlaylist, setOpenPlaylist] = useState<string | null>(null);
  // Недавнее — с сервера: закрепления остаются местными (это украшение
  // конкретного устройства), а история одна на все.
  const historyIds = useMusicStore(st => st.history).map(h => h.id);

  useEffect(() => { setPins(loadPins()); }, []);
  const togglePin = (id: string) => setPins(p => { const next = p.includes(id) ? p.filter(x=>x!==id) : [id, ...p]; savePins(next); return next; });

  const pub = useMemo(() => tracks.filter(t => t.status === 'published'), [tracks]);
  const genres = useMemo(() => [...new Set(pub.map(t => t.genre))].filter(Boolean), [pub]);

  const applySort = (list: Track[]) => {
    const arr = [...list];
    if (sort === 'title')  arr.sort((a,b) => a.title.localeCompare(b.title));
    if (sort === 'artist') arr.sort((a,b) => a.artist.localeCompare(b.artist));
    if (sort === 'added')  arr.sort((a,b) => b.addedAt.localeCompare(a.addedAt));
    return arr;
  };
  const applyGenre = (list: Track[]) => genreFilter ? list.filter(t => t.genre === genreFilter) : list;

  const likedTracks   = useMemo(() => applySort(applyGenre(pub.filter(t => favorites.includes(t.id)))), [pub, favorites, sort, genreFilter]);
  // «Скачанные»: то, что лежит на устройстве, — и загруженное с него же. Берём из всех
  // треков (а не только опубликованных): в личной коллекции они закрытые.
  const downloaded    = useMemo(() => applySort(applyGenre(tracks.filter(t => t.isLocal || offIds.has(t.id)))), [tracks, offIds, sort, genreFilter]);
  const historyTracks = useMemo(() => historyIds.map(id => pub.find(t => t.id===id)).filter(Boolean) as Track[], [historyIds, pub]);

  // Личная коллекция: то, что человек загрузил сам. Сервер отдаёт свои
  // треки любого состояния, чужие закрытые не отдаёт никому — поэтому
  // здесь по определению только своё.
  const mineTracks = useMemo(
    () => applySort(applyGenre(tracks.filter(t => t.uploadedBy === 'me'))),
    [tracks, sort, genreFilter],
  );

  const albums = useMemo(() => {
    const map: Record<string, Track[]> = {};
    pub.forEach(t => { (map[`${t.artist} · ${t.genre}`] ??= []).push(t); });
    let entries = Object.entries(map);
    if (genreFilter) entries = entries.filter(([,ts]) => ts.some(t => t.genre === genreFilter));
    return entries.sort(([a],[b]) => pins.includes(b) ? 1 : pins.includes(a) ? -1 : a.localeCompare(b));
  }, [pub, genreFilter, pins]);

  const artists = useMemo(() => {
    const map: Record<string, Track[]> = {};
    pub.forEach(t => { (map[t.artist] ??= []).push(t); });
    return Object.entries(map).sort(([a],[b]) => pins.includes(b) ? 1 : pins.includes(a) ? -1 : a.localeCompare(b));
  }, [pub, pins]);

  const sortedPlaylists = useMemo(
    () => [...playlists].sort((a,b) => pins.includes(b.id) ? 1 : pins.includes(a.id) ? -1 : 0),
    [playlists, pins],
  );

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulkDownload = () => { void offStore.getState().downloadAll(tracks.filter(t => selected.has(t.id)), 'Выбранное'); setSelected(new Set()); setSelectMode(false); };
  const bulkRemoveOffline = () => { selected.forEach(id => { void offStore.getState().remove(id); }); setSelected(new Set()); setSelectMode(false); };
  const bulkLikeAll = () => { selected.forEach(id => { if (!favorites.includes(id)) onLike(id); }); setSelected(new Set()); setSelectMode(false); };
  const bulkUnlikeAll = () => { selected.forEach(id => { if (favorites.includes(id)) onLike(id); }); setSelected(new Set()); setSelectMode(false); };

  if (openPlaylist) {
    const pl = playlists.find(p => p.id === openPlaylist);
    const pool = pl ? (pl.trackIds.map(id => pub.find(t => t.id === id)).filter(Boolean) as Track[]) : [];
    return (
      <div className="sky-music-scope flex h-full flex-col" style={{ background: 'var(--bg)' }}>
        <div className="flex shrink-0 items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => setOpenPlaylist(null)}><ChevronLeft size={20} color="#8a8f9a"/></button>
          <p className="flex-1 truncate text-[15px] font-semibold" style={{ color:'#f2f5f8' }}>{pl?.name ?? 'Плейлист'}</p>
          <span className="text-[12px]" style={{ color:'#5c626e' }}>{pool.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto pb-6">
          {pool.map(t => (
            <Row key={t.id} t={t} active={activeId===t.id} playing={playing} onPlay={() => onPlay(t, pool)}
              liked={favorites.includes(t.id)} onLike={() => onLike(t.id)}
              selectMode={false} selected={false} onToggleSelect={() => {}}/>
          ))}
          {pool.length === 0 && <p className="py-10 text-center text-[12.5px]" style={{ color:'#5c626e' }}>Плейлист пуст</p>}
        </div>
      </div>
    );
  }

  const trackList = cat==='liked' ? likedTracks
    : cat==='mine' ? mineTracks
    : cat==='downloaded' ? downloaded
    : cat==='history' ? historyTracks : [];
  const isTrackCat = cat==='liked' || cat==='mine' || cat==='downloaded' || cat==='history';

  return (
    <div className="sky-music-scope flex h-full flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Главные разделы */}
      <div className="flex shrink-0 gap-2 px-3 pt-3">
        {MAIN.map(m => (
          <button key={m.key} type="button"
            onClick={() => { setCat(m.key); setSelectMode(false); setSelected(new Set()); }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[12.5px] font-bold"
            style={{
              background: cat===m.key ? '#4fe3d0' : 'rgba(255,255,255,0.05)',
              color: cat===m.key ? '#0a0a0f' : '#c7ccd6',
              border: `1px solid ${cat===m.key ? 'transparent' : 'rgba(255,255,255,0.07)'}`,
            }}>
            <m.icon size={14}/>{m.label}
          </button>
        ))}
      </div>

      {/* Остальные категории */}
      <div className="glass-pill mx-3 my-2 flex shrink-0 gap-0.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {CATS.map(c => (
          <button key={c.key} type="button" onClick={() => { setCat(c.key); setSelectMode(false); setSelected(new Set()); }}
            className="relative isolate flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[12.5px] font-semibold"
            style={{ color: cat===c.key ? '#4fe3d0' : 'var(--t3)' }}>
            {cat===c.key && <motion.span layoutId="mlib-lens" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="glass-lens absolute inset-0 -z-10" />}
            <c.icon size={13}/>{c.label}
          </button>
        ))}
      </div>

      {/* Сортировка / фильтр / выделение — только для трек-списков */}
      {isTrackCat && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-4 pb-2" style={{ scrollbarWidth: 'none' }}>
          <button type="button" onClick={() => setSort(s => s==='added' ? 'title' : s==='title' ? 'artist' : 'added')}
            className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-medium" style={{ background:'rgba(255,255,255,0.05)', color:'#8a8f9a' }}>
            <ArrowUpDown size={11}/>{sort==='added'?'По дате':sort==='title'?'По названию':'По исполнителю'}
          </button>
          {genres.map(g => (
            <button key={g} type="button" onClick={() => setGenreFilter(f => f===g ? null : g)}
              className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium"
              style={{ background: genreFilter===g ? 'rgba(79,227,208,0.15)' : 'rgba(255,255,255,0.05)', color: genreFilter===g ? '#4fe3d0' : '#8a8f9a' }}>
              {g}
            </button>
          ))}
          <button type="button" onClick={() => setSelectMode(v => !v)}
            className="ml-auto shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium" style={{ background: selectMode ? '#4fe3d0' : 'rgba(255,255,255,0.05)', color: selectMode ? '#0a0a0f' : '#8a8f9a' }}>
            {selectMode ? 'Готово' : 'Выделить'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-24">
        {cat === 'mine' && (
          <div className="px-4 pb-2 pt-1">
            <p className="text-[12px] leading-relaxed" style={{ color:'#8a8f9a' }}>
              Ваша личная коллекция. Загруженное здесь видите только вы —
              в общий каталог оно попадает, лишь когда вы сами публикуете трек.
            </p>
            {/* Загрузка здесь своя: она кладёт трек в личную коллекцию и
                ничего не предлагает публиковать. Путь в общий каталог —
                отдельная вкладка «Загрузить». */}
            <div className="mt-2.5">
              <PrivateUpload/>
            </div>
            <div className="mt-2 flex gap-2">
              {onOpenUpload && (
                <button type="button" onClick={onOpenUpload}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium"
                  style={{ background:'rgba(255,255,255,0.05)', color:'#c7ccd6', border:'1px solid rgba(255,255,255,0.07)' }}>
                  <Upload size={13}/>В общий каталог
                </button>
              )}
              {onOpenImport && (
                <button type="button" onClick={onOpenImport}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium"
                  style={{ background:'rgba(255,255,255,0.05)', color:'#c7ccd6', border:'1px solid rgba(255,255,255,0.07)' }}>
                  <Download size={13}/>Перенос
                </button>
              )}
            </div>
          </div>
        )}

        {(cat==='liked' || cat==='mine' || cat==='downloaded') && (
          <OfflineBar cat={cat} list={trackList} ids={offIds} bytes={offBytes} bulk={offBulk} progress={offProg}
            onDownload={() => void offStore.getState().downloadAll(trackList, cat==='liked' ? 'Избранное' : 'Моя музыка')}
            onCancel={() => offStore.getState().cancel()}
            onRemoveAll={() => { if (window.confirm('Удалить все скачанные треки с этого устройства? В облаке они останутся.')) void offStore.getState().removeAll(); }}/>
        )}

        {isTrackCat && (
          <>
            {trackList.map(t => (
              <Row key={t.id} t={t} active={activeId===t.id} playing={playing} onPlay={() => onPlay(t, trackList)}
                liked={favorites.includes(t.id)} onLike={() => onLike(t.id)}
                selectMode={selectMode} selected={selected.has(t.id)} onToggleSelect={() => toggleSelect(t.id)}
                offline={offIds.has(t.id)}
                onEdit={cat==='mine' && t.uploadedBy==='me' ? () => setEditing(t) : undefined}
                note={cat==='mine' ? (t.status === 'published' ? 'в каталоге' : 'только у вас') : undefined}/>
            ))}
            {trackList.length === 0 && (
              <p className="py-12 text-center text-[12.5px]" style={{ color:'#5c626e' }}>
                {cat==='downloaded' ? 'Скачанные треки появятся здесь. Откройте «Избранное» или «Моя музыка» и нажмите «Скачать всё»'
                  : cat==='mine' ? 'Здесь пока пусто — загрузите свой первый трек'
                  : cat==='history' ? 'Пока ничего не прослушано' : 'Добавляйте треки в любимые'}
              </p>
            )}
          </>
        )}

        {cat === 'albums' && (
          <div className="grid grid-cols-2 gap-3 px-4 pt-2">
            {albums.map(([name, ts]) => {
              const [c1,c2] = getG(name);
              return (
                <motion.div key={name} whileTap={{ scale: 0.97 }} className="relative">
                  <button type="button" onClick={() => ts[0] && onPlay(ts[0], ts)} className="w-full text-left">
                    <div className="grid aspect-square place-items-center rounded-2xl" style={{ background:`linear-gradient(145deg,${c1},${c2})` }}>
                      <ListMusic size={24} color="rgba(255,255,255,0.35)"/>
                    </div>
                    <p className="mt-1.5 truncate text-[12.5px] font-medium" style={{ color:'#f2f5f8' }}>{name.split(' · ')[0]}</p>
                    <p className="truncate text-[11px]" style={{ color:'#5c626e' }}>{name.split(' · ')[1]}</p>
                  </button>
                  <button type="button" onClick={() => togglePin(name)} className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full" style={{ background:'rgba(0,0,0,0.5)' }}>
                    <Pin size={11} fill={pins.includes(name) ? '#4fe3d0' : 'none'} color={pins.includes(name) ? '#4fe3d0' : '#fff'}/>
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}

        {cat === 'artists' && artists.map(([artist, ts]) => (
          <button key={artist} type="button" onClick={() => (onArtist ? onArtist(artist) : ts[0] && onPlay(ts[0], ts))}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background:`linear-gradient(145deg,${getG(artist)[0]},${getG(artist)[1]})` }}>
              <Mic2 size={16} color="rgba(255,255,255,0.5)"/>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium" style={{ color:'#f2f5f8' }}>{artist}</p>
              <p className="text-[11px]" style={{ color:'#5c626e' }}>{ts.length} треков</p>
            </div>
            <button type="button" onClick={e => { e.stopPropagation(); togglePin(artist); }} className="shrink-0 p-1.5">
              <Pin size={14} fill={pins.includes(artist) ? '#4fe3d0' : 'none'} color={pins.includes(artist) ? '#4fe3d0' : '#5c626e'}/>
            </button>
          </button>
        ))}

        {cat === 'playlists' && (
          <div className="flex items-center gap-2 px-4 pb-2 pt-1">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Новый плейлист" maxLength={120}
              onKeyDown={e => {
                if (e.key === 'Enter' && newName.trim()) {
                  void createPlaylist(newName.trim()); setNewName('');
                }
              }}
              className="flex-1 rounded-xl px-3 py-2 text-[13px] outline-none"
              style={{ background:'rgba(255,255,255,0.05)', color:'#f2f5f8', border:'1px solid rgba(255,255,255,0.07)' }}/>
            <button type="button" disabled={!newName.trim()}
              onClick={() => { void createPlaylist(newName.trim()); setNewName(''); }}
              className="rounded-xl px-3.5 py-2 text-[12.5px] font-bold disabled:opacity-40"
              style={{ background:'#fff', color:'#0a0a0f' }}>
              Создать
            </button>
          </div>
        )}

        {/* Строка — не <button>: внутри неё свои кнопки, а кнопка в
            кнопке — недопустимая разметка, и браузер её распрямляет. */}
        {cat === 'playlists' && sortedPlaylists.map(pl => (
          <div key={pl.id} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]">
            <button type="button" onClick={() => setOpenPlaylist(pl.id)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background:`linear-gradient(145deg,${getG(pl.id)[0]},${getG(pl.id)[1]})` }}>
                <ListMusic size={16} color="rgba(255,255,255,0.5)"/>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium" style={{ color:'#f2f5f8' }}>{pl.name}</p>
                <p className="text-[11px]" style={{ color:'#5c626e' }}>{pl.trackIds.length} треков</p>
              </div>
            </button>
            <button type="button" onClick={() => togglePin(pl.id)} className="shrink-0 p-1.5"
              aria-label={pins.includes(pl.id) ? 'Открепить плейлист' : 'Закрепить плейлист'}>
              <Pin size={14} fill={pins.includes(pl.id) ? '#4fe3d0' : 'none'} color={pins.includes(pl.id) ? '#4fe3d0' : '#5c626e'}/>
            </button>
            <button type="button" aria-label="Переименовать плейлист"
              onClick={() => { setRenaming(pl.id); setRenameTo(pl.name); }}
              className="shrink-0 px-1.5 py-1 text-[11px]" style={{ color:'#5c626e' }}>
              Имя
            </button>
            <button type="button" aria-label="Удалить плейлист"
              onClick={() => { if (window.confirm(`Удалить плейлист «${pl.name}»?`)) void deletePlaylist(pl.id); }}
              className="shrink-0 px-1.5 py-1 text-[11px]" style={{ color:'#e05a5a' }}>
              Удалить
            </button>
          </div>
        ))}

        {cat === 'playlists' && renaming && (
          <div className="flex items-center gap-2 px-4 py-2">
            <input value={renameTo} onChange={e => setRenameTo(e.target.value)} autoFocus maxLength={120}
              onKeyDown={e => {
                if (e.key === 'Enter' && renameTo.trim()) {
                  void renamePlaylist(renaming, renameTo.trim()); setRenaming(null);
                }
                if (e.key === 'Escape') setRenaming(null);
              }}
              className="flex-1 rounded-xl px-3 py-2 text-[13px] outline-none"
              style={{ background:'rgba(255,255,255,0.05)', color:'#f2f5f8', border:'1px solid rgba(255,255,255,0.07)' }}/>
            <button type="button" onClick={() => { void renamePlaylist(renaming, renameTo.trim()); setRenaming(null); }}
              className="rounded-xl px-3.5 py-2 text-[12.5px] font-bold" style={{ background:'#fff', color:'#0a0a0f' }}>
              Готово
            </button>
          </div>
        )}
        {cat === 'playlists' && sortedPlaylists.length === 0 && (
          <p className="py-12 text-center text-[12.5px]" style={{ color:'#5c626e' }}>Плейлистов пока нет</p>
        )}

        {cat === 'podcasts' && <p className="py-12 text-center text-[12.5px]" style={{ color:'#5c626e' }}>Раздел подкастов скоро появится</p>}
        {cat === 'audiobooks' && <p className="py-12 text-center text-[12.5px]" style={{ color:'#5c626e' }}>Раздел аудиокниг скоро появится</p>}
      </div>

      {/* Панель действий при массовом выделении */}
      <AnimatePresence>
        {selectMode && selected.size > 0 && (
          <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
            className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-2xl p-2.5"
            style={{ background: 'var(--bg-l2)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
            <span className="px-2 text-[12px] font-medium" style={{ color:'#c7ccd6' }}>{selected.size} выбрано</span>
            <button type="button" onClick={bulkDownload} className="flex items-center gap-1 rounded-xl px-3 py-2 text-[12px] font-medium" style={{ background:'rgba(79,227,208,0.14)', color:'#4fe3d0' }}>
              <Download size={13}/>Скачать
            </button>
            {cat==='downloaded' && (
              <button type="button" onClick={bulkRemoveOffline} className="flex items-center gap-1 rounded-xl px-3 py-2 text-[12px] font-medium" style={{ background:'rgba(255,255,255,0.06)', color:'#c7ccd6' }}>
                <Trash2 size={13}/>С устройства
              </button>
            )}
            <button type="button" onClick={bulkLikeAll} className="flex items-center gap-1 rounded-xl px-3 py-2 text-[12px] font-medium" style={{ background:'rgba(244,63,94,0.12)', color:'#f43f5e' }}>
              <Heart size={13} fill="#f43f5e"/>В любимые
            </button>
            <button type="button" onClick={bulkUnlikeAll} className="flex items-center gap-1 rounded-xl px-3 py-2 text-[12px] font-medium" style={{ background:'rgba(255,255,255,0.06)', color:'#c7ccd6' }}>
              <Trash2 size={13}/>Убрать
            </button>
            <button type="button" onClick={() => { setSelected(new Set()); setSelectMode(false); }} className="ml-auto p-1.5"><X size={16} color="#5c626e"/></button>
          </motion.div>
        )}
      </AnimatePresence>
      {editing && <TrackEditor track={editing} onClose={() => setEditing(null)}/>}
    </div>
  );
};
