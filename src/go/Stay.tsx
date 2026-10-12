/** Sky GO: «Жилье и отдых» — каталог, страница объявления и заявка на бронь. Цену и наличие мест считает сервер. */
import { useEffect, useState } from 'react';
import { Star, Users, CalendarDays } from 'lucide-react';
import { apiBlob } from '@/core/auth/api';
import { goApi, goError, STAY_LABEL, type StayCard, type StayDetail, type StayKind } from './api';
import { Back, Btn, Card, Chip, Col, Empty, Input, Notice, fail, fmt, useLoad, C, GO } from './ui';
import { flash } from '@/shared/flash';

const cache = new Map<string, string>();
/** Фото объявления: через fetch с токеном (img не отправит заголовок авторизации, в приложениях куки нет). */
export const Photo = ({ id, admin, style }: { id: string | null; admin?: boolean; style?: React.CSSProperties }) => {
  const [url, setUrl] = useState<string | null>(id ? cache.get(id) ?? null : null);
  useEffect(() => {
    if (!id || cache.has(id)) { setUrl(id ? cache.get(id) ?? null : null); return; }
    let alive = true;
    void apiBlob(admin ? `/api/admin/go/listing-photos/${id}` : `/api/go/stay/photos/${id}`).then((r) => {
      if (!r.ok || !r.blob) return;
      const u = URL.createObjectURL(r.blob); cache.set(id, u); if (alive) setUrl(u);
    });
    return () => { alive = false; };
  }, [id, admin]);
  return url
    ? <img src={url} alt="" style={{ objectFit: 'cover', width: '100%', height: '100%', ...style }} />
    : <div style={{ width: '100%', height: '100%', background: C.l2, ...style }} />;
};

const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

