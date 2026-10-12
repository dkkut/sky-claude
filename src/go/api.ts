/** Sky GO: клиент API (server/routes/go.mjs). Цены, статусы и права решает сервер — здесь только запросы. */
import { apiCall, type Reply } from '@/core/auth/api';

export type GoRole = 'taxi_driver' | 'courier' | 'food_seller' | 'company' | 'host' | 'tour_operator' | 'hotel';
export type StayKind = 'home' | 'tour' | 'hotel';
export const STAY_LABEL: Record<StayKind, string> = { home: 'Квартиры и дома', tour: 'Туры', hotel: 'Отели' };
export const STAY_ROLE: Record<StayKind, GoRole> = { home: 'host', tour: 'tour_operator', hotel: 'hotel' };
export type LegalForm = 'npd' | 'ip' | 'ooo';

export const ROLE_LABEL: Record<GoRole, string> = {
  taxi_driver: 'Водитель такси', courier: 'Курьер', food_seller: 'Продавец еды', company: 'Компания (доставки)',
  host: 'Квартиры и дома', tour_operator: 'Туры', hotel: 'Отель',
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
  at_recipient: 'Курьер у получателя', requested: 'Ждёт ответа владельца',
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
  docs_missing: 'Не хватает обязательных документов.', dob_required: 'Укажите дату рождения в анкете.', invalid_dob: 'Неверная дата рождения.', too_young: 'Исполнителем может быть только совершеннолетний.',
  invalid_fields: 'Проверьте поля анкеты.', bad_card: 'Неверный номер карты.', bank_required: 'Укажите банк.', holder_required: 'Укажите владельца.',
  file_too_large: 'Файл слишком большой (до 8 МБ).', unsupported_type: 'Нужно изображение (JPG, PNG, WebP) или PDF.',
  provider_not_configured: 'Сервис пока не подключён администрацией.', provider_unreachable: 'Поставщик данных недоступен. Попробуйте позже.',
  provider_error: 'Поставщик данных вернул ошибку. Попробуйте позже.', location_required: 'Нужна геолокация или город.',
  report_too_soon: 'Вы уже сообщали об этой станции недавно.', menu_empty: 'Добавьте хотя бы одно блюдо.', place_unavailable: 'Заведение сейчас недоступно.',
  place_closed: 'Заведение не принимает заказы.', place_not_located: 'Не удалось определить координаты заведения — уточните адрес.',
  payment_required: 'Сначала подтвердите оплату.', own_place: 'Нельзя заказывать у самого себя.', item_unavailable: 'Одно из блюд недоступно.',
  company_not_approved: 'Компания ещё не одобрена.', recipient_phone_invalid: 'Неверный телефон получателя.', pvz_info_required: 'Опишите отправление в ПВЗ.',
  reason_required: 'Опишите причину (не короче 5 символов).', not_reported: 'Плательщик ещё не сообщил об оплате.', date_in_past: 'Дата в прошлом.',
  dates_taken: 'Эти даты (или места) уже заняты.', own_listing: 'Нельзя бронировать своё объявление.', bad_dates: 'Проверьте даты заезда и выезда.',
  too_many_guests: 'Больше гостей, чем помещается.', min_nights: 'Меньше минимального срока проживания.', room_not_found: 'Выберите номер.',
  departure_not_found: 'Выберите отправление.', departure_passed: 'Отправление уже прошло.', bad_guests: 'Укажите число гостей.', photo_required: 'Добавьте хотя бы одну фотографию.',
  hidden_by_admin: 'Объявление снято администрацией — смотрите причину в кабинете.', has_bookings: 'По этому объявлению есть активные брони.',
  legal_form_not_allowed: 'Туры и отели — только для ИП и организаций.', no_rooms: 'Добавьте хотя бы один номер.', no_departures: 'Добавьте будущее отправление.',
  too_many_photos: 'Не больше 8 фотографий.', too_many_listings: 'Слишком много объявлений.', title_required: 'Укажите название.', address_required: 'Укажите адрес.',
  bad_price: 'Цена — от 100 ₽.', bad_room: 'Проверьте данные номера.', bad_departure: 'Проверьте даты и места отправлений.',
  car_required: 'Укажите марку и модель.', parcel_required: 'Опишите, что везём (от 2 символов).',
  org_suspended: 'Организация приостановлена администрацией Sky — действия недоступны.', executor_offline: 'Исполнитель не на линии.',
  executor_not_member: 'Этот человек не в вашей команде.', executor_not_approved: 'У исполнителя нет одобренной регистрации курьера.',
  courier_busy: 'У исполнителя уже максимум активных заказов.', incompatible_order: 'Такие заказы нельзя совмещать в одном рейсе.',
  executor_not_truck: 'Для грузового заказа нужен исполнитель с грузовым транспортом.', assignment_not_accepted: 'Сначала примите назначение.',
  confirm_required: 'Подтвердите действие.', already_member: 'Этот человек уже в команде или приглашён.', profile_not_found: 'Профиль с таким ником не найден.',
  self_invite: 'Нельзя пригласить самого себя.', role_not_allowed: 'Эту роль вы назначить не можете.', owner_immutable: 'Владельца организации менять нельзя.',
  self_change: 'Свою роль и доступ менять нельзя.', executor_in_delivery: 'У сотрудника доставка в пути — сначала доведите её до конца.',
  payment_in_progress: 'По заказу уже идёт оплата — исполнителя менять нельзя.', bad_kind: 'Выберите вид проблемы.', note_required: 'Опишите подробнее (от 3 символов).',
  too_many_problems: 'По заказу уже есть открытые проблемы.', bad_point: 'Неверные координаты.', offline: 'Выйдите на линию.',
  point_not_found: 'Точка не найдена.', too_many_points: 'Слишком много точек.', phone_invalid: 'Неверный телефон.',
  bad_mode: 'Неизвестный режим назначения.', name_required: 'Укажите название (от 2 символов).', too_many_members: 'Слишком много сотрудников.',
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
  cargo: CargoTariff;
}
export interface CargoTariff { base: number; perKm: number; minRub: number; loaderRub: number; bodies: Record<'s' | 'm' | 'l', { maxKg: number; dims: string; surcharge: number }> }
export interface Car { make: string; model: string; plate: string; fuel: string }
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
  id: string; kind: 'taxi' | 'food' | 'delivery' | 'stay'; parentId: string | null; status: string; priceRub: number; city: string;
  createdAt: string; cancelReason?: string; role: 'customer' | 'executor' | 'staff' | 'viewer';
  data: Record<string, any>;
  customer?: { id: string; username: string; name?: string };
  executor?: { id: string; username: string; name?: string; car?: Record<string, any> } | null;
  pay?: { state: string; amountRub: number; payeeId?: string; payerId?: string; details?: Record<string, any> };
  codes?: { pickup?: { code: string }; handover?: { code: string } };
  events?: { from: string; to: string; note: string; at: string; byYou: boolean }[];
}

