import { create } from 'zustand';
import type {
  TransportCompany, TCVehicle, TeamMember, DeliveryOrder, DeliveryTariff, FinanceEntry,
  LinkedWarehouse, VehicleStatus,
} from './transportTypes';

const KEY = 'sky:transportCompany:v1';
const W = typeof window !== 'undefined';
const load = () => { if (!W) return null; try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const save = (d: object) => { if (!W) return; try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
const genId = (p: string) => `${p}-${crypto.randomUUID().slice(0,8)}`;
const nowISO = () => new Date().toISOString();

// -- Демонстрационные сторонние заказы на бирже доставок (от других продавцов) --
const seedExchangeOrders = (): DeliveryOrder[] => [
  { id: genId('ord'), companyId: null, sellerId: 'acc-luna', sellerName: 'Luna Nova', productName: 'Коробка аксессуаров', qty: 3, weightKg: 8, fromAddress: 'Склад №2, ул. Заречная 14', toAddress: 'ПВЗ «Центральный», пр. Мира 5', distanceKm: 6.4, price: 420, driverId: null, vehicleId: null, status: 'new', isExchange: true, createdAt: nowISO(), etaHours: 3 },
  { id: genId('ord'), companyId: null, sellerId: 'acc-neo', sellerName: 'Neo Driver', productName: 'Комплектующие для дрифт-кара', qty: 1, weightKg: 42, fromAddress: 'Склад №1, Промзона 7', toAddress: 'ул. Ленина 20', distanceKm: 12.1, price: 890, driverId: null, vehicleId: null, status: 'new', isExchange: true, createdAt: nowISO(), etaHours: 5 },
  { id: genId('ord'), companyId: null, sellerId: 'acc-kutuzov', sellerName: 'Sky Admin Market', productName: 'Палета товаров', qty: 40, weightKg: 310, fromAddress: 'Центральный склад', toAddress: 'ПВЗ «Южный»', distanceKm: 18.7, price: 2100, driverId: null, vehicleId: null, status: 'new', isExchange: true, createdAt: nowISO(), etaHours: 8 },
];

interface TransportState {
  companies: TransportCompany[];
  vehicles: TCVehicle[];
  team: TeamMember[];
  orders: DeliveryOrder[];
  tariffs: DeliveryTariff[];
  finance: FinanceEntry[];
  warehouses: LinkedWarehouse[];

  companyByOwner: (ownerId: string) => TransportCompany | null;
  createCompany: (ownerId: string, p: Omit<TransportCompany, 'id'|'ownerId'|'verified'|'rating'|'completedDeliveries'|'successRatePct'|'createdAt'>) => TransportCompany;

  vehiclesFor: (companyId: string) => TCVehicle[];
  addVehicle: (companyId: string, p: Omit<TCVehicle,'id'|'companyId'|'status'|'driverId'|'currentLoadKg'>) => void;
  updateVehicleStatus: (vehicleId: string, status: VehicleStatus) => void;
  assignDriverToVehicle: (vehicleId: string, driverId: string | null) => void;
  removeVehicle: (vehicleId: string) => void;

  teamFor: (companyId: string) => TeamMember[];
  addTeamMember: (companyId: string, p: Omit<TeamMember,'id'|'companyId'|'rating'|'completedDeliveries'|'active'|'joinedAt'>) => void;
  toggleTeamActive: (memberId: string) => void;
  removeTeamMember: (memberId: string) => void;

  ordersFor: (companyId: string) => DeliveryOrder[];
  exchangeOrders: () => DeliveryOrder[];
  createOrderFromMarketplace: (companyId: string, p: { sellerId: string; sellerName: string; productName: string; qty: number; weightKg: number; fromAddress: string; toAddress: string; price: number; distanceKm: number }) => void;
  acceptExchangeOrder: (orderId: string, companyId: string) => void;
  declineExchangeOrder: (orderId: string) => void;
  proposePrice: (orderId: string, companyId: string, companyName: string, price: number) => void;
  approveOffer: (orderId: string) => void;
  rejectOffer: (orderId: string) => void;
  offersForSeller: (sellerId: string) => DeliveryOrder[];
  suggestAssignment: (companyId: string, orderId: string) => { vehicle: TCVehicle; driver: TeamMember | null } | null;
  assignOrder: (orderId: string, vehicleId: string, driverId: string | null) => void;
  advanceOrderStatus: (orderId: string) => void;
  cancelOrder: (orderId: string) => void;

  tariffsFor: (companyId: string) => DeliveryTariff[];
  addTariff: (companyId: string, p: Omit<DeliveryTariff,'id'|'companyId'>) => void;
  removeTariff: (tariffId: string) => void;

  financeFor: (companyId: string) => FinanceEntry[];

  warehousesFor: (companyId: string) => LinkedWarehouse[];
  linkWarehouse: (companyId: string, p: Omit<LinkedWarehouse,'id'|'companyId'>) => void;
  unlinkWarehouse: (warehouseId: string) => void;
}

export const useTransportStore = create<TransportState>((set, get) => {
  const stored = load();

  const flush = () => {
    const s = get();
    save({ companies: s.companies, vehicles: s.vehicles, team: s.team, orders: s.orders, tariffs: s.tariffs, finance: s.finance, warehouses: s.warehouses });
  };
  const mut = (fn: (s: TransportState) => Partial<TransportState>) => { set(s => ({ ...s, ...fn(s) })); flush(); };

  return {
    companies:  stored?.companies  ?? [],
    vehicles:   stored?.vehicles   ?? [],
    team:       stored?.team       ?? [],
    orders:     stored?.orders     ?? seedExchangeOrders(),
    tariffs:    stored?.tariffs    ?? [],
    finance:    stored?.finance    ?? [],
    warehouses: stored?.warehouses ?? [],

    companyByOwner: (ownerId) => get().companies.find(c => c.ownerId === ownerId) ?? null,
    createCompany: (ownerId, p) => {
      const company: TransportCompany = {
        ...p, id: genId('tc'), ownerId, verified: false, rating: 4.6,
        completedDeliveries: 0, successRatePct: 100, createdAt: nowISO(),
      };
      mut(s => ({ companies: [...s.companies, company] }));
      return company;
    },

    vehiclesFor: (companyId) => get().vehicles.filter(v => v.companyId === companyId),
    addVehicle: (companyId, p) => mut(s => ({
      vehicles: [...s.vehicles, { ...p, id: genId('veh'), companyId, status: 'available', driverId: null, currentLoadKg: 0 }],
    })),
    updateVehicleStatus: (vehicleId, status) => mut(s => ({
      vehicles: s.vehicles.map(v => v.id === vehicleId ? { ...v, status } : v),
    })),
    assignDriverToVehicle: (vehicleId, driverId) => mut(s => ({
      vehicles: s.vehicles.map(v => v.id === vehicleId ? { ...v, driverId } : v),
      team: s.team.map(m => m.id === driverId ? { ...m, vehicleId } : m),
    })),
    removeVehicle: (vehicleId) => mut(s => ({ vehicles: s.vehicles.filter(v => v.id !== vehicleId) })),

    teamFor: (companyId) => get().team.filter(m => m.companyId === companyId),
    addTeamMember: (companyId, p) => mut(s => ({
      team: [...s.team, { ...p, id: genId('tm'), companyId, rating: 4.8, completedDeliveries: 0, active: true, joinedAt: nowISO() }],
    })),
    toggleTeamActive: (memberId) => mut(s => ({ team: s.team.map(m => m.id === memberId ? { ...m, active: !m.active } : m) })),
    removeTeamMember: (memberId) => mut(s => ({ team: s.team.filter(m => m.id !== memberId) })),

    ordersFor: (companyId) => get().orders.filter(o => o.companyId === companyId),
    exchangeOrders: () => get().orders.filter(o => o.isExchange && o.companyId === null && o.status === 'new'),
    createOrderFromMarketplace: (companyId, p) => mut(s => ({
      orders: [...s.orders, {
        id: genId('ord'), companyId, sellerId: p.sellerId, sellerName: p.sellerName,
        productName: p.productName, qty: p.qty, weightKg: p.weightKg,
        fromAddress: p.fromAddress, toAddress: p.toAddress, distanceKm: p.distanceKm,
        price: p.price, driverId: null, vehicleId: null, status: 'new' as const,
        isExchange: false, createdAt: nowISO(), etaHours: 24,
      }],
    })),

    acceptExchangeOrder: (orderId, companyId) => mut(s => ({
      orders: s.orders.map(o => o.id === orderId ? { ...o, companyId, status: 'new' as const, isExchange: false } : o),
    })),
    declineExchangeOrder: (orderId) => mut(s => ({ orders: s.orders.filter(o => o.id !== orderId) })),
    // Предложение своей цены НЕ принимается автоматически — заказ ждёт
    // решения продавца (owner заявки), пока тот не одобрит или отклонит.
    proposePrice: (orderId, companyId, companyName, price) => mut(s => ({
      orders: s.orders.map(o => o.id === orderId ? { ...o, proposedPrice: price, offerCompanyId: companyId, offerCompanyName: companyName } : o),
    })),
    approveOffer: (orderId) => mut(s => ({
      orders: s.orders.map(o => o.id === orderId && o.offerCompanyId
        ? { ...o, companyId: o.offerCompanyId, status: 'new' as const, isExchange: false }
        : o),
    })),
    rejectOffer: (orderId) => mut(s => ({
      orders: s.orders.map(o => o.id === orderId ? { ...o, offerCompanyId: null, offerCompanyName: undefined, proposedPrice: undefined } : o),
    })),
    offersForSeller: (sellerId) => get().orders.filter(o => o.sellerId === sellerId && !!o.offerCompanyId),

    // Простая эвристика подбора: свободный транспорт нужной грузоподъёмности
    // с наименьшей текущей загрузкой + активный водитель без своей машины/с этим ТС.
    suggestAssignment: (companyId, orderId) => {
      const order = get().orders.find(o => o.id === orderId); if (!order) return null;
      const candidates = get().vehicles
        .filter(v => v.companyId === companyId && v.status === 'available' && v.capacityKg >= order.weightKg)
        .sort((a, b) => a.currentLoadKg - b.currentLoadKg);
      const vehicle = candidates[0]; if (!vehicle) return null;
      const driver = get().team.find(m => m.id === vehicle.driverId && m.active)
        ?? get().team.find(m => m.companyId === companyId && m.role !== 'dispatcher' && m.active && !m.vehicleId)
        ?? null;
      return { vehicle, driver };
    },

    assignOrder: (orderId, vehicleId, driverId) => mut(s => ({
      orders: s.orders.map(o => o.id === orderId ? { ...o, vehicleId, driverId, status: 'assigned' as const } : o),
      vehicles: s.vehicles.map(v => v.id === vehicleId ? { ...v, status: 'busy' as const } : v),
    })),

    advanceOrderStatus: (orderId) => mut(s => {
      const order = s.orders.find(o => o.id === orderId); if (!order) return {};
      const next = order.status === 'assigned' ? 'in_progress' : order.status === 'in_progress' ? 'completed' : order.status;
      const finance = next === 'completed'
        ? [...s.finance, { id: genId('fin'), companyId: order.companyId!, orderId: order.id, amount: order.proposedPrice ?? order.price, at: nowISO() }]
        : s.finance;
      const companies = next === 'completed'
        ? s.companies.map(c => c.id === order.companyId ? { ...c, completedDeliveries: c.completedDeliveries + 1 } : c)
        : s.companies;
      const vehicles = next === 'completed' && order.vehicleId
        ? s.vehicles.map(v => v.id === order.vehicleId ? { ...v, status: 'available' as const } : v)
        : s.vehicles;
      const team = next === 'completed' && order.driverId
        ? s.team.map(m => m.id === order.driverId ? { ...m, completedDeliveries: m.completedDeliveries + 1 } : m)
        : s.team;
      return { orders: s.orders.map(o => o.id === orderId ? { ...o, status: next } : o), finance, companies, vehicles, team };
    }),
    cancelOrder: (orderId) => mut(s => ({ orders: s.orders.map(o => o.id === orderId ? { ...o, status: 'cancelled' as const } : o) })),

    tariffsFor: (companyId) => get().tariffs.filter(t => t.companyId === companyId),
    addTariff: (companyId, p) => mut(s => ({ tariffs: [...s.tariffs, { ...p, id: genId('tar'), companyId }] })),
    removeTariff: (tariffId) => mut(s => ({ tariffs: s.tariffs.filter(t => t.id !== tariffId) })),

    financeFor: (companyId) => get().finance.filter(f => f.companyId === companyId),

    warehousesFor: (companyId) => get().warehouses.filter(w => w.companyId === companyId),
    linkWarehouse: (companyId, p) => mut(s => ({ warehouses: [...s.warehouses, { ...p, id: genId('wh'), companyId }] })),
    unlinkWarehouse: (warehouseId) => mut(s => ({ warehouses: s.warehouses.filter(w => w.id !== warehouseId) })),
  };
});
