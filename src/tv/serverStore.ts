/**
 * Состояние Sky TV, приходящее с сервера.
 *
 * Ничего из того, что здесь лежит, не является защитой. Каналы без
 * источника отмечены признаком `live: false` не для того, чтобы мы
 * спрятали кнопку, — сервер всё равно ответит отказом, если попросить
 * у него эфир такого канала. Признак нужен, чтобы человек увидел
 * честную причину до нажатия, а не чёрный экран после.
 */
import { create } from 'zustand';
import {
  apiChannels, apiTvCategories, apiTvFavorites, apiSetTvFavorite,
  apiTvRecent, apiNoteWatched, apiEpg, apiChannel,
  type TvChannel, type Programme,
} from './tvApi';

interface TvState {
  channels: TvChannel[];
  categories: { name: string; count: number }[];
  favorites: TvChannel[];
  recent: TvChannel[];
  /** Расписание по каналам: спрашивается по требованию и живёт недолго. */
  epg: Record<string, Programme[]>;

  loading: boolean;
  loaded: boolean;
  error: string | null;

  load: (opts?: { force?: boolean }) => Promise<void>;
  search: (q: string) => Promise<TvChannel[]>;
  toggleFavorite: (channelId: string) => Promise<void>;
  noteWatched: (channelId: string) => Promise<void>;
  loadEpg: (channelId: string, hours?: number) => Promise<Programme[]>;
  refreshChannel: (channelId: string) => Promise<void>;
}

/** Заменить канал во всех списках, где он есть. */
const replace = (s: TvState, c: TvChannel) => ({
  channels: s.channels.map((x) => (x.id === c.id ? c : x)),
  favorites: s.favorites.map((x) => (x.id === c.id ? c : x)),
  recent: s.recent.map((x) => (x.id === c.id ? c : x)),
});

export const useTvStore = create<TvState>((set, get) => ({
  channels: [],
  categories: [],
  favorites: [],
  recent: [],
  epg: {},
  loading: false,
  loaded: false,
  error: null,

  load: async ({ force } = {}) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true, error: null });
    const [channels, cats, favs, recent] = await Promise.all([
      apiChannels(), apiTvCategories(), apiTvFavorites(), apiTvRecent(),
    ]);
    if (channels === null) {
      set({ loading: false, error: 'Не удалось загрузить список каналов' });
      return;
    }
    set({
      channels,
      categories: cats?.categories ?? [],
      favorites: favs ?? [],
      recent: recent ?? [],
      loading: false,
      loaded: true,
      error: null,
    });
  },

  search: async (q) => (await apiChannels({ q })) ?? [],

  toggleFavorite: async (channelId) => {
    const on = !get().favorites.some((c) => c.id === channelId);
    const before = get().favorites;
    // Отклик сразу, правда — от сервера: откажет, вернём как было.
    const guess = get().channels.find((c) => c.id === channelId);
    set({ favorites: on ? (guess ? [guess, ...before] : before) : before.filter((c) => c.id !== channelId) });
    const fresh = await apiSetTvFavorite(channelId, on);
    if (fresh === null) { set({ favorites: before }); return; }
    set((s) => ({
      favorites: fresh,
      channels: s.channels.map((c) => (c.id === channelId ? { ...c, favorite: on || undefined } : c)),
    }));
  },

  /**
   * Отметить включённый канал. «Недавно смотрели» лежит на сервере,
   * поэтому список одинаков на телефоне и на телевизоре.
   */
  noteWatched: async (channelId) => {
    if (!(await apiNoteWatched(channelId))) return;
    const recent = await apiTvRecent();
    if (recent) set({ recent });
  },

  loadEpg: async (channelId, hours = 24) => {
    const cached = get().epg[channelId];
    if (cached) return cached;
    const programme = await apiEpg(channelId, hours);
    if (!programme) return [];
    set((s) => ({ epg: { ...s.epg, [channelId]: programme } }));
    return programme;
  },

  refreshChannel: async (channelId) => {
    const c = await apiChannel(channelId);
    if (c) set((s) => replace(s, c));
  },
}));

/** Сброс при смене профиля: чужое избранное не должно остаться на экране. */
export const resetTvForUser = () => {
  useTvStore.setState({
    channels: [], categories: [], favorites: [], recent: [], epg: {},
    loaded: false, loading: false, error: null,
  });
};
