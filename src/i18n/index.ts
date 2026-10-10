/* ===============================================================
   SKY i18n — вход.

   initI18n() вызывается один раз до первого кадра приложения:
   определяет язык, выставляет <html lang> и — для английского —
   подгружает словарь отдельным чанком (русские пользователи его
   не качают), включает наблюдатель за DOM и английские форматы.
=============================================================== */
import { detectLang, setCurrentLang, getLang, chooseLang, speechLocale, intlLocale, isEnglish, type Lang } from './lang';

export { getLang, chooseLang, speechLocale, intlLocale, isEnglish };
export type { Lang };

import { translate, format } from './translator';

/** Перевод строки; без подстановок вернёт перевод или оригинал. */
export const tr = (ru: string): string => (getLang() === 'en' ? translate(ru) : ru);

/** Перевод шаблона с подстановками {0}, {1} … */
export const trf = (ruTemplate: string, ...args: (string | number)[]): string =>
  getLang() === 'en' ? format(ruTemplate, args) : ruTemplate.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));

export const initI18n = async (): Promise<Lang> => {
  const lang = detectLang();
  setCurrentLang(lang);
  document.documentElement.lang = lang;
  if (lang !== 'en') return lang;

  try {
    const [{ installEnglishLocale }, { startTranslator }, dict] = await Promise.all([
      import('./locale'),
      import('./translator'),
      import('./en.json').then((m) => m.default as Record<string, string>),
    ]);
    installEnglishLocale();
    startTranslator(dict);
  } catch (err) {
    // словарь не загрузился — приложение остаётся на русском, но живое
    console.error('i18n: dictionary failed to load', err);
  }
  return lang;
};
