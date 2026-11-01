/**
 * Карта друзей (Sky Maps). Только настоящие данные: друзья, которые САМИ включили показ себя именно вам, и их последняя точка.
 *
 *  — по умолчанию вы никому себя не показываете; список «кому видно» выбираете сами, только из друзей;
 *  — пока вы делитесь, телефон/браузер шлёт точку, ЛИШЬ ПОКА этот экран открыт и видим (в браузере и в нашем приложении фоновой геолокации нет —
 *    так честно, ради батареи и правил iOS/Android); закрыли экран — точка перестаёт обновляться и у друзей скоро помечается «давно»;
 *  — хранится одна последняя точка, истории нет; «Перестать делиться» стирает её.
 *  — маршрут до друга строит сервер по ЕГО последней точке (если он разрешил и точка свежая); нет маршрута — так и пишем.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, Users, Loader2, ShieldCheck, Footprints, Bike, Car as CarIcon } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { visibleTick } from '@/shared/visibleTick';
import { SafetyCard } from '@/safety/SafetyCard';
import { SkyMap, type MapPoint } from '@/marketplace/logistics/SkyMap';
import type { GeoPoint } from '@/marketplace/logistics/types';

interface Friend { id: string; name: string; username?: string; avatar?: string | null; point: GeoPoint | null; speedKmh: number | null; accuracyM: number | null; updatedAt: string | null; stale: boolean | null }
interface Mine { id: string; name: string; username?: string }
interface Data { enabled: boolean; friends: Friend[]; sharingWith: string[]; myFriends: Mine[] }
interface Route { distanceM: number; durationS: number; polyline: string; mode: string; friendStale: boolean | null }

const ERR: Record<string, string> = {
  feature_off: 'Карта друзей сейчас отключена администрацией.', not_friends: 'Делиться можно только с друзьями.', too_many: 'Слишком много получателей.',
  friend_not_visible: 'Друг сейчас не показывает своё положение вам.', no_origin: 'Не удалось определить ваше положение.', no_route: 'Маршрут не найден.',
  route_unavailable: 'Маршруты сейчас недоступны.', maps_not_configured: 'Карты не настроены.', route_failed: 'Не удалось построить маршрут.', too_many_requests: 'Слишком часто. Подождите немного.',
};
const when = (iso: string | null) => {
  if (!iso) return 'нет данных';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : `${Math.round(m / 60)} ч назад`;
};
const initials = (n: string) => (n || '?').trim().slice(0, 1).toUpperCase();
const km = (m: number) => (m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(1)} км`);
const mins = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} мин` : `${Math.floor(s / 3600)} ч ${Math.round((s % 3600) / 60)} мин`);

export const FriendsMap = () => {
  const [d, setD] = useState<Data | null>(null);
  const [failed, setFailed] = useState('');
  const [me, setMe] = useState<GeoPoint | null>(null);
  const [geoErr, setGeoErr] = useState('');
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [mode, setMode] = useState<'car' | 'foot' | 'bike'>('car');
  const [route, setRoute] = useState<Route | null>(null);
  const [busy, setBusy] = useState(false);
  const lastSent = useRef(0);

  const load = useCallback(async () => {
    const r = await apiCall<Data>('/api/maps/friends');
    if (r.ok && r.data) { setD(r.data); setFailed(''); if (!dirty) setPick(new Set(r.data.sharingWith)); }
    else setFailed(ERR[r.error ?? ''] ?? `Не удалось загрузить${r.error ? ` (${r.error})` : ''}`);
  }, [dirty]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = window.setInterval(visibleTick(() => void load()), 20_000); return () => window.clearInterval(t); }, [load]);

  const sharing = (d?.sharingWith.length ?? 0) > 0;

  /* Геолокация — только пока экран открыт и видим. Свою точку показываем на карте всегда (локально), на сервер шлём, лишь если делимся и не чаще раза в 15 с. */
  useEffect(() => {
    if (!('geolocation' in navigator)) { setGeoErr('Этот браузер не умеет определять положение.'); return; }
    let watch: number | null = null;
    const start = () => {
      if (watch != null || document.hidden) return;
      watch = navigator.geolocation.watchPosition(
        (pos) => {
          setGeoErr('');
          const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setMe(p);
          if (sharing && Date.now() - lastSent.current > 15_000) {
            lastSent.current = Date.now();
            void apiCall('/api/maps/friends/position', { method: 'POST', body: JSON.stringify({ ...p, speed: pos.coords.speed ?? undefined, accuracy: pos.coords.accuracy }) });
          }
        },
        (e) => setGeoErr(e.code === 1 ? 'Доступ к положению запрещён. Разрешите его в настройках браузера или телефона.' : 'Не удалось определить положение.'),
        { enableHighAccuracy: false, maximumAge: 10_000, timeout: 20_000 },
      );
    };
    const stop = () => { if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; } };
    const vis = () => (document.hidden ? stop() : start());
    start(); document.addEventListener('visibilitychange', vis);
    return () => { stop(); document.removeEventListener('visibilitychange', vis); };
  }, [sharing]);

  const saveShare = async () => {
    setBusy(true);
    const r = await apiCall('/api/maps/friends/share', { method: 'PUT', body: JSON.stringify({ viewerIds: [...pick] }) });
    setBusy(false);
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? 'Не удалось сохранить'); return; }
    setDirty(false); flash(pick.size ? 'Сохранено' : 'Вы больше никому не показываетесь'); await load();
  };
  const stopAll = async () => { setBusy(true); await apiCall('/api/maps/friends/position', { method: 'DELETE' }); setBusy(false); setPick(new Set()); setDirty(false); flash('Показ остановлен, точка стёрта'); await load(); };

  const buildRoute = async (friendId: string, m = mode) => {
    if (!me) { flash(ERR.no_origin); return; }
    setTarget(friendId); setRoute(null);
    const r = await apiCall<Route>('/api/maps/friends/route', { method: 'POST', body: JSON.stringify({ friendId, origin: me, mode: m }) });
    if (r.ok && r.data) setRoute(r.data); else flash(ERR[r.error ?? ''] ?? 'Маршрут недоступен');
  };

  if (failed) return <p className="p-4 text-sm" style={{ color: 'var(--red)' }}>{failed}</p>;
  if (!d) return <div className="p-6"><Loader2 size={18} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>;
  if (!d.enabled) return <p className="p-4 text-sm" style={{ color: 'var(--t2)' }}>{ERR.feature_off}</p>;

  const seen = d.friends.filter((f) => f.point);
  const points: MapPoint[] = [
    ...(me ? [{ id: 'me', pos: me, label: 'Вы', kind: 'target' as const }] : []),
    ...seen.map((f) => ({ id: f.id, pos: f.point as GeoPoint, label: `${f.name}${f.speedKmh != null ? ` · ${f.speedKmh} км/ч` : ''}`, kind: 'courier' as const, highlight: f.id === target })),
  ];
  const card = { background: 'var(--bg-l1)', border: '1px solid var(--border)' };

  return (
    <div className="min-w-0 space-y-3 p-3">
      <SkyMap points={points} height={280} path={route?.polyline} />
      {geoErr && <p className="text-xs" style={{ color: 'var(--amber)' }}>{geoErr}</p>}
      {route && <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>До друга: {km(route.distanceM)}, примерно {mins(route.durationS)}{route.friendStale ? ' · его положение устарело' : ''}</p>}

      <section className="space-y-2 rounded-2xl p-3" style={card}>
        <h3 className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--t1)' }}><Users size={15} />Друзья на карте</h3>
        {d.friends.length === 0 && <p className="text-xs" style={{ color: 'var(--t3)' }}>Пока никто из друзей не показывает вам своё положение. Друг должен сам включить это у себя.</p>}
        {d.friends.map((f) => (
          <div key={f.id} className="flex items-center gap-2 rounded-xl p-2" style={{ background: 'var(--bg-l2)' }}>
            <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>
              {f.avatar && /^(https?:|data:|\/)/.test(f.avatar) ? <img src={f.avatar} alt="" className="h-full w-full object-cover" /> : initials(f.name)}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }} translate="no">{f.name}</div>
              <div className="text-[11px]" style={{ color: f.stale ? 'var(--amber)' : 'var(--t3)' }}>
                {f.point ? `${when(f.updatedAt)}${f.stale ? ' · давно не обновлялось' : ''}${f.speedKmh != null ? ` · ${f.speedKmh} км/ч` : ''}${f.accuracyM != null ? ` · ±${f.accuracyM} м` : ''}` : 'положение пока неизвестно'}</div>
            </div>
            <button type="button" disabled={!f.point || !me} onClick={() => void buildRoute(f.id)} aria-label="Маршрут до друга"
              className="grid h-9 w-9 place-items-center rounded-full disabled:opacity-30" style={{ background: 'var(--accent)', color: '#fff' }}><Navigation size={16} /></button>
          </div>))}
        {target && (
          <div className="flex gap-1.5" role="radiogroup" aria-label="Способ передвижения">
            {([['car', 'Авто', CarIcon], ['foot', 'Пешком', Footprints], ['bike', 'Вело', Bike]] as const).map(([k, l, Ic]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => { setMode(k); void buildRoute(target, k); }}
                className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={mode === k ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--bg-l2)', color: 'var(--t1)' }}><Ic size={13} />{l}</button>))}
          </div>)}
      </section>

      <section className="space-y-2 rounded-2xl p-3" style={card}>
        <h3 className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--t1)' }}><ShieldCheck size={15} />Кому я показываю своё положение</h3>
        <p className="text-xs" style={{ color: 'var(--t3)' }}>По умолчанию — никому. Выберите друзей и сохраните. Положение обновляется, только пока этот экран открыт; хранится одна последняя точка.</p>
        {d.myFriends.length === 0 && <p className="text-xs" style={{ color: 'var(--t3)' }}>У вас пока нет друзей в Sky.</p>}
        {d.myFriends.map((f) => (
          <label key={f.id} className="flex items-center gap-2 text-sm" style={{ color: 'var(--t1)' }}>
            <input type="checkbox" checked={pick.has(f.id)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(f.id); else n.delete(f.id); setPick(n); setDirty(true); }} />
            <span translate="no">{f.name}</span></label>))}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!dirty || busy} onClick={() => void saveShare()} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>Сохранить</button>
          {sharing && <button type="button" disabled={busy} onClick={() => void stopAll()} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: 'rgba(239,68,68,.15)', color: 'var(--red)' }}>Перестать делиться и стереть точку</button>}
        </div>
        {sharing && <p className="flex items-center gap-1 text-xs" style={{ color: 'var(--green)' }}><MapPin size={12} />Вы показываетесь: {d.sharingWith.length}</p>}
      </section>
      <SafetyCard />
    </div>
  );
};
