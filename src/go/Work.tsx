/**
 * Sky GO: рабочее пространство водителя и курьера. Мобильный экран для дороги: «Карта / Заказы / История / Профиль».
 * Карта показывает настоящее положение (с разрешения), точки маршрута и линию; главное действие текущего этапа — одна крупная кнопка.
 * Все статусы и коды проверяет сервер; здесь ничего не имитируется: нет геолокации или карт — так и сказано, а список адресов и внешний навигатор остаются.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapIcon, ClipboardList, History as HistoryIcon, User, Navigation, Phone, AlertTriangle, ChevronUp, ChevronDown, Power, X, Check } from 'lucide-react';
import { bizApi, navLinks, PROBLEM_KINDS, type WorkState, type WorkOrder, type WorkRoute, type WorkHistory } from './bizApi';
import { goApi, goError, type GoRole } from './api';
import { Btn, Card, Chip, Col, Empty, Input, Notice, fail, fmt, locate, useLoad, C, GO } from './ui';
import { SkyMap } from '@/marketplace/logistics/SkyMap';
import { SubscriptionCard, PayDetailsCard } from './Cabinet';
import { StatusChip } from './Register';
import { useGoLive, cacheGet, cacheSet } from './live';
import { flash } from '@/shared/flash';

type WRole = 'courier' | 'taxi_driver';
type WTab = 'map' | 'orders' | 'history' | 'profile';

const hhmm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—');
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const dist = (m?: number | null) => (m == null ? '' : m < 1000 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(1)} км`);
const mins = (s?: number | null) => (s == null ? '' : `${Math.max(1, Math.round(s / 60))} мин`);

const LABEL: Record<string, string> = {
  assigned: 'Назначен', heading_pickup: 'Еду за отправлением', at_pickup: 'На месте получения', picked_up: 'Отправление у вас', delivering: 'Еду к получателю', at_recipient: 'У получателя',
  en_route: 'Еду к пассажиру', arrived: 'Пассажир ждёт', in_ride: 'В поездке', awaiting_payment: 'Ждём оплату', payment_reported: 'Оплата сообщена', paid: 'Завершён', dispute: 'Спор',
};

/** Что делать на каждом этапе: главная кнопка, код (если нужен), необязательный отказ. */
const stage = (o: WorkOrder): { action?: string; text?: string; code?: 'pickup' | 'handover'; release?: boolean; kind: 'delivery' | 'taxi' } => {
  if (o.kind === 'taxi') {
    const t = ({ assigned: { action: 'en_route', text: 'Выехал к пассажиру', release: true }, en_route: { action: 'arrived', text: 'Я на месте', release: true }, arrived: { action: 'start', text: 'Начать поездку' },
      in_ride: { action: 'complete', text: 'Завершить поездку' } } as Record<string, { action: string; text: string; release?: boolean }>)[o.status];
    return { ...(t ?? {}), kind: 'taxi' };
  }
  const m = ({
    assigned: o.needsAccept ? { action: 'accept_assignment', text: 'Принять назначение', release: true } : { action: 'heading', text: 'Еду за отправлением', release: true },
    heading_pickup: { action: 'arrived_pickup', text: 'Я на месте получения', release: true },
    at_pickup: { action: 'pickup', text: 'Принять отправление', code: o.data.scenario === 'food' ? undefined : 'pickup', release: true },
    picked_up: { action: 'start_delivery', text: 'Выехал к получателю' },
    delivering: { action: 'arrived_recipient', text: 'Я у получателя' },
    at_recipient: { action: 'deliver', text: 'Вручить', code: 'handover' },
  } as Record<string, any>)[o.status];
  return { ...(m ?? {}), kind: 'delivery' };
};

const nextPoint = (o: WorkOrder) => {
  const picked = o.kind === 'taxi' ? o.status === 'in_ride' : ['picked_up', 'delivering', 'at_recipient'].includes(o.status);
  const p = picked ? o.data.to : o.data.from;
  return { label: picked ? 'Вручить' : o.kind === 'taxi' ? 'Забрать пассажира' : 'Забрать', point: p as { address?: string; lat?: number; lng?: number } | undefined };
};

