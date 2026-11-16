/**
 * Экран блокировки Sky: размытые обои, часы, дата, уведомления, музыка, погода.
 * LockScreenView — сам вид (его же использует замок приложения: поверх него
 * стоят поля ввода кода). LockScreenHost — ручной показ (сочетание клавиш, профиль).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Play, Pause, SkipBack, SkipForward, ChevronDown, Bell, MessageCircle, Phone, Gift, Music2, Cloud, Sun, CloudRain, CloudSnow, CloudFog, CloudLightning, Lock } from 'lucide-react';
import { useNotifStore, type SkyNotif } from '@/notifications/store';
import { usePlayerStore } from '@/player/playerStore';
import { getWallpaperBlob } from '@/messenger/wallpapers';
import { visibleTick } from '@/shared/visibleTick';
import { getG } from '@/music/utils';
import { apiLyrics } from '@/music/musicApi';
import { parseTimedLyrics } from '@/music/lyrics';
import { intlLocale } from '@/i18n';
import { useLockSettings, useLockScreen, readCachedWeather, refreshWeatherQuiet } from './lockStore';
import type { WeatherKind } from '@/bloom/weatherApi';
import { SkyCloud } from '@/os/SkyCloud';

export const LOCK_WALLPAPER_KEY = 'lock';
const glass = { background: 'rgba(24,20,44,0.46)', border: '1px solid rgba(255,255,255,0.16)', backdropFilter: 'blur(26px) saturate(1.4)', WebkitBackdropFilter: 'blur(26px) saturate(1.4)' } as const;
const W_ICON: Record<WeatherKind, typeof Sun> = { clear: Sun, cloudy: Cloud, fog: CloudFog, rain: CloudRain, snow: CloudSnow, storm: CloudLightning };
const K_ICON: Partial<Record<SkyNotif['kind'], typeof Bell>> = { message: MessageCircle, mention: MessageCircle, call_in: Phone, call_missed: Phone, gift: Gift };

const useNow = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(visibleTick(() => setNow(new Date())), 1000); return () => clearInterval(t); }, []);
  return now;
};

/** Обои: космос Sky по умолчанию, обложка играющего трека (размытая) или своя картинка. */
const Wallpaper = ({ forceCover }: { forceCover?: boolean }) => {
  const { wallpaper, blur } = useLockSettings();
  const item = usePlayerStore(s => s.item);
  const [custom, setCustom] = useState<string | null>(null);
  useEffect(() => {
    if (wallpaper !== 'custom') { setCustom(null); return undefined; }
    let url: string | null = null; let alive = true;
    void getWallpaperBlob(LOCK_WALLPAPER_KEY).then(b => { if (alive && b) { url = URL.createObjectURL(b); setCustom(url); } });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [wallpaper]);
  const [c1, c2] = item ? getG(item.id) : ['#4c1d95', '#1e3a8a'];
  const useCover = forceCover || wallpaper === 'cover';
  const img = useCover && item?.coverUrl ? item.coverUrl : wallpaper === 'custom' ? custom : null;
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#07070C' }}>
      {img
        ? <div key={img} style={{ position: 'absolute', inset: -blur * 2, background: `center/cover no-repeat url(${img})`, filter: `blur(${useCover ? Math.max(blur, 40) : blur}px) saturate(1.25)`, transform: 'scale(1.1)', animation: 'lk-fade .6s ease both' }} />
        : <>
            <div className="spp-blob spp-blobA" style={{ background: c1 }} />
            <div className="spp-blob spp-blobB" style={{ background: '#8b5cf6' }} />
            <div className="spp-blob spp-blobC" style={{ background: c2 }} />
          </>}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 50% 0%, rgba(7,7,12,.15), rgba(7,7,12,.55))' }} />
    </div>
  );
};

