/**
 * Sky GO: кабинет бизнеса. Построен по образцу кабинета продавца Sky Market (полоса вкладок, плитки счётчиков, карточки)
 * и на тех же компонентах; данные — организация поверх регистрации «Компания» (server/goorg.mjs).
 * Всё, что можно и нельзя, решает сервер по роли: интерфейс только показывает ответ. Цифры — только настоящие.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, ClipboardList, Users, Settings as Gear, Plus, Search, AlertTriangle, Clock, PackageCheck, Truck, Banknote, Ban, MapPin, UserPlus, Trash2, PauseCircle, PlayCircle, History } from 'lucide-react';
import { bizApi, ORG_ROLE_LABEL, ASSIGN_LABEL, type Dashboard, type OrgOrderCard, type Member, type OrgRole, type AssignMode } from './bizApi';
import { goApi, goError } from './api';
import { Btn, Card, Chip, Col, Empty, Input, Notice, fail, fmt, useLoad, C, GO } from './ui';
import { StatCard } from '@/marketplace/ui';
import { SkyMap } from '@/marketplace/logistics/SkyMap';
import { StatusChip } from './Register';
import { SubscriptionCard } from './Cabinet';
import { useGoLive, cacheGet, cacheSet } from './live';
import { apiBlob } from '@/core/auth/api';
import { flash } from '@/shared/flash';

type Tab = 'dash' | 'orders' | 'team' | 'settings';
const TABS: { key: Tab; label: string; Icon: typeof Gear }[] = [
  { key: 'dash', label: 'Панель', Icon: LayoutDashboard }, { key: 'orders', label: 'Заказы', Icon: ClipboardList },
  { key: 'team', label: 'Команда', Icon: Users }, { key: 'settings', label: 'Организация', Icon: Gear },
];

const statusText = (o: { status: string; internal?: boolean; accepted?: boolean | null }) => ({
  searching: 'Ждёт исполнителя', assigned: o.accepted === false ? 'Ждёт принятия' : 'Назначен', heading_pickup: 'Едет за отправлением', at_pickup: 'На месте получения',
  picked_up: 'Отправление получено', delivering: 'В пути к получателю', at_recipient: 'У получателя', awaiting_payment: 'Ждёт оплаты', payment_reported: 'Оплата сообщена',
  paid: o.internal ? 'Доставлен' : 'Завершён', cancelled: 'Отменён', dispute: 'Спор',
} as Record<string, string>)[o.status] ?? o.status;
const ATT: Record<string, [string, string]> = { problem: ['Проблема', '#ef4444'], dispute: ['Спор', '#ef4444'], no_executor: ['Нет исполнителя', '#f59e0b'], late: ['Задержка', '#f59e0b'] };
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** Короткая форма «введите причину» вместо всплывающих окон: работает и на телефоне. */
const Ask = ({ label, ok, onSubmit, onCancel, danger }: { label: string; ok: string; onSubmit: (v: string) => Promise<void> | void; onCancel: () => void; danger?: boolean }) => {
  const [v, setV] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Card style={{ background: C.l2 }}><Col gap={8}>
      <Input label={label} value={v} onChange={setV} max={200} />
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn kind={danger ? 'danger' : 'main'} busy={busy} disabled={v.trim().length < 3} style={{ flex: 1 }} onClick={async () => { setBusy(true); await onSubmit(v.trim()); setBusy(false); }}>{ok}</Btn>
        <Btn kind="soft" onClick={onCancel}>Отмена</Btn>
      </div>
    </Col></Card>
  );
};

const OrderCard = ({ o, onOpen }: { o: OrgOrderCard; onOpen: () => void }) => (
  <Card onClick={onOpen}><Col gap={6}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
      <div style={{ fontWeight: 800, color: C.t1 }}>{fmt(o.priceRub)} · {o.scenario === 'cargo' ? 'Грузовой' : 'Доставка'}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {o.needsAttention && <Chip color={ATT[o.needsAttention][1]}>{ATT[o.needsAttention][0]}</Chip>}
        <Chip>{statusText(o)}</Chip>
      </div>
    </div>
    <div translate="no" style={{ fontSize: 13, color: C.t1 }}>{o.from} → {o.to}</div>
    <div style={{ fontSize: 12.5, color: C.t2 }}>
      <span translate="no">{o.parcel}</span>{o.executor ? <> · исполнитель <b translate="no">{o.executor.name}</b></> : o.poolOpen ? ' · открыт всем курьерам' : ''} · {when(o.createdAt)}
    </div>
  </Col></Card>
);

