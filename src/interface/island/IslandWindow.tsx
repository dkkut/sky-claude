/**
 * Sky Island для Windows (окно-капсула поверх экрана; только Electron).
 * Капсула — компактная форма; по нажатию (или сочетанию клавиш) раскрывается в панель:
 *   «Главная» — быстрые переходы, ваши приложения, музыка, погода, уведомления;
 *   «Система» — CPU/GPU/RAM, Wi-Fi, Bluetooth, VPN, запущенные приложения, питание.
 * Данные только настоящие: чего Windows не отдаёт, того здесь нет (см. electron/island.cjs).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, SkipBack, SkipForward, ChevronUp, X, Plus, Wifi, Bluetooth, ShieldCheck, Cpu, MemoryStick, Gauge, Power,
  Home, Activity, Music2, MessageCircle, Clapperboard, Sparkles, Lock, AppWindow, LocateFixed, Cloud, Sun, CloudRain, CloudSnow, CloudFog, CloudLightning, Bell,
} from 'lucide-react';
import { useRemotePlayer } from '@/interface/quickactions/useRemotePlayer';
import { useNotifStore } from '@/notifications/store';
import { readCachedWeather } from '@/os/lockStore';
import { useLockSettings } from '@/os/lockStore';
import { SkyCloud } from '@/os/SkyCloud';
import type { IslandConfig, IslandStats } from '@/core/nativeApp';
import type { WeatherKind } from '@/bloom/weatherApi';

const sky = () => window.sky!.island!;
const panel = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' } as const;
const W_ICON: Record<WeatherKind, typeof Sun> = { clear: Sun, cloudy: Cloud, fog: CloudFog, rain: CloudRain, snow: CloudSnow, storm: CloudLightning };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const Meter = ({ icon: Icon, label, value, text }: { icon: typeof Cpu; label: string; value: number | null; text: string }) => (
  <div className="rounded-2xl p-3" style={panel}>
    <div className="flex items-center gap-2 text-[12px] font-bold" style={{ color: 'rgba(255,255,255,0.7)' }}><Icon size={15} />{label}</div>
    <p className="mt-1 text-[20px] font-extrabold text-white">{text}</p>
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.14)' }}>
      <div className="h-full rounded-full" style={{ width: `${value ?? 0}%`, background: (value ?? 0) > 85 ? '#f87171' : 'linear-gradient(90deg,#8b5cf6,#60a5fa)', transition: 'width .6s' }} />
    </div>
  </div>
);

const Btn = ({ children, onClick, active, label, wide }: { children: React.ReactNode; onClick: () => void; active?: boolean; label: string; wide?: boolean }) => (
  <button type="button" aria-label={label} onClick={onClick}
    className={`flex items-center justify-center gap-1.5 rounded-xl text-[12px] font-bold ${wide ? 'px-3 py-2' : 'h-9 w-9'}`}
    style={{ background: active ? '#fff' : 'rgba(255,255,255,0.1)', color: active ? '#0a0a14' : '#fff', border: '1px solid rgba(255,255,255,0.14)' }}>{children}</button>
);

export const IslandWindow = () => {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState<'home' | 'system'>('home');
  const [cfg, setCfg] = useState<IslandConfig | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const player = useRemotePlayer();
  const notifs = useNotifStore(s => s.notifs);
  const showText = useLockSettings(s => s.showNotifText);
  const unread = useMemo(() => notifs.filter(n => !n.read), [notifs]);
  const [now, setNow] = useState(() => new Date());

  // Окно прозрачное: фон страницы убираем.
  useEffect(() => { document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent'; }, []);
  useEffect(() => { void sky().getConfig().then(setCfg); return sky().onExpanded(setExpanded); }, []);
  // Часы — только пока окно на виду.
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) setNow(new Date()); }, 15000); return () => clearInterval(t); }, []);
  useEffect(() => { if (expanded && page === 'home') void sky().appIcons().then(setIcons); }, [expanded, page, cfg?.apps.length]);

  const collapse = useCallback(() => { setExpanded(false); window.setTimeout(() => sky().setExpanded(false), 220); }, []);
  const expand = useCallback(() => { sky().setExpanded(true); setExpanded(true); }, []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (expanded) collapse(); else sky().hide(); }
      else if (expanded && e.key === 'ArrowRight') setPage('system');
      else if (expanded && e.key === 'ArrowLeft') setPage('home');
    };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [expanded, collapse]);

  /* Система: опрос только пока открыта эта страница и окно видно. */
  const [stats, setStats] = useState<IslandStats | null>(null);
  const [procs, setProcs] = useState<{ name: string; pid: number; ramMb: number }[]>([]);
  useEffect(() => {
    if (!expanded || page !== 'system') return undefined;
    let alive = true; let n = 0;
    const tick = async () => {
      if (document.hidden) return;
      const s = await sky().stats(); if (alive && s) setStats(s);
      if (n++ % 3 === 0) { const p = await sky().processes(); if (alive) setProcs(p); }
    };
    void tick(); const t = setInterval(() => void tick(), 2500);
    return () => { alive = false; clearInterval(t); };
  }, [expanded, page]);

  const [power, setPower] = useState<null | 'shutdown' | 'restart' | 'pending'>(null);
  const weather = useMemo(readCachedWeather, [expanded]);
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const playing = player.state.kind ? player.state : null;

  /* ── Компактная капсула ── */
  if (!expanded) {
    return (
      <button type="button" aria-label="Открыть Sky Island" onClick={expand} data-keep-dark
        className="fixed inset-0 flex items-center gap-3 rounded-full px-4 text-left text-white"
        style={{ background: 'rgba(10,9,22,0.94)', border: '1px solid rgba(139,92,246,0.45)', boxShadow: '0 8px 30px rgba(0,0,0,0.5), 0 0 24px rgba(139,92,246,0.25)', overflow: 'hidden' }}>
        <img src="/logo.png" alt="" className="h-7 w-7 shrink-0 object-contain" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold" translate="no">{playing ? `${playing.title} · ${playing.author}` : time}</span>
        {playing && <span className="flex shrink-0 items-end gap-[2px]" aria-hidden>{[0, 1, 2].map(i => <span key={i} className="w-[3px] rounded-sm bg-violet-300" style={{ height: playing.isPlaying ? 6 + i * 3 : 5, transition: 'height .3s' }} />)}</span>}
        {unread.length > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-[11px] font-extrabold" style={{ background: '#8b5cf6' }}>{unread.length}</span>}
      </button>
    );
  }

  const quick: { cmd: string; label: string; icon: typeof Home }[] = [
    { cmd: 'module:music', label: 'Музыка', icon: Music2 }, { cmd: 'module:messages', label: 'Чаты', icon: MessageCircle },
    { cmd: 'module:movies', label: 'Кино', icon: Clapperboard }, { cmd: 'module:ai', label: 'Sky AI', icon: Sparkles }, { cmd: 'lock', label: 'Блокировка', icon: Lock },
  ];

  return (
    <AnimatePresence>
      <motion.div key="panel" data-keep-dark initial={{ opacity: 0, scale: 0.96, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="fixed inset-0 flex flex-col overflow-hidden rounded-[34px] text-white"
        style={{ background: 'rgba(11,10,24,0.97)', border: '1px solid rgba(139,92,246,0.4)', boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(139,92,246,0.22)', fontFamily: "'Manrope',system-ui,sans-serif" }}>
        {/* шапка: за неё окно можно перетаскивать */}
        <div className="flex shrink-0 items-center gap-2 px-4 pt-3" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <SkyCloud state={playing?.isPlaying ? 'joy' : unread.length ? 'surprise' : 'greeting'} size={34} />
          <div className="flex gap-1 rounded-full p-1" style={{ ...panel, WebkitAppRegion: 'no-drag' } as React.CSSProperties} role="tablist">
            {([['home', 'Главная', Home], ['system', 'Система', Activity]] as const).map(([k, l, I]) => (
              <button key={k} type="button" role="tab" aria-selected={page === k} onClick={() => setPage(k)} className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold"
                style={{ background: page === k ? '#fff' : 'transparent', color: page === k ? '#0a0a14' : 'rgba(255,255,255,0.75)' }}><I size={14} />{l}</button>
            ))}
          </div>
          <span className="flex-1 text-center text-[13px] font-bold" style={{ color: 'rgba(255,255,255,0.7)' }}>{time}</span>
          <div className="flex gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <Btn label="Вернуть наверх по центру" onClick={() => sky().dock()}><LocateFixed size={16} /></Btn>
            <Btn label="Свернуть в капсулу" onClick={collapse}><ChevronUp size={17} /></Btn>
            <Btn label="Скрыть" onClick={() => sky().hide()}><X size={16} /></Btn>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3" style={{ scrollbarWidth: 'none' }}>
          {page === 'home' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Btn wide label="Открыть Sky" onClick={() => sky().focusMain()}><AppWindow size={15} />Sky</Btn>
                {quick.map(q => <Btn key={q.cmd} wide label={q.label} onClick={() => { sky().command(q.cmd); if (q.cmd === 'lock') collapse(); }}><q.icon size={15} />{q.label}</Btn>)}
              </div>

              <div className="rounded-2xl p-3" style={panel}>
                <p className="mb-2 text-[11px] font-extrabold tracking-[0.12em]" style={{ color: 'rgba(255,255,255,0.6)' }}>ВАШИ ПРИЛОЖЕНИЯ</p>
                <div className="flex flex-wrap gap-2.5">
                  {cfg?.apps.map(a => (
                    <div key={a.id} className="group relative">
                      <button type="button" aria-label={`Запустить ${a.name}`} onClick={() => void sky().launch(a.id)} className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.14)' }}>
                        {icons[a.id] ? <img src={icons[a.id]} alt="" className="h-8 w-8" /> : <span className="text-[18px] font-extrabold" translate="no">{a.name.slice(0, 1).toUpperCase()}</span>}
                      </button>
                      <button type="button" aria-label={`Убрать ${a.name}`} onClick={() => void sky().removeApp(a.id).then(c => c && setCfg(c))}
                        className="absolute -right-1 -top-1 hidden h-5 w-5 place-items-center rounded-full bg-black/80 group-hover:grid"><X size={11} /></button>
                      <p className="mt-1 w-14 truncate text-center text-[10.5px]" style={{ color: 'rgba(255,255,255,0.7)' }} translate="no">{a.name}</p>
                    </div>
                  ))}
                  {(cfg?.apps.length ?? 0) < 16 && (
                    <button type="button" aria-label="Добавить приложение" onClick={() => void sky().addApp().then(c => c && setCfg(c))} className="grid h-14 w-14 place-items-center rounded-2xl" style={{ border: '1.5px dashed rgba(255,255,255,0.3)' }}><Plus size={20} /></button>
                  )}
                </div>
                {cfg && cfg.apps.length === 0 && <p className="mt-2 text-[11.5px]" style={{ color: 'rgba(255,255,255,0.55)' }}>Добавьте программы, которые запускаете чаще всего.</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl p-3" style={panel}>
                  {playing ? (
                    <>
                      <p className="truncate text-[14px] font-extrabold" translate="no">{playing.title}</p>
                      <p className="truncate text-[12px]" style={{ color: 'rgba(255,255,255,0.65)' }} translate="no">{playing.author}</p>
                      <div className="my-2 h-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }}>
                        <div className="h-full bg-white" style={{ width: `${playing.duration > 0 ? Math.min(100, (playing.currentTime / playing.duration) * 100) : 0}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-[10.5px]" style={{ color: 'rgba(255,255,255,0.6)' }}><span>{fmt(playing.currentTime)}</span><span>{fmt(playing.duration)}</span></div>
                      <div className="mt-2 flex items-center justify-center gap-4">
                        <button type="button" aria-label="Предыдущий" onClick={player.prev}><SkipBack size={20} fill="#fff" /></button>
                        <button type="button" aria-label={playing.isPlaying ? 'Пауза' : 'Играть'} onClick={player.toggle} className="grid h-10 w-10 place-items-center rounded-full bg-white text-black">
                          {playing.isPlaying ? <Pause size={18} fill="#0a0a14" /> : <Play size={18} fill="#0a0a14" style={{ marginLeft: 2 }} />}</button>
                        <button type="button" aria-label="Следующий" onClick={player.next}><SkipForward size={20} fill="#fff" /></button>
                      </div>
                    </>
                  ) : <p className="py-5 text-center text-[12.5px]" style={{ color: 'rgba(255,255,255,0.55)' }}>Сейчас ничего не играет</p>}
                </div>
                <div className="space-y-3">
                  {weather && (() => { const I = W_ICON[weather.w.kind] ?? Cloud; return (
                    <div className="flex items-center gap-3 rounded-2xl p-3" style={panel}>
                      <I size={26} /><div><p className="text-[20px] font-extrabold leading-none">{weather.w.tempC >= 0 ? '+' : ''}{Math.round(weather.w.tempC)}°</p><p className="text-[11.5px]" style={{ color: 'rgba(255,255,255,0.65)' }} translate="no">{weather.w.city ?? ''}</p></div>
                    </div>); })()}
                  <div className="rounded-2xl p-3" style={panel}>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold tracking-[0.12em]" style={{ color: 'rgba(255,255,255,0.6)' }}><Bell size={12} />УВЕДОМЛЕНИЯ</p>
                    {unread.length === 0 ? <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>Новых нет</p> : unread.slice(0, 3).map(n => (
                      <p key={n.id} className="truncate text-[12.5px] font-semibold" translate="no">{showText ? `${n.title}: ${n.body}` : (n.kind === 'message' || n.kind === 'mention' ? 'Новое сообщение' : n.kind.startsWith('call') ? 'Звонок' : 'Уведомление')}</p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {page === 'system' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Meter icon={Cpu} label="Процессор" value={stats?.cpu ?? null} text={stats?.cpu != null ? `${stats.cpu}%` : '…'} />
                <Meter icon={Gauge} label="Видеокарта" value={stats?.gpu ?? null} text={stats ? (stats.gpu != null ? `${stats.gpu}%` : 'нет данных') : '…'} />
                <Meter icon={MemoryStick} label="Память" value={stats ? Math.round((stats.ramUsedGb / stats.ramTotalGb) * 100) : null} text={stats ? `${stats.ramUsedGb} / ${stats.ramTotalGb} ГБ` : '…'} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { k: 'wifi' as const, icon: Wifi, label: 'Wi-Fi', val: stats ? (stats.wifi ? (stats.wifi.connected ? (stats.wifi.ssid ?? 'Подключено') : 'Не подключено') : 'нет данных') : '…' },
                  { k: 'bluetooth' as const, icon: Bluetooth, label: 'Bluetooth', val: 'Настройки Windows' },
                  { k: 'vpn' as const, icon: ShieldCheck, label: 'VPN', val: stats ? (stats.vpn ? `Адаптер: ${stats.vpn.adapter}` : 'Адаптер не найден') : '…' },
                ]).map(r => (
                  <button key={r.k} type="button" onClick={() => void sky().openSettings(r.k)} className="rounded-2xl p-3 text-left" style={panel} aria-label={`${r.label}: открыть настройки Windows`}>
                    <span className="flex items-center gap-2 text-[12px] font-bold" style={{ color: 'rgba(255,255,255,0.7)' }}><r.icon size={15} />{r.label}</span>
                    <span className="mt-1 block truncate text-[13px] font-extrabold" translate="no">{r.val}</span>
                  </button>
                ))}
              </div>
              <p className="px-1 text-[10.5px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Включать и выключать Wi-Fi, Bluetooth и VPN из Sky нельзя — нажатие открывает настройки Windows.</p>

              <div className="rounded-2xl p-3" style={panel}>
                <p className="mb-1.5 text-[11px] font-extrabold tracking-[0.12em]" style={{ color: 'rgba(255,255,255,0.6)' }}>ЗАПУЩЕННЫЕ ПРИЛОЖЕНИЯ</p>
                {procs.length === 0 ? <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>Загрузка…</p> : (
                  <div className="space-y-1">{procs.map(p => (
                    <div key={p.pid} className="flex items-center justify-between text-[12.5px]"><span className="truncate font-semibold" translate="no">{p.name}</span><span style={{ color: 'rgba(255,255,255,0.6)' }}>{p.ramMb} МБ</span></div>
                  ))}</div>
                )}
              </div>

              <div className="rounded-2xl p-3" style={panel}>
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold tracking-[0.12em]" style={{ color: 'rgba(255,255,255,0.6)' }}><Power size={12} />ПИТАНИЕ</p>
                {power === null && (
                  <div className="flex flex-wrap gap-2">
                    <Btn wide label="Спящий режим" onClick={() => void sky().power('sleep')}>Спящий режим</Btn>
                    <Btn wide label="Перезагрузка" onClick={() => setPower('restart')}>Перезагрузка</Btn>
                    <Btn wide label="Выключение" onClick={() => setPower('shutdown')}>Выключение</Btn>
                  </div>
                )}
                {(power === 'shutdown' || power === 'restart') && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold">{power === 'shutdown' ? 'Выключить компьютер?' : 'Перезагрузить компьютер?'} Начнётся отсчёт 30 секунд, его можно отменить.</span>
                    <Btn wide label="Подтвердить" active onClick={() => { void sky().power(power).then(() => setPower('pending')); }}>Подтвердить</Btn>
                    <Btn wide label="Отмена" onClick={() => setPower(null)}>Отмена</Btn>
                  </div>
                )}
                {power === 'pending' && (
                  <div className="flex items-center gap-2"><span className="text-[12.5px] font-semibold">Отсчёт идёт — через 30 секунд.</span><Btn wide label="Отменить" active onClick={() => { void sky().power('cancel'); setPower(null); }}>Отменить</Btn></div>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
