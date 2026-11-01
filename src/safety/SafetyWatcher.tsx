/**
 * Sky Safety на этом устройстве. Работает ТОЛЬКО если человек включил «следить на этом устройстве» (localStorage `sky:safety:device`) и пока приложение открыто и видимо:
 * ни веб, ни наши приложения не получают фоновую геолокацию (iOS и Android её ограничивают), и мы не обещаем обратного. Точная геолокация и датчики потребляют батарею —
 * поэтому включение явное, отдельное для каждого устройства, а при скрытом окне слежение останавливается.
 * Решение «резкая остановка» принимает src/safety/detector.ts; сервер создаёт событие со сроком и сам предупредит контакты, если ответа нет.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { useAuthStore } from '@/core/auth/store';
import { CrashDetector } from './detector';
import { useGeoConsent } from '@/maps/geoConsent';

const KEY = 'sky:safety:device';
export const safetyDeviceOn = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const setSafetyDevice = (on: boolean) => {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* память недоступна */ }
  window.dispatchEvent(new Event('sky:safety'));
};
/** iOS просит разрешение на датчики по нажатию. Возвращает true, если датчик движения можно использовать. */
export const askMotionPermission = async (): Promise<boolean> => {
  const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
  if (!DME) return false;
  if (typeof DME.requestPermission === 'function') { try { return (await DME.requestPermission()) === 'granted'; } catch { return false; } }
  return true;
};

export const SafetyWatcher = () => {
  const uid = useAuthStore((s) => s.currentUserId);
  const consent = useGeoConsent();
  const [on, setOn] = useState(safetyDeviceOn());
  const [prompt, setPrompt] = useState<{ id: string; deadline: number } | null>(null);
  const [left, setLeft] = useState(0);
  const det = useRef(new CrashDetector());
  const busy = useRef(false);

  useEffect(() => { const f = () => setOn(safetyDeviceOn()); window.addEventListener('sky:safety', f); return () => window.removeEventListener('sky:safety', f); }, []);

  const fire = useCallback(async (tr: { speedBeforeKmh: number; dropKmh: number; signals: string }, p: GeolocationCoordinates | null) => {
    if (busy.current) return; busy.current = true;
    const r = await apiCall<{ id: string; deadlineSec: number }>('/api/safety/trigger', { method: 'POST', body: JSON.stringify({ ...tr, lat: p?.latitude, lng: p?.longitude }) });
    busy.current = false;
    if (r.ok && r.data) setPrompt({ id: r.data.id, deadline: Date.now() + r.data.deadlineSec * 1000 });
  }, []);

  /* После перезапуска приложения подхватываем уже ожидающее событие. */
  useEffect(() => {
    if (!on || !uid) return;
    void apiCall<{ pending: { id: string; deadlineAt: string } | null }>('/api/safety').then((r) => {
      const p = r.ok ? r.data?.pending : null;
      if (p && new Date(p.deadlineAt).getTime() > Date.now()) setPrompt({ id: p.id, deadline: new Date(p.deadlineAt).getTime() });
    });
  }, [on, uid]);

  useEffect(() => {
    if (!on || !uid || !consent || !('geolocation' in navigator)) return;
    let watch: number | null = null; let last: GeolocationCoordinates | null = null;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity; if (!a) return;
      const g = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2) / 9.80665;
      const rr = e.rotationRate; const dps = rr ? Math.max(Math.abs(rr.alpha ?? 0), Math.abs(rr.beta ?? 0), Math.abs(rr.gamma ?? 0)) : null;
      const tr = det.current.motion(g, dps, Date.now()); if (tr) void fire(tr, last);
    };
    const start = () => {
      if (watch != null || document.hidden) return;
      watch = navigator.geolocation.watchPosition((pos) => {
        last = pos.coords;
        const tr = det.current.gps(pos.coords.speed, pos.coords.accuracy, Date.now()); if (tr) void fire(tr, last);
      }, () => { /* нет GPS — просто нет замеров, это не событие */ }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30_000 });
      window.addEventListener('devicemotion', onMotion);
    };
    const stop = () => { if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; } window.removeEventListener('devicemotion', onMotion); };
    const vis = () => (document.hidden ? stop() : start());
    start(); document.addEventListener('visibilitychange', vis);
    return () => { stop(); document.removeEventListener('visibilitychange', vis); };
  }, [on, uid, fire, consent]);

  useEffect(() => {
    if (!prompt) return;
    const t = window.setInterval(() => { const s = Math.max(0, Math.round((prompt.deadline - Date.now()) / 1000)); setLeft(s); if (s <= 0) { window.clearInterval(t); } }, 500);
    setLeft(Math.max(0, Math.round((prompt.deadline - Date.now()) / 1000)));
    return () => window.clearInterval(t);
  }, [prompt]);

  if (!prompt) return null;
  const expired = left <= 0;
  const ok = async () => { await apiCall(`/api/safety/${prompt.id}/ok`, { method: 'POST', body: '{}' }); setPrompt(null); };
  return (
    <div role="alertdialog" aria-modal="true" aria-label="Подтвердите безопасность" className="fixed inset-0 flex items-center justify-center p-6" style={{ zIndex: 100010, background: 'rgba(0,0,0,.78)' }}>
      <div className="w-full max-w-sm space-y-4 rounded-3xl p-6 text-center" style={{ background: 'var(--bg-l1)', border: '1px solid var(--red)' }} data-keep-dark>
        <ShieldAlert size={44} className="mx-auto" style={{ color: 'var(--red)' }} />
        <h2 className="text-lg font-bold" style={{ color: 'var(--t1)' }}>{expired ? 'Время вышло' : 'Вы в порядке?'}</h2>
        <p className="text-sm" style={{ color: 'var(--t2)' }}>{expired
          ? 'Доверенные контакты получили предупреждение. Если всё хорошо — нажмите кнопку, мы их успокоим.'
          : 'Мы заметили резкую остановку. Если вы не ответите, доверенным контактам уйдёт предупреждение с вашим последним положением.'}</p>
        {!expired && <div className="text-4xl font-bold tabular-nums" style={{ color: 'var(--red)' }}>{left} с</div>}
        <button type="button" onClick={() => void ok()} className="w-full rounded-2xl py-3 text-base font-bold" style={{ background: 'var(--green)', color: '#fff' }}>Я в порядке</button>
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Это не вызов экстренных служб. При опасности звоните 112.</p>
      </div>
    </div>
  );
};