/* ───────────── Панель ───────────── */
const DashboardTab = ({ org, onGo, onOpen, onNew }: { org: string; onGo: (t: Tab) => void; onOpen: (id: string) => void; onNew: () => void }) => {
  const [res, reload] = useLoad(() => bizApi.dashboard(org), [org], 10000);
  useGoLive(reload);
  const d = res?.ok ? res.data! : null;
  useEffect(() => { if (d) cacheSet(`dash:${org}`, d); }, [d, org]);
  const cached = !d && res && !res.ok ? cacheGet<Dashboard>(`dash:${org}`) : null;
  const x = d ?? cached?.data ?? null;
  if (!res) return <Empty text="Загрузка…" />;
  if (!x) return <Notice tone="warn">{goError(res as { error?: string; reason?: string })}</Notice>;
  const c = x.counts;
  const points = x.map.map((m, i) => ({ id: m.orderId, pos: { lat: m.lat, lng: m.lng }, label: m.executor || 'Исполнитель', kind: 'courier' as const, mark: String.fromCharCode(65 + (i % 26)) }));
  return (
    <Col>
      {cached && <Notice tone="warn">Нет связи с сервером. Показаны данные на {when(new Date(cached.at).toISOString())} — они могли устареть.</Notice>}
      {x.org.suspended && <Notice tone="warn">Организация приостановлена администрацией Sky: новые заказы и назначения недоступны.</Notice>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn onClick={onNew} disabled={x.org.suspended}><Plus size={16} /> Новый заказ</Btn>
        <Btn kind="soft" onClick={() => onGo('orders')}>Заказы</Btn><Btn kind="soft" onClick={() => onGo('team')}>Команда</Btn><Btn kind="soft" onClick={() => onGo('settings')}>Настройки</Btn>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <StatCard label="Новые" value={c.searching} Icon={ClipboardList} color={c.searching ? C.amber : undefined} />
        <StatCard label="Ждут принятия" value={c.assigned_wait} Icon={Clock} />
        <StatCard label="Едут за заказом" value={c.assigned_ok + c.to_pickup} Icon={Truck} />
        <StatCard label="В доставке" value={c.delivering} Icon={PackageCheck} color={GO} />
        <StatCard label="Ждут оплаты" value={c.awaiting_pay} Icon={Banknote} />
        <StatCard label="Проблемы и споры" value={c.problems + c.dispute} Icon={AlertTriangle} color={c.problems + c.dispute ? C.red : undefined} />
        <StatCard label="Создано сегодня" value={c.created_today} Icon={Plus} />
        <StatCard label="Завершено сегодня" value={c.done_today} Icon={PackageCheck} color={C.green} />
        <StatCard label="Отменено сегодня" value={c.cancelled_today} Icon={Ban} color={c.cancelled_today ? C.red : undefined} />
      </div>
      <Card><Col gap={4}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Команда и сроки</div>
        <div style={{ fontSize: 14, color: C.t2 }}>На линии: <b style={{ color: C.t1 }}>{x.team.online}</b> из {x.team.total} исполнителей</div>
        <div style={{ fontSize: 14, color: C.t2 }}>Среднее время доставки за 30 дней: <b style={{ color: C.t1 }}>{x.avgDeliveryMinutes != null ? `${x.avgDeliveryMinutes} мин` : 'нет данных'}</b>{x.avgSample ? ` (по ${x.avgSample} заказам)` : ''}</div>
        <div style={{ fontSize: 14, color: C.t2 }}>За 30 дней: завершено <b style={{ color: C.t1 }}>{c.done_30}</b>, отменено <b style={{ color: C.t1 }}>{c.cancelled_30}</b></div>
      </Col></Card>
      <div style={{ fontWeight: 800, color: C.t1 }}>Требуют внимания</div>
      {x.attention.length === 0 ? <Empty text="Всё спокойно: проблем, споров и долгих ожиданий нет." /> : x.attention.map((o) => <OrderCard key={o.id} o={o} onOpen={() => onOpen(o.id)} />)}
      <div style={{ fontWeight: 800, color: C.t1 }}>Доставки на карте</div>
      {points.length === 0
        ? <Notice>Сейчас нет доставок с известным положением исполнителя. Положение видно только у тех, кто на линии и везёт заказ.</Notice>
        : <SkyMap points={points} height={220} />}
    </Col>
  );
};

/* ───────────── Заказы ───────────── */
const GROUPS: [string, string][] = [['', 'Все'], ['new', 'Новые'], ['active', 'В работе'], ['awaiting', 'Ждут оплаты'], ['problem', 'Проблемы'], ['dispute', 'Споры'], ['done', 'Завершённые'], ['cancelled', 'Отменённые']];

const OrdersTab = ({ org, onOpen, onNew }: { org: string; onOpen: (id: string) => void; onNew: () => void }) => {
  const [group, setGroup] = useState(''); const [q, setQ] = useState(''); const [qd, setQd] = useState(''); const [sort, setSort] = useState('');
  useEffect(() => { const h = setTimeout(() => setQd(q.trim()), 350); return () => clearTimeout(h); }, [q]);
  const [res, reload] = useLoad(() => bizApi.orders(org, { group, q: qd, sort }), [org, group, qd, sort], 10000);
  useGoLive(reload);
  const list = res?.ok ? res.data!.orders : [];
  return (
    <Col>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={16} color={C.t3} style={{ position: 'absolute', left: 12, top: 15 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: номер, адрес, получатель, содержимое" aria-label="Поиск заказов" translate="no"
            style={{ width: '100%', height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 14px 0 36px', fontSize: 15 }} />
        </div>
        <Btn onClick={onNew} style={{ padding: '0 14px' }} aria-label="Новый заказ"><Plus size={18} /></Btn>
      </div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {GROUPS.map(([k, t]) => <button key={k} onClick={() => setGroup(k)} style={{ flexShrink: 0, padding: '7px 12px', borderRadius: 12, border: 'none', fontSize: 12.5, fontWeight: 700, background: group === k ? 'rgba(14,165,164,.16)' : C.l2, color: group === k ? GO : C.t2 }}>{t}</button>)}
      </div>
      <label style={{ fontSize: 12.5, color: C.t2 }}>Сортировка{' '}
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ marginLeft: 6, height: 34, borderRadius: 10, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 8px' }}>
          <option value="">Сначала новые</option><option value="old">Сначала старые</option><option value="upd">По последнему изменению</option><option value="price">По стоимости</option></select></label>
      {!res ? <Empty text="Загрузка…" /> : !res.ok ? <Notice tone="warn">{goError(res as { error?: string })}</Notice>
        : list.length === 0 ? <Empty text={qd || group ? 'Ничего не найдено.' : 'Заказов пока нет. Создайте первый.'} /> : list.map((o) => <OrderCard key={o.id} o={o} onOpen={() => onOpen(o.id)} />)}
      {res?.ok && res.data!.total > list.length && <div style={{ fontSize: 12.5, color: C.t3, textAlign: 'center' }}>Показано {list.length} из {res.data!.total}. Уточните поиск или фильтр.</div>}
    </Col>
  );
};

const ProblemPhoto = ({ id }: { id: string }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let u = ''; void apiBlob(`/api/go/problems/${id}/photo`).then((r) => { if (r.ok && r.blob) { u = URL.createObjectURL(r.blob); setSrc(u); } }); return () => { if (u) URL.revokeObjectURL(u); }; }, [id]);
  return src ? <img src={src} alt="Фото к проблеме" style={{ maxWidth: '100%', borderRadius: 12, marginTop: 6 }} /> : null;
};

/* ───────────── Карточка заказа ───────────── */
export const OrgOrderScreen = ({ org, id, onBack, canAdmin }: { org: string; id: string; onBack: () => void; canAdmin: boolean }) => {
  const [res, reload] = useLoad(() => bizApi.order(org, id), [org, id], 8000);
  useGoLive((oid) => { if (!oid || oid === id) reload(); });
  const [mem] = useLoad(() => bizApi.members(org), [org]);
  const [ask, setAsk] = useState<'' | 'cancel' | 'unassign' | 'resolve'>(''); const [pick, setPick] = useState(''); const [busy, setBusy] = useState('');
  const [note, setNote] = useState(''); const [toExec, setToExec] = useState(true); const [act, setAct] = useState('resume');
  if (!res) return <Empty text="Загрузка…" />;
  if (!res.ok) return <Notice tone="warn">{goError(res as { error?: string })}</Notice>;
  const { order: o, notes, problems, can } = res.data!;
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; reason?: string }>, okText: string) => {
    setBusy(key); const r = await fn(); setBusy('');
    if (!r.ok) { fail(r); reload(); return; }
    flash(okText); setAsk(''); reload();
  };
  const cands = (mem?.ok ? mem.data!.members : []).filter((m) => m.status === 'active' && m.profileId !== o.executor?.id);
  const open = problems.find((p) => p.state === 'open');
  const loc = o.executorLocation && o.data.to?.lat != null ? [
    { id: 'ex', pos: { lat: o.executorLocation.lat, lng: o.executorLocation.lng }, label: o.executor?.name ?? 'Исполнитель', kind: 'courier' as const },
    { id: 'to', pos: { lat: o.data.to.lat, lng: o.data.to.lng }, label: 'Получатель', kind: 'target' as const }] : null;
  return (
    <Col>
      <button onClick={onBack} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', color: GO, fontWeight: 700, fontSize: 14 }}>‹ К заказам</button>
      <Card><Col gap={6}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 18, color: C.t1 }}>{fmt(o.priceRub)}</div><Chip>{statusText({ status: o.status, internal: o.internal, accepted: o.accepted })}</Chip>
        </div>
        <div translate="no" style={{ fontSize: 12, color: C.t3 }}>№ {o.id.slice(-8).toUpperCase()} · {when(o.createdAt)}{o.createdBy ? ` · создал @${o.createdBy}` : ''}</div>
        {o.attention && <Notice tone="warn">Требует внимания: {ATT[o.attention]?.[0] ?? o.attention}.</Notice>}
        <div translate="no" style={{ fontSize: 14, color: C.t1 }}>{o.data.from?.address} → {o.data.to?.address}</div>
        <div style={{ fontSize: 13, color: C.t2 }}>≈ {o.data.km} км · ~{o.data.minutes} мин · <span translate="no">{o.data.parcel?.description}</span>{o.data.parcel?.size ? ` · ${String(o.data.parcel.size).toUpperCase()}` : ''}{o.data.cargo ? ` · кузов ${String(o.data.cargo.body).toUpperCase()}, грузчиков ${o.data.cargo.loaders}` : ''}</div>
        {o.data.comment && <div translate="no" style={{ fontSize: 13, color: C.t2 }}>Комментарий: {o.data.comment}</div>}
      </Col></Card>
      <Card><Col gap={4}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Контакты</div>
        {o.data.sender && <div translate="no" style={{ fontSize: 13.5, color: C.t1 }}>Отправитель: {o.data.sender.name}, {o.data.sender.phone}</div>}
        {o.data.recipient && <div translate="no" style={{ fontSize: 13.5, color: C.t1 }}>Получатель: {o.data.recipient.name}, {o.data.recipient.phone}</div>}
      </Col></Card>
      <Card><Col gap={6}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Исполнитель</div>
        {o.executor ? <div translate="no" style={{ fontSize: 14, color: C.t1 }}>{o.executor.name} (@{o.executor.username}){o.accepted === false ? ' — ещё не принял назначение' : ''}</div>
          : <div style={{ fontSize: 13.5, color: C.t2 }}>{o.poolOpen ? 'Заказ открыт всем курьерам Sky GO.' : 'Не назначен.'}</div>}
        <div style={{ fontSize: 12.5, color: C.t3 }}>{o.internal ? 'Свой сотрудник: оплата через Sky не требуется.' : o.pay ? `Оплата курьеру напрямую: ${o.pay.state === 'confirmed' ? 'подтверждена' : o.pay.state === 'reported' ? 'сообщено об оплате, ждём подтверждения курьера' : 'ждёт оплаты'}.` : 'Оплата откроется после вручения.'}</div>
        {loc && <SkyMap points={loc} height={180} />}
        {o.executorLocation && <div style={{ fontSize: 12, color: C.t3 }}>Положение обновлено {when(o.executorLocation.updatedAt)}.</div>}
        {can.assign && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Исполнитель" style={{ flex: 1, height: 44, borderRadius: 12, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 8px' }}>
              <option value="">{o.executor ? 'Передать другому…' : 'Выберите исполнителя…'}</option>
              {cands.map((m) => <option key={m.profileId} value={m.profileId}>{m.name} · {m.online ? 'на линии' : 'не на линии'}{m.ready ? '' : ' · не готов'} · заказов {m.activeOrders}</option>)}</select>
            <Btn busy={busy === 'assign'} disabled={!pick} onClick={() => run('assign', () => bizApi.assign(org, id, pick), 'Исполнитель назначен')}>Назначить</Btn>
          </div>)}
        {cands.length === 0 && can.assign && <div style={{ fontSize: 12.5, color: C.t3 }}>В команде пока некого назначить: пригласите сотрудников во вкладке «Команда».</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {o.executor && ['assigned', 'heading_pickup', 'at_pickup'].includes(o.status) && <Btn kind="soft" onClick={() => setAsk('unassign')}>Снять исполнителя</Btn>}
          {can.openPool && canAdmin && <Btn kind="soft" busy={busy === 'pool'} onClick={() => run('pool', () => bizApi.openPool(org, id), 'Заказ открыт для курьеров')}>Открыть всем курьерам</Btn>}
          {can.cancel && <Btn kind="danger" onClick={() => setAsk('cancel')}>Отменить заказ</Btn>}
        </div>
        {ask === 'unassign' && <Ask label="Причина снятия исполнителя" ok="Снять" onCancel={() => setAsk('')} onSubmit={(v) => run('un', () => bizApi.unassign(org, id, v), 'Исполнитель снят')} />}
        {ask === 'cancel' && <Ask label="Причина отмены" ok="Отменить заказ" danger onCancel={() => setAsk('')} onSubmit={(v) => run('c', () => bizApi.cancel(org, id, v), 'Заказ отменён')} />}
      </Col></Card>
      {o.codes && <Card><Col gap={4}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Коды</div>
        {o.codes.pickup && <div style={{ fontSize: 14, color: C.t1 }}>Передача курьеру: <b translate="no" style={o.codes.pickup.code ? { letterSpacing: 2 } : undefined}>{o.codes.pickup.code ?? 'использован'}</b></div>}
        {o.codes.handover && <div style={{ fontSize: 14, color: C.t1 }}>Вручение получателю: <b translate="no" style={o.codes.handover.code ? { letterSpacing: 2 } : undefined}>{o.codes.handover.code ?? 'использован'}</b></div>}
        <div style={{ fontSize: 12, color: C.t3 }}>Коды одноразовые; 5 неверных попыток блокируют код.</div>
      </Col></Card>}
      {problems.length > 0 && <Card><Col gap={8}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Проблемы доставки</div>
        {problems.map((p) => <div key={p.id} style={{ fontSize: 13.5, color: C.t1 }}>
          <Chip color={p.state === 'open' ? '#ef4444' : '#10b981'}>{p.state === 'open' ? 'Открыта' : 'Решена'}</Chip> <b>{({ recipient_unavailable: 'Получатель недоступен', wrong_address: 'Неверный адрес', mismatch: 'Не соответствует описанию', damaged: 'Повреждено', closed: 'Точка закрыта', other: 'Другое' } as Record<string, string>)[p.kind] ?? p.kind}</b>
          {p.note && <span translate="no"> — {p.note}</span>}<div style={{ fontSize: 12, color: C.t3 }}>{when(p.at)}{p.resolution ? ` · решение: ${p.resolution.replace(/^(resume|reassign|cancel|escalate): /, (_m, a: string) => ({ resume: 'продолжить доставку', reassign: 'заменить исполнителя', cancel: 'отменить заказ', escalate: 'передано администрации' } as Record<string, string>)[a] + '. ')}` : ''}</div>{p.hasPhoto && <ProblemPhoto id={p.id} />}</div>)}
        {open && can.resolveProblem && (ask === 'resolve' ? <>
          <label style={{ fontSize: 12.5, color: C.t2 }}>Решение{' '}<select value={act} onChange={(e) => setAct(e.target.value)} style={{ marginLeft: 6, height: 38, borderRadius: 10, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1 }}>
            <option value="resume">Продолжить доставку</option><option value="reassign">Заменить исполнителя</option><option value="cancel">Отменить заказ</option><option value="escalate">Передать администрации Sky (спор)</option></select></label>
          <Ask label="Что решили (будет видно исполнителю)" ok="Закрыть проблему" onCancel={() => setAsk('')} onSubmit={(v) => run('res', () => bizApi.resolveProblem(org, open.id, act, v), 'Проблема закрыта')} /></>
          : <Btn onClick={() => setAsk('resolve')}>Решить проблему</Btn>)}
      </Col></Card>}
      <Card><Col gap={8}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Заметки и сообщения диспетчера</div>
        {notes.length === 0 && <div style={{ fontSize: 13, color: C.t3 }}>Заметок нет.</div>}
        {notes.map((n) => <div key={n.id} style={{ fontSize: 13.5, color: C.t1 }}><b translate="no">@{n.author}</b>{n.toExecutor ? ' → исполнителю' : ''}: <span translate="no">{n.body}</span> <span style={{ fontSize: 11.5, color: C.t3 }}>{when(n.at)}</span></div>)}
        {can.note && <>
          <Input value={note} onChange={setNote} max={500} placeholder="Заметка или сообщение" />
          {o.executor && <label style={{ fontSize: 13, color: C.t2 }}><input type="checkbox" checked={toExec} onChange={(e) => setToExec(e.target.checked)} /> Отправить исполнителю уведомлением</label>}
          <Btn kind="soft" disabled={note.trim().length < 2} busy={busy === 'note'} onClick={() => run('note', () => bizApi.note(org, id, note.trim(), toExec && Boolean(o.executor)), 'Сохранено').then(() => setNote(''))}>Добавить</Btn></>}
      </Col></Card>
      {['awaiting_payment', 'payment_reported'].includes(o.status) && o.pay && !o.internal && o.role === 'customer' && o.pay.state === 'awaiting' && (
        <Btn busy={busy === 'paid'} onClick={() => run('paid', () => goApi.paid(id), 'Отправлено курьеру на подтверждение')}>Я оплатил курьеру</Btn>)}
      {o.pay?.details && o.pay.state === 'awaiting' && <Notice>Реквизиты курьера: <b translate="no">{o.pay.details.method === 'card' ? `карта ${o.pay.details.number}` : o.pay.details.method === 'sbp' ? `СБП ${o.pay.details.phone}` : `счёт ${o.pay.details.account}`}</b> · {o.pay.details.holder}. Сумма {fmt(o.pay.amountRub)}.</Notice>}
      <Card><Col gap={4}>
        <div style={{ fontWeight: 800, color: C.t1 }}>История статусов</div>
        {(o.events ?? []).map((e, i) => <div key={i} style={{ fontSize: 13, color: C.t2 }}><span style={{ color: C.t3 }}>{when(e.at)}</span> · {e.note || e.to}</div>)}
      </Col></Card>
    </Col>
  );
};

