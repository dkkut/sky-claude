import { useSettings } from '@/settings/store';
/** Настройка «Скрывать Explicit» — читается при каждом запросе каталога. */
export const hideExplicitOn = (): boolean => useSettings.getState().settings.hideExplicit === true;
