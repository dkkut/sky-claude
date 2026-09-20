/* ===============================================================
   Погода и курсы — обёртки над server/weather.mjs, server/currency.mjs.
   Ничего не выдумывается на клиенте: нет ответа сервера — нет виджета.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export type WeatherKind = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';
export interface WeatherNow { city: string | null; tempC: number; kind: WeatherKind; }

export const apiWeather = async (lat: number, lon: number): Promise<WeatherNow | null> => {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const r = await apiCall<WeatherNow>(`/api/weather?${params}`);
  return r.ok ? r.data ?? null : null;
};

export interface CurrencyRate { code: string; rate: number; changePct: number; }

export const apiCurrency = async (): Promise<CurrencyRate[]> => {
  const r = await apiCall<{ rates: CurrencyRate[] }>('/api/currency');
  return r.ok ? r.data?.rates ?? [] : [];
};
