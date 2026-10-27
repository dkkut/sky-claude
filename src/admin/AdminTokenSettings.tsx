/**
 * Личный токен администратора/владельца: создать, заменить, отозвать (Профиль → Sky ID) и замок раздела «Настройки» (AdminSettingsLock).
 * Токен — ещё один фактор: вход в панель, подтверждения, изменения в админке. Показывается один раз; на сервере хранится только хеш.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { KeyRound, Copy, Check, Lock } from 'lucide-react';
import { adminTokenApi, TOKEN_ERR, type AdminTokenState } from './adminToken';
import { AdminTokenForm } from './AdminTokenPrompt';
import { clearAdminTokenCached } from '@/core/auth/adminTokenCache';

const useTokenState = () => {
  const [st, setSt] = useState<AdminTokenState | null>(null);
  const load = useCallback(async () => { const r = await adminTokenApi.state(); setSt(r.ok && r.data ? r.data : { admin: false }); }, []);
  useEffect(() => { void load(); const on = () => void load(); window.addEventListener('sky:admin-unlocked', on); return () => window.removeEventListener('sky:admin-unlocked', on); }, [load]);
  return { st, load };
};

export function AdminTokenSettings() {
  const { st, load } = useTokenState();
  const [code, setCode] = useState('');
  const [shown, setShown] = useState('');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!st?.admin) return null;
  const issue = async () => {
    setBusy(true); setErr('');
    const r = await adminTokenApi.issue(code.replace(/\s+/g, ''));
    setBusy(false);
    if (!r.ok || !r.data) { setErr(TOKEN_ERR[r.error ?? ''] ?? 'Не получилось создать токен.'); return; }
    setShown(r.data.token); setCode(''); clearAdminTokenCached(); void load();
  };
  const revoke = async () => {
    if (!window.confirm('Отозвать токен? Без него панель администратора будет закрыта, пока не создадите новый.')) return;
    setBusy(true); setErr('');
    const r = await adminTokenApi.revoke(code.replace(/\s+/g, ''));
    setBusy(false);
    if (!r.ok) { setErr(TOKEN_ERR[r.error ?? ''] ?? 'Не получилось.'); return; }
    setCode(''); setShown(''); clearAdminTokenCached(); void load();
  };
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="mb-1 flex items-center gap-2"><KeyRound size={16} style={{ color: 'var(--accent)' }} /><p className="text-[14px] font-bold" style={{ color: 'var(--t1)' }}>Токен администратора</p></div>
      <p className="mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--t3)' }}>
        Личный токен нужен для входа в панель, подтверждений и настроек — вместе с почтой и кодом аутентификатора. Он показывается один раз; потеряли — создайте новый.
        {!st.required && ' Сейчас требование выключено на сервере (ADMIN_TOKEN=off).'}
      </p>
      <p className="mb-2 text-[12.5px]" style={{ color: 'var(--t2)' }}>{st.has ? <>Токен создан{st.last4 ? <> · оканчивается на <b translate="no">{st.last4}</b></> : null}{st.createdAt ? ` · ${new Date(st.createdAt).toLocaleDateString()}` : ''}.</> : 'Токен ещё не создан — панель администратора закрыта.'}</p>
      {shown && (
        <div className="mb-3 rounded-xl p-3" style={{ background: 'var(--bg-l3, rgba(255,255,255,.06))', border: '1px solid var(--accent)' }}>
          <p className="mb-1 text-[11.5px]" style={{ color: 'var(--t3)' }}>Сохраните сейчас — больше он не показывается:</p>
          <p className="break-all text-[15px] font-bold" style={{ color: 'var(--t1)', letterSpacing: '.04em' }} translate="no">{shown}</p>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(shown).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Скопировано' : 'Скопировать'}</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Код из аутентификатора" aria-label="Код из аутентификатора"
          className="w-[190px] rounded-xl px-3 py-2 text-[13px] outline-none" style={{ background: 'var(--bg-l1, rgba(0,0,0,.2))', color: 'var(--t1)', border: '1px solid var(--border)' }} />
        <button type="button" disabled={busy || code.length !== 6} onClick={() => void issue()} className="rounded-full px-4 py-2 text-[12.5px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>{st.has ? 'Заменить токен' : 'Создать токен'}</button>
        {st.has && <button type="button" disabled={busy || code.length !== 6} onClick={() => void revoke()} className="rounded-full px-4 py-2 text-[12.5px] font-semibold disabled:opacity-50" style={{ background: 'var(--bg-l1, rgba(255,255,255,.08))', color: 'var(--red)' }}>Отозвать</button>}
      </div>
      {err && <p className="mt-2 text-[12px]" style={{ color: 'var(--red)' }} role="alert">{err}</p>}
    </div>
  );
}

/** Раздел «Настройки» у администратора и владельца закрыт, пока не введён токен (сервер ещё и закрывает их серверные настройки). */
export function AdminSettingsLock({ children }: { children: ReactNode }) {
  const { st, load } = useTokenState();
  if (!st) return <div className="p-6 text-[12px]" style={{ color: 'var(--t3)' }}>…</div>;
  if (!st.admin || !st.required || st.unlocked) return <>{children}</>;
  return (
    <div className="mx-auto flex max-w-[380px] flex-col items-center gap-3 px-6 py-12 text-center">
      <Lock size={26} style={{ color: 'var(--accent)' }} />
      <p className="text-[15px] font-bold" style={{ color: 'var(--t1)' }}>Настройки закрыты токеном</p>
      {st.has
        ? <><p className="text-[12.5px]" style={{ color: 'var(--t3)' }}>Введите личный токен администратора — настройки откроются на {st.unlockMinutes ?? 30} мин.</p><div className="w-full"><AdminTokenForm onDone={() => void load()} /></div></>
        : <p className="text-[12.5px]" style={{ color: 'var(--t3)' }}>Токен ещё не создан. Создайте его в Профиль → Sky ID → «Токен администратора».</p>}
    </div>
  );
}
