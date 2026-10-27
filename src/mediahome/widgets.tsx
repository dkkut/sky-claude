import React, { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Plus, X } from 'lucide-react';
import type { WidgetDef } from './api';
import { WaveShelves } from './WaveShelves';
import { usePlayerStore } from '@/player/playerStore';
import { useMusicStore } from '@/music/serverStore';
import { playMusicQueue } from '@/music/useMusicSync';
import { useMessengerStore } from '@/messenger/store';
import { useMoney } from '@/wallet/store';
import { apiWeather, type WeatherNow } from '@/bloom/weatherApi';
import { apiMediaActivity, type MediaActivity } from '@/extras/mediaActivityApi';
import { useModuleStore } from '@/data/state/modules';

/** Подписи типов виджетов (категории — для каталога в редакторе). */
export const WIDGET_META: Record<string, { label: string; cat: string; hint: string }> = {
  clock: { label: 'Большие часы', cat: 'time', hint: 'Время и дата на устройстве' },
  weather: { label: 'Погода', cat: 'time', hint: 'По вашему разрешению на геопозицию' },
  worldtime: { label: 'Мировое время', cat: 'time', hint: 'До 4 часовых поясов' },
  calendar: { label: 'Календарь', cat: 'time', hint: 'Текущий месяц' },
  nowplaying: { label: 'Что играет сейчас', cat: 'media', hint: 'Текущий трек или выпуск' },
  miniplayer: { label: 'Мини-плеер', cat: 'media', hint: 'Пауза и воспроизведение' },
  wave: { label: 'SkyWave', cat: 'media', hint: 'Выбранная персональная подборка' },
  continue: { label: 'Продолжить просмотр', cat: 'media', hint: 'Начатое кино, видео, подкасты, книги' },
  recent: { label: 'Недавно слушали', cat: 'personal', hint: 'История Sky Music' },
  favorites: { label: 'Избранная музыка', cat: 'personal', hint: 'Ваши любимые треки' },
  unread: { label: 'Непрочитанные сообщения', cat: 'social', hint: 'По умолчанию без текста сообщений' },
  activity: { label: 'Моя активность', cat: 'stats', hint: 'Время в музыке, видео, подкастах' },
  tasks: { label: 'Задачи и заметки', cat: 'tasks', hint: 'Хранятся на этом устройстве' },
  quick: { label: 'Быстрые действия', cat: 'quick', hint: 'Переходы в разделы Sky' },
  ai: { label: 'Sky AI', cat: 'eco', hint: 'Открывается по нажатию, запросы сами не отправляются' },
  points: { label: 'Sky Points и баланс', cat: 'eco', hint: 'Из вашего кошелька' },
  custom: { label: 'Свой виджет', cat: 'custom', hint: 'Счётчик, заметка, ссылка или прогресс' },
};
export const CATEGORIES: Record<string, string> = { time: 'Время и погода', media: 'Музыка и развлечения', personal: 'Личные данные', social: 'Общение', tasks: 'Задачи и мероприятия', stats: 'Статистика', quick: 'Быстрые действия', eco: 'Сервисы экосистемы', custom: 'Свои виджеты' };

const ACTIONS: Record<string, { label: string; tab?: string; module?: string }> = {
  music: { label: 'Музыка', tab: 'music' }, film: { label: 'Кино', tab: 'movies' }, video: { label: 'Видео', module: 'video' }, podcasts: { label: 'Подкасты', tab: 'podcasts' },
  books: { label: 'Книги', tab: 'books' }, messenger: { label: 'Чаты', module: 'messages' }, wallet: { label: 'Кошелёк', module: 'profile' }, go: { label: 'Sky GO', tab: 'go' },
  market: { label: 'Market', tab: 'market' }, ai: { label: 'Sky AI', tab: 'ai' }, profile: { label: 'Профиль', module: 'profile' }, storage: { label: 'Хранилище', module: 'profile' },
};
export const ALL_ACTIONS = Object.keys(ACTIONS);

const Box = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <div className="flex h-full min-w-0 flex-col gap-2">{title && <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>{title}</div>}{children}</div>
);
const cardBtn = 'rounded-full px-3 py-1.5 text-[12px] font-semibold';

const Clock = ({ w }: { w: WidgetDef }) => {
  const [now, setNow] = useState(() => new Date());
  const sec = w.cfg.seconds === true;
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), sec ? 1000 : 15000); return () => window.clearInterval(t); }, [sec]);
  const h12 = w.cfg.format24 === false;
  return (
    <Box>
      <div className="text-[40px] font-extrabold leading-none tabular-nums" style={{ color: 'var(--t1)' }}>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), hour12: h12 })}</div>
      <div className="text-[13px]" style={{ color: 'var(--t2)' }}>{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </Box>
  );
};

