/**
 * Sky Tickets: разговор с сервером.
 *
 * Здесь только вызовы. Ни одна проверка отсюда не заменяет серверную:
 * этот файл живёт в браузере, а браузер переписывается. В частности,
 * `subscription.active` ниже — то, что сервер УЖЕ решил; поставить его
 * себе в true можно, но кабинет от этого не откроется — все действия
 * организатора сервер проверяет заново.
 *
 * Цена и остаток тоже приходят только отсюда: в запросе на покупку их
 * просто нет.
 */
import { apiCall, getAccessToken, uploadUrl, nativeXhrHeaders } from '@/core/auth/api';
import { NATIVE_APP } from '@/core/nativeApp';

/* ─── Что приходит с сервера ────────────────────────────────────── */

export interface TicketType {
  id: string;
  name: string;
  desc?: string;
  price: number;
  /** Остаток. Сколько всего и сколько продано — знает только владелец. */
  available: number;
  saleFrom: string | null;
  saleTo: string | null;
  perUserMax: number;
  status: 'active' | 'hidden' | 'closed';
  onSale: boolean;
  /* Только в своём кабинете. */
  quantity?: number;
  sold?: number;
}

export type EventStatus = 'draft' | 'pending' | 'published' | 'paused' | 'completed' | 'cancelled';

export interface TicketEvent {
  id: string;
  title: string;
  desc: string;
  category: string;
  ageLimit: number;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  city: string;
  venue: string;
  address: string;
  venueNote: string;
  status: EventStatus;
  accent: string;
  hasCover: boolean;
  images: number;
  organizerName: string;
  views: number;
  priceFrom: number | null;
  available: number;
  capacity: number;
  soldOut: boolean;
  favorite: boolean;
  /* Дальше — только своё. */
  own?: boolean;
  rejectReason?: string;
  publishedAt?: string | null;
  createdAt?: string;
  sold?: number;
  revenue?: number;
  orders?: number;
  /* Приходит в карточке одного мероприятия. */
  types?: TicketType[];
  imageList?: number[];
}

export type TicketStatus = 'valid' | 'used' | 'expired' | 'cancelled' | 'refunded';

export interface Ticket {
  id: string;
  code: string;
  status: TicketStatus;
  seatNo: number;
  eventId: string;
  eventTitle: string;
  startsAt: string | null;
  venue: string;
  city: string;
  address: string;
  accent: string;
  typeName: string;
  price: number;
  usedAt: string | null;
  orderId: string;
  createdAt: string;
  /** Ключ для QR. Приходит только владельцу билета. */
  qr?: string;
  /* Только в кабинете организатора. */
  buyer?: string;
  buyerUsername?: string | null;
}

export interface Order {
  id: string;
  eventId: string;
  eventTitle: string;
  startsAt: string | null;
  venue: string;
  city: string;
  accent: string;
  typeName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  currency: string;
  status: 'awaiting_payment' | 'paid' | 'cancelled' | 'refunded';
  createdAt: string;
  paidAt: string | null;
  buyer?: string;
}

export interface Subscription {
  status: 'inactive' | 'payment_pending' | 'active' | 'expired' | 'cancelled';
  active: boolean;
  activeUntil: string | null;
  daysLeft: number;
  displayName: string;
  price: number;
  days: number;
}

export interface OrganizerSummary {
  published: number; drafts: number; pending: number; total: number;
  revenue: number; sold: number;
}

export interface Payment {
  id: string; amount: number; days: number;
  method: string; status: string; at: string;
}

export interface EventStats {
  title: string;
  startsAt: string | null;
  views: number;
  sold: number;
  revenue: number;
  orders: number;
  available: number;
  capacity: number;
  byType: { id: string; name: string; price: number; quantity: number; sold: number; revenue: number }[];
  daily: { day: string; sold: number; revenue: number }[];
  checkin: { valid: number; used: number; expired: number; cancelled: number; refunded: number };
}

export type ScanVerdict = 'ok' | 'valid' | 'used' | 'expired' | 'cancelled' | 'refunded' | 'not_found';

export interface ScanResult {
  result: ScanVerdict;
  /** Самого билета нет, когда его не нашли — или нашли чужой. */
  ticket?: Ticket;
}