const NavMenu = ({ point }: { point?: { lat?: number; lng?: number; address?: string } }) => {
  const [open, setOpen] = useState(false);
  if (!point || point.lat == null || point.lng == null) return <div style={{ fontSize: 12.5, color: C.t3 }}>У точки нет координат — откройте адрес в навигаторе вручную.</div>;
  const l = navLinks({ lat: point.lat, lng: point.lng });
  return (
    <div style={{ position: 'relative' }}>
      <Btn kind="soft" onClick={() => setOpen(!open)} style={{ height: 44 }}><Navigation size={16} /> Навигатор</Btn>
      {open && <div style={{ position: 'absolute', bottom: 50, left: 0, zIndex: 5, background: C.l1, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 6, minWidth: 170, boxShadow: '0 8px 24px rgba(0,0,0,.3)' }}>
        {([['Яндекс Карты', l.yandex], ['Google Карты', l.google], ['2ГИС', l.gis]] as const).map(([t, u]) => <a key={t} href={u} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} style={{ display: 'block', padding: '10px 12px', color: C.t1, fontWeight: 600, fontSize: 14 }}>{t}</a>)}
      </div>}
    </div>
  );
};

/* ─────────── Проблема ─────────── */
const ProblemSheet = ({ order, onClose, onDone }: { order: WorkOrder; onClose: () => void; onDone: () => void }) => {
  const [kind, setKind] = useState('recipient_unavailable'); const [note, setNote] = useState(''); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);
  const send = async () => {
    setBusy(true);
    const r = await bizApi.problem(order.id, kind, note);
    if (!r.ok) { setBusy(false); return fail(r); }
    if (file) { const p = await bizApi.problemPhoto(r.data!.id, file); if (!p.ok) flash(`Проблема отправлена, но фото не принято: ${goError(p as { error?: string })}`); }
    setBusy(false); setSent(true); onDone();
  };
  return (
    <Card style={{ borderColor: '#ef4444' }}><Col gap={8}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ color: C.t1 }}><AlertTriangle size={16} color="#ef4444" style={{ verticalAlign: -3 }} /> Сообщить о проблеме</b><button aria-label="Закрыть" onClick={onClose} style={{ border: 'none', background: 'none', color: C.t3 }}><X size={18} /></button></div>
      {sent ? <>
        <Notice>Проблема передана {order.orgName ? `диспетчеру «${order.orgName}»` : 'заказчику'}. Заказ не закрыт: решение примет не исполнитель. Подождите ответа в уведомлениях; если срочно — Профиль → Техническая поддержка.</Notice>
        <Btn onClick={onClose}>Понятно</Btn></> : <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{PROBLEM_KINDS.map(([k, t]) => <button key={k} onClick={() => setKind(k)} style={{ padding: '8px 12px', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700, background: kind === k ? 'rgba(239,68,68,.16)' : C.l2, color: kind === k ? '#ef4444' : C.t2 }}>{t}</button>)}</div>
        <Input label={kind === 'other' ? 'Опишите проблему' : 'Подробности (необязательно)'} value={note} onChange={setNote} max={400} area />
        <label style={{ fontSize: 13, color: C.t2 }}>Фото-подтверждение (необязательно)<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ display: 'block', marginTop: 4 }} /></label>
        <Btn kind="danger" busy={busy} disabled={kind === 'other' && note.trim().length < 5} onClick={send}>Отправить</Btn>
        <div style={{ fontSize: 12, color: C.t3 }}>Закрыть спорную ситуацию, отменить оплаченный заказ или изменить цену исполнитель не может.</div></>}
    </Col></Card>
  );
};

