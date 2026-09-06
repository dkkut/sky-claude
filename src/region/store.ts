/* ===========================================================
   SKY REGION STORE
=========================================================== */
import { create } from 'zustand';
import { COUNTRIES, WORLDWIDE, TIMEZONE_COUNTRY } from './types';
import type { Country } from './types';

const KEY = 'sky:region:v1';

interface Persisted {
  code: string;            // 'WW' = весь мир
  autoDetect: boolean;
  saved: string[];         // коды сохранённых/недавних регионов
  applyLanguage: boolean;  // менять ли язык интерфейса вместе с регионом
}

const detectByTimezone = (): string => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONE_COUNTRY[tz] ?? 'RU';
  } catch { return 'RU'; }
};

const load = (): Persisted => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw) return raw;
  } catch {}
  const detected = detectByTimezone();
  return { code: detected, autoDetect: true, saved: [detected], applyLanguage: false };
};
const persist = (p: Persisted) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };

export const allCountries = (): Country[] => COUNTRIES;
export const findCountry = (code: string): Country =>
  code === 'WW' ? WORLDWIDE : COUNTRIES.find(c => c.code === code) ?? COUNTRIES[0];

interface RegionState {
  code: string;
  autoDetect: boolean;
  saved: string[];
  applyLanguage: boolean;

  current: () => Country;
  isWorldwide: () => boolean;
  detectedCountry: () => Country;

  setRegion: (code: string) => void;
  setWorldwide: () => void;
  setAutoDetect: (v: boolean) => void;
  setApplyLanguage: (v: boolean) => void;
  removeSaved: (code: string) => void;

  formatPrice: (rubAmount: number) => string;
}

/* Очень приблизительные коэффициенты пересчёта из ₽ — только для витрины региональности,
   не является финансовым курсом валют. */
const RATE_FROM_RUB: Record<string, number> = {
  RUB:1, USD:0.0107, EUR:0.0099, GBP:0.0084, KZT:5.4, BYN:0.035, UAH:0.45, UZS:135,
  AMD:4.2, AZN:0.018, GEL:0.029, KGS:0.94, TJS:0.116, MDL:0.19, PLN:0.043, TRY:0.37,
  AED:0.039, SAR:0.04, ILS:0.039, CNY:0.078, JPY:1.65, KRW:14.7, INR:0.9, IDR:172,
  THB:0.39, VND:272, BRL:0.061, MXN:0.2, ARS:14.8, CAD:0.0147, AUD:0.0165, EGP:0.53,
  ZAR:0.2, SEK:0.114, NOK:0.116, CHF:0.0095,
};

export const useRegionStore = create<RegionState>((set, get) => {
  const p = load();
  return {
    code: p.code, autoDetect: p.autoDetect, saved: p.saved, applyLanguage: p.applyLanguage,

    current: () => findCountry(get().code),
    isWorldwide: () => get().code === 'WW',
    detectedCountry: () => findCountry(detectByTimezone()),

    setRegion: (code) => {
      set(s => {
        const saved = [code, ...s.saved.filter(c => c !== code)].slice(0, 6);
        const next = { code, autoDetect: false, saved, applyLanguage: s.applyLanguage };
        persist(next);
        return next;
      });
    },
    setWorldwide: () => {
      set(s => { const next = { code:'WW', autoDetect:false, saved:s.saved, applyLanguage:s.applyLanguage }; persist(next); return next; });
    },
    setAutoDetect: (v) => {
      set(s => {
        const code = v ? detectByTimezone() : s.code;
        const next = { code, autoDetect: v, saved: s.saved, applyLanguage: s.applyLanguage };
        persist(next);
        return next;
      });
    },
    setApplyLanguage: (v) => {
      set(s => { const next = { ...s, applyLanguage: v }; persist(next); return next; });
    },
    removeSaved: (code) => {
      set(s => { const next = { ...s, saved: s.saved.filter(c => c !== code) }; persist(next); return next; });
    },

    formatPrice: (rubAmount) => {
      const c = get().current();
      if (c.code === 'WW' || c.code === 'RU') return `${Math.round(rubAmount).toLocaleString('ru')} ₽`;
      const rate = RATE_FROM_RUB[c.currency] ?? 1;
      const converted = rubAmount * rate;
      const formatted = converted >= 100 ? Math.round(converted).toLocaleString('ru') : converted.toFixed(2);
      return `${formatted} ${c.currencySymbol}`;
    },
  };
});
