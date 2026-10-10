/* ===============================================================
   SKY i18n — выбор языка.

   Языка два: ru и en. Язык хранится в localStorage и меняется
   перезагрузкой страницы: словарь грузится до первого кадра, и
   переключать «на лету» не нужно.

   Откуда берётся язык, по убыванию приоритета:
     1. явный выбор человека (sky:lang);
     2. язык страны из выбранного региона (src/region): русскоязычные
        страны — ru, остальные — en;
     3. язык браузера: ru/uk/be/kk/ky/uz/hy/az/ka/tg/mo — ru, иначе en.
=============================================================== */
export type Lang = 'ru' | 'en';

const KEY = 'sky:lang';
const REGION_KEY = 'sky:region';

const RU_LIKE = /^(ru|uk|be|kk|ky|uz|hy|az|ka|tg|mo)(-|$)/i;

const fromRegion = (): Lang | null => {
  try {
    const raw = localStorage.getItem(REGION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const lang = v?.country?.lang ?? v?.lang;
    if (typeof lang !== 'string') return null;
    return lang === 'ru' ? 'ru' : 'en';
  } catch { return null; }
};

export const detectLang = (): Lang => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch { /* хранилище недоступно */ }
  const region = fromRegion();
  if (region) return region;
  const nav = (typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language : '') || '';
  return RU_LIKE.test(nav) ? 'ru' : 'en';
};

let current: Lang = 'ru';

export const getLang = (): Lang => current;
export const isEnglish = () => current === 'en';
export const setCurrentLang = (l: Lang) => { current = l; };

/** Явный выбор языка: запоминаем и перезагружаем страницу. */
export const chooseLang = (l: Lang) => {
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  if (typeof location !== 'undefined') location.reload();
};

/** Локаль для Intl и распознавания речи. */
export const intlLocale = (): string => {
  if (current === 'ru') return 'ru-RU';
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return /^en(-|$)/i.test(nav) ? nav : 'en-US';
};

export const speechLocale = () => (current === 'en' ? 'en-US' : 'ru-RU');
