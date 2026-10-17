/** Sky GO: «Доставка» — хаб (курьер, пункты выдачи, грузовой) и форма заказа. Цены и допуск считает сервер. */
import { useEffect, useRef, useState } from 'react';
import { Package, Car, ClipboardCheck, Building2, Truck, Crosshair, MapPin, Flag } from 'lucide-react';
import { goApi, goError, type CargoTariff, type Point } from './api';
import { bizApi, ASSIGN_LABEL, type AssignMode, type Member } from './bizApi';
import { Back, Btn, Card, Col, Head, Input, Notice, PickRow, Segmented, StickyBar, Tile, fail, fmt, locate, C, GO } from './ui';
import { flash } from '@/shared/flash';

export type DeliveryMode = 'p2p' | 'errand' | 'pvz' | 'company' | 'cargo';
const TITLE: Record<DeliveryMode, string> = { p2p: 'Экспресс', errand: 'Поручение', pvz: 'Из пункта выдачи', company: 'От компании', cargo: 'Грузовой' };

export const DeliveryHub = ({ hasCompany, onBack, onPick }: { hasCompany: boolean; onBack: () => void; onPick: (m: DeliveryMode) => void }) => (
  <>
    <Head title="Доставка" icon={<Package size={22} />} onBack={onBack} />
    <Col gap={18}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 8 }}>Курьер</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Tile title="Экспресс" hint="Заберём у человека и привезём получателю" icon={<Car size={34} />} onClick={() => onPick('p2p')} />
          <Tile title="Поручения" hint="Забрать заказ или что-то купить" icon={<ClipboardCheck size={34} />} onClick={() => onPick('errand')} />
          {hasCompany && <Tile title="От компании" hint="Доставка вашей организации получателю" icon={<Building2 size={34} />} onClick={() => onPick('company')} />}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 8 }}>Пункты выдачи</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Tile title="Из ПВЗ" hint="Заберём из пункта выдачи и привезём вам" icon={<Building2 size={34} />} onClick={() => onPick('pvz')} />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.t1, marginBottom: 8 }}>Грузовой</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Tile title="По городу" hint="Крупные вещи, мебель, переезд" icon={<Truck size={34} />} onClick={() => onPick('cargo')} />
        </div>
      </div>
      <Notice>Оплата — курьеру напрямую после вручения. Sky деньги за доставку не принимает; передачу и вручение подтверждают одноразовые коды.</Notice>
    </Col>
  </>
);

const SIZE_CARDS: { k: 's' | 'm' | 'l'; t: string; hint: string }[] = [
  { k: 's', t: 'Малый', hint: 'до 2 кг, для мелочей и документов' },
  { k: 'm', t: 'Средний', hint: 'до 5 кг, например обувная коробка' },
  { k: 'l', t: 'Крупный', hint: 'до 20 кг, большая коробка или сумка' },
];

const AddressRow = ({ label, icon, value, onChange, canLocate }: { label: string; icon: React.ReactNode; value: Point; onChange: (p: Point) => void; canLocate?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: `1px solid ${C.brd}` }}>
    <div style={{ width: 40, height: 40, borderRadius: 12, background: C.l2, display: 'grid', placeItems: 'center', color: C.t2, flexShrink: 0 }}>{icon}</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, color: C.t3 }}>{label}</div>
      <input translate="no" value={value.address ?? ''} onChange={(e) => onChange({ address: e.target.value })} placeholder="Город, улица, дом" maxLength={240}
        style={{ width: '100%', border: 'none', background: 'transparent', color: C.t1, fontSize: 16, fontWeight: 600, outline: 'none', padding: '2px 0' }} />
    </div>
    {canLocate && (
      <button aria-label="Моё местоположение" onClick={async () => { const p = await locate(); if (!p) return flash('Нет доступа к геолокации — введите адрес вручную.'); onChange({ address: 'Моё местоположение', ...p }); }}
        style={{ width: 38, height: 38, borderRadius: 12, border: 'none', background: C.l2, color: GO, display: 'grid', placeItems: 'center' }}><Crosshair size={18} /></button>)}
  </div>
);

