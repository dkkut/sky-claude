/**
 * Уведомления сотрудников о новых заявках и очередях (server/staffnotify.mjs): куда присылать и какие очереди слушать.
 * Видно только сотрудникам и владельцу — для остальных сервер отвечает 403, и блок не рисуется.
 */
import { useEffect, useState } from 'react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Prefs { inApp: boolean; push: boolean; muted: string[]; categories: { key: string; label: string }[] }

export const StaffNotifySettings = () => {
  const [p, setP] = useState<Prefs | null>(null);
  useEffect(() => {
    let alive = true;
    void apiCall<Prefs>('/api/staff/notify-prefs').then((r) => { if (alive && r.ok && r.data) setP(r.data); });
    return () => { alive = false; };
  }, []);
  if (!p || !p.categories.length) return null;
  const save = async (next: Prefs) => {
    const prev = p; setP(next);
    const r = await apiCall('/api/staff/notify-prefs', { method: 'PUT', body: JSON.stringify({ inApp: next.inApp, push: next.push, muted: next.muted }) });
    if (!r.ok) { setP(prev); flash('Не удалось сохранить'); }
  };
  const chip = (on: boolean) => ({
    background: on ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'var(--bg-l2)',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, color: 'var(--t1)',
  });
  return (
    <div className="rounded-2xl overflow-hidden mb-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }} data-staff-notify>
      <div className="px-4 pt-3"><p className="text-sm font-black" style={{ color: 'var(--t1)' }}>Новые заявки в админке</p></div>
      <div className="px-4 py-3 space-y-3">
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--t3)' }}>Куда присылать</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={p.inApp} onClick={() => void save({ ...p, inApp: !p.inApp })} className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={chip(p.inApp)}>Раздел «Уведомления»</button>
            <button type="button" aria-pressed={p.push} onClick={() => void save({ ...p, push: !p.push })} className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={chip(p.push)}>Push</button>
          </div>
        </div>
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--t3)' }}>О чём сообщать</p>
          <div className="flex flex-wrap gap-1.5">
            {p.categories.map((c) => {
              const on = !p.muted.includes(c.key);
              return (
                <button key={c.key} type="button" aria-pressed={on}
                  onClick={() => void save({ ...p, muted: on ? [...p.muted, c.key] : p.muted.filter((x) => x !== c.key) })}
                  className="rounded-xl px-3 py-1.5 text-xs font-semibold" style={chip(on)}>{c.label}</button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--t3)' }}>
            Приходит каждая новая заявка по вашим правам. Не чаще 30 в минуту — остальное одним сообщением. Push приходит, когда приложение закрыто.
          </p>
        </div>
      </div>
    </div>
  );
};
