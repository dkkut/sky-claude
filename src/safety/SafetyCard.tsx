/** Настройки Sky Safety (внутри «Карты друзей»): доверенные контакты (с их согласием), срок ответа, включение на этом устройстве. */
import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { askMotionPermission, safetyDeviceOn, setSafetyDevice } from './SafetyWatcher';

interface P { id: string; name: string; username?: string }
interface S { enabled: boolean; timeoutSec: number; contacts: (P & { status: 'pending' | 'accepted' })[]; invitations: P[]; watchingCount: number; friends: P[] }
const ERR: Record<string, string> = { need_contact: 'Сначала добавьте доверенный контакт и дождитесь, пока он примет приглашение.', not_friends: 'Контактом может быть только друг.', too_many: 'Не больше пяти контактов.', feature_off: 'Sky Safety сейчас отключена администрацией.', bad_timeout: 'Срок должен быть от 30 до 180 секунд.' };

export const SafetyCard = () => {
  const [s, setS] = useState<S | null>(null);
  const [dev, setDev] = useState(safetyDeviceOn());
  const [pick, setPick] = useState('');
  const load = useCallback(async () => { const r = await apiCall<S>('/api/safety'); if (r.ok && r.data) setS(r.data); }, []);
  useEffect(() => { void load(); }, [load]);
  const call = async (path: string, method: string, body: object, ok?: string) => {
    const r = await apiCall(`/api/safety${path}`, { method, body: JSON.stringify(body) });
    if (!r.ok) flash(ERR[r.error ?? ''] ?? `Не получилось${r.error ? ` (${r.error})` : ''}`); else if (ok) flash(ok);
    await load(); return r.ok;
  };
  if (!s) return null;
  const hasMotion = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  const card = { background: 'var(--bg-l1)', border: '1px solid var(--border)' };
  const accepted = s.contacts.some((c) => c.status === 'accepted');
  const free = s.friends.filter((f) => !s.contacts.some((c) => c.id === f.id));
  const btn = { background: 'var(--accent)', color: '#fff' };
  return (
    <section className="space-y-2 rounded-2xl p-3" style={card}>
      <h3 className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--t1)' }}><ShieldAlert size={15} />Sky Safety</h3>
      <p className="text-xs" style={{ color: 'var(--t3)' }}>Если после быстрой езды (от 30 км/ч) вы резко остановились и датчики телефона зафиксировали удар, Sky спросит, всё ли в порядке. Не ответите вовремя — доверенные контакты получат ваше последнее положение. Потеря GPS и обычное торможение предупреждением не считаются. Это не вызов экстренных служб.</p>

      {s.invitations.map((i) => (
        <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-xl p-2 text-sm" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}>
          <span className="flex-1" translate="no">{i.name}</span><span className="text-xs" style={{ color: 'var(--t2)' }}>просит стать доверенным контактом</span>
          <button type="button" className="rounded-lg px-2 py-1 text-xs font-bold" style={btn} onClick={() => void call('/invites', 'POST', { ownerId: i.id, accept: true }, 'Принято')}>Принять</button>
          <button type="button" className="rounded-lg px-2 py-1 text-xs font-bold" style={{ background: 'var(--bg-l1)', color: 'var(--t1)' }} onClick={() => void call('/invites', 'POST', { ownerId: i.id, accept: false })}>Отказаться</button>
        </div>))}
      {s.watchingCount > 0 && <p className="text-xs" style={{ color: 'var(--t2)' }}>Вы доверенный контакт у людей: {s.watchingCount}.</p>}

      <div className="text-xs font-bold" style={{ color: 'var(--t1)' }}>Доверенные контакты</div>
      {s.contacts.length === 0 && <p className="text-xs" style={{ color: 'var(--t3)' }}>Пока никого.</p>}
      {s.contacts.map((c) => (
        <div key={c.id} className="flex items-center gap-2 text-sm" style={{ color: 'var(--t1)' }}>
          <span className="flex-1" translate="no">{c.name}</span>
          <span className="text-xs" style={{ color: c.status === 'accepted' ? 'var(--green)' : 'var(--amber)' }}>{c.status === 'accepted' ? 'принял' : 'ждём ответа'}</span>
          <button type="button" className="text-xs underline" style={{ color: 'var(--red)' }} onClick={() => void call('/contacts/remove', 'POST', { contactId: c.id })}>убрать</button>
        </div>))}
      {free.length > 0 && s.contacts.length < 5 && (
        <div className="flex gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 rounded-xl px-2 py-1.5 text-sm" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}>
            <option value="">Выберите друга…</option>{free.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          <button type="button" disabled={!pick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40" style={btn} onClick={() => void call('/contacts', 'POST', { contactId: pick }, 'Приглашение отправлено').then(() => setPick(''))}>Пригласить</button>
        </div>)}

      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--t1)' }}>
        <input type="checkbox" checked={s.enabled} disabled={!accepted && !s.enabled} onChange={(e) => void call('/settings', 'PUT', { enabled: e.target.checked, timeoutSec: s.timeoutSec })} />
        Включить Sky Safety в аккаунте</label>
      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--t2)' }}>Время на ответ:
        <select value={s.timeoutSec} onChange={(e) => void call('/settings', 'PUT', { enabled: s.enabled, timeoutSec: Number(e.target.value) })} className="rounded-lg px-2 py-1" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}>
          {[30, 60, 90, 120, 180].map((n) => <option key={n} value={n}>{n} с</option>)}</select></label>
      <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--t1)' }}>
        <input type="checkbox" className="mt-1" checked={dev} onChange={async (e) => {
          if (e.target.checked && !(await askMotionPermission())) { flash('Датчики движения недоступны или не разрешены — слежение не сработает.'); return; }
          setSafetyDevice(e.target.checked); setDev(e.target.checked);
        }} />
        <span>Следить на этом устройстве<span className="block text-xs" style={{ color: 'var(--t3)' }}>Работает, только пока Sky открыт на экране: фоновая геолокация в браузере и приложениях ограничена iOS и Android. Точный GPS и датчики расходуют батарею.{!hasMotion ? ' На этом устройстве нет датчика движения — функция срабатывать не будет.' : ''}</span></span></label>
    </section>
  );
};
