/** Sky GO: клиент API (server/routes/go.mjs). Цены, статусы и права решает сервер — здесь только запросы. */
import { apiCall, type Reply } from '@/core/auth/api';

export type GoRole = 'taxi_driver' | 'courier' | 'food_seller' | 'company';
export type LegalForm = 'npd' | 'ip' | 'ooo';

export const ROLE_LABEL: Record<GoRole, string> = {
  taxi_driver: 'Водитель такси', courier: 'Курьер', food_seller: 'Продавец еды', company: 'Компания (доставки)',
};
export const LEGAL_LABEL: Record<LegalForm, string> = { npd: 'Самозанятый (НПД)', ip: 'ИП', ooo: 'ООО' };
export const DOC_LABEL: Record<string, string> = {
  driver_license: 'Водительское удостоверение', vehicle_registration: 'Свидетельство о регистрации ТС (СТС)',
  id_doc: 'Документ, удостоверяющий личность', authority_doc: 'Документ о полномочиях представителя',
};
export const STATUS_LABEL: Record<string, string> = {
  searching: 'Ищем водителя', assigned: 'Водитель назначен', en_route: 'Водитель едет к вам', arrived: 'Водитель на месте',
  in_ride: 'В пути', awaiting_payment: 'Ожидает оплаты', payment_reported: 'Оплата ожидает подтверждения', paid: 'Оплачено',
  cancelled: 'Отменён', dispute: 'Спор', pending: 'Ждёт ответа заведения', accepted: 'Принят заведением', cooking: 'Готовится',
  ready: 'Готов, ищем курьера', handed_to_courier: 'Передан курьеру', delivering: 'Курьер в пути', delivered: 'Доставлен',
  new: 'Ищем курьера', heading_pickup: 'Курьер едет за заказом', at_pickup: 'Курьер на месте забора', picked_up: 'Принято курьером',
  at_recipient: 'Курьер у получателя',
};

const ERR: Record<string, string> = {
  not_registered: 'Сначала зарегистрируйтесь исполнителем в разделе «Работа».',
  not_approved: 'Заявка ещё не одобрена администрацией (или допуск приостановлен).',
  subscription_required: 'Подписка не активна. Оформите её в разделе «Работа» — новые заказы доступны только с подпиской.',
  insufficient_funds: 'Не хватает средств на кошельке Sky.',
  pay_details_required: 'Добавьте реквизиты для приёма оплаты (карта или счёт) — без них выйти на линию нельзя.',
  active_order_exists: 'У вас уже есть активный заказ.', already_taken: 'Заказ уже принял другой исполнитель.',
  bad_state: 'Это действие сейчас недоступно — обновите экран.', not_found: 'Не найдено.',
  address_not_found: 'Адрес не найден. Уточните город, улицу и дом.', same_point: 'Точки отправления и назначения совпадают.',
  too_far: 'Слишком далеко для этого сервиса.', route_failed: 'Не удалось построить маршрут. Попробуйте позже.',
  bad_city: 'Город пока не подключён.', bad_code: 'Неверный код.', code_locked: 'Код заблокирован после неверных попыток. Обратитесь в поддержку.',
  code_used: 'Код уже использован.', code_expired: 'Срок кода вышел.', rate_limited: 'Слишком часто. Подождите минуту.',
  docs_missing: 'Не хватает обязательных документов.', dob_required: 'Укажите дату рождения в профиле.', too_young: 'Исполнителем может быть только совершеннолетний.',
  invalid_fields: 'Проверьте поля анкеты.', bad_card: 'Неверный номер карты.', bank_required: 'Укажите банк.', holder_required: 'Укажите владельца.',
  file_too_large: 'Файл слишком большой (до 8 МБ).', unsupported_type: 'Нужно изображение (JPG, PNG, WebP) или PDF.',
  provider_not_configured: 'Сервис пока не подключён администрацией.', provider_unreachable: 'Поставщик данных недоступен. Попробуйте позже.',
  provider_error: 'Поставщик данных вернул ошибку. Попробуйте позже.', location_required: 'Нужна геолокация или город.',
  report_too_soon: 'Вы уже сообщали об этой станции недавно.', menu_empty: 'Добавьте хотя бы одно блюдо.', place_unavailable: 'Заведение сейчас недоступно.',
  place_closed: 'Заведение не принимает заказы.', place_not_located: 'Не удалось определить координаты заведения — уточните адрес.',
  payment_required: 'Сначала подтвердите оплату.', own_place: 'Нельзя заказывать у самого себя.', item_unavailable: 'Одно из блюд недоступно.',
  company_not_approved: 'Компания ещё не одобрена.', recipient_phone_invalid: 'Неверный телефон получателя.', pvz_info_required: 'Опишите отправление в ПВЗ.',
  reason_required: 'Опишите причину (не короче 5 символов).', not_reported: 'Плательщик ещё не сообщил об оплате.', date_in_past: 'Дата в прошлом.',
  bad_iata: 'Выберите город из подсказок.', same_city: 'Города совпадают.', bad_offer: 'Предложение недействительно — повторите поиск.',
};
export const goError = (r: { error?: string; reason?: string; status?: number }) =>
  (r.error && ERR[r.error]) || r.reason || (r.error ? `Не получилось (${r.error})` : 'Ошибка сервера');

