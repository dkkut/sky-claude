import React, { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Plus, X, ChevronRight, type LucideIcon, Music2, Film, Clapperboard, Mic2, BookOpen, MessageCircle, Wallet, Car, ShoppingBag, Sparkles, User, HardDrive } from 'lucide-react';
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
import { goApi, type GoOrder } from '@/go/api';
import { apiOrders } from '@/marketplace/marketApi';
import { apiCall } from '@/core/auth/api';
import { kbMe, kbAnalytics, type Analytics } from '@/kassabiz/api';
import { Eye, EyeOff } from 'lucide-react';

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
  goorders: { label: 'Заказы Sky GO', cat: 'go', hint: 'Активные поездки, доставки, еда' },
  marketorders: { label: 'Заказы Market', cat: 'go', hint: 'Ваши покупки в пути' },
  events: { label: 'Популярные события', cat: 'time', hint: 'Билеты, которые покупают чаще всего' },
  bookings: { label: 'Мои бронирования', cat: 'go', hint: 'Записи в организациях, жильё, туры, отели' },
  analytics: { label: 'Аналитика бизнеса', cat: 'stats', hint: 'Sky для бизнеса: день, неделя, месяц' },
  storage: { label: 'Личное хранилище', cat: 'eco', hint: 'Сколько места занято' },
  security: { label: 'Защита аккаунта', cat: 'eco', hint: 'Уровень защиты, данные можно скрыть' },
  tasks: { label: 'Задачи и заметки', cat: 'tasks', hint: 'Хранятся на этом устройстве' },
  quick: { label: 'Быстрые действия', cat: 'quick', hint: 'Переходы в разделы Sky' },
  ai: { label: 'Sky AI', cat: 'eco', hint: 'Открывается по нажатию, запросы сами не отправляются' },
  points: { label: 'Sky Points и баланс', cat: 'eco', hint: 'Из вашего кошелька' },
  custom: { label: 'Свой виджет', cat: 'custom', hint: 'Счётчик, заметка, ссылка или прогресс' },
};
export const CATEGORIES: Record<string, string> = { time: 'Время и погода', media: 'Музыка и развлечения', personal: 'Личные данные', social: 'Общение', tasks: 'Задачи и мероприятия', stats: 'Статистика', quick: 'Быстрые действия', go: 'Sky GO и заказы', eco: 'Сервисы экосистемы', custom: 'Свои виджеты' };

const ACTIONS: Record<string, { label: string; tab?: string; module?: string }> = {
  music: { label: 'Музыка', tab: 'music' }, film: { label: 'Кино', tab: 'movies' }, video: { label: 'Видео', module: 'video' }, podcasts: { label: 'Подкасты', tab: 'podcasts' },
  books: { label: 'Книги', tab: 'books' }, messenger: { label: 'Чаты', module: 'messages' }, wallet: { label: 'Кошелёк', module: 'profile' }, go: { label: 'Sky GO', tab: 'go' },
  market: { label: 'Market', tab: 'market' }, ai: { label: 'Sky AI', tab: 'ai' }, profile: { label: 'Профиль', module: 'profile' }, storage: { label: 'Хранилище', module: 'profile' },
};
export const ALL_ACTIONS = Object.keys(ACTIONS);

const Box = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <div className="flex h-full min-w-0 flex-col gap-2">{title && <div className="text-[13px] font-semibold" style={{ color: 'var(--t3)', letterSpacing: '-0.01em' }}>{title}</div>}{children}</div>
);
const cardBtn = 'rounded-full px-4 py-2 text-[13px] font-semibold transition active:scale-95 active:opacity-80 hover:brightness-110';
const QICON: Record<string, { Icon: LucideIcon; from: string; to: string }> = {
  music: { Icon: Music2, from: '#fb5c74', to: '#f43f5e' }, film: { Icon: Film, from: '#a78bfa', to: '#7c3aed' }, video: { Icon: Clapperboard, from: '#fb923c', to: '#ef4444' }, podcasts: { Icon: Mic2, from: '#34d399', to: '#059669' },
  books: { Icon: BookOpen, from: '#fbbf24', to: '#d97706' }, messenger: { Icon: MessageCircle, from: '#4ade80', to: '#16a34a' }, wallet: { Icon: Wallet, from: '#38bdf8', to: '#0284c7' }, go: { Icon: Car, from: '#2dd4bf', to: '#0d9488' },
  market: { Icon: ShoppingBag, from: '#f472b6', to: '#db2777' }, ai: { Icon: Sparkles, from: '#818cf8', to: '#4f46e5' }, profile: { Icon: User, from: '#94a3b8', to: '#475569' }, storage: { Icon: HardDrive, from: '#60a5fa', to: '#2563eb' },
};

