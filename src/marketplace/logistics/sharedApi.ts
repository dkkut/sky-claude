/**
 * Общедоступный склад и согласия: разговор с сервером.
 *
 * Здесь только вызовы. Ни одна проверка отсюда не заменяет серверную:
 * этот файл живёт в браузере, а браузер переписывается.
 *
 * Чего отсюда не отправляется никогда:
 *   · состояние видеообзора — его ставит только администрация;
 *   · редакция и отпечаток документа — их берёт сервер со своего диска,
 *     иначе «согласен» подписывалось бы под чем угодно;
 *   · цена ячейки при аренде — её считает сервер по своей базе;
 *   · своя роль на складе — она берётся из базы.
 */
import { apiCall, uploadUrl } from '@/core/auth/api';
import { NATIVE_APP, MEDIA_BY_URL } from '@/core/nativeApp';
import { getMarketMediaTicket } from '../marketApi';

const enc = encodeURIComponent;
const post = <T>(path: string, body: unknown = {}) =>
  apiCall<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown = {}) =>
  apiCall<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

/* ─── Документы и согласия ─────────────────────────────────────────── */

export type DocCode = 'seller_rules' | 'shared_warehouse_rules';

export interface DocState {
  code: DocCode;
  title: string;
  revision: string;
  accepted: boolean;
  /** Принимал, но текст с тех пор изменился: это не «не принимал». */
  outdated: boolean;
  acceptedAt: string | null;
}

export const apiDocuments = () =>
  apiCall<{ documents: DocState[] }>('/api/agreements');

export const apiDocument = (code: DocCode) =>
  apiCall<{ code: DocCode; title: string; revision: string; text: string }>(
    `/api/agreements/${enc(code)}`);

export const apiAcceptDocument = (code: DocCode) =>
  post<{ ok: true; code: DocCode; revision: string }>(`/api/agreements/${enc(code)}`);

/* ─── Видеообзор ───────────────────────────────────────────────────── */

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface VideoReview {
  id: string;
  subjectKind: 'warehouse' | 'pickup_point';
  subjectId: string;
  status: ReviewStatus;
  bytes: number;
  rejectReason: string;
  reviewedAt: string | null;
  createdAt?: string;
  /** Только в очереди администрации. */
  subjectTitle?: string;
  subjectCity?: string;
}

export const apiVideoReview = (warehouseId: string) =>
  apiCall<{ review: VideoReview | null }>(`/api/logistics/video/warehouse/${enc(warehouseId)}`);

/**
 * Адрес самой записи. Смотреть её вправе владелец объекта и администрация.
 *
 * Тег <video> заголовок авторизации не отправляет — в родном приложении
 * вместо него в адрес подставляется пропуск маркета (см.
 * marketApi.ts::getMarketMediaTicket): страница и API там на разных
 * origin, и кука SameSite=Strict обратно попросту не доедет.
 */
export const videoUrl = (reviewId: string) => {
  const url = uploadUrl(`/api/logistics/video/${enc(reviewId)}`);
  const ticket = getMarketMediaTicket();
  if (!MEDIA_BY_URL || !ticket) return url;
  return `${url}?t=${encodeURIComponent(ticket)}`;
};

/**
 * Загрузка обзора. Файл уходит телом запроса целиком, без обёртки: тип
 * сервер определяет по первым байтам, а не по тому, что мы напишем.
 */
export const apiUploadVideo = (warehouseId: string, file: File) =>
  apiCall<{ id: string; bytes: number }>(
    `/api/logistics/video/warehouse/${enc(warehouseId)}`,
    { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'video/mp4' } });

/** Обзор пункта выдачи: своя запись, для сотрудника и администрации. */
export const apiPvzVideoReview = (pvzId: string) =>
  apiCall<{ review: VideoReview | null }>(`/api/logistics/video/pickup_point/${enc(pvzId)}`);

export const apiUploadPvzVideo = (pvzId: string, file: File) =>
  apiCall<{ id: string; bytes: number }>(
    `/api/logistics/video/pickup_point/${enc(pvzId)}`,
    { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'video/mp4' } });

/** Публичная витрина: только id одобренного обзора, доступна любому вошедшему покупателю. */
export const apiPvzPublicVideo = (pvzId: string) =>
  apiCall<{ review: { id: string; bytes: number; createdAt?: string } | null }>(
    `/api/logistics/video/pickup_point/${enc(pvzId)}/public`);

export const apiVideoQueue = () =>
  apiCall<{ reviews: VideoReview[] }>('/api/logistics/video-queue');

export const apiDecideVideo = (reviewId: string, approve: boolean, reason?: string) =>
  post<{ review: VideoReview }>(`/api/logistics/video-queue/${enc(reviewId)}`, { approve, reason });

/* ─── Общий режим склада ───────────────────────────────────────────── */

export type SharedState = 'off' | 'review' | 'active' | 'rejected' | 'suspended';

export interface SharedSettings {
  state: SharedState;
  cellPrice: number;
  cellPriceKop: number;
  cellPeriodDays: number;
  minRentDays: number;
  maxRentDays: number;
  hasPaymentDetails: boolean;
  /** Только в своём складе. Арендатору они приходят с его арендой. */
  paymentDetails?: string;
  rules: string;
  zones: string[];
  hasCctv: boolean;
  hasGuard: boolean;
}

/** Чего не хватает, чтобы открыть склад. Считает сервер. */
export interface Readiness {
  video: boolean;
  rules: boolean;
  payment: boolean;
  price: boolean;
  cells: boolean;
}