const j = (b: unknown) => JSON.stringify(b ?? {});
const get = <T>(p: string) => apiCall<T>(p);
const post = <T>(p: string, b?: unknown) => apiCall<T>(p, { method: 'POST', body: j(b) });
const put = <T>(p: string, b?: unknown) => apiCall<T>(p, { method: 'PUT', body: j(b) });
const del = <T>(p: string) => apiCall<T>(p, { method: 'DELETE' });
const qs = (o: Record<string, string | undefined>) => {
  const s = Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
  return s ? `?${s}` : '';
};

export interface Tariff { code: string; title: string; priceRub: number; periodDays: number }
export interface GoConfig {
  cities: string[];
  tariffs: { tariffs: Tariff[]; roleTariff: Record<GoRole, string> };
  flights: { configured: boolean; canBook: boolean; provider?: string };
  fuel: { configured: boolean; provider?: string };
  paymentTerms: Record<string, string>;
}
export interface Point { address?: string; lat?: number; lng?: number }
export interface ExecutorRow {
  id: string; role: GoRole; legalForm: LegalForm; city: string; status: string; reviewNote?: string;
  fields: Record<string, any>; extra: Record<string, any>;
  docs: { id: string; kind: string; mime: string; size: number }[]; requiredDocs: string[];
}
export interface SubState {
  active: boolean; expired: boolean; expiresAt: string | null; tariff: Tariff | null; role?: GoRole;
}
export interface GoOrder {
  id: string; kind: 'taxi' | 'food' | 'delivery'; parentId: string | null; status: string; priceRub: number; city: string;
  createdAt: string; cancelReason?: string; role: 'customer' | 'executor' | 'staff' | 'viewer';
  data: Record<string, any>;
  customer?: { id: string; username: string; name?: string };
  executor?: { id: string; username: string; name?: string; car?: Record<string, any> } | null;
  pay?: { state: string; amountRub: number; details?: Record<string, any> };
  codes?: { pickup?: { code: string }; handover?: { code: string } };
  events?: { from: string; to: string; note: string; at: string; byYou: boolean }[];
}

