/**
 * Карты: разговор с сервером.
 *
 * Ключа Google здесь нет и быть не может. Картинку карты собирает
 * сервер своим ключом и отдаёт готовыми байтами; адрес в координаты
 * превращает тоже он. В браузер ключ не попадает ни разу — значит его
 * нельзя ни прочитать из разметки, ни унести вместе со страницей.
 */
import { apiCall, uploadUrl } from '@/core/auth/api';
import { NATIVE_APP, MEDIA_BY_URL } from '@/core/nativeApp';
import { getMarketMediaTicket } from '../marketApi';
import type { GeoPoint } from './types';

/** Что умеет сервер по части карт. Пусто — карт нет, и это так и пишется. */
export interface MapsSettings { enabled: boolean }

export const apiMapsSettings = async (): Promise<MapsSettings> => {
  const r = await apiCall<MapsSettings>('/api/maps/settings');
  return r.ok && r.data ? r.data : { enabled: false };
};

/**
 * Адрес в точку на карте.
 *
 * Возвращает null, когда адрес не найден. Это честный ответ: подставить
 * вместо ненайденного адреса центр города значит отправить человека не
 * туда.
 */
export const apiGeocode = async (address: string): Promise<GeoPoint | null> => {
  const r = await apiCall<{ point: (GeoPoint & { cached?: boolean }) | null }>(
    '/api/maps/geocode', { method: 'POST', body: JSON.stringify({ address }) });
  const p = r.ok ? r.data?.point : null;
  return p ? { lat: p.lat, lng: p.lng } : null;
};

/** Вид метки. Цвет ей назначает сервер — здесь только название. */
export type MapPinKind = 'warehouse' | 'courier' | 'pickup' | 'target' | 'default';

export interface MapPin { lat: number; lng: number; kind?: MapPinKind; /** Один символ A–Z/0–9 — номер остановки на метке. */ label?: string }

/**
 * Адрес картинки карты.
 *
 * Собирается строкой, потому что её подставляют в <img>. Всё, что здесь
 * перечислено, сервер разбирает заново и приводит к числам: строка,
 * ушедшая к Google как есть, позволила бы дописать к запросу чужие
 * параметры нашим же ключом.
 */
export const mapStillUrl = (
  pins: MapPin[],
  { center, zoom, width = 640, height = 320, path }:
  { center?: GeoPoint; zoom?: number; width?: number; height?: number; /** Линия маршрута — закодированная ломаная Google. */ path?: string } = {},
) => {
  const params = new URLSearchParams();
  const points = pins
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .slice(0, 40)
    .map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)},${p.kind ?? 'default'}${p.label && /^[A-Z0-9]$/.test(p.label) ? `,${p.label}` : ''}`)
    .join(';');
  if (points) params.set('points', points);
  if (center) params.set('center', `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`);
  if (zoom !== undefined) params.set('zoom', String(Math.round(zoom)));
  if (path && /^[\x3f-\x7e]{2,3500}$/.test(path)) params.set('path', path);
  params.set('w', String(Math.round(width)));
  params.set('h', String(Math.round(height)));
  /* Тег <img> заголовок авторизации не отправляет — в родном приложении
     вместо него в адрес подставляется пропуск маркета (пропуск общий
     на market/logistics/maps, см. marketApi.ts::getMarketMediaTicket). */
  const ticket = MEDIA_BY_URL ? getMarketMediaTicket() : null;
  if (ticket) params.set('t', ticket);
  return uploadUrl(`/api/maps/still?${params}`);
};

/** Настоящая ли это точка. Ноль-ноль в Гвинейском заливе — это «не задано». */
export const isRealPoint = (p?: GeoPoint | null): p is GeoPoint =>
  Boolean(p) && Number.isFinite(p!.lat) && Number.isFinite(p!.lng)
  && (Math.abs(p!.lat) > 0.0001 || Math.abs(p!.lng) > 0.0001);
