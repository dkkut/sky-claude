/* ===========================================================
   SKY TV — плеер

   Свой, а не чужой проигрыватель в рамке. Разница не в гордости:
   вставленная страница живёт своей жизнью — своим оформлением, своей
   рекламой, своими правилами, — и ни переключить канал без полной
   перезагрузки, ни показать телепрограмму поверх неё, ни поймать
   ошибку и объяснить её человеку нельзя. Отсюда всё остальное:
   качество, звук, дорожки, понятные отказы и мгновенное переключение.

   Прямой эфир — не фильм. Полосы перемотки здесь нет намеренно: у
   эфира нет ни начала, ни конца, и полоса, которую нельзя тянуть,
   только обманывает. Вместо неё — отметка «в эфире» и, когда человек
   отстал от живого края, кнопка вернуться к нему.
=========================================================== */
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2, Settings2,
  ChevronLeft, ChevronUp, ChevronDown, AlertTriangle, Loader2, Radio, Subtitles,
} from 'lucide-react';
import Hls from 'hls.js';
import { manifestUrl, type TvChannel } from './tvApi';
import { getAccessToken } from '@/core/auth/api';

const K = {
  text: '#FFFFFF',
  sub: 'rgba(255,255,255,0.72)',
  dim: 'rgba(255,255,255,0.42)',
  accent: 'var(--accent)',
  live: '#ef4444',
};

/** Отставание от живого края, после которого предлагаем вернуться. */
const BEHIND_LIVE_SEC = 12;

interface Quality { id: number; label: string; height: number }
interface Track { id: number; label: string }

export interface TVPlayerProps {
  channel: TvChannel;
  onClose: () => void;
  /** Переключение канала без перезагрузки экрана. */
  onPrev?: () => void;
  onNext?: () => void;
  /** На телевизоре управление идёт пультом, и панель ведёт себя иначе. */
  tvMode?: boolean;
}

/**
 * Человеческое объяснение отказа.
 *
 * Технические подробности сюда не попадают: они остаются в журнале
 * сервера. Зрителю нужно понять, что делать, а не что именно не
 * ответило.
 */
const explainError = (code: string) => {
  switch (code) {
    case 'unavailable': return 'Канал временно недоступен. Попробуйте позже или выберите другой.';
    case 'no_source':   return 'У этого канала ещё не подключён источник вещания.';
    case 'network':     return 'Пропала связь. Проверьте подключение к интернету.';
    case 'format':      return 'Это устройство не умеет открыть такой формат вещания.';
    case 'drm':         return 'Канал защищён, и это устройство не может его показать.';
    case 'geo':         return 'Канал недоступен в вашем регионе.';
    default:            return 'Не удалось включить эфир. Попробуйте ещё раз.';
  }
};

