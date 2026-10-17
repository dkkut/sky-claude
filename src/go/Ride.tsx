/** Sky GO: такси — карта с точкой подачи, «Куда едем?», недавние адреса, расчёт тарифов. Цену и маршрут считает сервер. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Car, Flag, MapPin, Clock, Home, Briefcase, Star, X } from 'lucide-react';
import { SkyMap } from '@/marketplace/logistics/SkyMap';
import { goApi, goError, type Point } from './api';
import { Back, Btn, Card, Col, Head, Input, Notice, Segmented, StickyBar, fail, fmt, locate, useLoad, C, GO } from './ui';
import { flash } from '@/shared/flash';

export const TaxiScreen = ({ city, onBack, onCreated }: { city: string; onBack: () => void; onCreated: (id: string) => void }) => {
  const [from, setFrom] = useState<Point>({}); const [to, setTo] = useState<Point>({});
  const [editFrom, setEditFrom] = useState(false); const [comment, setComment] = useState('');
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof goApi.taxiQuote>>['data'] | null>(null);
  const [later, setLater] = useState(false); const [when, setWhen] = useState('');
  const [qerr, setQerr] = useState(''); const [pick, setPick] = useState(''); const [busy, setBusy] = useState(false); const seq = useRef(0);
  const [hist] = useLoad(() => goApi.orders({ status: 'history' }), []);
  const [savedRes, reloadSaved] = useLoad(() => goApi.savedPlaces(), []);
  const saved = savedRes?.ok ? savedRes.data!.places : [];

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
    setBusy(true); const r = await goApi.taxiCreate({ city, from, to, tariff: pick, comment, quoteId: quote?.quoteId, scheduledAt: later && when ? new Date(when).toISOString() : undefined }); setBusy(false);
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
    flash(later ? 'Поездка запланирована' : 'Ищем водителя'); onCreated(r.data!.orderId);
  };
  const offer = quote?.offers.find((o) => o.code === pick);
  const savePlace = async (kind: 'home' | 'work' | 'other') => {
    const t = quote?.to ?? to; if (t.lat == null || t.lng == null) return;
    const r = await goApi.saveSavedPlace({ kind, label: kind === 'other' ? (t.address ?? '').slice(0, 40) : undefined, address: t.address ?? '', lat: t.lat, lng: t.lng });
    if (!r.ok) return fail(r); flash('Место сохранено'); reloadSaved();
  };
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
          {!known(to) && saved.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 0 8px' }}>
              {saved.map((p) => (
                <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 14, background: C.l2, color: C.t1, fontSize: 13.5, fontWeight: 700 }}>
                  <button onClick={() => setTo({ address: p.address, lat: p.lat, lng: p.lng })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', color: 'inherit', padding: '7px 8px 7px 12px', fontWeight: 'inherit', fontSize: 'inherit' }}>
                    {p.kind === 'home' ? <Home size={14} color={GO} /> : p.kind === 'work' ? <Briefcase size={14} color={GO} /> : <Star size={14} color={GO} />}<span translate="no">{p.label}</span>
                  </button>
                  <button aria-label="Убрать из сохранённых" onClick={async () => { const r = await goApi.deleteSavedPlace(p.id); if (!r.ok) return fail(r); reloadSaved(); }} style={{ border: 'none', background: 'none', color: C.t3, padding: '7px 10px 7px 2px' }}><X size={13} /></button>
                </span>))}
            </div>)}
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
            {(quote.to?.lat != null) && !saved.some((p) => p.lat === quote.to?.lat && p.lng === quote.to?.lng) && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: C.t3 }}>
                <span>Сохранить назначение:</span>
                {([['home', 'Дом'], ['work', 'Работа'], ['other', 'Место']] as const).map(([k, t]) => <button key={k} onClick={() => void savePlace(k)} style={{ border: 'none', borderRadius: 10, background: C.l2, color: C.t1, padding: '5px 10px', fontWeight: 700, fontSize: 12.5 }}>{t}</button>)}
              </div>)}
            <Input label="Комментарий водителю" value={comment} onChange={setComment} max={200} />
            {offer?.breakdown && <div style={{ fontSize: 12.5, color: C.t3 }}>{`Из чего цена: подача ${fmt(offer.breakdown.baseRub)} · путь ${fmt(offer.breakdown.distanceRub)} · время ${fmt(offer.breakdown.timeRub)}${offer.breakdown.minimumApplied ? ` · минимальная стоимость ${fmt(offer.breakdown.minimumRub)}` : ''}`}</div>}
            {quote.expiresAt && <div style={{ fontSize: 12.5, color: C.t3 }}>{`Цена зафиксирована до ${new Date(quote.expiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}. Если тариф изменится раньше, мы покажем новую цену до заказа.`}</div>}
            <Segmented value={later ? 'later' : 'now'} onChange={(v: string) => setLater(v === 'later')} options={[{ v: 'now', t: 'Сейчас' }, { v: 'later', t: 'На потом' }]} />
            {later && (<div>
              <input type="datetime-local" value={when} min={new Date(Date.now() + 31 * 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(e) => setWhen(e.target.value)}
                aria-label="Дата и время поездки" style={{ width: '100%', height: 46, borderRadius: 14, border: `1px solid ${C.l2}`, background: C.l1, color: C.t1, padding: '0 12px', fontSize: 15 }} />
              <div style={{ fontSize: 12.5, color: C.t3, marginTop: 6 }}>Цена зафиксирована сейчас. Водитель назначается ближе ко времени поездки — за 20 минут мы начнём поиск и пришлём уведомление. Отменить можно до начала поиска и после — по обычным правилам.</div>
            </div>)}
            <Notice>Оплата — водителю напрямую по реквизитам после поездки. Sky деньги за поездку не принимает.</Notice>
          </Col></Card>)}
      </Col>
      {quote && (
        <StickyBar left={<div><div style={{ fontSize: 12, color: C.t3 }}>{offer?.title ?? 'Стоимость'}</div><div style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>{offer ? fmt(offer.priceRub) : '—'}</div></div>}>
          <Btn busy={busy} disabled={!pick || (later && !when)} onClick={order} style={{ width: '100%', height: 52, borderRadius: 18 }}>{later ? 'Запланировать' : 'Заказать'}</Btn>
        </StickyBar>)}
    </>
  );
};
