/** Sky GO → Организации: клиент API (/api/go/places/*, владелец — /api/kbiz/place*). Цены, остатки и права решает сервер. */
import { apiCall } from '@/core/auth/api';
import { getApiOrigin } from '@/core/nativeApp';

export interface GpHours { [day: string]: [string, string][] | undefined }
export interface GpCategory { id: string; name: string; icon?: string; hidden?: boolean; sort?: number }
export interface GpCard {
  id: string; name: string; categoryId: string | null; categoryName: string | null; city: string; address: string; lat: number | null; lng: number | null;
  distanceKm: number | null; open: boolean | null; today: string; about: string; logoUrl: string | null; photo: string | null; fav: boolean;
}
export interface GpItem {
  id: string; title: string; description: string; priceRub: number; kind: 'product' | 'service'; variants: { name: string; priceRub?: number }[];
  leadTime?: string; available: boolean; left: number | null; photo: string | null; category?: string;
}
export interface GpPlace extends GpCard {
  photos: string[]; hours: GpHours; tz: string; phone: string; links: { title?: string; url: string }[]; contacts: string; website: string; canOrder: boolean; items: GpItem[];
}
export interface GpRoute {
  ok?: boolean; need?: 'from'; unavailable?: boolean; km?: number; minutes?: number; estimated?: boolean; from?: { lat: number; lng: number };
  links: { yandex: string; google: string; twogis: string };
}
export interface GpOrder {
  id: string; number: number; placeId: string; placeName: string; lines: { title: string; variant: string; qty: number; priceRub: number }[]; totalRub: number;
  status: string; statusLabel: string; payStatus: string; payLabel: string; comment: string; createdAt: string; payUrl: string | null;
}
export interface GpQuery { q?: string; category?: string; city?: string; open?: boolean; fav?: boolean; sort?: 'name' | 'distance'; lat?: number; lng?: number }

const body = (b: unknown) => JSON.stringify(b ?? {});
const P = '/api/go/places';
/** Путь картинки с API → адрес для <img> (в родных приложениях нужен абсолютный). */
export const placeImg = (path: string | null | undefined) => (path ? (path.startsWith('http') ? path : `${getApiOrigin()}${path}`) : '');

export const gp = {
  categories: () => apiCall<{ categories: GpCategory[] }>(`${P}/categories`),
  list: (q: GpQuery) => {
    const u = new URLSearchParams();
    if (q.q) u.set('q', q.q); if (q.category) u.set('category', q.category); if (q.city) u.set('city', q.city);
    if (q.open) u.set('open', '1'); if (q.fav) u.set('fav', '1'); if (q.sort) u.set('sort', q.sort);
    if (q.lat != null && q.lng != null) { u.set('lat', String(q.lat)); u.set('lng', String(q.lng)); }
    return apiCall<{ places: GpCard[]; total: number; located: boolean }>(`${P}?${u.toString()}`);
  },
  get: (id: string, pos?: { lat: number; lng: number } | null) => apiCall<{ place: GpPlace }>(`${P}/${id}${pos ? `?lat=${pos.lat}&lng=${pos.lng}` : ''}`),
  fav: (id: string, on: boolean) => apiCall<{ fav: boolean }>(`${P}/${id}/fav`, { method: on ? 'PUT' : 'DELETE' }),
  route: (id: string, b: { fromLat?: number; fromLng?: number; fromAddress?: string }) => apiCall<GpRoute>(`${P}/${id}/route`, { method: 'POST', body: body(b) }),
  order: (id: string, b: { items: { id: string; qty: number; variant?: string }[]; contact: { name: string; phone: string; email?: string; address?: string }; promo?: string }) =>
    apiCall<{ id: string; number: number; totalRub: number; payUrl: string }>(`${P}/${id}/orders`, { method: 'POST', body: body(b) }),
  orders: () => apiCall<{ orders: GpOrder[] }>(`${P}/orders`),
  cancelOrder: (id: string) => apiCall(`${P}/orders/${id}/cancel`, { method: 'POST', body: body({}) }),
};

/* ─── Владелец (Sky для бизнеса) ─── */
export interface GpOwnerPlace {
  connected: boolean; status: 'draft' | 'pending' | 'published' | 'rejected' | 'hidden' | 'blocked'; statusLabel: string; rejectReason: string;
  categoryId: string | null; about: string; city: string; address: string; lat: number | null; lng: number | null; hours: GpHours; tz: string; phone: string;
  links: { title?: string; url: string }[]; payments?: Record<string, boolean>; photos: string[]; canSubmit: boolean; missing: string[]; businessName: string;
}
/** Идентификатор фото из адреса. */
export const photoId = (url: string) => url.split('/').pop() ?? '';
export const gpOwner = {
  get: () => apiCall<{ place: GpOwnerPlace; categories: GpCategory[] }>('/api/kbiz/place'),
  save: (b: Partial<Pick<GpOwnerPlace, 'categoryId' | 'about' | 'city' | 'address' | 'lat' | 'lng' | 'hours' | 'tz' | 'phone' | 'links'>>) =>
    apiCall<{ place: GpOwnerPlace; geoFailed?: boolean; returnedToDraft?: boolean }>('/api/kbiz/place', { method: 'PUT', body: body(b) }),
  connect: (on: boolean) => apiCall<{ place: GpOwnerPlace }>('/api/kbiz/place/connect', { method: 'POST', body: body({ on }) }),
  submit: () => apiCall<{ place: GpOwnerPlace }>('/api/kbiz/place/submit', { method: 'POST', body: body({}) }),
  addPhoto: (dataUrl: string) => apiCall<{ photos: string[] }>('/api/kbiz/place/photo', { method: 'POST', body: body({ dataUrl }) }),
  delPhoto: (id: string) => apiCall<{ photos: string[] }>(`/api/kbiz/place/photo/${id}`, { method: 'DELETE' }),
};