/* ───────────── Команда ───────────── */
const TeamTab = ({ org, myRole }: { org: string; myRole: OrgRole }) => {
  const [res, reload] = useLoad(() => bizApi.members(org), [org], 12000);
  const [aud, reloadA] = useLoad(() => (myRole === 'owner' || myRole === 'admin' ? bizApi.audit(org) : Promise.resolve(null)), [org, myRole]);
  const [uname, setUname] = useState(''); const [role, setRole] = useState<OrgRole>('courier'); const [busy, setBusy] = useState('');
  const d = res?.ok ? res.data! : null;
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; reason?: string }>, okText: string) => { setBusy(key); const r = await fn(); setBusy(''); if (!r.ok) { fail(r); return; } flash(okText); reload(); reloadA(); };
  const change = (m: Member, b: { role?: OrgRole; status?: string }, danger: string | null) => {
    if (danger && !window.confirm(danger)) return;
    void run(m.profileId, () => bizApi.changeMember(org, m.profileId, { ...b, confirm: Boolean(danger) || undefined }), 'Сохранено');
  };
  if (!res) return <Empty text="Загрузка…" />;
  if (!d) return <Notice tone="warn">{goError(res as { error?: string })}</Notice>;
  return (
    <Col>
      {d.canManage && (
        <Card><Col gap={8}>
          <div style={{ fontWeight: 800, color: C.t1 }}><UserPlus size={16} style={{ verticalAlign: -3 }} /> Пригласить сотрудника</div>
          <Input label="Ник в Sky (без @)" value={uname} onChange={setUname} max={40} />
          <label style={{ display: 'block' }}><div style={{ fontSize: 12, color: C.t2, margin: '0 0 5px 4px' }}>Роль</div>
            <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)} style={{ width: '100%', height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 10px', fontSize: 15 }}>
              {d.grantable.map((r) => <option key={r} value={r}>{ORG_ROLE_LABEL[r]}</option>)}</select></label>
          <Btn busy={busy === 'inv'} disabled={uname.trim().length < 2} onClick={() => run('inv', () => bizApi.invite(org, uname.trim(), role), 'Приглашение отправлено').then(() => setUname(''))}>Пригласить</Btn>
          <div style={{ fontSize: 12, color: C.t3 }}>Человек увидит приглашение в Sky GO → Работа. Водитель и курьер должны ещё пройти регистрацию курьера и оплатить подписку — без этого заказы им назначить нельзя. Администратор может управлять менеджерами и исполнителями, но не администраторами и не владельцем.</div>
        </Col></Card>)}
      {d.members.length === 0 ? <Empty text="В команде пока никого." /> : d.members.map((m) => (
        <Card key={m.profileId}><Col gap={6}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ minWidth: 0 }}><div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{m.name}{m.self ? ' (вы)' : ''}</div><div translate="no" style={{ fontSize: 12.5, color: C.t3 }}>@{m.username}</div></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Chip>{m.roleLabel}</Chip>{m.status === 'invited' && <Chip color="#f59e0b">Приглашён</Chip>}{m.status === 'suspended' && <Chip color="#ef4444">Приостановлен</Chip>}
              {m.status === 'active' && (m.role !== 'owner' || m.courierStatus === 'approved') && <Chip color={m.online ? '#10b981' : '#64748b'}>{m.online ? 'На линии' : 'Не на линии'}</Chip>}
            </div>
          </div>
          {m.status === 'active' && <div style={{ fontSize: 12.5, color: C.t2 }}>Заказов сейчас: <b style={{ color: C.t1 }}>{m.activeOrders}</b> · выполнено: <b style={{ color: C.t1 }}>{m.doneOrders}</b> · {m.ready ? 'готов к назначениям' : m.courierStatus === 'approved' ? 'подписка курьера не активна' : 'нет одобренной регистрации курьера'}</div>}
          {d.canManage && !m.self && m.role !== 'owner' && d.grantable.includes(m.role) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <select value={m.role} aria-label="Роль" onChange={(e) => { const nr = e.target.value as OrgRole; change(m, { role: nr }, nr === 'admin' ? `Назначить «${m.name}» администратором организации? Он сможет управлять командой и настройками.` : m.role === 'admin' ? `Понизить «${m.name}» из администраторов?` : null); }}
                style={{ height: 38, borderRadius: 10, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 8px' }}>
                {d.grantable.map((r) => <option key={r} value={r}>{ORG_ROLE_LABEL[r]}</option>)}</select>
              {m.status === 'active' && <Btn kind="soft" style={{ height: 38, fontSize: 13 }} onClick={() => change(m, { status: 'suspended' }, `Приостановить «${m.name}»? Его непринятые заказы вернутся диспетчеру.`)}><PauseCircle size={15} /> Приостановить</Btn>}
              {m.status === 'suspended' && <Btn kind="soft" style={{ height: 38, fontSize: 13 }} onClick={() => change(m, { status: 'active' }, null)}><PlayCircle size={15} /> Вернуть</Btn>}
              <Btn kind="danger" style={{ height: 38, fontSize: 13 }} onClick={() => change(m, { status: 'removed' }, `Удалить «${m.name}» из организации?`)}><Trash2 size={15} /> Удалить</Btn>
            </div>)}
        </Col></Card>))}
      {aud?.ok && aud.data && <Card><Col gap={4}>
        <div style={{ fontWeight: 800, color: C.t1 }}><History size={15} style={{ verticalAlign: -3 }} /> Журнал действий</div>
        {aud.data.log.length === 0 ? <div style={{ fontSize: 13, color: C.t3 }}>Записей нет.</div> : aud.data.log.slice(0, 25).map((l) => <div key={l.id} style={{ fontSize: 12.5, color: C.t2 }}><span style={{ color: C.t3 }}>{when(l.at)}</span> · <span translate="no">@{l.actor ?? 'система'}</span> · {LOG_LABEL[l.action] ?? l.action}{l.subject ? <span translate="no"> · {l.subject}</span> : null}</div>)}
      </Col></Card>}
    </Col>
  );
};
const LOG_LABEL: Record<string, string> = {
  org_create: 'организация создана', invite: 'приглашение', invite_accept: 'принял приглашение', invite_decline: 'отклонил приглашение', member_change: 'изменён доступ сотрудника', member_leave: 'покинул организацию',
  order_create: 'создан заказ', order_assign: 'назначен исполнитель', order_reassign: 'исполнитель переназначен', order_unassign: 'исполнитель снят', order_auto_assign: 'автоназначение', order_cancel: 'заказ отменён',
  order_open_pool: 'заказ открыт всем курьерам', problem_resolve: 'решена проблема доставки', settings: 'изменены настройки', point_add: 'добавлена точка', point_remove: 'удалена точка', admin_suspend: 'приостановлена администрацией Sky', admin_restore: 'возобновлена администрацией Sky',
};

