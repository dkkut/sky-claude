/* ======================================================================
   SKY MARKET / LOGISTICS — склады

   Хранилище стало кэшем ответов сервера, а не второй копией правды.
   Раньше склады, остатки и сотрудники лежали в localStorage: второго
   человека в этой системе не существовало, а роль «менеджер» означала
   лишь то, что экран нарисовал кнопку.

   Список функций и их имена прежние — экраны не переписаны. Изменилось
   то, что читают они теперь загруженное с сервера, а всё, что меняет
   данные, уходит на сервер и там же проверяется.
====================================================================== */
import { create } from 'zustand';
import type {
  Warehouse, WarehouseStockItem, WarehouseTransfer, WarehouseStaff,
  WarehouseLogEntry, DaySchedule, WeekDay,
} from './types';
import {
  apiWarehouses, apiSortingCenters, apiCreateWarehouse, apiUpdateWarehouse, apiDeleteWarehouse,
  apiUploadWarehousePhoto, apiDeleteWarehousePhoto, warehousePhotoUrl,
  apiStock, apiSetStock, apiTransfers, apiCreateTransfer, apiAdvanceTransfer, apiCancelTransfer,
  apiStaff, apiAddStaff, apiRemoveStaff, apiWarehouseLog,
} from './logisticsApi';

export const WEEK_DAYS: { key: WeekDay; label: string }[] = [
  { key: 'mon', label: 'Пн' }, { key: 'tue', label: 'Вт' }, { key: 'wed', label: 'Ср' },
  { key: 'thu', label: 'Чт' }, { key: 'fri', label: 'Пт' }, { key: 'sat', label: 'Сб' },
  { key: 'sun', label: 'Вс' },
];

export const defaultSchedule = (): DaySchedule[] => WEEK_DAYS.map((d) => ({
  day: d.key, closed: d.key === 'sun', from: '09:00', to: '20:00',
}));

/**
 * Фотографии.
 *
 * Сервер отдаёт идентификаторы, экран рисует <img src>. Превращаем одно
 * в другое здесь, чтобы форма осталась прежней: она по-прежнему держит
 * список строк, только теперь это адреса, а не картинки целиком в
 * data-url на несколько мегабайт каждая.
 */
const toPhotoUrls = (w: Warehouse): Warehouse => ({
  ...w,
  photos: (w.photos ?? []).map((id) => (id.startsWith('/') ? id : warehousePhotoUrl(id))),
});

const photoIdOf = (url: string) => url.split('/').pop() ?? '';

/** Data-URL из формы → файл для загрузки. */
const dataUrlToBlob = (dataUrl: string): Blob | null => {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    const bytes = m[2]
      ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(m[3]));
    return new Blob([bytes], { type: m[1] });
  } catch {
    return null;
  }
};

interface WarehouseState {
  warehouses: Warehouse[];
  sortingCenters: { id: string; name: string; cityId: string }[];
  stock: WarehouseStockItem[];
  transfers: WarehouseTransfer[];
  staff: WarehouseStaff[];
  logs: WarehouseLogEntry[];
  fill: Record<string, { occupied: number; capacity: number; free: number }>;
  loaded: boolean;

  load: () => Promise<void>;
  loadWarehouse: (warehouseId: string) => Promise<void>;

  myWarehouses: () => Warehouse[];
  addWarehouse: (p: {
    name: string; address: string; cityId: string; location?: { lat: number; lng: number };
    photos: string[]; schedule: DaySchedule[]; capacity: number; role?: Warehouse['role'];
  }) => Promise<string>;
  updateWarehouse: (id: string, p: Partial<Warehouse>) => Promise<void>;
  deleteWarehouse: (id: string) => Promise<void>;

  stockFor: (warehouseId: string) => WarehouseStockItem[];
  occupied: (warehouseId: string) => number;
  free: (warehouseId: string) => number;
  setStock: (warehouseId: string, productId: string, productTitle: string, quantity: number) => Promise<void>;
  adjustStock: (warehouseId: string, productId: string, productTitle: string, delta: number) => Promise<void>;
  removeStockItem: (id: string) => Promise<void>;

