/**
 * Уровни звука для визуализации.
 *
 * Смотрим на тот самый <audio>, который уже играет в PlayerEngine, и не
 * трогаем его: ни src, ни громкость, ни атрибуты. Анализатор
 * подключается один раз за жизнь страницы и никогда не пересоздаётся —
 * createMediaElementSource для одного элемента можно вызвать ровно
 * однажды, второй вызов бросает исключение, а разрыв графа оставил бы
 * элемент без звука. Поэтому здесь одиночка со счётчиком подписчиков:
 * когда смотреть некому, останавливается только цикл опроса, а сам граф
 * живёт дальше.
 *
 * Элемент уже помечен crossOrigin="anonymous" (см. PlayerEngine), значит
 * поток не «отравлен» и анализатор получит настоящие данные, а не нули.
 */

export interface Levels {
  /** 0..1, низ, середина, верх и общий уровень. */
  bass: number;
  mid: number;
  high: number;
  level: number;
  /** Короткий всплеск на ударе: 0..1, гаснет сам. */
  beat: number;
  /** Есть ли вообще данные — иначе сфера просто спокойно дышит. */
  live: boolean;
}

const IDLE: Levels = { bass: 0, mid: 0, high: 0, level: 0, beat: 0, live: false };

type State = {
  ctx: AudioContext;
  analyser: AnalyserNode;
  data: Uint8Array;
} | null;

let state: State = null;
/** Пробовали и не смогли — второй раз не пытаемся, чтобы не долбиться каждый кадр. */
let failed = false;

const AudioCtx: typeof AudioContext | undefined =
  typeof window !== 'undefined'
    ? (window.AudioContext ?? (window as any).webkitAudioContext)
    : undefined;

/**
 * Подключение к элементу. Возвращает false, если Web Audio недоступен
 * или элемента ещё нет — тогда визуализация работает без звука.
 */
const attach = (): boolean => {
  if (state) return true;
  if (failed || !AudioCtx) return false;

  const el = document.getElementById('sky-player-audio') as HTMLAudioElement | null;
  if (!el) return false;

  try {
    const ctx = new AudioCtx();
    const source = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    // 1024 точек — достаточно для трёх полос и дёшево на телефоне.
    analyser.fftSize = 1024;
    // Своё сглаживание всё равно есть, но и встроенное лишним не будет.
    analyser.smoothingTimeConstant = 0.75;

    // Обязательно доводим до выхода: без этого звук пропадёт совсем.
    source.connect(analyser);
    analyser.connect(ctx.destination);

    state = { ctx, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
    return true;
  } catch {
    // Не смогли — звук продолжает играть через обычный путь элемента.
    failed = true;
    return false;
  }
};

/**
 * Контекст создаётся приостановленным, пока не было касания страницы.
 * Будим его при первой возможности — иначе анализатор отдаёт нули.
 */
export const resumeAudioLevels = () => {
  if (state && state.ctx.state === 'suspended') void state.ctx.resume().catch(() => {});
};

/* ─── Сглаживание ──────────────────────────────────────────────────── */

let cur: Levels = { ...IDLE };
let prevBass = 0;

/** Экспоненциальное приближение: чем меньше k, тем плавнее. */
const ease = (from: number, to: number, k: number) => from + (to - from) * k;

const sample = (): Levels => {
  if (!state) return { ...IDLE, live: false };
  const { analyser, data } = state;
  analyser.getByteFrequencyData(data);

  // Полосы по индексам корзин. При 48 кГц и fftSize 1024 одна корзина —
  // примерно 47 Гц, поэтому: низ до ~250 Гц, середина до ~2 кГц, верх выше.
  const avg = (from: number, to: number) => {
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += data[i];
    return sum / Math.max(1, to - from) / 255;
  };

  const bass = avg(1, 6);
  const mid = avg(6, 44);
  const high = avg(44, 160);
  const level = avg(1, 160);

  // Удар — резкий прирост низа. Порог небольшой, но заметно выше шума.
  const jump = bass - prevBass;
  prevBass = bass;
  const beatHit = jump > 0.08 ? Math.min(1, jump * 5) : 0;

  // Вверх реагируем быстрее, вниз — медленнее: так «дышит», а не дёргается.
  cur = {
    bass: ease(cur.bass, bass, bass > cur.bass ? 0.35 : 0.09),
    mid: ease(cur.mid, mid, mid > cur.mid ? 0.25 : 0.08),
    high: ease(cur.high, high, high > cur.high ? 0.3 : 0.12),
    level: ease(cur.level, level, level > cur.level ? 0.3 : 0.08),
    beat: Math.max(beatHit, cur.beat * 0.88),
    live: true,
  };
  return cur;
};

/* ─── Подписка ─────────────────────────────────────────────────────── */

const listeners = new Set<(l: Levels) => void>();
let raf = 0;

const tick = () => {
  raf = requestAnimationFrame(tick);
  const l = sample();
  listeners.forEach((fn) => fn(l));
};

/**
 * Подписаться на уровни. Возвращает отписку: когда слушателей не
 * осталось, цикл останавливается — фоновой работы не остаётся.
 */
export const subscribeAudioLevels = (fn: (l: Levels) => void): (() => void) => {
  attach();
  listeners.add(fn);
  if (!raf) raf = requestAnimationFrame(tick);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      cur = { ...IDLE };
      prevBass = 0;
    }
  };
};

/** Подключён ли анализатор к настоящему звуку. */
export const audioLevelsLive = () => Boolean(state);
