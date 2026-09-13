/* ======================================================================
   SKY MARKET / LOGISTICS — транспортные компании

   Хранилище стало кэшем ответов сервера. Раньше компания, её парк,
   команда и биржа доставок жили в localStorage: биржа показывала
   выдуманные заказы, а чужую машину можно было отправить в рейс,
   просто нарисовав кнопку.

   Имена функций прежние — экраны не переписаны. Изменилось то, что
   любое действие теперь проверяется на сервере: принадлежность
   компании, машины и водителя берётся из базы, а не из присланного
   идентификатора.
====================================================================== */
import { create } from 'zustand';
import type {
  TransportCompany, TCVehicle, TeamMember, DeliveryOrder, DeliveryTariff, FinanceEntry,
  LinkedWarehouse, VehicleStatus,
} from './transportTypes';
import {
  apiMyTransportCompany, apiCreateTransportCompany, apiUpdateTransportCompany,
  apiVehicles, apiAddVehicle, apiSetVehicleStatus, apiAssignDriver, apiRemoveVehicle,
  apiTeam, apiAddMember, apiToggleMember, apiRemoveMember,
  apiCompanyOrders, apiSellerDeliveryOrders, apiExchange, apiCreateDeliveryOrder,
  apiAcceptExchange, apiProposePrice, apiAnswerOffer, apiAssignDeliveryOrder,
  apiAdvanceDeliveryOrder, apiCancelDeliveryOrder,
  apiTariffs, apiAddTariff, apiRemoveTariff, apiFinance,
  apiCompanyWarehouses, apiLinkCompanyWarehouse, apiUnlinkCompanyWarehouse,
} from './logisticsApi';

interface TransportState {
  companies: TransportCompany[];
  vehicles: TCVehicle[];
  team: TeamMember[];
  orders: DeliveryOrder[];
  exchange: DeliveryOrder[];
  tariffs: DeliveryTariff[];
  finance: FinanceEntry[];
  warehouses: LinkedWarehouse[];
  myCompanyId: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  loadCompany: (companyId: string) => Promise<void>;

  companyByOwner: (ownerId: string) => TransportCompany | null;
  createCompany: (ownerId: string, p: Partial<TransportCompany>) => Promise<TransportCompany | null>;
  updateCompany: (companyId: string, p: Partial<TransportCompany>) => Promise<void>;

  vehiclesFor: (companyId: string) => TCVehicle[];
  addVehicle: (companyId: string, p: Partial<TCVehicle>) => Promise<void>;
  updateVehicleStatus: (vehicleId: string, status: VehicleStatus) => Promise<void>;
  assignDriverToVehicle: (vehicleId: string, driverId: string | null) => Promise<void>;
  removeVehicle: (vehicleId: string) => Promise<void>;

  teamFor: (companyId: string) => TeamMember[];
  addTeamMember: (companyId: string, p: Partial<TeamMember>) => Promise<void>;
  toggleTeamActive: (memberId: string) => Promise<void>;
  removeTeamMember: (memberId: string) => Promise<void>;

  ordersFor: (companyId: string) => DeliveryOrder[];
  exchangeOrders: () => DeliveryOrder[];
  createOrderFromMarketplace: (companyId: string | null, p: Partial<DeliveryOrder>) => Promise<void>;
  acceptExchangeOrder: (orderId: string) => Promise<void>;
  declineExchangeOrder: (orderId: string) => void;
  proposePrice: (orderId: string, companyId: string, companyName: string, price: number) => Promise<void>;
  approveOffer: (orderId: string) => Promise<void>;
  rejectOffer: (orderId: string) => Promise<void>;
  offersForSeller: (sellerId: string) => DeliveryOrder[];

  /**
   * Подсказка, кого отправить.
   *
   * Именно подсказка: сервер всё равно проверит и принадлежность, и
   * грузоподъёмность, когда заказ будут назначать.
   */
  suggestAssignment: (companyId: string, orderId: string) =>
  { vehicle: TCVehicle; driver: TeamMember | null } | null;
  assignOrder: (orderId: string, vehicleId: string, driverId: string | null) => Promise<void>;
  advanceOrderStatus: (orderId: string) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;

  tariffsFor: (companyId: string) => DeliveryTariff[];
  addTariff: (companyId: string, p: Partial<DeliveryTariff>) => Promise<void>;
  removeTariff: (tariffId: string) => Promise<void>;

  financeFor: (companyId: string) => FinanceEntry[];

  warehousesFor: (companyId: string) => LinkedWarehouse[];
  linkWarehouse: (companyId: string, p: Partial<LinkedWarehouse>) => Promise<void>;
  unlinkWarehouse: (linkId: string) => Promise<void>;
}

