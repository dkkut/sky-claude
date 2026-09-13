import type { GeoPoint, WeekDay } from './types';

export type TransportKind = 'courier'|'car'|'truck'|'van'|'special'|'moto';
export const TRANSPORT_KIND_LABEL: Record<TransportKind,string> = {
  courier:'Курьерская доставка', car:'Легковые автомобили', truck:'Грузовые автомобили',
  van:'Фургоны', special:'Спецтранспорт', moto:'Мото/велокурьеры',
};

export interface TransportCompany {
  id: string;
  ownerId: string;
  name: string;
  logoHue: number;
  description: string;
  city: string;
  regions: string[];
  contactPhone: string;
  contactEmail: string;
  workDays: WeekDay[];
  workFrom: string; // "09:00"
  workTo: string;   // "21:00"
  weekendDelivery: boolean;
  transportKinds: TransportKind[];
  zones: string[];
  minPrice: number;
  pricePerKm: number;
  maxWeightKg: number;
  maxVolumeM3: number;
  deliveryTimeHours: number;
  verified: boolean;
  /** Есть ли куда платить. Признак виден всем, сами реквизиты — нет. */
  hasPaymentDetails?: boolean;
  /** Только в своём профиле компании. */
  paymentDetails?: string;
  rating: number;          // 0..5
  completedDeliveries: number;
  successRatePct: number;  // 0..100
  createdAt: string;
}

export type VehicleStatus = 'available'|'busy'|'maintenance'|'disabled';
export interface TCVehicle {
  id: string;
  companyId: string;
  photoHue: number;
  brand: string;
  model: string;
  plateNumber: string;
  kind: TransportKind;
  capacityKg: number;
  volumeM3: number;
  status: VehicleStatus;
  driverId: string | null;
  currentLoadKg: number;
}

export type TeamRole = 'driver'|'courier'|'dispatcher';
export interface TeamMember {
  id: string;
  companyId: string;
  name: string;
  phone: string;
  role: TeamRole;
  vehicleId: string | null;
  rating: number;
  completedDeliveries: number;
  active: boolean;
  joinedAt: string;
}

export type DeliveryStatus = 'new'|'assigned'|'in_progress'|'completed'|'cancelled'|'problem';
export interface DeliveryOrder {
  id: string;
  companyId: string | null;   // null = ещё не разобран / доступен на бирже
  sellerId: string;
  sellerName: string;
  productName: string;
  qty: number;
  weightKg: number;
  fromAddress: string;
  toAddress: string;
  distanceKm: number;
  price: number;              // стоимость доставки
  driverId: string | null;
  vehicleId: string | null;
  status: DeliveryStatus;
  isExchange: boolean;        // доступен другим ТК на бирже доставок
  proposedPrice?: number;     // встречное предложение цены от ТК
  offerCompanyId?: string | null;    // какая ТК предложила свою цену — ждёт решения продавца
  offerCompanyName?: string;
  createdAt: string;
  etaHours: number;
}

export interface DeliveryTariff {
  id: string;
  companyId: string;
  name: string;
  maxWeightKg: number;
  basePrice: number;
  description: string;
  express: boolean;
}

export interface FinanceEntry {
  id: string;
  companyId: string;
  orderId: string;
  amount: number;
  at: string;
}

export interface LinkedWarehouse {
  id: string;
  companyId: string;
  warehouseName: string;
  address: string;
  own: boolean; // собственный склад ТК или привязка к складу продавца
}
