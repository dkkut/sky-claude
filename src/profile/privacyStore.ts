/**
 * Приватность профиля — зеркало серверного состояния.
 *
 * Раньше эти настройки лежали в localStorage вместе с остальным
 * профилем: «кто может писать», «кто может звонить» и «кто видит в
 * сети» до сервера не доходили вовсе, а под ними было написано, что
 * они сохраняются в аккаунте. Теперь решает сервер, а здесь только
 * показ и отправка команды.
 */
import { create } from 'zustand';
import { wireSend } from '@/core/wire';

export type PrivacyVal = 'all' | 'contacts' | 'nobody';

export const PRIVACY_LABEL: Record<PrivacyVal, string> = {
  all: 'Все', contacts: 'Контакты', nobody: 'Никто',
};

/** Разделы профиля, которые можно скрыть. Набор повторяет серверный. */
export type VisibilityKey =
  | 'showPhone' | 'showBirthDate' | 'showGames' | 'showMusic' | 'showMovies'
  | 'showGifts' | 'showAchievements' | 'showFollowing' | 'showFriends'
  | 'showPhotos' | 'showStories' | 'showPosts'
  | 'showCreatorMusic' | 'showCreatorFilm' | 'showCreatorPodcasts' | 'showCreatorBooks' | 'showCreatorStats'
  | 'showCountry' | 'showTimezone' | 'showActivity'
  | 'showBio' | 'showBanner' | 'showNameCustomization' | 'showLinks' | 'showCustomStatus';

export interface Privacy {
  whoCanWrite: PrivacyVal;
  whoCanCall: PrivacyVal;
  whoSeesOnline: PrivacyVal;
  profileVisibility: Partial<Record<VisibilityKey, boolean>>;
}

const DEFAULTS: Privacy = {
  whoCanWrite: 'all', whoCanCall: 'all', whoSeesOnline: 'all', profileVisibility: {},
};

interface S {
  privacy: Privacy;
  /** Пришло с сервера — записываем как есть. */
  apply: (p: Partial<Privacy>) => void;
  /** Просим сервер изменить. Ответ придёт событием и перезапишет. */
  save: (patch: Partial<Privacy>) => void;
}

export const usePrivacyStore = create<S>((set, get) => ({
  privacy: DEFAULTS,
  apply: (p) => set({ privacy: { ...DEFAULTS, ...p, profileVisibility: p.profileVisibility ?? {} } }),
  save: (patch) => {
    // Показываем сразу, чтобы переключатель не «залипал», но истиной
    // остаётся ответ сервера.
    set({ privacy: { ...get().privacy, ...patch } });
    wireSend({ type: 'privacy', payload: patch });
  },
}));
