/** Sky GO: авиабилеты. Только предложения поставщика; «забронировано» не пишется, пока поставщик не подтвердил (сейчас — переход на сайт партнёра). */
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { goApi } from './api';
import { Back, Btn, Card, Chip, Col, Empty, Input, Notice, fail, fmt, C } from './ui';

const City = ({ label, value, onPick }: { label: string; value: { code: string; name: string } | null; onPick: (p: { code: string; name: string } | null) => void }) => {
  const [t, setT] = useState(value?.name ?? '');
  const [opts, setOpts] = useState<{ code: string; name: string }[]>([]);
  useEffect(() => {
    if (t.length < 2 || value?.name === t) return setOpts([]);
    const h = setTimeout(() => void goApi.flightsSuggest(t).then((r) => setOpts(r.ok ? r.data!.places.slice(0, 5) : [])), 300);
    return () => clearTimeout(h);
  }, [t, value]);
  return (
    <div style={{ position: 'relative' }}>
      <Input label={label} value={t} onChange={(v) => { setT(v); onPick(null); }} placeholder="Город или аэропорт" />
      {opts.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, background: C.l1, border: `1px solid ${C.brd}`, borderRadius: 14, marginTop: 4, overflow: 'hidden' }}>
          {opts.map((o) => <button key={o.code} onClick={() => { onPick(o); setT(o.name); setOpts([]); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: 'none', color: C.t1 }}>{o.name} <b>{o.code}</b></button>)}
        </div>)}
    </div>
  );
};

export const FlightsScreen = ({ onBack }: { onBack: () => void }) => {
  const [from, setFrom] = useState<{ code: string; name: string } | null>(null);
  const [to, setTo] = useState<{ code: string; name: string } | null>(null);
  const [date, setDate] = useState(''); const [back, setBack] = useState(''); const [adults, setAdults] = useState(1);
  const [offers, setOffers] = useState<any[] | null>(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<any[]>([]);
  useEffect(() => { void goApi.flightsOrders().then((r) => r.ok && setMine(r.data!.orders)); }, [offers]);

  const search = async () => {
    setBusy(true); const r = await goApi.flightsSearch({ from: from!.code, to: to!.code, date, returnDate: back || undefined, adults }); setBusy(false);
    if (!r.ok) return fail(r);
    setOffers(r.data!.offers); setNote(r.data!.cached ? 'Цены из кэша поставщика — окончательную цену показывает сайт партнёра.' : '');
  };
  const open = async (o: any) => {
    const r = await goApi.flightsOrder({ offer: o, passengers: Array.from({ length: adults }, (_, i) => ({ name: `Пассажир ${i + 1}` })) });
    if (!r.ok) return fail(r);
    if (o.link) window.open(o.link, '_blank', 'noopener');
  };
  return (
    <>
      <Back onClick={onBack} title="Авиабилеты" />
      <Col>
        <Card><Col>
          <City label="Откуда" value={from} onPick={setFrom} />
          <City label="Куда" value={to} onPick={setTo} />
          <Input label="Дата вылета" type="date" value={date} onChange={setDate} />
          <Input label="Дата возвращения (необязательно)" type="date" value={back} onChange={setBack} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.t1 }}>Пассажиров:
            <Btn kind="soft" onClick={() => setAdults(Math.max(1, adults - 1))} style={{ height: 36, padding: '0 14px' }}>−</Btn><b>{adults}</b>
            <Btn kind="soft" onClick={() => setAdults(Math.min(6, adults + 1))} style={{ height: 36, padding: '0 14px' }}>+</Btn></div>
          <Btn busy={busy} disabled={!from || !to || !date} onClick={search}>Найти билеты</Btn>
        </Col></Card>
        <Notice>Sky подбирает предложения поставщика. Оформление и оплата билета происходят на сайте партнёра — Sky не продаёт билет и не подтверждает бронь сам.</Notice>
        {offers && (offers.length === 0 ? <Empty text="Предложений на эти даты нет." /> : <>
          {note && <Notice>{note}</Notice>}
          {offers.map((o) => (
            <Card key={o.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, color: C.t1 }}>{o.airline} {o.flightNumber}</div>
                  <div style={{ fontSize: 13, color: C.t2 }}>{o.from} → {o.to} · {o.departAt ? new Date(o.departAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</div>
                  <div style={{ fontSize: 12.5, color: C.t3 }}>{o.transfers ? `Пересадок: ${o.transfers}` : 'Без пересадок'}{o.durationMin ? ` · ${Math.floor(o.durationMin / 60)} ч ${o.durationMin % 60} мин` : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 800, fontSize: 18, color: C.t1 }}>{fmt(o.priceRub)}</div>{adults > 1 && <div style={{ fontSize: 12, color: C.t3 }}>{fmt(o.perPassengerRub)} за человека</div>}</div>
              </div>
              <Btn style={{ width: '100%', marginTop: 10 }} onClick={() => open(o)}>Выбрать на сайте партнёра <ExternalLink size={15} /></Btn>
            </Card>))}
        </>)}
        {mine.length > 0 && <Card><div style={{ fontWeight: 700, color: C.t1, marginBottom: 6 }}>Мои переходы к покупке</div>
          {mine.slice(0, 5).map((m) => <div key={m.id} style={{ fontSize: 13, color: C.t2, padding: '3px 0' }}>{m.from} → {m.to} · <Chip color={C.t3}>{m.status === 'redirected' ? 'перешли к партнёру' : m.status}</Chip></div>)}</Card>}
      </Col>
    </>
  );
};