/* ─────────── Панель заказа ─────────── */
const OrderPanel = ({ o, compact, onChange, hereLabel }: { o: WorkOrder; compact?: boolean; onChange: () => void; hereLabel?: string }) => {
  const [open, setOpen] = useState(!compact); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [ask, setAsk] = useState(false); const [reason, setReason] = useState(''); const [prob, setProb] = useState(false);
  const st = stage(o); const np = nextPoint(o);
  const run = async (action: string, extra: { code?: string; reason?: string } = {}) => {
    setBusy(true); const r = await bizApi.act(st.kind, o.id, action, extra); setBusy(false);
    if (!r.ok) { fail(r); onChange(); return false; }
    setCode(''); setAsk(false); setReason(''); onChange(); return true;
  };
  const needReason = Boolean(o.orgName);
  const call = (label: string, c?: { name: string; phone: string; hidden?: boolean }) => c && !c.hidden && c.phone
    ? <a href={`tel:${c.phone}`} translate="no" style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.t1, fontSize: 14, textDecoration: 'none' }}><Phone size={15} color={GO} /> {label}: {c.name}, {c.phone}</a> : null;
  const done = ['awaiting_payment', 'payment_reported', 'paid', 'dispute'].includes(o.status);
  return (
    <Card style={{ padding: 12 }}><Col gap={8}>
      <button onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none', textAlign: 'left', color: C.t1, padding: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip>{LABEL[o.status] ?? o.status}</Chip>{o.orgName && <Chip color="#6366f1">{o.orgName}</Chip>}{o.data.scenario === 'cargo' && <Chip color="#f59e0b">Грузовой</Chip>}
            {o.problems.some((p) => p.state === 'open') && <Chip color="#ef4444">Есть проблема</Chip>}
          </div>
          {!done && <div style={{ fontSize: 12.5, color: C.t3, marginTop: 4 }}>{hereLabel ?? np.label}</div>}
          <div translate="no" style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>{done ? `${o.data.from?.address} → ${o.data.to?.address}` : np.point?.address ?? '—'}</div>
        </div>
        {open ? <ChevronDown size={18} color={C.t3} /> : <ChevronUp size={18} color={C.t3} />}
      </button>
      {open && <>
        <div style={{ fontSize: 13, color: C.t2 }}>{o.kind === 'taxi' ? o.data.tariffTitle : <span translate="no">{o.data.parcel?.description}</span>} · ≈ {o.data.km} км{o.data.minutes ? ` · ~${o.data.minutes} мин` : ''}{!o.internal ? ` · ${fmt(o.priceRub)}` : ''}</div>
        {o.data.comment && <div translate="no" style={{ fontSize: 13, color: C.t2 }}>Комментарий: {o.data.comment}</div>}
        {o.dispatcherNotes.map((n, i) => <Notice key={i}>Диспетчер ({hhmm(n.at)}): <span translate="no">{n.body}</span></Notice>)}
        {call('Отправитель', o.data.sender)}
        {o.data.recipient?.hidden ? <div style={{ fontSize: 12.5, color: C.t3 }}>Контакты получателя откроются после получения отправления.</div> : call('Получатель', o.data.recipient)}
        {o.kind === 'taxi' && o.customer && <div translate="no" style={{ fontSize: 14, color: C.t1 }}>Пассажир: {o.customer.name || o.customer.username}</div>}
        {o.pay && o.pay.state !== 'confirmed' && <div style={{ fontSize: 13, color: C.t2 }}>Оплата {fmt(o.pay.amountRub)}: {o.pay.state === 'reported' ? 'заказчик сообщил об оплате — проверьте поступление' : 'ждёт заказчика'}.</div>}
      </>}
      {!done && st.action && <>
        {st.code && <Input label={st.code === 'pickup' ? 'Код передачи (назовёт отправитель или заказчик)' : 'Код вручения (назовёт получатель)'} value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />}
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <Btn busy={busy} disabled={Boolean(st.code) && code.length !== 6} onClick={() => run(st.action!, st.code ? { code } : {})} style={{ flex: 1, height: 56, borderRadius: 18, fontSize: 17 }}><Check size={18} /> {st.text}</Btn>
          <NavMenu point={np.point} />
        </div>
      </>}
      {!done && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn kind="danger" style={{ height: 38, fontSize: 13 }} onClick={() => setProb(true)}><AlertTriangle size={14} /> Проблема</Btn>
          {st.release && <Btn kind="soft" style={{ height: 38, fontSize: 13 }} onClick={() => (needReason || o.needsAccept ? setAsk(true) : run('release'))}>Отказаться</Btn>}
        </div>)}
      {ask && <Card style={{ background: C.l2 }}><Col gap={8}>
        <Input label={needReason ? 'Причина отказа (обязательно, увидит диспетчер)' : 'Причина отказа'} value={reason} onChange={setReason} max={200} />
        <div style={{ display: 'flex', gap: 8 }}><Btn kind="danger" busy={busy} disabled={needReason && reason.trim().length < 3} style={{ flex: 1 }} onClick={async () => { await run('release', { reason }); }}>Отказаться от заказа</Btn><Btn kind="soft" onClick={() => setAsk(false)}>Назад</Btn></div></Col></Card>}
      {prob && <ProblemSheet order={o} onClose={() => setProb(false)} onDone={onChange} />}
      {o.pay?.state === 'reported' && o.pay.payeeId && (
        <Btn busy={busy} onClick={async () => { setBusy(true); const r = await goApi.confirmPaid(o.id); setBusy(false); if (!r.ok) return fail(r); flash('Получение денег подтверждено'); onChange(); }}>Деньги получил</Btn>)}
    </Col></Card>
  );
};

