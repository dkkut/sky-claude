/**
 * Полноэкранный плеер Sky Music для ПК — три режима:
 *   compact — логотип/диск, обложка, название, исполнитель, нижняя панель;
 *   lyrics  — то же + текст песни (статичный или по строкам — решает загрузивший);
 *   ai      — то же + окно Sky AI с быстрыми вопросами о треке.
 * Логику воспроизведения не трогает: всё приходит пропсами из SkyMusic (общий плеер).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, Heart, Plus, Shuffle, SkipBack, SkipForward, Play, Pause, Repeat, Repeat1,
  AlignLeft, Sparkles, ListMusic, Volume2, VolumeX, MoreHorizontal, Send, Pencil, Music2, X,
} from 'lucide-react';
import type { Track } from '@/platform/store';
import type { RepeatMode } from '@/music/types';
import { getG } from '@/music/utils';
import { apiLyrics, type LyricsMode } from '@/music/musicApi';
import { parseTimedLyrics } from '@/music/lyrics';
import { VideoBackdrop } from '@/music/VideoBackdrop';
import { TrackEditor } from '@/music/TrackEditor';
import { ExplicitBadge } from '@/labels/Labels';
import { BufferingRing, useBuffering } from '@/player/BufferingRing';
import { usePlayerStore } from '@/player/playerStore';
import { apiAiAsk } from '@/ai/aiApi';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { prepareWallpaper, putWallpaperBlob, getWallpaperBlob, deleteWallpaperBlob } from '@/messenger/wallpapers';
import { flash } from '@/shared/flash';
import { Image as ImageIcon } from 'lucide-react';
import { SkyCloud } from '@/os/SkyCloud';

export interface PcPlayerProps {
  track: Track; playing: boolean; currentTime: number; duration: number;
  volume: number; shuffle: boolean; repeat: RepeatMode;
  favorites: string[]; queue: Track[]; queueIdx: number;
  onPlay: () => void; onPrev: () => void; onNext: () => void;
  onSeek: (t: number) => void; onVolume: (v: number) => void;
  onShuffle: () => void; onRepeat: () => void;
  onLike: (id: string) => void; onAdd: (id: string) => void;
  onArtist?: (name: string) => void; onClose: () => void;
}

type Mode = 'compact' | 'lyrics' | 'ai';
const MODE_KEY = 'sky:pcplayer:mode';
const DISC_KEY = 'sky:pcplayer:disc';
const readMode = (): Mode => { try { const v = localStorage.getItem(MODE_KEY); return v === 'lyrics' || v === 'ai' ? v : 'compact'; } catch { return 'compact'; } };
type Bg = 'tracks' | 'cover' | 'custom';
const BG_KEY = 'sky:pcplayer:bg';
const PLAYER_WP = 'player';
const readBg = (): Bg => { try { const v = localStorage.getItem(BG_KEY); return v === 'cover' || v === 'custom' ? v : 'tracks'; } catch { return 'tracks'; } };
const readDisc = (): boolean => { try { return localStorage.getItem(DISC_KEY) !== '0'; } catch { return true; } };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const VIOLET = '#8b5cf6';
const glass = { background: 'rgba(20,18,36,0.58)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' } as const;
const roundBtn = (size: number, active = false): React.CSSProperties => ({
  width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none', cursor: 'pointer',
  color: active ? '#14102a' : '#fff', background: active ? '#fff' : 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.16)', padding: 0,
});
const flatBtn = (size: number, active = false): React.CSSProperties => ({
  width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none', cursor: 'pointer',
  color: active ? VIOLET : '#fff', background: 'transparent', border: 'none', padding: 0,
});

/* ── Диск / обложка с логотипом Sky ─────────────────────────────── */
const SkyDisc = ({ track, size, playing, disc, c1, c2 }: { track: Track; size: number; playing: boolean; disc: boolean; c1: string; c2: string }) => {
  const state = playing ? 'running' : 'paused';
  if (!disc) {
    return (
      <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
        <div className="spp-ring" style={{ position: 'absolute', inset: 0, borderRadius: size * 0.28, border: `2px solid ${c1}`, opacity: 0.45, animationPlayState: state }} />
        <div style={{ position: 'relative', width: size, height: size, borderRadius: size * 0.28, overflow: 'hidden', background: `linear-gradient(135deg,${c1},${c2})`,
          boxShadow: '0 30px 80px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.25)', display: 'grid', placeItems: 'center' }}>
          {track.coverUrl ? <img src={track.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <img src="/logo.png" alt="Sky" style={{ width: '56%', height: '56%', objectFit: 'contain' }} />}
          {track.coverUrl && <img src="/logo.png" alt="" style={{ position: 'absolute', right: 12, bottom: 12, width: size * 0.16, height: size * 0.16, objectFit: 'contain', opacity: 0.92 }} />}
        </div>
      </div>
    );
  }
  const label = size * 0.5;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <div className="spp-ring" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${c1}`, opacity: 0.5, animationPlayState: state }} />
      <div className="spp-ring spp-ring2" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `1px solid ${c2}`, opacity: 0.4, animationPlayState: state }} />
      <div className="spp-spin" style={{ width: size, height: size, borderRadius: '50%', boxShadow: '0 30px 80px rgba(0,0,0,.55)', animationPlayState: state, position: 'relative',
        background: 'repeating-radial-gradient(circle at 50% 50%, #0c0c13 0 6px, #15151f 6px 7px)', border: '2px solid rgba(255,255,255,.12)' }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: label, height: label, transform: 'translate(-50%,-50%)', borderRadius: '50%', overflow: 'hidden',
          background: `linear-gradient(135deg,${c1},${c2})`, border: '2px solid rgba(255,255,255,.28)', display: 'grid', placeItems: 'center' }}>
          {track.coverUrl && <img src={track.coverUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
          <img src="/logo.png" alt="Sky" style={{ position: 'relative', width: '46%', height: '46%', objectFit: 'contain', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.5))' }} />
        </div>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 10, height: 10, marginLeft: -5, marginTop: -5, borderRadius: '50%', background: '#07070C', border: '1px solid rgba(255,255,255,.3)' }} />
      </div>
    </div>
  );
};

/* ── Окно Sky AI ───────────────────────────────────────────────── */
type Msg = { role: 'me' | 'ai'; text: string; err?: boolean };

const AiPanel = ({ track, lyricsPlain, currentLine }: { track: Track; lyricsPlain: string; currentLine: string }) => {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef(track.id);
  useEffect(() => { if (trackRef.current !== track.id) { trackRef.current = track.id; setMsgs([]); setQ(''); } }, [track.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);

  const ask = useCallback(async (question: string, extra = '') => {
    const clean = question.trim(); if (!clean || busy) return;
    setMsgs(m => [...m, { role: 'me', text: clean }]); setQ(''); setBusy(true);
    const meta = [
      `Трек: ${track.title}`, `Исполнитель: ${track.artist}`, track.genre ? `Жанр: ${track.genre}` : '',
      track.album ? `Альбом: ${track.album}` : '', track.year ? `Год: ${track.year}` : '',
    ].filter(Boolean).join('\n');
    const body = `${meta}\n${lyricsPlain ? `\nТекст песни:\n${lyricsPlain.slice(0, 6000)}\n` : ''}${extra ? `\n${extra}\n` : ''}\nВопрос слушателя: ${clean}`;
    const r = await apiAiAsk('trackqa', body);
    setBusy(false);
    setMsgs(m => [...m, r.ok ? { role: 'ai', text: r.text || 'Пустой ответ.' } : { role: 'ai', text: r.reason, err: true }]);
  }, [busy, track, lyricsPlain]);

  const quick: { label: string; q: string; extra?: string }[] = [
    { label: 'О чём эта песня?', q: 'О чём эта песня?' },
    { label: 'Об исполнителе', q: 'Расскажи коротко об исполнителе.' },
    { label: 'История трека', q: 'Что известно об истории создания этого трека?' },
    { label: 'Похожие треки', q: 'Посоветуй похожие по настроению треки или исполнителей.' },
    ...(currentLine ? [{ label: 'Что значит эта строка?', q: 'Объясни, что значит эта строка.', extra: `Текущая строка: «${currentLine}»` }] : []),
  ];

  return (
    <div style={{ ...glass, borderRadius: 32, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '18px 22px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#8b5cf6,#ec4899)' }}><Sparkles size={17} color="#fff" /></span>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Sky AI</p>
          <p style={{ margin: 0, fontSize: 11.5, color: 'rgba(255,255,255,.6)' }}>Спросите о треке. ИИ может ошибаться.</p>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 18px', scrollbarWidth: 'none' }}>
        {msgs.length === 0 && <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 4px' }}><SkyCloud state="greeting" size={84} /></div>}
        {msgs.length === 0 && <p style={{ fontSize: 13, color: 'rgba(255,255,255,.62)', lineHeight: 1.5, margin: '6px 4px 12px' }}>Выберите вопрос ниже или задайте свой.</p>}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'me' ? 'flex-end' : 'flex-start', margin: '8px 0' }}>
            <div translate="no" style={{
              maxWidth: '88%', padding: '10px 14px', borderRadius: 18, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
              background: m.role === 'me' ? 'rgba(139,92,246,.35)' : m.err ? 'rgba(239,68,68,.16)' : 'rgba(255,255,255,.08)',
              border: `1px solid ${m.err ? 'rgba(239,68,68,.35)' : 'rgba(255,255,255,.1)'}`,
            }}>{m.text}</div>
          </div>
        ))}
        {busy && <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'rgba(255,255,255,.65)', margin: '8px 4px' }}><SkyCloud state="waiting" size={44} />Думаю…</div>}
        <div ref={endRef} />
      </div>
      <div style={{ padding: '8px 14px 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {quick.map(x => (
          <button key={x.label} type="button" disabled={busy} onClick={() => void ask(x.q, x.extra)}
            style={{ padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#fff', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)', opacity: busy ? 0.5 : 1 }}>{x.label}</button>
        ))}
      </div>
      <form onSubmit={e => { e.preventDefault(); void ask(q); }} style={{ display: 'flex', gap: 8, padding: 14 }}>
        <input value={q} onChange={e => setQ(e.target.value)} maxLength={400} placeholder="Свой вопрос о треке" aria-label="Свой вопрос о треке"
          style={{ flex: 1, minWidth: 0, height: 44, borderRadius: 22, padding: '0 16px', fontSize: 14, color: '#fff', outline: 'none', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)' }} />
        <button type="submit" aria-label="Отправить" disabled={busy || !q.trim()}
          style={{ ...roundBtn(44, true), opacity: busy || !q.trim() ? 0.5 : 1 }}><Send size={17} /></button>
      </form>
    </div>
  );
};

/* ── Плеер ─────────────────────────────────────────────────────── */
export const SkyPcPlayer = ({
  track, playing, currentTime, duration, volume, shuffle, repeat, favorites, queue, queueIdx,
  onPlay, onPrev, onNext, onSeek, onVolume, onShuffle, onRepeat, onLike, onAdd, onArtist, onClose,
}: PcPlayerProps) => {
  const buffering = useBuffering();
  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* не критично */ } };
  const [disc, setDiscState] = useState(readDisc);
  const setDisc = (v: boolean) => { setDiscState(v); try { localStorage.setItem(DISC_KEY, v ? '1' : '0'); } catch { /* не критично */ } };
  const mobile = useIsMobile();
  const [bg, setBgState] = useState<Bg>(readBg);
  const setBg = (v: Bg) => { setBgState(v); try { localStorage.setItem(BG_KEY, v); } catch { /* не критично */ } };
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  useEffect(() => {
    if (bg !== 'custom') { setCustomUrl(null); return undefined; }
    let url: string | null = null; let alive = true;
    void getWallpaperBlob(PLAYER_WP).then(b => { if (alive && b) { url = URL.createObjectURL(b); setCustomUrl(url); } else if (alive) setBg('tracks'); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [bg]);   // eslint-disable-line react-hooks/exhaustive-deps
  const fileRef = useRef<HTMLInputElement>(null);
  const pickWallpaper = async (f?: File) => {
    if (!f) return;
    const r = await prepareWallpaper(f);
    if (!r.ok) { flash(r.reason); return; }
    if (!(await putWallpaperBlob(PLAYER_WP, r.blob))) { flash('Не удалось сохранить картинку на этом устройстве.'); return; }
    setBg('custom');
  };
  const [menu, setMenu] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [muted, setMuted] = useState(false);
  const [editor, setEditor] = useState(false);
  const [w, setW] = useState(() => window.innerWidth);
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => { setW(window.innerWidth); setH(window.innerHeight); };
    window.addEventListener('resize', on); return () => window.removeEventListener('resize', on);
  }, []);

  const [c1, c2] = getG(track.id);
  const isFav = favorites.includes(track.id);
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  /* Текст песни: тот, что загрузил владелец; режим показа тоже его. */
  const [raw, setRaw] = useState<string | null>(null);
  const [lyricsMode, setLyricsMode] = useState<LyricsMode>('auto');
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    let alive = true; setRaw(null); setCanEdit(false);
    void apiLyrics(track.id).then(r => { if (!alive) return; setRaw(r?.lyrics ?? ''); setLyricsMode(r?.mode ?? 'auto'); setCanEdit(Boolean(r?.canEdit)); });
    return () => { alive = false; };
  }, [track.id, editor]);
  const lines = useMemo(() => {
    const base = track.syncedLyrics && track.syncedLyrics.length > 0 && lyricsMode !== 'static' ? track.syncedLyrics : parseTimedLyrics(raw ?? '');
    const out = base.filter(l => l.text);
    return lyricsMode === 'static' ? out.map(l => ({ ...l, t: 0 })) : out;
  }, [track.syncedLyrics, raw, lyricsMode]);
  const synced = lines.some(l => l.t > 0);
  const active = useMemo(() => (synced ? lines.reduce((best, l, i) => (l.t <= currentTime ? i : best), 0) : -1), [lines, currentTime, synced]);
  const plain = useMemo(() => lines.map(l => l.text).join('\n'), [lines]);

  /* Автопрокрутка по строкам, пока человек не листает сам. */
  const boxRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const userScrollAt = useRef(0);
  useEffect(() => {
    if (active < 0 || Date.now() - userScrollAt.current < 3500) return;
    itemRefs.current[active]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [active]);
  useEffect(() => { boxRef.current?.scrollTo({ top: 0 }); }, [track.id]);

  /* Клавиатура: Esc, Пробел, ←/→ (5 с). */
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') { if (editor) return; if (menu || showQueue) { setMenu(false); setShowQueue(false); } else onClose(); }
      else if (e.key === ' ') { e.preventDefault(); onPlay(); }
      else if (e.key === 'ArrowRight') onSeek(Math.min(duration, currentTime + 5));
      else if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 5));
    };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [onClose, onPlay, onSeek, currentTime, duration, menu, showQueue, editor]);

  const narrow = mobile || w < 980;
  const showText = mode !== 'compact';
  const showAi = mode === 'ai';
  const discSize = mobile ? Math.max(150, Math.min(260, w * 0.66, h * 0.3)) : showText ? Math.max(170, Math.min(w * 0.22, h * 0.36, 320)) : Math.max(200, Math.min(w * 0.3, h * 0.4, 380));
  const queueItems = queue.slice(Math.max(0, queueIdx), queueIdx + 40);

  const infoBlock = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: mobile ? 16 : 22, minWidth: 0 }}>
      <SkyDisc track={track} size={discSize} playing={playing} disc={disc} c1={c1} c2={c2} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
        <h1 translate="no" style={{ margin: 0, fontFamily: "'Unbounded','Manrope',sans-serif", fontWeight: 600, fontSize: mobile ? 24 : showText ? 26 : 36, letterSpacing: '-.01em', textAlign: 'center', overflowWrap: 'anywhere' }}>
          {track.title}<ExplicitBadge show={track.explicit} />
        </h1>
        <div style={{ display: 'flex', gap: 22, justifyContent: 'center', flexWrap: 'wrap', marginTop: 4 }}>
          <button type="button" onClick={() => onArtist?.(track.artist)} disabled={!onArtist} style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', background: 'none', border: 'none', cursor: onArtist ? 'pointer' : 'default', padding: 0, textAlign: 'left' }}>
            <span style={{ width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 17, background: `linear-gradient(135deg,${c1},${c2})`, border: '1px solid rgba(255,255,255,.3)' }} translate="no">{track.artist.slice(0, 1).toUpperCase()}</span>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: 'rgba(255,255,255,.72)' }}>Исполнитель</span>
              <span translate="no" style={{ fontSize: 15, fontWeight: 800 }}>{track.artist}</span>
            </span>
          </button>
          {track.uploaderName && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 17, background: `linear-gradient(135deg,${c2},${VIOLET})`, border: '1px solid rgba(255,255,255,.3)' }} translate="no">{track.uploaderName.slice(0, 1).toUpperCase()}</span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: 'rgba(255,255,255,.72)' }}>Загрузил</span>
                <span translate="no" style={{ fontSize: 15, fontWeight: 800 }}>{track.uploaderName}</span>
              </span>
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" aria-label="В избранное" onClick={() => onLike(track.id)} style={{ ...roundBtn(50), color: isFav ? '#f43f5e' : '#fff' }}><Heart size={21} fill={isFav ? '#f43f5e' : 'none'} /></button>
        <button type="button" aria-label="Добавить в плейлист" onClick={() => onAdd(track.id)} style={roundBtn(50)}><Plus size={21} /></button>
        <button type="button" onClick={() => setMode(showText ? 'compact' : 'lyrics')} style={{ ...roundBtn(50, showText), width: 'auto', padding: '0 20px', gap: 8, display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 14.5 }}><AlignLeft size={18} />Текст</button>
        <button type="button" onClick={() => setMode(showAi ? 'lyrics' : 'ai')} style={{ ...roundBtn(50, showAi), width: 'auto', padding: '0 20px', gap: 8, display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 14.5 }}><Sparkles size={18} />ИИ</button>
      </div>
    </div>
  );

  const lyricsPanel = (
    <div style={{ ...glass, borderRadius: 32, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflow: 'hidden', flex: 1, minWidth: 0 }}>
      <div style={{ padding: '18px 26px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: '.14em', color: 'rgba(255,255,255,.6)' }}>ТЕКСТ ПЕСНИ</p>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'rgba(255,255,255,.55)' }}>{synced ? 'По строкам' : lines.length ? 'Статичный' : ''}</p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setEditor(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#fff', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)' }}>
            <Pencil size={13} />{lines.length ? 'Править' : 'Добавить текст'}
          </button>
        )}
      </div>
      <div ref={boxRef} onWheel={() => { userScrollAt.current = Date.now(); }} onTouchMove={() => { userScrollAt.current = Date.now(); }}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 30px 28px', scrollbarWidth: 'none' }}>
        {raw === null && <p style={{ color: 'rgba(255,255,255,.6)', fontSize: 14 }}>Загрузка…</p>}
        {raw !== null && lines.length === 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><SkyCloud state="surprise" size={64} /><p style={{ color: 'rgba(255,255,255,.6)', fontSize: 14, lineHeight: 1.5 }}>Текст для этого трека не добавлен.</p></div>}
        {lines.map((l, i) => {
          const on = synced && i === active;
          return (
            <button key={i} ref={el => { itemRefs.current[i] = el; }} type="button" translate="no"
              onClick={() => { if (synced) { userScrollAt.current = 0; onSeek(l.t); } }}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '5px 0', cursor: synced ? 'pointer' : 'default', color: '#fff',
                fontFamily: 'inherit', fontWeight: 800, overflowWrap: 'anywhere', transition: 'opacity .3s, font-size .3s',
                fontSize: synced ? (on ? 30 : 22) : 20, lineHeight: 1.3, opacity: synced ? (on ? 1 : 0.42) : 0.9 }}>{l.text}</button>
          );
        })}
      </div>
    </div>
  );

  return createPortal((
    <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      className="fixed inset-0 z-[500] flex flex-col overflow-hidden" data-keep-dark
      style={{ fontFamily: "'Manrope','Nunito',system-ui,sans-serif", color: '#fff', background: '#07070C' }}>
      {/* Фон: дрейфующие пятна цвета трека, обложка или своя картинка */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {(bg === 'custom' && customUrl) || (bg === 'cover' && track.coverUrl) ? (
          <div key={bg === 'custom' ? customUrl : track.coverUrl} style={{ position: 'absolute', inset: -40, background: `center/cover no-repeat url(${bg === 'custom' ? customUrl : track.coverUrl})`, filter: bg === 'cover' ? 'blur(48px) saturate(1.3)' : 'blur(6px)', transform: 'scale(1.1)', animation: 'lk-fade .6s ease both' }} />
        ) : (
          <>
            <div className="spp-blob spp-blobA" style={{ background: c1, animationPlayState: playing ? 'running' : 'paused' }} />
            <div className="spp-blob spp-blobB" style={{ background: VIOLET, animationPlayState: playing ? 'running' : 'paused' }} />
            <div className="spp-blob spp-blobC" style={{ background: c2, animationPlayState: playing ? 'running' : 'paused' }} />
          </>
        )}
        <VideoBackdrop src={track.videoUrl} playing={playing} />
        <div style={{ position: 'absolute', inset: 0, background: bg === 'custom' ? 'linear-gradient(180deg,rgba(7,7,12,.4),rgba(7,7,12,.72))' : 'linear-gradient(180deg,rgba(7,7,12,.3),rgba(7,7,12,.66))' }} />
      </div>

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {/* Верхняя панель */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: mobile ? 'calc(var(--safe-top, 0px) + 8px) 16px 0' : 'calc(var(--safe-top, 0px) + 14px) 40px 0', height: mobile ? 56 : 72, boxSizing: 'content-box', flex: 'none' }}>
          <button type="button" aria-label="Свернуть плеер" onClick={onClose} style={roundBtn(44)}><ChevronDown size={22} /></button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.14em', color: 'rgba(255,255,255,.7)' }}>СЕЙЧАС ИГРАЕТ</span>
            <span translate="no" style={{ fontSize: 15, fontWeight: 700, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.artist}</span>
          </div>
          <button type="button" aria-label="Настройки плеера" onClick={() => setMenu(v => !v)} style={roundBtn(44, menu)}><MoreHorizontal size={22} /></button>
        </div>

        {!mobile && (
          <>
        {/* Основная часть */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 22, padding: `12px ${narrow ? 20 : 40}px 132px`, alignItems: 'stretch' }}>
          <div style={{ flex: showText && !narrow ? `0 0 ${Math.max(320, Math.min(w * 0.3, 480))}px` : 1, display: narrow && showText ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, overflow: 'hidden' }}>
            {infoBlock}
          </div>
          {showText && (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 22, minHeight: 0 }}>
              {!(narrow && showAi) && lyricsPanel}
              {showAi && <div style={{ flex: narrow ? 1 : `0 0 ${Math.max(300, Math.min(w * 0.26, 420))}px`, minWidth: 0, minHeight: 0 }}><AiPanel track={track} lyricsPlain={plain} currentLine={active >= 0 ? lines[active]?.text ?? '' : ''} /></div>}
            </div>
          )}
        </div>

        {/* Нижняя панель */}
        <div style={{ ...glass, position: 'absolute', left: narrow ? 20 : 40, right: narrow ? 20 : 40, bottom: 28, height: 96, boxSizing: 'border-box', borderRadius: 30, padding: '0 22px', display: 'flex', alignItems: 'center', gap: 22, boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: narrow ? 200 : 320, flex: 'none', minWidth: 0 }}>
            <div style={{ width: 60, height: 60, borderRadius: 16, flex: 'none', overflow: 'hidden', display: 'grid', placeItems: 'center', background: `linear-gradient(135deg,${c1},${c2})` }}>
              {track.coverUrl ? <img src={track.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 size={26} color="rgba(255,255,255,.8)" />}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p translate="no" style={{ margin: 0, fontSize: 15.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</p>
              <p translate="no" style={{ margin: '3px 0 0', fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</p>
            </div>
            <button type="button" aria-label="В избранное" onClick={() => onLike(track.id)} style={{ ...flatBtn(38), color: isFav ? '#f43f5e' : '#fff' }}><Heart size={19} fill={isFav ? '#f43f5e' : 'none'} /></button>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <button type="button" aria-label="Перемешать" aria-pressed={shuffle} onClick={onShuffle} style={flatBtn(40, shuffle)}><Shuffle size={19} /></button>
              <button type="button" aria-label="Предыдущий" onClick={onPrev} style={flatBtn(40)}><SkipBack size={20} fill="currentColor" /></button>
              <button type="button" aria-label={playing ? 'Пауза' : 'Играть'} onClick={onPlay}
                style={{ width: 52, height: 52, borderRadius: '50%', border: 'none', background: '#fff', color: '#0A0A10', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none' }}>
                {buffering ? <BufferingRing size={24} color="#0A0A10" /> : playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" style={{ marginLeft: 2 }} />}
              </button>
              <button type="button" aria-label="Следующий" onClick={onNext} style={flatBtn(40)}><SkipForward size={20} fill="currentColor" /></button>
              <button type="button" aria-label="Повтор" aria-pressed={repeat !== 'off'} onClick={onRepeat} style={flatBtn(40, repeat !== 'off')}>{repeat === 'one' ? <Repeat1 size={19} /> : <Repeat size={19} />}</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 560 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.75)', width: 34, textAlign: 'right' }}>{fmt(currentTime)}</span>
              <input type="range" min={0} max={100} step={0.1} value={pct} aria-label="Перемотка" className="spp-range"
                onChange={e => { if (duration > 0) onSeek((Number(e.target.value) / 100) * duration); }}
                style={{ flex: 1, margin: 0, background: `linear-gradient(90deg,#fff ${pct}%,rgba(255,255,255,.2) ${pct}%)` }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.75)', width: 34 }}>{fmt(duration)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: narrow ? 'auto' : 330, flex: 'none', justifyContent: 'flex-end' }}>
            <button type="button" aria-label="Текст" aria-pressed={showText} onClick={() => setMode(showText ? 'compact' : 'lyrics')} style={roundBtn(44, showText)}><AlignLeft size={19} /></button>
            <button type="button" aria-label="ИИ о треке" aria-pressed={showAi} onClick={() => setMode(showAi ? 'lyrics' : 'ai')} style={roundBtn(44, showAi)}><Sparkles size={19} /></button>
            <button type="button" aria-label="Очередь" aria-pressed={showQueue} onClick={() => setShowQueue(v => !v)} style={roundBtn(44, showQueue)}><ListMusic size={19} /></button>
            {!narrow && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button type="button" aria-label={muted ? 'Включить звук' : 'Выключить звук'} onClick={() => setMuted(m => !m)} style={flatBtn(36)}>{muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
                <input type="range" min={0} max={100} value={Math.round((muted ? 0 : volume) * 100)} aria-label="Громкость" className="spp-range"
                  onChange={e => { setMuted(false); onVolume(Number(e.target.value) / 100); }}
                  style={{ width: 80, margin: 0, background: `linear-gradient(90deg,#fff ${Math.round((muted ? 0 : volume) * 100)}%,rgba(255,255,255,.2) 0)` }} />
              </div>
            )}
          </div>
        </div>

          </>
        )}

        {/* Мобильный вид (по референсу): диск, название, кнопки, внизу шкала, управление и режимы */}
        {mobile && (
          <>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '4px 20px 0', gap: 12 }}>
              {mode === 'compact' ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, overflow: 'hidden' }}>{infoBlock}</div>
              ) : (
                <>
                  <button type="button" onClick={() => setMode('compact')} aria-label="Показать обложку" style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', color: '#fff', textAlign: 'left', padding: 0, cursor: 'pointer', flex: 'none' }}>
                    <span style={{ width: 52, height: 52, borderRadius: 14, overflow: 'hidden', flex: 'none', background: `linear-gradient(135deg,${c1},${c2})`, display: 'grid', placeItems: 'center' }}>
                      {track.coverUrl ? <img src={track.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 size={22} color="rgba(255,255,255,.8)" />}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span translate="no" style={{ display: 'block', fontSize: 16, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</span>
                      <span translate="no" style={{ display: 'block', fontSize: 13, color: 'rgba(255,255,255,.72)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</span>
                    </span>
                  </button>
                  <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                    {showAi
                      ? <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}><AiPanel track={track} lyricsPlain={plain} currentLine={active >= 0 ? lines[active]?.text ?? '' : ''} /></div>
                      : lyricsPanel}
                  </div>
                </>
              )}
            </div>
            <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 12, padding: '10px 24px calc(var(--safe-bottom, 0px) + 18px)' }}>
              <div>
                <input type="range" min={0} max={100} step={0.1} value={pct} aria-label="Перемотка" className="spp-range"
                  onChange={e => { if (duration > 0) onSeek((Number(e.target.value) / 100) * duration); }}
                  style={{ width: '100%', margin: '6px 0', background: `linear-gradient(90deg,#fff ${pct}%,rgba(255,255,255,.2) ${pct}%)` }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.75)' }}><span>{fmt(currentTime)}</span><span>{fmt(duration)}</span></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
                <button type="button" aria-label="Перемешать" aria-pressed={shuffle} onClick={onShuffle} style={flatBtn(44, shuffle)}><Shuffle size={20} /></button>
                <button type="button" aria-label="Предыдущий" onClick={onPrev} style={flatBtn(48)}><SkipBack size={24} fill="currentColor" /></button>
                <button type="button" aria-label={playing ? 'Пауза' : 'Играть'} onClick={onPlay}
                  style={{ width: 68, height: 68, borderRadius: '50%', border: 'none', background: '#fff', color: '#0A0A10', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: '0 12px 30px rgba(0,0,0,.4)' }}>
                  {buffering ? <BufferingRing size={28} color="#0A0A10" /> : playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" style={{ marginLeft: 3 }} />}
                </button>
                <button type="button" aria-label="Следующий" onClick={onNext} style={flatBtn(48)}><SkipForward size={24} fill="currentColor" /></button>
                <button type="button" aria-label="Повтор" aria-pressed={repeat !== 'off'} onClick={onRepeat} style={flatBtn(44, repeat !== 'off')}>{repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}</button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setMode(showText ? 'compact' : 'lyrics')} aria-pressed={showText} style={{ ...roundBtn(46, showText), flex: 1, width: 'auto', borderRadius: 23, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14, fontWeight: 800, fontFamily: 'inherit' }}><AlignLeft size={18} />Текст</button>
                <button type="button" onClick={() => setMode(showAi ? 'lyrics' : 'ai')} aria-pressed={showAi} style={{ ...roundBtn(46, showAi), flex: 1, width: 'auto', borderRadius: 23, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14, fontWeight: 800, fontFamily: 'inherit' }}><Sparkles size={18} />ИИ</button>
                <button type="button" aria-label="Очередь" aria-pressed={showQueue} onClick={() => setShowQueue(v => !v)} style={roundBtn(46, showQueue)}><ListMusic size={20} /></button>
              </div>
            </div>
          </>
        )}

        {/* Настройки плеера */}
        <AnimatePresence>
          {menu && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              style={{ ...glass, position: 'absolute', right: mobile ? 12 : 40, top: mobile ? 'calc(var(--safe-top, 0px) + 60px)' : 'calc(var(--safe-top, 0px) + 80px)', width: mobile ? 'min(320px, calc(100vw - 24px))' : 320, boxSizing: 'border-box', borderRadius: 24, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, background: 'rgba(20,20,30,.86)', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
              <span style={{ fontSize: 17, fontWeight: 800 }}>Настройки плеера</span>
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.12em', color: 'rgba(255,255,255,.72)' }}>ЛОГОТИП</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {([[false, 'Обычный'], [true, 'Диск']] as const).map(([v, l]) => (
                  <button key={l} type="button" onClick={() => setDisc(v)}
                    style={{ flex: 1, height: 46, borderRadius: 23, fontSize: 14, fontWeight: 800, cursor: 'pointer', border: '1px solid rgba(255,255,255,.18)', fontFamily: 'inherit',
                      background: disc === v ? '#fff' : 'rgba(255,255,255,.08)', color: disc === v ? '#0A0A10' : '#fff' }}>{l}</button>
                ))}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.45, color: 'rgba(255,255,255,.75)' }}>Диск с логотипом Sky вращается, пока играет трек, и замирает на паузе.</span>
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.12em', color: 'rgba(255,255,255,.72)' }}>ОБОИ</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {([['tracks', 'Цвета'], ['cover', 'Обложка']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setBg(k)} style={{ flex: 1, height: 42, borderRadius: 21, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: '1px solid rgba(255,255,255,.18)', fontFamily: 'inherit', background: bg === k ? '#fff' : 'rgba(255,255,255,.08)', color: bg === k ? '#0A0A10' : '#fff' }}>{l}</button>
                ))}
                <button type="button" onClick={() => fileRef.current?.click()} style={{ flex: 1.2, height: 42, borderRadius: 21, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: '1px solid rgba(255,255,255,.18)', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: bg === 'custom' ? '#fff' : 'rgba(255,255,255,.08)', color: bg === 'custom' ? '#0A0A10' : '#fff' }}><ImageIcon size={15} />Своя</button>
              </div>
              {bg === 'custom' && <button type="button" onClick={() => { void deleteWallpaperBlob(PLAYER_WP); setBg('tracks'); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.75)', fontSize: 12.5, textDecoration: 'underline', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: 'inherit' }}>Убрать свою картинку</button>}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { void pickWallpaper(e.target.files?.[0]); e.target.value = ''; }} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Очередь */}
        <AnimatePresence>
          {showQueue && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
              style={{ ...glass, position: 'absolute', right: mobile ? 12 : narrow ? 20 : 40, bottom: mobile ? 'calc(var(--safe-bottom, 0px) + 80px)' : 140, width: mobile ? 'min(380px, calc(100vw - 24px))' : 380, maxHeight: '55vh', borderRadius: 26, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'rgba(20,20,30,.9)', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 8px' }}>
                <span style={{ fontSize: 15, fontWeight: 800 }}>Очередь · {queue.length}</span>
                <button type="button" aria-label="Закрыть очередь" onClick={() => setShowQueue(false)} style={flatBtn(30)}><X size={18} /></button>
              </div>
              <div style={{ overflowY: 'auto', padding: '0 10px 12px', scrollbarWidth: 'none' }}>
                {queueItems.map((t, i) => {
                  const idx = Math.max(0, queueIdx) + i; const cur = idx === queueIdx; const [a, b] = getG(t.id);
                  return (
                    <button key={`${t.id}-${idx}`} type="button" onClick={() => usePlayerStore.getState().playQueueIndex(idx)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 14, cursor: 'pointer', color: '#fff', border: 'none', fontFamily: 'inherit',
                        background: cur ? 'rgba(139,92,246,.25)' : 'transparent' }}>
                      <span style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', flex: 'none', background: `linear-gradient(135deg,${a},${b})`, display: 'grid', placeItems: 'center' }}>
                        {t.coverUrl ? <img src={t.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 size={16} color="rgba(255,255,255,.7)" />}
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span translate="no" style={{ display: 'block', fontSize: 13.5, fontWeight: cur ? 800 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                        <span translate="no" style={{ display: 'block', fontSize: 11.5, color: 'rgba(255,255,255,.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.artist}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {editor && <TrackEditor track={track} onClose={() => setEditor(false)} />}
    </motion.div>
  ), document.body);
};
