/** Sky GO: такси — карта с точкой подачи, «Куда едем?», недавние адреса, расчёт тарифов. Цену и маршрут считает сервер. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Car, Flag, MapPin, Clock } from 'lucide-react';
import { SkyMap } from '@/marketplace/logistics/SkyMap';
import { goApi, goError, type Point } from './api';
import { Back, Btn, Card, Col, Head, Input, Notice, StickyBar, fail, fmt, locate, useLoad, C, GO } from './ui';
import { flash } from '@/shared/flash';

export const TaxiScreen = ({ city, onBack, onCreated }: { city: string; onBack: () => void; onCreated: (id: string) => void }) => {
  const [from, setFrom] = useState<Point>({}); const [to, setTo] = useState<Point>({});
  const [editFrom, setEditFrom] = useState(false); const [comment, setComment] = useState('');
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof goApi.taxiQuote>>['data'] | null>(null);
  const [qerr, setQerr] = useState(''); const [pick, setPick] = useState(''); const [busy, setBusy] = useState(false); const seq = useRef(0);
  const [hist] = useLoad(() => goApi.orders({ status: 'history' }), []);

  // Точка подачи — где человек находится (если разрешил); иначе вводит адрес сам.
  useEffect(() => { void locate().then((p) => { if (p) setFrom((f) => (f.address || f.lat != null ? f : { address: 'Моё местоположение', ...p })); else setEditFrom(true); }); }, []);

  const recents = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const o of hist?.ok ? hist.data!.orders : []) {
      const a = o.kind === 'taxi' ? String(o.data.to?.address ?? '') : '';
      if (a && !seen.has(a)) { seen.add(a); out.push(a); }
      if (out.length >= 4) break;
    }
    return out;
  }, [hist]);

  const known = (p: Point) => (p.address ?? '').trim().length >= 5 || p.lat != null;
  useEffect(() => {
    if (!known(from) || !known(to)) { setQuote(null); setQerr(''); return undefined; }
    const my = ++seq.current;
    const h = setTimeout(async () => {
      const r = await goApi.taxiQuote({ city, from, to });
      if (my !== seq.current) return;
      if (!r.ok) { setQuote(null); setQerr(goError(r)); return; }
      setQerr(''); r.data!.offers.sort((a, b) => a.priceRub - b.priceRub); setQuote(r.data!); setPick((cur) => (r.data!.offers.some((o) => o.code === cur) ? cur : r.data!.offers[0]?.code ?? ''));
    }, 800);
    return () => clearTimeout(h);
  }, [from, to, city]);

  const points = useMemo(() => {
    const out: { id: string; pos: { lat: number; lng: number }; label: string; kind?: 'pickup' | 'target' }[] = [];
    const f = quote?.from ?? from; const t = quote?.to ?? to;
    if (f.lat != null && f.lng != null) out.push({ id: 'from', pos: { lat: f.lat, lng: f.lng }, label: 'Подача', kind: 'pickup' });
    if (t.lat != null && t.lng != null) out.push({ id: 'to', pos: { lat: t.lat, lng: t.lng }, label: 'Назначение', kind: 'target' });
    return out;
  }, [from, to, quote]);

  const order = async () => {
    setBusy(true); const r = await goApi.taxiCreate({ city, from, to, tariff: pick, comment, quoteId: quote?.quoteId }); setBusy(false);
    if (!r.ok) {
      // Цена изменилась или расчёт устарел: заказ НЕ создан, показываем новую цену — человек подтверждает заново.
      const fresh = r.data?.quote;
      if (fresh && (r.error === 'price_changed' || r.error === 'quote_expired' || r.error === 'quote_mismatch')) {
        fresh.offers.sort((a, b) => a.priceRub - b.priceRub); setQuote(fresh); setPick((cur) => (fresh.offers.some((o) => o.code === cur) ? cur : fresh.offers[0]?.code ?? ''));
        setQerr(goError(r)); return;
      }
      return fail(r);
    }
    setQerr('');
    flash('Ищем водителя'); onCreated(r.data!.orderId);
  };
  const offer = quote?.offers.find((o) => o.code === pick);
  return (
    <>
      <Back onClick={onBack} title="Такси" />
      <Col gap={12}>
        <div style={{ borderRadius: 22, overflow: 'hidden', border: `1px solid ${C.brd}` }}>
          <SkyMap points={points} height={230} />
        </div>
        <Card style={{ padding: '4px 14px' }}>
          <button onClick={() => setEditFrom(!editFrom)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '10px 0', borderBottom: `1px solid ${C.brd}`, color: C.t1 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: C.l2, display: 'grid', placeItems: 'center', color: GO }}><MapPin size={18} /></div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, color: C.t3 }}>Точка подачи</div>
              <div translate="no" style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{from.address || 'Укажите адрес'}</div></div>
            <span style={{ color: C.t3 }}>›</span>
          </button>
          {editFrom && <div style={{ padding: '8px 0' }}><Input value={from.address === 'Моё местоположение' ? '' : from.address ?? ''} onChange={(v) => setFrom({ address: v })} placeholder="Город, улица, дом" max={240} /></div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: C.l2, display: 'grid', placeItems: 'center', color: C.t2 }}><Flag size={18} /></div>
            <input translate="no" value={to.address ?? ''} onChange={(e) => setTo({ address: e.target.value })} placeholder="Куда едем?" maxLength={240}
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: C.t1, fontSize: 18, fontWeight: 800, outline: 'none' }} />
          </div>
          {!known(to) && recents.map((a) => (
            <button key={a} onClick={() => setTo({ address: a })} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '9px 0', color: C.t1 }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: C.l2, display: 'grid', placeItems: 'center', color: C.t3 }}><Clock size={16} /></div>
              <div translate="no" style={{ flex: 1, fontSize: 15, fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a}</div>
            </button>))}
          {qerr && <div style={{ padding: '6px 0 10px' }}><Notice tone="warn">{qerr}</Notice></div>}
        </Card>

        {quote && (
          <Card><Col gap={8}>
            <div style={{ fontSize: 13, color: C.t2 }}>≈ {quote.km} км, ~{quote.minutes} мин{quote.estimated ? ' · по прямой, карты не подключены' : ''}</div>
            {quote.offers.map((o) => (
              <button key={o.code} onClick={() => setPick(o.code)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 16, fontWeight: 800, fontSize: 16,
                border: `2px solid ${pick === o.code ? GO : 'transparent'}`, background: C.l2, color: C.t1 }}>
                <Car size={26} color={GO} /><span style={{ flex: 1, textAlign: 'left' }}>{o.title}</span><span>{fmt(o.priceRub)}</span>
              </button>))}
            <Input label="Комментарий водителю" value={comment} onChange={setComment} max={200} />
            {offer?.breakdown && <div style={{ fontSize: 12.5, color: C.t3 }}>{`Из чего цена: подача ${fmt(offer.breakdown.baseRub)} · путь ${fmt(offer.breakdown.distanceRub)} · время ${fmt(offer.breakdown.timeRub)}${offer.breakdown.minimumApplied ? ` · минимальная стоимость ${fmt(offer.breakdown.minimumRub)}` : ''}`}</div>}
            {quote.expiresAt && <div style={{ fontSize: 12.5, color: C.t3 }}>{`Цена зафиксирована до ${new Date(quote.expiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}. Если тариф изменится раньше, мы покажем новую цену до заказа.`}</div>}
            <Notice>Оплата — водителю напрямую по реквизитам после поездки. Sky деньги за поездку не принимает.</Notice>
          </Col></Card>)}
      </Col>
      {quote && (
        <StickyBar left={<div><div style={{ fontSize: 12, color: C.t3 }}>{offer?.title ?? 'Стоимость'}</div><div style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>{offer ? fmt(offer.priceRub) : '—'}</div></div>}>
          <Btn busy={busy} disabled={!pick} onClick={order} style={{ width: '100%', height: 52, borderRadius: 18 }}>Заказать</Btn>
        </StickyBar>)}
    </>
  );
};