const MusicCard = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => {
  const item = usePlayerStore(s => s.item);
  const playing = usePlayerStore(s => s.isPlaying);
  const cur = usePlayerStore(s => s.currentTime);
  const dur = usePlayerStore(s => s.duration);
  const requestPlay = usePlayerStore(s => s.requestPlay);
  const requestSeek = usePlayerStore(s => s.requestSeek);
  const next = usePlayerStore(s => s.nextTrack);
  const prev = usePlayerStore(s => s.prevTrack);
  const isMusic = item?.kind === 'music';
  // Текст песни — только пока карточка раскрыта и играет музыка; режим показа задаёт загрузивший.
  const [lines, setLines] = useState<{ t: number; text: string }[]>([]);
  const [mode, setMode] = useState<'auto' | 'static' | 'synced'>('auto');
  const itemId = item?.id;
  useEffect(() => {
    setLines([]);
    if (!open || !isMusic || !itemId) return undefined;
    let alive = true;
    void apiLyrics(itemId).then(r => { if (!alive || !r) return; setMode(r.mode ?? 'auto'); setLines(parseTimedLyrics(r.lyrics ?? '').filter(l => l.text)); });
    return () => { alive = false; };
  }, [open, isMusic, itemId]);
  if (!item || (item.kind !== 'music' && item.kind !== 'podcast')) return null;
  const [a, b] = getG(item.id);
  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
  const synced = mode !== 'static' && lines.some(l => l.t > 0);
  const active = synced ? lines.reduce((best, l, i) => (l.t <= cur ? i : best), 0) : -1;
  const shown = synced ? lines.slice(Math.max(0, active - 1), active + 3) : lines.slice(0, 4);
  const btn = (extra?: React.CSSProperties): React.CSSProperties => ({ display: 'grid', placeItems: 'center', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, ...extra });
  const cover = (size: number, radius: number) => (
    <div style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', flex: 'none', background: `linear-gradient(135deg,${a},${b})`, display: 'grid', placeItems: 'center', boxShadow: open ? '0 20px 50px rgba(0,0,0,.5)' : 'none', transition: 'all .35s cubic-bezier(.2,.8,.2,1)' }}>
      {item.coverUrl ? <img src={item.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 size={size * 0.4} color="rgba(255,255,255,.8)" />}
    </div>
  );
  const bar = (
    <div>
      <div style={{ position: 'relative', height: 5, borderRadius: 3, background: 'rgba(255,255,255,.25)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#fff', transition: 'width .4s linear' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.7)', fontVariantNumeric: 'tabular-nums' }}><span>{fmtT(cur)}</span><span>-{fmtT(Math.max(0, dur - cur))}</span></div>
    </div>
  );
  const controls = (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: open ? 38 : 22 }}>
      <button type="button" aria-label="Предыдущий" onClick={e => { e.stopPropagation(); prev(); }} style={btn()}><SkipBack size={open ? 28 : 20} fill="#fff" /></button>
      <button type="button" aria-label={playing ? 'Пауза' : 'Играть'} onClick={e => { e.stopPropagation(); requestPlay(!playing); }} style={btn()}>
        {playing ? <Pause size={open ? 38 : 24} fill="#fff" /> : <Play size={open ? 38 : 24} fill="#fff" />}</button>
      <button type="button" aria-label="Следующий" onClick={e => { e.stopPropagation(); next(); }} style={btn()}><SkipForward size={open ? 28 : 20} fill="#fff" /></button>
    </div>
  );
  if (!open) {
    return (
      <div role="button" tabIndex={0} aria-label="Раскрыть плеер" onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        style={{ ...glass, borderRadius: 24, padding: 12, width: 'min(340px, 90vw)', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {cover(52, 12)}
          <div style={{ minWidth: 0, flex: 1 }}>
            <p translate="no" style={{ margin: 0, fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</p>
            <p translate="no" style={{ margin: '2px 0 0', fontSize: 12, color: 'rgba(255,255,255,.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.author}</p>
          </div>
          <button type="button" aria-label={playing ? 'Пауза' : 'Играть'} onClick={e => { e.stopPropagation(); requestPlay(!playing); }} style={btn()}>{playing ? <Pause size={22} fill="#fff" /> : <Play size={22} fill="#fff" />}</button>
          <button type="button" aria-label="Следующий" onClick={e => { e.stopPropagation(); next(); }} style={btn()}><SkipForward size={20} fill="#fff" /></button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ width: 'min(420px, 92vw)', display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'stretch', animation: 'lk-rise .4s cubic-bezier(.2,.8,.2,1) both' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {cover(88, 16)}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p translate="no" style={{ margin: 0, fontSize: 19, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</p>
          <p translate="no" style={{ margin: '3px 0 0', fontSize: 14, color: 'rgba(255,255,255,.72)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.author}</p>
        </div>
        <button type="button" aria-label="Свернуть плеер" onClick={onToggle} style={btn({ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,.14)' })}><ChevronDown size={20} /></button>
      </div>
      {shown.length > 0 && (
        <div translate="no" aria-label="Текст песни" style={{ minHeight: 92 }}>
          {shown.map((l, i) => {
            const on = synced ? lines.indexOf(l) === active : true;
            return <p key={`${l.t}-${i}`} style={{ margin: '0 0 6px', fontSize: on && synced ? 22 : 17, fontWeight: 800, lineHeight: 1.25, opacity: synced ? (on ? 1 : 0.4) : 0.85, transition: 'all .3s' }}>{l.text}</p>;
          })}
        </div>
      )}
      <div onClick={e => { const r = e.currentTarget.getBoundingClientRect(); if (dur > 0) requestSeek(((e.clientX - r.left) / r.width) * dur); }} style={{ cursor: 'pointer' }}>{bar}</div>
      {controls}
    </div>
  );
};

const NotifList = () => {
  const notifs = useNotifStore(s => s.notifs);
  const showText = useLockSettings(s => s.showNotifText);
  const unread = useMemo(() => notifs.filter(n => !n.read).slice(0, 5), [notifs]);
  if (unread.length === 0) return null;
  const hiddenTitle = (k: SkyNotif['kind']) => k === 'message' || k === 'mention' ? 'Новое сообщение' : k === 'call_in' || k === 'call_missed' ? 'Звонок' : k === 'gift' ? 'Подарок' : 'Уведомление';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 'min(330px, 90vw)' }} aria-label="Уведомления">
      {unread.map(n => {
        const Icon = K_ICON[n.kind] ?? Bell;
        return (
          <div key={n.id} style={{ ...glass, borderRadius: 16, padding: '8px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 28, height: 28, borderRadius: 9, flex: 'none', display: 'grid', placeItems: 'center', background: 'rgba(139,92,246,.5)' }}><Icon size={15} /></span>
            <span style={{ minWidth: 0 }}>
              <span translate={showText ? 'no' : undefined} style={{ display: 'block', fontSize: 13.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{showText ? n.title : hiddenTitle(n.kind)}</span>
              {showText && <span translate="no" style={{ display: 'block', fontSize: 12.5, color: 'rgba(255,255,255,.72)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.body}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const WeatherCard = () => {
  const [cached, setCached] = useState(readCachedWeather);
  useEffect(() => { void refreshWeatherQuiet().then(() => setCached(readCachedWeather())); }, []);
  if (!cached) return null;
  const { w, at } = cached; const Icon = W_ICON[w.kind] ?? Cloud;
  const stale = Date.now() - at > 3 * 3600_000;
  return (
    <div style={{ ...glass, borderRadius: 22, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon size={26} />
      <span>
        <span style={{ display: 'block', fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>{w.tempC >= 0 ? '+' : ''}{Math.round(w.tempC)}°</span>
        <span translate="no" style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{w.city ?? ''}{stale ? ' · давно не обновлялась' : ''}</span>
      </span>
    </div>
  );
};

const fmtT = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

const useWide = () => {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth));
  useEffect(() => { const on = () => setW(window.innerWidth); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  return w >= 980;
};

export const LockScreenView = ({ children, hint, onActivate }: { children?: React.ReactNode; hint?: string; onActivate?: () => void }) => {
  const now = useNow();
  const s = useLockSettings();
  const wide = useWide();
  const [musicOpen, setMusicOpen] = useState(false);
  const item = usePlayerStore(st => st.item);
  const hasMusic = s.showMusic && (item?.kind === 'music' || item?.kind === 'podcast');
  const open = musicOpen && hasMusic;
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const date = now.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const notifs = s.showNotifs ? <NotifList /> : null;
  return (
    <div data-keep-dark onClick={onActivate} style={{ position: 'absolute', inset: 0, color: '#fff', fontFamily: "'Manrope','Nunito',system-ui,sans-serif", overflow: 'hidden' }}>
      <Wallpaper forceCover={open} />
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'calc(env(safe-area-inset-top, 0px) + 5vh) 24px calc(env(safe-area-inset-bottom, 0px) + 24px)', boxSizing: 'border-box', gap: 16, overflowY: 'auto' }}>
        {/* Часы: дата мелко сверху, время крупно, лёгким начертанием — как на macOS */}
        <div style={{ textAlign: 'center', textShadow: '0 2px 24px rgba(0,0,0,.35)' }}>
          <p style={{ margin: 0, fontSize: 'clamp(16px, 2.6vh, 24px)', fontWeight: 600, color: 'rgba(255,255,255,.88)' }}>{date}</p>
          <p style={{ margin: '2px 0 0', fontSize: 'clamp(84px, 17vh, 168px)', fontWeight: 200, letterSpacing: '-0.035em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{time}</p>
        </div>
        {s.showWeather && <WeatherCard />}

        {/* Уведомления — столбиком справа сверху на широком экране */}
        {notifs && wide && <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 28px)', right: 28 }}>{notifs}</div>}
        {notifs && !wide && <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>{notifs}</div>}

        <div style={{ flex: 1 }} />
        {hasMusic && <div onClick={e => e.stopPropagation()}><MusicCard open={open} onToggle={() => setMusicOpen(v => !v)} /></div>}

        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: '100%', marginTop: 8 }}>
          <SkyCloud state={typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : hint ? 'waiting' : 'greeting'} size={72} />
          {children}
          {hint && <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,.75)' }}>{hint}</p>}
        </div>
      </div>
    </div>
  );
};

/** Ручной показ: Esc, Enter, касание — закрывают. Если включён «Замок приложения», сначала закрывается сессия на сервере. */
export const LockScreenHost = () => {
  const open = useLockScreen(s => s.open);
  const hide = useLockScreen(s => s.hide);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = window.sky?.lock; void prev?.(true);
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') hide(); };
    window.addEventListener('keydown', on);
    ref.current?.focus();
    return () => { window.removeEventListener('keydown', on); void window.sky?.lock?.(false); };
  }, [open, hide]);
  if (!open) return null;
  return createPortal(
    <motion.div ref={ref} tabIndex={-1} role="dialog" aria-label="Экран блокировки Sky" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}
      style={{ position: 'fixed', inset: 0, zIndex: 99990, outline: 'none' }}>
      <LockScreenView onActivate={hide} hint="Нажмите, чтобы вернуться в Sky">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,.6)' }}><Lock size={13} />Это экран Sky, не блокировка системы</span>
      </LockScreenView>
    </motion.div>, document.body);
};
