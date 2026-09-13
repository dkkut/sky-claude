/**
 * Sky «Вместе»: состояние сессии в браузере и подтягивание плеера.
 *
 * Что здесь есть и чего нет.
 *
 * Есть — зеркало того, что решил сервер: какая сессия открыта, что в
 * ней играет, где сейчас позиция. Зеркало, а не источник: любое
 * действие уходит на сервер и возвращается оттуда событием. Даже своё
 * собственное нажатие на «пауза» этот модуль показывает не сразу, а
 * когда сервер подтвердит, — иначе у нажавшего и у остальных на секунду
 * разное состояние, и именно в эту секунду человек жмёт ещё раз.
 *
 * Нет — второго плеера. Ни <video>, ни <audio> в этой папке не
 * создаётся ни одного. Кино играет тот же проигрыватель Sky Film,
 * музыка — тот же единственный <audio> из PlayerEngine. Отсюда ими
 * только управляют, через ручку (Handle ниже), которую даёт сам плеер.
 *
 * Про время. Позиция приходит парой «сколько было + когда по часам
 * сервера». Часы браузера от серверных отличаются — иногда на секунды,
 * иногда на минуты, и доверять им нельзя. Поэтому расхождение часов
 * измеряется отдельно, обычным обменом «спросил — ответили», и дальше
 * все расчёты идут по времени сервера.
 */
import { create } from 'zustand';
import { wireSendVolatile } from '@/core/wire';
import {
  apiTogetherRead, apiTogetherParticipants, apiTogetherSessions,
  apiTogetherInvitations, explainTogether,
  type TogetherSession, type Playback, type Participant, type Invitation,
} from './togetherApi';

/* ─── Насколько точно держим строй ──────────────────────────────────
   Числа подобраны так, чтобы человек не замечал ни рывков, ни
   расхождения. Полсекунды разницы в кино на слух и на глаз не
   различимы; две секунды — уже заметно.                            */

/** Меньше этого не трогаем вовсе: дёргать плеер ради сотни миллисекунд вредно. */
const DEAD_ZONE_MS = 300;
/** Больше этого — перематываем сразу: плавно догонять полминуты бессмысленно. */
const HARD_SEEK_MS = 2000;
/** Между ними — подгоняем скоростью. На пять процентов ухо не реагирует. */
const NUDGE_RATE = 0.05;
/** Как часто сверяемся с плеером. */
export const TICK_MS = 250;
/** Как часто переспрашиваем сервер, даже когда ничего не происходит. */
export const RESYNC_MS = 10_000;

/**
 * Ручка плеера.
 *
 * Единственное, что «Вместе» умеет делать с чужим проигрывателем.
 * Намеренно короткая: всё, чего здесь нет, остаётся заботой самого
 * плеера — и громкость, и полноэкранный режим, и всё остальное, что у
 * каждого своё.
 */
export interface PlayerHandle {
  /** Текущая позиция в миллисекундах. */
  position: () => number;
  /** Играет ли прямо сейчас. */
  playing: () => boolean;
  seek: (ms: number) => void;
  play: () => void;
  pause: () => void;
  /** Скорость. Используется и для подгонки, и для явной смены. */
  setRate: (r: number) => void;
  /** Перейти к записи из очереди. Для кино не вызывается. */
  setTrack?: (index: number, id: string) => void;
  /** Какая запись сейчас открыта. */
  currentId?: () => string | null;
}

interface TogetherState {
  /** Открытая сессия: то, что сервер рассказал про неё этому человеку. */
  session: TogetherSession | null;
  /** Состояние воспроизведения — общее для всех. */
  playback: Playback | null;
  participants: Participant[];
  invitations: Invitation[];
  /** История и текущие сессии для списка на вкладке. */
  sessions: TogetherSession[];
  /** Расхождение часов: столько прибавить к местному времени, чтобы получить серверное. */
  skewMs: number;
  /** Последняя измеренная задержка кругового обмена. */
  rttMs: number;
  error: string | null;
  loading: boolean;

  setSession: (s: TogetherSession | null) => void;
  setPlayback: (p: Playback) => void;
  setError: (e: string | null) => void;
  refreshSession: (id: string) => Promise<void>;
  refreshParticipants: (id: string) => Promise<void>;
  refreshList: () => Promise<void>;
  refreshInvitations: () => Promise<void>;
  close: () => void;
}

