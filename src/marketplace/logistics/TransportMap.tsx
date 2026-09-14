/**
 * Карта транспортной компании.
 *
 * Раньше здесь ездили выдуманные машины. Положение бралось из хэша
 * идентификатора, «движение» было равномерным скольжением по прямой
 * между двумя такими же выдуманными точками, а таймер раз в две с
 * половиной секунды создавал впечатление живого. Диспетчер, который
 * поверил бы этой карте и отправил по ней заказ, отправил бы его в
 * никуда.
 *
 * Теперь на карте только настоящее:
 *
 *   склад     — по координатам, которые задал его владелец;
 *   машина    — по положению, которое передали, и только пока оно
 *               свежее; переданное вчера значит «неизвестно, где она»,
 *               а не «стоит там»;
 *   заказ     — по адресу выдачи, превращённому в координаты Google.
 *
 * Чего нет — того нет, и об этом написано словами под картой. Пустая
 * карта честнее полной вымысла.
 */
import { useEffect, useMemo, useState } from 'react';
import { Truck, Warehouse, Flag } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { SkyMap, type MapPoint } from './SkyMap';
import { apiGeocode, isRealPoint } from './mapsApi';
import type { GeoPoint } from './types';
import { useTransportStore } from './transportStore';
import { TRANSPORT_KIND_LABEL } from './transportTypes';

export const TransportMap = ({ companyId }: { companyId: string }) => {
  const { vehiclesFor, ordersFor, warehousesFor, team } = useTransportStore();

  const vehicles = vehiclesFor(companyId);
  const activeOrders = ordersFor(companyId)
    .filter((o) => o.status === 'assigned' || o.status === 'in_progress');
  const warehouses = warehousesFor(companyId);

  /* Адреса превращает в точки сервер: у складов компании координат в
     базе нет, есть адрес, и у заказа то же самое. Спрашиваем по одному
     разу на адрес — ответ сервер запоминает, но лишний запрос это и
     деньги, и ещё один повод отправить чужой адрес наружу. */
  const addresses = useMemo(
    () => Array.from(new Set([
      ...activeOrders.map((o) => o.toAddress),
      ...warehouses.map((w) => w.address),
    ].filter(Boolean))),
    [activeOrders, warehouses],
  );
  const [spots, setSpots] = useState<Record<string, GeoPoint | null>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      for (const address of addresses) {
        if (spots[address] !== undefined) continue;
        const point = await apiGeocode(address);
        if (!alive) return;
        setSpots((was) => ({ ...was, [address]: point }));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses.join('|')]);

  const points: MapPoint[] = [];

  for (const w of warehouses) {
    points.push({
      id: w.id,
      pos: spots[w.address] ?? { lat: 0, lng: 0 },
      label: w.warehouseName,
      Icon: Warehouse,
      kind: 'warehouse',
    });
  }

  for (const v of vehicles) {
    const driver = team.find((t) => t.id === v.driverId);
    points.push({
      id: v.id,
      pos: v.position ?? { lat: 0, lng: 0 },
      label: `${v.brand} ${v.model} · ${TRANSPORT_KIND_LABEL[v.kind]}${driver ? ` · ${driver.name}` : ''}`,
      Icon: Truck,
      kind: 'courier',
    });
  }

  for (const o of activeOrders) {
    points.push({
      id: `${o.id}-to`,
      pos: spots[o.toAddress] ?? { lat: 0, lng: 0 },
      label: `Выдача · ${o.productName}`,
      Icon: Flag,
      kind: 'target',
    });
  }

  const silent = vehicles.filter((v) => !isRealPoint(v.position ?? null)).length;

  return (
    <div className="flex flex-col gap-2">
      <SkyMap points={points} height={280} />

      <div className="flex flex-wrap gap-3 text-[10px]" style={{ color: C.t3 }}>
        <span className="flex items-center gap-1.5"><Warehouse size={12} color="#8b5cf6" /> склад</span>
        <span className="flex items-center gap-1.5"><Truck size={12} color="#3b82f6" /> машина</span>
        <span className="flex items-center gap-1.5"><Flag size={12} color="#ef4444" /> выдача</span>
      </div>

      {silent > 0 && (
        <p className="text-[10px]" style={{ color: C.t3 }}>
          {silent === 1 ? 'Одна машина не передала' : `${silent} машин не передали`} своё
          положение — где они сейчас, неизвестно, и на карте их нет.
        </p>
      )}
    </div>
  );
};
