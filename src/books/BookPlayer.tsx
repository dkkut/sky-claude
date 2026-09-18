/**
 * Единый плеер Sky Books.
 *
 * Один и тот же экран на «читать» и «слушать» — то же устройство, что
 * у единого плеера подкастов (аудио/видео): одна книга, один список
 * глав, переключение вида не теряет место на главе. Разница в том, что
 * здесь сами позиции разные по смыслу — доля прочитанного текста и
 * секунда озвучки, — и обе живут в одной записи прогресса на сервере
 * (book_progress), каждая своей парой полей.
 *
 * Текстовая позиция хранится не символом, а тысячными долями высоты
 * главы (0..10000): столбик текста у всех разной ширины и кегля, а
 * доля прокрутки одна и та же что на телефоне, что на мониторе.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, BookOpen, Headphones, Play, Pause, SkipBack, SkipForward,
  List, Loader2, AlertTriangle, Gauge, Volume2, VolumeX, Type,
} from 'lucide-react';
import {
  apiChapters, apiChapter, apiProgress, apiSetProgress, apiNotePlayed, apiMediaTicket,
  chapterAudioUrl, fmtTime,
  type Book, type ChapterMeta, type Chapter,
} from './booksApi';

const C = {
  bg: 'var(--bg)', l1: 'var(--bg-l1)', l2: 'var(--bg-l2)',
  border: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
  purple: '#a855f7', purpleSoft: 'rgba(168,85,247,0.16)',
};

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const FONT_SIZES = [15, 17, 19, 22];

/** Доля прокрутки контейнера, 0..10000. */
const scrollFrac = (el: HTMLDivElement) => {
  const range = el.scrollHeight - el.clientHeight;
  if (range <= 0) return 0;
  return Math.max(0, Math.min(10000, Math.round((el.scrollTop / range) * 10000)));
};

