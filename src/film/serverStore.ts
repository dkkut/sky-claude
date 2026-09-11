/**
 * Состояние Sky Film, приходящее с сервера.
 *
 * Каталог и личная коллекция держатся порознь намеренно. Это не
 * удобство показа: сервер отдаёт их разными запросами именно потому,
 * что это разные множества с разными правами. Сложи их в один список —
 * и первая же сортировка или поиск однажды покажет личное там, где его
 * быть не должно. Раздельно ошибиться труднее.
 *
 * Ничего из того, что здесь лежит, не является защитой. Если браузер
 * переписать и попросить чужой фильм — сервер откажет сам.
 */
import { create } from 'zustand';
import {
  apiCatalog, apiCategories, apiMyFilms, apiSavedFilms, apiSetSaved,
  apiContinue, apiProgress, apiSetProgress, apiCountView, apiRateMovie,
  apiUploadMovie, apiPatchMovie, apiDeleteMovie, apiSubmitMovie,
  apiUploadPoster, apiFilmTicket,
  type ServerMovie, type UploadMeta, type CatalogOpts, type MovieProgress,
} from './filmApi';

interface FilmState {
  /** Общий каталог: только опубликованное. */
  catalog: ServerMovie[];
  /** Личная коллекция: всё своё, в любом состоянии. */
  mine: ServerMovie[];
  saved: ServerMovie[];
  continueWatching: ServerMovie[];
  categories: { name: string; count: number }[];
  /** На чём остановился этот человек: id фильма → секунды. */
  progress: Record<string, number>;
  /**
   * То же самое списком и в том порядке, в каком отдал сервер — от
   * самого свежего. Из записи по ключу порядок не достать, а «вы
   * смотрели» без него не построить.
   */
  progressList: MovieProgress[];

  loading: boolean;
  error: string | null;
  loaded: boolean;
  /** Нет подписки — экран показывает предложение Prime вместо кино. */
  needsPrime: boolean;

  load: (opts?: { force?: boolean }) => Promise<void>;
  refreshMine: () => Promise<void>;
  search: (q: string) => Promise<ServerMovie[]>;
  sortCatalog: (sort: CatalogOpts['sort']) => Promise<void>;

  toggleSaved: (movieId: string) => Promise<void>;
  rate: (movieId: string, score: number) => Promise<void>;
  noteView: (movieId: string) => Promise<void>;
  saveProgress: (movieId: string, position: number, duration: number) => void;
  flushProgress: (movieId: string, position: number, duration: number) => Promise<void>;

  upload: (file: Blob, meta: UploadMeta, onProgress?: (p: number) => void)
    => { promise: Promise<{ ok: boolean; reason?: string; id?: string }>; cancel: () => void };
  setPoster: (movieId: string, file: Blob) => Promise<boolean>;
  submitForReview: (movieId: string, p: {
    license: 'open' | 'personal'; explicit?: boolean; ageRestricted18?: boolean;
  }) => Promise<{ ok: boolean; reason?: string }>;
  /** Забрать свой фильм из общего каталога обратно в личную коллекцию. */
  unpublish: (movieId: string) => Promise<void>;
  editMovie: (movieId: string, patch: Parameters<typeof apiPatchMovie>[1]) => Promise<void>;
  removeMovie: (movieId: string) => Promise<void>;
}

/**
 * Позиция сохраняется не на каждый тик проигрывателя, а раз в
 * несколько секунд: иначе на сервер летел бы запрос по четыре раза в
 * секунду с каждого зрителя.
 */
const PROGRESS_EVERY_MS = 5000;
const lastSentAt: Record<string, number> = {};

/** Заменить фильм во всех списках, где он есть. */
const replace = (s: FilmState, m: ServerMovie) => ({
  catalog: s.catalog.map((x) => (x.id === m.id ? m : x)),
  mine: s.mine.map((x) => (x.id === m.id ? m : x)),
  saved: s.saved.map((x) => (x.id === m.id ? m : x)),
  continueWatching: s.continueWatching.map((x) => (x.id === m.id ? m : x)),
});

