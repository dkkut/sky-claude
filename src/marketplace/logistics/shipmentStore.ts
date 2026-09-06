/* ======================================================================
   SKY MARKET / LOGISTICS  —  Shipment (поставка) store
   Раздел «Поставки» в личном кабинете продавца
====================================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import type { Shipment, ShipmentStatus, ShipmentLogEntry, ShipmentLogType } from './types';

const KEY = 'sky:logistics:shipments:v1';
const W   = typeof window !== 'undefined';
const me  = () => useAuthStore.getState().currentUserId ?? '';

const load = () => {
  if (!W) return null;
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
};
const save = (data: object) => {
  if (!W) return;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
};

const genId = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

/* Читаемый номер поставки: SKY-SHP-7K2Q9X */
const genNumber = () => `SKY-SHP-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
/* Короткий код для QR / быстрого поиска (без разделителей, легче сканировать) */
const genCode = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();

export const SHIPMENT_STATUS_CFG: Record<ShipmentStatus, { label: string; color: string }> = {
  draft:              { label: 'Черновик',              color: 'var(--t3)' },
  preparing:          { label: 'Формируется',           color: 'var(--amber)' },
  in_transit:         { label: 'В пути',                color: 'var(--accent)' },
  at_sorting_center:  { label: 'На сортировочном центре', color: '#8b5cf6' },
  delivered:          { label: 'Доставлена',            color: 'var(--green)' },
  cancelled:          { label: 'Отменена',              color: 'var(--red)' },
};

export const SHIPMENT_STATUS_FLOW: ShipmentStatus[] = [
  'draft', 'preparing', 'in_transit', 'at_sorting_center', 'delivered',
];

export interface CreateShipmentInput {
  name:              string;
  senderName:        string;
  senderAddress?:    string;
  recipientName:     string;
  recipientAddress?: string;
  placesCount:       number;
  weightKg?:         number;
  volumeM3?:         number;
  sortingCenterId:   string | null;
  sortingCenterName?:string;
}

interface ShipmentState {
  shipments: Shipment[];
  logs:      ShipmentLogEntry[];

  myShipments:    () => Shipment[];
  getShipment:    (id: string) => Shipment | null;
  /* Поиск по номеру, ID или коду — регистронезависимо, частичное совпадение */
  findShipments:  (query: string) => Shipment[];

  createShipment: (p: CreateShipmentInput) => string;
  updateShipment: (id: string, p: Partial<CreateShipmentInput>) => void;
  setStatus:      (id: string, status: ShipmentStatus) => void;
  setSortingCenter: (id: string, sortingCenterId: string | null, sortingCenterName?: string) => void;
  deleteShipment: (id: string) => void;

  logsFor: (shipmentId: string) => ShipmentLogEntry[];
  log:     (shipmentId: string, type: ShipmentLogType, text: string) => void;
}

const stored = load();

export const useShipmentStore = create<ShipmentState>((set, get) => {
  const flush = () => {
    const s = get();
    save({ shipments: s.shipments, logs: s.logs });
  };
  const mut = (fn: (s: ShipmentState) => Partial<ShipmentState>) => {
    set(s => ({ ...s, ...fn(s) }));
    flush();
  };

  const pushLog = (shipmentId: string, type: ShipmentLogType, text: string) => {
    set(s => ({ logs: [{ id: genId('shl'), shipmentId, type, text, createdAt: new Date().toISOString() }, ...s.logs] }));
  };

  return {
    shipments: stored?.shipments ?? [],
    logs:      stored?.logs      ?? [],

    myShipments: () => {
      const sellerId = me();
      return get().shipments.filter(s => s.sellerId === sellerId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },

    getShipment: (id) => get().shipments.find(s => s.id === id) ?? null,

    findShipments: (query) => {
      const q = query.trim().toLowerCase();
      if (!q) return get().myShipments();
      const sellerId = me();
      return get().shipments.filter(s =>
        s.sellerId === sellerId && (
          s.number.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q)
        ));
    },

    createShipment: (p) => {
      const sellerId = me();
      const id = genId('shp');
      const now = new Date().toISOString();
      const shipment: Shipment = {
        id, sellerId, number: genNumber(), code: genCode(),
        status: 'draft', createdAt: now, updatedAt: now,
        ...p,
      };
      mut(s => ({ shipments: [...s.shipments, shipment] }));
      pushLog(id, 'created', `Поставка «${p.name}» создана`);
      if (p.sortingCenterId) pushLog(id, 'sorting_center_changed', `Привязан сортировочный центр: ${p.sortingCenterName ?? p.sortingCenterId}`);
      flush();
      return id;
    },

    updateShipment: (id, p) => {
      const cur = get().shipments.find(x => x.id === id);
      mut(s => ({ shipments: s.shipments.map(x => x.id === id ? { ...x, ...p, updatedAt: new Date().toISOString() } : x) }));
      pushLog(id, 'updated', 'Данные поставки обновлены');
      /* смена сортировочного центра через полную форму — логируем так же,
         как через быстрый пикер, чтобы «История центра» ничего не теряла */
      if (cur && 'sortingCenterId' in p && p.sortingCenterId !== cur.sortingCenterId) {
        pushLog(id, 'sorting_center_changed',
          p.sortingCenterId
            ? `Сортировочный центр изменён: ${cur.sortingCenterName ?? '—'} → ${p.sortingCenterName ?? p.sortingCenterId}`
            : `Привязка к сортировочному центру снята (был: ${cur.sortingCenterName ?? cur.sortingCenterId ?? '—'})`);
      }
      flush();
    },

    setStatus: (id, status) => {
      const cur = get().shipments.find(x => x.id === id);
      if (!cur || cur.status === status) return;
      mut(s => ({ shipments: s.shipments.map(x => x.id === id ? { ...x, status, updatedAt: new Date().toISOString() } : x) }));
      pushLog(id, 'status_changed', `Статус изменён: «${SHIPMENT_STATUS_CFG[cur.status].label}» → «${SHIPMENT_STATUS_CFG[status].label}»`);
      flush();
    },

    setSortingCenter: (id, sortingCenterId, sortingCenterName) => {
      const cur = get().shipments.find(x => x.id === id);
      if (!cur) return;
      mut(s => ({ shipments: s.shipments.map(x => x.id === id ? { ...x, sortingCenterId, sortingCenterName, updatedAt: new Date().toISOString() } : x) }));
      pushLog(id, 'sorting_center_changed',
        sortingCenterId
          ? `Сортировочный центр изменён: ${cur.sortingCenterName ?? '—'} → ${sortingCenterName ?? sortingCenterId}`
          : `Привязка к сортировочному центру снята (был: ${cur.sortingCenterName ?? cur.sortingCenterId ?? '—'})`);
      flush();
    },

    deleteShipment: (id) => mut(s => ({
      shipments: s.shipments.filter(x => x.id !== id),
      logs:      s.logs.filter(l => l.shipmentId !== id),
    })),

    logsFor: (shipmentId) => get().logs.filter(l => l.shipmentId === shipmentId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),

    log: (shipmentId, type, text) => { pushLog(shipmentId, type, text); flush(); },
  };
});
