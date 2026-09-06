/* ======================================================================
   SKY MARKET / LOGISTICS  —  Warehouse store
====================================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import { pointForSeed } from './geo';
import type {
  Warehouse, WarehouseStockItem, WarehouseTransfer, WarehouseStaff,
  WarehouseLogEntry, DaySchedule, WeekDay,
} from './types';

const KEY = 'sky:logistics:warehouses:v1';
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

const genId = (p: string) => `${p}-${crypto.randomUUID().slice(0,8)}`;

export const WEEK_DAYS: { key: WeekDay; label: string }[] = [
  { key:'mon', label:'Пн' }, { key:'tue', label:'Вт' }, { key:'wed', label:'Ср' },
  { key:'thu', label:'Чт' }, { key:'fri', label:'Пт' }, { key:'sat', label:'Сб' }, { key:'sun', label:'Вс' },
];

export const defaultSchedule = (): DaySchedule[] => WEEK_DAYS.map(d => ({
  day: d.key, closed: d.key==='sun', from:'09:00', to:'20:00',
}));

/* ── Seed: один демо-склад у Luna Store, чтобы раздел не был пустым ── */
const SEED_WAREHOUSES: Warehouse[] = [
  {
    id:'wh1', sellerId:'acc-luna', name:'Главный склад — Москва',
    address:'Москва, Складская ул., 12', cityId:'msk', location:pointForSeed('msk','wh1'),
    photos:[], schedule:defaultSchedule(), capacity:500,
    createdAt:new Date(Date.now()-86400000*40).toISOString(),
  },
];

const SEED_STOCK: WarehouseStockItem[] = [
  { id:'st1', warehouseId:'wh1', productId:'p1', productTitle:'Игровая мышь SkyX Pro',      quantity:12 },
  { id:'st2', warehouseId:'wh1', productId:'p2', productTitle:'Коврик SkyMat XL',            quantity:30 },
  { id:'st3', warehouseId:'wh1', productId:'p3', productTitle:'Наушники Sky Sound Pro 7.1',  quantity:5  },
  { id:'st4', warehouseId:'wh1', productId:'p5', productTitle:'Монитор Sky Vision 27"',      quantity:3  },
];

const SEED_LOG: WarehouseLogEntry[] = [
  { id:'wl1', warehouseId:'wh1', type:'created', text:'Склад создан', createdAt:new Date(Date.now()-86400000*40).toISOString() },
];

interface WarehouseState {
  warehouses: Warehouse[];
  stock:      WarehouseStockItem[];
  transfers:  WarehouseTransfer[];
  staff:      WarehouseStaff[];
  logs:       WarehouseLogEntry[];

  myWarehouses: () => Warehouse[];
  addWarehouse: (p: { name:string; address:string; cityId:string; location:{lat:number;lng:number}; photos:string[]; schedule:DaySchedule[]; capacity:number; role?: Warehouse['role'] }) => string;
  updateWarehouse: (id: string, p: Partial<Warehouse>) => void;
  deleteWarehouse: (id: string) => void;

  stockFor:     (warehouseId: string) => WarehouseStockItem[];
  occupied:     (warehouseId: string) => number;
  free:         (warehouseId: string) => number;
  setStock:     (warehouseId: string, productId: string, productTitle: string, quantity: number) => void;
  adjustStock:  (warehouseId: string, productId: string, productTitle: string, delta: number) => void;
  removeStockItem: (id: string) => void;

  transfersFor: (warehouseId: string) => WarehouseTransfer[];
  createTransfer: (p: { fromWarehouseId:string; toWarehouseId:string; productId:string; productTitle:string; quantity:number }) => WarehouseTransfer | null;
  advanceTransfer:(id: string) => void;     // pending -> in_transit -> done
  cancelTransfer: (id: string) => void;

  staffFor: (warehouseId: string) => WarehouseStaff[];
  addStaff: (warehouseId: string, accountId: string, name: string, username: string, role: WarehouseStaff['role']) => void;
  removeStaff: (id: string) => void;

  logsFor: (warehouseId: string) => WarehouseLogEntry[];
  log: (warehouseId: string, type: WarehouseLogEntry['type'], text: string) => void;
}

const stored = load();