/* ─────────── Вкладки ─────────── */
const MapTab = ({ st, route, loc, onToggle, busy, onChange }: { st: WorkState; route: WorkRoute | null; loc: 'unknown' | 'ok' | 'denied' | 'none'; onToggle: () => void; busy: boolean; onChange: () => void }) => {
  const online = st.presence.online;
  const me = st.presence.lat != null && st.presence.lng != null ? { lat: st.presence.lat, lng: st.presence.lng } : null;
  const stops = route?.stops ?? [];
  const points = [
    ...(me ? [{ id: 'me', pos: me, label: 'Вы', kind: 'courier' as const }] : []),
    ...stops.map((s, i) => ({ id: s.key, pos: { lat: s.lat, lng: s.lng }, label: s.type === 'pickup' ? 'Забрать' : 'Вручить', kind: s.type === 'pickup' ? ('pickup' as const) : ('target' as const), mark: String.fromCharCode(65 + (i % 26)) })),
  ];
  const first = stops[0];
  const cur = st.orders.find((o) => o.id === first?.orderId) ?? st.orders.find((o) => ['assigned', 'heading_pickup', 'at_pickup', 'picked_up', 'delivering', 'at_recipient', 'en_route', 'arrived', 'in_ride'].includes(o.status));
  const waiting = st.orders.filter((o) => o.needsAccept);
  return (
    <Col>
      <Card style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onToggle} disabled={busy} aria-label={online ? 'Уйти с линии' : 'Выйти на линию'} style={{ width: 62, height: 62, borderRadius: '50%', border: 'none', background: online ? GO : C.l2, color: online ? '#fff' : C.t2, display: 'grid', placeItems: 'center', opacity: busy ? 0.6 : 1 }}><Power size={26} /></button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: C.t1 }}>{online ? 'На линии' : 'Не на линии'}</div>
            <div style={{ fontSize: 12.5, color: C.t2 }}>{online ? `Смена с ${hhmm(st.shiftStartedAt)} · сегодня доставлено ${st.doneToday} · активных ${st.orders.filter((o) => !['awaiting_payment', 'payment_reported', 'paid', 'dispute'].includes(o.status)).length}` : 'Нажмите, чтобы начать смену'}</div>
          </div>
        </div>
      </Card>
      {!st.access.pool && !st.access.assigned && <Notice tone="warn">{({ subscription_required: 'Подписка не активна — новые заказы закрыты (начатые можно довести до конца). Оформите её на вкладке «Профиль».', not_registered: 'Сначала зарегистрируйтесь исполнителем в разделе «Работа».', not_approved: 'Заявка ещё не одобрена администрацией.', pay_details_required: 'Добавьте реквизиты для приёма оплаты (вкладка «Профиль») — без них выйти на линию нельзя.' } as Record<string, string>)[st.access.assignedError ?? st.access.poolError ?? ''] ?? 'Выход на линию сейчас недоступен.'}</Notice>}
      {online && loc === 'denied' && <Notice tone="warn">Нет доступа к геолокации. Разрешите её в настройках браузера или приложения — иначе карта, расстояния и расчёт маршрута недоступны. Список заказов, адреса и внешний навигатор работают и так.</Notice>}
      {online && loc === 'none' && <Notice>Определяем ваше положение…</Notice>}
      {online && me && <div style={{ fontSize: 12, color: C.t3 }}>Положение обновлено {hhmm(st.presence.updatedAt)}. После ухода с линии оно стирается.</div>}
      {waiting.length > 0 && <Notice tone="warn">Вам назначено заказов: {waiting.length}. Примите их или откажитесь с причиной.</Notice>}
      <SkyMap points={points} height={260} path={route?.polyline} />
      {route && stops.length > 0 && <Card style={{ padding: 12 }}><Col gap={4}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><b style={{ color: C.t1 }}>Маршрут · {stops.length} точ.</b><span style={{ fontSize: 13, color: C.t2 }}>{dist(route.distanceM)} · {mins(route.durationS)}{route.estimated ? ' · оценка по прямой' : ''}</span></div>
        {route.mapError && <div style={{ fontSize: 12, color: C.t3 }}>Построить маршрут по дорогам не удалось ({route.mapError === 'maps_not_configured' ? 'карты не подключены' : 'сервис недоступен'}); показана оценка.</div>}
        {route.locationRequired && <div style={{ fontSize: 12.5, color: C.t3 }}>Нужна геолокация, чтобы посчитать расстояние и время до точек.</div>}
        {stops.map((s, i) => <div key={s.key} translate="no" style={{ display: 'flex', gap: 8, fontSize: 13.5, color: i === 0 ? C.t1 : C.t2, fontWeight: i === 0 ? 700 : 500 }}>
          <span style={{ width: 20, height: 20, borderRadius: '50%', background: s.type === 'pickup' ? 'rgba(14,165,164,.2)' : C.l2, color: s.type === 'pickup' ? GO : C.t2, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{String.fromCharCode(65 + (i % 26))}</span>
          <span style={{ flex: 1 }}>{s.type === 'pickup' ? 'Забрать' : 'Вручить'}: {s.address}</span><span style={{ fontSize: 12, color: C.t3 }}>{dist(s.distanceM)} {mins(s.durationS)}</span></div>)}
      </Col></Card>}
      {cur ? <OrderPanel o={cur} compact onChange={onChange} hereLabel={first ? `${first.type === 'pickup' ? 'Следующая точка: забрать' : 'Следующая точка: вручить'}${first.durationS != null ? ` · ${mins(first.durationS)}` : ''}` : undefined} />
        : <Empty text={online ? 'Пока нет активного заказа. Новые предложения — на вкладке «Заказы».' : 'Выйдите на линию, чтобы получать заказы.'} />}
      {online && st.offers.length > 0 && <Notice>Новых предложений: {st.offers.length}. Откройте вкладку «Заказы».</Notice>}
    </Col>
  );
};

