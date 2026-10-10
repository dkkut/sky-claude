/** Поставки: пакеты заказов для развоза (server/logibatches.mjs). */
import { apiCall, uploadUrl } from '@/core/auth/api';
import { MEDIA_BY_URL } from '@/core/nativeApp';
import { getMarketMediaTicket } from '../marketApi';

export type BatchStatus = 'draft' | 'open' | 'handed' | 'done' | 'cancelled';

export interface RouteStop { id: string; lat: number; lng: number }
export interface BatchRoute {
  order: RouteStop[]; legs: { id: string; distanceM: number; durationS: number }[];
  distanceM: number; durationS: number; unresolved: string[]; builtAt: string | null;
  origin: { lat: number; lng: number; kind: 'courier' | 'warehouse' };
}
export interface Batch {
  id: string; title: string; status: BatchStatus; courierId: string | null; sellerId: string;
  originAddress: string; hasOrigin: boolean; price: number; cityId: string; district: string;
  handedAt: string | null; createdAt: string; orders?: number; route: BatchRoute | null;
}
export interface BatchItem {
  orderId: string; position: number; title: string; quantity: number; total: number; address: string;
  assignmentId: string | null; assignmentStatus: string | null;
}
export interface EligibleOrder { id: string; title: string; quantity: number; total: number; status: string; address: string; createdAt: string }

export const BATCH_ERRORS: Record<string, string> = {
  no_orders: 'Выберите хотя бы один заказ.',
  too_many_orders: 'В поставке не больше 20 заказов.',
  origin_required: 'Укажите адрес, откуда курьер заберёт заказы.',
  orders_not_ready: 'Часть заказов уже не готова к развозу или попала в другую поставку — обновите список.',
  not_found: 'Поставка не найдена.',
  wrong_state: 'Сейчас так сделать нельзя.',
  no_collab: 'С этим курьером нет принятой заявки о сотрудничестве.',
  courier_not_approved: 'Курьер ещё не одобрен.',
  already_in_progress: 'По одному из заказов доставка уже идёт.',
  order_closed: 'Один из заказов уже закрыт.',
  already_taken: 'Поставку уже взял другой курьер.',
  not_online: 'Выйдите на связь, чтобы взять поставку.',
  no_origin: 'Не удалось определить точку старта: проверьте адрес забора.',
  no_stops: 'Ни один адрес заказов не удалось найти на карте.',
  maps_not_configured: 'Карты на сервере не настроены — маршрут построить нельзя.',
  route_service_denied: 'Сервис маршрутов отклонил запрос: на сервере должен быть включён Google Directions API для ключа.',
  route_failed: 'Сервис маршрутов не ответил — попробуйте ещё раз.',
  no_route: 'Между этими точками нет проезда.',
  too_many_requests: 'Слишком часто — подождите минуту.',
};
export const batchError = (code?: string) => BATCH_ERRORS[code ?? ''] ?? 'Не получилось — попробуйте ещё раз.';

const j = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
const enc = encodeURIComponent;

export const apiEligibleOrders = () => apiCall<{ orders: EligibleOrder[] }>('/api/logistics/batches/eligible');
export const apiBatches = (as: 'seller' | 'courier') => apiCall<{ batches: Batch[] }>(`/api/logistics/batches?as=${as}`);
export const apiPoolBatches = () => apiCall<{ batches: Batch[] }>('/api/logistics/batches/pool');
export const apiCreateBatch = (b: { title: string; orderIds: string[]; originAddress: string }) =>
  apiCall<{ id: string; originResolved: boolean }>('/api/logistics/batches', j('POST', b));
export const apiBatch = (id: string) => apiCall<{ batch: Batch; items: BatchItem[]; role: 'seller' | 'courier' }>(`/api/logistics/batches/${enc(id)}`);
export const apiCancelBatch = (id: string) => apiCall<{ ok: true }>(`/api/logistics/batches/${enc(id)}`, j('DELETE'));
export const apiHandoffBatch = (id: string, b: { courierId?: string; pool?: boolean; priceKop?: number; cityId?: string; district?: string }) =>
  apiCall<{ ok: true; status: string }>(`/api/logistics/batches/${enc(id)}/handoff`, j('POST', b));
export const apiTakeBatch = (id: string) => apiCall<{ ok: true }>(`/api/logistics/batches/${enc(id)}/take`, j('POST'));
export const apiBuildRoute = (id: string) => apiCall<{ batch: Batch; items: BatchItem[]; role: 'seller' | 'courier' }>(`/api/logistics/batches/${enc(id)}/route`, j('POST'));

/** Картинка маршрута; ?v — чтобы после перестроения браузер не показал старую. */
export const batchMapUrl = (id: string, version: string | null) => {
  const p = new URLSearchParams({ w: '640', h: '400' });
  if (version) p.set('v', version);
  const ticket = MEDIA_BY_URL ? getMarketMediaTicket() : null;
  if (ticket) p.set('t', ticket);
  return uploadUrl(`/api/logistics/batches/${enc(id)}/map?${p}`);
};
