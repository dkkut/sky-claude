/**
 * Экран блокировки Sky: размытые обои, часы, дата, уведомления, музыка, погода.
 * LockScreenView — сам вид (его же использует замок приложения: поверх него
 * стоят поля ввода кода). LockScreenHost — ручной показ (сочетание клавиш, профиль).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Play, Pause, SkipBack, SkipForward, Bell, MessageCircle, Phone, Gift, Music2, Cloud, Sun, CloudRain, CloudSnow, CloudFog, CloudLightning, Lock } from 'lucide-react';
import { useNotifStore, type SkyNotif } from '@/notifications/store';
import { usePlayerStore } from '@/player/playerStore';
import { getWallpaperBlob } from '@/messenger/wallpapers';
import { visibleTick } from '@/shared/visibleTick';
import { getG } from '@/music/utils';
import { intlLocale } from '@/i18n';
import { useLockSettings, useLockScreen, readCachedWeather, refreshWeatherQuiet } from './lockStore';
import type { WeatherKind } from '@/bloom/weatherApi';

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
const Wallpaper = () => {
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
  const img = wallpaper === 'custom' ? custom : wallpaper === 'cover' ? item?.coverUrl ?? null : null;
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#07070C' }}>
      {img
        ? <div style={{ position: 'absolute', inset: -blur * 2, background: `center/cover no-repeat url(${img})`, filter: `blur(${blur}px) saturate(1.2)`, transform: 'scale(1.1)' }} />
        : <>
            <div className="spp-blob spp-blobA" style={{ background: c1 }} />
            <div className="spp-blob spp-blobB" style={{ background: '#8b5cf6' }} />
            <div className="spp-blob spp-blobC" style={{ background: c2 }} />
          </>}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(7,7,12,.35),rgba(7,7,12,.6))' }} />
    </div>
  );
};

const MusicCard = () => {
  const item = usePlayerStore(s => s.item);
  const playing = usePlayerStore(s => s.isPlaying);
  const cur = usePlayerStore(s => s.currentTime);
  const dur = usePlayerStore(s => s.duration);
  const requestPlay = usePlayerStore(s => s.requestPlay);
  const next = usePlayerStore(s => s.nextTrack);
  const prev = usePlayerStore(s => s.prevTrack);
  if (!item || (item.kind !== 'music' && item.kind !== 'podcast')) return null;
  const [a, b] = getG(item.id);
  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
  const btn = (extra?: React.CSSProperties): React.CSSProperties => ({ display: 'grid', placeItems: 'center', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, ...extra });
  return (
    <div style={{ ...glass, borderRadius: 28, padding: 16, width: 'min(420px, 90vw)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, overflow: 'hidden', flex: 'none', background: `linear-gradient(135deg,${a},${b})`, display: 'grid', placeItems: 'center' }}>
          {item.coverUrl ? <img src={item.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 size={26} color="rgba(255,255,255,.8)" />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p translate="no" style={{ margin: 0, fontSize: 16, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</p>
          <p translate="no" style={{ margin: '3px 0 0', fontSize: 13, color: 'rgba(255,255,255,.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.author}</p>
        </div>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,.22)', margin: '14px 0 10px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#fff' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 26 }}>
        <button type="button" aria-label="Предыдущий" onClick={prev} style={btn()}><SkipBack size={24} fill="#fff" /></button>
        <button type="button" aria-label={playing ? 'Пауза' : 'Играть'} onClick={() => requestPlay(!playing)} style={btn({ width: 48, height: 48, borderRadius: '50%', background: '#fff', color: '#0A0A10' })}>
          {playing ? <Pause size={22} fill="#0A0A10" color="#0A0A10" /> : <Play size={22} fill="#0A0A10" color="#0A0A10" style={{ marginLeft: 2 }} />}
        </button>
        <button type="button" aria-label="Следующий" onClick={next} style={btn()}><SkipForward size={24} fill="#fff" /></button>
      </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 'min(360px, 90vw)' }} aria-label="Уведомления">
      {unread.map(n => {
        const Icon = K_ICON[n.kind] ?? Bell;
        return (
          <div key={n.id} style={{ ...glass, borderRadius: 20, padding: '11px 14px', display: 'flex', gap: 11, alignItems: 'center' }}>
            <span style={{ width: 34, height: 34, borderRadius: 11, flex: 'none', display: 'grid', placeItems: 'center', background: 'rgba(139,92,246,.4)' }}><Icon size={17} /></span>
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

export const LockScreenView = ({ children, hint, onActivate }: { children?: React.ReactNode; hint?: string; onActivate?: () => void }) => {
  const now = useNow();
  const s = useLockSettings();
  const time = now.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div data-keep-dark onClick={onActivate} style={{ position: 'absolute', inset: 0, color: '#fff', fontFamily: "'Manrope','Nunito',system-ui,sans-serif", overflow: 'hidden' }}>
      <Wallpaper />
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'calc(env(safe-area-inset-top, 0px) + 7vh) 24px calc(env(safe-area-inset-bottom, 0px) + 28px)', boxSizing: 'border-box', gap: 18, overflowY: 'auto' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 'clamp(72px, 14vh, 132px)', fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{time}</p>
          <p style={{ margin: '6px 0 0', fontSize: 'clamp(15px, 2.4vh, 20px)', fontWeight: 600, textTransform: 'capitalize', color: 'rgba(255,255,255,.85)' }}>{date}</p>
        </div>
        {s.showWeather && <WeatherCard />}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, justifyContent: 'center', alignItems: 'flex-start', width: '100%' }}>
          {s.showNotifs && <NotifList />}
          {s.showMusic && <MusicCard />}
        </div>
        <div style={{ flex: 1 }} />
        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: '100%' }}>
          <img src="/logo.png" alt="Sky" style={{ width: 44, height: 44, objectFit: 'contain', opacity: 0.95 }} />
          {children}
          {hint && <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,.7)' }}>{hint}</p>}
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
