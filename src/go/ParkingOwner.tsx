/** Sky GO → «Работа» → Парковки: кабинет организации — сводка, парковки и заявки, платежи, сессии, возвраты, команда, журнал. Решения и права — только на сервере. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Trash2, Check, X, Download, Search } from 'lucide-react';
import { SkyMap } from '@/marketplace/logistics/SkyMap';
import { apiGeocode } from '@/marketplace/logistics/mapsApi';
import { apiBlob } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { pk, KIND_LABEL, LOT_STATUS, tariffText, type PkLot, type PkOrg, type PkTariff, type PkStaff } from './parkingApi';
import { Back, Btn, Card, Chip, Col, Empty, ErrorState, Input, Notice, Segmented, fail, useLoad, useAction, C, GO, fmt } from './ui';

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const ACTION_TEXT: Record<string, string> = {
  lot_submitted: 'Отправлена на проверку', admin_approve: 'Одобрена и опубликована', admin_reject: 'Отклонена', admin_suspend: 'Приостановлена администрацией', admin_restore: 'Возвращена в черновик',
  submit_failed: 'Отправка не прошла: не хватало данных', lot_closed: 'Закрыта для новых парковок', lot_reopened: 'Открыта снова', lot_created: 'Создана', lot_updated: 'Изменена', lot_archived: 'Убрана в архив',
  tariff_added: 'Добавлен тариф', tariff_updated: 'Изменён тариф', tariff_removed: 'Удалён тариф', staff_set: 'Назначен сотрудник', staff_scope: 'Изменены права сотрудника', staff_removed: 'Сотрудник убран',
  org_created: 'Организация создана', org_suspended: 'Организация приостановлена', org_restored: 'Организация снова активна', payments_exported: 'Выгружен отчёт по платежам',
};
const STATUS_COLOR = (l: PkLot) => (l.closed ? C.amber : l.status === 'approved' ? GO : l.status === 'rejected' || l.status === 'suspended' ? C.red : l.status === 'review' ? C.amber : C.t3);
const statusText = (l: PkLot) => (l.closed ? 'Закрыта' : LOT_STATUS[l.status] ?? l.status);

/** Ряд кнопок-вкладок, который можно листать на узком экране. */
const TabRow = <T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) => (
  <div role="tablist" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
    {items.map(([k, t]) => (
      <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
        style={{ flex: '0 0 auto', minHeight: 40, padding: '0 14px', borderRadius: 999, border: `1px solid ${value === k ? GO : C.brd}`, background: value === k ? GO : C.l2, color: value === k ? '#fff' : C.t1, fontWeight: 700, fontSize: 13.5 }}>{t}</button>))}
  </div>
);
const Pager = ({ total, offset, limit, onChange }: { total: number; offset: number; limit: number; onChange: (o: number) => void }) => (total <= limit ? null : (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
    <Btn kind="soft" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}>Назад</Btn>
    <span style={{ fontSize: 13, color: C.t2 }}>{offset + 1}–{Math.min(total, offset + limit)} из {total}</span>
    <Btn kind="soft" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Дальше</Btn>
  </div>));
const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <Card style={{ padding: 12 }}><div style={{ fontSize: 12, color: C.t3 }}>{label}</div><div style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>{value}</div>{hint && <div style={{ fontSize: 11.5, color: C.t3 }}>{hint}</div>}</Card>
);

/* ─── Организации ─── */
const OrgCabinet = () => {
  const [r, reload] = useLoad(() => pk.orgs(), []);
  const [org, setOrg] = useState<PkOrg | null>(null);
  const [name, setName] = useState('');
  const [busy, run] = useAction();
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Не удалось загрузить организации." onRetry={reload} />;
  if (org) return <OrgScreen org={org} onBack={() => { setOrg(null); reload(); }} />;
  const create = () => run(async () => { const x = await pk.createOrg(name); if (!x.ok) return fail(x); flash('Организация создана'); setName(''); reload(); });
  return (
    <Col gap={10}>
      <Notice>Здесь парковки публикуют организации и владельцы площадок. Карточку проверяет администрация Sky (вручную, реестры не сверяются), после этого она появляется в поиске. Оплата идёт напрямую на ваши реквизиты через SkyKassa Business.</Notice>
      {r.data!.orgs.map((o) => (
        <Card key={o.id} onClick={() => setOrg(o)}>
          <div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{o.name}</div>
          <div style={{ fontSize: 13, color: C.t2 }}>{o.role === 'owner' ? 'Владелец' : o.role === 'admin' ? 'Администратор' : 'Модератор'} · парковок: {o.lots}{o.status === 'suspended' ? ' · приостановлена' : ''}</div>
          {o.suspendReason && <div style={{ fontSize: 12.5, color: C.red }}>{o.suspendReason}</div>}
        </Card>))}
      <Card><Col>
        <Input label="Новая организация" value={name} onChange={setName} placeholder="Название" max={100} />
        <Btn busy={busy} disabled={name.trim().length < 3} onClick={create}>Создать</Btn>
      </Col></Card>
    </Col>
  );
};

