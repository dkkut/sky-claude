/* ===============================================================
   SKY i18n — форматы дат и чисел.

   В коде сотни вызовов toLocaleString('ru-RU') и Intl.* с русской
   локалью. В английском режиме подменяем её на английскую (по языку
   браузера, если он английский, иначе en-US): «12 990» → «12,990»,
   «10 окт.» → «Oct 10». Русский режим не трогаем.
=============================================================== */
import { intlLocale } from './lang';

const isRu = (l: unknown) => typeof l === 'string' && /^ru(-|$)/i.test(l);

const fix = (locales: unknown): unknown => {
  if (locales === undefined || locales === null) return intlLocale();
  if (isRu(locales)) return intlLocale();
  if (Array.isArray(locales) && locales.some(isRu)) return [intlLocale()];
  return locales;
};

export const installEnglishLocale = () => {
  const methods = ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const;
  for (const m of methods) {
    const orig = Date.prototype[m] as (l?: unknown, o?: unknown) => string;
    (Date.prototype as unknown as Record<string, unknown>)[m] = function (this: Date, l?: unknown, o?: unknown) {
      return orig.call(this, fix(l), o);
    };
  }
  const origNum = Number.prototype.toLocaleString as (l?: unknown, o?: unknown) => string;
  Number.prototype.toLocaleString = function (this: number, l?: unknown, o?: Intl.NumberFormatOptions) {
    return origNum.call(this, fix(l), o);
  } as typeof Number.prototype.toLocaleString;

  const wrap = <T extends keyof typeof Intl>(name: T) => {
    const Orig = Intl[name] as unknown as new (l?: unknown, o?: unknown) => unknown;
    if (typeof Orig !== 'function') return;
    (Intl as unknown as Record<string, unknown>)[name as string] = new Proxy(Orig, {
      construct: (t, args) => Reflect.construct(t, [fix(args[0]), args[1]]) as object,
      apply: (t, _this, args) => Reflect.apply(t, undefined, [fix(args[0]), args[1]]),
    });
  };
  wrap('DateTimeFormat'); wrap('NumberFormat'); wrap('RelativeTimeFormat');
  wrap('PluralRules'); wrap('Collator');
};
