import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { C } from '@/marketplace/SkyMarket';
import { pointForSeed, CITIES } from './geo';
import type { GeoPoint } from './types';
import { useTransportStore } from './transportStore';
import { TRANSPORT_KIND_LABEL } from './transportTypes';

const dotIcon = (emoji: string, bg: string, size = 30) => L.divIcon({
  html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:${size*0.55}px;box-shadow:0 2px 8px rgba(0,0,0,0.4);border:2px solid rgba(255,255,255,0.85)">${emoji}</div>`,
  className: '', iconSize: [size, size], iconAnchor: [size/2, size/2],
});

// Плавно двигает точку между двумя координатами по прямой — имитация
// движения транспорта "в реальном времени" без реального GPS-провайдера.
const lerp = (a: GeoPoint, b: GeoPoint, t: number): GeoPoint => ({
  lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t,
});

const FitToPoints = ({ points }: { points: GeoPoint[] }) => {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);
  return null;
};

export const TransportMap = ({ companyId }: { companyId: string }) => {
  const { companies, vehiclesFor, ordersFor, warehousesFor, team } = useTransportStore();
  const company = companies.find(c => c.id === companyId)!;
  const city = CITIES.find(c => c.name.toLowerCase() === company.city.trim().toLowerCase()) ?? CITIES[0];

  const vehicles = vehiclesFor(companyId);
  const activeOrders = ordersFor(companyId).filter(o => o.status === 'assigned' || o.status === 'in_progress');
  const warehouses = warehousesFor(companyId);

  // Точки погрузки/выгрузки для активных заказов
  const orderPoints = useMemo(() => activeOrders.map(o => ({
    order: o,
    from: pointForSeed(city.id, `${o.id}-from`),
    to: pointForSeed(city.id, `${o.id}-to`),
  })), [activeOrders, city.id]);

  // Позиция каждого ТС — если у него есть активный заказ, едет по маршруту;
  // если свободен, стоит в стабильной точке по своему id.
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 2500); return () => clearInterval(id); }, []);

  const vehiclePositions = useMemo(() => vehicles.map(v => {
    const op = orderPoints.find(p => p.order.vehicleId === v.id);
    if (!op) return { vehicle: v, pos: pointForSeed(city.id, `${v.id}-idle`), moving: false };
    const t = ((tick * 7) % 100) / 100; // псевдо-прогресс по маршруту
    return { vehicle: v, pos: lerp(op.from, op.to, t), moving: true };
  }), [vehicles, orderPoints, tick, city.id]);

  const warehousePoints = useMemo(() => warehouses.map(w => ({ w, pos: pointForSeed(city.id, w.id) })), [warehouses, city.id]);

  const allPoints = [
    ...vehiclePositions.map(v => v.pos),
    ...orderPoints.flatMap(p => [p.from, p.to]),
    ...warehousePoints.map(w => w.pos),
    city.center,
  ];

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapContainer center={[city.center.lat, city.center.lng]} zoom={11} style={{ height: '100%', width: '100%', background: '#1a1a22' }} zoomControl={false} attributionControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
        <FitToPoints points={allPoints}/>

        {orderPoints.map(({ order, from, to }) => (
          <Polyline key={order.id} positions={[[from.lat, from.lng], [to.lat, to.lng]]} pathOptions={{ color: C.acc, weight: 3, opacity: 0.6, dashArray: '6 6' }}/>
        ))}
        {orderPoints.map(({ order, from, to }) => (
          <div key={`${order.id}-pts`} style={{ display: 'contents' }}>
            <Marker position={[from.lat, from.lng]} icon={dotIcon('📦', '#22c55e', 26)}>
              <Tooltip direction="top">Погрузка · {order.productName}</Tooltip>
            </Marker>
            <Marker position={[to.lat, to.lng]} icon={dotIcon('🏁', '#ef4444', 26)}>
              <Tooltip direction="top">Выдача · {order.toAddress}</Tooltip>
            </Marker>
          </div>
        ))}

        {warehousePoints.map(({ w, pos }) => (
          <Marker key={w.id} position={[pos.lat, pos.lng]} icon={dotIcon('🏬', '#8b5cf6', 28)}>
            <Tooltip direction="top">{w.warehouseName}</Tooltip>
          </Marker>
        ))}

        {vehiclePositions.map(({ vehicle, pos, moving }) => {
          const driver = team.find(t => t.id === vehicle.driverId);
          return (
            <Marker key={vehicle.id} position={[pos.lat, pos.lng]} icon={dotIcon(moving ? '🚚' : '🅿️', moving ? '#3b82f6' : '#6b7280', 30)}>
              <Tooltip direction="top">
                {vehicle.brand} {vehicle.model} · {TRANSPORT_KIND_LABEL[vehicle.kind]}{driver ? ` · ${driver.name}` : ''}{moving ? ' · в пути' : ' · на месте'}
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>

      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5 rounded-xl p-2.5 text-[11px]" style={{ background: 'rgba(15,15,20,0.85)', color: '#fff' }}>
        <span>🚚 транспорт в пути</span>
        <span>🅿️ на стоянке</span>
        <span>📦 погрузка · 🏁 выдача</span>
        <span>🏬 склад</span>
      </div>
    </div>
  );
};