export interface StayCard { id: string; kind: StayKind; title: string; city: string; priceRub: number; unit: string; photo: string | null; maxGuests?: number; stars?: number; durationDays?: number; nextDeparture?: string | null }
export interface StayDetail extends StayCard { descr: string; photos: string[]; owner: { username: string; name: string };
  data: { maxGuests?: number; rooms?: any; beds?: number; areaM2?: number; minNights?: number; checkInTime?: string; checkOutTime?: string; rules?: string; amenities?: string[];
    stars?: number; durationDays?: number; program?: string; includes?: string; minAge?: number; departures?: { id: string; date: string; priceRub: number; seats: number; seatsLeft: number }[] } }
export interface MyListing { id: string; kind: StayKind; title: string; descr: string; city: string; address: string; priceRub: number; status: 'draft' | 'published' | 'hidden'; modNote?: string; data: Record<string, any>; photos: string[] }

export const goApi = {
  config: () => get<GoConfig>('/api/go/config'),
  executors: () => get<{ executors: ExecutorRow[] }>('/api/go/executors'),
  saveExecutor: (b: unknown) => post<{ id: string }>('/api/go/executors', b),
  submitExecutor: (id: string, dateOfBirth?: string) => post<{ status: string }>(`/api/go/executors/${id}/submit`, { dateOfBirth }),
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

  taxiQuote: (b: unknown) => post<{ from?: { lat: number; lng: number; address?: string }; to?: { lat: number; lng: number; address?: string }; km: number; minutes: number; estimated: boolean; offers: { code: string; title: string; priceRub: number }[] }>('/api/go/taxi/quote', b),
  taxiCreate: (b: unknown) => post<{ orderId: string; priceRub: number }>('/api/go/taxi/orders', { ...(b as object), idemKey: crypto.randomUUID() }),
  taxiAvailable: () => get<{ orders: any[] }>('/api/go/taxi/available'),
  taxiAccept: (id: string) => post(`/api/go/taxi/orders/${id}/accept`),
  taxiAct: (id: string, action: string) => post(`/api/go/taxi/orders/${id}/act`, { action }),
  taxiCancel: (id: string, reason?: string) => post(`/api/go/taxi/orders/${id}/cancel`, { reason }),

  deliveryQuote: (b: unknown) => post<{ from?: { lat: number; lng: number }; to?: { lat: number; lng: number }; km: number; minutes: number; priceRub: number; prices: Record<'s' | 'm' | 'l', number>; estimated: boolean; body?: string; loaders?: number; loaderRub?: number; bodies?: CargoTariff['bodies'] }>('/api/go/delivery/quote', b),
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

  stayList: (f: { kind: StayKind; city?: string; q?: string; guests?: string; checkIn?: string; checkOut?: string; sort?: string }) =>
    get<{ listings: StayCard[] }>(`/api/go/stay/listings${qs(f as Record<string, string | undefined>)}`),
  stayGet: (id: string) => get<{ listing: StayDetail }>(`/api/go/stay/listings/${id}`),
  stayQuote: (b: unknown) => post<{ totalRub: number; nights: number; available: boolean; label: string }>('/api/go/stay/quote', b),
  stayBook: (b: unknown) => post<{ orderId: string; totalRub: number }>('/api/go/stay/bookings', { ...(b as object), idemKey: crypto.randomUUID() }),
  stayAct: (id: string, action: string, reason?: string) => post(`/api/go/stay/bookings/${id}/act`, { action, reason }),
  stayCancel: (id: string, reason?: string) => post(`/api/go/stay/bookings/${id}/cancel`, { reason }),
  stayMine: () => get<{ listings: MyListing[] }>('/api/go/stay/my/listings'),
  staySave: (b: unknown) => put<{ id: string }>('/api/go/stay/my/listings', b),
  stayRemove: (id: string) => del(`/api/go/stay/my/listings/${id}`),
  stayPublish: (id: string, on: boolean) => post(`/api/go/stay/my/listings/${id}/publish`, { on }),
  stayAddPhoto: (id: string, file: File) => apiCall<{ id: string }>(`/api/go/stay/my/listings/${id}/photos`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }),
  stayRemovePhoto: (id: string, photoId: string) => del(`/api/go/stay/my/listings/${id}/photos/${photoId}`),

  flightsSuggest: (term: string) => get<{ places: { code: string; name: string; country?: string }[] }>(`/api/go/flights/suggest${qs({ term })}`),
  flightsSearch: (b: unknown) => post<{ offers: any[]; cached: boolean; notice?: string }>('/api/go/flights/search', b),
  flightsOrder: (b: unknown) => post<{ orderId: string; status: string; note: string; link?: string }>('/api/go/flights/orders', b),
  flightsOrders: () => get<{ orders: any[] }>('/api/go/flights/orders'),
  flightsCancel: (id: string) => post(`/api/go/flights/orders/${id}/cancel`),

  fuelNearby: (b: unknown) => post<{ stations: any[]; notice: string }>('/api/go/fuel/nearby', b),
  fuelRoute: (key: string, lat: number, lng: number) => post<{ km: number; minutes: number; estimated: boolean }>('/api/go/fuel/route', { key, lat, lng }),
  car: () => get<{ car: Car | null }>('/api/go/car'),
  saveCar: (c: Car) => put('/api/go/car', c),
  removeCar: () => del('/api/go/car'),
  fuelReport: (key: string, level: string) => post('/api/go/fuel/report', { key, level }),
};
export type R<T> = Reply<T>;
