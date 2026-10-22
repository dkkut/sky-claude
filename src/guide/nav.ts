import { useModuleStore } from '@/data/state/modules';
import type { GoTarget } from './content';

/** Перейти в настоящий раздел приложения (тем же приёмом, что остальные «pending…»). */
export const goTo = (t: GoTarget) => {
  const m = useModuleStore.getState();
  if (t.module === 'extras') m.setPendingExtrasTab(t.tab);
  if (t.module === 'profile') m.setPendingProfileSection(t.section);
  m.setActiveModule(t.module);
};

export const OPEN_GUIDE_EVENT = 'sky:open-guide';
/** Запустить знакомство вручную (Профиль → «Познакомиться с Sky»). */
export const openGuide = () => window.dispatchEvent(new Event(OPEN_GUIDE_EVENT));
