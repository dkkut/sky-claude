/** Sky GO: «Путешествия» — отели, квартиры и дома, туры, авиабилеты. Одна форма поиска; цены и наличие считает сервер. */
import { useState } from 'react';
import { BedDouble, Building2, Plane, Map as MapIcon, Globe, ArrowRight, History } from 'lucide-react';
import { type StayKind, STAY_LABEL } from './api';
import { Card, Col, Head, Btn, C, GO, Input } from './ui';
import { StayResults } from './Stay';
import { FlightsScreen } from './Flights';

export type TravelTab = StayKind | 'flights';
const TABS: { k: TravelTab; t: string; Icon: typeof Plane }[] = [
  { k: 'hotel', t: 'отели', Icon: BedDouble }, { k: 'home', t: 'квартиры', Icon: Building2 }, { k: 'tour', t: 'туры', Icon: MapIcon }, { k: 'flights', t: 'авиа', Icon: Plane },
];
const iso = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export const TravelScreen = ({ initial, cities, city, onCity, onBack, onBooked, onOrders }: {
  initial: TravelTab; cities: string[]; city: string; onCity: (c: string) => void; onBack: () => void; onBooked: (id: string) => void; onOrders: () => void;
}) => {
  const [tab, setTab] = useState<TravelTab>(initial);
  const [ci, setCi] = useState(''); const [co, setCo] = useState(''); const [guests, setGuests] = useState('2'); const [q, setQ] = useState('');
  const [search, setSearch] = useState<null | { ci: string; co: string; guests: string; q: string }>(null);
  const [detail, setDetail] = useState(false);
  const isStay = tab !== 'flights';
  const run = (o?: Partial<{ ci: string; co: string; guests: string; q: string }>) => setSearch({ ci, co, guests, q, ...o });
  return (
    <>
      <div style={{ display: detail ? 'none' : 'block' }}><Head title="Путешествия" icon={<Globe size={22} />} onBack={onBack} /></div>
      <Col gap={14}>
        <div style={{ display: detail ? 'none' : 'flex', justifyContent: 'space-around' }}>
          {TABS.map(({ k, t, Icon }) => (
            <button key={k} onClick={() => { setTab(k); setSearch(null); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, border: 'none', background: 'none', color: tab === k ? C.t1 : C.t3, fontSize: 14, fontWeight: 600 }}>
              <span style={{ width: 62, height: 62, borderRadius: '50%', background: tab === k ? GO : C.l2, color: tab === k ? '#fff' : C.t2, display: 'grid', placeItems: 'center' }}><Icon size={26} /></span>{t}
            </button>))}
        </div>
        {isStay ? (
          <>
            <div style={{ display: detail ? 'none' : 'block' }}><Card style={{ borderRadius: 24 }}><Col gap={10}>
              <label style={{ fontSize: 12, color: C.t2 }}>Куда вы хотите поехать?
                <select value={city} onChange={(e) => { onCity(e.target.value); setSearch(null); }} style={{ display: 'block', width: '100%', height: 52, borderRadius: 18, border: 'none', background: C.l2, color: C.t1, padding: '0 16px', fontSize: 17, fontWeight: 600, marginTop: 5 }}>
                  {cities.map((c) => <option key={c}>{c}</option>)}</select></label>
              {tab !== 'tour' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Input label="Заезд" type="date" value={ci} onChange={(v) => { setCi(v); setSearch(null); }} /><Input label="Выезд" type="date" value={co} onChange={(v) => { setCo(v); setSearch(null); }} /></div>}
              <Input label="Название или описание (необязательно)" value={q} onChange={(v) => { setQ(v); setSearch(null); }} max={60} />
              {tab !== 'tour' && <label style={{ fontSize: 12, color: C.t2 }}>Гости
                <select value={guests} onChange={(e) => { setGuests(e.target.value); setSearch(null); }} style={{ display: 'block', width: '100%', height: 46, borderRadius: 14, border: 'none', background: C.l2, color: C.t1, padding: '0 14px', fontSize: 16, marginTop: 5 }}>
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{`${n} ${n === 1 ? 'взрослый' : 'взрослых'}`}</option>)}</select></label>}
              <Btn onClick={() => run()} style={{ height: 54, borderRadius: 18, fontSize: 17 }}>Найти</Btn>
            </Col></Card></div>
            {!search && (
              <div style={{ display: detail ? 'none' : 'flex', gap: 10, overflowX: 'auto' }}>
                {tab === 'hotel' && (
                  <button onClick={() => { const a = iso(0); const b = iso(1); setCi(a); setCo(b); run({ ci: a, co: b }); }} style={{ flex: '0 0 78%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', borderRadius: 20, border: 'none', background: C.l2, padding: 14, color: C.t1 }}>
                    <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 16 }}>Нужен отель сейчас?</div><div style={{ fontSize: 13, color: C.t2 }}>Покажем свободные на сегодняшнюю ночь</div></div>
                    <span style={{ width: 40, height: 40, borderRadius: 14, background: C.l1, display: 'grid', placeItems: 'center' }}><ArrowRight size={18} /></span></button>)}
                <button onClick={onOrders} style={{ flex: '0 0 78%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', borderRadius: 20, border: 'none', background: C.l2, padding: 14, color: C.t1 }}>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 16 }}>Мои бронирования</div><div style={{ fontSize: 13, color: C.t2 }}>Активные, прошедшие и отменённые</div></div>
                  <span style={{ width: 40, height: 40, borderRadius: 14, background: C.l1, display: 'grid', placeItems: 'center' }}><History size={18} /></span></button>
              </div>)}
            {search && (
              <>
                {!detail && <div style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>{STAY_LABEL[tab as StayKind]}</div>}
                <StayResults kind={tab as StayKind} city={city} q={search.q} guests={tab === 'tour' ? '' : search.guests} ci={search.ci} co={search.co} onBooked={onBooked} onDetail={setDetail} />
              </>)}
          </>
        ) : <FlightsScreen embedded />}
      </Col>
    </>
  );
};