export const useTogetherStore = create<TogetherState>((set, get) => ({
  session: null,
  playback: null,
  participants: [],
  invitations: [],
  sessions: [],
  skewMs: 0,
  rttMs: 0,
  error: null,
  loading: false,

  setSession: (s) => set({
    session: s,
    playback: s ? sessionPlayback(s) : null,
    ...(s ? {} : { participants: [] }),
  }),

  /**
   * Новое состояние от сервера.
   *
   * Отставшее отбрасываем: у каждого состояния есть растущий номер, и
   * событие с номером меньше текущего — это перепутанный сетью порядок
   * или чей-то повтор. Применить его значило бы откатить воспроизведение
   * назад у всех.
   */
  setPlayback: (p) => {
    const cur = get().playback;
    if (cur && p.seq < cur.seq) return;
    set({ playback: p });
  },

  setError: (e) => set({ error: e }),

  refreshSession: async (id) => {
    const r = await apiTogetherRead(id);
    if (!r.ok || !r.data) { set({ error: explainTogether(r.error), session: null, playback: null }); return; }
    set({ session: r.data.session, playback: sessionPlayback(r.data.session), error: null });
  },

  refreshParticipants: async (id) => {
    const r = await apiTogetherParticipants(id);
    if (r.ok && r.data) set({ participants: r.data.participants });
  },

  refreshList: async () => {
    set({ loading: true });
    const r = await apiTogetherSessions();
    set({ sessions: r.ok && r.data ? r.data.sessions : [], loading: false });
  },

  refreshInvitations: async () => {
    const r = await apiTogetherInvitations();
    if (r.ok && r.data) set({ invitations: r.data.invitations });
  },

  close: () => set({ session: null, playback: null, participants: [], error: null }),
}));

/** Из полного вида сессии — только то, что одинаково у всех. */
const sessionPlayback = (s: TogetherSession): Playback => ({
  sessionId: s.id,
  status: s.status,
  queue: s.queue,
  queueIndex: s.queueIndex,
  playing: s.playing,
  positionMs: s.positionMs,
  durationMs: s.durationMs,
  rate: s.rate,
  seq: s.seq,
  serverTime: s.serverTime,
});

/* ─── Отправка команд ───────────────────────────────────────────────
   Команды не копятся в очереди на время обрыва связи. «Пауза на
   12:03», доставленная через две минуты после восстановления, — это не
   запоздавшая пауза, а неверная: к тому моменту все давно смотрят
   дальше. Поэтому отправка «летучая»: нет связи — команда пропадает, а
   строй восстановит ближайшая сверка.                               */

export type Command = 'play' | 'pause' | 'seek' | 'rate' | 'track' | 'next' | 'prev' | 'ended' | 'sync';

/** Когда была отправлена последняя сверка — для измерения задержки. */
let syncSentAt = 0;

export const sendTogether = (sessionId: string, action: Command,
  extra: { positionMs?: number; rate?: number; index?: number } = {}) => {
  if (action === 'sync') syncSentAt = Date.now();
  wireSendVolatile({ type: 'together', payload: { sessionId, action, ...extra } });
};

/* ─── Приём событий ────────────────────────────────────────────────
   Зовётся из socket.ts. Здесь нет ни одной проверки прав — и не должно
   быть: право решил сервер, а браузеру остаётся показать решённое.  */

export const receiveTogether = (type: string, payload: any) => {
  const store = useTogetherStore.getState();

  if (type === 'together-state') {
    const state = payload?.state as Playback | undefined;
    if (!state) return;
    const open = store.session;
    /* События приходят по всем сессиям, где человек состоит; применяем
       только к той, что открыта на экране. Чужое событие, принятое «на
       всякий случай», позже подставило бы не то место в не тот фильм. */
    if (!open) return;
    if (state.sessionId && state.sessionId !== open.id) return;

    /* Расхождение часов меряем только по ответу на собственную сверку:
       у неё известно время отправки, и значит известна половина
       кругового обмена. У события, присланного без спроса, времени
       отправки нет — по нему расхождение считалось бы вместе с
       задержкой доставки. */
    if (payload?.action === 'sync' && syncSentAt) {
      const now = Date.now();
      const rtt = now - syncSentAt;
      syncSentAt = 0;
      /* Ответ, шедший дольше пяти секунд, для измерения бесполезен. */
      if (rtt >= 0 && rtt < 5000) {
        useTogetherStore.setState({ skewMs: state.serverTime - (now - rtt / 2), rttMs: rtt });
      }
    }

    store.setPlayback(state);
    /* Завершение видно прямо в состоянии: сессия перестала быть живой. */
    if (state.status === 'ended' && open) {
      useTogetherStore.setState({ session: { ...open, status: 'ended', playing: false } });
    }
    return;
  }

  if (type === 'together-end') {
    const open = store.session;
    if (open && payload?.sessionId === open.id) {
      useTogetherStore.setState({
        session: { ...open, status: 'ended', playing: false },
        playback: store.playback ? { ...store.playback, status: 'ended', playing: false } : null,
      });
    }
    void store.refreshList();
    return;
  }

  if (type === 'together-join' || type === 'together-leave' || type === 'together-decline') {
    const open = store.session;
    if (open && payload?.sessionId === open.id) {
      void store.refreshParticipants(open.id);
      /* Владение могло перейти — тогда меняются и кнопки. Спрашиваем
         сервер, а не вычисляем сами: своё право не назначают себе. */
      if (payload?.newOwnerId || payload?.removed) void store.refreshSession(open.id);
    }
    void store.refreshList();
    return;
  }

  if (type === 'together-settings') {
    const open = store.session;
    if (open && payload?.sessionId === open.id) void store.refreshSession(open.id);
    return;
  }

  if (type === 'together-invited') {
    void store.refreshInvitations();
    return;
  }

  if (type === 'together-error') {
    useTogetherStore.setState({ error: explainTogether(payload?.error) });
  }
};