type OrgTab = 'home' | 'lots' | 'pay' | 'sessions' | 'refunds' | 'staff' | 'audit';
const OrgScreen = ({ org, onBack }: { org: PkOrg; onBack: () => void }) => {
  const mgr = org.role !== 'moderator';
  const [tab, setTab] = useState<OrgTab>(mgr ? 'home' : 'lots');
  const items: [OrgTab, string][] = mgr ? [['home', 'Обзор'], ['lots', 'Парковки'], ['pay', 'Платежи'], ['sessions', 'Сессии'], ['refunds', 'Возвраты'], ['staff', 'Команда'], ['audit', 'Журнал']] : [['lots', 'Парковки']];
  return (
    <Col gap={10}>
      <Back onClick={onBack} title={org.name} />
      {org.status === 'suspended' && <Notice tone="warn">Организация приостановлена администрацией Sky: {org.suspendReason || 'без указания причины'}. Действия недоступны.</Notice>}
      <TabRow<OrgTab> value={tab} onChange={setTab} items={items} />
      {tab === 'home' && <Dashboard org={org} onGo={setTab} />}
      {tab === 'lots' && <OrgLots org={org} />}
      {tab === 'pay' && <Payments org={org} />}
      {tab === 'sessions' && <OrgSessions org={org} />}
      {tab === 'refunds' && <OrgRefunds org={org} />}
      {tab === 'staff' && <OrgStaff org={org} />}
      {tab === 'audit' && <Audit org={org} />}
    </Col>
  );
};

/* ─── Сводка ─── */
const Dashboard = ({ org, onGo }: { org: PkOrg; onGo: (t: OrgTab) => void }) => {
  const [r, reload] = useLoad(() => pk.dashboard(org.id), [org.id], 30000);
  const [per, setPer] = useState<'day' | 'week' | 'month'>('week');
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Не удалось загрузить сводку." onRetry={reload} />;
  const d = r.data!; const m = d.money[per]; const max = Math.max(1, ...d.days.map((x) => x.sessions));
  return (
    <Col gap={10}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <Stat label="Парковок" value={d.lots.total} hint={`открыто ${d.lots.open} · закрыто ${d.lots.closed}`} />
        <Stat label="Идут сейчас" value={d.activeSessions} hint="активных сессий" />
        <Stat label="Пользователей" value={d.users.total} hint={`за 30 дней: ${d.users.last30}`} />
        <Stat label="На проверке" value={d.lots.byStatus.review ?? 0} hint={`черновиков ${d.lots.byStatus.draft ?? 0}`} />
      </div>
      <Segmented<'day' | 'week' | 'month'> value={per} onChange={setPer} options={[{ v: 'day', t: 'Сутки' }, { v: 'week', t: 'Неделя' }, { v: 'month', t: 'Месяц' }]} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <Stat label="Подтверждено" value={`${fmt(m.confirmedRub)} ₽`} hint={`платежей: ${m.confirmedCount}`} />
        <Stat label="Возвращено" value={`${fmt(m.refundedRub)} ₽`} />
        <Stat label="Ждёт подтверждения" value={`${fmt(m.pendingRub)} ₽`} hint="ещё не поступило" />
        <Stat label="Возвраты на решении" value={d.pendingRefunds} />
      </div>
      <Notice>{d.note}</Notice>
      <Card>
        <div style={{ fontWeight: 800, color: C.t1, marginBottom: 8 }}>Парковки за 14 дней</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 70 }} role="img" aria-label="Число парковочных сессий по дням">
          {d.days.map((x) => <div key={x.day} title={`${x.day}: ${x.sessions} сессий, ${x.rub} ₽`} style={{ flex: 1, height: `${Math.max(4, (x.sessions / max) * 100)}%`, background: x.sessions ? GO : C.brd, borderRadius: 4 }} />)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.t3, marginTop: 4 }}><span>{d.days[0]?.day.slice(5)}</span><span>{d.days[d.days.length - 1]?.day.slice(5)}</span></div>
      </Card>
      <Card><div style={{ fontWeight: 800, color: C.t1, marginBottom: 6 }}>Последние заявки и действия</div>
        {d.recent.length === 0 ? <div style={{ fontSize: 13, color: C.t3 }}>Пока ничего нет.</div> : d.recent.map((x) => (
          <div key={x.id} style={{ fontSize: 13, color: C.t2, padding: '3px 0' }}><b translate="no" style={{ color: C.t1 }}>{x.title ?? '—'}</b> · {ACTION_TEXT[x.action] ?? x.action} · {when(x.at)}</div>))}
        <div style={{ marginTop: 6 }}><Btn kind="soft" onClick={() => onGo('lots')}>Все парковки и заявки</Btn></div>
      </Card>
      {d.errors.length > 0 && <Card><div style={{ fontWeight: 800, color: C.red, marginBottom: 6 }}>Системные ошибки</div>
        {d.errors.map((e, i) => <div key={i} style={{ fontSize: 12.5, color: C.t2, padding: '2px 0' }}>{when(e.at)} · {e.scope} · {e.code}</div>)}</Card>}
    </Col>
  );
};

