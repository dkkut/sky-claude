/** Sky GO: «Моё авто» — машина, заправки и автомойки рядом, карточка станции с маршрутом. Данные станций — от поставщика; цен и очередей поставщик не даёт, их не выдумываем. */
import { useEffect, useState } from 'react';
import { Fuel as FuelIcon, Droplets, Navigation, Car as CarIcon, ChevronDown, Plus } from 'lucide-react';
import { SkyMap } from '@/marketplace/logistics/SkyMap';
import { goApi, goError, type Car } from './api';
import { Back, Btn, Card, Chip, Col, Empty, Head, Input, Notice, fail, locate, useLoad, C, GO } from './ui';
import { flash } from '@/shared/flash';

const LOAD: Record<string, [string, string]> = { low: ['Свободно', '#10b981'], medium: ['Умеренно', '#f59e0b'], high: ['Очередь', '#ef4444'] };
const FUELS = ['АИ-92', 'АИ-95', 'АИ-98', 'АИ-100', 'ДТ', 'Газ (пропан)', 'Метан', 'Зарядка'];
export type AutoKind = 'fuel' | 'wash';

/* ─── «Моё авто» ─── */
export const AutoScreen = ({ city, onBack, onOpen }: { city: string; onBack: () => void; onOpen: (k: AutoKind) => void }) => {
  const [res, reload] = useLoad(() => goApi.car(), []);
  const [edit, setEdit] = useState(false);
  const car = res?.ok ? res.data!.car : null;
  const [f, setF] = useState<Car>({ make: '', model: '', plate: '', fuel: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (car) setF(car); }, [car]);
  const save = async () => { setBusy(true); const r = await goApi.saveCar(f); setBusy(false); if (!r.ok) return fail(r); flash('Машина сохранена'); setEdit(false); reload(); };
  const remove = async () => { const r = await goApi.removeCar(); if (!r.ok) return fail(r); setF({ make: '', model: '', plate: '', fuel: '' }); setEdit(false); reload(); };
  const Row = ({ icon, title, hint, onClick }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void }) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '16px 4px', color: C.t1, borderBottom: `1px solid ${C.brd}` }}>
      <div style={{ color: GO }}>{icon}</div>
      <div style={{ flex: 1 }}><div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div><div style={{ fontSize: 12.5, color: C.t3 }}>{hint}</div></div><span style={{ color: C.t3, fontSize: 20 }}>›</span>
    </button>);
  return (
    <>
      <Head title="Моё авто" sub={city} icon={<CarIcon size={22} />} onBack={onBack} />
      <Col gap={14}>
        <Card style={{ borderRadius: 24, textAlign: 'center', padding: 20 }}>
          {car && !edit ? (
            <Col gap={6}>
              <CarIcon size={56} color={GO} style={{ margin: '0 auto' }} />
              <div translate="no" style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>{car.make} {car.model}</div>
              <div translate="no" style={{ fontSize: 15, color: C.t2 }}>{car.plate || 'номер не указан'}{car.fuel ? ` · ${car.fuel}` : ''}</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}><Btn kind="soft" style={{ height: 38, fontSize: 13 }} onClick={() => setEdit(true)}>Изменить</Btn><Btn kind="danger" style={{ height: 38, fontSize: 13 }} onClick={remove}>Убрать</Btn></div>
            </Col>
          ) : edit || !car ? (
            edit ? (
              <Col>
                <Input label="Марка" value={f.make} onChange={(v) => setF({ ...f, make: v })} max={40} />
                <Input label="Модель" value={f.model} onChange={(v) => setF({ ...f, model: v })} max={40} />
                <Input label="Госномер (необязательно)" value={f.plate} onChange={(v) => setF({ ...f, plate: v })} max={12} />
                <div style={{ textAlign: 'left', fontSize: 12, color: C.t2 }}>Топливо</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{FUELS.map((x) => <span key={x} onClick={() => setF({ ...f, fuel: f.fuel === x ? '' : x })} style={{ cursor: 'pointer' }}><Chip color={f.fuel === x ? GO : C.t3}>{x}</Chip></span>)}</div>
                <Btn busy={busy} disabled={f.make.trim().length < 2 || !f.model.trim()} onClick={save}>Сохранить</Btn>
                {car && <Btn kind="soft" onClick={() => setEdit(false)}>Отмена</Btn>}
              </Col>
            ) : (
              <Col gap={10}><CarIcon size={64} color={C.t3} style={{ margin: '0 auto' }} /><Btn onClick={() => setEdit(true)}><Plus size={16} /> Добавить машину</Btn>
                <div style={{ fontSize: 12.5, color: C.t3 }}>Нужна только для подсказок: выбранное топливо подставляется в поиск заправок.</div></Col>
            )
          ) : null}
        </Card>
        <div>
          <Row icon={<FuelIcon size={26} />} title="Заправить" hint="Станции рядом, время в пути, загруженность" onClick={() => onOpen('fuel')} />
          <Row icon={<Droplets size={26} />} title="Помыть" hint="Автомойки рядом" onClick={() => onOpen('wash')} />
        </div>
        <Notice>Цен на топливо и официальных очередей у поставщика данных нет — Sky их не выдумывает. Загруженность — только сообщения самих водителей.</Notice>
      </Col>
    </>
  );
};

