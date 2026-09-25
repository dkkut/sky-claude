/**
 * Единая «Библиотека»: реальные данные четырёх модулей.
 *
 * Раньше вся вкладка читала один захардкоженный массив из 8 выдуманных
 * объектов в localStorage (monetizationStore.ts) — одинаковый для
 * любого пользователя и никак не связанный с тем, что человек реально
 * слушал, смотрел или сохранял. Здесь вместо этого — те же ручки,
 * которыми уже пользуются сами модули Music/Film/Podcasts/Books:
 * избранное, история, «продолжить» и полка книг, каждое от лица
 * текущей сессии.
 *
 * У избранного/полки/подписок сервер нигде не хранит «когда добавлено»
 * — только сам факт. Показывать вместо этого дату создания трека или
 * публикации фильма значило бы подписать чужую дату как «добавлено
 * вами», а это такая же выдумка, как и старые случайные значения.
 * Поэтому addedAt здесь просто не выставляется, и бейдж возраста в
 * интерфейсе не показывается там, где взять его неоткуда.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apiMediaTicket as apiMusicTicket, apiFavorites as apiMusicFavorites,
  apiHistory as apiMusicHistory, apiProgress as apiMusicProgress,
  apiSetFavorite as apiMusicSetFavorite, toClientTrack,
  type ServerTrack,
} from '@/music/musicApi';
import {
  apiFilmTicket, apiSavedFilms, apiContinue as apiFilmContinue,
  apiSetSaved, posterUrl, fmtDuration as fmtFilmDuration,
  type ServerMovie,
} from '@/film/filmApi';
import {
  apiMediaTicket as apiPodcastTicket, apiFavorites as apiPodcastFavorites,
  apiHistory as apiPodcastHistory, apiContinue as apiPodcastContinue,
  apiSetFavorite as apiPodcastSetFavorite, epCoverUrl,
  type Episode,
} from '@/podcasts/podcastApi';
import {
  apiMediaTicket as apiBooksTicket, apiShelf, apiSetShelf,
  bookCoverUrl, fmtAudioDuration,
  type Book,
} from '@/books/booksApi';
import { useMusicStore } from '@/music/serverStore';
import { usePlayerStore } from '@/player/playerStore';
import { usePlayer as usePodcastPlayer } from '@/podcasts/playerStore';
import { useModuleStore } from '@/data/state/modules';

export type LibKind = 'music' | 'video' | 'podcast' | 'book';

export interface ContentItem {
  id: string;
  realId: string;
  type: LibKind;
  title: string;
  subtitle?: string;
  duration?: string;
  coverGrad: [string, string];
  coverUrl?: string;
  /** Не выставляется, когда у сервера нет своей даты для этого факта. */
  addedAt?: string;
  progress?: number;
  isFavorite: boolean;
  /** Пришло из истории прослушивания/просмотра или «продолжить», а не
   *  только из избранного — отдельный признак для вкладки «История». */
  isHistory: boolean;
}

const GRAD: Record<LibKind, [string, string]> = {
  music: ['#6366f1', '#8b5cf6'],
  video: ['#0ea5e9', '#2563eb'],
  podcast: ['#f59e0b', '#ef4444'],
  book: ['#10b981', '#059669'],
};

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

interface RawStore {
  tracks: Map<string, ServerTrack>;
  movies: Map<string, ServerMovie>;
  episodes: Map<string, Episode>;
  books: Map<string, Book>;
}

interface State {
  items: ContentItem[];
  loading: boolean;
  error: string | null;
}

