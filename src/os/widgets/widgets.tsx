/** Содержимое виджетов. Только настоящие данные; у каждого — состояния загрузки и ошибки. */
import React, { useCallback, useEffect, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Cloud, Sun, CloudRain, CloudSnow, CloudFog, CloudLightning, Music2, Moon, Sparkles, Lock, Send, MapPin } from 'lucide-react';
import { usePlayerStore } from '@/player/playerStore';
import { useNotifStore } from '@/notifications/store';
import { useSettings } from '@/settings/store';
import { useMoney } from '@/wallet/store';
import { apiAiAsk } from '@/ai/aiApi';
import { isElectron } from '@/core/nativeApp';
import { runShortcut } from '@/shortcuts/shortcuts';
import { readCachedWeather, refreshWeather, useLockScreen } from '@/os/lockStore';
import { getG } from '@/music/utils';
import { SkyCloud } from '@/os/SkyCloud';
import type { WeatherKind } from '@/bloom/weatherApi';
import { useWidgets } from './widgetStore';

const W_ICON: Record<WeatherKind, typeof Sun> = { clear: Sun, cloudy: Cloud, fog: CloudFog, rain: CloudRain, snow: CloudSnow, storm: CloudLightning };
const sub = { color: 'rgba(255,255,255,0.65)' } as const;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const Btn = ({ children, onClick, primary, label, disabled }: { children: React.ReactNode; onClick: () => void; primary?: boolean; label?: string; disabled?: boolean }) => (
  <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-bold disabled:opacity-50"
    style={{ background: primary ? '#fff' : 'rgba(255,255,255,0.12)', color: primary ? '#0a0a14' : '#fff', border: '1px solid rgba(255,255,255,0.14)' }}>{children}</button>
);
const Loading = () => <div role="status" className="flex items-center gap-2 py-4 text-[13px]" style={sub}><span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />Загрузка…</div>;
const Err = ({ text, action }: { text: string; action?: React.ReactNode }) => (
  <div role="alert" className="flex flex-col items-center gap-2 py-3 text-center"><SkyCloud state="error" size={64} /><p className="text-[12.5px]" style={sub}>{text}</p>{action}</div>
);

