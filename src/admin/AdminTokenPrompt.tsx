/**
 * Окно «Введите токен администратора». Открывается само, когда сервер отказал из-за токена
 * (подтверждение личности, настройки), и из защиты раздела «Настройки». Токен хранится в памяти пару минут (adminTokenCache).
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, X } from 'lucide-react';
import { setAdminTokenCached } from '@/core/auth/adminTokenCache';
import { adminTokenApi, TOKEN_ERR } from './adminToken';

export const AdminTokenForm = ({ onDone, autoFocus = true }: { onDone: () => void; autoFocus?: boolean }) => {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!v.trim() || busy) return;
    setBusy(true); setErr('');
    const r = await adminTokenApi.unlock(v.trim());
    setBusy(false);
    if (!r.ok) { setErr((TOKEN_ERR[r.error ?? ''] ?? 'Не получилось.') + (r.data?.left != null ? ` Осталось попыток: ${r.data.left}.` : '')); return; }
    setAdminTokenCached(v.trim());
    setV('');
    window.dispatchEvent(new CustomEvent('sky:admin-unlocked'));
    onDone();
  };
  return (
    <div className="flex flex-col gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} autoFocus={autoFocus} autoComplete="off" spellCheck={false} placeholder="SKA-XXXXX-XXXXX-XXXXX-XXXXX" aria-label="Токен администратора" translate="no"
        onKeyDown={(e) => { if (e.key === 'Enter') void go(); }}
        className="w-full rounded-xl px-3 py-2.5 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)', letterSpacing: '.04em' }} />
      {err && <p className="text-[12px]" style={{ color: 'var(--red)' }} role="alert">{err}</p>}
      <button type="button" disabled={busy || !v.trim()} onClick={() => void go()} className="rounded-full px-5 py-2.5 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>{busy ? 'Проверяем…' : 'Подтвердить токеном'}</button>
    </div>
  );
};

export function AdminTokenPrompt() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    const on = (e: Event) => { setReason(String((e as CustomEvent).detail?.reason ?? '')); setOpen(true); };
    window.addEventListener('sky:admin-token', on);
    return () => window.removeEventListener('sky:admin-token', on);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Токен администратора" className="fixed inset-0 z-[10070] flex items-center justify-center p-4" style={{ background: 'rgba(5,5,14,.7)' }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="w-full max-w-[380px] rounded-3xl p-5" style={{ background: 'var(--bg-l1, #14142a)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
        <div className="mb-2 flex items-center gap-2">
          <KeyRound size={18} style={{ color: 'var(--accent)' }} />
          <p className="flex-1 text-[15px] font-bold">Токен администратора</p>
          <button type="button" onClick={close} aria-label="Закрыть" className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'var(--bg-l2)' }}><X size={16} /></button>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--t3)' }}>
          {reason === 'admin_settings_locked' ? 'Настройки администратора закрыты. Введите личный токен, чтобы открыть их на время сеанса.' : 'Для этого действия нужен личный токен администратора. После ввода повторите действие.'}
        </p>
        <AdminTokenForm onDone={close} />
      </div>
    </div>, document.body);
}
