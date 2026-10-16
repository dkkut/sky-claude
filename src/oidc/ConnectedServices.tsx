/** Профиль → Sky ID: сервисы, в которые вы входили через Sky ID, и отзыв доступа (server/oidc.mjs). */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Link2Off } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Consent { clientId: string; name: string; homepage: string; scopes: string[]; grantedAt: string; lastUsedAt: string | null }
const SCOPE_NAME: Record<string, string> = { openid: 'вход', profile: 'имя', email: 'почта', phone: 'телефон' };

export const ConnectedServices = () => {
  const [list, setList] = useState<Consent[] | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    const r = await apiCall<{ consents: Consent[] }>('/api/oidc/consents');
    setList(r.ok ? (r.data?.consents ?? []) : []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const revoke = async (c: Consent) => {
    if (!window.confirm(`Отозвать доступ сервиса «${c.name}»? Он перестанет получать данные, а для следующего входа понадобится новое подтверждение.`)) return;
    setBusy(c.clientId);
    const r = await apiCall(`/api/oidc/consents/${encodeURIComponent(c.clientId)}`, { method: 'DELETE' });
    setBusy('');
    if (r.ok) { flash('Доступ отозван'); void load(); } else flash(r.reason ?? 'Не удалось отозвать доступ');
  };
  if (list === null) return <Loader2 size={16} className="animate-spin" style={{ color: 'var(--t3)' }} />;
  return (
    <div className="space-y-2 rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }} data-oidc-consents>
      <p className="text-[14px] font-bold" style={{ color: 'var(--t1)' }}>Сервисы, подключённые через Sky ID</p>
      <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Каждый сервис видит свой случайный идентификатор — по нему разные сервисы не узнают, что это вы. Имя, почту и телефон они получают только если вы разрешили.</p>
      {list.length === 0 && <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Пока ни один сервис не подключён.</p>}
      {list.map((c) => (
        <div key={c.clientId} className="flex items-center justify-between gap-2 rounded-xl p-2.5" style={{ background: 'var(--bg-l2)' }}>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--t1)' }} translate="no">{c.name}</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Разрешено: {c.scopes.map((s) => SCOPE_NAME[s] ?? s).join(', ')} · с {new Date(c.grantedAt).toLocaleDateString('ru-RU')}</p>
          </div>
          <button type="button" disabled={busy === c.clientId} onClick={() => void revoke(c)} className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)' }}>
            <Link2Off size={13} /> Отозвать
          </button>
        </div>
      ))}
    </div>
  );
};
