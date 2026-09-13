/* ======================================================================
   SKY MARKET / LOGISTICS — поставки и наклейки

   Хранилище стало кэшем ответов сервера. Раньше поставки лежали в
   localStorage, и поиск по коду шёл по своему же списку — то есть по
   наклейке нельзя было найти ничего, чего ты сам не создал, но и
   второй человек этой поставки не видел вовсе.

   Теперь номер и короткий код выдаёт сервер, а находит поставку по ним
   только её владелец: по номеру с чужой коробки не должен открываться
   адрес её получателя.
====================================================================== */
import { create } from 'zustand';
import type { Shipment, ShipmentStatus, ShipmentLogEntry, ShipmentLogType } from './types';
import {
  apiSupplies, apiCreateSupply, apiUpdateSupply, apiSetSupplyStatus,
  apiSetSupplyCenter, apiDeleteSupply, apiSupplyLog,
} from './logisticsApi';

export const SHIPMENT_STATUS_CFG: Record<ShipmentStatus, { label: string; color: string }> = {
  draft:             { label: 'Черновик',                color: 'var(--t3)' },
  preparing:         { label: 'Формируется',             color: 'var(--amber)' },
  in_transit:        { label: 'В пути',                  color: 'var(--accent)' },
  at_sorting_center: { label: 'На сортировочном центре',  color: '#8b5cf6' },
  delivered:         { label: 'Доставлена',              color: 'var(--green)' },
  cancelled:         { label: 'Отменена',                color: 'var(--red)' },
};

export const SHIPMENT_STATUS_FLOW: ShipmentStatus[] = [
  'draft', 'preparing', 'in_transit', 'at_sorting_center', 'delivered',
];

export interface CreateShipmentInput {
  name: string;
  senderName: string;
  senderAddress?: string;
  recipientName: string;
  recipientAddress?: string;
  placesCount: number;
  weightKg?: number;
  volumeM3?: number;
  sortingCenterId: string | null;
  sortingCenterName?: string;
}

interface ShipmentState {
  shipments: Shipment[];
  logs: ShipmentLogEntry[];
  found: Shipment[];

  load: () => Promise<void>;
  loadLog: (shipmentId: string) => Promise<void>;

  myShipments: () => Shipment[];
  getShipment: (id: string) => Shipment | null;
  /** Поиск идёт на сервере и только среди своих поставок. */
  findShipments: (query: string) => Shipment[];
  search: (query: string) => Promise<void>;

  createShipment: (p: CreateShipmentInput) => Promise<string>;
  updateShipment: (id: string, p: Partial<CreateShipmentInput>) => Promise<void>;
  setStatus: (id: string, status: ShipmentStatus) => Promise<void>;
  setSortingCenter: (id: string, sortingCenterId: string | null, sortingCenterName?: string) => Promise<void>;
  deleteShipment: (id: string) => Promise<void>;

  logsFor: (shipmentId: string) => ShipmentLogEntry[];
  /** Журнал пишет сервер. Здесь осталась только перезагрузка. */
  log: (shipmentId: string, type?: ShipmentLogType, text?: string) => Promise<void>;
}

export const useShipmentStore = create<ShipmentState>((set, get) => ({
  shipments: [],
  logs: [],
  found: [],

  load: async () => {
    const r = await apiSupplies();
    if (r.ok && r.data) set({ shipments: r.data.supplies });
  },

  loadLog: async (shipmentId) => {
    const r = await apiSupplyLog(shipmentId);
    if (!r.ok || !r.data) return;
    set({ logs: [...get().logs.filter((l) => l.shipmentId !== shipmentId), ...r.data.entries] });
  },

  myShipments: () => get().shipments,
  getShipment: (id) => get().shipments.find((s) => s.id === id)
    ?? get().found.find((s) => s.id === id) ?? null,

  findShipments: (query) => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const local = get().shipments.filter((s) =>
      s.number.toUpperCase().includes(q) || s.code.toUpperCase().includes(q)
      || s.name.toUpperCase().includes(q));
    return local.length > 0 ? local : get().found;
  },

  search: async (query) => {
    const r = await apiSupplies(query);
    set({ found: r.ok && r.data ? r.data.supplies : [] });
  },

  createShipment: async (p) => {
    const r = await apiCreateSupply(p);
    await get().load();
    return r.ok && r.data ? r.data.supply.id : '';
  },

  updateShipment: async (id, p) => {
    await apiUpdateSupply(id, p);
    if (p.sortingCenterId !== undefined) await apiSetSupplyCenter(id, p.sortingCenterId);
    await get().load();
    await get().loadLog(id);
  },

  setStatus: async (id, status) => {
    await apiSetSupplyStatus(id, status);
    await get().load();
    await get().loadLog(id);
  },

  setSortingCenter: async (id, sortingCenterId) => {
    await apiSetSupplyCenter(id, sortingCenterId);
    await get().load();
    await get().loadLog(id);
  },

  deleteShipment: async (id) => {
    await apiDeleteSupply(id);
    await get().load();
  },

  logsFor: (shipmentId) => get().logs.filter((l) => l.shipmentId === shipmentId),

  log: async (shipmentId) => { await get().loadLog(shipmentId); },
}));