const Weather = () => {
  const [wx, setWx] = useState<WeatherNow | null>(null); const [state, setState] = useState<'idle' | 'loading' | 'denied' | 'error'>('idle');
  const ask = () => {
    if (!navigator.geolocation) { setState('error'); return; }
    setState('loading');
    navigator.geolocation.getCurrentPosition(async (p) => { const r = await apiWeather(p.coords.latitude, p.coords.longitude); if (r) { setWx(r); setState('idle'); } else setState('error'); }, () => setState('denied'), { timeout: 10000, maximumAge: 600000 });
  };
  return (
    <Box title="Погода">
      {wx ? <><div className="text-[32px] font-bold" style={{ color: 'var(--t1)' }}>{Math.round(wx.tempC)}°</div><div className="text-[12px]" style={{ color: 'var(--t2)' }} translate="no">{wx.city ?? ''}</div></>
        : <><button type="button" onClick={ask} className={cardBtn} style={{ background: 'var(--accent)', color: '#fff' }}>{state === 'loading' ? 'Определяем…' : 'Показать погоду'}</button>
            {state === 'denied' && <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Нет доступа к геопозиции — разрешите её в настройках браузера.</p>}
            {state === 'error' && <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Погода сейчас недоступна.</p>}</>}
    </Box>
  );
};

const WorldTime = ({ w }: { w: WidgetDef }) => {
  const [now, setNow] = useState(() => new Date()); useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 15000); return () => window.clearInterval(t); }, []);
  const zones = (Array.isArray(w.cfg.zones) && w.cfg.zones.length ? (w.cfg.zones as string[]) : ['Europe/Moscow', 'Europe/London', 'America/New_York', 'Asia/Tokyo']);
  const fmt = (z: string) => { try { return now.toLocaleTimeString([], { timeZone: z, hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };
  return (
    <Box title="Мировое время">
      <div className="grid grid-cols-2 gap-2">{zones.map((z) => <div key={z}><div className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--t1)' }}>{fmt(z)}</div><div className="truncate text-[11px]" style={{ color: 'var(--t3)' }} translate="no">{z.split('/').pop()?.replace(/_/g, ' ')}</div></div>)}</div>
    </Box>
  );
};

const Calendar = () => {
  const d = new Date(); const y = d.getFullYear(); const m = d.getMonth();
  const first = (new Date(y, m, 1).getDay() + 6) % 7; const days = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(first).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <Box title={d.toLocaleDateString([], { month: 'long', year: 'numeric' })}>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px]" style={{ color: 'var(--t2)' }}>
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((x) => <div key={x} style={{ color: 'var(--t3)' }}>{x}</div>)}
        {cells.map((c, i) => <div key={i} className="rounded-full py-0.5" style={c === d.getDate() ? { background: 'var(--accent)', color: '#fff' } : undefined}>{c || ''}</div>)}
      </div>
    </Box>
  );
};

const NowPlaying = ({ compact }: { compact?: boolean }) => {
  const item = usePlayerStore((s) => s.item); const playing = usePlayerStore((s) => s.isPlaying); const set = usePlayerStore((s) => s.setPlaying);
  if (!item) return <Box title="Сейчас играет"><p className="text-[13px]" style={{ color: 'var(--t2)' }}>Ничего не играет.</p></Box>;
  return (
    <Box title={compact ? undefined : 'Сейчас играет'}>
      <div className="flex items-center gap-3">
        <button type="button" aria-label={playing ? 'Пауза' : 'Играть'} onClick={() => set(!playing)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: 'var(--accent)', color: '#fff' }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <div className="min-w-0"><div className="truncate text-[14px] font-semibold" style={{ color: 'var(--t1)' }} translate="no">{item.title}</div><div className="truncate text-[12px]" style={{ color: 'var(--t3)' }} translate="no">{item.author}</div></div>
      </div>
    </Box>
  );
};

const TrackList = ({ kind }: { kind: 'recent' | 'favorites' }) => {
  const { tracks, history, favorites, load } = useMusicStore(); useEffect(() => { void load(); }, [load]);
  const list = useMemo(() => (kind === 'recent' ? history.slice(0, 5) : tracks.filter((t) => favorites.includes(t.id)).slice(0, 5)), [kind, history, tracks, favorites]);
  const pool = (kind === 'recent' ? history : tracks) as unknown as Parameters<typeof playMusicQueue>[0];
  return (
    <Box title={kind === 'recent' ? 'Недавно слушали' : 'Избранная музыка'}>
      {list.length === 0 ? <p className="text-[13px]" style={{ color: 'var(--t2)' }}>{kind === 'recent' ? 'История пока пуста.' : 'В избранном пока ничего нет.'}</p>
        : list.map((t) => <button key={t.id} type="button" onClick={() => playMusicQueue(pool, t.id)} className="truncate text-left text-[13px]" style={{ color: 'var(--t1)' }}><span translate="no">{t.title}</span> <span style={{ color: 'var(--t3)' }} translate="no">· {t.artist}</span></button>)}
    </Box>
  );
};