export const useWarehouseStore = create<WarehouseState>((set, get) => {
  const flush = () => {
    const s = get();
    save({ warehouses: s.warehouses, stock: s.stock, transfers: s.transfers, staff: s.staff, logs: s.logs });
  };
  const mut = (fn: (s: WarehouseState) => Partial<WarehouseState>) => {
    set(s => ({ ...s, ...fn(s) }));
    flush();
  };

  const pushLog = (warehouseId: string, type: WarehouseLogEntry['type'], text: string) => {
    set(s => ({ logs: [{ id: genId('wl'), warehouseId, type, text, createdAt: new Date().toISOString() }, ...s.logs] }));
  };

  return {
    warehouses: stored?.warehouses ?? SEED_WAREHOUSES,
    stock:      stored?.stock      ?? SEED_STOCK,
    transfers:  stored?.transfers  ?? [],
    staff:      stored?.staff      ?? [],
    logs:       stored?.logs       ?? SEED_LOG,

    myWarehouses: () => {
      const sellerId = me();
      return get().warehouses.filter(w => w.sellerId === sellerId)
        .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },

    addWarehouse: (p) => {
      const sellerId = me();
      const id = genId('wh');
      const warehouse: Warehouse = { id, sellerId, createdAt: new Date().toISOString(), ...p };
      mut(s => ({ warehouses: [...s.warehouses, warehouse] }));
      pushLog(id, 'created', `Склад «${p.name}» создан`);
      flush();
      return id;
    },

    updateWarehouse: (id, p) => {
      mut(s => ({ warehouses: s.warehouses.map(w => w.id===id ? { ...w, ...p } : w) }));
      pushLog(id, 'updated', 'Данные склада обновлены');
      flush();
    },

    deleteWarehouse: (id) => mut(s => ({
      warehouses: s.warehouses.filter(w => w.id !== id),
      stock:      s.stock.filter(x => x.warehouseId !== id),
      staff:      s.staff.filter(x => x.warehouseId !== id),
    })),

    stockFor: (warehouseId) => get().stock.filter(s => s.warehouseId === warehouseId)
      .sort((a,b) => b.quantity - a.quantity),

    occupied: (warehouseId) => get().stock.filter(s => s.warehouseId === warehouseId)
      .reduce((sum, s) => sum + s.quantity, 0),

    free: (warehouseId) => {
      const wh = get().warehouses.find(w => w.id === warehouseId);
      if (!wh) return 0;
      return Math.max(0, wh.capacity - get().occupied(warehouseId));
    },

    setStock: (warehouseId, productId, productTitle, quantity) => {
      mut(s => {
        const existing = s.stock.find(x => x.warehouseId===warehouseId && x.productId===productId);
        if (existing) {
          return { stock: s.stock.map(x => x.id===existing.id ? { ...x, quantity: Math.max(0, quantity) } : x) };
        }
        return { stock: [...s.stock, { id: genId('st'), warehouseId, productId, productTitle, quantity: Math.max(0, quantity) }] };
      });
      pushLog(warehouseId, 'updated', `Остаток «${productTitle}» обновлён: ${quantity} шт.`);
      flush();
    },

    adjustStock: (warehouseId, productId, productTitle, delta) => {
      const cur = get().stock.find(x => x.warehouseId===warehouseId && x.productId===productId);
      const next = Math.max(0, (cur?.quantity ?? 0) + delta);
      get().setStock(warehouseId, productId, productTitle, next);
      pushLog(warehouseId, delta >= 0 ? 'stock_in' : 'stock_out',
        `${delta >= 0 ? 'Поступление' : 'Списание'}: «${productTitle}» ${delta >= 0 ? '+' : ''}${delta} шт.`);
      flush();
    },

    removeStockItem: (id) => mut(s => ({ stock: s.stock.filter(x => x.id !== id) })),

    transfersFor: (warehouseId) => get().transfers.filter(t => t.fromWarehouseId===warehouseId || t.toWarehouseId===warehouseId)
      .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),

    createTransfer: ({ fromWarehouseId, toWarehouseId, productId, productTitle, quantity }) => {
      const avail = get().stock.find(x => x.warehouseId===fromWarehouseId && x.productId===productId)?.quantity ?? 0;
      if (avail < quantity || quantity <= 0 || fromWarehouseId === toWarehouseId) return null;
      const transfer: WarehouseTransfer = {
        id: genId('tr'), fromWarehouseId, toWarehouseId, productId, productTitle, quantity,
        status: 'pending', createdAt: new Date().toISOString(),
      };
      get().adjustStock(fromWarehouseId, productId, productTitle, -quantity);
      mut(s => ({ transfers: [transfer, ...s.transfers] }));
      pushLog(fromWarehouseId, 'transfer_out', `Перемещение «${productTitle}» (${quantity} шт.) → другой склад`);
      flush();
      return transfer;
    },

    advanceTransfer: (id) => {
      const t = get().transfers.find(x => x.id === id);
      if (!t) return;
      if (t.status === 'pending') {
        mut(s => ({ transfers: s.transfers.map(x => x.id===id ? { ...x, status:'in_transit' as const } : x) }));
      } else if (t.status === 'in_transit') {
        get().adjustStock(t.toWarehouseId, t.productId, t.productTitle, t.quantity);
        mut(s => ({ transfers: s.transfers.map(x => x.id===id ? { ...x, status:'done' as const, completedAt:new Date().toISOString() } : x) }));
        pushLog(t.toWarehouseId, 'transfer_in', `Получено «${t.productTitle}» (${t.quantity} шт.) с другого склада`);
        flush();
      }
    },

    cancelTransfer: (id) => {
      const t = get().transfers.find(x => x.id === id);
      if (!t || t.status === 'done') return;
      get().adjustStock(t.fromWarehouseId, t.productId, t.productTitle, t.quantity); // возврат остатка
      mut(s => ({ transfers: s.transfers.map(x => x.id===id ? { ...x, status:'cancelled' as const } : x) }));
    },

    staffFor: (warehouseId) => get().staff.filter(s => s.warehouseId === warehouseId),

    addStaff: (warehouseId, accountId, name, username, role) => {
      if (get().staff.some(s => s.warehouseId===warehouseId && s.accountId===accountId)) return;
      mut(s => ({ staff: [...s.staff, { id: genId('emp'), warehouseId, accountId, name, username, role, assignedAt:new Date().toISOString() }] }));
      pushLog(warehouseId, 'staff_added', `${name} (@${username}) назначен как ${role==='manager'?'менеджер':'сотрудник'}`);
      flush();
    },

    removeStaff: (id) => {
      const s = get().staff.find(x => x.id === id);
      mut(st => ({ staff: st.staff.filter(x => x.id !== id) }));
      if (s) { pushLog(s.warehouseId, 'staff_removed', `${s.name} удалён из сотрудников склада`); flush(); }
    },

    logsFor: (warehouseId) => get().logs.filter(l => l.warehouseId === warehouseId)
      .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),

    log: (warehouseId, type, text) => { pushLog(warehouseId, type, text); flush(); },
  };
});
