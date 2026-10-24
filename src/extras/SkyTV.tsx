/* ===========================================================
   SKY TV

   Было: двенадцать каналов, записанных прямо здесь в массив, и чужой
   проигрыватель, вставленный в страницу рамкой. Сервер о телевидении
   не знал ничего — ни какие есть каналы, ни работают ли они, ни что
   человек смотрел вчера.

   Стало: каталог приходит с сервера, эфир открывает свой плеер,
   избранное и «недавно смотрели» лежат на сервере и потому одинаковы
   на телефоне и на телевизоре.

   Про честность состояний. Канал без подключённого источника не
   прячется — он виден с прямой пометкой «источник не подключён».
   Спрятать его было бы удобнее для вида, но список каналов и есть то,
   что владелец собирается подключать: по нему видно, что уже сделано.
=========================================================== */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Tv2, Search, X, Star, Radio, Clock, AlertTriangle,
  Loader2, ChevronRight, Lock, CalendarClock,
} from 'lucide-react';
import { useTvStore } from '@/tv/serverStore';
import { SkyTVPlayer } from '@/tv/SkyTVPlayer';
import { logoUrl, offlineReason, type TvChannel, type Programme } from '@/tv/tvApi';

const C = {
  bg: 'var(--bg)', l1: 'var(--bg-l1)', l2: 'var(--bg-l2)',
  border: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
  accent: 'var(--accent)', live: '#ef4444',
};

const hhmm = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
};

/* -- Знак канала: логотип, а пока его нет — буквы на фирменном цвете -- */
const ChannelMark = ({ channel, size = 44 }: { channel: TvChannel; size?: number }) => (
  <div className="grid shrink-0 place-items-center overflow-hidden rounded-xl font-black text-white"
    style={{ width: size, height: size, background: channel.accent,
      fontSize: Math.max(10, size * 0.3) }}>
    {channel.hasLogo
      ? <img src={logoUrl(channel.id)} alt="" className="h-full w-full object-contain"/>
      : channel.mark}
  </div>
);

/* -- Полоса текущей передачи ------------------------------------ */
const NowBar = ({ now }: { now?: Programme }) => {
  if (!now?.startsAt || !now?.endsAt) return null;
  const start = new Date(now.startsAt).getTime();
  const end = new Date(now.endsAt).getTime();
  const pct = end > start ? Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100)) : 0;
  return (
    <div className="mt-1.5 h-[3px] overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: C.accent }}/>
    </div>
  );
};

/* -- Карточка канала -------------------------------------------- */
const ChannelCard = ({ channel, active, onOpen, onFavorite }: {
  channel: TvChannel; active: boolean;
  onOpen: () => void; onFavorite: () => void;
}) => (
  <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}
    className="relative flex flex-col gap-2.5 rounded-2xl p-3.5 text-left"
    style={{
      background: active ? `color-mix(in srgb, ${channel.accent} 12%, var(--bg-l1))` : C.l1,
      border: `1.5px solid ${active ? channel.accent : C.border}`,
      opacity: channel.live ? 1 : 0.75,
    }}>
    <button type="button" onClick={onFavorite}
      className="absolute right-2.5 top-2.5 z-10 grid h-7 w-7 place-items-center rounded-full"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      aria-label={channel.favorite ? 'Убрать из избранного' : 'В избранное'}>
      <Star size={13}
        fill={channel.favorite ? '#f5c518' : 'none'}
        style={{ color: channel.favorite ? '#f5c518' : C.t3 }}/>
    </button>

    {/* Знак канала над названием, а не рядом: рядом он съедал половину
        ширины карточки, и «Первый канал» превращался в «Первый ...». */}
    <button type="button" onClick={onOpen} className="flex w-full flex-col gap-2 text-left">
      <ChannelMark channel={channel} size={40}/>
      <div className="min-w-0 w-full">
        <p className="truncate text-[13px] font-bold" style={{ color: C.t1 }}>{channel.name}</p>
        <p className="truncate text-[11px]" style={{ color: C.t3 }}>{channel.category}</p>
      </div>

      {channel.live ? (
        <div className="flex items-center gap-1.5">
          <motion.span className="h-1.5 w-1.5 rounded-full" style={{ background: C.live }}
            animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.4, repeat: Infinity }}/>
          <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: C.live }}>Live</span>
          {channel.now?.title && (
            <span className="truncate text-[10.5px]" style={{ color: C.t2 }}>· {channel.now.title}</span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {channel.offline === 'no_source'
            ? <Lock size={10} style={{ color: C.t3 }}/>
            : <AlertTriangle size={10} style={{ color: '#f59e0b' }}/>}
          <span className="truncate text-[10.5px]" style={{ color: C.t3 }}>{offlineReason(channel)}</span>
        </div>
      )}
      <NowBar now={channel.now}/>
    </button>
  </motion.div>
);