/* ── Погода ── */
export const WeatherWidget = () => {
  const [w, setW] = useState(readCachedWeather);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>(() => (readCachedWeather() ? 'idle' : 'loading'));
  const load = useCallback(async () => { setState('loading'); const r = await refreshWeather(); if (r) { setW(readCachedWeather()); setState('idle'); } else setState(readCachedWeather() ? 'idle' : 'error'); }, []);
  useEffect(() => { void load(); }, [load]);
  if (state === 'loading' && !w) return <Loading />;
  if (!w) return <Err text="Погода недоступна: разрешите определение местоположения или повторите позже." action={<Btn primary onClick={() => void load()}><MapPin size={14} />Повторить</Btn>} />;
  const I = W_ICON[w.w.kind] ?? Cloud;
  return (
    <div className="flex items-center gap-4 py-1">
      <I size={46} />
      <div><p className="text-[34px] font-extrabold leading-none">{w.w.tempC >= 0 ? '+' : ''}{Math.round(w.w.tempC)}°</p><p className="text-[13px]" style={sub} translate="no">{w.w.city ?? ''}</p>
        <p className="mt-1 text-[11px]" style={sub}>Обновлено {new Date(w.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</p></div>
    </div>
  );
};

/* ── Музыка ── */
export const MusicWidget = () => {
  const item = usePlayerStore(s => s.item); const playing = usePlayerStore(s => s.isPlaying);
  const cur = usePlayerStore(s => s.currentTime); const dur = usePlayerStore(s => s.duration);
  const requestPlay = usePlayerStore(s => s.requestPlay); const next = usePlayerStore(s => s.nextTrack); const prev = usePlayerStore(s => s.prevTrack);
  if (!item || (item.kind !== 'music' && item.kind !== 'podcast')) return <div className="flex flex-col items-center gap-2 py-3 text-center"><SkyCloud state="waiting" size={64} /><p className="text-[12.5px]" style={sub}>Сейчас ничего не играет</p></div>;
  const [a, b] = getG(item.id);
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl" style={{ background: `linear-gradient(135deg,${a},${b})` }}>
          {item.coverUrl ? <img src={item.coverUrl} alt="" className="h-full w-full object-cover" /> : <Music2 size={26} />}
        </div>
        <div className="min-w-0"><p className="truncate text-[15px] font-extrabold" translate="no">{item.title}</p><p className="truncate text-[12.5px]" style={sub} translate="no">{item.author}</p></div>
      </div>
      <div className="my-3 h-1 overflow-hidden rounded-full bg-white/20"><div className="h-full bg-white" style={{ width: `${dur > 0 ? Math.min(100, (cur / dur) * 100) : 0}%` }} /></div>
      <div className="flex items-center justify-between text-[11px]" style={sub}><span>{fmt(cur)}</span><span>{fmt(dur)}</span></div>
      <div className="mt-2 flex items-center justify-center gap-6">
        <button type="button" aria-label="Предыдущий" onClick={prev}><SkipBack size={22} fill="#fff" /></button>
        <button type="button" aria-label={playing ? 'Пауза' : 'Играть'} onClick={() => requestPlay(!playing)} className="grid h-11 w-11 place-items-center rounded-full bg-white text-black">{playing ? <Pause size={20} fill="#0a0a14" /> : <Play size={20} fill="#0a0a14" style={{ marginLeft: 2 }} />}</button>
        <button type="button" aria-label="Следующий" onClick={next}><SkipForward size={22} fill="#fff" /></button>
      </div>
    </div>
  );
};

/* ── Уведомления ── */
export const NotificationsWidget = () => {
  const notifs = useNotifStore(s => s.notifs); const markRead = useNotifStore(s => s.markRead); const markAll = useNotifStore(s => s.markAllRead);
  const list = notifs.slice(0, 8);
  if (list.length === 0) return <div className="flex flex-col items-center gap-2 py-3 text-center"><SkyCloud state="joy" size={64} /><p className="text-[12.5px]" style={sub}>Новых уведомлений нет</p></div>;
  return (
    <div>
      <div className="max-h-[260px] space-y-1.5 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {list.map(n => (
          <button key={n.id} type="button" onClick={() => markRead(n.id)} className="flex w-full items-start gap-2.5 rounded-xl p-2 text-left" style={{ background: n.read ? 'transparent' : 'rgba(139,92,246,0.18)' }}>
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: n.read ? 'transparent' : '#a78bfa' }} />
            <span className="min-w-0"><span className="block truncate text-[13px] font-bold" translate="no">{n.title}</span><span className="block truncate text-[12px]" style={sub} translate="no">{n.body}</span></span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-end"><Btn onClick={markAll}>Прочитать все</Btn></div>
    </div>
  );
};

