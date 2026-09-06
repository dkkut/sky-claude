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

export interface Courier {
  id:               string;
  name:             string;
  avatar:           string;          // emoji-аватар
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
  location:         GeoPoint;        // текущая точка на карте
  updatedAt:        string;          // когда обновлялась геопозиция
  createdAt:        string;
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

export type CourierAssignmentStatus = 'assigned' | 'picked_up' | 'delivered' | 'cancelled';

export interface CourierAssignment {
  id:        string;
  orderId:   string;
  courierId: string;
  sellerId:  string;
  status:    CourierAssignmentStatus;
  assignedAt:string;
  updatedAt: string;
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
  location:  GeoPoint;
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