/* -- Телепрограмма канала --------------------------------------- */
const EpgSheet = ({ channel, onClose }: { channel: TvChannel; onClose: () => void }) => {
  const loadEpg = useTvStore(s => s.loadEpg);
  const [items, setItems] = useState<Programme[] | null>(null);

  useEffect(() => { void loadEpg(channel.id, 48).then(setItems); }, [channel.id, loadEpg]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <motion.div initial={{ y: 60 }} animate={{ y: 0 }} exit={{ y: 60 }}
        className="flex w-full max-h-[80vh] flex-col overflow-hidden rounded-t-3xl sm:max-w-md sm:rounded-3xl"
        style={{ background: C.l1, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center gap-3 border-b p-4" style={{ borderColor: C.border }}>
          <ChannelMark channel={channel} size={38}/>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold" style={{ color: C.t1 }}>{channel.name}</p>
            <p className="text-[11px]" style={{ color: C.t3 }}>Телепрограмма</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full"
            style={{ background: C.l2 }}><X size={15} style={{ color: C.t2 }}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-2" style={{ scrollbarWidth: 'none' }}>
          {items === null && (
            <div className="flex items-center justify-center gap-2 py-10">
              <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }}/>
              <span className="text-[13px]" style={{ color: C.t3 }}>Загружаем…</span>
            </div>
          )}
          {items !== null && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <CalendarClock size={30} style={{ color: C.t3 }}/>
              <p className="text-[13px] font-semibold" style={{ color: C.t2 }}>Телепрограммы нет</p>
              <p className="text-[11.5px]" style={{ color: C.t3 }}>
                Источник расписания для этого канала не подключён. Придумывать передачи мы не станем.
              </p>
            </div>
          )}
          {(items ?? []).map((p) => (
            <div key={`${p.startsAt}-${p.title}`}
              className="flex gap-3 rounded-xl px-3 py-2.5"
              style={{ background: p.live ? `color-mix(in srgb, ${channel.accent} 14%, transparent)` : 'transparent' }}>
              <span className="w-11 shrink-0 pt-0.5 text-[12px] font-mono tabular-nums"
                style={{ color: p.live ? channel.accent : C.t3 }}>{hhmm(p.startsAt)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold" style={{ color: p.live ? C.t1 : C.t2 }}>
                  {p.title}
                  {p.live && <span className="ml-1.5 text-[9px] font-black uppercase" style={{ color: C.live }}>сейчас</span>}
                </p>
                {p.description && (
                  <p className="mt-0.5 line-clamp-2 text-[11.5px]" style={{ color: C.t3 }}>{p.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

/* ═══════════════════════════════════════════════════════════
   SkyTV
═══════════════════════════════════════════════════════════ */
export const SkyTV = () => {
  const channels = useTvStore(s => s.channels);
  const categories = useTvStore(s => s.categories);
  const favorites = useTvStore(s => s.favorites);
  const recent = useTvStore(s => s.recent);
  const loading = useTvStore(s => s.loading);
  const loaded = useTvStore(s => s.loaded);
  const error = useTvStore(s => s.error);
  const load = useTvStore(s => s.load);
  const toggleFavorite = useTvStore(s => s.toggleFavorite);
  const noteWatched = useTvStore(s => s.noteWatched);

  const [category, setCategory] = useState('Все');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [watching, setWatching] = useState<TvChannel | null>(null);
  const [epgFor, setEpgFor] = useState<TvChannel | null>(null);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return channels.filter((c) => {
      const byCat = category === 'Все'
        || (category === 'Избранное' ? Boolean(c.favorite) : c.category === category);
      const byQ = !q || c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q);
      return byCat && byQ;
    });
  }, [channels, category, search]);

  /**
   * Соседний канал для переключения прямо в плеере.
   * Переключаемся по тому же списку, что человек видит, и только по
   * работающим: предлагать «следующий» и попадать в неподключённый —
   * издевательство.
   */
  const playable = useMemo(() => shown.filter((c) => c.live), [shown]);
  const step = useCallback((delta: number) => {
    if (!watching || playable.length === 0) return;
    const at = playable.findIndex((c) => c.id === watching.id);
    const next = playable[((at < 0 ? 0 : at) + delta + playable.length) % playable.length];
    if (next) { setWatching(next); void noteWatched(next.id); }
  }, [watching, playable, noteWatched]);

  const open = useCallback((c: TvChannel) => {
    setWatching(c);
    void noteWatched(c.id);
  }, [noteWatched]);

  const tabs = useMemo(() => {
    const base = ['Все'];
    if (favorites.length) base.push('Избранное');
    return [...base, ...categories.map((c) => c.name)];
  }, [categories, favorites.length]);

  if (loading && !loaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" style={{ background: C.bg }}>
        <Tv2 size={34} style={{ color: C.t3 }}/>
        <p className="text-sm" style={{ color: C.t3 }}>Загружаем каналы…</p>
      </div>
    );
  }

  if (error && !loaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center" style={{ background: C.bg }}>
        <AlertTriangle size={34} style={{ color: '#f59e0b' }}/>
        <p className="text-sm" style={{ color: C.t2 }}>{error}</p>
        <button type="button" onClick={() => void load({ force: true })}
          className="rounded-full px-5 py-2.5 text-[13px] font-bold text-white" style={{ background: C.accent }}>
          Попробовать ещё раз
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: C.bg }}>

      {/* Шапка */}
      <header className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-4">
        <AnimatePresence mode="wait">
          {showSearch ? (
            <motion.div key="s" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: C.l2 }}>
              <Search size={14} style={{ color: C.t3 }}/>
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Канал или раздел…"
                className="flex-1 bg-transparent text-sm outline-none" style={{ color: C.t1 }}/>
            </motion.div>
          ) : (
            <motion.h1 key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 text-xl font-black tracking-tight">
              <span style={{ color: C.t1 }}>Sky</span><span style={{ color: C.accent }}>TV</span>
            </motion.h1>
          )}
        </AnimatePresence>
        <button type="button"
          onClick={() => { setShowSearch((v) => !v); if (showSearch) setSearch(''); }}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
          style={{ color: showSearch ? C.accent : C.t3 }}
          aria-label="Поиск канала">
          {showSearch ? <X size={18}/> : <Search size={18}/>}
        </button>
      </header>

      {/* Разделы */}
      <div className="glass-pill mx-4 my-2 flex shrink-0 items-center gap-0.5 overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}>
        {tabs.map((t) => (
          <button key={t} type="button" onClick={() => setCategory(t)}
            className="relative isolate shrink-0 rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold"
            style={{ color: category === t ? C.accent : C.t3 }}>
            {category === t && <motion.span layoutId="tv-cat-lens" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="glass-lens absolute inset-0 -z-10" />}
            {t === 'Избранное'
                ? <span className="inline-flex items-center gap-1"><Star size={11} fill="currentColor"/> Избранное</span>
                : t}
          </button>
        ))}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px]"
          style={{ color: C.t3 }}>
          <Radio size={11}/> {channels.filter((c) => c.live).length} из {channels.length} в эфире
        </span>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

        {/* Недавно смотрели */}
        {recent.length > 0 && category === 'Все' && !search && (
          <div className="pt-3">
            <div className="mb-2 flex items-center gap-2 px-4">
              <Clock size={13} style={{ color: C.accent }}/>
              <h3 className="text-[13px] font-bold" style={{ color: C.t1 }}>Недавно смотрели</h3>
            </div>
            <div className="flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
              {recent.map((c) => (
                <button key={c.id} type="button" onClick={() => open(c)}
                  className="flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-2"
                  style={{ background: C.l1, border: `1px solid ${C.border}`, opacity: c.live ? 1 : 0.6 }}>
                  <ChannelMark channel={c} size={30}/>
                  <span className="max-w-28 truncate text-[12px] font-semibold" style={{ color: C.t1 }}>
                    {c.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Каналы */}
        <div className="grid gap-2.5 p-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {shown.map((c) => (
            <div key={c.id} className="relative">
              <ChannelCard channel={c} active={watching?.id === c.id}
                onOpen={() => open(c)}
                onFavorite={() => void toggleFavorite(c.id)}/>
              <button type="button" onClick={() => setEpgFor(c)}
                className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg py-1 text-[10.5px]"
                style={{ color: C.t3 }}>
                Программа <ChevronRight size={11}/>
              </button>
            </div>
          ))}
        </div>

        {shown.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16">
            <Tv2 size={34} style={{ color: C.t3 }}/>
            <p className="text-sm" style={{ color: C.t2 }}>Каналов не нашлось</p>
          </div>
        )}

        {/* Честное объяснение про неподключённые каналы. Без него
            половина каталога выглядит поломкой. */}
        {channels.some((c) => c.offline === 'no_source') && !search && (
          <div className="mx-4 mb-5 flex items-start gap-2 rounded-2xl p-3 text-[11.5px]"
            style={{ background: C.l1, border: `1px solid ${C.border}`, color: C.t3 }}>
            <Lock size={13} className="mt-0.5 shrink-0"/>
            <span>
              У части каналов пока не подключён источник вещания. Они остаются в списке, чтобы было
              видно, что уже готово: как только владелец подключит официальный источник, канал
              заработает без обновления приложения.
            </span>
          </div>
        )}
      </div>

      {/* Плеер */}
      <AnimatePresence>
        {watching && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100]" style={{ background: '#000' }}>
            <SkyTVPlayer channel={watching}
              onClose={() => setWatching(null)}
              onPrev={playable.length > 1 ? () => step(-1) : undefined}
              onNext={playable.length > 1 ? () => step(1) : undefined}/>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Телепрограмма */}
      <AnimatePresence>
        {epgFor && <EpgSheet channel={epgFor} onClose={() => setEpgFor(null)}/>}
      </AnimatePresence>
    </div>
  );
};