/* ─── Понятные причины отказа ───────────────────────────────────── */

const REASONS: Record<string, string> = {
  subscription_required: 'Нужна подписка организатора',
  insufficient_funds:    'Не хватает средств на счёте Sky',
  payments_not_configured: 'Оплата пока не подключена на этом сервере',
  sold_out:              'Мест больше нет',
  per_user_limit:        'Больше билетов в одни руки не продают',
  not_on_sale:           'Продажа закрыта',
  sale_not_started:      'Продажа ещё не началась',
  sale_ended:            'Продажа уже закончилась',
  event_started:         'Мероприятие уже началось',
  event_closed:          'Мероприятие закрыто',
  already_pending:       'Уже на проверке',
  already_published:     'Уже опубликовано',
  incomplete:            'Заполнено не всё',
  too_many:              'Слишком много мероприятий',
  too_many_types:        'Слишком много типов билетов',
  too_many_images:       'Больше картинок добавить нельзя',
  has_sales:             'По этому типу уже есть продажи',
  below_sold:            'Меньше, чем уже продано',
  bad_transition:        'Так статус не меняют',
  bad_status:            'Такого статуса нет',
  invalid_title:         'Название от 3 символов',
  invalid_date:          'Проверьте дату',
  invalid_price:         'Проверьте цену',
  invalid_quantity:      'Проверьте количество',
  invalid_type_name:     'Название типа от 2 символов',
  idem_key_required:     'Повторите попытку',
  not_found:             'Не найдено',
  not_allowed:           'Недостаточно прав',
  rate_limited:          'Слишком часто. Подождите минуту',
  too_many_requests:     'Слишком часто. Подождите',
  too_large:             'Файл слишком большой',
  unsupported_image:     'Подходят JPEG, PNG и WebP',
  storage_unavailable:   'На сервере нет места — сообщите владельцу',
  write_failed:          'Не удалось сохранить файл',
};

export const ticketReason = (code?: string, fallback = 'Не получилось') =>
  (code && REASONS[code]) || fallback;

/* ─── Ключ идемпотентности ──────────────────────────────────────
   Нужен, чтобы двойное нажатие «Купить» не стало двумя заказами.
   Сервер запоминает его вместе с профилем и на повтор отвечает тем
   же заказом, а не новым списанием. */
export const newIdemKey = () =>
  (globalThis.crypto?.randomUUID?.() ?? `k${Date.now()}${Math.random().toString(36).slice(2)}`);

/* ─── Афиша ─────────────────────────────────────────────────────── */

export interface CatalogFilters {
  q?: string;
  city?: string;
  category?: string;
  priceMin?: number;
  priceMax?: number;
  available?: boolean;
  period?: '' | 'today' | 'week' | 'popular';
  limit?: number;
  offset?: number;
}

export interface CatalogPage {
  events: TicketEvent[];
  more: boolean;
  offset: number;
  limit: number;
  categories: string[];
  cities: string[];
}

export const apiCatalog = async (f: CatalogFilters = {}): Promise<CatalogPage | null> => {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.city && f.city !== 'Все') p.set('city', f.city);
  if (f.category) p.set('category', f.category);
  /* Пустой фильтр не отправляем вовсе: «не дороже нуля» — не то же
     самое, что «цена не важна». */
  if (typeof f.priceMin === 'number') p.set('priceMin', String(f.priceMin));
  if (typeof f.priceMax === 'number') p.set('priceMax', String(f.priceMax));
  if (f.available) p.set('available', '1');
  if (f.period) p.set('period', f.period);
  if (f.limit) p.set('limit', String(f.limit));
  if (f.offset) p.set('offset', String(f.offset));
  const qs = p.toString();
  const r = await apiCall<CatalogPage>(`/api/tickets/catalog${qs ? `?${qs}` : ''}`);
  return r.ok ? r.data ?? null : null;
};

export const apiEvent = async (id: string): Promise<TicketEvent | null> => {
  const r = await apiCall<{ event: TicketEvent }>(`/api/tickets/event/${encodeURIComponent(id)}`);
  return r.ok ? r.data?.event ?? null : null;
};

