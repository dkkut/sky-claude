/**
 * Настройки уведомлений владельца (server/ownernotify.mjs): что присылать и куда. Видно только владельцу —
 * для остальных сервер отвечает 403, и блок не рисуется.
 */
import { useEffect, useState } from 'react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Prefs { mode: 'requests' | 'all'; inApp: boolean; push: boolean; includeOwn: boolean; mutedAdmins: string[]; admins?: { id: string; username: string }[] }

export const OwnerNotifySettings = () => {
  const [p, setP] = useState<Prefs | null>(null);
  useEffect(() => {
    let alive = true;
    void apiCall<Prefs>('/api/owner/notify-prefs').then((r) => { if (alive && r.ok && r.data) setP(r.data); });
    return () => { alive = false; };
  }, []);
  if (!p) return null;
  const save = async (next: Prefs) => {
    const prev = p; setP(next);
    const { admins: _a, ...body } = next; void _a;
    const r = await apiCall('/api/owner/notify-prefs', { method: 'PUT', body: JSON.stringify(body) });
    if (!r.ok) { setP(prev); flash(r.error === 'no_channel' ? 'Оставьте включённым хотя бы один способ доставки.' : 'Не удалось сохранить'); }
  };
  const chip = (on: boolean) => ({
    background: on ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'var(--bg-l2)',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, color: 'var(--t1)',
  });
  return (
    <div className="rounded-2xl overflow-hidden mb-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }} data-owner-notify>
      <div className="px-4 pt-3"><p className="text-sm font-black" style={{ color: 'var(--t1)' }}>Уведомления владельца</p></div>
      <div className="px-4 py-3 space-y-3">
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--t3)' }}>Что присылать</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => void save({ ...p, mode: 'requests' })} className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={chip(p.mode === 'requests')}>Заявки на подтверждение</button>
            <button type="button" onClick={() => void save({ ...p, mode: 'all' })} className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={chip(p.mode === 'all')}>Все действия</button>
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--t3)' }}>
            {p.mode === 'all' ? 'Заявки и каждое действие администрации. Не чаще 20 уведомлений в минуту; журнал администрации всегда полный.' : 'Только то, что ждёт вашего решения.'}
          </p>
        </div>
        {p.mode === 'all' && (
          <div>
            <p className="text-xs mb-1.5" style={{ color: 'var(--t3)' }}>От кого присылать</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => void save({ ...p, includeOwn: !p.includeOwn })} className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={chip(p.includeOwn)}>Мои действия</button>
              {(p.admins ?? []).map((a) => {
                const on = !p.mutedAdmins.includes(a.id);
                return (
                  <button key={a.id} type="button" translate="no" aria-pressed={on}
                    onClick={() => void save({ ...p, mutedAdmins: on ? [...p.mutedAdmins, a.id] : p.mutedAdmins.filter((x) => x !== a.id) })}
                    className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={chip(on)}>{`@${a.username}`}</button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--t3)' }}>Нажмите на администратора, чтобы отключить или снова включить уведомления о его действиях. «Мои действия» — уведомлять и о ваших собственных.</p>
          </div>
        )}
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--t3)' }}>Куда присылать</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => void save({ ...p, inApp: !p.inApp })} className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={chip(p.inApp)}>Раздел «Уведомления»</button>
            <button type="button" onClick={() => void save({ ...p, push: !p.push })} className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={chip(p.push)}>Push</button>
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--t3)' }}>Push приходит, когда приложение закрыто, и только если на сервере настроены push-ключи (scripts/setup-push.sh).</p>
        </div>
      </div>
    </div>
  );
};
