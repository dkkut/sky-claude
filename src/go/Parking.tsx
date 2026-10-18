/** Sky GO → Парковки: поиск на карте, оплата с кошелька Sky, мои сессии и машины; кабинет организации. */
import { useState } from 'react';
import { ParkingCircle, MapPin, Clock, Plus, Trash2 } from 'lucide-react';
import { SkyMap } from '@/marketplace/logistics/SkyMap';
import { flash } from '@/shared/flash';
import { pk, newIdem, KIND_LABEL, LOT_STATUS, tariffText, type PkLot, type PkOrg, type PkSession, type PkTariff } from './parkingApi';
import { Back, Btn, Card, Chip, Col, Empty, ErrorState, Input, Notice, Segmented, fail, useLoad, C, GO, fmt } from './ui';

type Tab = 'find' | 'sessions' | 'cars';
const dur = (s: number) => { const m = Math.max(0, Math.floor(s / 60)); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export const ParkingScreen = ({ city, onBack }: { city: string; onBack: () => void }) => {
  const [tab, setTab] = useState<Tab>('find');
  const [lot, setLot] = useState<PkLot | null>(null);
  if (lot) return <LotScreen lot={lot} onBack={() => setLot(null)} onPaid={() => { setLot(null); setTab('sessions'); }} />;
  return (
    <>
      <Back onClick={onBack} title="Парковки" />
      <Col gap={12}>
        <Segmented<Tab> value={tab} onChange={setTab} options={[{ v: 'find', t: 'Найти' }, { v: 'sessions', t: 'Мои' }, { v: 'cars', t: 'Авто' }]} />
        {tab === 'find' && <Find city={city} onOpen={setLot} />}
        {tab === 'sessions' && <Sessions />}
        {tab === 'cars' && <Cars />}
      </Col>
    </>
  );
};

const Find = ({ city, onOpen }: { city: string; onOpen: (l: PkLot) => void }) => {
  const [r, reload] = useLoad(() => pk.lots(city), [city]);
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Не удалось загрузить парковки." onRetry={reload} />;
  const lots = r.data!.lots;
  const points = lots.filter((l) => l.lat != null && l.lng != null).map((l) => ({ id: l.id, pos: { lat: l.lat!, lng: l.lng! }, label: l.title }));
  return (
    <Col gap={10}>
      {points.length > 0 && <div style={{ borderRadius: 22, overflow: 'hidden', border: `1px solid ${C.brd}` }}><SkyMap points={points} height={220} /></div>}
      {lots.length === 0 && <Empty text="В этом городе пока нет парковок" hint="Здесь появляются только парковки, проверенные администрацией Sky." />}
      {lots.map((l) => (
        <Card key={l.id} onClick={() => onOpen(l)}>
          <div translate="no" style={{ fontWeight: 800, fontSize: 16, color: C.t1 }}>{l.title}</div>
          <div translate="no" style={{ fontSize: 13, color: C.t2, margin: '2px 0 6px' }}>{l.address}</div>
          <div style={{ fontSize: 13, color: GO, fontWeight: 700 }}>{l.tariffs[0] ? tariffText(l.tariffs[0]) : 'Тариф не указан'}</div>
        </Card>))}
      <Notice>Свободные места Sky не показывает — у нас нет данных о занятости. Можно оплатить, пока оплаченных мест меньше мест на парковке.</Notice>
    </Col>
  );
};

const LotScreen = ({ lot, onBack, onPaid }: { lot: PkLot; onBack: () => void; onPaid: () => void }) => {
  const [tariffId, setTariffId] = useState(lot.tariffs[0]?.id ?? '');
  const t = lot.tariffs.find((x) => x.id === tariffId);
  const [minutes, setMinutes] = useState(t?.kind === 'flat' ? t.minMinutes : 60);
  const [veh, setVeh] = useState('');
  const [cars] = useLoad(() => pk.vehicles(), []);
  const [q] = useLoad(() => (tariffId ? pk.quote(lot.id, tariffId, minutes) : Promise.resolve(null)), [tariffId, minutes]);
  const [busy, setBusy] = useState(false);
  const [idem] = useState(newIdem);
  const [rep, setRep] = useState(false);
  const vehicles = cars?.ok ? cars.data!.vehicles : [];
  const vid = veh || vehicles[0]?.id || '';
  const pay = async () => {
    setBusy(true);
    const r = await pk.start({ lotId: lot.id, tariffId, minutes, vehicleId: vid, idemKey: idem });
    setBusy(false);
    if (!r.ok) return fail(r);
    flash(`Оплачено ${fmt(r.data!.amountRub)} ₽ с кошелька`); onPaid();
  };
  const points = lot.lat != null && lot.lng != null ? [{ id: lot.id, pos: { lat: lot.lat, lng: lot.lng }, label: lot.title }] : [];
  return (
    <>
      <Back onClick={onBack} title="Парковка" />
      <Col gap={12}>
        {points.length > 0 && <div style={{ borderRadius: 22, overflow: 'hidden', border: `1px solid ${C.brd}` }}><SkyMap points={points} height={200} /></div>}
        <Card>
          <div translate="no" style={{ fontWeight: 900, fontSize: 19, color: C.t1 }}>{lot.title}</div>
          <div translate="no" style={{ fontSize: 13.5, color: C.t2, margin: '3px 0' }}><MapPin size={13} style={{ verticalAlign: -2 }} /> {lot.address}</div>
          {lot.hours && <div translate="no" style={{ fontSize: 13, color: C.t2 }}><Clock size={13} style={{ verticalAlign: -2 }} /> {lot.hours}</div>}
          <div style={{ fontSize: 13, color: C.t2, marginTop: 4 }}>Мест на парковке: {lot.spacesTotal}</div>
          {lot.description && <div translate="no" style={{ fontSize: 13.5, color: C.t1, marginTop: 8, whiteSpace: 'pre-wrap' }}>{lot.description}</div>}
        </Card>
        {lot.tariffs.length === 0 ? <Notice tone="warn">У парковки нет действующего тарифа.</Notice> : (
          <Card>
            <div style={{ fontWeight: 800, color: C.t1, marginBottom: 8 }}>Тариф</div>
            <Col gap={6}>{lot.tariffs.map((x) => (
              <button key={x.id} type="button" onClick={() => { setTariffId(x.id); setMinutes(x.kind === 'flat' ? x.minMinutes : x.kind === 'daily' ? 1440 : 60); }} aria-pressed={tariffId === x.id}
                style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 12, border: `1px solid ${tariffId === x.id ? GO : C.brd}`, background: C.l2, color: C.t1, minHeight: 44 }}>
                <b>{KIND_LABEL[x.kind]}</b> · {tariffText(x)}</button>))}</Col>
            {t && t.kind !== 'flat' && (
              <div style={{ marginTop: 10 }}>
                <Segmented<number> value={minutes} onChange={setMinutes} options={(t.kind === 'daily' ? [1440, 2880, 4320] : [30, 60, 120, 240]).filter((m) => m >= t.minMinutes && m <= t.maxMinutes).map((m) => ({ v: m, t: m >= 1440 ? `${m / 1440} сут` : m >= 60 ? `${m / 60} ч` : `${m} мин` }))} />
              </div>)}
          </Card>)}
        <Card>
          <div style={{ fontWeight: 800, color: C.t1, marginBottom: 8 }}>Машина</div>
          {vehicles.length === 0 ? <Notice tone="warn">Сначала добавьте машину на вкладке «Авто».</Notice> : (
            <select aria-label="Машина" value={vid} onChange={(e) => setVeh(e.target.value)} style={{ width: '100%', height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 12px', fontSize: 15 }}>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}{v.label ? ` · ${v.label}` : ''}</option>)}</select>)}
        </Card>
        <Card style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: C.t2 }}>К оплате (считает сервер)</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: C.t1 }}>{q?.ok ? `${fmt(q.data!.costRub)} ₽` : '—'}</div>
          {q && !q.ok && <div style={{ fontSize: 13, color: C.red }}>{q.error === 'duration_too_long' ? 'Больше максимального срока' : 'Проверьте срок'}</div>}
        </Card>
        <Btn busy={busy} disabled={!q?.ok || !vid || !tariffId} onClick={pay}>Оплатить с кошелька Sky</Btn>
        <Notice>Оплата списывается с кошелька Sky. Организации деньги отдельно не выплачиваются через Sky — это учёт оплат. Штрафов и эвакуации Sky не оформляет.</Notice>
        <Btn kind="soft" onClick={() => setRep(!rep)}>Сообщить о проблеме с парковкой</Btn>
        {rep && <ReportForm lotId={lot.id} onDone={() => setRep(false)} />}
      </Col>
    </>
  );
};