export const apiFavorites = async (): Promise<TicketEvent[]> => {
  const r = await apiCall<{ events: TicketEvent[] }>('/api/tickets/favorites');
  return r.ok ? r.data?.events ?? [] : [];
};

export const apiSetFavorite = async (id: string, on: boolean): Promise<boolean> => {
  const r = await apiCall<{ favorite: boolean }>(
    `/api/tickets/event/${encodeURIComponent(id)}/favorite`,
    { method: 'POST', body: JSON.stringify({ on }) },
  );
  return r.ok ? r.data?.favorite === true : !on;
};

/** Адрес афиши. Картинку браузер тянет сам, обычным <img>. */
export const coverUrl = (eventId: string) =>
  `/api/tickets/event/${encodeURIComponent(eventId)}/cover`;

export const imageUrl = (eventId: string, idx: number) =>
  `/api/tickets/event/${encodeURIComponent(eventId)}/image/${idx}`;

/* ─── Покупка и свои билеты ─────────────────────────────────────── */

export interface BuyResult {
  ok: boolean;
  order?: Order;
  tickets?: Ticket[];
  balance?: number;
  reason?: string;
  /** Сколько на самом деле осталось — когда мест не хватило. */
  available?: number;
  limit?: number;
}

export const apiBuy = async (typeId: string, quantity: number, idemKey: string): Promise<BuyResult> => {
  const r = await apiCall<{ order: Order; tickets: Ticket[]; balance: number }>(
    '/api/tickets/buy',
    { method: 'POST', body: JSON.stringify({ typeId, quantity, idemKey }) },
  );
  if (!r.ok) {
    /* На отказе сервер присылает подробности: сколько на самом деле
       осталось и каков предел в одни руки. */
    const d = r.data as { available?: number; limit?: number } | undefined;
    return { ok: false, reason: ticketReason(r.error, r.reason), available: d?.available, limit: d?.limit };
  }
  return { ok: true, order: r.data?.order, tickets: r.data?.tickets, balance: r.data?.balance };
};

export const apiMyTickets = async (scope: 'active' | 'past' | 'all' = 'active'): Promise<Ticket[]> => {
  const r = await apiCall<{ tickets: Ticket[] }>(`/api/tickets/my?scope=${scope}`);
  return r.ok ? r.data?.tickets ?? [] : [];
};

export const apiMyOrders = async (): Promise<Order[]> => {
  const r = await apiCall<{ orders: Order[] }>('/api/tickets/orders');
  return r.ok ? r.data?.orders ?? [] : [];
};

/* ─── Кабинет организатора ──────────────────────────────────────── */

export interface OrganizerState {
  subscription: Subscription;
  summary: OrganizerSummary | null;
  payments: Payment[];
}

export const apiOrganizer = async (): Promise<OrganizerState | null> => {
  const r = await apiCall<OrganizerState>('/api/tickets/organizer');
  return r.ok ? r.data ?? null : null;
};

export const apiPayOrganizer = async (idemKey: string) => {
  const r = await apiCall<{ subscription: Subscription; balance: number; alreadyDone?: boolean }>(
    '/api/tickets/organizer/pay',
    { method: 'POST', body: JSON.stringify({ idemKey }) },
  );
  return r.ok
    ? { ok: true as const, subscription: r.data?.subscription, balance: r.data?.balance }
    : { ok: false as const, reason: ticketReason(r.error, r.reason) };
};

export const apiSetOrganizerName = async (name: string) => {
  const r = await apiCall<{ subscription: Subscription }>(
    '/api/tickets/organizer/name',
    { method: 'POST', body: JSON.stringify({ name }) },
  );
  return r.ok ? r.data?.subscription ?? null : null;
};

export const apiMyEvents = async (status = 'all') => {
  const r = await apiCall<{ events: TicketEvent[]; subscription: Subscription }>(
    `/api/tickets/mine?status=${encodeURIComponent(status)}`,
  );
  return r.ok ? r.data ?? null : null;
};

export interface EventDraft {
  title?: string;
  desc?: string;
  category?: string;
  ageLimit?: number;
  startsAt?: string;
  endsAt?: string | null;
  city?: string;
  venue?: string;
  address?: string;
  venueNote?: string;
  accent?: string;
}

