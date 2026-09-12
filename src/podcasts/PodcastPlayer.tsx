/**
 * Проигрыватель подкастов: развёрнутый и свёрнутый.
 *
 * Один и тот же для звука и для видео. Разница только в том, что у
 * видеовыпуска на месте обложки стоит ящик под картинку: сам элемент
 * живёт в playerStore и сюда только переносится, поэтому переключение
 * «слушать / смотреть» и уход с экрана звук не прерывают.
 *
 * Титры рисуем сами, а не тегом <track>: строки приходят с сервера
 * расшифрованными по одной, и их же надо подсвечивать в расшифровке и
 * давать переходить по нажатию. Два источника одного и того же текста
 * рано или поздно разъезжаются, поэтому источник один.
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, SkipBack, SkipForward, X, ChevronDown, Volume2, VolumeX,
  Gauge, Subtitles, FileText, Sparkles, List, Loader2, AlertTriangle,
  Headphones, Video, Search, Type, Heart,
} from 'lucide-react';
import {
  usePlayer, PLAY_RATES, prefersReducedMotion, type PlayMode,
} from './playerStore';
import {
  fmtTime, fmtDuration, epCoverUrl, apiBuildSummary, apiSummary, apiSetFavorite, apiSimilar,
  type Summary, type Episode,
} from './podcastApi';

const C = {
  bg: 'var(--bg)', l1: 'var(--bg-l1)', l2: 'var(--bg-l2)',
  border: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
  purple: '#a855f7', purpleSoft: 'rgba(168,85,247,0.16)',
};

/* ─── Полоса времени ───────────────────────────────────────────────── */

const Scrubber = ({ compact = false }: { compact?: boolean }) => {
  const { currentTime, duration, buffered, seek, chapters } = usePlayer();
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const total = duration || 0;
  const shown = dragging ?? currentTime;
  const pct = total > 0 ? Math.min(100, (shown / total) * 100) : 0;
  const bufPct = total > 0 ? Math.min(100, (buffered / total) * 100) : 0;

  const posFrom = useCallback((clientX: number) => {
    const box = barRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || total <= 0) return null;
    return ((clientX - box.left) / box.width) * total;
  }, [total]);

  useEffect(() => {
    if (dragging === null) return undefined;
    const move = (e: PointerEvent) => {
      const t = posFrom(e.clientX);
      if (t !== null) setDragging(Math.max(0, Math.min(total, t)));
    };
    const up = (e: PointerEvent) => {
      const t = posFrom(e.clientX);
      if (t !== null) seek(Math.max(0, Math.min(total, t)));
      setDragging(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, posFrom, seek, total]);

  return (
    <div className={compact ? '' : 'w-full'}>
      <div ref={barRef}
        role="slider" aria-label="Позиция"
        aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(shown)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); seek(currentTime - 5); }
          if (e.key === 'ArrowRight') { e.preventDefault(); seek(currentTime + 5); }
        }}
        onPointerDown={(e) => {
          const t = posFrom(e.clientX);
          if (t !== null) setDragging(Math.max(0, Math.min(total, t)));
        }}
        className="group relative cursor-pointer touch-none py-2.5">
        <div className="relative h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}>
          {/* Что уже скачано: видно, что дальше перемотка будет мгновенной. */}
          <div className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${bufPct}%`, background: 'rgba(255,255,255,0.18)' }}/>
          <div className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${C.purple}, #c084fc)` }}/>
          {/* Метки глав — по ним видно строение выпуска. */}
          {!compact && total > 0 && chapters.map((ch) => (
            <div key={ch.start} className="absolute top-0 h-full w-[2px]"
              style={{ left: `${Math.min(100, (ch.start / total) * 100)}%`, background: 'rgba(255,255,255,0.45)' }}/>
          ))}
        </div>
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full shadow-lg transition-opacity"
          style={{ left: `calc(${pct}% - 7px)`, background: '#fff',
            opacity: dragging !== null ? 1 : undefined }}/>
      </div>
      {!compact && (
        <div className="flex justify-between text-[11px] tabular-nums" style={{ color: C.t3 }}>
          <span>{fmtTime(shown)}</span>
          <span>−{fmtTime(Math.max(0, total - shown))}</span>
        </div>
      )}
    </div>
  );
};

/* ─── Титры поверх картинки ────────────────────────────────────────── */

