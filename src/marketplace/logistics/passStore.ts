/* ======================================================================
   SKY MARKET / LOGISTICS  —  Access pass store
====================================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import type { AccessPass, PassVisitLog, PassSendLog, AccessLevel, PassType, PassSendChannel } from './types';

const KEY = 'sky:logistics:passes:v1';
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
const genCode = () => Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8).padEnd(8,'X');

export const ACCESS_LEVELS: { key: AccessLevel; label: string; color: string }[] = [
  { key:'guest',    label:'Гость',    color:'#8b8b97' },
  { key:'employee', label:'Сотрудник',color:'#4f6ef7' },
  { key:'manager',  label:'Менеджер', color:'#a78bfa' },
  { key:'owner',    label:'Владелец', color:'#f59e0b' },
];

interface PassState {
  passes:    AccessPass[];
  visitLogs: PassVisitLog[];
  sendLogs:  PassSendLog[];

  passesFor: (warehouseId: string) => AccessPass[];
  myPasses:  () => AccessPass[];

  createPass: (p: {
    warehouseId: string; holderName: string; holderContact: string;
    accessLevel: AccessLevel; type: PassType; validUntil: string | null;
  }) => AccessPass;
  updatePass: (id: string, p: Partial<AccessPass>) => void;
  blockPass:  (id: string) => void;
  unblockPass:(id: string) => void;
  deletePass: (id: string) => void;

  scanPass:   (code: string) => { ok: boolean; reason?: string; pass?: AccessPass };
  visitsFor:  (passId: string) => PassVisitLog[];
  visitsForWarehouse: (warehouseId: string) => PassVisitLog[];

  sendPass:   (passId: string, channel: PassSendChannel, target: string) => PassSendLog;
  sendLogsFor:(passId: string) => PassSendLog[];
}

const stored = load();

export const usePassStore = create<PassState>((set, get) => {
  const flush = () => {
    const s = get();
    save({ passes: s.passes, visitLogs: s.visitLogs, sendLogs: s.sendLogs });
  };
  const mut = (fn: (s: PassState) => Partial<PassState>) => {
    set(s => ({ ...s, ...fn(s) }));
    flush();
  };

  return {
    passes:    stored?.passes    ?? [],
    visitLogs: stored?.visitLogs ?? [],
    sendLogs:  stored?.sendLogs  ?? [],

    passesFor: (warehouseId) => get().passes.filter(p => p.warehouseId === warehouseId)
      .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),

    myPasses: () => {
      const sellerId = me();
      return get().passes.filter(p => p.sellerId === sellerId);
    },

    createPass: ({ warehouseId, holderName, holderContact, accessLevel, type, validUntil }) => {
      const sellerId = me();
      const pass: AccessPass = {
        id: genId('pass'), warehouseId, sellerId,
        holderName: holderName.trim(), holderContact: holderContact.trim(),
        accessLevel, type, code: genCode(),
        validFrom: new Date().toISOString(),
        validUntil: type === 'permanent' ? null : validUntil,
        active: true, createdAt: new Date().toISOString(),
      };
      mut(s => ({ passes: [pass, ...s.passes] }));
      return pass;
    },

    updatePass: (id, p) => mut(s => ({ passes: s.passes.map(x => x.id===id ? { ...x, ...p } : x) })),

    blockPass:   (id) => mut(s => ({ passes: s.passes.map(x => x.id===id ? { ...x, active:false } : x) })),
    unblockPass: (id) => mut(s => ({ passes: s.passes.map(x => x.id===id ? { ...x, active:true }  : x) })),
    deletePass:  (id) => mut(s => ({ passes: s.passes.filter(x => x.id !== id) })),

    scanPass: (code) => {
      const pass = get().passes.find(p => p.code === code.trim().toUpperCase());
      if (!pass) return { ok:false, reason:'Пропуск с таким кодом не найден' };
      if (!pass.active) return { ok:false, reason:'Пропуск заблокирован владельцем', pass };
      if (pass.validUntil && new Date(pass.validUntil).getTime() < Date.now()) {
        return { ok:false, reason:'Срок действия пропуска истёк', pass };
      }
      const visits = get().visitLogs.filter(v => v.passId === pass.id);
      const last = visits[visits.length - 1];
      const action: 'entry'|'exit' = (!last || last.action === 'exit') ? 'entry' : 'exit';
      const log: PassVisitLog = {
        id: genId('vis'), passId: pass.id, warehouseId: pass.warehouseId,
        action, confirmedBy: 'qr_scan', at: new Date().toISOString(),
      };
      mut(s => ({ visitLogs: [...s.visitLogs, log] }));
      return { ok:true, pass };
    },

    visitsFor: (passId) => get().visitLogs.filter(v => v.passId === passId)
      .sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime()),

    visitsForWarehouse: (warehouseId) => get().visitLogs.filter(v => v.warehouseId === warehouseId)
      .sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime()),

    sendPass: (passId, channel, target) => {
      const log: PassSendLog = { id: genId('snd'), passId, channel, target: target.trim(), sentAt: new Date().toISOString() };
      mut(s => ({ sendLogs: [...s.sendLogs, log] }));
      return log;
    },

    sendLogsFor: (passId) => get().sendLogs.filter(s => s.passId === passId),
  };
});