export const apiCreateEvent = async (draft: EventDraft) => {
  const r = await apiCall<{ event: TicketEvent }>(
    '/api/tickets/events', { method: 'POST', body: JSON.stringify(draft) },
  );
  return r.ok
    ? { ok: true as const, event: r.data?.event as TicketEvent }
    : { ok: false as const, reason: ticketReason(r.error, r.reason) };
};

export const apiUpdateEvent = async (id: string, patch: EventDraft) => {
  const r = await apiCall<{ event: TicketEvent }>(
    `/api/tickets/event/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return r.ok
    ? { ok: true as const, event: r.data?.event as TicketEvent }
    : { ok: false as const, reason: ticketReason(r.error, r.reason) };
};

export const apiPublishProblems = async (id: string): Promise<string[]> => {
  const r = await apiCall<{ problems: string[] }>(
    `/api/tickets/event/${encodeURIComponent(id)}/publish-check`,
  );
  return r.ok ? r.data?.problems ?? [] : [];
};

export const apiSubmitEvent = async (id: string) => {
  const r = await apiCall<{ event: TicketEvent }>(
    `/api/tickets/event/${encodeURIComponent(id)}/submit`, { method: 'POST', body: '{}' },
  );
  return r.ok
    ? { ok: true as const, event: r.data?.event as TicketEvent }
    : {
      ok: false as const,
      reason: ticketReason(r.error, r.reason),
      problems: (r.data as { problems?: string[] } | undefined)?.problems,
    };
};

export const apiSetEventStatus = async (id: string, status: EventStatus) => {
  const r = await apiCall<{ event: TicketEvent }>(
    `/api/tickets/event/${encodeURIComponent(id)}/status`,
    { method: 'POST', body: JSON.stringify({ status }) },
  );
  return r.ok
    ? { ok: true as const, event: r.data?.event as TicketEvent }
    : { ok: false as const, reason: ticketReason(r.error, r.reason) };
};

/* ─── Типы билетов ──────────────────────────────────────────────── */

export interface TypeDraft {
  name?: string;
  desc?: string;
  price?: number;
  quantity?: number;
  perUserMax?: number;
  saleFrom?: string | null;
  saleTo?: string | null;
  status?: 'active' | 'hidden' | 'closed';
}

export const apiCreateType = async (eventId: string, draft: TypeDraft) => {
  const r = await apiCall<{ types: TicketType[] }>(
    `/api/tickets/event/${encodeURIComponent(eventId)}/types`,
    { method: 'POST', body: JSON.stringify(draft) },
  );
  return r.ok
    ? { ok: true as const, types: r.data?.types ?? [] }
    : { ok: false as const, reason: ticketReason(r.error, r.reason) };
};

export const apiUpdateType = async (typeId: string, patch: TypeDraft) => {
  const r = await apiCall<{ types: TicketType[] }>(
    `/api/tickets/type/${encodeURIComponent(typeId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return r.ok
    ? { ok: true as const, types: r.data?.types ?? [] }
    : { ok: false as const, reason: ticketReason(r.error, r.reason) };
};

export const apiDeleteType = async (typeId: string) => {
  const r = await apiCall<{ types: TicketType[] }>(
    `/api/tickets/type/${encodeURIComponent(typeId)}`, { method: 'DELETE' },
  );
  return r.ok
    ? { ok: true as const, types: r.data?.types ?? [] }
    : { ok: false as const, reason: ticketReason(r.error, r.reason) };
};

/* ─── Афиша: загрузка картинки ──────────────────────────────────── */

/**
 * Файл уходит телом запроса. Тип сервер определяет сам, по первым
 * байтам: тому, что напишет браузер в Content-Type, он не верит.
 *
 * XMLHttpRequest вместо fetch — ради полосы хода отправки.
 */
export const apiUploadCover = (
  eventId: string,
  kind: 'cover' | 'image',
  file: Blob,
  onProgress?: (percent: number) => void,
): { promise: Promise<{ ok: boolean; reason?: string }>; cancel: () => void } => {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ ok: boolean; reason?: string }>((resolve) => {
    xhr.open('POST', uploadUrl(`/api/tickets/event/${encodeURIComponent(eventId)}/${kind}`));
    xhr.withCredentials = !NATIVE_APP;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    Object.entries(nativeXhrHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: { error?: string } = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* не JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true });
      else resolve({ ok: false, reason: ticketReason(body.error, 'Не удалось загрузить') });
    };
    xhr.onerror = () => resolve({ ok: false, reason: 'Загрузка оборвалась — попробуйте ещё раз' });
    xhr.onabort = () => resolve({ ok: false, reason: 'Загрузка отменена' });
    xhr.send(file);
  });
  return { promise, cancel: () => xhr.abort() };
};

