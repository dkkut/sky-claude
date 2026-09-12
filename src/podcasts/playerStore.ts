/**
 * Проигрыватель подкастов: один на всё приложение.
 *
 * Главное решение этого файла: звучащий элемент живёт вне React.
 *
 * Если <audio> отрисовывать внутри экрана, то уход с экрана размонтирует
 * его вместе со звуком — а подкаст для того и слушают, чтобы уйти
 * листать другое. Поэтому элемент создаётся здесь, руками, живёт в
 * модуле и переживает любую перерисовку. Экраны им только управляют.
 *
 * Из этого же следует второе: элемент ровно один. Не «мы стараемся не
 * включать два» — их физически неоткуда взять. Когда выпуск с видео
 * сменяется звуковым, прежний элемент останавливается, его источник
 * снимается и он выбрасывается, и только потом появляется новый. Два
 * одновременно звучащих куска — самая частая поломка проигрывателей, и
 * лечится она не проверками, а тем, что второго элемента не существует.
 *
 * Картинка видео показывается там, где экран для неё даст место:
 * элемент переносится в этот ящик и возвращается обратно, когда ящик
 * пропадает. При переносе воспроизведение не прерывается — браузер
 * сохраняет состояние элемента при перемещении по дереву.
 *
 * Позиция уходит на сервер: и раз в десять секунд, и на паузе, и при
 * уходе со страницы. Продолжают слушать с телефона там, где бросили на
 * компьютере, поэтому место хранения — сервер, а не этот браузер.
 */
import { create } from 'zustand';
import {
  apiSetProgress, apiPlayed, apiTranscript, apiChapters, apiMediaTicket,
  audioUrl, videoUrl, epCoverUrl,
  type Episode, type Cue, type Chapter,
} from './podcastApi';
import { usePlayerStore as useMusicPlayer } from '@/player/playerStore';

export type PlayMode = 'audio' | 'video';

/** Настройки субтитров — единственное, что хранится в самом браузере. */
export interface CueStyle {
  on: boolean;
  /** Кегль в процентах от обычного. */
  size: number;
  /** Подложка под текстом: без неё титры теряются на светлом кадре. */
  background: boolean;
}

const STYLE_KEY = 'sky.podcasts.cue-style';

const readStyle = (): CueStyle => {
  const fallback: CueStyle = { on: true, size: 100, background: true };
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return {
      on: v?.on !== false,
      size: Math.max(70, Math.min(180, Number(v?.size) || 100)),
      background: v?.background !== false,
    };
  } catch {
    // Приватное окно или запрещённые данные сайта — не повод падать.
    return fallback;
  }
};

const writeStyle = (s: CueStyle) => {
  try { localStorage.setItem(STYLE_KEY, JSON.stringify(s)); } catch { /* переживём */ }
};

/* ─── Единственный элемент ─────────────────────────────────────────── */

let element: HTMLMediaElement | null = null;
let elementKind: PlayMode | null = null;
/** Куда сейчас вставлена картинка видео. null — нигде, висит в стороне. */
let videoSlot: HTMLElement | null = null;
/** Запасной ящик: элемент должен быть в документе, иначе Safari его глушит. */
let parking: HTMLElement | null = null;

const getParking = () => {
  if (parking) return parking;
  parking = document.createElement('div');
  // Невидимо и вне потока: элемент в документе, но никому не мешает.
  parking.setAttribute('data-podcast-parking', '');
  parking.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:0';
  document.body.appendChild(parking);
  return parking;
};

const destroyElement = () => {
  if (!element) return;
  try {
    element.pause();
    // Снимаем источник и просим браузер забыть о нём: иначе загрузка
    // продолжается в фоне, и это и трафик, и память.
    element.removeAttribute('src');
    element.load();
    element.remove();
  } catch { /* элемент уже мог уйти */ }
  element = null;
  elementKind = null;
};

/* ─── Состояние ────────────────────────────────────────────────────── */