export const apiReadiness = (warehouseId: string) =>
  apiCall<{ readiness: Readiness }>(`/api/logistics/warehouses/${enc(warehouseId)}/shared`);

export const apiUpdateShared = (warehouseId: string, p: Partial<SharedSettings>) =>
  patch<{ settings: SharedSettings }>(`/api/logistics/warehouses/${enc(warehouseId)}/shared`, p);

export const apiSharedAction = (warehouseId: string, action: 'request' | 'activate' | 'close') =>
  post<{ settings: SharedSettings }>(`/api/logistics/warehouses/${enc(warehouseId)}/shared/${action}`);

/* ─── Витрина общих складов ────────────────────────────────────────── */

export interface SharedWarehouse {
  id: string;
  name: string;
  cityId: string;
  location: { lat: number; lng: number };
  cellPrice: number;
  cellPeriodDays: number;
  minRentDays: number;
  maxRentDays: number;
  rules: string;
  zones: string[];
  hasCctv: boolean;
  hasGuard: boolean;
  freeCells: number;
  totalCells: number;
}

export const apiSharedWarehouses = (city?: string) =>
  apiCall<{ warehouses: SharedWarehouse[] }>(
    `/api/logistics/shared-warehouses${city ? `?city=${enc(city)}` : ''}`);

/* ─── Ячейки ───────────────────────────────────────────────────────── */

export type CellSize = 'small' | 'medium' | 'large';
export type CellState = 'free' | 'rented' | 'blocked';

export const CELL_SIZE_LABEL: Record<CellSize, string> = {
  small: 'Малая', medium: 'Средняя', large: 'Большая',
};

export const CELL_STATE_LABEL: Record<CellState, string> = {
  free: 'Свободна', rented: 'Занята', blocked: 'Выведена из эксплуатации',
};

export interface Cell {
  id: string;
  warehouseId: string;
  number: string;
  zone: string;
  size: CellSize;
  /** Своя цена ячейки. Пусто — берётся цена склада. */
  price: number | null;
  state: CellState;
  /** Почему закрыта. Видно только распорядителю склада. */
  blockReason?: string;
  createdAt?: string;
}

export const apiCells = (warehouseId: string) =>
  apiCall<{ cells: Cell[] }>(`/api/logistics/warehouses/${enc(warehouseId)}/cells`);

export const apiCreateCell = (warehouseId: string, p: {
  number: string; zone?: string; size?: CellSize; price?: number | null;
}) => post<{ cell: Cell }>(`/api/logistics/warehouses/${enc(warehouseId)}/cells`, p);

export const apiUpdateCell = (cellId: string, p: Partial<Cell>) =>
  patch<{ cell: Cell }>(`/api/logistics/cells/${enc(cellId)}`, p);

export const apiDeleteCell = (cellId: string) =>
  apiCall<{ ok: true }>(`/api/logistics/cells/${enc(cellId)}`, { method: 'DELETE' });

export const apiBlockCell = (cellId: string, on: boolean, reason?: string) =>
  post<{ cell: Cell }>(`/api/logistics/cells/${enc(cellId)}/block`, { on, reason });

export interface CellEvent { action: string; note: string; at?: string }

export const apiCellLog = (cellId: string) =>
  apiCall<{ events: CellEvent[] }>(`/api/logistics/cells/${enc(cellId)}/log`);

/* ─── Аренда ───────────────────────────────────────────────────────── */

export type RentalStatus = 'created' | 'payment_declared' | 'active' | 'ended' | 'cancelled';
export type KeyState = 'stored' | 'issued' | 'lost';

export const RENTAL_LABEL: Record<RentalStatus, string> = {
  created: 'Ждёт оплаты',
  payment_declared: 'Арендатор перевёл',
  active: 'Действует',
  ended: 'Закрыта',
  cancelled: 'Отменена',
};

export const KEY_LABEL: Record<KeyState, string> = {
  stored: 'Ключ на складе', issued: 'Ключ выдан', lost: 'Ключ утрачен',
};

export interface Rental {
  id: string;
  cellId: string;
  cellNumber?: string;
  warehouseId: string;
  warehouseName?: string;
  tenantId: string;
  role: 'tenant' | 'keeper';
  days: number;
  price: number;
  total: number;
  status: RentalStatus;
  keyState: KeyState;
  /** Куда платить. Приходит только арендатору этой аренды. */
  paymentDetails?: string;
  /** Адрес склада. До аренды он не нужен, после неё без него не приедешь. */
  address?: string;
  paidDeclaredAt: string | null;
  startedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  cancelReason: string;
  createdAt?: string;
}

export const apiRentCell = (cellId: string, days: number) =>
  post<{ rental: Rental }>(`/api/logistics/cells/${enc(cellId)}/rent`, { days });

export const apiMyRentals = () =>
  apiCall<{ rentals: Rental[] }>('/api/logistics/rentals');

export const apiWarehouseRentals = (warehouseId: string) =>
  apiCall<{ rentals: Rental[] }>(`/api/logistics/warehouses/${enc(warehouseId)}/rentals`);

export const apiMoveRental = (rentalId: string, action: 'declare-paid' | 'confirm-paid' | 'finish') =>
  post<{ rental: Rental }>(`/api/logistics/rentals/${enc(rentalId)}/${action}`);

export const apiCancelRental = (rentalId: string, reason?: string) =>
  post<{ rental: Rental }>(`/api/logistics/rentals/${enc(rentalId)}/cancel`, { reason });

export const apiMoveKey = (rentalId: string, state: KeyState, note?: string) =>
  post<{ rental: Rental }>(`/api/logistics/rentals/${enc(rentalId)}/key`, { state, note });
