/* ======================================================================
   SKY MARKET / LOGISTICS  —  Types
   Курьеры · Склады · Пропуска и доступы
====================================================================== */

/* ── Геопомощники ─────────────────────────────────────────────────── */
export interface GeoPoint { lat: number; lng: number; }

export interface City {
  id: string;
  name: string;
  center: GeoPoint;
  districts: string[];
}

/* ══════════════════════════════════════════════════════════════════
   КУРЬЕРЫ
══════════════════════════════════════════════════════════════════ */
export type CourierVehicle = 'foot' | 'bike' | 'scooter' | 'car' | 'van';

/**
 * Статус допуска решает только администратор (server/logistics.mjs::
 * decideCourierApplication/setCourierAdminStatus) — courier_id никогда
 * не выставляет его себе сам.
 */
export type CourierStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface Courier {
  id:               string;
  name:             string;
  phone:            string;
  cityId:           string;
  district:         string;
  vehicle:          CourierVehicle;
  rating:           number;          // 0-5
  reviewCount:      number;
  deliveriesCount:  number;          // выполненных доставок
  pricePerDelivery: number;          // ₽ за доставку
  workFrom:         string;          // "09:00"
  workTo:           string;          // "21:00"
  online:           boolean;
  bio:              string;
  status:           CourierStatus;
  statusReason?:    string;
  location:         GeoPoint;        // текущая точка на карте
  updatedAt:        string;          // когда обновлялась геопозиция
  createdAt:        string;
}

/** Заявка курьера в очереди администратора: профиль плюс возраст, посчитанный сервером. */
export interface AdminCourierListItem extends Courier {
  age: number | null;
}

/* ── Проверка личности: возраст и паспорт ─────────────────────────── */
export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'expired' | 'invalid';

export interface CourierVerification {
  id:          string;
  profileId:   string;
  status:      VerificationStatus;
  rejectReason?: string;
  reviewedAt?: string;
  createdAt:   string;
  updatedAt:   string;
  hasDoc:      boolean;
}

/** Заявка на проверку в очереди администратора. */
export interface VerificationQueueItem extends CourierVerification {
  profileName: string;
  username:    string;
  age:         number | null;
  fullName:    string;
}

export interface CourierStats {
  deliveredCount: number;
  cancelledCount: number;
  activeCount:    number;
  totalEarned:    number;   // ₽
  rating:         number;
}

export interface CourierEarning {
  id:        string;
  orderId:   string;
  orderTitle:string;
  amount:    number;  // ₽
  createdAt: string;
}

export interface CourierReview {
  id:         string;
  courierId:  string;
  sellerId:   string;
  sellerName: string;
  rating:     number;
  text:       string;
  createdAt:  string;
}

export type CollabStatus = 'pending' | 'accepted' | 'declined' | 'ended';

export interface CollabRequest {
  id:          string;
  courierId:   string;
  sellerId:    string;
  message:     string;
  status:      CollabStatus;
  createdAt:   string;
  respondedAt?:string;
}

export interface CourierChatMessage {
  id:        string;
  courierId: string;
  sellerId:  string;
  from:      'seller' | 'courier';
  text:      string;
  createdAt: string;
}

export type DeliveryEventType = 'accepted' | 'on_way' | 'delivered' | 'cancelled';

export interface DeliveryNotification {
  id:        string;
  courierId: string;
  sellerId:  string;
  orderId?:  string;
  type:      DeliveryEventType;
  text:      string;
  read:      boolean;
  createdAt: string;
}

export type CourierAssignmentStatus =
  | 'open'        // выставлен в пул продавцом, курьер ещё не выбран
  | 'assigned'    // отдан конкретному курьеру (продавцом или взят из пула)
  | 'picked_up'   // курьер получил отправление от продавца (QR)
  | 'in_transit'  // в пути к получателю
  | 'delivered'   // доставлено, подтверждено кодом получателя
  | 'cancelled'
  | 'problem';    // курьер сообщил о проблеме — открыт тикет в поддержку

export interface CourierAssignment {
  id:           string;
  orderId:      string;
  courierId:    string | null;   // пусто, пока заказ лежит в пуле
  sellerId:     string;
  status:       CourierAssignmentStatus;
  cityId:       string;
  district:     string;
  price:        number;          // ₽, курьеру за доставку
  problemReason?: string;
  ticketId?:    string;
  assignedAt:   string;
  pickedUpAt?:  string;
  deliveredAt?: string;
  updatedAt:    string;
}

/** Заказ в пуле — то же поручение плюс заголовок и сумма товара для списка. */
export interface PoolOrder extends CourierAssignment {
  orderTitle: string;
  orderTotal: number;
}