const OrdersTab = ({ st, onChange }: { st: WorkState; onChange: () => void }) => {
  const [busy, setBusy] = useState('');
  const kind = st.role === 'taxi_driver' ? 'taxi' : 'delivery';
  const accept = async (id: string) => { setBusy(id); const r = await bizApi.accept(kind, id); setBusy(''); if (!r.ok) fail(r); else flash('Заказ принят'); onChange(); };
  return (
    <Col>
      <div style={{ fontWeight: 800, color: C.t1 }}>Мои заказы</div>
      {st.orders.length === 0 ? <Empty text="Активных заказов нет." /> : st.orders.map((o) => <OrderPanel key={o.id} o={o} compact onChange={onChange} />)}
      <div style={{ fontWeight: 800, color: C.t1 }}>Новые предложения</div>
      {!st.presence.online ? <Notice>Выйдите на линию, чтобы видеть предложения.</Notice>
        : !st.access.pool ? <Notice>Общий поток заказов вам недоступен ({st.access.poolError === 'pay_details_required' ? 'добавьте реквизиты для оплаты' : st.access.poolError === 'subscription_required' ? 'подписка не активна' : 'нет допуска'}); заказы вашей организации приходят назначением.</Notice>
        : st.offers.length === 0 ? <Empty text="Предложений рядом пока нет." /> : st.offers.map((o: any) => (
          <Card key={o.id}><Col gap={6}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: C.t1 }}><span>{fmt(o.priceRub)}</span><span style={{ fontSize: 13, color: C.t2 }}>{o.km} км · ~{o.minutes} мин</span></div>
            <div translate="no" style={{ fontSize: 13.5, color: C.t1 }}>{o.from.address} → {o.to.address}</div>
            <div style={{ fontSize: 12.5, color: C.t3 }}>{o.parcel ? `${o.parcel.description} · ${String(o.parcel.size ?? '').toUpperCase()} · ${o.parcel.weightKg} кг` : o.tariff}{o.distanceToPickupKm != null ? ` · до места забора ${o.distanceToPickupKm} км` : ''}{o.cargo ? ` · грузовой, кузов ${String(o.cargo.body).toUpperCase()}` : ''}</div>
            <div style={{ fontSize: 12, color: C.t3 }}>Контакты откроются после принятия. Оплата — напрямую от заказчика.</div>
            <Btn busy={busy === o.id} onClick={() => accept(o.id)}>Принять заказ</Btn></Col></Card>))}
    </Col>
  );
};