/* ───────────── Организация (настройки) ───────────── */
const SettingsTab = ({ org, onLeft }: { org: string; onLeft: () => void }) => {
  const [res, reload] = useLoad(() => bizApi.settings(org), [org]);
  const [f, setF] = useState<{ name?: string; phone?: string }>({}); const [pt, setPt] = useState({ title: '', address: '' }); const [busy, setBusy] = useState('');
  const d = res?.ok ? res.data! : null;
  if (!res) return <Empty text="Загрузка…" />;
  if (!d) return <Notice tone="warn">{goError(res as { error?: string })}</Notice>;
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; reason?: string; data?: any }>, okText: string) => { setBusy(key); const r = await fn(); setBusy(''); if (!r.ok) { fail(r); return false; } flash(okText); reload(); return r; };
  return (
    <Col>
      <Card><Col gap={8}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div style={{ fontWeight: 800, color: C.t1 }}>Организация</div><StatusChip s={d.verification.status} /></div>
        <div style={{ fontSize: 12.5, color: C.t3 }}>{d.verification.status === 'approved' ? 'Регистрация компании одобрена сотрудниками Sky вручную; сверка с реестрами не выполнялась.' : 'Регистрация компании ещё не одобрена.'}{d.verification.legalForm ? ` Форма: ${({ npd: 'самозанятый (НПД)', ip: 'ИП', ooo: 'ООО' } as Record<string, string>)[d.verification.legalForm] ?? d.verification.legalForm}.` : ''}</div>
        <Input label="Название" value={f.name ?? d.org.name} onChange={(v) => setF({ ...f, name: v })} max={120} />
        {d.canEdit && <Input label="Телефон организации" type="tel" value={f.phone ?? d.org.phone ?? ''} onChange={(v) => setF({ ...f, phone: v })} placeholder="+7…" />}
        {d.canEdit && <Btn busy={busy === 'save'} disabled={!f.name && f.phone == null} onClick={async () => { if (await run('save', () => bizApi.saveSettings(org, f), 'Сохранено')) setF({}); }}>Сохранить</Btn>}
        {!d.canEdit && <div style={{ fontSize: 12.5, color: C.t3 }}>Менять данные организации могут владелец и администратор.</div>}
      </Col></Card>
      <Card><Col gap={8}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Назначение заказов</div>
        <div style={{ fontSize: 12.5, color: C.t3 }}>Режим по умолчанию для новых заказов; при создании заказа его можно изменить.</div>
        {(['manual', 'auto', 'pool'] as AssignMode[]).map((m) => <label key={m} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: C.t1, opacity: d.canEdit ? 1 : 0.6 }}>
          <input type="radio" name="am" checked={d.org.assignMode === m} disabled={!d.canEdit} onChange={() => void run('mode', () => bizApi.saveSettings(org, { assignMode: m }), 'Режим изменён')} /> {ASSIGN_LABEL[m]}</label>)}
      </Col></Card>
      <Card><Col gap={8}>
        <div style={{ fontWeight: 800, color: C.t1 }}><MapPin size={16} style={{ verticalAlign: -3 }} /> Адреса отправления и точки обслуживания</div>
        {d.points.length === 0 && <div style={{ fontSize: 13, color: C.t3 }}>Адресов нет. Добавьте — они появятся в форме заказа.</div>}
        {d.points.map((p) => <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: C.t1 }}>
          <span translate="no" style={{ flex: 1 }}><b>{p.title}</b> — {p.address}{p.located ? '' : ' · на карте не найден'}</span>
          {d.canEdit && <Btn kind="danger" style={{ height: 34, fontSize: 12, padding: '0 10px' }} onClick={() => { if (window.confirm(`Удалить адрес «${p.title}»?`)) void run('rm', () => bizApi.removePoint(org, p.id), 'Удалено'); }}>Удалить</Btn>}</div>)}
        {d.canEdit && <><Input label="Название точки" value={pt.title} onChange={(v) => setPt({ ...pt, title: v })} max={80} /><Input label="Адрес" value={pt.address} onChange={(v) => setPt({ ...pt, address: v })} max={240} />
          <Btn kind="soft" busy={busy === 'pt'} disabled={pt.title.trim().length < 2 || pt.address.trim().length < 5} onClick={async () => { if (await run('pt', () => bizApi.addPoint(org, pt), 'Адрес добавлен')) setPt({ title: '', address: '' }); }}>Добавить адрес</Btn></>}
      </Col></Card>
      {d.myRole === 'owner' && <><SubscriptionCard role="company" onChange={reload} /></>}
      <Card><Col gap={4}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Тарифы, уведомления, поддержка</div>
        <div style={{ fontSize: 13, color: C.t2 }}>Стоимость доставки считает сервер по расстоянию и размеру отправления; сумму из запроса он не принимает. Своим сотрудникам вы Sky ничего не платите; доставка внешним курьером оплачивается напрямую после вручения.</div>
        <div style={{ fontSize: 13, color: C.t2 }}>Уведомления о заказах приходят в Sky и пушем, если приложение закрыто (настройка — Профиль → Уведомления). Обращения — Профиль → Техническая поддержка.</div>
      </Col></Card>
      {d.myRole !== 'owner' && <Btn kind="danger" onClick={async () => { if (window.confirm('Покинуть организацию? Ваши непринятые заказы вернутся диспетчеру.')) { const r = await bizApi.leave(org); if (!r.ok) return fail(r); flash('Вы покинули организацию'); onLeft(); } }}>Покинуть организацию</Btn>}
    </Col>
  );
};