const hasPoint = (p: Point) => Boolean((p.address ?? '').trim().length >= 5 || (p.lat != null && p.lng != null));

/** Контекст организации: заказ создаётся в её кабинете (адреса организации, режим назначения, исполнитель из команды). */
export interface OrgFormCtx { id: string; name: string; assignMode: AssignMode; points: { id: string; title: string; address: string }[]; executors: Member[] }

export const DeliveryForm = ({ mode, city, cargo, onBack, onCreated, org }: { mode: DeliveryMode; city: string; cargo?: CargoTariff; onBack: () => void; onCreated: (id: string) => void; org?: OrgFormCtx }) => {
  const [pointId, setPointId] = useState(''); const [assignMode, setAssignMode] = useState<AssignMode>(org?.assignMode ?? 'manual'); const [assignTo, setAssignTo] = useState('');
  const isCargo = mode === 'cargo';
  const [from, setFrom] = useState<Point>({}); const [to, setTo] = useState<Point>({});
  const [size, setSize] = useState<'s' | 'm' | 'l'>('s'); const [body, setBody] = useState<'s' | 'm' | 'l'>('s'); const [loaders, setLoaders] = useState(0);
  const [desc, setDesc] = useState(''); const [weight, setWeight] = useState(''); const [pvzInfo, setPvzInfo] = useState('');
  const [rn, setRn] = useState(''); const [rp, setRp] = useState(''); const [sn, setSn] = useState(''); const [sp, setSp] = useState('');
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof goApi.deliveryQuote>>['data'] | null>(null);
  const [qerr, setQerr] = useState(''); const [busy, setBusy] = useState(false); const seq = useRef(0);

  // Расчёт — сам, когда оба адреса заполнены (с задержкой, чтобы не дёргать геокодер на каждую букву).
  useEffect(() => {
    if (!hasPoint(from) || !hasPoint(to)) { setQuote(null); setQerr(''); return undefined; }
    const my = ++seq.current;
    const h = setTimeout(async () => {
      const r = await goApi.deliveryQuote({ scenario: mode, city, from, to, size, body, loaders });
      if (my !== seq.current) return;
      if (!r.ok) { setQuote(null); setQerr(goError(r)); return; }
      setQerr(''); setQuote(r.data!);
    }, 800);
    return () => clearTimeout(h);
  }, [from, to, size, body, loaders, mode, city]);

  const needSender = mode !== 'pvz' && mode !== 'errand';
  const body0 = () => ({ scenario: mode, city, from, to, size, body, loaders, pvzInfo, parcel: { description: desc, weightKg: Number(weight) || 0, size },
    recipient: { name: rn, phone: rp }, ...(mode === 'pvz' ? {} : { sender: { name: sn, phone: sp } }) });
  const ready = Boolean(quote) && desc.trim().length >= 2 && rn.trim().length >= 2 && rp.length >= 10 && (!needSender || (sn.trim().length >= 2 && sp.length >= 10)) && (mode !== 'pvz' || pvzInfo.trim().length >= 2);
  const order = async () => {
    setBusy(true);
    const r = org
      ? await bizApi.createOrder(org.id, { ...body0(), scenario: 'company', pointId: pointId || undefined, assignMode, assignTo: assignMode === 'manual' && assignTo ? assignTo : undefined })
      : await goApi.deliveryCreate({ ...body0(), quoteId: quote?.quoteId });
    setBusy(false);
    if (!r.ok) {
      // Тариф изменился или расчёт устарел: заказ НЕ создан — показываем новую цену, человек подтверждает заново.
      const fresh = (r.data as { quote?: NonNullable<typeof quote> } | undefined)?.quote;
      if (!org && fresh && (r.error === 'price_changed' || r.error === 'quote_expired' || r.error === 'quote_mismatch')) { setQuote(fresh); setQerr(goError(r)); return; }
      return fail(r);
    }
    setQerr('');
    const ae = (r.data as { assignError?: string } | undefined)?.assignError;
    if (org && ae) flash(`Заказ создан, но исполнитель не назначен: ${goError({ error: ae })}`);
    else flash(org ? (assignMode === 'pool' ? 'Заказ открыт для курьеров' : assignTo ? 'Заказ создан и назначен' : 'Заказ создан') : 'Ищем курьера');
    onCreated(r.data!.orderId);
  };
  const bodies = quote?.bodies ?? cargo?.bodies;
  return (
    <>
      <Head title={TITLE[mode]} icon={isCargo ? <Truck size={22} /> : <Package size={22} />} onBack={onBack} />
      <Col gap={12}>
        <Card style={{ padding: '4px 14px' }}>
          <AddressRow label={mode === 'errand' ? 'Где забрать или купить' : mode === 'pvz' ? 'Адрес пункта выдачи' : 'Откуда'} icon={<MapPin size={18} />} value={from} onChange={setFrom} canLocate />
          <AddressRow label={mode === 'errand' ? 'Куда привезти' : 'Куда'} icon={<Flag size={18} />} value={to} onChange={setTo} />
          {quote?.expiresAt && !org && <div style={{ fontSize: 12.5, color: C.t3, paddingTop: 8 }}>{`Цена зафиксирована до ${new Date(quote.expiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`}</div>}
          {quote && <div style={{ fontSize: 12.5, color: C.t2, padding: '8px 0' }}>≈ {quote.km} км, ~{quote.minutes} мин{quote.estimated ? ' · по прямой, карты не подключены' : ''}</div>}
          {qerr && <div style={{ padding: '8px 0' }}><Notice tone="warn">{qerr}</Notice></div>}
        </Card>

        {isCargo ? (
          <Card><Col gap={12}>
            <div style={{ borderRadius: 18, background: C.l2, padding: 16, textAlign: 'center', color: C.t2 }}>
              <Truck size={64} color={GO} />
              <div style={{ marginTop: 8, fontSize: 14 }}>{body === 's' ? 'Подойдёт для нескольких коробок' : body === 'm' ? 'Мебель и бытовая техника' : 'Переезд и крупногабаритный груз'}</div>
              {bodies && <div style={{ fontSize: 13, color: C.t3 }}>Максимум {bodies[body].maxKg} кг{bodies[body].dims ? ` · ${bodies[body].dims} см` : ''}</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 16, color: C.t1 }}>Кузов</span>
              <div style={{ width: 190 }}><Segmented value={body} onChange={setBody} options={[{ v: 's', t: 'S' }, { v: 'm', t: 'M' }, { v: 'l', t: 'L' }]} /></div></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><div style={{ fontSize: 16, color: C.t1 }}>Грузчики</div><div style={{ fontSize: 12.5, color: C.t3 }}>{loaders === 0 ? 'Помощь не нужна' : `+${fmt((quote?.loaderRub ?? cargo?.loaderRub ?? 0) * loaders)}`}</div></div>
              <div style={{ width: 190 }}><Segmented value={loaders} onChange={setLoaders} options={[{ v: 0, t: 'Нет' }, { v: 1, t: '1' }, { v: 2, t: '2' }]} /></div></div>
          </Col></Card>
        ) : (
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {SIZE_CARDS.map((c) => (
              <button key={c.k} onClick={() => setSize(c.k)} style={{ flex: '0 0 62%', textAlign: 'left', borderRadius: 20, padding: 14, border: `2px solid ${size === c.k ? GO : 'transparent'}`, background: C.l2, color: C.t1 }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{c.t}</div>
                <div style={{ fontSize: 12.5, color: C.t2, minHeight: 34, marginTop: 2 }}>{c.hint}</div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 8 }}>{quote?.prices ? fmt(quote.prices[c.k]) : '—'}</div>
              </button>))}
          </div>
        )}

        <Card><Col>
          <Input label={isCargo ? 'Что везём' : mode === 'errand' ? 'Что нужно сделать или купить' : 'Что внутри'} value={desc} onChange={setDesc} max={200} placeholder={mode === 'errand' ? 'Забрать заказ из магазина' : 'Документы, подарок…'} />
          {mode === 'pvz' && <Input label="Сведения об отправлении" value={pvzInfo} onChange={setPvzInfo} max={200} placeholder="Номер заказа, на кого оформлено" />}
          {!isCargo && <Input label="Вес, кг (необязательно)" value={weight} onChange={(v) => setWeight(v.replace(/[^\d.]/g, ''))} />}
        </Col></Card>

        {org && (
          <Card><Col>
            <div style={{ fontWeight: 800, color: C.t1 }}>Организация «{org.name}»</div>
            {org.points.length > 0 && (
              <label style={{ display: 'block' }}><div style={{ fontSize: 12, color: C.t2, margin: '0 0 5px 4px' }}>Точка отправления</div>
                <select value={pointId} onChange={(e) => { setPointId(e.target.value); const pt = org.points.find((x) => x.id === e.target.value); if (pt) setFrom({ address: pt.address }); }}
                  style={{ width: '100%', height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 10px', fontSize: 15 }}>
                  <option value="">Другой адрес (ввести выше)</option>{org.points.map((p) => <option key={p.id} value={p.id}>{p.title} — {p.address}</option>)}</select></label>)}
            <div style={{ fontSize: 12, color: C.t2, margin: '2px 0 -4px 4px' }}>Кто выполнит</div>
            <Segmented value={assignMode} onChange={setAssignMode} options={[{ v: 'manual', t: 'Назначу' }, { v: 'auto', t: 'Авто' }, { v: 'pool', t: 'Всем' }]} />
            <div style={{ fontSize: 12.5, color: C.t3 }}>{ASSIGN_LABEL[assignMode]}. {assignMode === 'pool' ? 'Заказ увидят все курьеры Sky GO; платить курьеру нужно напрямую.' : 'Заказ получит сотрудник вашей команды; оплата курьеру не требуется.'}</div>
            {assignMode === 'manual' && org.executors.length > 0 && (
              <label style={{ display: 'block' }}><div style={{ fontSize: 12, color: C.t2, margin: '0 0 5px 4px' }}>Назначить сразу (необязательно)</div>
                <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} style={{ width: '100%', height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 10px', fontSize: 15 }}>
                  <option value="">Позже, из карточки заказа</option>{org.executors.map((m) => <option key={m.profileId} value={m.profileId}>{m.name} · {m.online ? 'на линии' : 'не на линии'} · заказов {m.activeOrders}</option>)}</select></label>)}
          </Col></Card>)}

        <Card><Col>
          {(needSender || mode === 'errand') && <>
            <div style={{ fontWeight: 800, color: C.t1 }}>{mode === 'errand' ? 'Контакт на месте (необязательно)' : 'Отправитель'}</div>
            <Input label="Имя" value={sn} onChange={setSn} max={80} /><Input label="Телефон" type="tel" value={sp} onChange={setSp} placeholder="+7…" /></>}
          <div style={{ fontWeight: 800, color: C.t1 }}>Получатель</div>
          <Input label="Имя" value={rn} onChange={setRn} max={80} /><Input label="Телефон" type="tel" value={rp} onChange={setRp} placeholder="+7…" />
        </Col></Card>
        <Notice>Курьеру платите напрямую после вручения. Два одноразовых кода (передача и вручение) появятся в заказе. Итоговую цену подтверждает сервер.</Notice>
      </Col>
      <StickyBar left={<div><div style={{ fontSize: 12, color: C.t3 }}>Стоимость</div><div style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>{quote ? fmt(quote.priceRub) : '—'}</div></div>}>
        <Btn busy={busy} disabled={!ready} onClick={order} style={{ width: '100%', height: 52, borderRadius: 18 }}>Заказать</Btn>
      </StickyBar>
    </>
  );
};
