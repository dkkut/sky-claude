/* ===========================================================
   SKY TV на телевизоре — каналы

   Это не уменьшённый телефон и не увеличенный: телевизором управляют
   пультом, и отсюда всё устройство экрана.

   Слева — список каналов, по которому ходят вверх-вниз; справа —
   крупная карточка выбранного с телепрограммой. Ходить пальцем по
   сетке из шестнадцати плиток пультом невозможно, а по одному столбцу
   — естественно: это ровно то движение, каким переключают каналы на
   обычном телевизоре.

   Эфир открывается тем же плеером, что и везде. В нём стрелки вверх и
   вниз переключают канал, не выходя из просмотра, — иначе на пульте
   смена канала превращается в «назад, найти, нажать».
=========================================================== */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Star, Radio, AlertTriangle, Lock, Tv2, Clock } from 'lucide-react';
import { TVFocusable } from './TVFocusable';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';
import { useTvStore } from '@/tv/serverStore';
import { SkyTVPlayer } from '@/tv/SkyTVPlayer';
import { logoUrl, offlineReason, type TvChannel, type Programme } from '@/tv/tvApi';

const hhmm = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
};

const Mark = ({ channel, size }: { channel: TvChannel; size: number }) => (
  <div className="grid shrink-0 place-items-center overflow-hidden rounded-xl font-black text-white"
    style={{ width: size, height: size, background: channel.accent, fontSize: Math.max(11, size * 0.3) }}>
    {channel.hasLogo
      ? <img src={logoUrl(channel.id)} alt="" className="h-full w-full object-contain"/>
      : channel.mark}
  </div>
);