export const goApi = {
  config: () => get<GoConfig>('/api/go/config'),
  executors: () => get<{ executors: ExecutorRow[] }>('/api/go/executors'),
  saveExecutor: (b: unknown) => post<{ id: string }>('/api/go/executors', b),
  submitExecutor: (id: string) => post<{ status: string }>(`/api/go/executors/${id}/submit`),
  uploadDoc: (id: string, kind: string, file: File) =>
    apiCall<{ id: string }>(`/api/go/executors/${id}/docs?kind=${encodeURIComponent(kind)}`,
      { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }),
  removeDoc: (id: string, docId: string) => del(`/api/go/executors/${id}/docs/${docId}`),
  payDetails: () => get<{ details: Record<string, any> | null }>('/api/go/pay-details'),
  savePayDetails: (b: unknown) => put('/api/go/pay-details', b),
  subscription: (role: GoRole) => get<{ subscription: SubState; history: { startedAt: string; priceRub: number; expiresAt: string }[] }>(`/api/go/subscription/${role}`),
  buy: (role: GoRole) => post<{ expiresAt: string }>(`/api/go/subscription/${role}/buy`, { idemKey: crypto.randomUUID() }),
  presence: (role: GoRole, online: boolean, pos?: { lat: number; lng: number }) => post<{ online: boolean }>('/api/go/presence', { role, online, ...pos }),
  presenceOf: (role: GoRole) => get<{ online: boolean }>(`/api/go/presence/${role}`),
  stats: (role: GoRole) => get<{ done: number; earnedRub: number }>(`/api/go/stats/${role}`),

  taxiQuote: (b: unknown) => post<{ km: number; minutes: number; estimated: boolean; offers: { code: string; title: string; priceRub: number }[] }>('/api/go/taxi/quote', b),
  taxiCreate: (b: unknown) => post<{ orderId: string; priceRub: number }>('/api/go/taxi/orders', { ...(b as object), idemKey: crypto.randomUUID() }),
  taxiAvailable: () => get<{ orders: any[] }>('/api/go/taxi/available'),
  taxiAccept: (id: string) => post(`/api/go/taxi/orders/${id}/accept`),
  taxiAct: (id: string, action: string) => post(`/api/go/taxi/orders/${id}/act`, { action }),
  taxiCancel: (id: string, reason?: string) => post(`/api/go/taxi/orders/${id}/cancel`, { reason }),

  deliveryQuote: (b: unknown) => post<{ km: number; minutes: number; priceRub: number }>('/api/go/delivery/quote', b),
  deliveryCreate: (b: unknown) => post<{ orderId: string; priceRub: number }>('/api/go/delivery/orders', { ...(b as object), idemKey: crypto.randomUUID() }),
  deliveryAvailable: () => get<{ orders: any[] }>('/api/go/delivery/available'),
  deliveryAccept: (id: string) => post(`/api/go/delivery/orders/${id}/accept`),
  deliveryAct: (id: string, action: string, code?: string) => post<{ left?: number }>(`/api/go/delivery/orders/${id}/act`, { action, code }),
  deliveryCancel: (id: string, reason?: string) => post(`/api/go/delivery/orders/${id}/cancel`, { reason }),

  places: (city: string, q: string) => get<{ places: any[] }>(`/api/go/food/places${qs({ city, q })}`),
  place: (id: string) => get<{ place: any; items: any[] }>(`/api/go/food/places/${id}`),
  foodCreate: (b: unknown) => post<{ orderId: string; sumRub: number }>('/api/go/food/orders', b),
  foodCancel: (id: string, reason?: string) => post(`/api/go/food/orders/${id}/cancel`, { reason }),
  myPlace: () => get<{ place: any; items: any[] }>('/api/go/food/my/place'),
  savePlace: (b: unknown) => put<{ located: boolean }>('/api/go/food/my/place', b),
  publish: (on: boolean) => post('/api/go/food/my/publish', { on }),
  accepting: (on: boolean) => post('/api/go/food/my/accepting', { on }),
  saveItem: (b: unknown) => post<{ id: string }>('/api/go/food/my/items', b),
  removeItem: (id: string) => del(`/api/go/food/my/items/${id}`),
  sellerOrders: () => get<{ orders: GoOrder[] }>('/api/go/food/my/orders'),
  sellerAct: (id: string, action: string, reason?: string) => post(`/api/go/food/orders/${id}/seller-act`, { action, reason }),

  orders: (o: { side?: 'executor'; status?: 'active' | 'history' } = {}) => get<{ orders: GoOrder[] }>(`/api/go/orders${qs(o)}`),
  order: (id: string) => get<{ order: GoOrder }>(`/api/go/orders/${id}`),
  paid: (id: string) => post(`/api/go/orders/${id}/paid`),
  confirmPaid: (id: string) => post(`/api/go/orders/${id}/confirm-paid`),
  dispute: (id: string, reason: string) => post(`/api/go/orders/${id}/dispute`, { reason }),

  flightsSuggest: (term: string) => get<{ places: { code: string; name: string; country?: string }[] }>(`/api/go/flights/suggest${qs({ term })}`),
  flightsSearch: (b: unknown) => post<{ offers: any[]; cached: boolean; notice?: string }>('/api/go/flights/search', b),
  flightsOrder: (b: unknown) => post<{ orderId: string; status: string; note: string; link?: string }>('/api/go/flights/orders', b),
  flightsOrders: () => get<{ orders: any[] }>('/api/go/flights/orders'),
  flightsCancel: (id: string) => post(`/api/go/flights/orders/${id}/cancel`),

  fuelNearby: (b: unknown) => post<{ stations: any[]; notice: string }>('/api/go/fuel/nearby', b),
  fuelReport: (key: string, level: string) => post('/api/go/fuel/report', { key, level }),
};
export type R<T> = Reply<T>;