const Unread = ({ w }: { w: WidgetDef }) => {
  const { chats, messages } = useMessengerStore(); const setActiveModule = useModuleStore((s) => s.setActiveModule);
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of messages) if (!x.fromMe && x.status !== 'read') m.set(x.chatId, (m.get(x.chatId) ?? 0) + 1);
    return chats.filter((c) => !c.muted && !c.archived && m.get(c.id)).map((c) => ({ c, n: m.get(c.id)! })).sort((a, b) => b.n - a.n).slice(0, 4);
  }, [chats, messages]);
  const total = rows.reduce((a, r) => a + r.n, 0);
  return (
    <Box title="Сообщения">
      <button type="button" onClick={() => setActiveModule('messages')} className="text-left">
        <div className="text-[28px] font-bold" style={{ color: 'var(--t1)' }}>{total}</div>
        <div className="text-[12px]" style={{ color: 'var(--t2)' }}>{total ? 'непрочитанных' : 'Всё прочитано'}</div>
      </button>
      {w.cfg.showText !== false && rows.map((r) => <div key={r.c.id} className="truncate text-[12px]" style={{ color: 'var(--t2)' }}><span translate="no">{r.c.name}</span> · {r.n}</div>)}
    </Box>
  );
};

const Activity = () => {
  const [a, setA] = useState<MediaActivity | null | undefined>(undefined); useEffect(() => { void apiMediaActivity().then(setA); }, []);
  const m = (s: number) => `${Math.round(s / 60)} мин`;
  if (a === undefined) return <Box title="Моя активность"><p className="text-[12px]" style={{ color: 'var(--t3)' }}>Загрузка…</p></Box>;
  if (!a) return <Box title="Моя активность"><p className="text-[12px]" style={{ color: 'var(--t3)' }}>Данные недоступны.</p></Box>;
  return <Box title="Сегодня"><div className="grid grid-cols-3 gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>{([['Музыка', a.today.music], ['Видео', a.today.video], ['Подкасты', a.today.podcasts]] as [string, number][]).map(([l, s]) => <div key={l}><div className="text-[17px] font-bold" style={{ color: 'var(--t1)' }}>{m(s)}</div>{l}</div>)}</div></Box>;
};

const Tasks = ({ id }: { id: string }) => {
  const key = `sky:home:tasks:${id}`;
  const [items, setItems] = useState<{ t: string; d: boolean }[]>(() => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } });
  const [txt, setTxt] = useState('');
  const save = (n: { t: string; d: boolean }[]) => { setItems(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* память недоступна */ } };
  return (
    <Box title="Задачи">
      {items.map((x, i) => <div key={i} className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--t1)' }}>
        <input type="checkbox" checked={x.d} onChange={() => save(items.map((y, j) => (j === i ? { ...y, d: !y.d } : y)))} />
        <span className="min-w-0 flex-1 truncate" translate="no" style={x.d ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{x.t}</span>
        <button type="button" aria-label="Удалить" onClick={() => save(items.filter((_, j) => j !== i))}><X size={12} /></button></div>)}
      <form onSubmit={(e) => { e.preventDefault(); const t = txt.trim().slice(0, 100); if (t && items.length < 30) { save([...items, { t, d: false }]); setTxt(''); } }} className="flex gap-2">
        <input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Новая задача" maxLength={100} className="min-w-0 flex-1 rounded-full border bg-transparent px-3 py-1 text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--t1)' }} />
        <button type="submit" aria-label="Добавить" className="grid h-7 w-7 place-items-center rounded-full" style={{ background: 'var(--accent)', color: '#fff' }}><Plus size={14} /></button>
      </form>
      <p className="text-[10px]" style={{ color: 'var(--t3)' }}>Хранится только на этом устройстве.</p>
    </Box>
  );
};

