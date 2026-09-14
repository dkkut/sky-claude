/* ======================================================================
   SKY MARKET / LOGISTICS — география

   Здесь остались только настоящие вещи: список городов с их центрами и
   расстояние между двумя точками.

   Раньше рядом жили три помощника, которые выдумывали географию:
   pointForSeed расставлял курьеров и склады по остатку от деления хэша,
   jitter «оживлял» их случайным дрожанием, а toMapPercent раскладывал
   всё это по нарисованной сетке улиц. Выглядело как карта и означало
   ровно ничего — по такой точке не доедешь. Настоящие координаты берёт
   сервер: у склада те, что задал владелец, у курьера — переданные им
   самим, у адреса — разобранные Google.
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