const ReportForm = ({ lotId, onDone }: { lotId: string; onDone: () => void }) => {
  const [reason, setReason] = useState('wrong_info'); const [note, setNote] = useState('');
  return (
    <Card><Col>
      <select aria-label="Причина" value={reason} onChange={(e) => setReason(e.target.value)} style={{ height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 12px' }}>
        {[['wrong_info', 'Неверные сведения'], ['closed', 'Парковка закрыта'], ['unsafe', 'Небезопасно'], ['price', 'Цена не совпадает'], ['other', 'Другое']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
      <Input label="Подробности" value={note} onChange={setNote} area max={400} />
      <Btn onClick={async () => { const r = await pk.report(lotId, reason, note); if (!r.ok) return fail(r); flash('Жалоба отправлена'); onDone(); }}>Отправить</Btn>
    </Col></Card>
  );
};

const Sessions = () => {
  const [r, reload] = useLoad(() => pk.sessions(), [], 20000);
  const [ext, setExt] = useState<string | null>(null);
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Не удалось загрузить сессии." onRetry={reload} />;
  const list = r.data!.sessions;
  if (!list.length) return <Empty text="Парковок пока не было" hint="Найдите парковку, выберите тариф и оплатите с кошелька Sky." />;
  return (
    <Col gap={10}>{list.map((s) => (
      <Card key={s.id}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{s.lotTitle}</div>
          <Chip color={s.status === 'active' ? GO : C.t3}>{s.status === 'active' ? 'Идёт' : s.status === 'cancelled' ? 'Отменена' : 'Закончилась'}</Chip>
        </div>
        <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{s.plate} · {s.address}</div>
        <div style={{ fontSize: 13, color: C.t2, marginTop: 4 }}>{hhmm(s.startsAt)} — {hhmm(s.endsAt)} · оплачено {fmt(s.paidRub)} ₽{s.status === 'active' ? ` · осталось ${dur(s.secondsLeft)}` : ''}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {s.status === 'active' && s.tariff.kind !== 'flat' && <Btn kind="soft" onClick={() => setExt(ext === s.id ? null : s.id)}>Продлить</Btn>}
          {s.payments?.filter((p) => p.status === 'paid' && p.amountRub > 0 && !p.refund).slice(0, 1).map((p) => <RefundBtn key={p.id} id={p.id} onDone={reload} />)}
          {s.payments?.some((p) => p.refund === 'requested') && <Chip color={C.amber}>Возврат на рассмотрении</Chip>}
          {s.payments?.some((p) => p.refund === 'rejected') && <Chip color={C.red}>Возврат отклонён</Chip>}
        </div>
        {ext === s.id && <Extend s={s} onDone={() => { setExt(null); reload(); }} />}
      </Card>))}
    </Col>
  );
};

const Extend = ({ s, onDone }: { s: PkSession; onDone: () => void }) => {
  const [m, setM] = useState(60);
  const [q] = useLoad(() => pk.extendQuote(s.id, m), [m]);
  const [idem] = useState(newIdem); const [busy, setBusy] = useState(false);
  return (
    <Col gap={8}>
      <div style={{ height: 8 }} />
      <Segmented<number> value={m} onChange={setM} options={[{ v: 30, t: '30 мин' }, { v: 60, t: '1 ч' }, { v: 120, t: '2 ч' }]} />
      <div style={{ fontSize: 14, color: C.t1 }}>Продление: <b>{q?.ok ? `${fmt(q.data!.costRub)} ₽` : '—'}</b>{q && !q.ok ? ` (${q.error === 'duration_too_long' ? 'больше максимума по тарифу' : 'нельзя'})` : ''}</div>
      <Btn busy={busy} disabled={!q?.ok} onClick={async () => { setBusy(true); const r = await pk.extend(s.id, m, idem); setBusy(false); if (!r.ok) return fail(r); flash('Парковка продлена'); onDone(); }}>Оплатить продление</Btn>
    </Col>
  );
};

const RefundBtn = ({ id, onDone }: { id: string; onDone: () => void }) => {
  const [open, setOpen] = useState(false); const [why, setWhy] = useState('');
  if (!open) return <Btn kind="soft" onClick={() => setOpen(true)}>Запросить возврат</Btn>;
  return (
    <div style={{ width: '100%' }}><Col>
      <Input label="Причина возврата" value={why} onChange={setWhy} area max={400} />
      <Btn onClick={async () => { const r = await pk.refund(id, why); if (!r.ok) return fail(r); flash('Запрос отправлен организации'); onDone(); }}>Отправить запрос</Btn>
      <Notice>Решает организация или администрация Sky; деньги вернутся на кошелёк после одобрения.</Notice>
    </Col></div>
  );
};

const Cars = () => {
  const [r, reload] = useLoad(() => pk.vehicles(), []);
  const [plate, setPlate] = useState(''); const [label, setLabel] = useState('');
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Не удалось загрузить машины." onRetry={reload} />;
  return (
    <Col gap={10}>
      {r.data!.vehicles.map((v) => (
        <Card key={v.id}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div translate="no" style={{ flex: 1, fontWeight: 800, color: C.t1 }}>{v.plate}<span style={{ fontWeight: 500, color: C.t2 }}>{v.label ? ` · ${v.label}` : ''}</span></div>
          <button type="button" aria-label="Удалить машину" onClick={async () => { const x = await pk.delVehicle(v.id); if (!x.ok) return fail(x); reload(); }} style={{ width: 44, height: 44, border: 'none', background: C.l2, borderRadius: 12, color: C.red }}><Trash2 size={18} /></button>
        </div></Card>))}
      <Card><Col>
        <Input label="Госномер" value={plate} onChange={setPlate} placeholder="А123ВС77" max={12} />
        <Input label="Подпись (необязательно)" value={label} onChange={setLabel} max={40} />
        <Btn onClick={async () => { const x = await pk.addVehicle(plate, label); if (!x.ok) return fail(x); setPlate(''); setLabel(''); reload(); }}><Plus size={16} /> Добавить машину</Btn>
        <Notice>Номер хранится в зашифрованном виде и виден только вам и организации, у которой вы оплатили парковку.</Notice>
      </Col></Card>
    </Col>
  );
};

/* ─── Кабинет организации ─── */
const OrgCabinet = () => {
  const [r, reload] = useLoad(() => pk.orgs(), []);
  const [org, setOrg] = useState<PkOrg | null>(null);
  const [name, setName] = useState('');
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Не удалось загрузить организации." onRetry={reload} />;
  if (org) return <OrgScreen org={org} onBack={() => { setOrg(null); reload(); }} />;
  return (
    <Col gap={10}>
      <Notice>Здесь парковки публикуют организации и владельцы площадок. Карточку проверяет администрация Sky (вручную, реестры не сверяются), после этого она появляется в поиске.</Notice>
      {r.data!.orgs.map((o) => (
        <Card key={o.id} onClick={() => setOrg(o)}>
          <div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{o.name}</div>
          <div style={{ fontSize: 13, color: C.t2 }}>{o.role === 'owner' ? 'Владелец' : o.role === 'admin' ? 'Администратор' : 'Модератор'} · парковок: {o.lots}{o.status === 'suspended' ? ' · приостановлена' : ''}</div>
          {o.suspendReason && <div style={{ fontSize: 12.5, color: C.red }}>{o.suspendReason}</div>}
        </Card>))}
      <Card><Col>
        <Input label="Новая организация" value={name} onChange={setName} placeholder="Название" max={100} />
        <Btn onClick={async () => { const x = await pk.createOrg(name); if (!x.ok) return fail(x); setName(''); reload(); }}>Создать</Btn>
      </Col></Card>
    </Col>
  );
};

type OrgTab = 'lots' | 'sessions' | 'refunds' | 'staff';
const OrgScreen = ({ org, onBack }: { org: PkOrg; onBack: () => void }) => {
  const [tab, setTab] = useState<OrgTab>('lots');
  const mgr = org.role !== 'moderator';
  return (
    <Col gap={10}>
      <Back onClick={onBack} title={org.name} />
      <Segmented<OrgTab> value={tab} onChange={setTab} options={mgr ? [{ v: 'lots', t: 'Парковки' }, { v: 'sessions', t: 'Сессии' }, { v: 'refunds', t: 'Возвраты' }, { v: 'staff', t: 'Команда' }] : [{ v: 'lots', t: 'Парковки' }]} />
      {tab === 'lots' && <OrgLots org={org} />}
      {tab === 'sessions' && <OrgSessions org={org} />}
      {tab === 'refunds' && <OrgRefunds org={org} />}
      {tab === 'staff' && <OrgStaff org={org} />}
    </Col>
  );
};

const OrgLots = ({ org }: { org: PkOrg }) => {
  const [r, reload] = useLoad(() => pk.orgLots(org.id), [org.id]);
  const [edit, setEdit] = useState<PkLot | 'new' | null>(null);
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Не удалось загрузить парковки." onRetry={reload} />;
  if (edit) return <LotEditor org={org} lot={edit === 'new' ? null : edit} onDone={() => { setEdit(null); reload(); }} />;
  return (
    <Col gap={10}>
      {r.data!.lots.filter((l) => l.status !== 'archived').map((l) => (
        <Card key={l.id} onClick={() => setEdit(l)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{l.title}</div><Chip color={l.status === 'approved' ? GO : l.status === 'rejected' || l.status === 'suspended' ? C.red : C.t3}>{LOT_STATUS[l.status]}</Chip></div>
          <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{l.address}</div>
          {l.rejectReason && <div style={{ fontSize: 12.5, color: C.red, marginTop: 4 }}>Причина: {l.rejectReason}</div>}
        </Card>))}
      {org.role !== 'moderator' && <Btn onClick={() => setEdit('new')}><Plus size={16} /> Добавить парковку</Btn>}
    </Col>
  );
};

const LotEditor = ({ org, lot, onDone }: { org: PkOrg; lot: PkLot | null; onDone: () => void }) => {
  const [f, setF] = useState({ title: lot?.title ?? '', city: lot?.city ?? '', address: lot?.address ?? '', lat: lot?.lat != null ? String(lot.lat) : '', lng: lot?.lng != null ? String(lot.lng) : '', spacesTotal: String(lot?.spacesTotal ?? ''), hours: lot?.hours ?? '', description: lot?.description ?? '' });
  const [id, setId] = useState(lot?.id ?? '');
  const [cur, reloadCur] = useLoad(() => pk.orgLots(org.id), [org.id]);
  const fresh = cur?.ok ? cur.data!.lots.find((l) => l.id === id) ?? lot : lot;
  const [t, setT] = useState({ kind: 'hourly', priceRub: '', freeMinutes: '0', minMinutes: '15', maxMinutes: '1440' });
  const mod = org.role === 'moderator';
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const payload = () => ({ ...f, lat: f.lat === '' ? undefined : Number(f.lat.replace(',', '.')), lng: f.lng === '' ? undefined : Number(f.lng.replace(',', '.')), spacesTotal: Number(f.spacesTotal) });
  const save = async () => {
    if (!id) { const r = await pk.createLot(org.id, payload()); if (!r.ok) return fail(r); setId(r.data!.id); flash('Сохранено — добавьте тариф'); reloadCur(); return; }
    const p: any = payload(); if (mod) { delete p.lat; delete p.lng; delete p.spacesTotal; }
    const r = await pk.saveLot(id, p); if (!r.ok) return fail(r);
    flash(r.data?.status === 'draft' && fresh?.status === 'approved' ? 'Сохранено — парковка снова на проверке перед показом' : 'Сохранено'); reloadCur();
  };
  const geo = () => navigator.geolocation?.getCurrentPosition((p) => setF({ ...f, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }), () => flash('Не удалось определить место'));
  return (
    <Col gap={10}>
      <Back onClick={onDone} title={lot ? 'Парковка' : 'Новая парковка'} />
      {fresh?.status === 'approved' && <Notice>Парковка опубликована. Изменение названия, адреса, точки, числа мест, описания или тарифа скроет её до новой проверки.</Notice>}
      <Input label="Название" value={f.title} onChange={set('title')} max={120} />
      <Input label="Город" value={f.city} onChange={set('city')} max={80} />
      <Input label="Адрес" value={f.address} onChange={set('address')} max={240} />
      {!mod && <><div style={{ display: 'flex', gap: 8 }}><Input label="Широта" value={f.lat} onChange={set('lat')} /><Input label="Долгота" value={f.lng} onChange={set('lng')} /></div>
        <Btn kind="soft" onClick={geo}>Взять мою текущую точку</Btn>
        <Input label="Число мест" type="number" value={f.spacesTotal} onChange={set('spacesTotal')} /></>}
      <Input label="Часы работы" value={f.hours} onChange={set('hours')} max={120} />
      <Input label="Описание" value={f.description} onChange={set('description')} area max={1000} />
      <Btn onClick={save}>Сохранить</Btn>
      {id && fresh && <Card><Col>
        <div style={{ fontWeight: 800, color: C.t1 }}>Тарифы</div>
        {fresh.tariffs.map((x: PkTariff) => (
          <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ flex: 1, fontSize: 13.5, color: C.t1 }}>{KIND_LABEL[x.kind]}: {tariffText(x)} · {x.minMinutes}–{x.maxMinutes} мин</div>
            {!mod && <button type="button" aria-label="Удалить тариф" onClick={async () => { const r = await pk.delTariff(id, x.id); if (!r.ok) return fail(r); reloadCur(); }} style={{ width: 44, height: 44, border: 'none', background: C.l2, borderRadius: 12, color: C.red }}><Trash2 size={16} /></button>}</div>))}
        {!mod && <>
          <Segmented<string> value={t.kind} onChange={(v) => setT({ ...t, kind: v })} options={[{ v: 'hourly', t: 'Час' }, { v: 'daily', t: 'Сутки' }, { v: 'flat', t: 'Разово' }]} />
          <Input label="Цена, ₽" type="number" value={t.priceRub} onChange={(v) => setT({ ...t, priceRub: v })} />
          {t.kind === 'hourly' && <Input label="Бесплатно, минут" type="number" value={t.freeMinutes} onChange={(v) => setT({ ...t, freeMinutes: v })} />}
          <div style={{ display: 'flex', gap: 8 }}><Input label="Мин. срок, мин" type="number" value={t.minMinutes} onChange={(v) => setT({ ...t, minMinutes: v })} /><Input label="Макс. срок, мин" type="number" value={t.maxMinutes} onChange={(v) => setT({ ...t, maxMinutes: v })} /></div>
          <Btn kind="soft" onClick={async () => { const r = await pk.addTariff(id, { kind: t.kind, priceRub: Number(t.priceRub), freeMinutes: Number(t.freeMinutes), minMinutes: Number(t.minMinutes), maxMinutes: Number(t.maxMinutes) }); if (!r.ok) return fail(r); setT({ ...t, priceRub: '' }); reloadCur(); }}>Добавить тариф</Btn></>}
      </Col></Card>}
      {id && fresh && ['draft', 'rejected'].includes(fresh.status) && <Btn onClick={async () => { const r = await pk.submitLot(id); if (!r.ok) return fail(r); flash('Отправлено на проверку'); onDone(); }}>Отправить на проверку</Btn>}
      {id && !mod && <Btn kind="danger" onClick={async () => { if (!window.confirm('Убрать парковку в архив?')) return; const r = await pk.archiveLot(id); if (!r.ok) return fail(r); onDone(); }}>В архив</Btn>}
    </Col>
  );
};

const OrgSessions = ({ org }: { org: PkOrg }) => {
  const [r, reload] = useLoad(() => pk.orgSessions(org.id), [org.id], 30000);
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Недостаточно прав или нет связи." onRetry={reload} />;
  const { sessions, totals } = r.data!;
  return (
    <Col gap={8}>
      <Card><div style={{ fontSize: 13, color: C.t2 }}>Оплачено через Sky: <b style={{ color: C.t1 }}>{fmt(totals.paidRub)} ₽</b> · возвращено: <b style={{ color: C.t1 }}>{fmt(totals.refundedRub)} ₽</b></div><div style={{ fontSize: 12, color: C.t3, marginTop: 4 }}>{totals.note}</div></Card>
      {sessions.length === 0 && <Empty text="Сессий нет" />}
      {sessions.map((s) => <Card key={s.id}><div style={{ display: 'flex', justifyContent: 'space-between' }}><b translate="no" style={{ color: C.t1 }}>{s.plate}</b><Chip color={s.status === 'active' ? GO : C.t3}>{s.status === 'active' ? 'Идёт' : s.status === 'cancelled' ? 'Отменена' : 'Закончилась'}</Chip></div><div translate="no" style={{ fontSize: 13, color: C.t2 }}>{s.lotTitle} · до {hhmm(s.endsAt)} · {fmt(s.paidRub)} ₽</div></Card>)}
    </Col>
  );
};

const OrgRefunds = ({ org }: { org: PkOrg }) => {
  const [r, reload] = useLoad(() => pk.orgRefunds(org.id), [org.id]);
  const [note, setNote] = useState('');
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Недостаточно прав или нет связи." onRetry={reload} />;
  if (!r.data!.refunds.length) return <Empty text="Запросов на возврат нет" />;
  return (
    <Col gap={8}>
      <Input label="Комментарий к решению (при отказе — обязательно)" value={note} onChange={setNote} max={400} />
      {r.data!.refunds.map((x) => (
        <Card key={x.id}><b style={{ color: C.t1 }}>{fmt(x.amountRub)} ₽</b> · <span translate="no" style={{ color: C.t2 }}>{x.lotTitle}</span>
          <div translate="no" style={{ fontSize: 13, color: C.t1, margin: '4px 0' }}>{x.reason}</div>
          {x.own ? <Notice>Свой запрос решить нельзя — его рассмотрит другой сотрудник.</Notice> : (
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={async () => { const d = await pk.decideRefund(x.id, 'approve', note); if (!d.ok) return fail(d); flash('Возврат зачислен на кошелёк'); reload(); }}>Вернуть</Btn>
              <Btn kind="danger" onClick={async () => { const d = await pk.decideRefund(x.id, 'reject', note); if (!d.ok) return fail(d); reload(); }}>Отказать</Btn>
            </div>)}
        </Card>))}
    </Col>
  );
};

const OrgStaff = ({ org }: { org: PkOrg }) => {
  const [r, reload] = useLoad(() => pk.staff(org.id), [org.id]);
  const [u, setU] = useState(''); const [role, setRole] = useState('moderator');
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Недостаточно прав или нет связи." onRetry={reload} />;
  return (
    <Col gap={8}>
      {r.data!.staff.map((s) => <Card key={s.profileId}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div translate="no" style={{ flex: 1, color: C.t1 }}><b>@{s.username}</b> · {s.role === 'admin' ? 'администратор' : 'модератор'}</div>
        <button type="button" aria-label="Убрать" onClick={async () => { const x = await pk.delStaff(org.id, s.profileId); if (!x.ok) return fail(x); reload(); }} style={{ width: 44, height: 44, border: 'none', background: C.l2, borderRadius: 12, color: C.red }}><Trash2 size={16} /></button></div></Card>)}
      <Card><Col>
        <Input label="Ник сотрудника" value={u} onChange={setU} placeholder="@ник" />
        <Segmented<string> value={role} onChange={setRole} options={[{ v: 'moderator', t: 'Модератор' }, ...(org.role === 'owner' ? [{ v: 'admin', t: 'Администратор' }] : [])]} />
        <Btn onClick={async () => { const x = await pk.addStaff(org.id, u, role); if (!x.ok) return fail(x); setU(''); reload(); }}>Добавить</Btn>
        <Notice>Модератор правит описание и часы и отправляет парковку на проверку. Тарифы, точку и число мест меняет администратор или владелец.</Notice>
      </Col></Card>
    </Col>
  );
};

/** Кабинет владельца парковки — открывается из «Работа» в Sky GO. */
export const ParkingOwnerScreen = ({ onBack }: { onBack: () => void }) => (
  <>
    <Back onClick={onBack} title="Владелец парковки" />
    <OrgCabinet />
  </>
);

export const ParkingTileIcon = ParkingCircle;