export const useFilmStore = create<FilmState>((set, get) => ({
  catalog: [],
  mine: [],
  saved: [],
  continueWatching: [],
  categories: [],
  progress: {},
  progressList: [],
  loading: false,
  error: null,
  loaded: false,
  needsPrime: false,

  load: async ({ force } = {}) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true, error: null });
    // Сначала пропуск: без него теги <video> и <img> получат отказ.
    const ticket = await apiFilmTicket();
    const [catalog, mine, saved, cont, cats, prog] = await Promise.all([
      apiCatalog({ limit: 100 }), apiMyFilms(), apiSavedFilms(),
      apiContinue(), apiCategories(), apiProgress(),
    ]);
    if (catalog === null) {
      // Пропуск не выдали и каталог не отдали — чаще всего это отказ по
      // подписке. Экран должен предложить Prime, а не «ошибку связи».
      set({ loading: false, needsPrime: !ticket, error: ticket ? 'Не удалось загрузить кино' : null });
      return;
    }
    set({
      catalog,
      mine: mine ?? [],
      saved: saved ?? [],
      continueWatching: cont ?? [],
      categories: cats ?? [],
      progress: Object.fromEntries((prog ?? []).map((p) => [p.movieId, p.position])),
      progressList: prog ?? [],
      loading: false,
      loaded: true,
      needsPrime: false,
      error: null,
    });
  },

  refreshMine: async () => {
    const mine = await apiMyFilms();
    if (mine) set({ mine });
  },

  search: async (q) => (await apiCatalog({ q, limit: 60 })) ?? [],

  sortCatalog: async (sort) => {
    const found = await apiCatalog({ sort, limit: 100 });
    if (found) set({ catalog: found });
  },

  toggleSaved: async (movieId) => {
    const on = !get().saved.some((m) => m.id === movieId);
    const before = get().saved;
    // Отклик сразу, правда — от сервера: если он откажет, вернём как было.
    const guess = [...get().catalog, ...get().mine].find((m) => m.id === movieId);
    set({ saved: on ? (guess ? [guess, ...before] : before) : before.filter((m) => m.id !== movieId) });
    const fresh = await apiSetSaved(movieId, on);
    if (fresh === null) { set({ saved: before }); return; }
    set({ saved: fresh });
  },

  rate: async (movieId, score) => {
    const m = await apiRateMovie(movieId, score);
    if (m) set((s) => replace(s, m));
  },

  noteView: async (movieId) => { await apiCountView(movieId); },

  saveProgress: (movieId, position, duration) => {
    const now = Date.now();
    set((s) => ({ progress: { ...s.progress, [movieId]: Math.floor(position) } }));
    if (now - (lastSentAt[movieId] ?? 0) < PROGRESS_EVERY_MS) return;
    lastSentAt[movieId] = now;
    void apiSetProgress(movieId, position, duration);
  },

  /**
   * Отправить позицию немедленно — при закрытии проигрывателя. Без
   * этого последние секунды просмотра терялись бы, и продолжение на
   * другом устройстве начиналось бы чуть раньше, чем человек ушёл.
   */
  flushProgress: async (movieId, position, duration) => {
    lastSentAt[movieId] = Date.now();
    set((s) => ({ progress: { ...s.progress, [movieId]: Math.floor(position) } }));
    await apiSetProgress(movieId, position, duration);
    const cont = await apiContinue();
    if (cont) set({ continueWatching: cont });
  },

  upload: (file, meta, onProgress) => {
    const { promise, cancel } = apiUploadMovie(file, meta, onProgress);
    return {
      cancel,
      promise: promise.then((res) => {
        if (!res.ok || !res.movie) return { ok: false, reason: res.reason };
        // Новый фильм всегда закрыт, поэтому он попадает только в
        // личную коллекцию — в каталоге ему взяться неоткуда.
        set((s) => ({ mine: [res.movie!, ...s.mine] }));
        return { ok: true, id: res.movie.id };
      }),
    };
  },

  setPoster: async (movieId, file) => {
    if (!(await apiUploadPoster(movieId, file))) return false;
    await get().refreshMine();
    return true;
  },

  submitForReview: async (movieId, p) => {
    const res = await apiSubmitMovie(movieId, p);
    if (!res.ok) return { ok: false, reason: res.reason };
    if (res.movie) set((s) => replace(s, res.movie!));
    return { ok: true };
  },

  unpublish: async (movieId) => {
    const m = await apiPatchMovie(movieId, { status: 'private' });
    if (!m) return;
    // Из каталога он ушёл — сервер его туда больше не отдаст, и на
    // экране он тоже не должен остаться.
    set((s) => ({ ...replace(s, m), catalog: s.catalog.filter((x) => x.id !== movieId) }));
  },

  editMovie: async (movieId, patch) => {
    const m = await apiPatchMovie(movieId, patch);
    if (m) set((s) => replace(s, m));
  },

  removeMovie: async (movieId) => {
    if (!(await apiDeleteMovie(movieId))) return;
    set((s) => ({
      catalog: s.catalog.filter((m) => m.id !== movieId),
      mine: s.mine.filter((m) => m.id !== movieId),
      saved: s.saved.filter((m) => m.id !== movieId),
      continueWatching: s.continueWatching.filter((m) => m.id !== movieId),
    }));
  },
}));

/** Сброс при смене профиля: чужое кино не должно остаться на экране. */
export const resetFilmForUser = () => {
  useFilmStore.setState({
    catalog: [], mine: [], saved: [], continueWatching: [], categories: [],
    progress: {}, progressList: [],
    loaded: false, loading: false, error: null, needsPrime: false,
  });
};
