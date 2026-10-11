/** Sky GO: заправки. Станции и услуги — данные поставщика (OSM/другой), загруженность — только сообщения людей. Цен нет и не выдумывается. */
import { useState } from 'react';
import { Fuel as FuelIcon, Navigation } from 'lucide-react';
import { goApi } from './api';
import { Back, Btn, Card, Chip, Col, Empty, Notice, fail, locate, C } from './ui';
import { flash } from '@/shared/flash';

const LOAD: Record<string, [string, string]> = { low: ['Свободно', '#10b981'], medium: ['Умеренно', '#f59e0b'], high: ['Очередь', '#ef4444'] };
const FUELS = ['АИ-92', 'АИ-95', 'АИ-98', 'АИ-100', 'ДТ', 'Газ (пропан)', 'Метан', 'Зарядка'];

export const FuelScreen = ({ city, onBack }: { city: string; onBack: () => void }) => {
  const [stations, setStations] = useState<any[] | null>(null);
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [fuel, setFuel] = useState(''); const [sort, setSort] = useState<'distance' | 'load'>('distance'); const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);

  const find = async (p = pos, f = fuel, s = sort, o = open) => {
    setBusy(true);
    let at = p; if (!at) { at = await locate(); setPos(at); }
    const r = await goApi.fuelNearby({ ...(at ?? { city }), radiusM: 5000, fuel: f || undefined, sort: s, open: o || undefined });
    setBusy(false);
    if (!r.ok) return fail(r);
    setStations(r.data!.stations); setNotice(r.data!.notice);
  };
  const report = async (key: string, level: string) => {
    const r = await goApi.fuelReport(key, level);
    if (!r.ok) return fail(r);
    flash('Спасибо, учли'); void find();
  };
  return (
    <>
      <Back onClick={onBack} title="Заправки" />
      <Col>
        <Card><Col>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip color={fuel ? C.t3 : '#0ea5a4'}><span onClick={() => { setFuel(''); void find(pos, '', sort, open); }}>Любое топливо</span></Chip>
            {FUELS.map((f) => <span key={f} onClick={() => { setFuel(f); void find(pos, f, sort, open); }}><Chip color={fuel === f ? '#0ea5a4' : C.t3}>{f}</Chip></span>)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind={sort === 'load' ? 'main' : 'soft'} style={{ height: 38, fontSize: 13, flex: 1 }} onClick={() => { const s = sort === 'load' ? 'distance' : 'load'; setSort(s); void find(pos, fuel, s, open); }}>Сначала свободные</Btn>
            <Btn kind={open ? 'main' : 'soft'} style={{ height: 38, fontSize: 13, flex: 1 }} onClick={() => { setOpen(!open); void find(pos, fuel, sort, !open); }}>Открытые сейчас</Btn>
          </div>
          <Btn busy={busy} onClick={() => find()}><Navigation size={16} /> Найти рядом</Btn>
        </Col></Card>
        {notice && <Notice>{notice}</Notice>}
        {stations && (stations.length === 0 ? <Empty text="Станций рядом не найдено." /> : stations.map((s) => (
          <Card key={s.key}>
            <div style={{ display: 'flex', gap: 10 }}>
              <FuelIcon size={20} color="#0ea5a4" style={{ marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div translate="no" style={{ fontWeight: 700, color: C.t1 }}>{s.name}{s.brand && s.brand !== s.name ? ` · ${s.brand}` : ''}</div>
                <div translate="no" style={{ fontSize: 12.5, color: C.t2 }}>{s.address || 'Адрес не указан'} · {s.distanceKm} км</div>
                <div style={{ fontSize: 12.5, color: C.t2, marginTop: 4 }}>{s.always ? 'Круглосуточно' : s.hours ? s.hours : 'Часы работы не указаны'}</div>
                {s.fuels.length > 0 && <div style={{ fontSize: 12.5, color: C.t2 }}>Топливо: {s.fuels.join(', ')}</div>}
                {s.services.length > 0 && <div style={{ fontSize: 12.5, color: C.t2 }}>Услуги: {s.services.join(', ')}</div>}
                <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {s.load.level ? <><Chip color={LOAD[s.load.level][1]}>{LOAD[s.load.level][0]}</Chip><span style={{ fontSize: 12, color: C.t3 }}>по сообщениям людей: {s.load.reports}</span></>
                    : <span style={{ fontSize: 12, color: C.t3 }}>Загруженность неизвестна — расскажите:</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {(['low', 'medium', 'high'] as const).map((l) => <Btn key={l} kind="soft" onClick={() => void report(s.key, l)} style={{ height: 32, fontSize: 12, padding: '0 10px' }}>{LOAD[l][0]}</Btn>)}
                </div>
              </div>
            </div>
          </Card>)))}
      </Col>
    </>
  );
};
