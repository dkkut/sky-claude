import { create } from 'zustand';
export type ModuleKey = 'stories'|'messages'|'bloom'|'extras'|'profile'|'notifications'|'gaming'|'video'|'library'|'studio';
interface S {
  activeModule: ModuleKey; setActiveModule: (m: ModuleKey) => void;
  pendingExtrasTab: string | null; setPendingExtrasTab: (t: string | null) => void;
  /** Тикет поддержки, который должен открыться сам, когда человек попадёт в раздел «Поддержка» — тем же приёмом, что pendingExtrasTab. */
  pendingSupportTicketId: string | null; setPendingSupportTicketId: (id: string | null) => void;
}
export const useModuleStore = create<S>(set=>({
  activeModule:'messages', setActiveModule:m=>set({activeModule:m}),
  pendingExtrasTab: null, setPendingExtrasTab: t=>set({pendingExtrasTab:t}),
  pendingSupportTicketId: null, setPendingSupportTicketId: id=>set({pendingSupportTicketId:id}),
}));