  transfersFor: (warehouseId: string) => WarehouseTransfer[];
  createTransfer: (p: {
    fromWarehouseId: string; toWarehouseId: string;
    productId: string; productTitle: string; quantity: number;
  }) => Promise<WarehouseTransfer | null>;
  advanceTransfer: (id: string) => Promise<void>;
  cancelTransfer: (id: string) => Promise<void>;

  staffFor: (warehouseId: string) => WarehouseStaff[];
  addStaff: (warehouseId: string, accountId: string, name: string, username: string, role: WarehouseStaff['role']) => Promise<void>;
  removeStaff: (id: string) => Promise<void>;

  logsFor: (warehouseId: string) => WarehouseLogEntry[];
  /** Журнал пишет сервер. Здесь осталась только перезагрузка. */
  log: (warehouseId: string) => Promise<void>;
}

export const useWarehouseStore = create<WarehouseState>((set, get) => ({
  warehouses: [],
  sortingCenters: [],
  stock: [],
  transfers: [],
  staff: [],
  logs: [],
  fill: {},
  loaded: false,

  load: async () => {
    const [w, c] = await Promise.all([apiWarehouses(), apiSortingCenters()]);
    set({
      warehouses: w.ok && w.data ? w.data.warehouses.map(toPhotoUrls) : [],
      sortingCenters: c.ok && c.data ? c.data.centers : [],
      loaded: true,
    });
    for (const wh of (w.ok && w.data ? w.data.warehouses : [])) {
      await get().loadWarehouse(wh.id);
    }
  },

  /** Всё, что относится к одному складу: остатки, перемещения, люди, журнал. */
  loadWarehouse: async (warehouseId) => {
    const [st, tr, sf, lg] = await Promise.all([
      apiStock(warehouseId), apiTransfers(warehouseId),
      apiStaff(warehouseId), apiWarehouseLog(warehouseId),
    ]);
    const others = (arr: { warehouseId?: string }[]) =>
      arr.filter((x) => x.warehouseId !== warehouseId);

    set({
      stock: [...others(get().stock) as WarehouseStockItem[],
        ...(st.ok && st.data ? st.data.stock : [])],
      transfers: [
        ...get().transfers.filter(
          (t) => t.fromWarehouseId !== warehouseId && t.toWarehouseId !== warehouseId),
        ...(tr.ok && tr.data ? tr.data.transfers : []),
      ],
      staff: [...others(get().staff) as WarehouseStaff[],
        ...(sf.ok && sf.data ? sf.data.staff : [])],
      logs: [...others(get().logs) as WarehouseLogEntry[],
        ...(lg.ok && lg.data ? lg.data.entries : [])],
      fill: st.ok && st.data
        ? { ...get().fill, [warehouseId]: st.data.fill }
        : get().fill,
    });
  },

  myWarehouses: () => get().warehouses,

  /**
   * Завести склад.
   *
   * Фотографии, набранные формой в data-url, уходят отдельными
   * загрузками: файл летит потоком и проверяется по первым байтам, а
   * не по тому, что клиент назвал его картинкой.
   */
  addWarehouse: async (p) => {
    const r = await apiCreateWarehouse({
      name: p.name, address: p.address, cityId: p.cityId, location: p.location,
      capacity: p.capacity, schedule: p.schedule, role: p.role,
    });
    if (!r.ok || !r.data) return '';
    const id = r.data.warehouse.id;
    for (const photo of p.photos ?? []) {
      const blob = photo.startsWith('data:') ? dataUrlToBlob(photo) : null;
      if (blob) await apiUploadWarehousePhoto(id, blob);
    }
    await get().load();
    return id;
  },

  updateWarehouse: async (id, p) => {
    await apiUpdateWarehouse(id, {
      name: p.name, address: p.address, cityId: p.cityId, location: p.location,
      capacity: p.capacity, schedule: p.schedule, role: p.role,
    });
    /* Фотографии: новые (data-url) грузим, исчезнувшие из списка убираем. */
    if (p.photos) {
      const before = get().warehouses.find((w) => w.id === id)?.photos ?? [];
      for (const photo of p.photos) {
        const blob = photo.startsWith('data:') ? dataUrlToBlob(photo) : null;
        if (blob) await apiUploadWarehousePhoto(id, blob);
      }
      for (const old of before) {
        if (!p.photos.includes(old)) await apiDeleteWarehousePhoto(photoIdOf(old));
      }
    }
    await get().load();
  },

  deleteWarehouse: async (id) => {
    await apiDeleteWarehouse(id);
    await get().load();
  },

  stockFor: (warehouseId) => get().stock.filter((s) => s.warehouseId === warehouseId),

  occupied: (warehouseId) => get().fill[warehouseId]?.occupied
    ?? get().stock.filter((s) => s.warehouseId === warehouseId).reduce((a, s) => a + s.quantity, 0),

  free: (warehouseId) => {
    const known = get().fill[warehouseId];
    if (known) return known.free;
    const wh = get().warehouses.find((w) => w.id === warehouseId);
    return Math.max(0, (wh?.capacity ?? 0) - get().occupied(warehouseId));
  },

  setStock: async (warehouseId, productId, productTitle, quantity) => {
    await apiSetStock(warehouseId, productId, productTitle, quantity);
    await get().loadWarehouse(warehouseId);
  },

  adjustStock: async (warehouseId, productId, productTitle, delta) => {
    const now = get().stock.find((s) => s.warehouseId === warehouseId && s.productId === productId);
    const next = Math.max(0, (now?.quantity ?? 0) + delta);
    await apiSetStock(warehouseId, productId, productTitle, next);
    await get().loadWarehouse(warehouseId);
  },

  removeStockItem: async (id) => {
    const item = get().stock.find((s) => s.id === id);
    if (!item) return;
    await apiSetStock(item.warehouseId, item.productId, item.productTitle, 0);
    await get().loadWarehouse(item.warehouseId);
  },

  transfersFor: (warehouseId) => get().transfers.filter(
    (t) => t.fromWarehouseId === warehouseId || t.toWarehouseId === warehouseId),

  createTransfer: async (p) => {
    const r = await apiCreateTransfer(p);
    await get().loadWarehouse(p.fromWarehouseId);
    await get().loadWarehouse(p.toWarehouseId);
    return r.ok && r.data ? r.data.transfer : null;
  },

  advanceTransfer: async (id) => {
    const r = await apiAdvanceTransfer(id);
    if (r.ok && r.data) {
      await get().loadWarehouse(r.data.transfer.fromWarehouseId);
      await get().loadWarehouse(r.data.transfer.toWarehouseId);
    }
  },

  cancelTransfer: async (id) => {
    const r = await apiCancelTransfer(id);
    if (r.ok && r.data) {
      await get().loadWarehouse(r.data.transfer.fromWarehouseId);
      await get().loadWarehouse(r.data.transfer.toWarehouseId);
    }
  },

  staffFor: (warehouseId) => get().staff.filter((s) => s.warehouseId === warehouseId),

  /**
   * Добавить сотрудника.
   *
   * Сервер ищет человека по нику: присланный accountId не значит
   * ничего, потому что это способ вписать в сотрудники кого угодно по
   * подобранному идентификатору.
   */
  addStaff: async (warehouseId, _accountId, _name, username, role) => {
    await apiAddStaff(warehouseId, username, role);
    await get().loadWarehouse(warehouseId);
  },

  removeStaff: async (id) => {
    const row = get().staff.find((s) => s.id === id);
    await apiRemoveStaff(id);
    if (row) await get().loadWarehouse(row.warehouseId);
  },

  logsFor: (warehouseId) => get().logs.filter((l) => l.warehouseId === warehouseId),

  log: async (warehouseId) => { await get().loadWarehouse(warehouseId); },
}));