export const useLibraryItems = () => {
  const [state, setState] = useState<State>({ items: [], loading: true, error: null });
  const rawRef = useRef<RawStore>({
    tracks: new Map(), movies: new Map(), episodes: new Map(), books: new Map(),
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    // Пропуска для картинок/аудио/видео каждого модуля — без них
    // <img>/<audio> получат отказ, теги не умеют слать Authorization.
    await Promise.all([apiMusicTicket(), apiFilmTicket(), apiPodcastTicket(), apiBooksTicket()]);

    const [
      musicFavs, musicHist, musicProg,
      filmSaved, filmCont,
      podFavs, podHist, podCont,
      shelf,
    ] = await Promise.all([
      apiMusicFavorites(), apiMusicHistory(), apiMusicProgress(),
      apiSavedFilms(), apiFilmContinue(),
      apiPodcastFavorites(), apiPodcastHistory(), apiPodcastContinue(),
      apiShelf(),
    ]);

    const raw = rawRef.current;
    raw.tracks.clear(); raw.movies.clear(); raw.episodes.clear(); raw.books.clear();
    const items = new Map<string, ContentItem>();
    const progressByTrack = new Map((musicProg ?? []).map((p) => [p.trackId, p.position]));

    const putTrack = (t: ServerTrack, fav: boolean, hist: boolean) => {
      const id = `music:${t.id}`;
      raw.tracks.set(t.id, t);
      const c = toClientTrack(t);
      const pos = progressByTrack.get(t.id);
      const progress = pos && t.duration > 0 ? Math.min(1, pos / t.duration) : undefined;
      const prev = items.get(id);
      items.set(id, {
        id, realId: t.id, type: 'music', title: t.title, subtitle: t.artist,
        duration: c.duration, coverGrad: GRAD.music, coverUrl: c.coverUrl,
        progress: progress ?? prev?.progress,
        isFavorite: fav || (prev?.isFavorite ?? false),
        isHistory: hist || (prev?.isHistory ?? false),
      });
    };
    (musicFavs ?? []).forEach((t) => putTrack(t, true, false));
    (musicHist ?? []).forEach((t) => putTrack(t, false, true));

    const putMovie = (m: ServerMovie, fav: boolean, hist: boolean) => {
      const id = `video:${m.id}`;
      raw.movies.set(m.id, m);
      const progress = m.position && m.duration > 0 ? Math.min(1, m.position / m.duration) : undefined;
      const prev = items.get(id);
      items.set(id, {
        id, realId: m.id, type: 'video', title: m.title,
        subtitle: [m.genre, m.year ? String(m.year) : null].filter(Boolean).join(' · ') || undefined,
        duration: fmtFilmDuration(m.duration), coverGrad: GRAD.video,
        coverUrl: m.hasPoster ? posterUrl(m.id) : undefined,
        progress: progress ?? prev?.progress,
        isFavorite: fav || (prev?.isFavorite ?? false),
        isHistory: hist || (prev?.isHistory ?? false),
      });
    };
    (filmSaved ?? []).forEach((m) => putMovie(m, true, false));
    (filmCont ?? []).forEach((m) => putMovie(m, false, true));

    const putEpisode = (e: Episode, fav: boolean, hist: boolean) => {
      const id = `podcast:${e.id}`;
      raw.episodes.set(e.id, e);
      const progress = e.position && e.duration > 0 ? Math.min(1, e.position / e.duration) : undefined;
      const prev = items.get(id);
      items.set(id, {
        id, realId: e.id, type: 'podcast', title: e.title,
        subtitle: e.podcastTitle, duration: mmss(e.duration), coverGrad: GRAD.podcast,
        coverUrl: e.hasCover ? epCoverUrl(e.id) : undefined,
        progress: progress ?? prev?.progress,
        isFavorite: fav || (prev?.isFavorite ?? false),
        isHistory: hist || (prev?.isHistory ?? false),
      });
    };
    (podFavs?.episodes ?? []).forEach((e) => putEpisode(e, true, false));
    (podHist ?? []).forEach((e) => putEpisode(e, false, true));
    (podCont ?? []).forEach((e) => putEpisode(e, false, true));

    (shelf ?? []).forEach((b) => {
      const id = `book:${b.id}`;
      raw.books.set(b.id, b);
      items.set(id, {
        id, realId: b.id, type: 'book', title: b.title, subtitle: b.authorName,
        duration: b.hasAudio ? fmtAudioDuration(b.audioSeconds) : undefined,
        coverGrad: GRAD.book, coverUrl: b.hasCover ? bookCoverUrl(b.id) : undefined,
        isFavorite: true, isHistory: false,
      });
    });

    setState({ items: Array.from(items.values()), loading: false, error: null });
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Сердечко всегда обратимо — и для избранного, и для полки/сохранённого. */
  const toggleFavorite = useCallback(async (item: ContentItem) => {
    const on = !item.isFavorite;
    if (item.type === 'music') await apiMusicSetFavorite(item.realId, on);
    else if (item.type === 'video') await apiSetSaved(item.realId, on);
    else if (item.type === 'podcast') await apiPodcastSetFavorite({ episodeId: item.realId }, on);
    else if (item.type === 'book') await apiSetShelf(item.realId, on);
    void load();
  }, [load]);

  /** «Убрать» — та же обратная операция, доступна только для того, что
   *  реально можно снять (избранное/полку). У истории своей ручки
   *  удаления нет ни у одного из четырёх модулей. */
  const remove = useCallback((item: ContentItem) => { void toggleFavorite(item); }, [toggleFavorite]);

  /** Запустить реальное воспроизведение/чтение. Музыка и подкасты
   *  играют сразу через общий плеер (он живёт на уровне AppShell и не
   *  зависит от активной вкладки); фильм и книга открывают свой модуль
   *  дипссылкой на конкретный id — там нет общего вне-модульного плеера. */
  const play = useCallback((item: ContentItem) => {
    const raw = rawRef.current;
    if (item.type === 'music') {
      const t = raw.tracks.get(item.realId);
      if (!t) return;
      const c = toClientTrack(t);
      void useMusicStore.getState().notePlay(t.id);
      usePlayerStore.getState().push({
        id: c.id, kind: 'music', title: c.title, author: c.artist,
        coverUrl: c.coverUrl, srcUrl: c.sourceUrl, duration: t.duration,
      });
      return;
    }
    if (item.type === 'podcast') {
      const e = raw.episodes.get(item.realId);
      if (!e) return;
      void usePodcastPlayer.getState().play(e);
      return;
    }
    const { setPendingExtrasTab, setPendingExtrasItemId, setActiveModule } = useModuleStore.getState();
    if (item.type === 'video') setPendingExtrasTab('movies');
    else setPendingExtrasTab('books');
    setPendingExtrasItemId(item.realId);
    setActiveModule('extras');
  }, []);

  return { ...state, reload: load, toggleFavorite, remove, play };
};