const Clock = ({ w }: { w: WidgetDef }) => {
  const [now, setNow] = useState(() => new Date());
  const sec = w.cfg.seconds === true;
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), sec ? 1000 : 15000); return () => window.clearInterval(t); }, [sec]);
  const h12 = w.cfg.format24 === false;
  return (
    <Box>
      <div className="text-[48px] font-semibold leading-none tabular-nums" style={{ color: 'var(--t1)', letterSpacing: '-0.04em' }}>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), hour12: h12 })}</div>
      <div className="text-[14px] font-medium capitalize" style={{ color: 'var(--t2)' }}>{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>
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
      {wx ? <><div className="text-[44px] font-light leading-none" style={{ color: 'var(--t1)', letterSpacing: '-0.04em' }}>{Math.round(wx.tempC)}°</div><div className="text-[12px]" style={{ color: 'var(--t2)' }} translate="no">{wx.city ?? ''}</div></>
        : <><button type="button" onClick={ask} className={cardBtn} style={{ background: 'var(--accent)', color: '#fff' }}>{state === 'loading' ? 'Определяем…' : 'Показать погоду'}</button>
            {state === 'denied' && <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Нет доступа к геопозиции — разрешите её в настройках браузера.</p>}
            {state === 'error' && <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Погода сейчас недоступна.</p>}</>}
      <p className="text-[9px]" style={{ color: 'var(--t3)' }} translate="no">Weather data by Open-Meteo.com</p>
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
      <div className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 lg:grid-cols-6">{acts.map((a) => { const q = QICON[a]; const Ic = q?.Icon;
        return (
          <button key={a} type="button" className="group flex min-w-0 flex-col items-center gap-1.5 rounded-2xl py-1 transition active:scale-95"
            onClick={() => { const x = ACTIONS[a]; if (x.tab) onNav(x.tab); else if (x.module) setActiveModule(x.module as Parameters<typeof setActiveModule>[0]); }}>
            <span className="grid h-[54px] w-[54px] place-items-center rounded-[16px] transition group-hover:-translate-y-0.5 group-hover:brightness-110"
              style={{ background: `linear-gradient(160deg, ${q?.from ?? '#818cf8'}, ${q?.to ?? '#4f46e5'})`, boxShadow: `0 6px 14px -6px ${q?.to ?? '#4f46e5'}, inset 0 1px 0 rgba(255,255,255,.35)` }}>
              {Ic && <Ic size={26} strokeWidth={2} color="#fff" />}
            </span>
            <span className="max-w-full truncate text-[11.5px] font-medium" style={{ color: 'var(--t1)' }}>{ACTIONS[a].label}</span>
          </button>); })}</div>
    </Box>
  );
};

const GoOrders = ({ onNav }: { onNav: (t: string) => void }) => {
  const [o, setO] = useState<GoOrder[] | null | undefined>(undefined);
  useEffect(() => { let on = true; void goApi.orders({ status: 'active' }).then((r) => { if (on) setO(r.ok ? r.data?.orders ?? [] : null); }); return () => { on = false; }; }, []);
  const KIND: Record<string, string> = { taxi: 'Такси', food: 'Еда', delivery: 'Доставка', stay: 'Жильё' };
  return (
    <Box title="Заказы Sky GO">
      {o === undefined ? <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Загрузка…</p> : o === null ? <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Данные недоступны.</p>
        : o.length === 0 ? <p className="text-[13px]" style={{ color: 'var(--t2)' }}>Активных заказов нет.</p>
        : o.slice(0, 4).map((x) => <button key={x.id} type="button" onClick={() => onNav('go')} className="flex w-full items-center gap-1 rounded-xl py-1.5 text-left text-[14px] transition active:opacity-60" style={{ color: 'var(--t1)' }}><span className="min-w-0 flex-1 truncate">{KIND[x.kind] ?? x.kind} <span style={{ color: 'var(--t3)' }}>· {x.status}</span></span><ChevronRight size={16} style={{ color: 'var(--t3)' }} /></button>)}
    </Box>
  );
};

