/* ===========================================================
   SKY REGION — синхронизация с сервером.

   Сам выбор региона (RegionPicker, store.ts) не трогаем: это уже
   существующая система, и здесь только достаётся то, что она выбрала,
   и досылается профилю на сервере — чтобы у backend вообще было
   что проверять (региональные ограничения Bloom/SkyVideo, рассылки
   по региону). Второго выбора региона тут нет: store.ts остаётся
   единственным местом, где код региона меняется.
=========================================================== */
import { useRegionStore } from './store';
import { apiUpdateProfile } from '@/core/auth/api';

let lastSyncedProfileId: string | null = null;
let lastSyncedCode: string | null = null;

/**
 * Вызывается при входе/смене профиля. Если сервер уже знает регион
 * этого профиля — он и есть источник истины, локальный стор подтягивается
 * под него. Если нет (первый вход после этой доработки) — на сервер
 * уходит то, что уже выбрано локально существующим RegionPicker.
 */
export const syncRegionForProfile = (profileId: string | null, serverRegionCode: string | undefined) => {
  if (!profileId) { lastSyncedProfileId = null; lastSyncedCode = null; return; }
  if (lastSyncedProfileId === profileId) return;
  lastSyncedProfileId = profileId;

  if (serverRegionCode) {
    lastSyncedCode = serverRegionCode;
    if (useRegionStore.getState().code !== serverRegionCode) {
      useRegionStore.setState({ code: serverRegionCode, autoDetect: false });
    }
  } else {
    const code = useRegionStore.getState().code;
    lastSyncedCode = code;
    void apiUpdateProfile(profileId, { regionCode: code }).catch(() => {});
  }
};

let unsubscribe: (() => void) | null = null;

/** Досылает на сервер дальнейшие изменения региона через уже
 *  существующий RegionPicker — без второго механизма выбора. */
export const watchRegionChanges = (getProfileId: () => string | null) => {
  unsubscribe?.();
  unsubscribe = useRegionStore.subscribe((s) => {
    const profileId = getProfileId();
    if (!profileId || s.code === lastSyncedCode) return;
    lastSyncedCode = s.code;
    void apiUpdateProfile(profileId, { regionCode: s.code }).catch(() => {});
  });
};
