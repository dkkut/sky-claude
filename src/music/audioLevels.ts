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
  fx: FxNodes;
} | null;

let state: State = null;
/** Пробовали и не смогли — второй раз не пытаемся, чтобы не долбиться каждый кадр. */
let failed = false;
let lastTry = 0;

/**
 * iPhone/iPad: после createMediaElementSource звук идёт ТОЛЬКО через Web Audio, а контекст
 * там создаётся приостановленным и «просыпается» лишь от касания; звонок или режим «без
 * звука» усыпляют его снова. Результат — музыка «играет», но тишина. Визуализация не стоит
 * молчащего плеера, поэтому на этих устройствах граф не строим вовсе: сфера просто дышит.
 */
const IS_IOS = typeof navigator !== 'undefined'
  && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1));

const AudioCtx: typeof AudioContext | undefined =
  typeof window !== 'undefined'
    ? (window.AudioContext ?? (window as any).webkitAudioContext)
    : undefined;

/**
 * Подключение к элементу. Возвращает false, если Web Audio недоступен
 * или элемента ещё нет — тогда визуализация работает без звука.
 */
/* ─── Эквалайзер и профиль звука ──────────────────────────────────── */

import { getFx, subscribeFx, type FxSettings, EQ_FREQS, PROFILES } from './audioFx';

type FxNodes = { pre: GainNode; bands: BiquadFilterNode[]; comp: DynamicsCompressorNode };

/** Приводит узлы графа к настройкам: плоский эквалайзер и «Оригинал» — прозрачный проход без обработки. */
const applyFx = (nodes: FxNodes, fx: FxSettings, ctx: AudioContext) => {
  const t = ctx.currentTime;
  const gains = fx.eqOn ? fx.bands : fx.bands.map(() => 0);
  gains.forEach((g, i) => nodes.bands[i].gain.setTargetAtTime(g, t, 0.02));
  // Предусиление: срезаем на величину самого большого подъёма, чтобы эквалайзер не приводил к хрипу от перегруза.
  const peak = Math.max(0, ...gains);
  nodes.pre.gain.setTargetAtTime(10 ** (-peak / 20), t, 0.02);
  const p = PROFILES[fx.profile];
  const c = nodes.comp;
  if (!p.comp) {
    // Почти прозрачное состояние: порог выше любого сигнала.
    c.threshold.setTargetAtTime(0, t, 0.02); c.ratio.setTargetAtTime(1, t, 0.02);
    c.knee.setTargetAtTime(0, t, 0.02); c.attack.setTargetAtTime(0.003, t, 0.02); c.release.setTargetAtTime(0.25, t, 0.02);
  } else {
    c.threshold.setTargetAtTime(p.comp.threshold, t, 0.02); c.ratio.setTargetAtTime(p.comp.ratio, t, 0.02);
    c.knee.setTargetAtTime(p.comp.knee, t, 0.02); c.attack.setTargetAtTime(p.comp.attack, t, 0.02); c.release.setTargetAtTime(p.comp.release, t, 0.02);
  }
};

/** Обработка звука нужна, только если включено что-то кроме «ничего»: иначе граф не трогаем. */
export const audioFxSupported = () => !IS_IOS && Boolean(AudioCtx);
export const audioFxLive = () => Boolean(state);

/** Строит граф по запросу эквалайзера (даже когда визуализации нет). Нужно касание страницы — иначе false. */
export const ensureAudioGraph = (): boolean => attach();

const attach = (): boolean => {
  if (state) return true;
  if (failed || IS_IOS || !AudioCtx) return false;

  const el = document.getElementById('sky-player-audio') as HTMLAudioElement | null;
  if (!el) return false;
  // Не чаще раза в две секунды: пока страницу не коснулись, контекст не запускается.
  if (Date.now() - lastTry < 2000) return false;
  lastTry = Date.now();

  try {
    const ctx = new AudioCtx();
    // Приостановленный контекст после createMediaElementSource заглушил бы плеер: подключаем
    // только работающий, иначе пробуем позже (после касания страницы).
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {});
      void ctx.close().catch(() => {});
      return false;
    }
    const source = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    // 1024 точек — достаточно для трёх полос и дёшево на телефоне.
    analyser.fftSize = 1024;
    // Своё сглаживание всё равно есть, но и встроенное лишним не будет.
    analyser.smoothingTimeConstant = 0.75;

    // Цепочка: источник → предусиление → 10 полос → компрессор → анализатор → выход.
    // Обязательно доводим до выхода: без этого звук пропадёт совсем.
    const pre = ctx.createGain();
    const bands = EQ_FREQS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f; b.Q.value = 1.1; b.gain.value = 0;
      return b;
    });
    const comp = ctx.createDynamicsCompressor();
    let node: AudioNode = source;
    node.connect(pre); node = pre;
    for (const b of bands) { node.connect(b); node = b; }
    node.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);

    const fx: FxNodes = { pre, bands, comp };
    state = { ctx, analyser, data: new Uint8Array(analyser.frequencyBinCount), fx };
    applyFx(fx, getFx(), ctx);
    subscribeFx((s) => { if (state) applyFx(state.fx, s, state.ctx); });
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
