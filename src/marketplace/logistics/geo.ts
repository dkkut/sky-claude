/* ======================================================================
   SKY MARKET / LOGISTICS  —  Geo helpers
====================================================================== */
import type { City, GeoPoint } from './types';

export const CITIES: City[] = [
  { id:'msk', name:'Москва',           center:{lat:55.7558,lng:37.6173}, districts:['ЦАО','САО','СВАО','ВАО','ЮВАО','ЮАО','ЮЗАО','ЗАО','СЗАО'] },
  { id:'spb', name:'Санкт-Петербург',  center:{lat:59.9311,lng:30.3609}, districts:['Центральный','Невский','Приморский','Выборгский','Московский','Калининский'] },
  { id:'kzn', name:'Казань',           center:{lat:55.7963,lng:49.1088}, districts:['Вахитовский','Советский','Кировский','Ново-Савиновский'] },
  { id:'ekb', name:'Екатеринбург',     center:{lat:56.8389,lng:60.6057}, districts:['Ленинский','Кировский','Октябрьский','Верх-Исетский'] },
  { id:'nsk', name:'Новосибирск',      center:{lat:55.0084,lng:82.9357}, districts:['Центральный','Ленинский','Заельцовский','Калининский'] },
];

export const cityById = (id: string) => CITIES.find(c => c.id === id);

/* Смещение точки от центра города на основе хэша строки —
   стабильно «раскидывает» курьеров/склады по районам без рандома при каждом рендере. */
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

export const pointForSeed = (cityId: string, seedKey: string): GeoPoint => {
  const city = cityById(cityId) ?? CITIES[0];
  const h = hash(seedKey);
  const dLat = (((h % 1000) / 1000) - 0.5) * 0.18;
  const dLng = ((((h >> 10) % 1000) / 1000) - 0.5) * 0.18;
  return { lat: city.center.lat + dLat, lng: city.center.lng + dLng };
};

/* Haversine — расстояние в км между двумя точками */
export const distanceKm = (a: GeoPoint, b: GeoPoint): number => {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/* Небольшое «дыхание» точки — для имитации обновления геопозиции в реальном времени */
export const jitter = (p: GeoPoint, amount = 0.004): GeoPoint => ({
  lat: p.lat + (Math.random() - 0.5) * amount,
  lng: p.lng + (Math.random() - 0.5) * amount,
});

/* Преобразование GeoPoint в проценты внутри bounding-box города — для мини-карты на CSS */
export const toMapPercent = (p: GeoPoint, cityId: string): { x:number; y:number } => {
  const city = cityById(cityId) ?? CITIES[0];
  const span = 0.22; // примерный охват мини-карты в градусах
  const x = 50 + ((p.lng - city.center.lng) / span) * 100;
  const y = 50 - ((p.lat - city.center.lat) / span) * 100;
  return { x: Math.min(96, Math.max(4, x)), y: Math.min(96, Math.max(4, y)) };
};
