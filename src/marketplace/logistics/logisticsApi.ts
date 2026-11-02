/**
 * Логистика: разговор с сервером.
 *
 * Здесь только вызовы. Ни одна проверка отсюда не заменяет серверную:
 * этот файл живёт в браузере, а браузер переписывается.
 *
 * Чего этот файл не отправляет никогда:
 *   · свою роль на складе и принадлежность компании — их сервер берёт
 *     из базы;
 *   · чужой курьерский профиль — «на связи» и точку на карте каждый
 *     ставит только про себя;
 *   · код пропуска в обход склада — сканирование всегда привязано к
 *     тому складу, на котором стоит сканирующий.
 */
import { apiCall, getAccessToken, uploadUrl } from '@/core/auth/api';
import { NATIVE_APP, MEDIA_BY_URL } from '@/core/nativeApp';
import { getMarketMediaTicket } from '../marketApi';
import type {
  Courier, CourierReview, CollabRequest, CollabStatus, CourierChatMessage,
  CourierAssignment, DeliveryNotification, CourierStatus,
  CourierVerification, VerificationQueueItem, AdminCourierListItem,
  CourierStats, CourierEarning, PoolOrder,
  Warehouse, WarehouseStockItem, WarehouseTransfer, WarehouseStaff, WarehouseLogEntry,
  AccessPass, PassVisitLog, PassSendLog, PassSendChannel,
  Shipment, ShipmentStatus, ShipmentLogEntry,
} from './types';
import type {
  TransportCompany, TCVehicle, TeamMember, DeliveryOrder,
  DeliveryTariff, FinanceEntry, LinkedWarehouse, VehicleStatus,
} from './transportTypes';

const enc = encodeURIComponent;
const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : '';
};

const post = <T>(path: string, body: unknown = {}) =>
  apiCall<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown = {}) =>
  apiCall<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string) => apiCall<T>(path, { method: 'DELETE' });

/* ─── Курьеры ─────────────────────────────────────────────────────── */

export const apiMyCourier = () => apiCall<{ courier: Courier | null }>('/api/logistics/courier/me');

export const apiRegisterCourier = (input: Partial<Courier> & { pricePerDelivery?: number }) =>
  post<{ courier: Courier }>('/api/logistics/courier/me', input);

export const apiUpdateCourier = (input: Partial<Courier>) =>
  patch<{ courier: Courier }>('/api/logistics/courier/me', input);

/** «На связи» и точка на карте — только про себя. */
export const apiCourierPresence = (input: { online?: boolean; lat?: number; lng?: number }) =>
  post<{ courier: Courier }>('/api/logistics/courier/presence', input);

export const apiCouriers = (filter: {
  cityId?: string; district?: string; vehicle?: string; online?: boolean; q?: string; limit?: number;
} = {}) => apiCall<{ couriers: (Courier & { favorite?: boolean })[] }>(
  `/api/logistics/couriers${q({ ...filter, online: filter.online ? '1' : undefined })}`);

export const apiCourier = (courierId: string) =>
  apiCall<{ courier: Courier & { favorite?: boolean; working?: boolean } }>(
    `/api/logistics/couriers/${enc(courierId)}`);

export const apiCourierFavorite = (courierId: string, on: boolean) =>
  apiCall<{ ok: true }>(`/api/logistics/couriers/${enc(courierId)}/favorite`,
    { method: on ? 'POST' : 'DELETE' });

export const apiCourierReviews = (courierId: string) =>
  apiCall<{ reviews: CourierReview[] }>(`/api/logistics/couriers/${enc(courierId)}/reviews`);

export const apiAddCourierReview = (courierId: string, rating: number, text: string) =>
  post<{ ok: true }>(`/api/logistics/couriers/${enc(courierId)}/review`, { rating, text });

export const apiSendCollab = (courierId: string, message: string) =>
  post<{ collab: CollabRequest }>(`/api/logistics/couriers/${enc(courierId)}/collab`, { message });

export const apiCollabs = () => apiCall<{ collabs: CollabRequest[] }>('/api/logistics/collabs');

export const apiRespondCollab = (collabId: string, status: CollabStatus) =>
  post<{ collab: CollabRequest }>(`/api/logistics/collabs/${enc(collabId)}`, { status });

export const apiCourierChat = (courierId: string, sellerId?: string) =>
  apiCall<{ messages: CourierChatMessage[] }>(
    `/api/logistics/couriers/${enc(courierId)}/chat${q({ sellerId })}`);