/* ─── Парковки и заявки ─── */
const LIMIT = 20;
const OrgLots = ({ org }: { org: PkOrg }) => {
  const [edit, setEdit] = useState<PkLot | 'new' | null>(null);
  const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [off, setOff] = useState(0);
  const [qd, setQd] = useState('');
  useEffect(() => { const t = setTimeout(() => { setQd(q.trim()); setOff(0); }, 350); return () => clearTimeout(t); }, [q]);
  const [r, reload] = useLoad(() => pk.lotsFiltered(org.id, { status, q: qd, limit: String(LIMIT), offset: String(off) }), [org.id, status, qd, off]);
  if (edit) return <LotEditor org={org} lot={edit === 'new' ? null : edit} onDone={() => { setEdit(null); reload(); }} />;
  const FILTERS: [string, string][] = [['', 'Все'], ['draft', 'Черновики'], ['review', 'На проверке'], ['approved', 'Опубликованы'], ['rejected', 'Отклонены'], ['suspended', 'Приостановлены'], ['archived', 'Архив']];
  return (
    <Col gap={10}>
      <div style={{ position: 'relative' }}><Input label="Поиск" value={q} onChange={setQ} placeholder="Название, адрес, город" /><Search size={16} style={{ position: 'absolute', right: 14, top: 36, color: C.t3 }} /></div>
      <TabRow<string> value={status} onChange={(v) => { setStatus(v); setOff(0); }} items={FILTERS} />
      {!r ? <Empty text="Загрузка…" /> : !r.ok ? <ErrorState text="Не удалось загрузить парковки." onRetry={reload} /> : (
        <>
          {r.data!.lots.length === 0 && <Empty text={qd || status ? 'Ничего не найдено' : 'Парковок пока нет'} hint={qd || status ? 'Измените поиск или фильтр.' : 'Добавьте первую: название, адрес, точка на карте, места и тариф.'} />}
          {r.data!.lots.map((l) => (
            <Card key={l.id} onClick={() => setEdit(l)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{l.title}</div><Chip color={STATUS_COLOR(l)}>{statusText(l)}</Chip></div>
              <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{l.city}{l.city && l.address ? ', ' : ''}{l.address}</div>
              <div style={{ fontSize: 12.5, color: C.t3, marginTop: 2 }}>Мест: {l.spacesTotal} · {l.tariffs.length ? tariffText(l.tariffs[0]) : 'нет тарифа'}</div>
              {l.rejectReason && <div style={{ fontSize: 12.5, color: C.red, marginTop: 4 }}>Причина: {l.rejectReason}</div>}
              {l.closed && l.closedReason && <div style={{ fontSize: 12.5, color: C.amber, marginTop: 4 }}>Закрыта: {l.closedReason}</div>}
            </Card>))}
          <Pager total={r.data!.total} offset={off} limit={LIMIT} onChange={setOff} />
        </>)}
      {org.role !== 'moderator' && org.status !== 'suspended' && <Btn onClick={() => setEdit('new')}><Plus size={16} /> Добавить парковку</Btn>}
    </Col>
  );
};

const Check_ = ({ ok, children }: { ok: boolean; children: ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: ok ? C.t1 : C.t2 }}>
    <span style={{ width: 20, height: 20, borderRadius: 10, display: 'grid', placeItems: 'center', background: ok ? GO : C.l2, color: ok ? '#fff' : C.t3 }}>{ok ? <Check size={13} /> : <X size={13} />}</span>{children}
  </div>
);