const CueOverlay = () => {
  const { cues, cueIndex, cueStyle } = usePlayer();
  const cue = cueIndex >= 0 ? cues[cueIndex] : null;
  if (!cueStyle.on || !cue) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-4">
      <span className="max-w-[92%] text-center leading-snug"
        style={{
          fontSize: `${Math.round(15 * (cueStyle.size / 100))}px`,
          color: '#fff',
          textShadow: cueStyle.background ? 'none' : '0 2px 6px rgba(0,0,0,0.9)',
          background: cueStyle.background ? 'rgba(0,0,0,0.62)' : 'transparent',
          padding: cueStyle.background ? '5px 10px' : 0,
          borderRadius: 10,
        }}>
        {cue.speaker ? <b style={{ opacity: 0.75 }}>{cue.speaker}: </b> : null}
        {cue.text}
      </span>
    </div>
  );
};

/* ─── Настройки титров ─────────────────────────────────────────────── */

const CueSettings = ({ onClose }: { onClose: () => void }) => {
  const { cueStyle, setCueStyle } = usePlayer();
  return (
    <div className="rounded-2xl border p-3.5" style={{ background: C.l1, borderColor: C.border }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: C.t1 }}>Субтитры</span>
        <button onClick={onClose} aria-label="Закрыть настройки субтитров"><X size={16} style={{ color: C.t3 }}/></button>
      </div>
      <label className="mb-3 flex items-center justify-between text-sm" style={{ color: C.t2 }}>
        Показывать
        <input type="checkbox" checked={cueStyle.on}
          onChange={(e) => setCueStyle({ on: e.target.checked })}/>
      </label>
      <label className="mb-1 flex items-center justify-between text-sm" style={{ color: C.t2 }}>
        <span className="flex items-center gap-1.5"><Type size={13}/>Размер</span>
        <span className="tabular-nums" style={{ color: C.t3 }}>{cueStyle.size}%</span>
      </label>
      <input type="range" min={70} max={180} step={10} value={cueStyle.size} className="mb-3 w-full"
        aria-label="Размер субтитров"
        onChange={(e) => setCueStyle({ size: Number(e.target.value) })}/>
      <label className="flex items-center justify-between text-sm" style={{ color: C.t2 }}>
        Подложка под текстом
        <input type="checkbox" checked={cueStyle.background}
          onChange={(e) => setCueStyle({ background: e.target.checked })}/>
      </label>
      <p className="mt-2.5 text-[11px] leading-snug" style={{ color: C.t3 }}>
        Без подложки светлый кадр съедает белые буквы. Настройка запоминается
        в этом браузере.
      </p>
    </div>
  );
};

/* ─── Расшифровка ──────────────────────────────────────────────────── */