/* ─── Станции рядом ─── */
export const FuelScreen = ({ city, kind, onBack }: { city: string; kind: AutoKind; onBack: () => void }) => {
  const [stations, setStations] = useState<any[] | null>(null);
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [fuel, setFuel] = useState(''); const [sort, setSort] = useState<'distance' | 'load'>('distance'); const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [sel, setSel] = useState<any | null>(null);
  const [car] = useLoad(() => goApi.car(), []);
  const wash = kind === 'wash';

  useEffect(() => { if (car?.ok && car.data!.car?.fuel && !wash) setFuel(car.data!.car!.fuel); }, [car, wash]);
  const find = async (p = pos, f = fuel, s = sort, o = open) => {
    setBusy(true);
    let at = p; if (!at) { at = await locate(); setPos(at); }
    const r = await goApi.fuelNearby({ ...(at ?? { city }), radiusM: 5000, kind, fuel: wash ? undefined : f || undefined, sort: s, open: o || undefined });
    setBusy(false);
    if (!r.ok) return fail(r);
    setStations(r.data!.stations); setNotice(r.data!.notice);
  };
  if (sel) return <StationScreen st={sel} kind={kind} here={pos} onBack={() => setSel(null)} onReported={() => void find()} />;
  return (
    <>
      <Head title={wash ? 'Автомойки' : 'Заправки'} sub={city} icon={wash ? <Droplets size={22} /> : <FuelIcon size={22} />} onBack={onBack} />
      <Col>
        <Card><Col>
          {!wash && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span onClick={() => { setFuel(''); void find(pos, '', sort, open); }} style={{ cursor: 'pointer' }}><Chip color={fuel ? C.t3 : GO}>Любое топливо</Chip></span>
            {FUELS.map((f) => <span key={f} onClick={() => { setFuel(f); void find(pos, f, sort, open); }} style={{ cursor: 'pointer' }}><Chip color={fuel === f ? GO : C.t3}>{f}</Chip></span>)}
          </div>}
          <div style={{ display: 'flex', gap: 8 }}>
            {!wash && <Btn kind={sort === 'load' ? 'main' : 'soft'} style={{ height: 38, fontSize: 13, flex: 1 }} onClick={() => { const s = sort === 'load' ? 'distance' : 'load'; setSort(s); void find(pos, fuel, s, open); }}>Сначала свободные</Btn>}
            <Btn kind={open ? 'main' : 'soft'} style={{ height: 38, fontSize: 13, flex: 1 }} onClick={() => { setOpen(!open); void find(pos, fuel, sort, !open); }}>Открытые сейчас</Btn>
          </div>
          <Btn busy={busy} onClick={() => find()}><Navigation size={16} /> Найти рядом</Btn>
        </Col></Card>
        {notice && !wash && <Notice>{notice}</Notice>}
        {stations && (stations.length === 0 ? <Empty text={wash ? 'Автомоек рядом не найдено.' : 'Станций рядом не найдено.'} /> : stations.map((s) => (
          <Card key={s.key} onClick={() => setSel(s)} style={{ borderRadius: 20 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ color: GO, marginTop: 2 }}>{wash ? <Droplets size={22} /> : <FuelIcon size={22} />}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div translate="no" style={{ fontWeight: 800, fontSize: 16, color: C.t1 }}>{s.name}{s.brand && s.brand !== s.name ? ` · ${s.brand}` : ''}</div>
                <div translate="no" style={{ fontSize: 12.5, color: C.t2 }}>{s.address || 'Адрес не указан'} · {s.distanceKm} км</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {s.always ? <Chip color="#10b981">Круглосуточно</Chip> : null}
                  {!wash && s.load.level ? <Chip color={LOAD[s.load.level][1]}>{LOAD[s.load.level][0]}</Chip> : null}
                  {!wash && s.fuels.length > 0 && <span style={{ fontSize: 12, color: C.t3 }}>{s.fuels.slice(0, 4).join(', ')}</span>}
                </div>
              </div>
              <span style={{ color: C.t3, fontSize: 20 }}>›</span>
            </div>
          </Card>)))}
      </Col>
    </>
  );
};