/* ══════════════════════════════════════════════════════════════════
   СКЛАДЫ
══════════════════════════════════════════════════════════════════ */
export type WeekDay = 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun';

export interface DaySchedule {
  day:    WeekDay;
  closed: boolean;
  from:   string;   // "09:00"
  to:     string;   // "21:00"
}

export interface Warehouse {
  id:        string;
  sellerId:  string;
  name:      string;
  address:   string;
  cityId:    string;
  /** Точка на карте. Пусто — место ещё не задано; на карту такой склад
      не попадёт, и это честнее выдуманной координаты. */
  location:  GeoPoint | null;
  photos:    string[];          // data-url
  schedule:  DaySchedule[];
  capacity:  number;            // вместимость, ед. товара
  role?:     'own' | 'sorting_center';  // 'sorting_center' — виден в выборе при создании поставки
  createdAt: string;
}

export interface WarehouseStockItem {
  id:          string;
  warehouseId: string;
  productId:   string;
  productTitle:string;
  quantity:    number;
}

export type TransferStatus = 'pending' | 'in_transit' | 'done' | 'cancelled';

export interface WarehouseTransfer {
  id:             string;
  fromWarehouseId:string;
  toWarehouseId:  string;
  productId:      string;
  productTitle:   string;
  quantity:       number;
  status:         TransferStatus;
  createdAt:      string;
  completedAt?:   string;
}

export type StaffRole = 'manager' | 'worker';

export interface WarehouseStaff {
  id:          string;
  warehouseId: string;
  accountId:   string;
  name:        string;
  username:    string;
  role:        StaffRole;
  assignedAt:  string;
}

export type WarehouseLogType =
  | 'created' | 'updated'
  | 'stock_in' | 'stock_out' | 'transfer_out' | 'transfer_in'
  | 'staff_added' | 'staff_removed' | 'courier_linked';

export interface WarehouseLogEntry {
  id:          string;
  warehouseId: string;
  type:        WarehouseLogType;
  text:        string;
  createdAt:   string;
}

/* ══════════════════════════════════════════════════════════════════
   ПОСТАВКИ  (разметка / наклейки)
══════════════════════════════════════════════════════════════════ */
export type ShipmentStatus =
  | 'draft'               // черновик, ещё не отправлена
  | 'preparing'           // формируется/собирается
  | 'in_transit'          // в пути
  | 'at_sorting_center'   // прибыла на сортировочный центр
  | 'delivered'           // доставлена / принята
  | 'cancelled';          // отменена

export interface Shipment {
  id:               string;
  number:           string;          // "SKY-SHP-XXXXXX" — читаемый номер поставки
  code:             string;          // короткий уникальный код для QR/поиска
  sellerId:         string;
  name:             string;          // название поставки
  senderName:       string;          // отправитель
  senderAddress?:   string;
  recipientName:    string;          // получатель
  recipientAddress?:string;
  placesCount:      number;          // количество мест
  weightKg?:         number;
  volumeM3?:          number;
  sortingCenterId:  string | null;   // Warehouse.id (role: 'sorting_center')
  sortingCenterName?:string;         // снимок названия на момент печати наклейки
  status:           ShipmentStatus;
  createdAt:        string;
  updatedAt:        string;
}

export type ShipmentLogType =
  | 'created' | 'updated' | 'status_changed'
  | 'sorting_center_changed' | 'label_printed' | 'cancelled';

export interface ShipmentLogEntry {
  id:         string;
  shipmentId: string;
  type:       ShipmentLogType;
  text:       string;
  createdAt:  string;
}

/* ══════════════════════════════════════════════════════════════════
   ПРОПУСКА И ДОСТУПЫ
══════════════════════════════════════════════════════════════════ */
export type AccessLevel = 'guest' | 'employee' | 'manager' | 'owner';
export type PassType    = 'temporary' | 'permanent';

export interface AccessPass {
  id:             string;
  warehouseId:    string;
  sellerId:       string;
  holderName:     string;
  holderContact:  string;     // телефон или email
  accessLevel:    AccessLevel;
  type:           PassType;
  code:           string;     // уникальный код, зашит в QR
  validFrom:      string;
  validUntil:     string|null; // null = постоянный
  active:         boolean;    // false = заблокирован
  createdAt:      string;
}

export type PassVisitAction = 'entry' | 'exit';

export interface PassVisitLog {
  id:          string;
  passId:      string;
  warehouseId: string;
  action:      PassVisitAction;
  confirmedBy: 'qr_scan' | 'manual';
  at:          string;
}

export type PassSendChannel = 'sms' | 'email' | 'chat';

export interface PassSendLog {
  id:        string;
  passId:    string;
  channel:   PassSendChannel;
  target:    string;
  sentAt:    string;
}