const TranscriptTab = ({ episode }: { episode: Episode }) => {
  const { cues, cueIndex, seek } = usePlayer();
  const [q, setQ] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [follow, setFollow] = useState(true);

  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return cues;
    return cues.filter((c) => c.text.toLowerCase().includes(needle));
  }, [cues, q]);

  // Ведём список за звучащей строкой — но только пока человек сам не
  // начал листать: иначе чтение вперёд отматывало бы его назад.
  useEffect(() => {
    if (!follow || q) return;
    activeRef.current?.scrollIntoView({
      block: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [cueIndex, follow, q]);

  if (!episode.hasTranscript) {
    return (
      <p className="px-1 py-8 text-center text-sm leading-relaxed" style={{ color: C.t3 }}>
        У этого выпуска нет расшифровки.<br/>
        Её добавляет автор — придумывать текст за него мы не станем.
      </p>
    );
  }
  if (cues.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm" style={{ color: C.t3 }}>
        <Loader2 size={15} className="animate-spin"/> Загружаем расшифровку…
      </div>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 pb-2" style={{ background: C.bg }}>
        <div className="flex flex-1 items-center gap-2 rounded-xl border px-2.5 py-2"
          style={{ background: C.l1, borderColor: C.border }}>
          <Search size={14} style={{ color: C.t3 }}/>
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Найти в расшифровке"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none" style={{ color: C.t1 }}/>
          {q && <button onClick={() => setQ('')} aria-label="Очистить"><X size={14} style={{ color: C.t3 }}/></button>}
        </div>
        <button onClick={() => setFollow((v) => !v)}
          className="shrink-0 rounded-xl border px-2.5 py-2 text-[11px]"
          style={{ background: follow ? C.purpleSoft : C.l1,
            borderColor: follow ? C.purple : C.border,
            color: follow ? C.purple : C.t3 }}>
          Следить
        </button>
      </div>

      {q && (
        <p className="mb-2 px-1 text-[11px]" style={{ color: C.t3 }}>
          {found.length === 0 ? 'Ничего не нашлось' : `Нашлось строк: ${found.length}`}
        </p>
      )}

      <div ref={listRef} className="flex flex-col gap-0.5">
        {found.map((c) => {
          const active = c.idx === cueIndex && !q;
          return (
            <button key={c.idx}
              ref={active ? activeRef : undefined}
              onClick={() => { seek(c.start); setFollow(true); }}
              className="flex gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors"
              style={{ background: active ? C.purpleSoft : 'transparent' }}>
              <span className="shrink-0 pt-0.5 text-[11px] tabular-nums"
                style={{ color: active ? C.purple : C.t3 }}>{fmtTime(c.start)}</span>
              <span className="min-w-0 text-sm leading-relaxed"
                style={{ color: active ? C.t1 : C.t2 }}>
                {c.speaker && <b className="mr-1" style={{ color: C.t3 }}>{c.speaker}:</b>}
                <Highlighted text={c.text} needle={q}/>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** Подсветка найденного. Текст вставляется частями, а не разметкой. */
const Highlighted = ({ text, needle }: { text: string; needle: string }) => {
  const n = needle.trim().toLowerCase();
  if (!n) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  for (;;) {
    const at = rest.toLowerCase().indexOf(n);
    if (at < 0) { parts.push(rest); break; }
    parts.push(rest.slice(0, at));
    parts.push(<mark key={key++} style={{ background: C.purpleSoft, color: C.t1 }}>{rest.slice(at, at + n.length)}</mark>);
    rest = rest.slice(at + n.length);
  }
  return <>{parts}</>;
};

/* ─── Пересказ ─────────────────────────────────────────────────────── */

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mb-4">
    <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: C.purple }}>{title}</h4>
    {children}
  </div>
);

const SummaryTab = ({ episode }: { episode: Episode }) => {
  const seek = usePlayer((s) => s.seek);
  const [state, setState] = useState<{ summary: Summary | null; reason?: string | null; canBuild?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState(null); setFailed(null);
    void apiSummary(episode.id).then((r) => { if (alive) setState(r); });
    return () => { alive = false; };
  }, [episode.id]);

  const build = async () => {
    setBusy(true); setFailed(null);
    const r = await apiBuildSummary(episode.id);
    setBusy(false);
    if (r.ok) setState({ summary: r.summary });
    else setFailed(r.reason);
  };

  if (!state) {
    return <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin" style={{ color: C.t3 }}/></div>;
  }

  const S = state.summary;
  if (!S) {
    const why = state.reason === 'no_transcript'
      ? 'Пересказ делается по расшифровке выпуска. У этого выпуска её пока нет, а выдумывать содержание мы не станем.'
      : state.reason === 'ai_not_configured'
        ? 'Пересказ на этом сервере не настроен: владелец ещё не подключил языковую модель.'
        : 'Пересказа пока нет.';
    return (
      <div className="py-6 text-center">
        <Sparkles size={26} style={{ color: C.t3, margin: '0 auto 10px' }}/>
        <p className="mx-auto mb-4 max-w-xs text-sm leading-relaxed" style={{ color: C.t3 }}>{why}</p>
        {state.canBuild && (
          <button onClick={build} disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
            style={{ background: C.purple, opacity: busy ? 0.6 : 1 }}>
            {busy ? <Loader2 size={15} className="animate-spin"/> : <Sparkles size={15}/>}
            {busy ? 'Составляем…' : 'Составить пересказ'}
          </button>
        )}
        {failed && (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px]" style={{ color: '#f59e0b' }}>
            <AlertTriangle size={13}/>{failed}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="pb-4">
      {S.partial && (
        <p className="mb-3 rounded-xl px-3 py-2 text-[11px] leading-snug"
          style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
          Расшифровка длиннее одного запроса: пересказ составлен по её началу
          {S.coveredCues && S.totalCues ? ` — ${S.coveredCues} строк из ${S.totalCues}` : ''}.
        </p>
      )}

      {S.short && <Section title="Кратко"><p className="text-sm leading-relaxed" style={{ color: C.t1 }}>{S.short}</p></Section>}

      {S.main?.length > 0 && (
        <Section title="Главное">
          <ul className="flex flex-col gap-1.5">
            {S.main.map((m, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed" style={{ color: C.t2 }}>
                <span style={{ color: C.purple }}>•</span>{m}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {S.topics?.length > 0 && (
        <Section title="По темам">
          <div className="flex flex-col gap-2.5">
            {S.topics.map((t, i) => (
              <div key={i} className="rounded-xl border p-3" style={{ background: C.l1, borderColor: C.border }}>
                {t.title && <div className="mb-1 text-[13px] font-semibold" style={{ color: C.t1 }}>{t.title}</div>}
                {t.text && <div className="text-[13px] leading-relaxed" style={{ color: C.t2 }}>{t.text}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {S.timecodes?.length > 0 && (
        <Section title="Таймкоды">
          <div className="flex flex-col gap-0.5">
            {S.timecodes.map((t, i) => (
              <button key={i} onClick={() => seek(t.time)}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left">
                <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={{ background: C.purpleSoft, color: C.purple }}>{fmtTime(t.time)}</span>
                <span className="min-w-0 text-[13px]" style={{ color: C.t2 }}>{t.title}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {S.audience && <Section title="Для кого"><p className="text-sm leading-relaxed" style={{ color: C.t2 }}>{S.audience}</p></Section>}

      {S.takeaways?.length > 0 && (
        <Section title="Важные выводы">
          <ul className="flex flex-col gap-1.5">
            {S.takeaways.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed" style={{ color: C.t2 }}>
                <span style={{ color: C.purple }}>→</span>{t}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="mt-2 text-[11px] leading-snug" style={{ color: C.t3 }}>
        Составлено по расшифровке выпуска. Ничего сверх сказанного в нём здесь нет.
      </p>
    </div>
  );
};

/* ─── Похожие выпуски ──────────────────────────────────────────────── */

/**
 * Сначала из той же передачи, потом из той же темы. Сходство считает
 * сервер по тому, что знает; выдумывать «похожесть» мы не умеем и не
 * делаем вид.
 */
const Similar = ({ episode }: { episode: Episode }) => {
  const play = usePlayer((s) => s.play);
  const [list, setList] = useState<Episode[]>([]);

  useEffect(() => {
    let alive = true;
    setList([]);
    void apiSimilar(episode.id).then((r) => { if (alive) setList(r); });
    return () => { alive = false; };
  }, [episode.id]);

  if (list.length === 0) return null;
  return (
    <div className="mt-5">
      <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: C.purple }}>
        Похожие выпуски
      </h4>
      <div className="flex flex-col gap-0.5">
        {list.map((e) => (
          <button key={e.id} onClick={() => void play(e)}
            className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-left">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg"
              style={{ background: e.accent ?? C.purple }}>
              {e.hasCover
                ? <img src={epCoverUrl(e.id)} alt="" loading="lazy" className="h-full w-full object-cover"/>
                : <Headphones size={14} className="text-white/75"/>}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px]" style={{ color: C.t1 }}>{e.title}</span>
              <span className="block truncate text-[10.5px]" style={{ color: C.t3 }}>
                {e.podcastTitle} · {fmtDuration(e.duration)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

/* ─── Главы ────────────────────────────────────────────────────────── */

const ChaptersTab = () => {
  const { chapters, currentTime, seek } = usePlayer();
  if (chapters.length === 0) {
    return <p className="py-8 text-center text-sm" style={{ color: C.t3 }}>Автор не размечал выпуск на главы.</p>;
  }
  return (
    <div className="flex flex-col gap-0.5 pb-4">
      {chapters.map((ch, i) => {
        const next = chapters[i + 1]?.start ?? Infinity;
        const active = currentTime >= ch.start && currentTime < next;
        return (
          <button key={ch.start} onClick={() => seek(ch.start)}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
            style={{ background: active ? C.purpleSoft : 'transparent' }}>
            <span className="shrink-0 text-[11px] tabular-nums" style={{ color: active ? C.purple : C.t3 }}>
              {fmtTime(ch.start)}
            </span>
            <span className="min-w-0 text-sm" style={{ color: active ? C.t1 : C.t2 }}>{ch.title}</span>
          </button>
        );
      })}
    </div>
  );
};

/* ─── Свёрнутый проигрыватель ──────────────────────────────────────── */

export const PodcastMiniPlayer = () => {
  const { episode, playing, waiting, toggle, setExpanded, close, error } = usePlayer();
  if (!episode) return null;

  return (
    <motion.div
      initial={prefersReducedMotion() ? false : { y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={prefersReducedMotion() ? undefined : { y: 60, opacity: 0 }}
      className="pointer-events-auto mx-auto w-full max-w-[720px] overflow-hidden rounded-2xl border shadow-2xl"
      style={{
        background: 'rgba(20,20,26,0.86)',
        backdropFilter: 'blur(20px) saturate(160%)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%)',
        borderColor: 'rgba(255,255,255,0.1)',
      }}>
      <div className="px-3 pt-0.5"><Scrubber compact/></div>
      <div className="flex items-center gap-3 px-3 pb-2.5">
        <button onClick={() => setExpanded(true)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Развернуть проигрыватель">
          <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl"
            style={{ background: episode.accent ?? C.purple }}>
            {episode.hasCover
              ? <img src={epCoverUrl(episode.id)} alt="" className="h-full w-full object-cover"/>
              : <Headphones size={17} className="text-white"/>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold" style={{ color: C.t1 }}>{episode.title}</div>
            <div className="truncate text-[11px]" style={{ color: error ? '#f59e0b' : C.t3 }}>
              {error ?? episode.podcastTitle ?? 'Sky Podcasts'}
            </div>
          </div>
        </button>

        <button onClick={toggle} aria-label={playing ? 'Пауза' : 'Слушать'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: C.purple }}>
          {waiting ? <Loader2 size={16} className="animate-spin text-white"/>
            : playing ? <Pause size={16} className="text-white"/> : <Play size={16} className="ml-0.5 text-white"/>}
        </button>
        <button onClick={close} aria-label="Закрыть проигрыватель"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full">
          <X size={15} style={{ color: C.t3 }}/>
        </button>
      </div>
    </motion.div>
  );
};

/* ─── Развёрнутый проигрыватель ────────────────────────────────────── */

type Tab = 'about' | 'transcript' | 'summary' | 'chapters';

export const PodcastFullPlayer = () => {
  const {
    episode, mode, playing, waiting, error, rate, volume, muted,
    toggle, skip, setRate, setVolume, setMuted, setMode, setExpanded, attachVideo,
  } = usePlayer();
  const [tab, setTab] = useState<Tab>('about');
  const [showRates, setShowRates] = useState(false);
  const [showCueSettings, setShowCueSettings] = useState(false);
  const [fav, setFav] = useState(episode?.favorite === true);
  const slotRef = useRef<HTMLDivElement>(null);

  // Картинку видео переносим в этот ящик, а при уходе с экрана
  // возвращаем на место: элемент один и тот же, звук не прерывается.
  useEffect(() => {
    if (mode !== 'video') return undefined;
    attachVideo(slotRef.current);
    return () => attachVideo(null);
  }, [mode, attachVideo, episode?.id]);

  useEffect(() => { setFav(episode?.favorite === true); }, [episode?.id, episode?.favorite]);

  // Пробел и стрелки — как в любом проигрывателе. Если человек пишет в
  // поле, клавиши принадлежат полю, а не нам.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); skip(-15); }
      if (e.code === 'ArrowRight') { e.preventDefault(); skip(30); }
      if (e.code === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, skip, setExpanded]);

  if (!episode) return null;

  const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
    { id: 'about', label: 'Выпуск', icon: List },
    { id: 'transcript', label: 'Расшифровка', icon: FileText },
    { id: 'summary', label: 'Пересказ', icon: Sparkles },
    { id: 'chapters', label: 'Главы', icon: List },
  ];

  const toggleFav = async () => {
    const next = !fav;
    setFav(next);
    const r = await apiSetFavorite({ episodeId: episode.id }, next);
    // Сервер — источник правды: не получилось, значит не получилось.
    if (!r) setFav(!next);
  };

  return (
    <motion.div
      initial={prefersReducedMotion() ? false : { y: '100%' }}
      animate={{ y: 0 }}
      exit={prefersReducedMotion() ? undefined : { y: '100%' }}
      transition={{ type: 'spring', damping: 32, stiffness: 320 }}
      className="fixed inset-0 z-[70] flex flex-col"
      style={{ background: C.bg }}>

      {/* Небо за проигрывателем: то же, что на главной подкастов. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.22), transparent 70%)' }}/>
        <div className="absolute -bottom-16 right-0 h-72 w-72 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(79,110,247,0.16), transparent 70%)' }}/>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 pt-3">
        {/* Шапка */}
        <div className="mb-3 flex items-center justify-between">
          <button onClick={() => setExpanded(false)} aria-label="Свернуть"
            className="grid h-9 w-9 place-items-center rounded-full" style={{ background: C.l1 }}>
            <ChevronDown size={18} style={{ color: C.t2 }}/>
          </button>
          <span className="truncate px-3 text-[12px]" style={{ color: C.t3 }}>{episode.podcastTitle}</span>
          <button onClick={toggleFav} aria-label="В избранное"
            className="grid h-9 w-9 place-items-center rounded-full" style={{ background: C.l1 }}>
            <Heart size={16} style={{ color: fav ? '#ef4444' : C.t3 }} fill={fav ? '#ef4444' : 'none'}/>
          </button>
        </div>

        {/* Картинка или обложка */}
        <div className="mx-auto mb-4 w-full max-w-[380px]">
          <div className="relative overflow-hidden rounded-3xl"
            style={{ aspectRatio: mode === 'video' ? '16 / 9' : '1 / 1', background: episode.accent ?? C.purple,
              maxWidth: '100%' }}>
            {mode === 'video'
              ? <div ref={slotRef} className="h-full w-full"/>
              : episode.hasCover
                ? <img src={epCoverUrl(episode.id)} alt="" className="h-full w-full object-cover"/>
                : <div className="grid h-full w-full place-items-center"><Headphones size={54} className="text-white/70"/></div>}
            <CueOverlay/>
            {waiting && !error && (
              <div className="absolute inset-0 grid place-items-center" style={{ background: 'rgba(0,0,0,0.35)' }}>
                <Loader2 size={26} className="animate-spin text-white"/>
              </div>
            )}
          </div>
        </div>

        {/* Название */}
        <h2 className="mb-1 text-center text-[17px] font-bold leading-snug" style={{ color: C.t1 }}>
          {episode.title}
        </h2>
        {episode.number ? (
          <p className="mb-3 text-center text-[12px]" style={{ color: C.t3 }}>Выпуск {episode.number}</p>
        ) : <div className="mb-3"/>}

        {error && (
          <div className="mx-auto mb-3 flex max-w-sm items-center gap-2 rounded-xl px-3 py-2 text-[12px]"
            style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
            <AlertTriangle size={14} className="shrink-0"/>{error}
          </div>
        )}

        <Scrubber/>

        {/* Управление */}
        <div className="mb-3 mt-1 flex items-center justify-center gap-5">
          <button onClick={() => skip(-15)} aria-label="Назад на 15 секунд"
            className="relative grid h-11 w-11 place-items-center rounded-full" style={{ background: C.l1 }}>
            <SkipBack size={17} style={{ color: C.t2 }}/>
            <span className="absolute bottom-0.5 text-[8px] font-bold" style={{ color: C.t3 }}>15</span>
          </button>
          <button onClick={toggle} aria-label={playing ? 'Пауза' : 'Слушать'}
            className="grid h-16 w-16 place-items-center rounded-full shadow-lg"
            style={{ background: `linear-gradient(135deg, ${C.purple}, #7c3aed)` }}>
            {waiting ? <Loader2 size={24} className="animate-spin text-white"/>
              : playing ? <Pause size={26} className="text-white"/> : <Play size={26} className="ml-1 text-white"/>}
          </button>
          <button onClick={() => skip(30)} aria-label="Вперёд на 30 секунд"
            className="relative grid h-11 w-11 place-items-center rounded-full" style={{ background: C.l1 }}>
            <SkipForward size={17} style={{ color: C.t2 }}/>
            <span className="absolute bottom-0.5 text-[8px] font-bold" style={{ color: C.t3 }}>30</span>
          </button>
        </div>

        {/* Скорость, звук, титры, вид */}
        <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
          <div className="relative">
            <button onClick={() => setShowRates((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold"
              style={{ background: C.l1, color: C.t2 }}>
              <Gauge size={13}/>{rate}×
            </button>
            {showRates && (
              <div className="absolute bottom-full left-0 z-20 mb-1 flex flex-col overflow-hidden rounded-xl border"
                style={{ background: C.l1, borderColor: C.border }}>
                {PLAY_RATES.map((r) => (
                  <button key={r} onClick={() => { setRate(r); setShowRates(false); }}
                    className="px-4 py-1.5 text-[12px]"
                    style={{ color: r === rate ? C.purple : C.t2, background: r === rate ? C.purpleSoft : 'transparent' }}>
                    {r}×
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 rounded-xl px-3 py-1.5" style={{ background: C.l1 }}>
            <button onClick={() => setMuted(!muted)} aria-label={muted ? 'Включить звук' : 'Выключить звук'}>
              {muted || volume === 0 ? <VolumeX size={13} style={{ color: C.t3 }}/> : <Volume2 size={13} style={{ color: C.t2 }}/>}
            </button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
              aria-label="Громкость" className="w-16"
              onChange={(e) => setVolume(Number(e.target.value))}/>
          </div>

          {episode.hasTranscript && (
            <button onClick={() => setShowCueSettings((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px]"
              style={{ background: C.l1, color: C.t2 }}>
              <Subtitles size={13}/>Титры
            </button>
          )}

          {/* Переключение вида — только когда есть и звук, и видео. */}
          {episode.hasAudio && episode.hasVideo && (
            <div className="flex overflow-hidden rounded-xl" style={{ background: C.l1 }}>
              {(['audio', 'video'] as PlayMode[]).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px]"
                  style={{ background: mode === m ? C.purpleSoft : 'transparent',
                    color: mode === m ? C.purple : C.t3 }}>
                  {m === 'audio' ? <Headphones size={13}/> : <Video size={13}/>}
                  {m === 'audio' ? 'Слушать' : 'Смотреть'}
                </button>
              ))}
            </div>
          )}
        </div>

        {showCueSettings && (
          <div className="mx-auto mb-4 w-full max-w-sm"><CueSettings onClose={() => setShowCueSettings(false)}/></div>
        )}

        {/* Вкладки */}
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium"
              style={{ background: tab === t.id ? C.purpleSoft : C.l1,
                color: tab === t.id ? C.purple : C.t3 }}>
              <t.icon size={13}/>{t.label}
            </button>
          ))}
        </div>

        <div className="min-h-[120px]">
          {tab === 'about' && (
            <div className="pb-4">
              {episode.description
                ? <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: C.t2 }}>{episode.description}</p>
                : <p className="py-6 text-center text-sm" style={{ color: C.t3 }}>Автор не добавил описание.</p>}
              <div className="mt-4 flex flex-wrap gap-2 text-[11px]" style={{ color: C.t3 }}>
                <span className="rounded-lg px-2 py-1" style={{ background: C.l1 }}>{fmtTime(episode.duration)}</span>
                <span className="rounded-lg px-2 py-1" style={{ background: C.l1 }}>{episode.plays} прослушиваний</span>
                {episode.hasVideo && <span className="rounded-lg px-2 py-1" style={{ background: C.l1 }}>С видео</span>}
                {episode.explicit && <span className="rounded-lg px-2 py-1" style={{ background: C.l1 }}>18+</span>}
              </div>
              <Similar episode={episode}/>
            </div>
          )}
          {tab === 'transcript' && <TranscriptTab episode={episode}/>}
          {tab === 'summary' && <SummaryTab episode={episode}/>}
          {tab === 'chapters' && <ChaptersTab/>}
        </div>
      </div>
    </motion.div>
  );
};

/**
 * Единственное место, где проигрыватель появляется на экране.
 *
 * Монтируется один раз в оболочке приложения, а не внутри подкастов:
 * иначе уход в другой модуль уносил бы с собой и полоску снизу.
 */
export const PodcastPlayerHost = () => {
  const episode = usePlayer((s) => s.episode);
  const expanded = usePlayer((s) => s.expanded);
  return (
    <>
      <AnimatePresence>{episode && expanded && <PodcastFullPlayer key="full"/>}</AnimatePresence>
      <AnimatePresence>
        {episode && !expanded && (
          <div key="mini" className="pointer-events-none fixed inset-x-0 bottom-[72px] z-[60] px-3">
            <PodcastMiniPlayer/>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