export const BookPlayer = ({ book, onClose }: { book: Book; onClose: () => void }) => {
  const [chapters, setChapters] = useState<ChapterMeta[] | null>(null);
  const [mode, setMode] = useState<'text' | 'audio'>(book.hasText ? 'text' : 'audio');
  const [chapterNumber, setChapterNumber] = useState(1);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [showList, setShowList] = useState(false);
  const [fontSize, setFontSize] = useState(17);
  const [showFontSize, setShowFontSize] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const textRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const restoreFrac = useRef<number | null>(null);
  const restoreSeconds = useRef<number | null>(null);
  const notedRef = useRef<Set<string>>(new Set());

  /* Список глав, стартовая глава и вид — из сохранённого прогресса. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [chs, progress] = await Promise.all([apiChapters(book.id), apiProgress(book.id)]);
      if (!alive) return;
      setChapters(chs ?? []);
      if (progress) {
        const startMode = progress.lastMode === 'audio' && book.hasAudio ? 'audio'
          : progress.lastMode === 'text' && book.hasText ? 'text'
            : (book.hasText ? 'text' : 'audio');
        setMode(startMode);
        setChapterNumber(startMode === 'audio' ? progress.audioChapter : progress.textChapter);
        restoreFrac.current = progress.textOffset;
        restoreSeconds.current = progress.audioPosition;
      } else {
        setChapterNumber(1);
      }
      void apiMediaTicket();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const currentMeta = useMemo(
    () => chapters?.find((c) => c.number === chapterNumber) ?? null,
    [chapters, chapterNumber],
  );

  /* Текст главы — только когда он правда нужен. */
  useEffect(() => {
    if (mode !== 'text' || !currentMeta) return;
    let alive = true;
    setChapter(null);
    setLoadingChapter(true);
    void apiChapter(currentMeta.id).then((c) => {
      if (!alive) return;
      setChapter(c);
      setLoadingChapter(false);
    });
    return () => { alive = false; };
  }, [mode, currentMeta]);

  /* Прокрутка к сохранённому месту — один раз, после отрисовки текста. */
  useEffect(() => {
    if (mode !== 'text' || !chapter || restoreFrac.current === null) return;
    const el = textRef.current;
    const frac = restoreFrac.current;
    restoreFrac.current = null;
    if (!el) return;
    const t = setTimeout(() => {
      const range = el.scrollHeight - el.clientHeight;
      if (range > 0) el.scrollTop = (frac / 10000) * range;
    }, 30);
    return () => clearTimeout(t);
  }, [mode, chapter]);

  const noteOnce = useCallback((kind: 'text' | 'audio') => {
    const key = `${kind}:${chapterNumber}`;
    if (notedRef.current.has(key)) return;
    notedRef.current.add(key);
    void apiNotePlayed(book.id, kind);
  }, [book.id, chapterNumber]);

  /* Сохранение позиции чтения — по прокрутке, не чаще раза в секунду. */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTextScroll = () => {
    const el = textRef.current;
    if (!el) return;
    noteOnce('text');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const frac = scrollFrac(el);
    saveTimer.current = setTimeout(() => {
      void apiSetProgress(book.id, { mode: 'text', textChapter: chapterNumber, textOffset: frac });
    }, 800);
  };

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  /* ── Аудио ───────────────────────────────────────────────────────── */

  useEffect(() => {
    if (mode !== 'audio' || !currentMeta?.hasAudio) return;
    const el = audioRef.current;
    if (!el) return;
    setAudioError(null);
    setPlaying(false);
    setCurrentTime(0);
    el.src = chapterAudioUrl(currentMeta.id);
    el.load();
  }, [mode, currentMeta?.id, currentMeta?.hasAudio]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;

    const onLoaded = () => {
      setDuration(el.duration || 0);
      if (restoreSeconds.current !== null && restoreSeconds.current > 0) {
        el.currentTime = Math.min(restoreSeconds.current, el.duration || restoreSeconds.current);
      }
      restoreSeconds.current = null;
    };
    const onTime = () => setCurrentTime(el.currentTime);
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => { setWaiting(false); noteOnce('audio'); };
    const onEnded = () => {
      setPlaying(false);
      void apiSetProgress(book.id, {
        mode: 'audio', audioChapter: chapterNumber, audioPosition: 0, completed: true,
      });
      const chs = chapters ?? [];
      const next = chs.find((c) => c.number === chapterNumber + 1 && c.hasAudio);
      if (next) setChapterNumber(next.number);
    };
    const onErr = () => setAudioError('Не получилось загрузить озвучку');

    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onErr);
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onErr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterNumber, chapters, book.id]);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = muted ? 0 : volume; }, [volume, muted]);

  /* Позиция прослушивания — не чаще раза в пять секунд. */
  const lastAudioSave = useRef(0);
  useEffect(() => {
    if (mode !== 'audio' || !playing) return;
    const now = Date.now();
    if (now - lastAudioSave.current < 5000) return;
    lastAudioSave.current = now;
    void apiSetProgress(book.id, { mode: 'audio', audioChapter: chapterNumber, audioPosition: currentTime });
  }, [currentTime, mode, playing, book.id, chapterNumber]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play().catch(() => setAudioError('Не удалось включить воспроизведение')); setPlaying(true); }
  };
  const skip = (delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(duration || el.currentTime + delta, el.currentTime + delta));
  };

  const switchMode = (next: 'text' | 'audio') => {
    if (next === mode) return;
    if (mode === 'audio' && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      void apiSetProgress(book.id, { mode: 'audio', audioChapter: chapterNumber, audioPosition: currentTime });
    }
    setMode(next);
  };

  const pickChapter = (n: number) => {
    setChapterNumber(n);
    setShowList(false);
    if (mode === 'text') restoreFrac.current = 0;
    else restoreSeconds.current = 0;
  };

  const total = duration || 0;
  const pct = total > 0 ? Math.min(100, (currentTime / total) * 100) : 0;

  return (
    <motion.div
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 32, stiffness: 320 }}
      className="fixed inset-0 z-[70] flex flex-col" style={{ background: C.bg }}>

      {/* Шапка */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
        <button onClick={onClose} aria-label="Закрыть" className="grid h-9 w-9 place-items-center rounded-full" style={{ background: C.l1 }}>
          <ChevronDown size={18} style={{ color: C.t2 }}/>
        </button>
        <div className="min-w-0 flex-1 px-3 text-center">
          <div className="truncate text-[13px] font-semibold" style={{ color: C.t1 }}>{book.title}</div>
          <div className="truncate text-[11px]" style={{ color: C.t3 }}>
            {currentMeta ? `Глава ${currentMeta.number}${currentMeta.title ? ` · ${currentMeta.title}` : ''}` : '…'}
          </div>
        </div>
        <button onClick={() => setShowList((v) => !v)} aria-label="Оглавление"
          className="grid h-9 w-9 place-items-center rounded-full" style={{ background: showList ? C.purpleSoft : C.l1 }}>
          <List size={17} style={{ color: showList ? C.purple : C.t2 }}/>
        </button>
      </div>

      {/* Переключатель вида */}
      {book.hasText && book.hasAudio && (
        <div className="flex shrink-0 gap-2 px-4 pt-3">
          <button onClick={() => switchMode('text')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold"
            style={{ background: mode === 'text' ? C.purple : C.l1, color: mode === 'text' ? '#fff' : C.t2 }}>
            <BookOpen size={14}/> Читать
          </button>
          <button onClick={() => switchMode('audio')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold"
            style={{ background: mode === 'audio' ? C.purple : C.l1, color: mode === 'audio' ? '#fff' : C.t2 }}>
            <Headphones size={14}/> Слушать
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {/* Оглавление поверх */}
        <AnimatePresence>
          {showList && chapters && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 overflow-y-auto px-4 py-3" style={{ background: C.bg }}>
              {chapters.length === 0
                ? <p className="py-8 text-center text-sm" style={{ color: C.t3 }}>В книге пока нет глав.</p>
                : chapters.map((c) => (
                  <button key={c.id} onClick={() => pickChapter(c.number)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left"
                    style={{ background: c.number === chapterNumber ? C.purpleSoft : 'transparent' }}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm" style={{ color: c.number === chapterNumber ? C.t1 : C.t2 }}>
                        {c.number}. {c.title || `Глава ${c.number}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px]" style={{ color: C.t3 }}>
                      {c.hasText && <BookOpen size={12}/>}
                      {c.hasAudio && <Headphones size={12}/>}
                    </span>
                  </button>
                ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Чтение */}
        {mode === 'text' && (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 justify-end px-4 pt-2">
              <div className="relative">
                <button onClick={() => setShowFontSize((v) => !v)} aria-label="Размер шрифта"
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]" style={{ background: C.l1, color: C.t2 }}>
                  <Type size={13}/>{fontSize}
                </button>
                {showFontSize && (
                  <div className="absolute right-0 top-full z-10 mt-1 flex overflow-hidden rounded-xl border" style={{ background: C.l1, borderColor: C.border }}>
                    {FONT_SIZES.map((s) => (
                      <button key={s} onClick={() => { setFontSize(s); setShowFontSize(false); }}
                        className="px-3 py-1.5 text-[12px]" style={{ color: s === fontSize ? C.purple : C.t2 }}>Aa</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div ref={textRef} onScroll={onTextScroll} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {loadingChapter ? (
                <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: C.t3 }}/></div>
              ) : !currentMeta ? (
                <p className="py-12 text-center text-sm" style={{ color: C.t3 }}>В книге пока нет глав.</p>
              ) : !chapter?.content ? (
                <p className="py-12 text-center text-sm" style={{ color: C.t3 }}>У этой главы нет текста для чтения.</p>
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed" style={{ color: C.t1, fontSize, lineHeight: 1.75 }}>
                  {chapter.content}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Прослушивание */}
        {mode === 'audio' && (
          <div className="flex h-full flex-col items-center justify-center px-6">
            <audio ref={audioRef} preload="none"/>
            <div className="mb-6 grid h-40 w-40 place-items-center rounded-3xl" style={{ background: book.accent ?? C.purple }}>
              <Headphones size={48} className="text-white/75"/>
            </div>

            {audioError && (
              <div className="mb-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                <AlertTriangle size={13}/>{audioError}
              </div>
            )}

            {!currentMeta?.hasAudio ? (
              <p className="text-sm" style={{ color: C.t3 }}>У этой главы нет озвучки.</p>
            ) : (
              <>
                <div className="w-full max-w-sm">
                  <div className="relative h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${C.purple}, #c084fc)` }}/>
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] tabular-nums" style={{ color: C.t3 }}>
                    <span>{fmtTime(currentTime)}</span><span>−{fmtTime(Math.max(0, total - currentTime))}</span>
                  </div>
                </div>

                <div className="my-6 flex items-center justify-center gap-6">
                  <button onClick={() => skip(-15)} aria-label="Назад на 15 секунд" className="grid h-11 w-11 place-items-center rounded-full" style={{ background: C.l1 }}>
                    <SkipBack size={17} style={{ color: C.t2 }}/>
                  </button>
                  <button onClick={toggle} aria-label={playing ? 'Пауза' : 'Слушать'}
                    className="grid h-16 w-16 place-items-center rounded-full shadow-lg" style={{ background: `linear-gradient(135deg, ${C.purple}, #7c3aed)` }}>
                    {waiting ? <Loader2 size={24} className="animate-spin text-white"/>
                      : playing ? <Pause size={26} className="text-white"/> : <Play size={26} className="ml-1 text-white"/>}
                  </button>
                  <button onClick={() => skip(30)} aria-label="Вперёд на 30 секунд" className="grid h-11 w-11 place-items-center rounded-full" style={{ background: C.l1 }}>
                    <SkipForward size={17} style={{ color: C.t2 }}/>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <button onClick={() => setShowRates((v) => !v)} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold" style={{ background: C.l1, color: C.t2 }}>
                      <Gauge size={13}/>{rate}×
                    </button>
                    {showRates && (
                      <div className="absolute bottom-full left-0 z-10 mb-1 flex flex-col overflow-hidden rounded-xl border" style={{ background: C.l1, borderColor: C.border }}>
                        {RATES.map((r) => (
                          <button key={r} onClick={() => { setRate(r); setShowRates(false); }} className="px-4 py-1.5 text-[12px]"
                            style={{ color: r === rate ? C.purple : C.t2, background: r === rate ? C.purpleSoft : 'transparent' }}>{r}×</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 rounded-xl px-3 py-1.5" style={{ background: C.l1 }}>
                    <button onClick={() => setMuted((v) => !v)} aria-label={muted ? 'Включить звук' : 'Выключить звук'}>
                      {muted || volume === 0 ? <VolumeX size={13} style={{ color: C.t3 }}/> : <Volume2 size={13} style={{ color: C.t2 }}/>}
                    </button>
                    <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Громкость" className="w-16"
                      onChange={(e) => setVolume(Number(e.target.value))}/>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};