export const apiSendCourierMessage = (courierId: string, text: string, sellerId?: string) =>
  post<{ message: CourierChatMessage }>(`/api/logistics/couriers/${enc(courierId)}/chat`,
    { text, sellerId });

export const apiAssignments = (as: 'seller' | 'courier' = 'seller') =>
  apiCall<{ assignments: CourierAssignment[] }>(`/api/logistics/assignments${q({ as })}`);

export const apiAssignCourier = (orderId: string, courierId: string) =>
  post<{ assignment: CourierAssignment }>('/api/logistics/assignments', { orderId, courierId });

export const apiSetAssignmentStatus = (assignmentId: string, status: CourierAssignment['status']) =>
  post<{ assignment: CourierAssignment }>(`/api/logistics/assignments/${enc(assignmentId)}`, { status });

export const apiLogiNotifications = () =>
  apiCall<{ items: DeliveryNotification[] }>('/api/logistics/notifications');

export const apiReadLogiNotification = (id: string) =>
  post<{ ok: boolean }>('/api/logistics/notifications/read', { id });

export const apiReportAssignmentProblem = (assignmentId: string, reason: string) =>
  post<{ assignment: CourierAssignment; ticketId?: string }>(
    `/api/logistics/assignments/${enc(assignmentId)}/problem`, { reason });

/* ─── Пул заказов: продавец выставляет, курьер берёт сам ───────────── */

export const apiOpenPool = (limit?: number) =>
  apiCall<{ items: PoolOrder[] }>(`/api/logistics/pool${q({ limit })}`);

export const apiPostOrderToPool = (orderId: string, input: { priceKop: number; cityId: string; district: string }) =>
  post<{ assignment: CourierAssignment }>(`/api/logistics/pool/${enc(orderId)}`, input);

export const apiCancelPoolPosting = (orderId: string) =>
  del<{ assignment: CourierAssignment }>(`/api/logistics/pool/${enc(orderId)}`);

export const apiTakeOrder = (orderId: string) =>
  post<{ assignment: CourierAssignment }>(`/api/logistics/pool/${enc(orderId)}/take`);

/* ─── Получение от продавца / доставка покупателю — код или QR ─────── */

export const apiCourierConfirmPickup = (orderId: string, proof: string) =>
  post<{ ok: true }>(`/api/logistics/orders/${enc(orderId)}/courier-pickup`, { proof });

export const apiCourierConfirmDelivery = (orderId: string, proof: string) =>
  post<{ ok: true; earned: number }>(`/api/logistics/orders/${enc(orderId)}/courier-delivery`, { proof });

/* ─── Возраст и проверка паспорта ───────────────────────────────────── */

export const apiSetCourierBirthdate = (dateOfBirth: string) =>
  post<{ ok: true; age: number }>('/api/logistics/courier/birthdate', { dateOfBirth });

export const apiMyVerification = () =>
  apiCall<{ verification: CourierVerification | null }>('/api/logistics/courier/verification');

export const apiSubmitVerification = (fullName: string) =>
  post<{ verification: CourierVerification }>('/api/logistics/courier/verification', { fullName });

export const apiUploadVerificationDoc = (verificationId: string, file: Blob) =>
  apiCall<{ ok: true; mime: string; bytes: number }>(
    `/api/logistics/courier/verification/${enc(verificationId)}/doc`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });

export const apiCourierStats = () => apiCall<{ stats: CourierStats }>('/api/logistics/courier/stats');

export const apiCourierEarnings = (limit?: number) =>
  apiCall<{ items: CourierEarning[] }>(`/api/logistics/courier/earnings${q({ limit })}`);

/* ─── Админка: заявки курьеров и проверка паспорта ──────────────────── */

export const apiAdminListCouriers = (filter: { status?: string; q?: string; limit?: number } = {}) =>
  apiCall<{ items: AdminCourierListItem[] }>(`/api/logistics/admin/couriers${q(filter)}`);

export const apiAdminDecideCourier = (courierId: string, approve: boolean, reason?: string) =>
  post<{ courier: Courier }>(`/api/logistics/admin/couriers/${enc(courierId)}/decide`, { approve, reason });

export const apiAdminSetCourierStatus = (courierId: string, status: CourierStatus, reason?: string) =>
  post<{ courier: Courier }>(`/api/logistics/admin/couriers/${enc(courierId)}/status`, { status, reason });

export const apiAdminVerificationQueue = (limit?: number) =>
  apiCall<{ items: VerificationQueueItem[] }>(`/api/logistics/admin/verification-queue${q({ limit })}`);

