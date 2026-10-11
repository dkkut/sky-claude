/** Sky GO: заказ такси и доставки. Цена и маршрут приходят с сервера; клиент их не задаёт. */
import { useState } from 'react';
import { Crosshair } from 'lucide-react';
import { goApi, type Point } from './api';
import { Back, Btn, Card, Col, Input, Notice, fail, fmt, locate, C, GO } from './ui';
import { flash } from '@/shared/flash';

const AddressField = ({ label, value, onChange, canLocate }: { label: string; value: Point; onChange: (p: Point) => void; canLocate?: boolean }) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
    <div style={{ flex: 1 }}><Input label={label} value={value.address ?? ''} onChange={(v) => onChange({ address: v })} placeholder="Город, улица, дом" max={240} /></div>
    {canLocate && (
      <button aria-label="Моё местоположение" onClick={async () => { const p = await locate(); if (!p) return flash('Нет доступа к геолокации — введите адрес вручную.'); onChange({ address: 'Моё местоположение', ...p }); }}
        style={{ width: 46, height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: GO, display: 'grid', placeItems: 'center' }}><Crosshair size={20} /></button>
    )}
  </div>
);

export const TaxiScreen = ({ city, onBack, onCreated }: { city: string; onBack: () => void; onCreated: (id: string) => void }) => {
  const [from, setFrom] = useState<Point>({}); const [to, setTo] = useState<Point>({});
  const [comment, setComment] = useState('');
  const [offers, setOffers] = useState<{ code: string; title: string; priceRub: number }[] | null>(null);
  const [info, setInfo] = useState<{ km: number; minutes: number; estimated: boolean } | null>(null);
  const [pick, setPick] = useState(''); const [busy, setBusy] = useState(false);
  const reset = () => { setOffers(null); setPick(''); };

  const quote = async () => {
    setBusy(true); const r = await goApi.taxiQuote({ city, from, to }); setBusy(false);
    if (!r.ok) return fail(r);
    setOffers(r.data!.offers); setInfo(r.data!); setPick(r.data!.offers[0]?.code ?? '');
  };
  const order = async () => {
    setBusy(true); const r = await goApi.taxiCreate({ city, from, to, tariff: pick, comment }); setBusy(false);
    if (!r.ok) return fail(r);
    flash('Ищем водителя'); onCreated(r.data!.orderId);
  };
  return (
    <>
      <Back onClick={onBack} title="Такси" />
      <Col>
        <Card><Col>
          <AddressField label="Откуда" value={from} onChange={(p) => { setFrom(p); reset(); }} canLocate />
          <AddressField label="Куда" value={to} onChange={(p) => { setTo(p); reset(); }} />
          <Btn busy={busy} disabled={!(from.address || from.lat) || !(to.address || to.lat)} onClick={quote}>Рассчитать</Btn>
        </Col></Card>
        {offers && info && (
          <Card><Col>
            <div style={{ fontSize: 13, color: C.t2 }}>≈ {info.km} км, ~{info.minutes} мин{info.estimated ? ' (оценка по прямой — карты не подключены)' : ''}</div>
            {offers.map((o) => (
              <button key={o.code} onClick={() => setPick(o.code)} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 14, fontSize: 16, fontWeight: 700,
                border: `2px solid ${pick === o.code ? GO : C.brd}`, background: pick === o.code ? 'rgba(14,165,164,.1)' : C.l2, color: C.t1 }}>
                <span>{o.title}</span><span>{fmt(o.priceRub)}</span>
              </button>
            ))}
            <Input label="Комментарий водителю" value={comment} onChange={setComment} max={200} />
            <Notice>Оплата — водителю напрямую по реквизитам после поездки. Sky деньги за поездку не принимает.</Notice>
            <Btn busy={busy} disabled={!pick} onClick={order}>Заказать</Btn>
          </Col></Card>
        )}
      </Col>
    </>
  );
};

type Scenario = 'p2p' | 'pvz' | 'company';
const SC: Record<Scenario, string> = { p2p: 'От человека человеку', pvz: 'Из ПВЗ получателю', company: 'От компании получателю' };
const SIZES = [['s', 'Малый'], ['m', 'Средний'], ['l', 'Крупный']] as const;

