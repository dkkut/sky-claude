import { create } from 'zustand';
export type ModuleKey = 'stories'|'messages'|'bloom'|'extras'|'profile'|'notifications'|'gaming'|'video'|'library'|'studio';
interface S {
  activeModule: ModuleKey; setActiveModule: (m: ModuleKey) => void;
  pendingExtrasTab: string | null; setPendingExtrasTab: (t: string | null) => void;
  /** Тикет поддержки, который должен открыться сам, когда человек попадёт в раздел «Поддержка» — тем же приёмом, что pendingExtrasTab. */
  pendingSupportTicketId: string | null; setPendingSupportTicketId: (id: string | null) => void;
  /** «Мои посты» в Bloom, когда переходят из основного профиля по ссылке
   *  «Bloom» — тем же приёмом, что pendingExtrasTab (не новый экран). */
  pendingBloomTab: string | null; setPendingBloomTab: (t: string | null) => void;
  /** «Мои видео» в Sky Video — та же ссылка из основного профиля. */
  pendingVideoTab: string | null; setPendingVideoTab: (t: string | null) => void;
  /** Конкретный фильм/книга, который надо открыть при заходе в нужную
   *  подвкладку «Извне» (Библиотека) — тем же приёмом, что pendingExtrasTab,
   *  только несёт id элемента, а не название вкладки. */
  pendingExtrasItemId: string | null; setPendingExtrasItemId: (id: string | null) => void;
  /** Открыть конкретный раздел «Профиля» (например, «Настройки» — там
   *  живёт Quick Menu) сразу при переходе — тем же приёмом. */
  pendingProfileSection: string | null; setPendingProfileSection: (s: string | null) => void;
}
export const useModuleStore = create<S>(set=>({
  activeModule:'messages', setActiveModule:m=>set({activeModule:m}),
  pendingExtrasTab: null, setPendingExtrasTab: t=>set({pendingExtrasTab:t}),
  pendingSupportTicketId: null, setPendingSupportTicketId: id=>set({pendingSupportTicketId:id}),
  pendingBloomTab: null, setPendingBloomTab: t=>set({pendingBloomTab:t}),
  pendingVideoTab: null, setPendingVideoTab: t=>set({pendingVideoTab:t}),
  pendingExtrasItemId: null, setPendingExtrasItemId: id=>set({pendingExtrasItemId:id}),
  pendingProfileSection: null, setPendingProfileSection: s=>set({pendingProfileSection:s}),
}));
