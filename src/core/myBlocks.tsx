/**
 * Блокировки вкладок, выданные администрацией ЭТОМУ человеку (server/modblocks.mjs), и заявка на вывод остатка баланса.
 * Сервер дополнительно закрывает API заблокированного модуля (403 module_blocked) — здесь только показ.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Ban, Loader2, Wallet, X } from 'lucide-react';
import { apiCall } from './auth/api';
import { useAuthStore } from './auth/store';
import { flash } from '@/shared/flash';

export interface WithdrawReq { id: string; amountRub: number; status: 'pending' | 'paid' | 'rejected' | 'cancelled'; reason: string; at: string }
interface S { blocks: Record<string, { reason?: string }>; balance: number; request: WithdrawReq | null; load: () => Promise<void>; reset: () => void }

export const useMyBlocks = create<S>((set) => ({
  blocks: {}, balance: 0, request: null,
  load: async () => {
    const r = await apiCall<{ blocks: S['blocks']; balance: number; request: WithdrawReq | null }>('/api/me/module-blocks');
    if (r.ok && r.data) set({ blocks: r.data.blocks ?? {}, balance: r.data.balance ?? 0, request: r.data.request ?? null });
  },
  reset: () => set({ blocks: {}, balance: 0, request: null }),
}));

let started = false;
export const startMyBlocks = () => {
  if (started || typeof window === 'undefined') return;
  started = true;
  const load = () => { if (useAuthStore.getState().currentUserId && document.visibilityState === 'visible') void useMyBlocks.getState().load(); };
  load();
  window.setInterval(load, 60_000);
  let prev = useAuthStore.getState().currentUserId;
  useAuthStore.subscribe((st) => { if (st.currentUserId !== prev) { prev = st.currentUserId; useMyBlocks.getState().reset(); load(); } });
  document.addEventListener('visibilitychange', load);
};

const ERR: Record<string, string> = {
  not_blocked: 'Заявка нужна только при закрытом доступе.', details_required: 'Укажите, куда перевести деньги (от 8 знаков).', bad_details: 'Не указывайте PIN, пароли и коды из SMS — только номер счёта, карты или телефон получателя.',
  no_balance: 'На балансе нет денег для вывода.', bad_amount: 'Сумма больше остатка на балансе.', already_open: 'У вас уже есть заявка на рассмотрении.', rate_limited: 'Слишком часто. Попробуйте позже.',
};
const STATUS: Record<string, string> = { pending: 'на рассмотрении', paid: 'выполнена', rejected: 'отклонена', cancelled: 'отменена' };

export const WithdrawDialog = ({ onClose }: { onClose: () => void }) => {
  const { balance, request, load } = useMyBlocks();
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void load(); }, [load]);
  const send = async () => {
    setBusy(true);
    const r = await apiCall<{ amountRub: number }>('/api/withdraw', { method: 'POST', body: JSON.stringify({ details }) });
    setBusy(false);
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? r.reason ?? 'Не получилось'); return; }
    flash('Заявка отправлена'); await load();
  };
  const cancel = async () => {
    setBusy(true); const r = await apiCall('/api/withdraw', { method: 'DELETE' }); setBusy(false);
    if (!r.ok) { flash('Не получилось отменить'); return; }
    await load();
  };
  const open = request?.status === 'pending';
  return (
    <div className="fixed inset-0 z-[10050] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Заявка на вывод остатка">
      <div className="w-full max-w-sm rounded-3xl p-5" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
        <div className="flex items-center gap-2">
          <Wallet size={18} /><p className="flex-1 text-base font-black">Вывод остатка</p>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-full p-1.5" style={{ background: 'var(--bg-l3)' }}><X size={14} /></button>
        </div>
        <p className="mt-3 text-sm" style={{ color: 'var(--t2)' }}>На балансе: <b translate="no" style={{ color: 'var(--t1)' }}>{balance.toLocaleString('ru-RU')} ₽</b></p>
        {open ? (
          <>
            <p className="mt-3 rounded-2xl p-3 text-xs" style={{ background: 'var(--bg-l3)', color: 'var(--t2)' }}>Заявка на <b translate="no">{request!.amountRub.toLocaleString('ru-RU')} ₽</b> на рассмотрении. Деньги переведёт сотрудник по указанным вами данным, после чего остаток спишется с баланса.</p>
            <button type="button" disabled={busy} onClick={() => void cancel()} className="mt-3 w-full rounded-full py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отменить заявку</button>
          </>
        ) : (
          <>
            {request && <p className="mt-3 text-xs" style={{ color: 'var(--t3)' }}>Прошлая заявка: {STATUS[request.status]}{request.reason ? ` — ${request.reason}` : ''}</p>}
            {balance < 1 ? <p className="mt-3 text-sm" style={{ color: 'var(--t2)' }}>Выводить нечего.</p> : (
              <>
                <label className="mt-3 block text-xs font-semibold" style={{ color: 'var(--t2)' }}>Куда перевести (карта, счёт, телефон СБП)
                  <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={300} rows={3} placeholder="Например: Сбербанк, карта 2202 …, получатель Иван И."
                    className="mt-1 w-full resize-none rounded-2xl px-3 py-2 text-sm outline-none" style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)', color: 'var(--t1)' }} />
                </label>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--t3)' }}>Выводится весь остаток. Не указывайте PIN, пароли и коды из SMS.</p>
                <button type="button" disabled={busy || details.trim().length < 8} onClick={() => void send()} className="mt-3 w-full rounded-full py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>
                  {busy ? <Loader2 size={14} className="mx-auto animate-spin" /> : 'Отправить заявку'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/** Экран вместо заблокированной вкладки: причина (если разрешено показывать) и кнопка заявки на вывод остатка. */
export const BlockedScreen = ({ reason }: { reason?: string }) => {
  const [ask, setAsk] = useState(false);
  const { balance, request } = useMyBlocks();
  return (
    <div role="alert" data-keep-dark className="relative grid h-full w-full place-items-center overflow-hidden px-6"
      style={{ background: 'radial-gradient(110% 80% at 50% 0%, #2a1b3d 0%, #0b0c1f 55%, #06060d 100%)', color: '#fff' }}>
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl" style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', color: '#f87171' }}><Ban size={34} /></div>
        <h2 className="text-xl font-black">Доступ к разделу ограничен</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,.7)' }}>Администрация закрыла для вас этот раздел.</p>
        {reason && <p className="mt-3 rounded-2xl px-4 py-2.5 text-xs" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.75)' }}>{reason}</p>}
        {(balance >= 1 || request?.status === 'pending') && (
          <button type="button" onClick={() => setAsk(true)} data-withdraw-open className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold" style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.25)', color: '#fff' }}>
            <Wallet size={16} /> {request?.status === 'pending' ? 'Заявка на вывод: на рассмотрении' : 'Заявка на вывод остатка'}
          </button>
        )}
      </div>
      {ask && <WithdrawDialog onClose={() => setAsk(false)} />}
    </div>
  );
};
