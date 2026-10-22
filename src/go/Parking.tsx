/** Sky GO → Парковки: поиск на карте, оплата переводом по реквизитам организации (SkyKassa Business), мои сессии и машины; кабинет организации. */
import { useState } from 'react';
import { ParkingCircle, MapPin, Clock, Plus, Trash2 } from 'lucide-react';
import { SkyMap } from '@/marketplace/logistics/SkyMap';
import { flash } from '@/shared/flash';
import { pk, newIdem, KIND_LABEL, LOT_STATUS, tariffText, type PkLot, type PkOrg, type PkSession, type PkTariff } from './parkingApi';
import { Back, Btn, Card, Chip, Col, Empty, ErrorState, Input, Notice, Segmented, fail, useAction, useLoad, C, GO, fmt } from './ui';

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

const kmBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371; const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const cheapest = (l: PkLot) => (l.tariffs.length ? Math.min(...l.tariffs.map((t) => t.priceRub)) : null);

const Find = ({ city, onOpen }: { city: string; onOpen: (l: PkLot) => void }) => {
  const [r, reload] = useLoad(() => pk.lots(city), [city]);
  const [q, setQ] = useState(''); const [maxPrice, setMaxPrice] = useState(''); const [onlyPay, setOnlyPay] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Не удалось загрузить парковки." onRetry={reload} />;
  const all = r.data!.lots;
  const text = q.trim().toLowerCase(); const cap = Number(maxPrice);
  const lots = all.filter((l) => (!text || `${l.title} ${l.address}`.toLowerCase().includes(text)) && (!maxPrice || !Number.isFinite(cap) || (cheapest(l) ?? Infinity) <= cap) && (!onlyPay || (l.acceptsPayment !== false && !l.closed)));
  const withPos = lots.filter((l) => l.lat != null && l.lng != null);
  const points = withPos.map((l) => ({ id: l.id, pos: { lat: l.lat!, lng: l.lng! }, label: l.title, highlight: l.id === sel }));
  const picked = lots.find((l) => l.id === sel) ?? null;
  const pickNearest = (p: { lat: number; lng: number }) => {
    let best: PkLot | null = null; let d = Infinity;
    for (const l of withPos) { const x = kmBetween(p, { lat: l.lat!, lng: l.lng! }); if (x < d) { d = x; best = l; } }
    if (best) setSel(best.id);
  };
  return (
    <Col gap={10}>
      <Input label="Поиск по названию или адресу" value={q} onChange={setQ} placeholder="Например, Тверская" />
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <Input label="Цена до, ₽" type="number" value={maxPrice} onChange={setMaxPrice} placeholder="любая" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.t1, minHeight: 46, flexShrink: 0 }}><input type="checkbox" checked={onlyPay} onChange={(e) => setOnlyPay(e.target.checked)} /> Можно оплатить</label>
      </div>
      {withPos.length > 0
        ? <div style={{ borderRadius: 22, overflow: 'hidden', border: `1px solid ${C.brd}` }}><SkyMap points={points} height={240} onPick={pickNearest} /></div>
        : lots.length > 0 && <Notice tone="warn">У найденных парковок не указаны координаты — на карту их поставить нельзя, список ниже работает.</Notice>}
      {withPos.length > 0 && <div style={{ fontSize: 12, color: C.t3 }}>Нажмите на карту — выберем ближайшую парковку.</div>}
      {picked && (
        <Card style={{ borderColor: GO }}>
          <div translate="no" style={{ fontWeight: 900, fontSize: 17, color: C.t1 }}>{picked.title}</div>
          <div translate="no" style={{ fontSize: 13.5, color: C.t2 }}><MapPin size={13} style={{ verticalAlign: -2 }} /> {picked.city ? `${picked.city}, ` : ''}{picked.address}</div>
          {picked.hours && <div translate="no" style={{ fontSize: 13, color: C.t2 }}><Clock size={13} style={{ verticalAlign: -2 }} /> {picked.hours}</div>}
          <div style={{ fontSize: 13.5, color: GO, fontWeight: 700, marginTop: 4 }}>{picked.tariffs.length ? picked.tariffs.map(tariffText).join(' · ') : 'Тариф не указан'}</div>
          {picked.closed && <div style={{ fontSize: 13, color: C.amber, marginTop: 4 }}>Парковка закрыта для новых парковок{picked.closedReason ? `: ${picked.closedReason}` : ''}.</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Btn onClick={() => onOpen(picked)}>Открыть парковку</Btn>
            {picked.lat != null && picked.lng != null && <>
              <Btn kind="soft" onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${picked.lat},${picked.lng}`, '_blank', 'noopener')}>Маршрут (Google)</Btn>
              <Btn kind="soft" onClick={() => window.open(`https://yandex.ru/maps/?rtext=~${picked.lat},${picked.lng}&rtt=auto`, '_blank', 'noopener')}>Маршрут (Яндекс)</Btn></>}
          </div>
        </Card>)}
      {lots.length === 0 && <Empty text={all.length ? 'Ничего не найдено' : 'В этом городе пока нет парковок'} hint={all.length ? 'Измените поиск или цену.' : 'Здесь появляются только парковки, проверенные администрацией Sky.'} />}
      {lots.map((l) => (
        <Card key={l.id} onClick={() => setSel(l.id)} style={l.id === sel ? { borderColor: GO } : undefined}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div translate="no" style={{ fontWeight: 800, fontSize: 16, color: C.t1 }}>{l.title}</div>{l.closed && <Chip color={C.amber}>Закрыта</Chip>}</div>
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
    if (r.data!.pending && r.data!.payUrl) { window.open(r.data!.payUrl, '_blank', 'noopener'); flash('Переведите деньги по реквизитам организации — парковка включится после её подтверждения'); }
    else flash('Парковка включена');
    onPaid();
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
        {lot.closed && <Notice tone="warn">Парковка закрыта для новых парковок{lot.closedReason ? `: ${lot.closedReason}` : ''}.</Notice>}
        {!lot.closed && lot.acceptsPayment === false && <Notice tone="warn">Организация пока не подключила приём оплаты — начать парковку здесь нельзя.</Notice>}
        <Btn busy={busy} disabled={!q?.ok || !vid || !tariffId || lot.acceptsPayment === false || lot.closed} onClick={pay}>Оплатить по реквизитам организации</Btn>
        <Notice>Sky деньги за парковку не принимает: вы переводите их организации по её реквизитам, затем нажимаете «Я перевёл». Парковка включается, когда организация подтвердит поступление. Штрафов и эвакуации Sky не оформляет.</Notice>
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
  const [limit, setLimit] = useState(20);
  const [r, reload] = useLoad(() => pk.sessionsPage(limit, 0), [limit], 20000);
  const [ext, setExt] = useState<string | null>(null);
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Не удалось загрузить сессии." onRetry={reload} />;
  const list = r.data!.sessions;
  if (!list.length) return <Empty text="Парковок пока не было" hint="Найдите парковку, выберите тариф и оплатите по реквизитам организации." />;
  const live = list.filter((s) => s.status === 'active' || s.status === 'awaiting_payment');
  const render = (s: PkSession) => (
      <Card key={s.id}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{s.lotTitle}</div>
          <Chip color={s.status === 'active' ? GO : s.status === 'awaiting_payment' ? C.amber : C.t3}>{s.status === 'active' ? 'Идёт' : s.status === 'awaiting_payment' ? 'Ждёт оплаты' : s.status === 'cancelled' ? 'Отменена' : 'Закончилась'}</Chip>
        </div>
        <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{s.plate} · {s.address}</div>
        <div style={{ fontSize: 13, color: C.t2, marginTop: 4 }}>{hhmm(s.startsAt)} — {hhmm(s.endsAt)} · оплачено {fmt(s.paidRub)} ₽{s.status === 'active' ? ` · осталось ${dur(s.secondsLeft)}` : ''}</div>
        {s.status === 'active' && <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>Мы напомним за 15 и за 5 минут до окончания.</div>}
        {s.payments?.filter((p) => p.status === 'pending' && p.payUrl).map((p) => (
          <div key={p.id} style={{ marginTop: 8 }}>
            <Notice>Переведите {fmt(p.amountRub)} ₽ по реквизитам организации{p.payBy ? ` до ${hhmm(p.payBy)}` : ''}. Парковка включится после подтверждения поступления.</Notice>
            <div style={{ marginTop: 8 }}><Btn onClick={() => window.open(p.payUrl, '_blank', 'noopener')}>Открыть реквизиты и страницу оплаты</Btn></div>
          </div>))}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {s.status === 'active' && s.tariff.kind !== 'flat' && <Btn kind="soft" onClick={() => setExt(ext === s.id ? null : s.id)}>Продлить</Btn>}
          {s.payments?.filter((p) => p.status === 'paid' && p.amountRub > 0 && !p.refund).slice(0, 1).map((p) => <RefundBtn key={p.id} id={p.id} onDone={reload} />)}
          {s.payments?.some((p) => p.refund === 'requested') && <Chip color={C.amber}>Возврат на рассмотрении</Chip>}
          {s.payments?.some((p) => p.refund === 'rejected') && <Chip color={C.red}>Возврат отклонён</Chip>}
        </div>
        {ext === s.id && <Extend s={s} onDone={() => { setExt(null); reload(); }} />}
      </Card>);
  return (
    <Col gap={10}>
      {live.length > 0 && <div style={{ fontWeight: 800, color: C.t1 }}>Сейчас</div>}
      {live.map(render)}
      <div style={{ fontWeight: 800, color: C.t1 }}>История</div>
      {list.filter((s) => !live.includes(s)).map(render)}
      {r.data!.hasMore && <Btn kind="soft" onClick={() => setLimit(limit + 20)}>Показать ещё</Btn>}
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
      <Btn busy={busy} disabled={!q?.ok} onClick={async () => { setBusy(true); const r = await pk.extend(s.id, m, idem); setBusy(false); if (!r.ok) return fail(r); if (r.data?.payUrl) window.open(r.data.payUrl, '_blank', 'noopener'); flash('Переведите деньги по реквизитам — продление включится после подтверждения организации'); onDone(); }}>Оплатить продление</Btn>
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
      <Notice>Решает организация или администрация Sky; возврат — договорённость с организацией: деньги Sky не возвращает, организация переводит сама.</Notice>
    </Col></div>
  );
};

const CarRow = ({ v, onChanged }: { v: { id: string; plate: string; label: string }; onChanged: () => void }) => {
  const [edit, setEdit] = useState(false); const [plate, setPlate] = useState(v.plate); const [label, setLabel] = useState(v.label);
  const [busy, run] = useAction();
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div translate="no" style={{ flex: 1, fontWeight: 800, color: C.t1 }}>{v.plate}<span style={{ fontWeight: 500, color: C.t2 }}>{v.label ? ` · ${v.label}` : ''}</span></div>
        <Btn kind="soft" onClick={() => { setEdit(!edit); setPlate(v.plate); setLabel(v.label); }}>{edit ? 'Отмена' : 'Изменить'}</Btn>
        <button type="button" aria-label="Удалить машину" onClick={async () => { if (!window.confirm(`Удалить машину ${v.plate}?`)) return; const x = await pk.delVehicle(v.id); if (!x.ok) return fail(x); flash('Машина удалена'); onChanged(); }} style={{ width: 44, height: 44, border: 'none', background: C.l2, borderRadius: 12, color: C.red }}><Trash2 size={18} /></button>
      </div>
      {edit && <Col gap={8}>
        <div style={{ height: 6 }} />
        <Input label="Госномер" value={plate} onChange={setPlate} max={12} />
        <Input label="Подпись" value={label} onChange={setLabel} max={40} />
        <Btn busy={busy} onClick={() => run(async () => { const x = await pk.updateVehicle(v.id, { plate, label }); if (!x.ok) return fail(x); flash('Сохранено'); setEdit(false); onChanged(); })}>Сохранить</Btn>
      </Col>}
    </Card>
  );
};

const Cars = () => {
  const [r, reload] = useLoad(() => pk.vehicles(), []);
  const [plate, setPlate] = useState(''); const [label, setLabel] = useState('');
  const [busy, run] = useAction();
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Не удалось загрузить машины." onRetry={reload} />;
  return (
    <Col gap={10}>
      {r.data!.vehicles.length === 0 && <Empty text="Машин пока нет" hint="Добавьте номер — он понадобится при оформлении парковки." />}
      {r.data!.vehicles.map((v) => <CarRow key={v.id} v={v} onChanged={reload} />)}
      <Card><Col>
        <Input label="Госномер" value={plate} onChange={setPlate} placeholder="А123ВС77" max={12} />
        <Input label="Подпись (необязательно)" value={label} onChange={setLabel} max={40} />
        <Btn busy={busy} disabled={plate.trim().length < 4} onClick={() => run(async () => { const x = await pk.addVehicle(plate, label); if (!x.ok) return fail(x); flash('Машина добавлена'); setPlate(''); setLabel(''); reload(); })}><Plus size={16} /> Добавить машину</Btn>
        <Notice>Номер хранится в зашифрованном виде и виден только вам и организации, у которой вы оплатили парковку. Менять номер можно, пока на машине нет активной парковки.</Notice>
      </Col></Card>
    </Col>
  );
};

export const ParkingTileIcon = ParkingCircle;