const HistoryTab = ({ role }: { role: WRole }) => {
  const [res] = useLoad(() => bizApi.workHistory(role), [role]);
  if (!res) return <Empty text="Загрузка…" />;
  if (!res.ok) return <Notice tone="warn">{goError(res as { error?: string })}</Notice>;
  const { stats: s, orders, shifts, notes } = res.data! as WorkHistory;
  const cell = (label: string, value: string) => <div style={{ background: C.l2, borderRadius: 14, padding: 10 }}><div style={{ fontSize: 11, color: C.t3 }}>{label}</div><div style={{ fontSize: 18, fontWeight: 900, color: C.t1 }}>{value}</div></div>;
  return (
    <Col>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {cell('Выполнено', String(s.done))}{cell('Отменено', String(s.cancelled))}{cell('Сообщено проблем', String(s.problemsReported))}{cell('Среднее время заказа', s.avgMinutes != null ? `${s.avgMinutes} мин` : 'нет данных')}
        {cell('Пройдено по маршруту', `${s.kmRoute} км`)}{cell('Часов на линии за 30 дн.', String(s.shiftHours30))}{cell('Получено напрямую', fmt(s.receivedRub))}{cell('Споров', String(s.disputes))}
      </div>
      <Notice>{notes.earnings} Оценок и рейтинга в Sky GO нет, поэтому они не показываются.{s.kmEstimatedOrders > 0 ? ` Расстояние ещё по ${s.kmEstimatedOrders} заказам не посчитано по дорогам (карты были недоступны) — в сумму оно не входит.` : ''}</Notice>
      <div style={{ fontWeight: 800, color: C.t1 }}>Выполненные и отменённые</div>
      {orders.length === 0 ? <Empty text="Истории пока нет." /> : orders.map((o) => <Card key={o.id} style={{ padding: 12 }}><Col gap={2}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b style={{ color: C.t1 }}>{o.internal ? 'Для организации' : fmt(o.priceRub)}</b><Chip color={o.status === 'cancelled' ? '#ef4444' : '#10b981'}>{o.status === 'cancelled' ? 'Отменён' : o.status === 'dispute' ? 'Спор' : 'Доставлен'}</Chip></div>
        <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{o.from} → {o.to}</div>
        <div style={{ fontSize: 12, color: C.t3 }}>{when(o.at)}{o.minutes != null ? ` · ${o.minutes} мин` : ''}{o.km != null && !o.kmEstimated ? ` · ${o.km} км` : ''}{o.org ? ` · ${o.org}` : ''}</div></Col></Card>)}
      <div style={{ fontWeight: 800, color: C.t1 }}>Смены</div>
      {shifts.length === 0 ? <Empty text="Смен пока нет." /> : shifts.slice(0, 15).map((x, i) => <div key={i} style={{ fontSize: 13, color: C.t2 }}>{when(x.startedAt)} — {x.endedAt ? when(x.endedAt) : 'идёт'}</div>)}
    </Col>
  );
};