/** Результаты поиска жилья/туров по условиям из формы «Путешествия» и переход к странице объявления. */
export const StayResults = ({ kind, city, q, guests, ci, co, onBooked, onDetail }: { kind: StayKind; city: string; q: string; guests: string; ci: string; co: string; onBooked: (orderId: string) => void; onDetail?: (open: boolean) => void }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { onDetail?.(openId !== null); }, [openId, onDetail]);
  const dated = kind !== 'tour';
  const [res] = useLoad(() => goApi.stayList({ kind, city, q, guests: guests || undefined, checkIn: dated ? ci || undefined : undefined, checkOut: dated ? co || undefined : undefined }), [kind, city, q, guests, ci, co]);
  if (openId) return <ListingScreen id={openId} onBack={() => setOpenId(null)} onBooked={onBooked} />;
  const list: StayCard[] | null = res?.ok ? res.data!.listings : null;
  return (
    <Col>
      {!list ? <Empty text="Загрузка…" /> : list.length === 0
        ? <Empty text={`В городе «${city}» пока нет объявлений в этом разделе. Они появляются после проверки владельца и оформления подписки.`} />
        : list.map((l) => (
          <Card key={l.id} onClick={() => setOpenId(l.id)} style={{ padding: 0, overflow: 'hidden', borderRadius: 22 }}>
            <div style={{ height: 170 }}><Photo id={l.photo} /></div>
            <div style={{ padding: 12 }}>
              <div translate="no" style={{ fontWeight: 800, fontSize: 17, color: C.t1 }}>{l.title}</div>
              <div style={{ fontSize: 13, color: C.t2, display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                {l.maxGuests ? <span><Users size={12} /> до {l.maxGuests}</span> : null}
                {l.stars ? <span><Star size={12} /> {l.stars}</span> : null}
                {l.durationDays ? <span>{l.durationDays} дн.</span> : null}
                {l.nextDeparture ? <span><CalendarDays size={12} /> {dayLabel(l.nextDeparture)}</span> : null}
              </div>
              <div style={{ marginTop: 6, fontWeight: 800, color: GO }}>от {fmt(l.priceRub)} <span style={{ fontWeight: 500, color: C.t3, fontSize: 12 }}>/ {l.unit}</span></div>
            </div>
          </Card>))}
    </Col>
  );
};

const ListingScreen = ({ id, onBack, onBooked }: { id: string; onBack: () => void; onBooked: (orderId: string) => void }) => {
  const [res] = useLoad(() => goApi.stayGet(id), [id]);
  const [ci, setCi] = useState(''); const [co, setCo] = useState(''); const [guests, setGuests] = useState('2'); const [room, setRoom] = useState(''); const [dep, setDep] = useState(''); const [people, setPeople] = useState('1');
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [comment, setComment] = useState('');
  const [quote, setQuote] = useState<{ totalRub: number; nights: number; available: boolean; label: string } | null>(null);
  const [qerr, setQerr] = useState(''); const [busy, setBusy] = useState(false);
  if (!res?.ok) return <><Back onClick={onBack} title="Объявление" /><Empty text={res ? 'Объявление недоступно.' : 'Загрузка…'} /></>;
  const l: StayDetail = res.data!.listing;
  const d = l.data;
  const rooms: { id: string; name: string; priceRub: number; guests: number; count: number }[] = d.rooms && Array.isArray(d.rooms) ? d.rooms : [];
  const body = () => (l.kind === 'tour' ? { listingId: id, departureId: dep, people: Number(people) } : { listingId: id, checkIn: ci, checkOut: co, guests: Number(guests), roomId: room || undefined });
  const ready = l.kind === 'tour' ? Boolean(dep) && Number(people) > 0 : Boolean(ci && co && Number(guests) > 0 && (l.kind === 'home' || room));
  const calc = async () => {
    setBusy(true); setQerr(''); const r = await goApi.stayQuote(body()); setBusy(false);
    if (!r.ok) { setQuote(null); return setQerr(goError(r)); }
    setQuote(r.data!);
  };
  const send = async () => {
    setBusy(true); const r = await goApi.stayBook({ ...body(), contact: { name, phone }, comment }); setBusy(false);
    if (!r.ok) return fail(r);
    flash('Заявка отправлена владельцу'); onBooked(r.data!.orderId);
  };
  return (
    <>
      <Back onClick={onBack} title={STAY_LABEL[l.kind]} />
      <Col>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', borderRadius: 18 }}>
          {l.photos.map((p) => <div key={p} style={{ flex: '0 0 86%', height: 220, borderRadius: 18, overflow: 'hidden' }}><Photo id={p} /></div>)}
        </div>
        <Card>
          <div translate="no" style={{ fontSize: 20, fontWeight: 900, color: C.t1 }}>{l.title}</div>
          <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{l.city} · {l.owner.name || `@${l.owner.username}`}</div>
          {l.descr && <div translate="no" style={{ marginTop: 8, fontSize: 14, color: C.t1, whiteSpace: 'pre-wrap' }}>{l.descr}</div>}
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {d.maxGuests ? <Chip>до {d.maxGuests} гостей</Chip> : null}{d.rooms && !Array.isArray(d.rooms) ? <Chip>{String(d.rooms)} комн.</Chip> : null}
            {d.beds ? <Chip>{d.beds} спал. мест</Chip> : null}{d.areaM2 ? <Chip>{d.areaM2} м²</Chip> : null}{d.stars ? <Chip>{d.stars}★</Chip> : null}
            {d.durationDays ? <Chip>{d.durationDays} дн.</Chip> : null}{d.minAge ? <Chip>от {d.minAge} лет</Chip> : null}
            {d.checkInTime ? <Chip>заезд с {d.checkInTime}</Chip> : null}{d.checkOutTime ? <Chip>выезд до {d.checkOutTime}</Chip> : null}
          </div>
          {d.amenities?.length ? <div translate="no" style={{ marginTop: 8, fontSize: 13, color: C.t2 }}>Удобства: {d.amenities.join(', ')}</div> : null}
          {d.program ? <div translate="no" style={{ marginTop: 8, fontSize: 13, color: C.t1, whiteSpace: 'pre-wrap' }}>Программа: {d.program}</div> : null}
          {d.includes ? <div translate="no" style={{ marginTop: 6, fontSize: 13, color: C.t2 }}>Включено: {d.includes}</div> : null}
          {d.rules ? <div translate="no" style={{ marginTop: 6, fontSize: 13, color: C.t2 }}>Правила: {d.rules}</div> : null}
        </Card>
        <Card><Col>
          <div style={{ fontWeight: 800, color: C.t1 }}>Заявка на бронирование</div>
          {l.kind === 'tour' ? <>
            {(d.departures ?? []).length === 0 ? <Empty text="Ближайших отправлений нет." /> : (d.departures ?? []).map((x) => (
              <button key={x.id} disabled={x.seatsLeft < 1} onClick={() => { setDep(x.id); setQuote(null); }} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 14, fontWeight: 700,
                border: `2px solid ${dep === x.id ? GO : C.brd}`, background: C.l2, color: C.t1, opacity: x.seatsLeft < 1 ? 0.5 : 1 }}>
                <span>{dayLabel(x.date)}</span><span>{fmt(x.priceRub)} · мест {x.seatsLeft}</span></button>))}
            <Input label="Человек" value={people} onChange={(v) => { setPeople(v.replace(/\D/g, '').slice(0, 2)); setQuote(null); }} />
          </> : <>
            {l.kind === 'hotel' && rooms.map((r) => (
              <button key={r.id} onClick={() => { setRoom(r.id); setQuote(null); }} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 14, fontWeight: 700,
                border: `2px solid ${room === r.id ? GO : C.brd}`, background: C.l2, color: C.t1 }}><span translate="no">{r.name} · до {r.guests}</span><span>{fmt(r.priceRub)}</span></button>))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Input label="Заезд" type="date" value={ci} onChange={(v) => { setCi(v); setQuote(null); }} /><Input label="Выезд" type="date" value={co} onChange={(v) => { setCo(v); setQuote(null); }} /></div>
            <Input label="Гостей" value={guests} onChange={(v) => { setGuests(v.replace(/\D/g, '').slice(0, 2)); setQuote(null); }} />
          </>}
          <Btn kind="soft" busy={busy} disabled={!ready} onClick={calc}>Рассчитать</Btn>
          {qerr && <Notice tone="warn">{qerr}</Notice>}
          {quote && <Notice tone={quote.available ? 'info' : 'warn'}><b>{fmt(quote.totalRub)}</b> · {quote.label} — {quote.available ? 'Даты свободны.' : 'Эти даты (места) уже заняты.'}</Notice>}
          {quote?.available && <>
            <Input label="Ваше имя" value={name} onChange={setName} max={80} />
            <Input label="Телефон" type="tel" value={phone} onChange={setPhone} placeholder="+7…" />
            <Input label="Комментарий владельцу" value={comment} onChange={setComment} max={300} />
            <Notice>Заявку подтверждает владелец. После подтверждения вы получите реквизиты и точный адрес и оплатите напрямую — Sky деньги за жильё не принимает. Если не оплатить в течение 48 часов, даты освободятся.
              {l.kind !== 'home' ? ' Sky не сверяет организатора с реестрами туроператоров и гостиниц.' : ''}</Notice>
            <Btn busy={busy} disabled={name.trim().length < 2 || phone.length < 10} onClick={send}>Отправить заявку</Btn>
          </>}
        </Col></Card>
      </Col>
    </>
  );
};