/* ─── Где должно быть воспроизведение прямо сейчас ─────────────────── */

/**
 * Позиция, на которой полагается стоять в этот миг.
 *
 * Считается от серверного времени: к позиции из состояния прибавляется
 * то, что прошло по часам сервера с момента, когда состояние было
 * снято. Пока стоит на паузе — не прибавляется ничего.
 */
export const targetPosition = (p: Playback, skewMs: number): number => {
  if (!p.playing || p.status !== 'live') return p.positionMs;
  const serverNow = Date.now() + skewMs;
  const elapsed = Math.max(0, serverNow - p.serverTime);
  const pos = p.positionMs + elapsed * (p.rate || 1);
  return p.durationMs > 0 ? Math.min(pos, p.durationMs) : pos;
};

/**
 * Одно исправление: подтянуть плеер к тому, где ему полагается быть.
 *
 * Три степени, и выбор между ними — вся суть плавности.
 *
 *   · до трети секунды — не трогаем совсем. Плеер и так не стоит на
 *     месте, а постоянная перемотка «ровно в точку» слышна щелчками и
 *     видна подёргиванием.
 *
 *   · до двух секунд — меняем скорость на пять процентов. Отставший
 *     нагоняет за несколько секунд, и ни один человек этого не
 *     замечает: пять процентов не слышно ни в речи, ни в музыке.
 *
 *   · больше — обычная перемотка. Догонять полминуты ускорением
 *     пришлось бы десять минут.
 *
 * Возвращает, насколько разошлись, — для показа в отладке и в тестах.
 */
/**
 * Когда в последний раз пробовали запустить воспроизведение.
 *
 * Браузер вправе не дать звуку заиграть без действия человека, и тогда
 * play() отклоняется. Сверка идёт четыре раза в секунду, и без этой
 * задержки получилось бы четыре отклонённых попытки в секунду — с
 * ошибками в консоли и нагрузкой на ровном месте. Раз в секунду
 * достаточно: как только человек тронет экран, ближайшая попытка
 * пройдёт.
 */
let lastPlayTry = 0;
const PLAY_RETRY_MS = 1000;

export const correctOnce = (handle: PlayerHandle, p: Playback, skewMs: number): number => {
  const want = targetPosition(p, skewMs);
  const have = handle.position();
  const drift = want - have;

  if (p.playing && p.status === 'live') {
    if (!handle.playing() && Date.now() - lastPlayTry > PLAY_RETRY_MS) {
      lastPlayTry = Date.now();
      handle.play();
    }
  } else if (handle.playing()) {
    handle.pause();
  }

  const base = p.rate || 1;
  if (Math.abs(drift) > HARD_SEEK_MS) {
    handle.seek(want);
    handle.setRate(base);
    return drift;
  }
  if (!p.playing || p.status !== 'live') {
    /* На паузе догонять нечем: ставим точно и не трогаем скорость. */
    if (Math.abs(drift) > DEAD_ZONE_MS) handle.seek(want);
    return drift;
  }
  if (Math.abs(drift) > DEAD_ZONE_MS) {
    handle.setRate(drift > 0 ? base * (1 + NUDGE_RATE) : base * (1 - NUDGE_RATE));
  } else {
    handle.setRate(base);
  }
  return drift;
};