const ProfileTab = ({ st, onChange }: { st: WorkState; onChange: () => void }) => (
  <Col>
    <Card><Col gap={6}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ color: C.t1 }}>{st.role === 'taxi_driver' ? 'Водитель такси' : 'Курьер'}</b>{st.executor && <StatusChip s={st.executor.status} />}</div>
      <div style={{ fontSize: 13, color: C.t2 }}>Город: {st.executor?.city || '—'}{st.executor?.transport ? ` · транспорт: ${({ foot: 'пешком', bike: 'велосипед', scooter: 'самокат', car: 'автомобиль', truck: 'грузовой' } as Record<string, string>)[st.executor.transport] ?? st.executor.transport}` : ''}</div>
      {st.orgs.length > 0 && <div style={{ fontSize: 13, color: C.t2 }}>Организации: {st.orgs.map((g) => `${g.name} (${({ owner: 'владелец', admin: 'администратор', manager: 'менеджер', driver: 'водитель', courier: 'курьер' } as Record<string, string>)[g.role]})`).join(', ')}</div>}
    </Col></Card>
    <SubscriptionCard role={st.role as GoRole} onChange={onChange} />
    <PayDetailsCard />
    <Card><Col gap={4}>
      <b style={{ color: C.t1 }}>Геолокация и помощь</b>
      <div style={{ fontSize: 13, color: C.t2 }}>Положение отправляется, только пока вы на линии и экран открыт; история перемещений не хранится, после ухода с линии положение стирается. Его видят только сотрудники организации по заказу, который вы везёте.</div>
      <div style={{ fontSize: 13, color: C.t2 }}>Проблема с заказом — кнопка «Проблема» в карточке заказа. По остальным вопросам — Профиль → Техническая поддержка.</div>
    </Col></Card>
  </Col>
);