/* ───────────── Оболочка ───────────── */
export const BusinessWorkspace = ({ org, name, role, onNew, onOpenOrder, openId, onCloseOrder }: { org: string; name: string; role: OrgRole; onNew: (c: { id: string; name: string; assignMode: AssignMode; points: { id: string; title: string; address: string }[]; executors: Member[] }) => void; onOpenOrder: (id: string) => void; openId: string | null; onCloseOrder: () => void }) => {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem(`sky:go:biztab:${org}`) as Tab) || 'dash'; } catch { return 'dash'; } });
  const go = useCallback((t: Tab) => { setTab(t); try { localStorage.setItem(`sky:go:biztab:${org}`, t); } catch { /* ok */ } }, [org]);
  const newOrder = async () => {
    const [s, m] = await Promise.all([bizApi.settings(org), bizApi.members(org)]);
    if (!s.ok) return fail(s);
    onNew({ id: org, name, assignMode: s.data!.org.assignMode, points: s.data!.points.map((p) => ({ id: p.id, title: p.title, address: p.address })), executors: m.ok ? m.data!.members.filter((x) => x.status === 'active') : [] });
  };
  const staffAdmin = role === 'owner' || role === 'admin';
  const view = useMemo(() => openId ? <OrgOrderScreen org={org} id={openId} onBack={onCloseOrder} canAdmin={staffAdmin} /> : tab === 'dash' ? <DashboardTab org={org} onGo={go} onOpen={onOpenOrder} onNew={newOrder} />
    : tab === 'orders' ? <OrdersTab org={org} onOpen={onOpenOrder} onNew={newOrder} /> : tab === 'team' ? <TeamTab org={org} myRole={role} /> : <SettingsTab org={org} onLeft={() => window.location.reload()} />,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [openId, tab, org, role]);
  return (
    <Col>
      <div><div translate="no" style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>{name}</div><div style={{ fontSize: 12.5, color: C.t2 }}>Кабинет бизнеса · ваша роль: {ORG_ROLE_LABEL[role]}</div></div>
      {!openId && <div style={{ display: 'flex', gap: 4, overflowX: 'auto', borderBottom: `1px solid ${C.brd}`, paddingBottom: 6, scrollbarWidth: 'none' }}>
        {TABS.map((t) => <button key={t.key} onClick={() => go(t.key)} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 12, border: 'none', fontSize: 12.5, fontWeight: 700, background: tab === t.key ? 'rgba(14,165,164,.16)' : 'transparent', color: tab === t.key ? GO : C.t3 }}><t.Icon size={14} />{t.label}</button>)}
      </div>}
      {view}
    </Col>
  );
};