export const apiAdminDecideVerification = (verificationId: string, approve: boolean, reason?: string) =>
  post<{ verification: CourierVerification }>(
    `/api/logistics/admin/verification/${enc(verificationId)}/decide`, { approve, reason });

/**
 * Скан документа для администратора — не публичная ссылка, а защищённый
 * запрос с тем же токеном, что и остальные вызовы: смотрит его только
 * тот, у кого есть право 'logistics', и каждый просмотр остаётся в
 * журнале (server/courierverify.mjs::verificationDocBytes).
 */
export const fetchVerificationDocBlob = async (verificationId: string) => {
  const token = getAccessToken();
  try {
    const res = await fetch(uploadUrl(`/api/logistics/admin/verification/${enc(verificationId)}/doc`), {
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return { ok: false as const };
    const blob = await res.blob();
    return { ok: true as const, blob, mime: res.headers.get('Content-Type') ?? blob.type };
  } catch {
    return { ok: false as const };
  }
};

/* ─── Склады ──────────────────────────────────────────────────────── */

export const apiWarehouses = () => apiCall<{ warehouses: Warehouse[] }>('/api/logistics/warehouses');

export const apiSortingCenters = () =>
  apiCall<{ centers: { id: string; name: string; cityId: string }[] }>('/api/logistics/sorting-centers');

export const apiCreateWarehouse = (input: Partial<Warehouse>) =>
  post<{ warehouse: Warehouse }>('/api/logistics/warehouses', input);

export const apiUpdateWarehouse = (id: string, input: Partial<Warehouse>) =>
  patch<{ warehouse: Warehouse }>(`/api/logistics/warehouses/${enc(id)}`, input);

export const apiDeleteWarehouse = (id: string) =>
  del<{ ok: true }>(`/api/logistics/warehouses/${enc(id)}`);

/**
 * Адрес фотографии. Путей на диске клиент не знает и знать не должен.
 *
 * Тег <img> заголовок авторизации не отправляет — в родном приложении
 * (страница и API на разных origin, кука SameSite=Strict туда не
 * доедет) вместо неё в адрес подставляется пропуск, полученный при
 * входе в маркет (см. marketApi.ts::getMarketMediaTicket).
 */
export const warehousePhotoUrl = (photoId: string) => {
  const url = uploadUrl(`/api/logistics/photos/${enc(photoId)}`);
  const ticket = getMarketMediaTicket();
  if (!MEDIA_BY_URL || !ticket) return url;
  return `${url}?t=${encodeURIComponent(ticket)}`;
};

export const apiUploadWarehousePhoto = (warehouseId: string, file: Blob) =>
  apiCall<{ ok: true; photoId: string }>(`/api/logistics/warehouses/${enc(warehouseId)}/photos`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });

export const apiDeleteWarehousePhoto = (photoId: string) =>
  del<{ ok: true }>(`/api/logistics/photos/${enc(photoId)}`);

export const apiStock = (warehouseId: string) =>
  apiCall<{ stock: WarehouseStockItem[]; fill: { occupied: number; capacity: number; free: number } }>(
    `/api/logistics/warehouses/${enc(warehouseId)}/stock`);

export const apiSetStock = (warehouseId: string, productId: string, productTitle: string, quantity: number) =>
  post<{ stock?: WarehouseStockItem; removed?: boolean }>(
    `/api/logistics/warehouses/${enc(warehouseId)}/stock`, { productId, productTitle, quantity });

export const apiTransfers = (warehouseId: string) =>
  apiCall<{ transfers: WarehouseTransfer[] }>(`/api/logistics/warehouses/${enc(warehouseId)}/transfers`);

export const apiCreateTransfer = (input: {
  fromWarehouseId: string; toWarehouseId: string;
  productId: string; productTitle: string; quantity: number;
}) => post<{ transfer: WarehouseTransfer }>('/api/logistics/transfers', input);

export const apiAdvanceTransfer = (id: string) =>
  post<{ transfer: WarehouseTransfer }>(`/api/logistics/transfers/${enc(id)}/advance`);

export const apiCancelTransfer = (id: string) =>
  post<{ transfer: WarehouseTransfer }>(`/api/logistics/transfers/${enc(id)}/cancel`);

export const apiStaff = (warehouseId: string) =>
  apiCall<{ staff: WarehouseStaff[] }>(`/api/logistics/warehouses/${enc(warehouseId)}/staff`);

export const apiAddStaff = (warehouseId: string, username: string, role: WarehouseStaff['role']) =>
  post<{ staff: WarehouseStaff }>(`/api/logistics/warehouses/${enc(warehouseId)}/staff`, { username, role });

export const apiRemoveStaff = (staffId: string) =>
  del<{ ok: true }>(`/api/logistics/staff/${enc(staffId)}`);

export const apiWarehouseLog = (warehouseId: string) =>
  apiCall<{ entries: WarehouseLogEntry[] }>(`/api/logistics/warehouses/${enc(warehouseId)}/log`);

/* ─── Пропуска ────────────────────────────────────────────────────── */

export const apiPasses = (warehouseId: string) =>
  apiCall<{ passes: AccessPass[] }>(`/api/logistics/warehouses/${enc(warehouseId)}/passes`);

export const apiCreatePass = (warehouseId: string, input: Partial<AccessPass>) =>
  post<{ pass: AccessPass }>(`/api/logistics/warehouses/${enc(warehouseId)}/passes`, input);

export const apiUpdatePass = (passId: string, input: Partial<AccessPass>) =>
  patch<{ pass: AccessPass }>(`/api/logistics/passes/${enc(passId)}`, input);

export const apiDeletePass = (passId: string) =>
  del<{ ok: true }>(`/api/logistics/passes/${enc(passId)}`);

/** Сканирование всегда привязано к складу: код ищут только среди его пропусков. */
export const apiScanPass = (warehouseId: string, code: string) =>
  post<{ ok: boolean; reason?: string; action?: 'entry' | 'exit'; pass?: AccessPass }>(
    `/api/logistics/warehouses/${enc(warehouseId)}/scan`, { code });

export const apiVisits = (warehouseId: string, passId?: string) =>
  apiCall<{ visits: PassVisitLog[] }>(
    `/api/logistics/warehouses/${enc(warehouseId)}/visits${q({ passId })}`);

export const apiSendPass = (passId: string, channel: PassSendChannel, target: string) =>
  post<{ send: PassSendLog }>(`/api/logistics/passes/${enc(passId)}/send`, { channel, target });

export const apiPassSends = (passId: string) =>
  apiCall<{ sends: PassSendLog[] }>(`/api/logistics/passes/${enc(passId)}/sends`);

/* ─── Поставки ────────────────────────────────────────────────────── */

export const apiSupplies = (search?: string) =>
  apiCall<{ supplies: Shipment[] }>(`/api/logistics/supplies${q({ q: search })}`);

export const apiSupply = (id: string) =>
  apiCall<{ supply: Shipment }>(`/api/logistics/supplies/${enc(id)}`);

export const apiCreateSupply = (input: Partial<Shipment>) =>
  post<{ supply: Shipment }>('/api/logistics/supplies', input);

export const apiUpdateSupply = (id: string, input: Partial<Shipment>) =>
  patch<{ supply: Shipment }>(`/api/logistics/supplies/${enc(id)}`, input);

export const apiSetSupplyStatus = (id: string, status: ShipmentStatus) =>
  post<{ supply: Shipment }>(`/api/logistics/supplies/${enc(id)}/status`, { status });

export const apiSetSupplyCenter = (id: string, sortingCenterId: string | null) =>
  post<{ supply: Shipment }>(`/api/logistics/supplies/${enc(id)}/sorting-center`, { sortingCenterId });

export const apiDeleteSupply = (id: string) =>
  del<{ ok: true }>(`/api/logistics/supplies/${enc(id)}`);

export const apiSupplyLog = (id: string) =>
  apiCall<{ entries: ShipmentLogEntry[] }>(`/api/logistics/supplies/${enc(id)}/log`);

/* ─── Транспортные компании ───────────────────────────────────────── */

export const apiMyTransportCompany = () =>
  apiCall<{ company: TransportCompany | null }>('/api/logistics/company');

export const apiCreateTransportCompany = (input: Partial<TransportCompany>) =>
  post<{ company: TransportCompany }>('/api/logistics/company', input);

export const apiUpdateTransportCompany = (id: string, input: Partial<TransportCompany>) =>
  patch<{ company: TransportCompany }>(`/api/logistics/companies/${enc(id)}`, input);

export const apiTransportCompanies = (city?: string) =>
  apiCall<{ companies: TransportCompany[] }>(`/api/logistics/companies${q({ city })}`);

export const apiVehicles = (companyId: string) =>
  apiCall<{ vehicles: TCVehicle[] }>(`/api/logistics/companies/${enc(companyId)}/vehicles`);

export const apiAddVehicle = (companyId: string, input: Partial<TCVehicle>) =>
  post<{ vehicle: TCVehicle }>(`/api/logistics/companies/${enc(companyId)}/vehicles`, input);

export const apiSetVehicleStatus = (vehicleId: string, status: VehicleStatus) =>
  post<{ vehicle: TCVehicle }>(`/api/logistics/vehicles/${enc(vehicleId)}/status`, { status });

export const apiAssignDriver = (vehicleId: string, driverId: string | null) =>
  post<{ vehicle: TCVehicle }>(`/api/logistics/vehicles/${enc(vehicleId)}/driver`, { driverId });

export const apiRemoveVehicle = (vehicleId: string) =>
  del<{ ok: true }>(`/api/logistics/vehicles/${enc(vehicleId)}`);

export const apiTeam = (companyId: string) =>
  apiCall<{ team: TeamMember[] }>(`/api/logistics/companies/${enc(companyId)}/team`);

export const apiAddMember = (companyId: string, input: Partial<TeamMember>) =>
  post<{ member: TeamMember }>(`/api/logistics/companies/${enc(companyId)}/team`, input);

export const apiToggleMember = (memberId: string) =>
  post<{ member: TeamMember }>(`/api/logistics/members/${enc(memberId)}/toggle`);

export const apiRemoveMember = (memberId: string) =>
  del<{ ok: true }>(`/api/logistics/members/${enc(memberId)}`);

export const apiCompanyOrders = (companyId: string) =>
  apiCall<{ orders: DeliveryOrder[] }>(`/api/logistics/companies/${enc(companyId)}/orders`);

export const apiSellerDeliveryOrders = () =>
  apiCall<{ orders: DeliveryOrder[] }>('/api/logistics/delivery-orders');

export const apiExchange = () => apiCall<{ orders: DeliveryOrder[] }>('/api/logistics/exchange');

export const apiCreateDeliveryOrder = (input: Partial<DeliveryOrder>) =>
  post<{ order: DeliveryOrder }>('/api/logistics/delivery-orders', input);

export const apiAcceptExchange = (orderId: string) =>
  post<{ order: DeliveryOrder }>(`/api/logistics/delivery-orders/${enc(orderId)}/accept`);

export const apiProposePrice = (orderId: string, price: number) =>
  post<{ order: DeliveryOrder }>(`/api/logistics/delivery-orders/${enc(orderId)}/propose`, { price });

export const apiAnswerOffer = (orderId: string, approve: boolean) =>
  post<{ order: DeliveryOrder }>(`/api/logistics/delivery-orders/${enc(orderId)}/offer`, { approve });

export const apiAssignDeliveryOrder = (orderId: string, vehicleId: string, driverId: string | null) =>
  post<{ order: DeliveryOrder }>(`/api/logistics/delivery-orders/${enc(orderId)}/assign`,
    { vehicleId, driverId });

export const apiAdvanceDeliveryOrder = (orderId: string) =>
  post<{ order: DeliveryOrder }>(`/api/logistics/delivery-orders/${enc(orderId)}/advance`);

export const apiCancelDeliveryOrder = (orderId: string) =>
  post<{ order: DeliveryOrder }>(`/api/logistics/delivery-orders/${enc(orderId)}/cancel`);

export const apiTariffs = (companyId: string) =>
  apiCall<{ tariffs: DeliveryTariff[] }>(`/api/logistics/companies/${enc(companyId)}/tariffs`);

export const apiAddTariff = (companyId: string, input: Partial<DeliveryTariff>) =>
  post<{ id: string }>(`/api/logistics/companies/${enc(companyId)}/tariffs`, input);

export const apiRemoveTariff = (tariffId: string) =>
  del<{ ok: true }>(`/api/logistics/tariffs/${enc(tariffId)}`);

export const apiFinance = (companyId: string) =>
  apiCall<{ entries: FinanceEntry[] }>(`/api/logistics/companies/${enc(companyId)}/finance`);

export const apiCompanyWarehouses = (companyId: string) =>
  apiCall<{ warehouses: LinkedWarehouse[] }>(`/api/logistics/companies/${enc(companyId)}/warehouses`);

export const apiLinkCompanyWarehouse = (companyId: string, input: Partial<LinkedWarehouse>) =>
  post<{ id: string }>(`/api/logistics/companies/${enc(companyId)}/warehouses`, input);

export const apiUnlinkCompanyWarehouse = (linkId: string) =>
  del<{ ok: true }>(`/api/logistics/company-warehouses/${enc(linkId)}`);