export const useTransportStore = create<TransportState>((set, get) => ({
  companies: [],
  vehicles: [],
  team: [],
  orders: [],
  exchange: [],
  tariffs: [],
  finance: [],
  warehouses: [],
  myCompanyId: null,
  loaded: false,

  load: async () => {
    const [mine, sellerOrders] = await Promise.all([
      apiMyTransportCompany(), apiSellerDeliveryOrders(),
    ]);
    const company = mine.ok ? (mine.data?.company ?? null) : null;
    set({
      companies: company ? [company] : [],
      myCompanyId: company?.id ?? null,
      orders: sellerOrders.ok && sellerOrders.data ? sellerOrders.data.orders : [],
      loaded: true,
    });
    if (company) await get().loadCompany(company.id);
  },

  loadCompany: async (companyId) => {
    const [v, t, o, tr, f, w, ex] = await Promise.all([
      apiVehicles(companyId), apiTeam(companyId), apiCompanyOrders(companyId),
      apiTariffs(companyId), apiFinance(companyId), apiCompanyWarehouses(companyId),
      apiExchange(),
    ]);
    const companyOrders = o.ok && o.data ? o.data.orders : [];
    set({
      vehicles: v.ok && v.data ? v.data.vehicles : [],
      team: t.ok && t.data ? t.data.team : [],
      /* Свои заказы как продавца и заказы своей компании — один список,
         как и было: экран различает их по companyId. */
      orders: [
        ...get().orders.filter((x) => !companyOrders.some((y) => y.id === x.id)),
        ...companyOrders,
      ],
      tariffs: tr.ok && tr.data ? tr.data.tariffs : [],
      finance: f.ok && f.data ? f.data.entries : [],
      warehouses: w.ok && w.data ? w.data.warehouses : [],
      exchange: ex.ok && ex.data ? ex.data.orders : [],
    });
  },

  companyByOwner: (ownerId) => get().companies.find((c) => c.ownerId === ownerId) ?? null,

  createCompany: async (_ownerId, p) => {
    const r = await apiCreateTransportCompany(p);
    await get().load();
    return r.ok && r.data ? r.data.company : null;
  },

  updateCompany: async (companyId, p) => {
    await apiUpdateTransportCompany(companyId, p);
    await get().load();
  },

  vehiclesFor: (companyId) => get().vehicles.filter((v) => v.companyId === companyId),

  addVehicle: async (companyId, p) => {
    await apiAddVehicle(companyId, p);
    await get().loadCompany(companyId);
  },

  updateVehicleStatus: async (vehicleId, status) => {
    await apiSetVehicleStatus(vehicleId, status);
    const id = get().myCompanyId;
    if (id) await get().loadCompany(id);
  },

  assignDriverToVehicle: async (vehicleId, driverId) => {
    await apiAssignDriver(vehicleId, driverId);
    const id = get().myCompanyId;
    if (id) await get().loadCompany(id);
  },

  removeVehicle: async (vehicleId) => {
    await apiRemoveVehicle(vehicleId);
    const id = get().myCompanyId;
    if (id) await get().loadCompany(id);
  },

  teamFor: (companyId) => get().team.filter((m) => m.companyId === companyId),

  addTeamMember: async (companyId, p) => {
    await apiAddMember(companyId, p);
    await get().loadCompany(companyId);
  },

  toggleTeamActive: async (memberId) => {
    await apiToggleMember(memberId);
    const id = get().myCompanyId;
    if (id) await get().loadCompany(id);
  },

  removeTeamMember: async (memberId) => {
    await apiRemoveMember(memberId);
    const id = get().myCompanyId;
    if (id) await get().loadCompany(id);
  },

  ordersFor: (companyId) => get().orders.filter((o) => o.companyId === companyId),
  exchangeOrders: () => get().exchange,

  createOrderFromMarketplace: async (companyId, p) => {
    await apiCreateDeliveryOrder({ ...p, companyId: companyId ?? undefined });
    await get().load();
  },

  acceptExchangeOrder: async (orderId) => {
    await apiAcceptExchange(orderId);
    await get().load();
  },

  /* Отказ от заказа на бирже — решение только этой вкладки: заказ
     остаётся на бирже для остальных. */
  declineExchangeOrder: (orderId) => {
    set({ exchange: get().exchange.filter((o) => o.id !== orderId) });
  },

  proposePrice: async (orderId, _companyId, _companyName, price) => {
    await apiProposePrice(orderId, price);
    await get().load();
  },

  approveOffer: async (orderId) => {
    await apiAnswerOffer(orderId, true);
    await get().load();
  },

  rejectOffer: async (orderId) => {
    await apiAnswerOffer(orderId, false);
    await get().load();
  },

  offersForSeller: (sellerId) => get().orders.filter(
    (o) => o.sellerId === sellerId && Boolean(o.offerCompanyId)),

  suggestAssignment: (companyId, orderId) => {
    const order = get().orders.find((o) => o.id === orderId)
      ?? get().exchange.find((o) => o.id === orderId);
    if (!order) return null;
    const free = get().vehicles.filter(
      (v) => v.companyId === companyId && v.status === 'available'
        && v.capacityKg >= order.weightKg);
    if (free.length === 0) return null;
    const vehicle = free.sort((a, b) => a.capacityKg - b.capacityKg)[0];
    const driver = get().team.find(
      (m) => m.companyId === companyId && m.active && m.vehicleId === vehicle.id) ?? null;
    return { vehicle, driver };
  },

  assignOrder: async (orderId, vehicleId, driverId) => {
    await apiAssignDeliveryOrder(orderId, vehicleId, driverId);
    await get().load();
  },

  advanceOrderStatus: async (orderId) => {
    await apiAdvanceDeliveryOrder(orderId);
    await get().load();
  },

  cancelOrder: async (orderId) => {
    await apiCancelDeliveryOrder(orderId);
    await get().load();
  },

  tariffsFor: (companyId) => get().tariffs.filter((t) => t.companyId === companyId),

  addTariff: async (companyId, p) => {
    await apiAddTariff(companyId, p);
    await get().loadCompany(companyId);
  },

  removeTariff: async (tariffId) => {
    await apiRemoveTariff(tariffId);
    const id = get().myCompanyId;
    if (id) await get().loadCompany(id);
  },

  financeFor: (companyId) => get().finance.filter((f) => f.companyId === companyId),

  warehousesFor: (companyId) => get().warehouses.filter((w) => w.companyId === companyId),

  linkWarehouse: async (companyId, p) => {
    await apiLinkCompanyWarehouse(companyId, p);
    await get().loadCompany(companyId);
  },

  unlinkWarehouse: async (linkId) => {
    await apiUnlinkCompanyWarehouse(linkId);
    const id = get().myCompanyId;
    if (id) await get().loadCompany(id);
  },
}));