export const SkyTVPlayer = ({ channel, onClose, onPrev, onNext, tvMode }: TVPlayerProps) => {
  const vRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimer = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [fullscreen, setFullscreen] = useState(false);
  const [ui, setUi] = useState(true);
  const [settings, setSettings] = useState(false);
  const [behindLive, setBehindLive] = useState(0);

  const [qualities, setQualities] = useState<Quality[]>([]);
  const [quality, setQuality] = useState(-1);
  const [audioTracks, setAudioTracks] = useState<Track[]>([]);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [subtitles, setSubtitles] = useState<Track[]>([]);
  const [subtitle, setSubtitle] = useState(-1);

  const showUi = useCallback(() => {
    setUi(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { setUi(false); setSettings(false); }, 4000);
  }, []);

  /* ── Подключение к эфиру ──────────────────────────────────────── */
  useEffect(() => {
    const v = vRef.current;
    if (!v) return undefined;

    setLoading(true); setError(null); setBuffering(false);
    setQualities([]); setQuality(-1);
    setAudioTracks([]); setSubtitles([]);

    const src = manifestUrl(channel.id);

    // У канала нет источника — идти некуда, и честно сказать об этом
    // лучше, чем показывать вертушку до таймаута.
    if (!channel.live) {
      setLoading(false);
      setError(channel.offline === 'no_source' ? 'no_source' : 'unavailable');
      return undefined;
    }

    // Safari и телевизоры на его основе открывают такой эфир сами, и
    // своими средствами делают это лучше: меньше расход батареи и
    // аппаратное декодирование.
    if (v.canPlayType('application/vnd.apple.mpegurl') && !Hls.isSupported()) {
      v.src = src;
      v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      return () => { v.removeAttribute('src'); v.load(); };
    }

    if (!Hls.isSupported()) {
      setLoading(false);
      setError('format');
      return undefined;
    }

    const hls = new Hls({
      // Эфир идёт кусками по несколько секунд. Держать большой запас
      // незачем: он только отодвигает зрителя от живого края и держит
      // память устройства.
      maxBufferLength: 20,
      backBufferLength: 30,
      lowLatencyMode: true,
      // Манифест и куски идут к нашему серверу, а он принимает только заголовок Authorization (куки у /api/tv нет):
      // без него каждый запрос получал 401, hls.js повторял их бесконечно, и экран вечно «Подключаемся к эфиру».
      // Заголовок кладём только на наши адреса: чужим узлам он не нужен и сломал бы CORS.
      xhrSetup: (xhr, url) => {
        xhr.withCredentials = true;
        const t = getAccessToken();
        if (t && String(url).includes('/api/tv/')) xhr.setRequestHeader('Authorization', `Bearer ${t}`);
      },
    });
    hlsRef.current = hls;

    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      setLoading(false);
      setQualities(data.levels.map((l, i) => ({
        id: i,
        height: l.height ?? 0,
        label: l.height ? `${l.height}p` : `${Math.round((l.bitrate ?? 0) / 1000)} кбит/с`,
      })).filter((q, i, all) => all.findIndex((x) => x.label === q.label) === i));
      v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    });

    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_e, data) => {
      setAudioTracks(data.audioTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Дорожка ${i + 1}` })));
    });
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_e, data) => {
      setSubtitles(data.subtitleTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Субтитры ${i + 1}` })));
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      // Не всякая ошибка смертельна: сеть и разбор чинятся на месте,
      // и обрывать просмотр из-за одного не пришедшего куска нельзя.
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (data.response?.code === 401 || data.response?.code === 403) { setLoading(false); setError('unavailable'); hls.destroy(); return; }
        if (data.response?.code === 503) { setLoading(false); setError('unavailable'); hls.destroy(); return; }
        if (data.response?.code === 451) { setLoading(false); setError('geo'); hls.destroy(); return; }
        setBuffering(true);
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
      if (data.type === Hls.ErrorTypes.KEY_SYSTEM_ERROR) {
        setLoading(false); setError('drm'); hls.destroy(); return;
      }
      setLoading(false);
      setError('unknown');
      hls.destroy();
    });

    hls.loadSource(src);
    hls.attachMedia(v);

    return () => { hls.destroy(); hlsRef.current = null; };
  }, [channel.id, channel.live, channel.offline]);

  /* ── Звук ──────────────────────────────────────────────────────── */
  useEffect(() => {
    const v = vRef.current;
    if (v) { v.volume = volume; v.muted = muted; }
  }, [volume, muted]);

  /* ── Насколько отстали от живого края ─────────────────────────── */
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = vRef.current;
      if (!v || !v.seekable?.length) return;
      const edge = v.seekable.end(v.seekable.length - 1);
      setBehindLive(Math.max(0, edge - v.currentTime));
    }, 1000);
    return () => window.clearInterval(id);
  }, [channel.id]);

  useEffect(() => {
    showUi();
    return () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); };
  }, [showUi, channel.id]);

  const toggle = useCallback(() => {
    const v = vRef.current; if (!v) return;
    if (v.paused) v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else { v.pause(); setPlaying(false); }
  }, []);

  /** Вернуться к живому краю. Для эфира это и есть «перемотка». */
  const backToLive = useCallback(() => {
    const v = vRef.current; if (!v || !v.seekable?.length) return;
    v.currentTime = v.seekable.end(v.seekable.length - 1) - 1;
    v.play().then(() => setPlaying(true)).catch(() => {});
  }, []);

  const retry = useCallback(() => {
    setError(null); setLoading(true);
    const hls = hlsRef.current;
    if (hls) { hls.startLoad(); return; }
    const v = vRef.current;
    if (v) { v.load(); v.play().catch(() => {}); }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await boxRef.current?.requestFullscreen?.().catch(() => {});
      setFullscreen(true);
    } else {
      await document.exitFullscreen?.().catch(() => {});
      setFullscreen(false);
    }
  }, []);

  const pickQuality = (id: number) => {
    setQuality(id);
    if (hlsRef.current) hlsRef.current.currentLevel = id;
  };
  const pickAudio = (id: number) => {
    setAudioTrack(id);
    if (hlsRef.current) hlsRef.current.audioTrack = id;
  };
  const pickSubtitle = (id: number) => {
    setSubtitle(id);
    if (hlsRef.current) hlsRef.current.subtitleTrack = id;
  };

  /* ── Пульт и клавиатура ───────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ': case 'Enter': case 'MediaPlayPause': e.preventDefault(); toggle(); showUi(); break;
        case 'ArrowUp':   if (onPrev) { e.preventDefault(); onPrev(); } break;
        case 'ArrowDown': if (onNext) { e.preventDefault(); onNext(); } break;
        case 'ArrowRight': backToLive(); showUi(); break;
        case 'm': case 'M': setMuted((v) => !v); showUi(); break;
        case 'f': case 'F': void toggleFullscreen(); break;
        case 'Escape': case 'Backspace': case 'GoBack':
          if (document.fullscreenElement) void toggleFullscreen(); else onClose();
          break;
        default: return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, onPrev, onNext, onClose, backToLive, toggleFullscreen, showUi]);

  const isLive = behindLive < BEHIND_LIVE_SEC;
  const btn = 'grid place-items-center rounded-full transition-colors';

  return (
    <div ref={boxRef}
      className="relative h-full w-full overflow-hidden bg-black"
      onMouseMove={showUi}
      onClick={() => { if (!ui) showUi(); }}
      style={{ cursor: ui ? 'default' : 'none' }}>

      <video ref={vRef}
        className="h-full w-full object-contain"
        playsInline
        onWaiting={() => setBuffering(true)}
        onPlaying={() => { setBuffering(false); setLoading(false); setPlaying(true); }}
        onPause={() => setPlaying(false)}
        onClick={(e) => { e.stopPropagation(); toggle(); showUi(); }}/>

      {/* Подключение к эфиру */}
      {loading && !error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-2xl text-lg font-black text-white"
            style={{ background: channel.accent }}>{channel.mark}</div>
          <Loader2 size={20} className="animate-spin" style={{ color: K.dim }}/>
          <p className="text-sm font-semibold text-white">{channel.name}</p>
          <p className="text-xs" style={{ color: K.dim }}>Подключаемся к эфиру…</p>
        </div>
      )}

      {/* Подгрузка посреди просмотра — не ошибка, а состояние связи */}
      {buffering && !loading && !error && (
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <Loader2 size={34} className="animate-spin" style={{ color: 'rgba(255,255,255,0.8)' }}/>
        </div>
      )}

      {/* Отказ. Кнопка выхода обязательна: иначе из чёрного экрана
          некуда деться. */}
      {error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-8 text-center"
          style={{ background: 'rgba(0,0,0,0.85)' }}>
          <AlertTriangle size={38} style={{ color: '#f59e0b' }}/>
          <p className="text-[15px] font-bold text-white">{channel.name}</p>
          <p className="max-w-sm text-[13px]" style={{ color: K.sub }}>{explainError(error)}</p>
          <div className="mt-1 flex gap-2">
            {error !== 'no_source' && (
              <button type="button" onClick={retry}
                className="rounded-full px-5 py-2.5 text-[13px] font-bold text-white"
                style={{ background: K.accent }}>
                Попробовать снова
              </button>
            )}
            {onNext && (
              <button type="button" onClick={onNext}
                className="rounded-full px-5 py-2.5 text-[13px] font-semibold"
                style={{ background: 'rgba(255,255,255,0.12)', color: K.text }}>
                Следующий канал
              </button>
            )}
            <button type="button" onClick={onClose}
              className="rounded-full px-5 py-2.5 text-[13px] font-semibold"
              style={{ background: 'rgba(255,255,255,0.12)', color: K.text }}>
              Выйти
            </button>
          </div>
        </div>
      )}

      {/* Управление */}
      <AnimatePresence>
        {ui && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex flex-col justify-between"
            style={{ pointerEvents: 'none' }}>

            {/* Верх: канал, «в эфире», передача */}
            <div className="flex items-start gap-3 px-4 py-3 sm:px-5 sm:py-4"
              style={{ background: 'linear-gradient(rgba(0,0,0,0.8),transparent)', pointerEvents: 'auto', paddingTop: 'calc(env(safe-area-inset-top, 0px) + var(--island-pad, 0px) + 12px)' }}>
              <button type="button" onClick={onClose}
                className={`${btn} h-10 w-10 shrink-0 hover:bg-white/15`}
                style={{ background: 'rgba(0,0,0,0.5)' }} aria-label="Назад">
                <ChevronLeft size={20} className="text-white"/>
              </button>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[13px] font-black text-white"
                style={{ background: channel.accent }}>{channel.mark}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-bold text-white">{channel.name}</p>
                  {!error && (
                    isLive ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <motion.span className="h-1.5 w-1.5 rounded-full" style={{ background: K.live }}
                          animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.4, repeat: Infinity }}/>
                        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: K.live }}>
                          Live
                        </span>
                      </span>
                    ) : (
                      <button type="button" onClick={backToLive}
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: 'rgba(239,68,68,0.18)', color: K.live }}>
                        −{Math.round(behindLive)} с · к эфиру
                      </button>
                    )
                  )}
                </div>
                {channel.now?.title && (
                  <p className="truncate text-[12px]" style={{ color: K.sub }}>
                    Сейчас: {channel.now.title}
                  </p>
                )}
              </div>
            </div>

            {/* Середина: переключение каналов и пауза.
                При отказе её нет вовсе: играть нечего, а большая кнопка
                ложилась ровно поверх объяснения, почему эфира нет. */}
            <div className="flex items-center justify-center gap-6"
              style={{ pointerEvents: 'auto', visibility: error ? 'hidden' : 'visible' }}>
              {onPrev && (
                <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={onPrev}
                  className={`${btn} h-12 w-12`} style={{ background: 'rgba(0,0,0,0.5)' }}
                  aria-label="Предыдущий канал">
                  <ChevronUp size={22} className="text-white"/>
                </motion.button>
              )}
              <motion.button whileTap={{ scale: 0.92 }} type="button" onClick={toggle}
                className={btn} aria-label={playing ? 'Пауза' : 'Смотреть'}
                style={{ width: 66, height: 66, background: channel.accent,
                  boxShadow: `0 0 36px ${channel.accent}55` }}>
                {playing
                  ? <Pause size={26} fill="white" className="text-white"/>
                  : <Play size={26} fill="white" className="ml-1 text-white"/>}
              </motion.button>
              {onNext && (
                <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={onNext}
                  className={`${btn} h-12 w-12`} style={{ background: 'rgba(0,0,0,0.5)' }}
                  aria-label="Следующий канал">
                  <ChevronDown size={22} className="text-white"/>
                </motion.button>
              )}
            </div>

            {/* Низ: звук, качество, дорожки, полный экран.
                Полосы перемотки нет намеренно — у эфира нет начала. */}
            <div className="flex items-center gap-2 px-4 pb-4 sm:px-5 sm:pb-5"
              style={{ background: 'linear-gradient(transparent,rgba(0,0,0,0.85))', pointerEvents: 'auto', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
              <button type="button" onClick={() => setMuted((v) => !v)}
                className={`${btn} h-9 w-9`} style={{ color: K.sub }}
                aria-label={muted ? 'Включить звук' : 'Выключить звук'}>
                {muted ? <VolumeX size={18}/> : <Volume2 size={18}/>}
              </button>
              {!tvMode && (
                <div className="relative h-[3px] w-24 cursor-pointer rounded-full transition-all hover:h-1.5"
                  style={{ background: 'rgba(255,255,255,0.2)' }}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setVolume(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
                    setMuted(false);
                  }}>
                  <div className="h-full rounded-full"
                    style={{ width: `${muted ? 0 : volume * 100}%`, background: 'rgba(255,255,255,0.85)' }}/>
                </div>
              )}

              <div className="ml-auto flex items-center gap-2">
                {subtitles.length > 0 && (
                  <button type="button" onClick={() => pickSubtitle(subtitle === -1 ? 0 : -1)}
                    className={`${btn} h-9 w-9`}
                    style={{ color: subtitle === -1 ? K.sub : K.accent }} aria-label="Субтитры">
                    <Subtitles size={18}/>
                  </button>
                )}
                {(qualities.length > 1 || audioTracks.length > 1) && (
                  <button type="button" onClick={() => setSettings((v) => !v)}
                    className={`${btn} h-9 w-9`} style={{ color: settings ? K.accent : K.sub }}
                    aria-label="Качество и звук">
                    <Settings2 size={18}/>
                  </button>
                )}
                <button type="button" onClick={() => void toggleFullscreen()}
                  className={`${btn} h-9 w-9`} style={{ color: K.sub }}
                  aria-label={fullscreen ? 'Свернуть' : 'Во весь экран'}>
                  {fullscreen ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Качество и звуковые дорожки */}
      <AnimatePresence>
        {settings && ui && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-16 right-4 z-40 w-52 overflow-hidden rounded-2xl p-2"
            style={{ background: 'rgba(12,12,18,0.96)', border: '1px solid rgba(255,255,255,0.1)' }}>
            {qualities.length > 1 && (
              <>
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: K.dim }}>
                  Качество
                </p>
                <button type="button" onClick={() => pickQuality(-1)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[13px]"
                  style={{ color: quality === -1 ? K.accent : K.text }}>
                  Автоматически
                  {quality === -1 && <Radio size={13}/>}
                </button>
                {qualities.map((q) => (
                  <button key={q.id} type="button" onClick={() => pickQuality(q.id)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[13px]"
                    style={{ color: quality === q.id ? K.accent : K.text }}>
                    {q.label}
                    {quality === q.id && <Radio size={13}/>}
                  </button>
                ))}
              </>
            )}
            {audioTracks.length > 1 && (
              <>
                <p className="mt-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: K.dim }}>
                  Звук
                </p>
                {audioTracks.map((t) => (
                  <button key={t.id} type="button" onClick={() => pickAudio(t.id)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[13px]"
                    style={{ color: audioTrack === t.id ? K.accent : K.text }}>
                    {t.label}
                    {audioTrack === t.id && <Radio size={13}/>}
                  </button>
                ))}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