/* ─────────── Оболочка ─────────── */
export const ExecutorWorkspace = ({ roles, initial, onClose }: { roles: WRole[]; initial: WRole; onClose: () => void }) => {
  const [role, setRole] = useState<WRole>(initial);
  const [tab, setTab] = useState<WTab>('map');
  const [res, reload] = useLoad(() => bizApi.workState(role), [role], 6000);
  const [rres, reloadRoute] = useLoad(() => bizApi.workRoute(role), [role], 20000);
  const [busy, setBusy] = useState(false); const [loc, setLoc] = useState<'unknown' | 'ok' | 'denied' | 'none'>('unknown');
  const [net, setNet] = useState(true);
  const refresh = useCallback(() => { reload(); reloadRoute(); }, [reload, reloadRoute]);
  useGoLive(refresh);
  const st = res?.ok ? res.data! : null;
  useEffect(() => { if (st) { cacheSet(`work:${role}`, st); setNet(true); } else if (res && !res.ok) setNet(false); }, [st, res, role]);
  const cached = !st && res && !res.ok ? cacheGet<WorkState>(`work:${role}`) : null;
  const view = st ?? cached?.data ?? null;
  const online = Boolean(st?.presence.online);

  // Новые назначения: короткое сообщение, когда появился заказ, требующий принятия.
  const seen = useRef(new Set<string>());
  useEffect(() => { for (const o of st?.orders ?? []) if (o.needsAccept && !seen.current.has(o.id)) { seen.current.add(o.id); if (seen.current.size > 1 || res) flash('Вам назначен заказ — примите его'); } }, [st, res]);

  // Геолокация: только на линии и пока вкладка видна; остановка при уходе с линии и закрытии экрана.
  useEffect(() => {
    if (!online) { setLoc('unknown'); return undefined; }
    if (!navigator.geolocation) { setLoc('denied'); return undefined; }
    let last = 0; setLoc((v) => (v === 'ok' ? v : 'none'));
    const id = navigator.geolocation.watchPosition((p) => {
      setLoc('ok');
      const now = Date.now();
      if (now - last < 15000 || document.visibilityState !== 'visible') return;
      last = now; void bizApi.location(p.coords.latitude, p.coords.longitude).then((r) => { if (r.ok) reloadRoute(); });
    }, (e) => setLoc(e.code === 1 ? 'denied' : 'none'), { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [online, reloadRoute]);

  const toggle = async () => {
    if (!st) return; setBusy(true);
    const pos = online ? undefined : (await locate()) ?? undefined;
    const r = await goApi.presence(role as GoRole, !online, pos); setBusy(false);
    if (!r.ok) return fail(r);
    flash(online ? 'Вы не на линии' : 'Вы на линии'); refresh();
  };

  const TABS: [WTab, string, typeof User][] = [['map', 'Карта', MapIcon], ['orders', 'Заказы', ClipboardList], ['history', 'История', HistoryIcon], ['profile', 'Профиль', User]];
  const active = st?.orders.filter((o) => !['awaiting_payment', 'payment_reported', 'paid', 'dispute'].includes(o.status)).length ?? 0;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: C.bg, zIndex: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${C.brd}` }}>
        <button onClick={onClose} aria-label="К Sky GO" style={{ width: 36, height: 36, borderRadius: 12, border: 'none', background: C.l2, color: C.t1, display: 'grid', placeItems: 'center' }}>‹</button>
        <div style={{ flex: 1, fontWeight: 900, fontSize: 17, color: C.t1 }}>Работа</div>
        {roles.length > 1 && <div style={{ display: 'flex', background: C.l2, borderRadius: 12, padding: 2 }}>{roles.map((r) => <button key={r} onClick={() => setRole(r)} style={{ padding: '6px 10px', borderRadius: 10, border: 'none', fontSize: 12.5, fontWeight: 700, background: role === r ? C.l1 : 'transparent', color: role === r ? C.t1 : C.t3 }}>{r === 'courier' ? 'Курьер' : 'Такси'}</button>)}</div>}
      </div>
      {!net && <div style={{ padding: '8px 14px', background: 'rgba(245,158,11,.14)', color: C.amber, fontSize: 12.5 }}>Нет связи с сервером. {cached ? `Показано последнее состояние на ${hhmm(new Date(cached.at).toISOString())}.` : ''} Действия недоступны, пока связь не вернётся.</div>}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 18px', maxWidth: 680, width: '100%', margin: '0 auto' }}>
        {!view ? <Empty text={res && !res.ok ? goError(res as { error?: string }) : 'Загрузка…'} /> : tab === 'map' ? <MapTab st={view} route={rres?.ok ? rres.data! : null} loc={loc} onToggle={toggle} busy={busy} onChange={refresh} />
          : tab === 'orders' ? <OrdersTab st={view} onChange={refresh} /> : tab === 'history' ? <HistoryTab role={role} /> : <ProfileTab st={view} onChange={refresh} />}
        {view && st && <div style={{ fontSize: 11, color: C.t3, textAlign: 'center', marginTop: 10 }}>Обновлено {hhmm(st.serverTime)}</div>}
      </div>
      <nav style={{ display: 'flex', borderTop: `1px solid ${C.brd}`, background: C.l1 }}>
        {TABS.map(([k, t, Icon]) => <button key={k} onClick={() => setTab(k)} style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '9px 0', border: 'none', background: 'none', color: tab === k ? GO : C.t3, fontSize: 11.5, fontWeight: 700 }}>
          <Icon size={21} />{t}{k === 'orders' && active > 0 && <span style={{ position: 'absolute', top: 4, left: '56%', minWidth: 17, height: 17, borderRadius: 9, background: '#ef4444', color: '#fff', fontSize: 10.5, display: 'grid', placeItems: 'center', padding: '0 4px' }}>{active}</span>}</button>)}
      </nav>
    </div>
  );
};