const LotEditor = ({ org, lot, onDone }: { org: PkOrg; lot: PkLot | null; onDone: () => void }) => {
  const [f, setF] = useState({ title: lot?.title ?? '', city: lot?.city ?? '', address: lot?.address ?? '', lat: lot?.lat != null ? String(lot.lat) : '', lng: lot?.lng != null ? String(lot.lng) : '', spacesTotal: lot?.spacesTotal ? String(lot.spacesTotal) : '', hours: lot?.hours ?? '', description: lot?.description ?? '' });
  const [id, setId] = useState(lot?.id ?? '');
  const [dirty, setDirty] = useState(false);
  const [cur, reloadCur] = useLoad(() => pk.lotsFiltered(org.id, { limit: '100' }), [org.id]);
  const fresh = (cur?.ok ? cur.data!.lots.find((l) => l.id === id) : null) ?? lot;
  const [t, setT] = useState({ kind: 'hourly', priceRub: '', freeMinutes: '0', minMinutes: '15', maxMinutes: '1440', minCostRub: '0' });
  const [editT, setEditT] = useState<string | null>(null);
  const [closeWhy, setCloseWhy] = useState('');
  const [busy, run] = useAction(); const [busyT, runT] = useAction(); const [busyGeo, runGeo] = useAction();
  const mod = org.role === 'moderator';
  const locked = fresh?.status === 'review' || fresh?.status === 'suspended' || fresh?.status === 'archived' || org.status === 'suspended';
  const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); setDirty(true); };
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));
  const payload = () => ({ ...f, lat: num(f.lat), lng: num(f.lng), spacesTotal: Number(f.spacesTotal) || 0 });
  const hasTariff = Boolean(fresh?.tariffs?.some((x) => x.active !== false));
  const coordsOk = Number.isFinite(num(f.lat)) && Number.isFinite(num(f.lng)) && !(num(f.lat) === 0 && num(f.lng) === 0);
  const checklist = { title: f.title.trim().length >= 3, address: f.address.trim().length > 0, coords: mod ? true : coordsOk, spaces: mod ? true : Number(f.spacesTotal) >= 1, tariff: hasTariff };
  const ready = Object.values(checklist).every(Boolean);

  const persist = async (): Promise<string | null> => {   // сохранить форму; вернуть id парковки или null при ошибке
    if (!id) { const r = await pk.createLot(org.id, payload()); if (!r.ok) { fail(r); return null; } setId(r.data!.id); setDirty(false); reloadCur(); return r.data!.id; }
    if (!dirty) return id;
    const p: Record<string, unknown> = payload(); if (mod) { delete p.lat; delete p.lng; delete p.spacesTotal; }
    const r = await pk.saveLot(id, p); if (!r.ok) { fail(r); return null; }
    setDirty(false); reloadCur(); return id;
  };
  const save = () => run(async () => {
    const wasNew = !id; const wasApproved = fresh?.status === 'approved';
    const pid = await persist(); if (!pid) return;
    flash(wasNew ? 'Сохранено — теперь добавьте тариф' : wasApproved ? 'Сохранено — парковка снова на проверке перед показом' : 'Сохранено');
  });
  const submit = () => run(async () => {
    const pid = await persist(); if (!pid) return;
    const p: Record<string, unknown> = payload(); if (mod) { delete p.lat; delete p.lng; delete p.spacesTotal; }
    const r = await pk.submitWith(pid, p);
    if (!r.ok) { fail(r); reloadCur(); return; }              // успех показываем только после ответа сервера
    flash(r.data?.already ? 'Заявка уже на проверке' : 'Заявка отправлена на проверку'); onDone();
  });
  const findOnMap = () => runGeo(async () => {
    const text = [f.city, f.address].filter(Boolean).join(', ');
    if (text.trim().length < 4) return flash('Сначала укажите город и адрес');
    const p = await apiGeocode(text);
    if (!p) return flash('Адрес не найден. Отметьте точку на карте или введите координаты вручную.');
    setF({ ...f, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }); setDirty(true); flash('Точка найдена — проверьте её на карте');
  });
  const here = () => navigator.geolocation?.getCurrentPosition((p) => { setF({ ...f, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }); setDirty(true); }, () => flash('Не удалось определить место'));
  const points = coordsOk ? [{ id: 'lot', pos: { lat: Number(f.lat.replace(',', '.')), lng: Number(f.lng.replace(',', '.')) }, label: f.title || 'Парковка' }] : [];
  const tariffBody = () => ({ kind: t.kind, priceRub: Number(t.priceRub), freeMinutes: Number(t.freeMinutes), minMinutes: Number(t.minMinutes), maxMinutes: Number(t.maxMinutes), minCostRub: Number(t.minCostRub) });
  const saveTariff = () => runT(async () => {
    if (!id) return flash('Сначала сохраните парковку');
    const r = editT ? await pk.updateTariff(id, editT, tariffBody()) : await pk.addTariff(id, tariffBody());
    if (!r.ok) return fail(r);
    flash(editT ? 'Тариф обновлён. Уже оплаченные парковки не меняются.' : 'Тариф добавлен'); setEditT(null); setT({ ...t, priceRub: '', minCostRub: '0' }); reloadCur();
  });
  const pickTariff = (x: PkTariff) => { setEditT(x.id); setT({ kind: x.kind, priceRub: String(x.priceRub), freeMinutes: String(x.freeMinutes), minMinutes: String(x.minMinutes), maxMinutes: String(x.maxMinutes), minCostRub: String(x.minCostRub ?? 0) }); };
  const leave = () => { if (dirty && !window.confirm('Есть несохранённые изменения. Выйти без сохранения?')) return; onDone(); };
  return (
    <Col gap={10}>
      <Back onClick={leave} title={lot ? 'Парковка' : 'Новая парковка'} />
      {fresh && <div><Chip color={STATUS_COLOR(fresh)}>{statusText(fresh)}</Chip></div>}
      {fresh?.status === 'rejected' && fresh.rejectReason && <Notice tone="warn">Отклонена: {fresh.rejectReason}. Исправьте и отправьте снова.</Notice>}
      {fresh?.status === 'review' && <Notice>Заявка на проверке — править её нельзя, пока администрация не решит.</Notice>}
      {fresh?.status === 'approved' && <Notice>Парковка опубликована. Изменение названия, адреса, точки, числа мест, описания или тарифа скроет её до новой проверки.</Notice>}
      <Input label="Название" value={f.title} onChange={set('title')} max={120} />
      <Input label="Город" value={f.city} onChange={set('city')} max={80} />
      <Input label="Адрес" value={f.address} onChange={set('address')} max={240} />
      {!mod && <>
        <div style={{ display: 'flex', gap: 8 }}><Btn kind="soft" busy={busyGeo} onClick={findOnMap} style={{ flex: 1 }}>Найти по адресу</Btn><Btn kind="soft" onClick={here} style={{ flex: 1 }}>Моя точка</Btn></div>
        <div style={{ display: 'flex', gap: 8 }}><Input label="Широта" value={f.lat} onChange={set('lat')} /><Input label="Долгота" value={f.lng} onChange={set('lng')} /></div>
        <div style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${C.brd}` }}>
          <SkyMap points={points} height={200} onPick={(p) => { setF({ ...f, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }); setDirty(true); }} />
        </div>
        <div style={{ fontSize: 12.5, color: C.t3 }}>{coordsOk ? 'Нажмите на карту, чтобы переставить точку.' : 'Укажите точку: «Найти по адресу», нажатие на карту или координаты вручную.'}</div>
        <Input label="Число мест" type="number" value={f.spacesTotal} onChange={set('spacesTotal')} />
      </>}
      <Input label="Часы работы" value={f.hours} onChange={set('hours')} max={120} />
      <Input label="Описание" value={f.description} onChange={set('description')} area max={1000} />
      <Btn busy={busy} disabled={locked || (!dirty && Boolean(id))} onClick={save}>{dirty || !id ? 'Сохранить' : 'Сохранено'}</Btn>

      {id && fresh && <Card><Col>
        <div style={{ fontWeight: 800, color: C.t1 }}>Тарифы</div>
        {fresh.tariffs.length === 0 && <div style={{ fontSize: 13, color: C.t3 }}>Тарифов нет — без тарифа заявку отправить нельзя.</div>}
        {fresh.tariffs.map((x: PkTariff) => (
          <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={() => !mod && !locked && pickTariff(x)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', fontSize: 13.5, color: C.t1, minHeight: 44 }}>
              {KIND_LABEL[x.kind]}: {tariffText(x)} · {x.minMinutes}–{x.maxMinutes} мин{x.minCostRub ? ` · от ${x.minCostRub} ₽` : ''}</button>
            {!mod && !locked && <button type="button" aria-label="Удалить тариф" onClick={async () => { if (!window.confirm('Удалить тариф?')) return; const r = await pk.delTariff(id, x.id); if (!r.ok) return fail(r); reloadCur(); }} style={{ width: 44, height: 44, border: 'none', background: C.l2, borderRadius: 12, color: C.red }}><Trash2 size={16} /></button>}
          </div>))}
        {!mod && !locked && <>
          <div style={{ fontSize: 12.5, color: C.t3 }}>{editT ? 'Правка тарифа. Оплаченные парковки сохраняют прежнюю цену.' : 'Новый тариф. Цену и сроки считает сервер, менять их из клиента нельзя.'}</div>
          <Segmented<string> value={t.kind} onChange={(v) => setT({ ...t, kind: v })} options={[{ v: 'hourly', t: 'Час' }, { v: 'daily', t: 'Сутки' }, { v: 'flat', t: 'Разово' }]} />
          <Input label={t.kind === 'hourly' ? 'Цена за час, ₽' : t.kind === 'daily' ? 'Цена за сутки, ₽' : 'Цена, ₽'} type="number" value={t.priceRub} onChange={(v) => setT({ ...t, priceRub: v })} />
          {t.kind === 'hourly' && <Input label="Бесплатно, минут" type="number" value={t.freeMinutes} onChange={(v) => setT({ ...t, freeMinutes: v })} />}
          <div style={{ display: 'flex', gap: 8 }}><Input label="Мин. срок, мин" type="number" value={t.minMinutes} onChange={(v) => setT({ ...t, minMinutes: v })} /><Input label="Макс. срок, мин" type="number" value={t.maxMinutes} onChange={(v) => setT({ ...t, maxMinutes: v })} /></div>
          {t.kind !== 'flat' && <Input label="Минимальная стоимость, ₽ (необязательно)" type="number" value={t.minCostRub} onChange={(v) => setT({ ...t, minCostRub: v })} />}
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="soft" busy={busyT} onClick={saveTariff} style={{ flex: 1 }}>{editT ? 'Сохранить тариф' : 'Добавить тариф'}</Btn>
            {editT && <Btn kind="soft" onClick={() => { setEditT(null); setT({ ...t, priceRub: '' }); }}>Отмена</Btn>}
          </div>
        </>}
      </Col></Card>}

      {!locked && fresh && ['draft', 'rejected'].includes(fresh.status) || !id ? (
        <Card><Col gap={6}>
          <div style={{ fontWeight: 800, color: C.t1 }}>Перед отправкой на проверку</div>
          <Check_ ok={checklist.title}>Название (от 3 знаков)</Check_>
          <Check_ ok={checklist.address}>Адрес</Check_>
          {!mod && <Check_ ok={checklist.coords}>Точка на карте</Check_>}
          {!mod && <Check_ ok={checklist.spaces}>Число мест</Check_>}
          <Check_ ok={checklist.tariff}>Хотя бы один тариф</Check_>
          <Btn busy={busy} disabled={!ready} onClick={submit}>Отправить на проверку</Btn>
          {!ready && <div style={{ fontSize: 12.5, color: C.t3 }}>Заполните недостающее — кнопка включится. Несохранённые правки сохранятся при отправке.</div>}
        </Col></Card>) : null}

      {fresh?.status === 'approved' && !mod && (
        <Card><Col gap={6}>
          <div style={{ fontWeight: 800, color: C.t1 }}>{fresh.closed ? 'Парковка закрыта для новых парковок' : 'Закрыть парковку'}</div>
          <div style={{ fontSize: 12.5, color: C.t3 }}>Начатые сессии доводятся до конца, история сохраняется.</div>
          {fresh.closed ? <Btn kind="soft" busy={busy} onClick={() => run(async () => { const r = await pk.reopenLot(id); if (!r.ok) return fail(r); flash('Парковка снова открыта'); reloadCur(); })}>Открыть снова</Btn> : <>
            <Input label="Причина (будет видна в журнале)" value={closeWhy} onChange={setCloseWhy} max={300} />
            <Btn kind="danger" busy={busy} disabled={closeWhy.trim().length < 5} onClick={() => run(async () => { const r = await pk.closeLot(id, closeWhy); if (!r.ok) return fail(r); flash('Парковка закрыта'); setCloseWhy(''); reloadCur(); })}>Закрыть</Btn></>}
        </Col></Card>)}
      {id && !mod && fresh?.status !== 'archived' && <Btn kind="danger" onClick={async () => { if (!window.confirm('Убрать парковку в архив? История сессий и платежей сохранится.')) return; const r = await pk.archiveLot(id); if (!r.ok) return fail(r); flash('Парковка в архиве'); onDone(); }}>В архив</Btn>}
      <LotHistory lotId={id} />
    </Col>
  );
};

const LotHistory = ({ lotId }: { lotId: string }) => {
  const [r] = useLoad(() => (lotId ? pk.lotEvents(lotId) : Promise.resolve(null)), [lotId]);
  if (!r || !r.ok || !r.data?.events?.length) return null;
  return <Card><div style={{ fontWeight: 800, color: C.t1, marginBottom: 6 }}>История заявки</div>{r.data.events.slice(0, 12).map((e) => (
    <div key={e.id} style={{ fontSize: 12.5, color: C.t2, padding: '2px 0' }}>{when(e.at)} · {ACTION_TEXT[e.action] ?? e.action}{(e.detail as { reason?: string })?.reason ? `: ${(e.detail as { reason?: string }).reason}` : ''}</div>))}</Card>;
};

/* ─── Платежи ─── */
const Payments = ({ org }: { org: PkOrg }) => {
  const [flt, setFlt] = useState({ status: '', lotId: '', from: '', to: '', min: '', max: '' });
  const [off, setOff] = useState(0);
  const lots = useLoad(() => pk.lotsFiltered(org.id, { limit: '100' }), [org.id])[0];
  const key = JSON.stringify(flt);
  const [r, reload] = useLoad(() => pk.payments(org.id, { ...Object.fromEntries(Object.entries(flt).filter(([, v]) => v)), limit: '20', offset: String(off) }), [org.id, key, off]);
  const [busy, run] = useAction();
  const upd = (k: keyof typeof flt) => (v: string) => { setFlt({ ...flt, [k]: v }); setOff(0); };
  const csv = () => run(async () => {
    const f = Object.fromEntries(Object.entries(flt).filter(([, v]) => v));
    const x = await apiBlob(pk.paymentsCsvUrl(org.id, f).replace(/^\/api/, '/api'));
    if (!x.ok || !x.blob) return flash('Не удалось выгрузить отчёт');
    const a = document.createElement('a'); a.href = URL.createObjectURL(x.blob); a.download = 'parking-payments.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  const ST: Record<string, [string, string]> = { paid: ['Подтверждён', GO], pending: ['Ждёт подтверждения', C.amber], refunded: ['Возвращён', C.t3], cancelled: ['Отменён', C.red] };
  return (
    <Col gap={10}>
      <Segmented<string> value={flt.status} onChange={upd('status')} options={[{ v: '', t: 'Все' }, { v: 'paid', t: 'Успешные' }, { v: 'pending', t: 'Ждут' }, { v: 'refunded', t: 'Возвраты' }, { v: 'cancelled', t: 'Неуспешные' }]} />
      <select aria-label="Парковка" value={flt.lotId} onChange={(e) => upd('lotId')(e.target.value)} style={{ height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 12px' }}>
        <option value="">Все парковки</option>{lots?.ok && lots.data!.lots.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select>
      <div style={{ display: 'flex', gap: 8 }}><Input label="С даты" type="date" value={flt.from} onChange={upd('from')} /><Input label="По дату" type="date" value={flt.to} onChange={upd('to')} /></div>
      <div style={{ display: 'flex', gap: 8 }}><Input label="Сумма от, ₽" type="number" value={flt.min} onChange={upd('min')} /><Input label="до, ₽" type="number" value={flt.max} onChange={upd('max')} /></div>
      {!r ? <Empty text="Загрузка…" /> : !r.ok ? <ErrorState text="Не удалось загрузить платежи." onRetry={reload} /> : (
        <>
          <Card><div style={{ fontSize: 13, color: C.t2 }}>Подтверждено: <b style={{ color: C.t1 }}>{fmt(r.data!.totals.confirmedRub)} ₽</b> · возвращено: <b style={{ color: C.t1 }}>{fmt(r.data!.totals.refundedRub)} ₽</b> · ждёт: <b style={{ color: C.t1 }}>{fmt(r.data!.totals.pendingRub)} ₽</b></div>
            <div style={{ fontSize: 12, color: C.t3, marginTop: 4 }}>{r.data!.note}</div></Card>
          {r.data!.payments.length === 0 && <Empty text="Платежей по этим условиям нет" />}
          {r.data!.payments.map((p) => (
            <Card key={p.id}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b style={{ color: C.t1 }}>{fmt(p.amountRub)} ₽</b><Chip color={ST[p.status]?.[1] ?? C.t3}>{ST[p.status]?.[0] ?? p.status}</Chip></div>
              <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{p.lotTitle}</div>
              <div style={{ fontSize: 12, color: C.t3 }}>{when(p.at)} · {p.kind === 'extend' ? 'продление' : 'старт'} · {p.minutes} мин · {p.payVia === 'kassa' ? 'SkyKassa Business' : p.payVia === 'wallet' ? 'кошелёк (прежний способ)' : p.payVia}{p.refund ? ` · возврат: ${p.refund}` : ''}</div></Card>))}
          <Pager total={r.data!.total} offset={off} limit={20} onChange={setOff} />
          <Btn kind="soft" busy={busy} onClick={csv}><Download size={16} /> Выгрузить CSV</Btn>
        </>)}
    </Col>
  );
};

/* ─── Сессии ─── */
const OrgSessions = ({ org }: { org: PkOrg }) => {
  const [st, setSt] = useState('');
  const [r, reload] = useLoad(() => pk.orgSessionsFiltered(org.id, st ? { status: st } : {}), [org.id, st], 30000);
  return (
    <Col gap={8}>
      <Segmented<string> value={st} onChange={setSt} options={[{ v: '', t: 'Недавние' }, { v: 'active', t: 'Идут' }, { v: 'awaiting_payment', t: 'Ждут оплаты' }, { v: 'ended', t: 'Закончены' }]} />
      {!r ? <Empty text="Загрузка…" /> : !r.ok ? <ErrorState text="Недостаточно прав или нет связи." onRetry={reload} /> : (
        <>
          <Card><div style={{ fontSize: 13, color: C.t2 }}>Подтверждено: <b style={{ color: C.t1 }}>{fmt(r.data!.totals.paidRub)} ₽</b> · возвращено: <b style={{ color: C.t1 }}>{fmt(r.data!.totals.refundedRub)} ₽</b></div><div style={{ fontSize: 12, color: C.t3, marginTop: 4 }}>{r.data!.totals.note}</div></Card>
          {r.data!.sessions.length === 0 && <Empty text="Сессий нет" />}
          {r.data!.sessions.map((s) => <Card key={s.id}><div style={{ display: 'flex', justifyContent: 'space-between' }}><b translate="no" style={{ color: C.t1 }}>{s.plate}</b><Chip color={s.status === 'active' ? GO : s.status === 'awaiting_payment' ? C.amber : C.t3}>{s.status === 'active' ? 'Идёт' : s.status === 'awaiting_payment' ? 'Ждёт оплаты' : s.status === 'cancelled' ? 'Отменена' : 'Закончилась'}</Chip></div>
            <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{s.lotTitle}</div><div style={{ fontSize: 12.5, color: C.t3 }}>{when(s.startsAt)} — {when(s.endsAt)} · {fmt(s.paidRub)} ₽</div></Card>)}
        </>)}
    </Col>
  );
};

/* ─── Возвраты ─── */
const OrgRefunds = ({ org }: { org: PkOrg }) => {
  const [r, reload] = useLoad(() => pk.orgRefunds(org.id), [org.id]);
  const [note, setNote] = useState('');
  const [busy, run] = useAction();
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Недостаточно прав или нет связи." onRetry={reload} />;
  if (!r.data!.refunds.length) return <Empty text="Запросов на возврат нет" />;
  return (
    <Col gap={8}>
      <Notice>Sky деньги за парковку не принимает, поэтому и не возвращает: возврат — ваше согласие, а деньги плательщику переводите вы сами.</Notice>
      <Input label="Комментарий к решению (при отказе — обязательно)" value={note} onChange={setNote} max={400} />
      {r.data!.refunds.map((x) => (
        <Card key={x.id}><b style={{ color: C.t1 }}>{fmt(x.amountRub)} ₽</b> · <span translate="no" style={{ color: C.t2 }}>{x.lotTitle}</span>
          <div translate="no" style={{ fontSize: 13, color: C.t1, margin: '4px 0' }}>{x.reason}</div>
          {x.own ? <Notice>Свой запрос решить нельзя — его рассмотрит другой сотрудник.</Notice> : (
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn busy={busy} onClick={() => run(async () => { const d = await pk.decideRefund(x.id, 'approve', note); if (!d.ok) return fail(d); flash('Возврат согласован — переведите деньги плательщику сами'); reload(); })}>Вернуть</Btn>
              <Btn kind="danger" busy={busy} onClick={() => run(async () => { const d = await pk.decideRefund(x.id, 'reject', note); if (!d.ok) return fail(d); reload(); })}>Отказать</Btn>
            </div>)}
        </Card>))}
    </Col>
  );
};

/* ─── Команда ─── */
const PERM_TEXT: Record<string, string> = { edit: 'править описание и часы', submit: 'отправлять на проверку' };
const ScopeEditor = ({ lots, value, perms, onChange }: { lots: PkLot[]; value: string[] | null; perms: string[]; onChange: (lotIds: string[] | null, perms: string[]) => void }) => (
  <Col gap={6}>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: C.t1, minHeight: 36 }}>
      <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : [], perms)} /> Все парковки организации</label>
    {value !== null && lots.map((l) => (
      <label key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.t2, minHeight: 32, paddingLeft: 12 }}>
        <input type="checkbox" checked={value.includes(l.id)} onChange={(e) => onChange(e.target.checked ? [...value, l.id] : value.filter((x) => x !== l.id), perms)} /><span translate="no">{l.title}</span></label>))}
    {value !== null && value.length === 0 && <div style={{ fontSize: 12.5, color: C.amber }}>Ни одной парковки не выбрано — сотрудник ничего не увидит.</div>}
    {Object.entries(PERM_TEXT).map(([k, t]) => (
      <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: C.t1, minHeight: 36 }}>
        <input type="checkbox" checked={perms.includes(k)} onChange={(e) => onChange(value, e.target.checked ? [...perms, k] : perms.filter((x) => x !== k))} /> Может {t}</label>))}
  </Col>
);
const OrgStaff = ({ org }: { org: PkOrg }) => {
  const [r, reload] = useLoad(() => pk.staffFull(org.id), [org.id]);
  const lots = useLoad(() => pk.lotsFiltered(org.id, { limit: '100' }), [org.id])[0];
  const [u, setU] = useState(''); const [role, setRole] = useState('moderator');
  const [scope, setScope] = useState<{ lotIds: string[] | null; perms: string[] }>({ lotIds: null, perms: ['edit', 'submit'] });
  const [editing, setEditing] = useState<string | null>(null); const [es, setEs] = useState<{ lotIds: string[] | null; perms: string[] }>({ lotIds: null, perms: [] });
  const [busy, run] = useAction();
  const all = lots?.ok ? lots.data!.lots : [];
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Недостаточно прав или нет связи." onRetry={reload} />;
  const roleText = (s: PkStaff) => (s.role === 'admin' ? 'администратор' : 'модератор');
  return (
    <Col gap={8}>
      {r.data!.staff.map((s) => (
        <Card key={s.profileId}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div translate="no" style={{ flex: 1, color: C.t1 }}><b>@{s.username}</b> · {roleText(s)}
              {s.role === 'moderator' && <div style={{ fontSize: 12, color: C.t3 }}>{s.lotIds === null ? 'все парковки' : `парковок: ${s.lotIds.length}`} · {s.perms.map((p) => PERM_TEXT[p] ?? p).join(', ') || 'только просмотр'}</div>}</div>
            {s.role === 'moderator' && <Btn kind="soft" onClick={() => { setEditing(editing === s.profileId ? null : s.profileId); setEs({ lotIds: s.lotIds, perms: s.perms }); }}>Права</Btn>}
            <button type="button" aria-label="Отозвать доступ" onClick={async () => { if (!window.confirm(`Отозвать доступ у @${s.username}?`)) return; const x = await pk.delStaff(org.id, s.profileId); if (!x.ok) return fail(x); flash('Доступ отозван'); reload(); }} style={{ width: 44, height: 44, border: 'none', background: C.l2, borderRadius: 12, color: C.red }}><Trash2 size={16} /></button></div>
          {editing === s.profileId && <div style={{ marginTop: 8 }}><ScopeEditor lots={all} value={es.lotIds} perms={es.perms} onChange={(l, p) => setEs({ lotIds: l, perms: p })} />
            <div style={{ marginTop: 8 }}><Btn busy={busy} onClick={() => run(async () => { const x = await pk.updateStaff(org.id, s.profileId, es); if (!x.ok) return fail(x); flash('Права сохранены'); setEditing(null); reload(); })}>Сохранить права</Btn></div></div>}
        </Card>))}
      <Card><Col>
        <Input label="Ник сотрудника" value={u} onChange={setU} placeholder="@ник" />
        <Segmented<string> value={role} onChange={setRole} options={[{ v: 'moderator', t: 'Модератор' }, ...(org.role === 'owner' ? [{ v: 'admin', t: 'Администратор' }] : [])]} />
        {role === 'moderator' && <ScopeEditor lots={all} value={scope.lotIds} perms={scope.perms} onChange={(l, p) => setScope({ lotIds: l, perms: p })} />}
        <Btn busy={busy} disabled={u.trim().length < 2} onClick={() => run(async () => { const x = await pk.addStaffScoped(org.id, { username: u, role, ...(role === 'moderator' ? scope : {}) }); if (!x.ok) return fail(x); flash('Сотрудник добавлен'); setU(''); reload(); })}>Добавить</Btn>
        <Notice>Модератор правит описание и часы и отправляет парковку на проверку — только на разрешённых ему парковках. Тарифы, точку и число мест меняет администратор или владелец. Права проверяет сервер при каждом действии.</Notice>
      </Col></Card>
    </Col>
  );
};

/* ─── Журнал действий организации ─── */
const Audit = ({ org }: { org: PkOrg }) => {
  const [off, setOff] = useState(0);
  const [r, reload] = useLoad(() => pk.audit(org.id, off), [org.id, off]);
  const more = useMemo(() => (r?.ok ? r.data!.events.length === 50 : false), [r]);
  if (!r) return <Empty text="Загрузка…" />;
  if (!r.ok) return <ErrorState text="Не удалось загрузить журнал." onRetry={reload} />;
  return (
    <Col gap={6}>
      {r.data!.events.length === 0 && <Empty text="Записей нет" />}
      {r.data!.events.map((e) => <Card key={e.id} style={{ padding: 10 }}><div style={{ fontSize: 13, color: C.t1 }}>{ACTION_TEXT[e.action] ?? e.action}</div><div style={{ fontSize: 12, color: C.t3 }}>{when(e.at)} · {e.actor ? <span translate="no">{e.actor}</span> : 'система'}</div></Card>)}
      <div style={{ display: 'flex', gap: 8 }}><Btn kind="soft" disabled={off === 0} onClick={() => setOff(Math.max(0, off - 50))}>Новее</Btn><Btn kind="soft" disabled={!more} onClick={() => setOff(off + 50)}>Старее</Btn></div>
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