const Quick = ({ w, onNav }: { w: WidgetDef; onNav: (t: string) => void }) => {
  const setActiveModule = useModuleStore((s) => s.setActiveModule);
  const acts = (Array.isArray(w.cfg.actions) && w.cfg.actions.length ? (w.cfg.actions as string[]) : ['music', 'film', 'video', 'messenger', 'go', 'ai']).filter((a) => ACTIONS[a]);
  return (
    <Box title="Быстрые действия">
      <div className="flex flex-wrap gap-2">{acts.map((a) => <button key={a} type="button" className={cardBtn} style={{ background: 'var(--accent-bg, rgba(99,102,241,.15))', color: 'var(--t1)' }}
        onClick={() => { const x = ACTIONS[a]; if (x.tab) onNav(x.tab); else if (x.module) setActiveModule(x.module as Parameters<typeof setActiveModule>[0]); }}>{ACTIONS[a].label}</button>)}</div>
    </Box>
  );
};

const Points = () => {
  const { balance, points, refresh } = useMoney() as unknown as { balance: number; points: number; refresh?: () => Promise<void> | void };
  useEffect(() => { void refresh?.(); }, [refresh]);
  return <Box title="Кошелёк"><div className="text-[24px] font-bold" style={{ color: 'var(--t1)' }}>{Math.round(balance)} ₽</div><div className="text-[13px]" style={{ color: 'var(--t2)' }}>{Math.round(points)} баллов Prime</div></Box>;
};

const Custom = ({ w }: { w: WidgetDef }) => {
  const key = `sky:home:custom:${w.id}`; const tpl = String(w.cfg.template ?? 'note');
  const [n, setN] = useState(() => { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } });
  const set = (v: number) => { setN(v); try { localStorage.setItem(key, String(v)); } catch { /* память недоступна */ } };
  const title = String(w.cfg.title ?? 'Мой виджет'); const value = String(w.cfg.value ?? '');
  return (
    <Box title={title}>
      {tpl === 'counter' && <div className="flex items-center gap-3"><button type="button" aria-label="Минус" className={cardBtn} onClick={() => set(Math.max(0, n - 1))} style={{ background: 'var(--accent-bg, rgba(99,102,241,.15))', color: 'var(--t1)' }}>−</button><span className="text-[24px] font-bold tabular-nums" style={{ color: 'var(--t1)' }}>{n}</span><button type="button" aria-label="Плюс" className={cardBtn} onClick={() => set(n + 1)} style={{ background: 'var(--accent)', color: '#fff' }}>+</button></div>}
      {tpl === 'note' && <p className="whitespace-pre-wrap text-[13px]" style={{ color: 'var(--t1)' }} translate="no">{value || 'Текст не задан'}</p>}
      {tpl === 'link' && (typeof w.cfg.url === 'string' && w.cfg.url ? <a href={w.cfg.url} target="_blank" rel="noopener noreferrer" className="text-[13px] underline" style={{ color: 'var(--accent)' }}>{value || 'Открыть ссылку'}</a> : <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Ссылка не задана</p>)}
      {tpl === 'progress' && <div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full" style={{ width: `${Math.min(100, n)}%`, background: 'var(--accent)' }} /></div><input type="range" min={0} max={100} value={Math.min(100, n)} onChange={(e) => set(Number(e.target.value))} aria-label="Прогресс" className="mt-2 w-full" /></div>}
    </Box>
  );
};

export const WidgetBody = ({ w, onNav }: { w: WidgetDef; onNav: (t: string) => void }) => {
  switch (w.type) {
    case 'clock': return <Clock w={w} />;
    case 'weather': return <Weather />;
    case 'worldtime': return <WorldTime w={w} />;
    case 'calendar': return <Calendar />;
    case 'nowplaying': return <NowPlaying />;
    case 'miniplayer': return <NowPlaying compact />;
    case 'wave': return <WaveShelves onNav={onNav} only={typeof w.cfg.shelf === 'string' ? w.cfg.shelf : 'for_you'} />;
    case 'continue': return <WaveShelves onNav={onNav} only="continue" />;
    case 'recent': return <TrackList kind="recent" />;
    case 'favorites': return <TrackList kind="favorites" />;
    case 'unread': return <Unread w={w} />;
    case 'activity': return <Activity />;
    case 'tasks': return <Tasks id={w.id} />;
    case 'quick': return <Quick w={w} onNav={onNav} />;
    case 'ai': return <Box title="Sky AI"><button type="button" className={cardBtn} style={{ background: 'var(--accent)', color: '#fff' }} onClick={() => onNav('ai')}>Открыть Sky AI</button></Box>;
    case 'points': return <Points />;
    case 'custom': return <Custom w={w} />;
    default: return <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Виджет недоступен</p>;
  }
};

/** Ошибка одного виджета не ломает экран. */
export class WidgetBoundary extends React.Component<{ children: React.ReactNode }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() { return { bad: true }; }
  render() { return this.state.bad ? <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Не удалось показать виджет</p> : this.props.children; }
}
