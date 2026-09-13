/* ======================================================================
   SKY MARKET / LOGISTICS — пропуска

   Хранилище стало кэшем ответов сервера. Раньше пропуска лежали в
   localStorage вместе с кодами, а «сканирование» искало код по всему
   списку у себя в браузере — то есть код от чужого склада подходил бы,
   если бы этот список был общим.

   Теперь код проверяет сервер: у него лежит отпечаток кода, а не код,
   и ищет он только среди пропусков того склада, на котором стоит
   сканирующий.
====================================================================== */
import { create } from 'zustand';
import type { AccessPass, PassVisitLog, PassSendLog, AccessLevel, PassType, PassSendChannel } from './types';
import {
  apiPasses, apiCreatePass, apiUpdatePass, apiDeletePass,
  apiScanPass, apiVisits, apiSendPass, apiPassSends,
} from './logisticsApi';

export const ACCESS_LEVELS: { key: AccessLevel; label: string; color: string }[] = [
  { key: 'guest',    label: 'Гость',     color: '#8b8b97' },
  { key: 'employee', label: 'Сотрудник', color: '#4f6ef7' },
  { key: 'manager',  label: 'Менеджер',  color: '#a78bfa' },
  { key: 'owner',    label: 'Владелец',  color: '#f59e0b' },
];

interface PassState {
  passes: AccessPass[];
  visitLogs: PassVisitLog[];
  sendLogs: PassSendLog[];

  loadFor: (warehouseId: string) => Promise<void>;
  loadSends: (passId: string) => Promise<void>;

  passesFor: (warehouseId: string) => AccessPass[];
  myPasses: () => AccessPass[];

  createPass: (p: {
    warehouseId: string; holderName: string; holderContact: string;
    accessLevel: AccessLevel; type: PassType; validUntil: string | null;
  }) => Promise<AccessPass | null>;
  updatePass: (id: string, p: Partial<AccessPass>) => Promise<void>;
  blockPass: (id: string) => Promise<void>;
  unblockPass: (id: string) => Promise<void>;
  deletePass: (id: string) => Promise<void>;

  /** Сканирование всегда привязано к складу: код ищут только среди его пропусков. */
  scanPass: (code: string, warehouseId: string) =>
  Promise<{ ok: boolean; reason?: string; pass?: AccessPass }>;
  visitsFor: (passId: string) => PassVisitLog[];
  visitsForWarehouse: (warehouseId: string) => PassVisitLog[];

  sendPass: (passId: string, channel: PassSendChannel, target: string) => Promise<PassSendLog | null>;
  sendLogsFor: (passId: string) => PassSendLog[];
}

export const usePassStore = create<PassState>((set, get) => ({
  passes: [],
  visitLogs: [],
  sendLogs: [],

  loadFor: async (warehouseId) => {
    const [p, v] = await Promise.all([apiPasses(warehouseId), apiVisits(warehouseId)]);
    set({
      passes: [
        ...get().passes.filter((x) => x.warehouseId !== warehouseId),
        ...(p.ok && p.data ? p.data.passes : []),
      ],
      visitLogs: [
        ...get().visitLogs.filter((x) => x.warehouseId !== warehouseId),
        ...(v.ok && v.data ? v.data.visits : []),
      ],
    });
  },

  loadSends: async (passId) => {
    const r = await apiPassSends(passId);
    if (!r.ok || !r.data) return;
    set({
      sendLogs: [...get().sendLogs.filter((s) => s.passId !== passId), ...r.data.sends],
    });
  },

  passesFor: (warehouseId) => get().passes.filter((p) => p.warehouseId === warehouseId),
  myPasses: () => get().passes,

  createPass: async (p) => {
    const r = await apiCreatePass(p.warehouseId, {
      holderName: p.holderName, holderContact: p.holderContact,
      accessLevel: p.accessLevel, type: p.type, validUntil: p.validUntil,
    });
    await get().loadFor(p.warehouseId);
    return r.ok && r.data ? r.data.pass : null;
  },

  updatePass: async (id, p) => {
    const r = await apiUpdatePass(id, p);
    if (r.ok && r.data) await get().loadFor(r.data.pass.warehouseId);
  },

  blockPass: async (id) => { await get().updatePass(id, { active: false }); },
  unblockPass: async (id) => { await get().updatePass(id, { active: true }); },

  deletePass: async (id) => {
    const row = get().passes.find((p) => p.id === id);
    await apiDeletePass(id);
    if (row) await get().loadFor(row.warehouseId);
  },

  scanPass: async (code, warehouseId) => {
    const r = await apiScanPass(warehouseId, code);
    await get().loadFor(warehouseId);
    if (!r.ok || !r.data) return { ok: false, reason: r.reason ?? 'Проверить не удалось' };
    return { ok: r.data.ok, reason: r.data.reason, pass: r.data.pass };
  },

  visitsFor: (passId) => get().visitLogs.filter((v) => v.passId === passId),
  visitsForWarehouse: (warehouseId) => get().visitLogs.filter((v) => v.warehouseId === warehouseId),

  sendPass: async (passId, channel, target) => {
    const r = await apiSendPass(passId, channel, target);
    await get().loadSends(passId);
    return r.ok && r.data ? r.data.send : null;
  },

  sendLogsFor: (passId) => get().sendLogs.filter((s) => s.passId === passId),
}));
