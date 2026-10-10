/**
 * Карта по адресу: пункт выдачи, площадка мероприятия, склад.
 *
 * Картинку карты Google собирает наш сервер своим ключом (см.
 * marketplace/logistics/SkyMap.tsx — там же объяснено, почему картинкой,
 * а не живой картой в браузере), адрес в координаты превращает он же и
 * запоминает ответ. Если ключа у сервера нет или адрес не нашёлся,
 * остаётся ссылка «Открыть в Google Картах» — она работает без ключа,
 * потому что ведёт на сам сайт Google, а не к нашему серверу.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { ExternalLink, Navigation } from 'lucide-react';
import { apiMapsSettings, apiGeocode } from '@/marketplace/logistics/mapsApi';
import type { GeoPoint } from '@/marketplace/logistics/types';
import type { MapPinKind } from '@/marketplace/logistics/mapsApi';

const SkyMap = lazy(() => import('@/marketplace/logistics/SkyMap').then((m) => ({ default: m.SkyMap })));

const enc = encodeURIComponent;

/** Ссылка на адрес в Google Картах (без ключа). */
export const googleMapsUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${enc(address)}`;

/** Ссылка «построить маршрут» до адреса. */
export const googleDirectionsUrl = (address: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${enc(address)}`;

export const AddressMap = ({ address, label, kind = 'target', height = 170 }: {
  address: string;
  label?: string;
  kind?: MapPinKind;
  height?: number;
}) => {
  const [enabled, setEnabled] = useState(false);
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const clean = address.trim();

  useEffect(() => {
    let alive = true;
    setPoint(null);
    if (!clean) return;
    void apiMapsSettings().then(async (s) => {
      if (!alive) return;
      setEnabled(s.enabled);
      if (!s.enabled) return;
      const p = await apiGeocode(clean);
      if (alive) setPoint(p);
    });
    return () => { alive = false; };
  }, [clean]);

  if (!clean) return null;

  const link = 'inline-flex items-center gap-1 text-[11px] font-bold';
  return (
    <div className="space-y-1.5">
      {enabled && point && (
        <Suspense fallback={null}>
          <SkyMap height={height} points={[{ id: 'address', pos: point, label: label ?? clean, kind }]} />
        </Suspense>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <a href={googleMapsUrl(clean)} target="_blank" rel="noopener noreferrer" className={link} style={{ color: 'var(--accent)' }}>
          <ExternalLink size={11} /> Открыть в Google Картах
        </a>
        <a href={googleDirectionsUrl(clean)} target="_blank" rel="noopener noreferrer" className={link} style={{ color: 'var(--accent)' }}>
          <Navigation size={11} /> Построить маршрут
        </a>
      </div>
    </div>
  );
};
