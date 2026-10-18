/** «Sky ID на этом устройстве»: до трёх аккаунтов, переключение без повторного входа. Токены здесь не показываются и не хранятся (см. core/auth/slots.ts). */
import { useState } from 'react';
import { Plus, Check, LogOut, Users } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { apiLogout } from '@/core/auth/api';
import { MAX_SLOTS, getActiveSlot, setActiveSlot, listSlots, removeSlot, freeSlot, startAdding, addingFrom, stopAdding, type Slot } from '@/core/auth/slots';

const maskLabel = (s: string) => {
  const t = String(s ?? ''); const at = t.indexOf('@');
  if (at > 1) return `${t.slice(0, 2)}***${t.slice(at)}`;
  return t.length > 6 ? `${t.slice(0, 3)}***${t.slice(-2)}` : t;
};
const go = (n: Slot) => { setActiveSlot(n); stopAdding(); setTimeout(() => window.location.reload(), 50); };

export const DeviceAccounts = () => {
  const sky = useAuthStore((s) => s.sky);
  const [tick, setTick] = useState(0);
  const slots = listSlots(); const active = getActiveSlot(); const free = freeSlot();
  void tick;
  if (!sky) return null;
  const add = () => { if (!free) return; startAdding(active); setActiveSlot(free); setTimeout(() => window.location.reload(), 50); };
  const leave = async (n: Slot) => {
    if (n === active) { useAuthStore.getState().logout(); return; }
    // Выход из неактивного Sky ID: на секунду переключаем слот, чтобы сервер отозвал именно его сессию.
    const prev = getActiveSlot(); setActiveSlot(n);
    try { await apiLogout(); } finally { removeSlot(n); setActiveSlot(prev); setTick((x) => x + 1); }
  };
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }} data-device-accounts>
      <div className="mb-2 flex items-center gap-2"><Users size={15} style={{ color: 'var(--accent)' }} /><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Sky ID на этом устройстве</p></div>
      <p className="mb-3 text-[12px]" style={{ color: 'var(--t3)' }}>{`Можно подключить до ${MAX_SLOTS} Sky ID и переключаться между ними без нового входа. Каждый вход проходит все обычные проверки.`}</p>
      <div className="space-y-2">
        {slots.map((s) => (
          <div key={s.slot} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: 'var(--bg-l2)', border: `1px solid ${s.slot === active ? 'var(--accent)' : 'var(--border)'}` }} data-slot={s.slot}>
            <div className="min-w-0 flex-1">
              <p translate="no" className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }}>{s.name || 'Профиль'}</p>
              <p translate="no" className="truncate text-[11.5px]" style={{ color: 'var(--t3)' }}>{maskLabel(s.label)}</p>
            </div>
            {s.slot === active
              ? <span className="flex items-center gap-1 text-[11.5px] font-bold" style={{ color: 'var(--accent)' }}><Check size={13} />Активен</span>
              : <button type="button" onClick={() => go(s.slot)} className="min-h-[36px] rounded-lg px-3 text-xs font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>Переключиться</button>}
            <button type="button" aria-label="Выйти из этого Sky ID" onClick={() => void leave(s.slot)} className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: 'var(--bg-l1)', color: 'var(--t3)' }}><LogOut size={15} /></button>
          </div>))}
      </div>
      <button type="button" disabled={!free} onClick={add} className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl text-sm font-bold disabled:opacity-50" style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid rgba(79,110,247,0.25)' }}>
        <Plus size={15} />{free ? 'Добавить Sky ID' : `Подключено максимум — ${MAX_SLOTS}`}
      </button>
    </div>
  );
};

/** На экране входа при добавлении ещё одного Sky ID: вернуться к прежнему. */
export const CancelAddAccount = () => {
  const prev = addingFrom();
  if (!prev) return null;
  return (
    <button type="button" onClick={() => go(prev)} className="fixed left-3 z-50 rounded-xl px-3 py-2 text-xs font-bold" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)', background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}>← Отмена, остаться в прежнем Sky ID</button>
  );
};