const MarketOrders = ({ onNav }: { onNav: (t: string) => void }) => {
  const [o, setO] = useState<{ id: string; title: string; status: string }[] | null | undefined>(undefined);
  useEffect(() => { let on = true; void apiOrders('buyer').then((r) => { if (on) setO(r.ok ? (r.data?.items ?? []) as { id: string; title: string; status: string }[] : null); }); return () => { on = false; }; }, []);
  const active = (o ?? []).filter((x) => !['completed', 'cancelled', 'canceled', 'refunded'].includes(x.status));
  return (
    <Box title="Заказы Market">
      {o === undefined ? <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Загрузка…</p> : o === null ? <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Данные недоступны.</p>
        : active.length === 0 ? <p className="text-[13px]" style={{ color: 'var(--t2)' }}>Активных заказов нет.</p>
        : active.slice(0, 4).map((x) => <button key={x.id} type="button" onClick={() => onNav('market')} className="truncate text-left text-[13px]" style={{ color: 'var(--t1)' }} translate="no">{x.title}</button>)}
    </Box>
  );
};

const useData = <T,>(path: string) => {
  const [d, setD] = useState<T | null | undefined>(undefined);
  useEffect(() => { let on = true; void apiCall<T>(`/api/media/home/data/${path}`).then((r) => { if (on) setD(r.ok ? r.data ?? null : null); }); return () => { on = false; }; }, [path]);
  return d;
};
const Wait = ({ d, children }: { d: unknown; children: React.ReactNode }) => d === undefined ? <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Загрузка…</p> : d === null ? <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Данные недоступны.</p> : <>{children}</>;
const when = (iso: string) => { try { return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

const Events = ({ onNav }: { onNav: (t: string) => void }) => {
  const d = useData<{ events: { id: string; title: string; city: string; startsAt: string }[] }>('events');
  return (
    <Box title="Популярные события">
      <Wait d={d}>{d && (d.events.length === 0 ? <p className="text-[13px]" style={{ color: 'var(--t2)' }}>Пока нет событий с проданными билетами.</p>
        : d.events.slice(0, 4).map((e) => <button key={e.id} type="button" onClick={() => onNav('tickets')} className="truncate text-left text-[13px]" style={{ color: 'var(--t1)' }}><span translate="no">{e.title}</span> <span style={{ color: 'var(--t3)' }} translate="no">· {e.city} · {when(e.startsAt)}</span></button>))}</Wait>
    </Box>
  );
};

const Bookings = ({ onNav }: { onNav: (t: string) => void }) => {
  const d = useData<{ bookings: { kind: string; id: string; title: string; sub: string; at: string }[] }>('bookings');
  return (
    <Box title="Мои бронирования">
      <Wait d={d}>{d && (d.bookings.length === 0 ? <p className="text-[13px]" style={{ color: 'var(--t2)' }}>Активных бронирований нет.</p>
        : d.bookings.slice(0, 4).map((b) => <button key={`${b.kind}${b.id}`} type="button" onClick={() => onNav('go')} className="truncate text-left text-[13px]" style={{ color: 'var(--t1)' }}><span translate="no">{b.title}</span> <span style={{ color: 'var(--t3)' }} translate="no">· {b.kind === 'place' ? when(b.at) : b.sub}</span></button>))}</Wait>
    </Box>
  );
};

const Storage = () => {
  const d = useData<{ usedBytes: number; quotaBytes: number }>('storage');
  const gb = (b: number) => (b / 1073741824).toFixed(b < 1073741824 ? 2 : 1);
  return (
    <Box title="Личное хранилище">
      <Wait d={d}>{d && <><div className="text-[18px] font-bold" style={{ color: 'var(--t1)' }}>{gb(d.usedBytes)} ГБ <span className="text-[12px] font-normal" style={{ color: 'var(--t3)' }}>из {gb(d.quotaBytes)} ГБ</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${Math.min(100, d.quotaBytes ? (d.usedBytes / d.quotaBytes) * 100 : 0)}%`, background: d.usedBytes / (d.quotaBytes || 1) > 0.9 ? '#f87171' : 'var(--accent)' }} /></div></>}</Wait>
    </Box>
  );
};

const LEVEL: Record<string, { label: string; color: string }> = { low: { label: 'Слабая защита', color: '#f87171' }, medium: { label: 'Средняя защита', color: '#fbbf24' }, high: { label: 'Высокая защита', color: '#34d399' } };
const Security = () => {
  const d = useData<{ score: number; level: string; factors: { key: string; label: string; weight: number; on: boolean }[] }>('security');
  const KEY = 'sky:home:security:hidden';
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  const toggle = () => { const v = !hidden; setHidden(v); try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* память недоступна */ } };
  const lv = LEVEL[d?.level ?? 'low'];
  return (
    <Box title="Защита аккаунта">
      <Wait d={d}>{d && <>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1" style={hidden ? { filter: 'blur(8px)', userSelect: 'none' } : undefined} aria-hidden={hidden}>
            <div className="text-[22px] font-bold" style={{ color: lv.color }}>{d.score}/100</div>
            <div className="text-[12px]" style={{ color: 'var(--t2)' }}>{lv.label}</div>
          </div>
          <button type="button" onClick={toggle} aria-pressed={hidden} aria-label={hidden ? 'Показать данные' : 'Скрыть данные'} className="grid h-8 w-8 place-items-center rounded-full border" style={{ borderColor: 'var(--border)', color: 'var(--t1)' }}>{hidden ? <Eye size={14} /> : <EyeOff size={14} />}</button>
        </div>
        <div style={hidden ? { filter: 'blur(6px)', userSelect: 'none' } : undefined} aria-hidden={hidden}>
          {d.factors.filter((f) => !f.on).slice(0, 3).map((f) => <div key={f.key} className="text-[12px]" style={{ color: 'var(--t2)' }}>Не включено: {f.label}</div>)}
          {d.factors.every((f) => f.on) && <div className="text-[12px]" style={{ color: 'var(--t2)' }}>Все защитные меры включены.</div>}
        </div></>}</Wait>
    </Box>
  );
};

const BizAnalytics = ({ w }: { w: WidgetDef }) => {
  const [a, setA] = useState<Analytics | null | undefined>(undefined);
  const days = w.cfg.period === 'day' ? 1 : w.cfg.period === 'week' ? 7 : 30;
  useEffect(() => { let on = true; void (async () => { const me = await kbMe(); if (!on) return; if (!me.ok || !me.data?.business) { setA(null); return; } const r = await kbAnalytics(days); if (on) setA(r.ok ? r.data?.analytics ?? null : null); })(); return () => { on = false; }; }, [days]);
  return (
    <Box title={days === 1 ? 'Бизнес: сегодня' : days === 7 ? 'Бизнес: неделя' : 'Бизнес: месяц'}>
      {a === undefined ? <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Загрузка…</p> : a === null ? <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Нет подключённого бизнеса или данные недоступны.</p>
        : <div className="grid grid-cols-3 gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>
            <div><div className="text-[17px] font-bold" style={{ color: 'var(--t1)' }}>{Math.round(a.confirmedSumRub)} ₽</div>подтверждено</div>
            <div><div className="text-[17px] font-bold" style={{ color: 'var(--t1)' }}>{a.requests}</div>заявок</div>
            <div><div className="text-[17px] font-bold" style={{ color: 'var(--t1)' }}>{Math.round(a.averageRub)} ₽</div>средний чек</div>
          </div>}
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
    case 'events': return <Events onNav={onNav} />;
    case 'bookings': return <Bookings onNav={onNav} />;
    case 'analytics': return <BizAnalytics w={w} />;
    case 'storage': return <Storage />;
    case 'security': return <Security />;
    case 'goorders': return <GoOrders onNav={onNav} />;
    case 'marketorders': return <MarketOrders onNav={onNav} />;
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
