/** Sky GO: кабинет «Жилье и отдых» — объявления (квартира/дом, тур, отель), фотографии, публикация и заявки на бронь. */
import { useRef, useState } from 'react';
import { Trash2, Plus, ImagePlus } from 'lucide-react';
import { goApi, STAY_LABEL, STAY_ROLE, type MyListing, type StayKind } from './api';
import { Back, Btn, Card, Chip, Col, Empty, Input, Notice, fail, fmt, useLoad, C } from './ui';
import { OrderRow } from './Orders';
import { PayDetailsCard, SubscriptionCard } from './Cabinet';
import { Photo } from './Stay';
import { flash } from '@/shared/flash';

const STATUS: Record<string, [string, string]> = { draft: ['Черновик', '#64748b'], published: ['Опубликовано', '#10b981'], hidden: ['Снято администрацией', '#ef4444'] };
const digits = (v: string, n = 7) => v.replace(/\D/g, '').slice(0, n);

export const StayCabinet = ({ kind, cities, onOpen }: { kind: StayKind; cities: string[]; onOpen: (id: string) => void }) => {
  const role = STAY_ROLE[kind];
  const [mine, reload] = useLoad(() => goApi.stayMine(), []);
  const [orders] = useLoad(() => goApi.orders({ side: 'executor', status: 'active' }), [], 8000);
  const [edit, setEdit] = useState<MyListing | 'new' | null>(null);
  const list = (mine?.ok ? mine.data!.listings : []).filter((l) => l.kind === kind);
  if (edit) return <Editor kind={kind} cities={cities} existing={edit === 'new' ? null : edit} onBack={() => { setEdit(null); reload(); }} />;
  const bookings = orders?.ok ? orders.data!.orders.filter((o) => o.kind === 'stay') : [];
  return (
    <Col>
      <SubscriptionCard role={role} onChange={reload} />
      <PayDetailsCard />
      {kind !== 'home' && <Notice>{kind === 'tour' ? 'Туры' : 'Отели'} размещают только ИП и организации. Sky не сверяет вас с реестрами {kind === 'tour' ? 'туроператоров' : 'гостиниц'} — ответственность за законность деятельности на вас.</Notice>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Мои объявления</div>
        <Btn style={{ height: 38, fontSize: 13 }} onClick={() => setEdit('new')}><Plus size={15} /> Добавить</Btn>
      </div>
      {!mine ? <Empty text="Загрузка…" /> : list.length === 0 ? <Empty text="Объявлений пока нет." /> : list.map((l) => (
        <Card key={l.id} onClick={() => setEdit(l)} style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ width: 96, height: 80, flex: '0 0 96px' }}><Photo id={l.photos[0] ?? null} /></div>
            <div style={{ padding: '8px 8px 8px 0', minWidth: 0 }}>
              <div translate="no" style={{ fontWeight: 700, color: C.t1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.title}</div>
              <div style={{ fontSize: 12.5, color: C.t2 }}>{l.priceRub ? `от ${fmt(l.priceRub)}` : 'цена не задана'}</div>
              <Chip color={STATUS[l.status][1]}>{STATUS[l.status][0]}</Chip>
            </div>
          </div>
        </Card>))}
      <div style={{ fontWeight: 800, color: C.t1 }}>Заявки и брони</div>
      {bookings.length === 0 ? <Empty text="Активных заявок нет." /> : bookings.map((o) => <OrderRow key={o.id} o={o} onOpen={() => onOpen(o.id)} />)}
    </Col>
  );
};

type Row = Record<string, string>;

