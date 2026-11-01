/**
 * Согласие на использование геолокации в Sky (карта друзей, Sky Safety). Хранится на устройстве; без него геолокация не запрашивается.
 * Согласие можно отозвать в любой момент — слежение и отправка точки сразу останавливаются.
 */
import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';

const KEY = 'sky:geo:consent:v1';
export const geoConsent = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const setGeoConsent = (on: boolean) => {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* память недоступна */ }
  window.dispatchEvent(new Event('sky:geoconsent'));
};
export const useGeoConsent = () => {
  const [v, setV] = useState(geoConsent());
  useEffect(() => { const f = () => setV(geoConsent()); window.addEventListener('sky:geoconsent', f); return () => window.removeEventListener('sky:geoconsent', f); }, []);
  return v;
};

/** Приблизить точку человека до сетки ~110 м: карта (в том числе у стороннего поставщика) получает не точный адрес, а район. */
export const blurPoint = <T extends { lat: number; lng: number }>(p: T): T => ({ ...p, lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 });

export const GeoConsentCard = ({ purpose, onAccept }: { purpose: string; onAccept?: () => void }) => (
  <section className="space-y-2 rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
    <h3 className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--t1)' }}><MapPin size={15} />Разрешить Sky определять ваше положение?</h3>
    <ul className="list-disc space-y-1 pl-5 text-xs" style={{ color: 'var(--t2)' }}>
      <li>{purpose}</li>
      <li>Положение используется, только пока Sky открыт на экране.</li>
      <li>На сервере хранится одна последняя точка в зашифрованном виде, истории перемещений нет.</li>
      <li>Видят её только те, кого вы выбрали сами; карта получает не точный адрес, а район (около 100 м).</li>
      <li>Отозвать согласие можно здесь же в любой момент — точка перестанет обновляться.</li>
    </ul>
    <div className="flex gap-2">
      <button type="button" className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--accent)', color: '#fff' }} onClick={() => { setGeoConsent(true); onAccept?.(); }}>Согласен</button>
    </div>
  </section>
);
