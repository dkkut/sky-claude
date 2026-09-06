import { create } from 'zustand';
export type ModuleKey = 'stories'|'messages'|'bloom'|'extras'|'profile'|'notifications'|'gaming'|'video'|'library'|'studio';
interface S {
  activeModule: ModuleKey; setActiveModule: (m: ModuleKey) => void;
  pendingExtrasTab: string | null; setPendingExtrasTab: (t: string | null) => void;
}
export const useModuleStore = create<S>(set=>({
  activeModule:'messages', setActiveModule:m=>set({activeModule:m}),
  pendingExtrasTab: null, setPendingExtrasTab: t=>set({pendingExtrasTab:t}),
}));