const Editor = ({ kind, cities, existing, onBack }: { kind: StayKind; cities: string[]; existing: MyListing | null; onBack: () => void }) => {
  const d = existing?.data ?? {};
  const [id, setId] = useState(existing?.id ?? '');
  const [f, setF] = useState<Row>({
    title: existing?.title ?? '', descr: existing?.descr ?? '', city: existing?.city ?? cities[0] ?? '', address: existing?.address ?? '',
    priceRub: existing?.priceRub ? String(existing.priceRub) : '', maxGuests: String(d.maxGuests ?? 2), rooms: String(d.rooms ?? 1), beds: String(d.beds ?? 1), areaM2: String(d.areaM2 ?? ''),
    minNights: String(d.minNights ?? 1), checkInTime: d.checkInTime ?? '14:00', checkOutTime: d.checkOutTime ?? '12:00', rules: d.rules ?? '', amenities: (d.amenities ?? []).join(', '),
    stars: String(d.stars ?? 0), durationDays: String(d.durationDays ?? 1), program: d.program ?? '', includes: d.includes ?? '', minAge: String(d.minAge ?? 0),
  });
  const [rooms, setRooms] = useState<Row[]>((d.rooms && Array.isArray(d.rooms) ? d.rooms : []).map((r: any) => ({ id: r.id, name: r.name, priceRub: String(r.priceRub), guests: String(r.guests), count: String(r.count) })));
  const [deps, setDeps] = useState<Row[]>((d.departures ?? []).map((x: any) => ({ id: x.id, date: x.date, priceRub: String(x.priceRub), seats: String(x.seats) })));
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? []);
  const [status, setStatus] = useState(existing?.status ?? 'draft');
  const [busy, setBusy] = useState(false); const file = useRef<HTMLInputElement>(null);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });

  const payload = () => {
    const common = { id: id || undefined, kind, title: f.title, descr: f.descr, city: f.city, address: f.address };
    const amen = f.amenities.split(',').map((x) => x.trim()).filter(Boolean);
    if (kind === 'home') return { ...common, priceRub: Number(f.priceRub), data: { maxGuests: Number(f.maxGuests), rooms: Number(f.rooms), beds: Number(f.beds), areaM2: Number(f.areaM2) || 0, minNights: Number(f.minNights), checkInTime: f.checkInTime, checkOutTime: f.checkOutTime, rules: f.rules, amenities: amen } };
    if (kind === 'hotel') return { ...common, data: { stars: Number(f.stars), amenities: amen, checkInTime: f.checkInTime, checkOutTime: f.checkOutTime, rules: f.rules, rooms: rooms.map((r) => ({ id: r.id || undefined, name: r.name, priceRub: Number(r.priceRub), guests: Number(r.guests), count: Number(r.count) })) } };
    return { ...common, data: { durationDays: Number(f.durationDays), program: f.program, includes: f.includes, minAge: Number(f.minAge), departures: deps.map((x) => ({ id: x.id || undefined, date: x.date, priceRub: Number(x.priceRub), seats: Number(x.seats) })) } };
  };
  const save = async (): Promise<string | null> => {
    setBusy(true); const r = await goApi.staySave(payload()); setBusy(false);
    if (!r.ok) { fail(r); return null; }
    setId(r.data!.id); flash('Сохранено'); return r.data!.id;
  };
  const upload = async (fl: File) => {
    const lid = id || await save(); if (!lid) return;
    setBusy(true); const r = await goApi.stayAddPhoto(lid, fl); setBusy(false);
    if (!r.ok) return fail(r);
    setPhotos([...photos, r.data!.id]);
  };
  const publish = async (on: boolean) => {
    const lid = id || await save(); if (!lid) return;
    const sv = await goApi.staySave({ ...payload(), id: lid }); if (!sv.ok) return fail(sv);
    const r = await goApi.stayPublish(lid, on); if (!r.ok) return fail(r);
    setStatus((r.data as any).status); flash(on ? 'Опубликовано' : 'Снято с публикации');
  };
  const row = (src: Row[], set2: (r: Row[]) => void, i: number, k: string, label: string, props: { type?: string; numeric?: boolean } = {}) => (
    <Input label={label} type={props.type} value={src[i][k]} onChange={(v) => set2(src.map((x, j) => (j === i ? { ...x, [k]: props.numeric ? digits(v) : v } : x)))} />);

  return (
    <>
      <Back onClick={onBack} title={existing ? 'Объявление' : `Новое: ${STAY_LABEL[kind]}`} />
      <Col>
        {status === 'hidden' && <Notice tone="warn">Объявление снято администрацией{existing?.modNote ? `: ${existing.modNote}` : ''}. Вернуть его в публикацию может только администрация.</Notice>}
        <Card><Col>
          <Input label="Название" value={f.title} onChange={(v) => set('title', v)} max={120} />
          <Input area label="Описание" value={f.descr} onChange={(v) => set('descr', v)} max={2000} />
          <label style={{ fontSize: 12, color: C.t2 }}>Город
            <select value={f.city} onChange={(e) => set('city', e.target.value)} style={{ display: 'block', width: '100%', height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 12px', fontSize: 15, marginTop: 5 }}>
              {cities.map((c) => <option key={c}>{c}</option>)}</select></label>
          <Input label={kind === 'tour' ? 'Место сбора' : 'Точный адрес (гостю — после подтверждения брони)'} value={f.address} onChange={(v) => set('address', v)} max={200} />
          {kind === 'home' && <>
            <Input label="Цена за ночь, ₽" value={f.priceRub} onChange={(v) => set('priceRub', digits(v))} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Input label="Гостей до" value={f.maxGuests} onChange={(v) => set('maxGuests', digits(v, 2))} /><Input label="Комнат" value={f.rooms} onChange={(v) => set('rooms', digits(v, 2))} />
              <Input label="Спальных мест" value={f.beds} onChange={(v) => set('beds', digits(v, 2))} /><Input label="Площадь, м²" value={f.areaM2} onChange={(v) => set('areaM2', digits(v, 4))} />
              <Input label="Мин. ночей" value={f.minNights} onChange={(v) => set('minNights', digits(v, 2))} /><span />
              <Input label="Заезд с" value={f.checkInTime} onChange={(v) => set('checkInTime', v)} /><Input label="Выезд до" value={f.checkOutTime} onChange={(v) => set('checkOutTime', v)} /></div>
          </>}
          {kind === 'hotel' && <>
            <Input label="Звёзд (0–5)" value={f.stars} onChange={(v) => set('stars', digits(v, 1))} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Input label="Заезд с" value={f.checkInTime} onChange={(v) => set('checkInTime', v)} /><Input label="Выезд до" value={f.checkOutTime} onChange={(v) => set('checkOutTime', v)} /></div>
          </>}
          {kind === 'tour' && <>
            <Input label="Длительность, дней" value={f.durationDays} onChange={(v) => set('durationDays', digits(v, 2))} />
            <Input area label="Программа" value={f.program} onChange={(v) => set('program', v)} max={3000} />
            <Input label="Что включено" value={f.includes} onChange={(v) => set('includes', v)} max={600} />
            <Input label="Минимальный возраст" value={f.minAge} onChange={(v) => set('minAge', digits(v, 2))} />
          </>}
          {kind !== 'tour' && <Input label="Удобства (через запятую)" value={f.amenities} onChange={(v) => set('amenities', v)} />}
          {kind !== 'tour' && <Input label="Правила" value={f.rules} onChange={(v) => set('rules', v)} max={600} />}
        </Col></Card>
        {kind === 'hotel' && <Card><Col>
          <div style={{ fontWeight: 800, color: C.t1 }}>Номера</div>
          {rooms.map((r, i) => (
            <div key={i} style={{ border: `1px solid ${C.brd}`, borderRadius: 14, padding: 10 }}><Col gap={6}>
              {row(rooms, setRooms, i, 'name', 'Название номера')}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {row(rooms, setRooms, i, 'priceRub', 'Цена/ночь', { numeric: true })}{row(rooms, setRooms, i, 'guests', 'Гостей', { numeric: true })}{row(rooms, setRooms, i, 'count', 'Таких номеров', { numeric: true })}</div>
              <Btn kind="danger" style={{ height: 34, fontSize: 12 }} onClick={() => setRooms(rooms.filter((_, j) => j !== i))}><Trash2 size={13} /> Убрать</Btn>
            </Col></div>))}
          <Btn kind="soft" onClick={() => setRooms([...rooms, { name: '', priceRub: '', guests: '2', count: '1' }])}><Plus size={15} /> Добавить номер</Btn>
        </Col></Card>}
        {kind === 'tour' && <Card><Col>
          <div style={{ fontWeight: 800, color: C.t1 }}>Отправления</div>
          {deps.map((x, i) => (
            <div key={i} style={{ border: `1px solid ${C.brd}`, borderRadius: 14, padding: 10 }}><Col gap={6}>
              {row(deps, setDeps, i, 'date', 'Дата отправления', { type: 'date' })}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{row(deps, setDeps, i, 'priceRub', 'Цена за человека', { numeric: true })}{row(deps, setDeps, i, 'seats', 'Мест', { numeric: true })}</div>
              <Btn kind="danger" style={{ height: 34, fontSize: 12 }} onClick={() => setDeps(deps.filter((_, j) => j !== i))}><Trash2 size={13} /> Убрать</Btn>
            </Col></div>))}
          <Btn kind="soft" onClick={() => setDeps([...deps, { date: '', priceRub: '', seats: '10' }])}><Plus size={15} /> Добавить отправление</Btn>
        </Col></Card>}
        <Card><Col>
          <div style={{ fontWeight: 800, color: C.t1 }}>Фотографии ({photos.length}/8)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {photos.map((p) => (
              <div key={p} style={{ position: 'relative', width: 88, height: 70, borderRadius: 12, overflow: 'hidden' }}>
                <Photo id={p} />
                <button aria-label="Удалить" onClick={async () => { const r = await goApi.stayRemovePhoto(id, p); if (!r.ok) return fail(r); setPhotos(photos.filter((x) => x !== p)); }}
                  style={{ position: 'absolute', top: 2, right: 2, width: 24, height: 24, borderRadius: 8, border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff' }}><Trash2 size={13} /></button>
              </div>))}
            {photos.length < 8 && <button onClick={() => file.current?.click()} style={{ width: 88, height: 70, borderRadius: 12, border: `1px dashed ${C.brd}`, background: C.l2, color: C.t2, display: 'grid', placeItems: 'center' }}><ImagePlus size={20} /></button>}
          </div>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) void upload(fl); }} />
          <div style={{ fontSize: 12, color: C.t3 }}>JPG, PNG или WebP до 4 МБ. Для публикации нужна хотя бы одна фотография.</div>
        </Col></Card>
        <Btn busy={busy} onClick={() => void save()}>Сохранить</Btn>
        {status !== 'hidden' && (status === 'published'
          ? <Btn kind="soft" onClick={() => void publish(false)}>Снять с публикации</Btn>
          : <Btn kind="soft" onClick={() => void publish(true)}>Опубликовать</Btn>)}
        {id && <Btn kind="danger" onClick={async () => { const r = await goApi.stayRemove(id); if (!r.ok) return fail(r); flash('Объявление удалено'); onBack(); }}>Удалить объявление</Btn>}
      </Col>
    </>
  );
};