interface PlayerState {
  episode: Episode | null;
  mode: PlayMode;
  playing: boolean;
  /** Ждём данных: полоса должна честно показывать ожидание. */
  waiting: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  rate: number;
  error: string | null;
  /** Развёрнут во весь экран или свёрнут в полоску внизу. */
  expanded: boolean;
  cues: Cue[];
  chapters: Chapter[];
  /** Номер текущей реплики — по нему подсвечивают строку расшифровки. */
  cueIndex: number;
  cueStyle: CueStyle;

  play: (ep: Episode, opts?: { mode?: PlayMode; at?: number }) => Promise<void>;
  toggle: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  skip: (delta: number) => void;
  setRate: (r: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  setMode: (m: PlayMode) => void;
  setExpanded: (v: boolean) => void;
  setCueStyle: (patch: Partial<CueStyle>) => void;
  close: () => void;
  /** Экран отдаёт ящик под картинку; null — забрать обратно. */
  attachVideo: (slot: HTMLElement | null) => void;
}

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
export const PLAY_RATES = RATES;

/** Как часто позиция уходит на сервер во время прослушивания. */
const FLUSH_EVERY_MS = 10_000;
let lastFlush = 0;

const MEDIA_ERRORS: Record<number, string> = {
  1: 'Воспроизведение прервано',
  2: 'Связь оборвалась — проверьте сеть',
  3: 'Файл не читается',
  4: 'Этот файл браузер открыть не может',
};

export const usePlayer = create<PlayerState>((set, get) => {
  /** Отправка позиции на сервер. Своя, чтобы звать из разных мест. */
  const flush = (force = false) => {
    const { episode, currentTime, duration } = get();
    if (!episode || currentTime <= 0) return;
    const now = Date.now();
    if (!force && now - lastFlush < FLUSH_EVERY_MS) return;
    lastFlush = now;
    void apiSetProgress(episode.id, currentTime, duration || episode.duration);
  };

  /** Какая реплика звучит сейчас. */
  const cueAt = (cues: Cue[], t: number) => {
    // Поиск делением пополам: расшифровка часового выпуска — это тысячи
    // строк, и перебирать их по таймеру четыре раза в секунду заметно.
    let lo = 0; let hi = cues.length - 1; let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (found >= 0 && cues[found].end < t - 0.2) return -1;
    return found;
  };

  const bind = (el: HTMLMediaElement) => {
    el.addEventListener('timeupdate', () => {
      const t = el.currentTime;
      const { cues, cueIndex } = get();
      const idx = cues.length ? cueAt(cues, t) : -1;
      set(idx === cueIndex ? { currentTime: t } : { currentTime: t, cueIndex: idx });
      flush();
    });
    el.addEventListener('durationchange', () => {
      if (Number.isFinite(el.duration)) set({ duration: el.duration });
    });
    el.addEventListener('progress', () => {
      try {
        const b = el.buffered;
        set({ buffered: b.length ? b.end(b.length - 1) : 0 });
      } catch { /* пусто */ }
    });
    el.addEventListener('play', () => set({ playing: true, error: null }));
    el.addEventListener('pause', () => { set({ playing: false }); flush(true); });
    el.addEventListener('waiting', () => set({ waiting: true }));
    el.addEventListener('playing', () => set({ waiting: false, error: null }));
    el.addEventListener('canplay', () => set({ waiting: false }));
    el.addEventListener('ended', () => {
      const { episode, duration } = get();
      set({ playing: false });
      if (episode) void apiSetProgress(episode.id, duration || episode.duration, duration || episode.duration, true);
    });
    el.addEventListener('error', () => {
      const code = (el.error?.code ?? 0) as number;
      set({
        playing: false,
        waiting: false,
        // Честная причина вместо пустой полосы: человек должен понимать,
        // что случилось, а не смотреть на замерший проигрыватель.
        error: MEDIA_ERRORS[code] ?? 'Выпуск не воспроизводится',
      });
    });
  };

  /** Создать элемент нужного вида. Прежний при этом уходит целиком. */
  const makeElement = (kind: PlayMode) => {
    destroyElement();
    const el = kind === 'video'
      ? document.createElement('video')
      : document.createElement('audio');
    el.preload = 'metadata';
    el.crossOrigin = 'use-credentials';
    el.setAttribute('playsinline', '');
    el.setAttribute('data-podcast-media', kind);
    if (kind === 'video') {
      const v = el as HTMLVideoElement;
      v.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;display:block';
    }
    const { volume, muted, rate } = get();
    el.volume = volume;
    el.muted = muted;
    el.playbackRate = rate;
    bind(el);
    (videoSlot && kind === 'video' ? videoSlot : getParking()).appendChild(el);
    element = el;
    elementKind = kind;
    return el;
  };

  /** Управление с экрана блокировки и с наушников. */
  const setMediaSession = (ep: Episode) => {
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (!ms) return;
    try {
      ms.metadata = new MediaMetadata({
        title: ep.title,
        artist: ep.podcastTitle ?? 'Sky Podcasts',
        album: 'Sky Podcasts',
        artwork: ep.hasCover ? [{ src: epCoverUrl(ep.id), sizes: '512x512' }] : [],
      });
      ms.setActionHandler('play', () => get().toggle());
      ms.setActionHandler('pause', () => get().pause());
      ms.setActionHandler('seekbackward', () => get().skip(-15));
      ms.setActionHandler('seekforward', () => get().skip(30));
    } catch { /* не везде есть */ }
  };

  return {
    episode: null,
    mode: 'audio',
    playing: false,
    waiting: false,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 1,
    muted: false,
    rate: 1,
    error: null,
    expanded: false,
    cues: [],
    chapters: [],
    cueIndex: -1,
    cueStyle: readStyle(),

    play: async (ep, opts = {}) => {
      const prev = get().episode;
      // Уходя с прежнего выпуска, дописываем, где на нём остановились.
      if (prev && prev.id !== ep.id) flush(true);

      // Музыка и подкаст — два разных звука, и звучать вместе они не
      // должны. Музыке отсюда только говорят остановиться: её
      // проигрыватель свой, и лезть в него мы не станем.
      try { useMusicPlayer.getState().setPlaying(false); } catch { /* музыки может не быть */ }

      // Выпуск бывает только звуковым или только видео — выбираем то,
      // что у него есть, а не то, что попросили.
      const wanted = opts.mode ?? (ep.hasVideo ? 'video' : 'audio');
      const mode: PlayMode = wanted === 'video' && ep.hasVideo ? 'video'
        : ep.hasAudio ? 'audio'
          : ep.hasVideo ? 'video' : 'audio';

      if (!ep.hasAudio && !ep.hasVideo) {
        set({ episode: ep, error: 'У этого выпуска ещё нет файла', playing: false });
        return;
      }

      // Пропуск для медиа: теги <audio> и <video> не умеют слать
      // заголовок авторизации.
      await apiMediaTicket();

      set({
        episode: ep,
        mode,
        error: null,
        currentTime: 0,
        duration: ep.duration || 0,
        buffered: 0,
        cues: [],
        chapters: [],
        cueIndex: -1,
        expanded: true,
        waiting: true,
      });

      const el = makeElement(mode);
      el.src = mode === 'video' ? videoUrl(ep.id) : audioUrl(ep.id);

      // Место, с которого продолжить. Позиция пришла с сервера, поэтому
      // это то же место, на котором остановились на другом устройстве.
      const at = opts.at ?? (ep.completed ? 0 : ep.position ?? 0);
      if (at > 0) {
        const jump = () => { try { el.currentTime = at; } catch { /* рано */ } };
        el.addEventListener('loadedmetadata', jump, { once: true });
      }

      setMediaSession(ep);
      try {
        await el.play();
      } catch {
        // Браузер не дал начать без действия человека — это не ошибка
        // выпуска, поэтому красным её показывать нельзя.
        set({ playing: false, waiting: false });
      }
      void apiPlayed(ep.id);

      // Расшифровка и главы — отдельными запросами: без них слушать
      // можно, и ждать их незачем.
      if (ep.hasTranscript) {
        void apiTranscript(ep.id).then((cues) => {
          if (get().episode?.id === ep.id && cues) set({ cues });
        });
      }
      void apiChapters(ep.id).then((chapters) => {
        if (get().episode?.id === ep.id && chapters.length) set({ chapters });
      });
    },

    toggle: () => {
      if (!element) return;
      if (element.paused) {
        void element.play().catch(() => set({ playing: false }));
      } else {
        element.pause();
      }
    },

    pause: () => { element?.pause(); },

    seek: (sec) => {
      if (!element) return;
      const max = get().duration || element.duration || 0;
      const t = Math.max(0, Math.min(sec, max > 0 ? max - 0.2 : sec));
      try { element.currentTime = t; set({ currentTime: t }); } catch { /* ещё не готов */ }
    },

    skip: (delta) => { get().seek(get().currentTime + delta); },

    setRate: (r) => {
      const rate = Math.max(0.5, Math.min(3, r));
      if (element) element.playbackRate = rate;
      set({ rate });
    },

    setVolume: (v) => {
      const volume = Math.max(0, Math.min(1, v));
      if (element) { element.volume = volume; element.muted = volume === 0; }
      set({ volume, muted: volume === 0 });
    },

    setMuted: (m) => { if (element) element.muted = m; set({ muted: m }); },

    /**
     * Переключение «слушать / смотреть» у выпуска, где есть и то и
     * другое. Элемент пересоздаётся, потому что <audio> не показывает
     * картинку, а <video> для одного звука тяжелее; место и скорость
     * переносятся, чтобы для человека ничего не сбилось.
     */
    setMode: (m) => {
      const { episode, mode, currentTime, playing } = get();
      if (!episode || m === mode) return;
      if (m === 'video' && !episode.hasVideo) return;
      if (m === 'audio' && !episode.hasAudio) return;

      const el = makeElement(m);
      el.src = m === 'video' ? videoUrl(episode.id) : audioUrl(episode.id);
      el.addEventListener('loadedmetadata', () => {
        try { el.currentTime = currentTime; } catch { /* пусто */ }
        if (playing) void el.play().catch(() => { /* без действия человека */ });
      }, { once: true });
      set({ mode: m });
    },

    setExpanded: (v) => set({ expanded: v }),

    setCueStyle: (patch) => {
      const next = { ...get().cueStyle, ...patch };
      writeStyle(next);
      set({ cueStyle: next });
    },

    close: () => {
      flush(true);
      destroyElement();
      set({
        episode: null, playing: false, waiting: false, currentTime: 0, duration: 0,
        buffered: 0, cues: [], chapters: [], cueIndex: -1, error: null, expanded: false,
      });
    },

    attachVideo: (slot) => {
      videoSlot = slot;
      if (!element || elementKind !== 'video') return;
      // Перенос по дереву не прерывает воспроизведение — браузер
      // сохраняет состояние элемента.
      (slot ?? getParking()).appendChild(element);
    },
  };
});

/**
 * Позиция должна пережить закрытие вкладки.
 *
 * visibilitychange — потому что на телефоне вкладку не закрывают, её
 * прячут, и pagehide там приходит не всегда.
 */
if (typeof window !== 'undefined') {
  const dump = () => {
    const { episode, currentTime, duration } = usePlayer.getState();
    if (episode && currentTime > 0) {
      void apiSetProgress(episode.id, currentTime, duration || episode.duration);
    }
  };
  window.addEventListener('pagehide', dump);
  document.addEventListener('visibilitychange', () => { if (document.hidden) dump(); });
}

/** Текущая реплика — для титров и подсветки расшифровки. */
export const currentCue = (cues: Cue[], idx: number) => (idx >= 0 ? cues[idx] : null);

/** Уважаем настройку «поменьше движения» в системе. */
export const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