/* ── Ресурсы устройства ── */
const Bar = ({ label, text, pct }: { label: string; text: string; pct: number | null }) => (
  <div className="mb-2.5"><div className="mb-1 flex justify-between text-[12.5px] font-semibold"><span>{label}</span><span style={sub}>{text}</span></div>
    <div className="h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: (pct ?? 0) > 85 ? '#f87171' : 'linear-gradient(90deg,#8b5cf6,#60a5fa)', transition: 'width .5s' }} /></div></div>
);
export const ResourcesWidget = () => {
  const [st, setSt] = useState<{ cpu: number | null; gpu: number | null; used: number; total: number } | null | 'none'>(null);
  useEffect(() => {
    // Опрос только пока виджет открыт и вкладка видна.
    if (!isElectron() || !window.sky?.island) { setSt('none'); return undefined; }
    let alive = true;
    const tick = async () => { if (document.hidden) return; const s = await window.sky!.island!.stats(); if (alive) setSt(s ? { cpu: s.cpu, gpu: s.gpu, used: s.ramUsedGb, total: s.ramTotalGb } : 'none'); };
    void tick(); const t = setInterval(() => void tick(), 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (st === null) return <Loading />;
  if (st === 'none') {
    const nav = navigator as Navigator & { deviceMemory?: number }; const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    return (
      <div>
        <p className="mb-2 text-[12px]" style={sub}>В браузере и на телефоне Sky видит только это; полная загрузка процессора, видеокарты и памяти — в приложении для Windows.</p>
        <Bar label="Ядер процессора" text={String(navigator.hardwareConcurrency ?? '—')} pct={null} />
        <Bar label="Память устройства" text={nav.deviceMemory ? `около ${nav.deviceMemory} ГБ` : 'нет данных'} pct={null} />
        {mem && <Bar label="Память страницы Sky" text={`${Math.round(mem.usedJSHeapSize / 1048576)} МБ`} pct={Math.min(100, (mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100)} />}
      </div>
    );
  }
  return (
    <div>
      <Bar label="Процессор" text={st.cpu != null ? `${st.cpu}%` : '…'} pct={st.cpu} />
      <Bar label="Видеокарта" text={st.gpu != null ? `${st.gpu}%` : 'нет данных'} pct={st.gpu} />
      <Bar label="Память" text={`${st.used} / ${st.total} ГБ`} pct={Math.round((st.used / st.total) * 100)} />
    </div>
  );
};

/* ── Быстрые настройки ── */
export const QuickWidget = () => {
  const st0 = useSettings(); const s = { ...st0.settings, set: st0.set }; const showLock = useLockScreen(st => st.show); const close = useWidgets(st => st.close);
  const Row = ({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) => (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} className="flex w-full items-center justify-between rounded-xl px-1 py-2 text-[13.5px] font-semibold">
      {label}<span className="relative h-6 w-11 rounded-full" style={{ background: on ? '#8b5cf6' : 'rgba(255,255,255,0.2)' }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} /></span>
    </button>
  );
  return (
    <div>
      <Row label="Тёмная тема" on={s.colorScheme === 'dark'} onClick={() => s.set({ colorScheme: s.colorScheme === 'dark' ? 'light' : 'dark' })} />
      <Row label="Анимации" on={s.animationsOn} onClick={() => s.set({ animationsOn: !s.animationsOn })} />
      <div className="mt-2 flex gap-2"><Btn onClick={() => { close('quick'); showLock(); }}><Lock size={14} />Экран блокировки</Btn><Btn onClick={() => { runShortcut('module:ai'); close('quick'); }}><Sparkles size={14} />Sky AI</Btn></div>
      <p className="mt-2 flex items-center gap-1.5 text-[11px]" style={sub}><Moon size={11} />Смена темы выключает автопереключение по времени.</p>
    </div>
  );
};

/* ── Sky AI ── */
export const AiWidget = () => {
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [ans, setAns] = useState<{ text: string; err?: boolean } | null>(null);
  const ask = async () => { const t = q.trim(); if (!t || busy) return; setBusy(true); setAns(null); const r = await apiAiAsk('advise', t); setBusy(false); setAns(r.ok ? { text: r.text || 'Пустой ответ.' } : { text: r.reason, err: true }); };
  return (
    <div>
      <form onSubmit={e => { e.preventDefault(); void ask(); }} className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} maxLength={500} placeholder="Спросите Sky AI" aria-label="Вопрос Sky AI" className="min-w-0 flex-1 rounded-full px-4 py-2.5 text-[13.5px] outline-none"
          style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.16)' }} />
        <button type="submit" aria-label="Отправить" disabled={busy || !q.trim()} className="grid h-10 w-10 place-items-center rounded-full bg-white text-black disabled:opacity-50"><Send size={16} /></button>
      </form>
      {busy && <Loading />}
      {ans && <div role={ans.err ? 'alert' : undefined} translate="no" className="mt-3 max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-2xl p-3 text-[13px] leading-relaxed" style={{ background: ans.err ? 'rgba(239,68,68,0.16)' : 'rgba(255,255,255,0.08)' }}>{ans.text}</div>}
      <p className="mt-2 text-[11px]" style={sub}>Один вопрос без истории. ИИ может ошибаться. Для диалога откройте чат Sky AI.</p>
      <div className="mt-2"><Btn onClick={() => { runShortcut('module:ai'); useWidgets.getState().close('ai'); }}><Sparkles size={14} />Открыть чат Sky AI</Btn></div>
    </div>
  );
};

/* ── Кошелёк (только баланс и баллы) ── */
export const WalletWidget = () => {
  const balance = useMoney(s => s.balance); const points = useMoney(s => s.points); const refresh = useMoney(s => s.refresh);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => { let alive = true; Promise.resolve(refresh()).then(() => alive && setState('ok')).catch(() => alive && setState('error')); return () => { alive = false; }; }, [refresh]);
  if (state === 'loading' && balance == null) return <Loading />;
  if (state === 'error' && balance == null) return <Err text="Не удалось получить баланс." />;
  return (
    <div className="grid grid-cols-2 gap-3 text-center">
      <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.08)' }}><p className="text-[22px] font-extrabold">{Math.round(balance ?? 0).toLocaleString()} ₽</p><p className="text-[11.5px]" style={sub}>Баланс</p></div>
      <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.08)' }}><p className="text-[22px] font-extrabold">{Math.round(points ?? 0).toLocaleString()}</p><p className="text-[11.5px]" style={sub}>Баллы Prime</p></div>
    </div>
  );
};