/* ─── Продажи, статистика, билеты мероприятия ───────────────────── */

export const apiEventTickets = async (
  eventId: string,
  opts: { status?: string; q?: string; limit?: number; offset?: number } = {},
) => {
  const p = new URLSearchParams();
  if (opts.status && opts.status !== 'all') p.set('status', opts.status);
  if (opts.q) p.set('q', opts.q);
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.offset) p.set('offset', String(opts.offset));
  const qs = p.toString();
  const r = await apiCall<{ tickets: Ticket[]; more: boolean; offset: number; limit: number }>(
    `/api/tickets/event/${encodeURIComponent(eventId)}/tickets${qs ? `?${qs}` : ''}`,
  );
  return r.ok ? r.data ?? null : null;
};

export const apiEventOrders = async (eventId: string): Promise<Order[]> => {
  const r = await apiCall<{ orders: Order[] }>(
    `/api/tickets/event/${encodeURIComponent(eventId)}/orders`,
  );
  return r.ok ? r.data?.orders ?? [] : [];
};

export const apiEventStats = async (eventId: string): Promise<EventStats | null> => {
  const r = await apiCall<EventStats>(`/api/tickets/event/${encodeURIComponent(eventId)}/stats`);
  return r.ok ? r.data ?? null : null;
};

/* ─── Контроль на входе ─────────────────────────────────────────── */

/**
 * Проверка или отметка. `mark: true` гасит билет — и гасит его ровно
 * один раз: два одновременных сканирования сервер разведёт сам.
 */
export const apiScan = async (input: { code?: string; qr?: string }, mark: boolean): Promise<ScanResult> => {
  const r = await apiCall<ScanResult>(
    '/api/tickets/scan',
    { method: 'POST', body: JSON.stringify({ ...input, mark }) },
  );
  if (!r.ok) return { result: 'not_found' };
  return r.data ?? { result: 'not_found' };
};

export const apiSetTicketStatus = async (ticketId: string, status: 'expired' | 'valid' | 'cancelled') => {
  const r = await apiCall<{ ok: true; id: string; status: TicketStatus }>(
    '/api/tickets/ticket/status',
    { method: 'POST', body: JSON.stringify({ ticketId, status }) },
  );
  return r.ok
    ? { ok: true as const, status: r.data?.status as TicketStatus }
    : { ok: false as const, reason: ticketReason(r.error, r.reason) };
};

export const apiExpireRemaining = async (eventId: string) => {
  const r = await apiCall<{ expired: number }>(
    `/api/tickets/event/${encodeURIComponent(eventId)}/expire-remaining`,
    { method: 'POST', body: '{}' },
  );
  return r.ok
    ? { ok: true as const, expired: r.data?.expired ?? 0 }
    : { ok: false as const, reason: ticketReason(r.error, r.reason) };
};

/* ─── Модерация (админ-панель) ──────────────────────────────────── */

export const apiModerationQueue = async (): Promise<(TicketEvent & { organizerName: string })[]> => {
  const r = await apiCall<{ events: (TicketEvent & { organizerName: string })[] }>('/api/tickets/moderation');
  return r.ok ? r.data?.events ?? [] : [];
};

export const apiModerate = async (eventId: string, approve: boolean, reason = '') => {
  const r = await apiCall<{ ok: true }>(
    '/api/tickets/moderation',
    { method: 'POST', body: JSON.stringify({ eventId, approve, reason }) },
  );
  return r.ok ? { ok: true as const } : { ok: false as const, reason: ticketReason(r.error, r.reason) };
};