export const DeliveryScreen = ({ city, hasCompany, onBack, onCreated }: { city: string; hasCompany: boolean; onBack: () => void; onCreated: (id: string) => void }) => {
  const [sc, setSc] = useState<Scenario>('p2p');
  const [from, setFrom] = useState<Point>({}); const [to, setTo] = useState<Point>({});
  const [desc, setDesc] = useState(''); const [weight, setWeight] = useState(''); const [size, setSize] = useState('s'); const [pvzInfo, setPvzInfo] = useState('');
  const [rn, setRn] = useState(''); const [rp, setRp] = useState(''); const [sn, setSn] = useState(''); const [sp, setSp] = useState('');
  const [price, setPrice] = useState<{ priceRub: number; km: number; minutes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const body = () => ({ scenario: sc, city, from, to, size, parcel: { description: desc, weightKg: Number(weight) || 0, size }, pvzInfo,
    recipient: { name: rn, phone: rp }, ...(sc === 'pvz' ? {} : { sender: { name: sn, phone: sp } }) });

  const quote = async () => { setBusy(true); const r = await goApi.deliveryQuote({ city, from, to, size }); setBusy(false); if (!r.ok) return fail(r); setPrice(r.data!); };
  const order = async () => {
    setBusy(true); const r = await goApi.deliveryCreate(body()); setBusy(false);
    if (!r.ok) return fail(r);
    flash('Ищем курьера'); onCreated(r.data!.orderId);
  };
  return (
    <>
      <Back onClick={onBack} title="Доставка" />
      <Col>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(Object.keys(SC) as Scenario[]).filter((k) => k !== 'company' || hasCompany).map((k) => (
            <Btn key={k} kind={sc === k ? 'main' : 'soft'} onClick={() => { setSc(k); setPrice(null); }} style={{ height: 36, fontSize: 13 }}>{SC[k]}</Btn>
          ))}
        </div>
        <Card><Col>
          <AddressField label={sc === 'pvz' ? 'Адрес ПВЗ' : 'Откуда забрать'} value={from} onChange={(p) => { setFrom(p); setPrice(null); }} canLocate />
          <AddressField label="Куда доставить" value={to} onChange={(p) => { setTo(p); setPrice(null); }} />
          <Input label="Что передаём" value={desc} onChange={setDesc} max={200} placeholder="Документы, подарок…" />
          {sc === 'pvz' && <Input label="Сведения об отправлении в ПВЗ" value={pvzInfo} onChange={setPvzInfo} max={200} placeholder="Номер заказа, на кого оформлено" />}
          <div style={{ display: 'flex', gap: 8 }}>
            {SIZES.map(([k, t]) => <Btn key={k} kind={size === k ? 'main' : 'soft'} onClick={() => { setSize(k); setPrice(null); }} style={{ flex: 1, height: 38, fontSize: 13, padding: 0 }}>{t}</Btn>)}
          </div>
          <Input label="Вес, кг" value={weight} onChange={(v) => setWeight(v.replace(/[^\d.]/g, ''))} />
          {sc !== 'pvz' && <><Input label="Отправитель: имя" value={sn} onChange={setSn} max={80} /><Input label="Отправитель: телефон" value={sp} onChange={setSp} type="tel" /></>}
          <Input label="Получатель: имя" value={rn} onChange={setRn} max={80} />
          <Input label="Получатель: телефон" value={rp} onChange={setRp} type="tel" placeholder="+7…" />
          <Btn kind="soft" busy={busy} disabled={!(from.address || from.lat) || !(to.address || to.lat)} onClick={quote}>Рассчитать цену</Btn>
        </Col></Card>
        {price && (
          <Card><Col>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.t1 }}>{fmt(price.priceRub)}</div>
            <div style={{ fontSize: 13, color: C.t2 }}>≈ {price.km} км, ~{price.minutes} мин. Итоговую цену подтверждает сервер при заказе.</div>
            <Notice>Курьеру платите напрямую после вручения. Два одноразовых кода (передача и вручение) появятся в заказе.</Notice>
            <Btn busy={busy} onClick={order}>Заказать доставку</Btn>
          </Col></Card>
        )}
      </Col>
    </>
  );
};