/* ─── Карточка станции: карта, маршрут, сообщить о загруженности ─── */
const StationScreen = ({ st, kind, here, onBack, onReported }: { st: any; kind: AutoKind; here: { lat: number; lng: number } | null; onBack: () => void; onReported: () => void }) => {
  const wash = kind === 'wash';
  const [route, setRoute] = useState<{ km: number; minutes: number; estimated: boolean } | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => { if (here) void goApi.fuelRoute(st.key, here.lat, here.lng).then((r) => { if (r.ok) setRoute(r.data!); }); }, [st.key, here]);
  const points = [
    ...(here ? [{ id: 'me', pos: here, label: 'Вы', kind: 'pickup' as const }] : []),
    { id: 'st', pos: { lat: st.lat, lng: st.lng }, label: st.name, kind: 'target' as const },
  ];
  const report = async (level: string) => { const r = await goApi.fuelReport(st.key, level); if (!r.ok) return fail(r); flash('Спасибо, учли'); onReported(); };
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${st.lat},${st.lng}`;
  return (
    <>
      <Back onClick={onBack} title={wash ? 'Автомойка' : 'Заправка'} />
      <Col gap={12}>
        <div style={{ borderRadius: 22, overflow: 'hidden', border: `1px solid ${C.brd}` }}><SkyMap points={points} height={240} /></div>
        <Card style={{ borderRadius: 22, textAlign: 'center' }}>
          <div translate="no" style={{ fontSize: 24, fontWeight: 900, color: C.t1 }}>{st.name}</div>
          <div translate="no" style={{ fontSize: 14, color: C.t2, margin: '4px 0 10px' }}>{st.address || 'Адрес не указан'}</div>
          <div style={{ fontSize: 15, color: C.t1, fontWeight: 700 }}>{route ? `${route.km} км · ~${route.minutes} мин${route.estimated ? ' (по прямой)' : ''}` : `${st.distanceKm} км по прямой`}</div>
          <a href={nav} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <Btn style={{ width: '100%', marginTop: 12, height: 52, borderRadius: 18 }}><Navigation size={18} /> Поехали</Btn></a>
        </Card>
        {!wash && (
          <Card style={{ borderRadius: 22 }}><Col gap={8}>
            <div style={{ fontWeight: 800, color: C.t1 }}>Топливо</div>
            {st.fuels.length > 0 ? <div style={{ fontSize: 15, color: C.t1 }}>{st.fuels.join(', ')}</div> : <div style={{ fontSize: 13, color: C.t3 }}>Поставщик не сообщил виды топлива.</div>}
            <div style={{ fontSize: 12.5, color: C.t3 }}>Цены на топливо поставщик данных не предоставляет — Sky их не показывает.</div>
            <div style={{ fontWeight: 800, color: C.t1, marginTop: 4 }}>Загруженность</div>
            <div style={{ fontSize: 13, color: C.t2 }}>{st.load.level ? `${LOAD[st.load.level][0]} — по сообщениям людей: ${st.load.reports}` : 'Неизвестна — расскажите, как сейчас:'}</div>
            <div style={{ display: 'flex', gap: 6 }}>{(['low', 'medium', 'high'] as const).map((l) => <Btn key={l} kind="soft" onClick={() => void report(l)} style={{ height: 36, fontSize: 13, padding: '0 12px' }}>{LOAD[l][0]}</Btn>)}</div>
          </Col></Card>)}
        <button onClick={() => setMore(!more)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 50, borderRadius: 18, border: `1px solid ${C.brd}`, background: 'transparent', color: C.t1, fontSize: 17, fontWeight: 800, padding: '0 16px' }}>
          Дополнительно <ChevronDown size={20} style={{ transform: more ? 'rotate(180deg)' : 'none' }} /></button>
        {more && <Card style={{ borderRadius: 22 }}><Col gap={6}>
          <div style={{ fontSize: 14, color: C.t1 }}>Часы работы: {st.always ? 'круглосуточно' : st.hours || 'не указаны'}</div>
          {st.services.length > 0 && <div style={{ fontSize: 14, color: C.t1 }}>Услуги: {st.services.join(', ')}</div>}
          <div style={{ fontSize: 12.5, color: C.t3 }}>Источник данных: {st.source === 'osm' ? '© участники OpenStreetMap (лицензия ODbL)' : st.source}. Обновлено {new Date(st.providerUpdatedAt).toLocaleDateString('ru-RU')}.</div>
        </Col></Card>}
      </Col>
    </>
  );
};