export const TVChannels = () => {
  const channels = useTvStore(s => s.channels);
  const recent = useTvStore(s => s.recent);
  const loading = useTvStore(s => s.loading);
  const loaded = useTvStore(s => s.loaded);
  const load = useTvStore(s => s.load);
  const toggleFavorite = useTvStore(s => s.toggleFavorite);
  const noteWatched = useTvStore(s => s.noteWatched);
  const loadEpg = useTvStore(s => s.loadEpg);
  const { lastFocusedId } = useTVRestoreState();

  const [selected, setSelected] = useState<TvChannel | null>(null);
  const [watching, setWatching] = useState<TvChannel | null>(null);
  const [programme, setProgramme] = useState<Programme[]>([]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { tvFocusManager.focusDefault(lastFocusedId); }, [loaded]);

  // Выбранный по умолчанию — первый работающий: подсвечивать пустую
  // карточку при входе незачем.
  useEffect(() => {
    if (selected || channels.length === 0) return;
    setSelected(channels.find((c) => c.live) ?? channels[0]);
  }, [channels, selected]);

  useEffect(() => {
    if (!selected) return;
    void loadEpg(selected.id, 12).then(setProgramme);
  }, [selected?.id, loadEpg]);

  const playable = useMemo(() => channels.filter((c) => c.live), [channels]);

  /** Соседний работающий канал — для переключения прямо в эфире. */
  const step = useCallback((delta: number) => {
    if (!watching || playable.length === 0) return;
    const at = playable.findIndex((c) => c.id === watching.id);
    const next = playable[((at < 0 ? 0 : at) + delta + playable.length) % playable.length];
    if (next) { setWatching(next); setSelected(next); void noteWatched(next.id); }
  }, [watching, playable, noteWatched]);

  const open = useCallback((c: TvChannel) => {
    if (!c.live) return;
    setWatching(c);
    void noteWatched(c.id);
  }, [noteWatched]);

  if (watching) {
    return (
      <div className="fixed inset-0 z-[600]" style={{ background: '#000' }}>
        <SkyTVPlayer channel={watching} tvMode
          onClose={() => setWatching(null)}
          onPrev={playable.length > 1 ? () => step(-1) : undefined}
          onNext={playable.length > 1 ? () => step(1) : undefined}/>
      </div>
    );
  }

  if (loading && !loaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Tv2 size={40} style={{ color: 'var(--t3)' }}/>
        <p className="text-[18px]" style={{ color: 'var(--t3)' }}>Загружаем каналы…</p>
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Каналов пока нет</p>
        <p className="text-sm" style={{ color: 'var(--t3)' }}>Они появятся, как только их подключит владелец</p>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-8 px-10 pb-10 pt-4">

      {/* Список каналов: один столбец, по нему ходят вверх-вниз */}
      <div className="flex w-[380px] shrink-0 flex-col gap-2 overflow-y-auto pr-1"
        style={{ scrollbarWidth: 'none' }}>
        {recent.length > 0 && (
          <p className="flex items-center gap-2 px-1 pb-1 pt-2 text-[13px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--t3)' }}>
            <Clock size={13}/> Недавние
          </p>
        )}
        {recent.map((c, i) => (
          <TVFocusable key={`r-${c.id}`} id={`tvch-recent-${c.id}`}
            autoFocusPriority={i === 0 ? 0 : undefined}
            onEnter={() => open(c)}>
            {({ focused }) => {
              if (focused && selected?.id !== c.id) setTimeout(() => setSelected(c), 0);
              return (
                <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5"
                  style={{
                    background: focused ? 'rgba(255,255,255,0.14)' : 'transparent',
                    boxShadow: focused ? `0 0 0 3px ${c.accent}` : 'none',
                    transform: focused ? 'scale(1.02)' : 'scale(1)',
                    transition: 'transform 0.15s, background 0.15s',
                    opacity: c.live ? 1 : 0.55,
                  }}>
                  <Mark channel={c} size={40}/>
                  <span className="min-w-0 flex-1 truncate text-[16px] font-semibold"
                    style={{ color: 'var(--t1)' }}>{c.name}</span>
                </div>
              );
            }}
          </TVFocusable>
        ))}

        <p className="px-1 pb-1 pt-3 text-[13px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--t3)' }}>Все каналы</p>

        {channels.map((c, i) => (
          <TVFocusable key={c.id} id={`tvch-${c.id}`}
            autoFocusPriority={recent.length === 0 && i === 0 ? 0 : undefined}
            onEnter={() => open(c)}>
            {({ focused }) => {
              if (focused && selected?.id !== c.id) setTimeout(() => setSelected(c), 0);
              return (
                <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5"
                  style={{
                    background: focused ? 'rgba(255,255,255,0.14)' : 'transparent',
                    boxShadow: focused ? `0 0 0 3px ${c.accent}` : 'none',
                    transform: focused ? 'scale(1.02)' : 'scale(1)',
                    transition: 'transform 0.15s, background 0.15s',
                    opacity: c.live ? 1 : 0.55,
                  }}>
                  <Mark channel={c} size={44}/>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[17px] font-semibold" style={{ color: 'var(--t1)' }}>{c.name}</p>
                    <p className="truncate text-[13px]" style={{ color: 'var(--t3)' }}>
                      {c.live ? (c.now?.title ?? c.category) : offlineReason(c)}
                    </p>
                  </div>
                  {c.live && (
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: '#ef4444' }}/>
                  )}
                  {c.favorite && <Star size={15} fill="#f5c518" style={{ color: '#f5c518' }}/>}
                </div>
              );
            }}
          </TVFocusable>
        ))}
      </div>

      {/* Крупная карточка выбранного канала */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        {selected && (
          <>
            <div className="flex items-center gap-5">
              <Mark channel={selected} size={96}/>
              <div className="min-w-0">
                <p className="truncate text-[38px] font-extrabold leading-tight" style={{ color: 'var(--t1)' }}>
                  {selected.name}
                </p>
                <div className="mt-1 flex items-center gap-3 text-[16px]" style={{ color: 'var(--t3)' }}>
                  <span>{selected.category}</span>
                  {selected.live ? (
                    <span className="flex items-center gap-1.5 font-bold" style={{ color: '#ef4444' }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: '#ef4444' }}/> LIVE
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      {selected.offline === 'no_source'
                        ? <Lock size={14}/> : <AlertTriangle size={14} style={{ color: '#f59e0b' }}/>}
                      {offlineReason(selected)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <TVFocusable id="tvch-watch" disabled={!selected.live} onEnter={() => open(selected)}>
                {({ focused }) => (
                  <div className="flex items-center gap-2 rounded-xl px-7 py-3.5 text-[17px] font-bold"
                    style={{
                      background: selected.live ? '#fff' : 'rgba(255,255,255,0.12)',
                      color: selected.live ? '#0a0a0e' : 'var(--t3)',
                      transform: focused ? 'scale(1.05)' : 'scale(1)',
                      boxShadow: focused ? `0 0 0 3px ${selected.accent}` : 'none',
                      transition: 'transform 0.15s',
                    }}>
                    <Radio size={19}/> {selected.live ? 'Смотреть' : 'Недоступен'}
                  </div>
                )}
              </TVFocusable>
              <TVFocusable id="tvch-fav" onEnter={() => void toggleFavorite(selected.id)}>
                {({ focused }) => (
                  <div className="flex items-center gap-2 rounded-xl px-7 py-3.5 text-[17px] font-bold"
                    style={{
                      background: focused ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.12)',
                      color: 'var(--t1)',
                      transform: focused ? 'scale(1.05)' : 'scale(1)',
                      boxShadow: focused ? `0 0 0 3px ${selected.accent}` : 'none',
                      transition: 'transform 0.15s',
                    }}>
                    <Star size={18} fill={selected.favorite ? '#f5c518' : 'none'}
                      style={{ color: selected.favorite ? '#f5c518' : 'currentColor' }}/>
                    {selected.favorite ? 'В избранном' : 'В избранное'}
                  </div>
                )}
              </TVFocusable>
            </div>

            {/* Телепрограмма */}
            <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              <p className="mb-2 text-[15px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
                Телепрограмма
              </p>
              {programme.length === 0 ? (
                <p className="text-[15px]" style={{ color: 'var(--t3)' }}>
                  Источник расписания для этого канала не подключён.
                </p>
              ) : programme.map((p) => (
                <div key={`${p.startsAt}-${p.title}`} className="flex gap-4 rounded-xl px-3 py-2"
                  style={{ background: p.live ? `color-mix(in srgb, ${selected.accent} 16%, transparent)` : 'transparent' }}>
                  <span className="w-14 shrink-0 pt-0.5 text-[15px] font-mono tabular-nums"
                    style={{ color: p.live ? selected.accent : 'var(--t3)' }}>{hhmm(p.startsAt)}</span>
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold" style={{ color: p.live ? 'var(--t1)' : 'var(--t2)' }}>
                      {p.title}
                      {p.live && <span className="ml-2 text-[11px] font-black uppercase" style={{ color: '#ef4444' }}>сейчас</span>}
                    </p>
                    {p.description && (
                      <p className="mt-0.5 line-clamp-2 text-[13.5px]" style={{ color: 'var(--t3)' }}>{p.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
