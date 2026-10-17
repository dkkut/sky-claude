/** Sky GO: кабинеты исполнителей. Подписка и реквизиты — общие блоки; заказы и меню — по роли. */
import { useCallback, useEffect, useState } from 'react';
import { useGoLive } from './live';
import { goApi, goError, ROLE_LABEL, type GoRole } from './api';
import { Btn, Card, Chip, Col, Empty, Input, Notice, fail, fmt, locate, useLoad, C } from './ui';
import { OrderRow } from './Orders';
import { flash } from '@/shared/flash';

export const SubscriptionCard = ({ role, onChange }: { role: GoRole; onChange: () => void }) => {
  const [s, reload] = useLoad(() => goApi.subscription(role), [role]);
  const [busy, setBusy] = useState(false);
  if (!s?.ok) return null;
  const { subscription: sub, history } = s.data!;
  const buy = async () => { setBusy(true); const r = await goApi.buy(role); setBusy(false); if (!r.ok) return fail(r); flash('Подписка оформлена'); reload(); onChange(); };
  return (
    <Card><Col gap={8}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Подписка · {sub.tariff?.title}</div>
        {sub.active ? <Chip color="#10b981">Активна</Chip> : <Chip color="#ef4444">{sub.expired ? 'Истекла' : 'Не оформлена'}</Chip>}
      </div>
      {(sub.tariff as any)?.personal && <Notice>Для вас действует персональный тариф{(sub.tariff as any).personalNote ? ` (${(sub.tariff as any).personalNote})` : ''}.</Notice>}
      {sub.expiresAt && <div style={{ fontSize: 13, color: C.t2 }}>{sub.active ? 'Действует до' : 'Закончилась'} {new Date(sub.expiresAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</div>}
      {!sub.active && <Notice tone="warn">Без активной подписки новые заказы недоступны. Начатые заказы можно довести до конца, история остаётся.</Notice>}
      <Btn busy={busy} onClick={buy}>{sub.active ? 'Продлить' : 'Оформить'} на {sub.tariff?.periodDays} дн. — {fmt(sub.tariff?.priceRub ?? 0)}</Btn>
      <div style={{ fontSize: 12, color: C.t3 }}>Списывается с кошелька Sky один раз, без автопродления. Продление добавляет дни к текущему сроку.</div>
      {history.length > 0 && <div style={{ fontSize: 12.5, color: C.t2 }}>{history.slice(0, 3).map((h) => <div key={h.expiresAt}>{new Date(h.startedAt).toLocaleDateString('ru-RU')} · {fmt(h.priceRub)}</div>)}</div>}
    </Col></Card>
  );
};

export const PayDetailsCard = () => {
  const [cur, reload] = useLoad(() => goApi.payDetails(), []);
  const [edit, setEdit] = useState(false);
  const [m, setM] = useState<'card' | 'sbp' | 'account'>('card');
  const [v, setV] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const d = cur?.ok ? cur.data!.details : null;
  const fld = (k: string, label: string, ph?: string) => <Input key={k} label={label} placeholder={ph} value={v[k] ?? ''} onChange={(x) => setV({ ...v, [k]: x })} />;
  const save = async () => { setBusy(true); const r = await goApi.savePayDetails({ method: m, ...v }); setBusy(false); if (!r.ok) return fail(r); flash('Реквизиты сохранены'); setEdit(false); setV({}); reload(); };
  return (
    <Card><Col gap={8}>
      <div style={{ fontWeight: 800, color: C.t1 }}>Реквизиты для оплаты</div>
      {d && !edit && <div translate="no" style={{ fontSize: 14, color: C.t2 }}>{d.method === 'card' ? `Карта ${d.number}` : d.method === 'sbp' ? `СБП ${d.phone}` : `Счёт ${d.account}`} · {d.holder}{d.bank ? ` · ${d.bank}` : ''}</div>}
      {!d && !edit && <Notice tone="warn">Реквизитов нет. Без них выйти на линию и принимать оплату нельзя.</Notice>}
      {edit && <>
        <div style={{ display: 'flex', gap: 6 }}>{([['card', 'Карта'], ['sbp', 'СБП'], ['account', 'Счёт']] as const).map(([k, t]) => <Btn key={k} kind={m === k ? 'main' : 'soft'} onClick={() => setM(k)} style={{ height: 38, fontSize: 13 }}>{t}</Btn>)}</div>
        {fld('holder', 'Получатель (ФИО или организация)')}
        {m === 'card' && fld('number', 'Номер карты')}
        {m === 'sbp' && fld('phone', 'Телефон для СБП', '+7…')}
        {m === 'account' && <>{fld('account', 'Расчётный счёт (20 цифр)')}{fld('bik', 'БИК (9 цифр)')}</>}
        {fld('bank', 'Банк')}
        <Btn busy={busy} onClick={save}>Сохранить</Btn>
      </>}
      {!edit && <Btn kind="soft" onClick={() => setEdit(true)}>{d ? 'Изменить' : 'Добавить'}</Btn>}
      <div style={{ fontSize: 12, color: C.t3 }}>Реквизиты хранятся зашифрованными и показываются только заказчику во время оплаты его заказа.</div>
    </Col></Card>
  );
};

/** Обратный отсчёт предложения. Время ответа решает сервер; здесь только показ — по окончании список перечитывается. */
const OfferTimer = ({ secondsLeft, onEnd }: { secondsLeft: number; onEnd: () => void }) => {
  const [left, setLeft] = useState(secondsLeft);
  useEffect(() => { setLeft(secondsLeft); }, [secondsLeft]);
  useEffect(() => {
    if (left <= 0) { onEnd(); return undefined; }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onEnd]);
  return <Chip color={left <= 5 ? '#ef4444' : '#8b5cf6'}>{`Предложено вам · осталось ${Math.max(0, left)} с`}</Chip>;
};

const AvailableList = ({ role, onOpen }: { role: 'taxi_driver' | 'courier'; onOpen: (id: string) => void }) => {
  const [res, reload] = useLoad(() => (role === 'taxi_driver' ? goApi.taxiAvailable() : goApi.deliveryAvailable()), [role], role === 'taxi_driver' ? 4000 : 7000);
  const [busy, setBusy] = useState('');
  useGoLive(useCallback(() => reload(), [reload]));   // «go:offer» / «go:order» — перечитать сразу, не ждать опроса
  if (!res) return <Empty text="Загрузка…" />;
  if (!res.ok) return <Notice tone="warn">{res.error === 'offline' ? 'Выйдите на линию, чтобы видеть заказы.' : res.error === 'subscription_required' ? 'Подписка не активна — новые заказы закрыты.' : res.reason ?? 'Не удалось загрузить заказы.'}</Notice>;
  const list = res.data!.orders;
  if (!list.length) return <Empty text="Новых заказов рядом пока нет." />;
  const accept = async (id: string) => { setBusy(id); const r = await (role === 'taxi_driver' ? goApi.taxiAccept(id) : goApi.deliveryAccept(id)); setBusy(''); if (!r.ok) { fail(r); return reload(); } onOpen(id); };
  return <>{list.map((o) => (
    <Card key={o.id}><Col gap={6}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: C.t1 }}><span>{fmt(o.priceRub)}</span><span style={{ fontSize: 13, color: C.t2 }}>{o.km} км · ~{o.minutes} мин</span></div>
      <div translate="no" style={{ fontSize: 13.5, color: C.t1 }}>{o.from.address} → {o.to.address}</div>
      {o.tariff && <Chip>{o.tariff}</Chip>}
      {o.cargo && <Chip color="#f59e0b">Грузовой: кузов {String(o.cargo.body).toUpperCase()}, грузчиков {o.cargo.loaders}</Chip>}
      {o.parcel && <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{o.parcel.description} · {o.parcel.size?.toUpperCase()} · {o.parcel.weightKg} кг</div>}
      {o.distanceToPickupKm != null && <div style={{ fontSize: 12.5, color: C.t3 }}>До места забора {o.distanceToPickupKm} км</div>}
      {o.offer && <OfferTimer secondsLeft={o.offer.secondsLeft} onEnd={reload} />}
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn busy={busy === o.id} onClick={() => accept(o.id)} style={{ flex: 1 }}>Принять заказ</Btn>
        {o.offer && role === 'taxi_driver' && <Btn kind="soft" onClick={async () => { setBusy(o.id); const r = await goApi.taxiDecline(o.id); setBusy(''); if (!r.ok) fail(r); reload(); }} style={{ flex: 1 }}>Отказаться</Btn>}
      </div>
    </Col></Card>))}</>;
};

export const DriverCabinet = ({ role, onOpen }: { role: 'taxi_driver' | 'courier'; onOpen: (id: string) => void }) => {
  const [pres, reloadP] = useLoad(() => goApi.presenceOf(role), [role]);
  const [stats] = useLoad(() => goApi.stats(role), [role]);
  const [acc, reloadAcc] = useLoad(() => goApi.access(role), [role], 30000);
  const [mine, reloadM] = useLoad(() => goApi.orders({ side: 'executor', status: 'active' }), [role], 8000);
  const [busy, setBusy] = useState(false);
  const online = pres?.ok && pres.data!.online;
  const toggle = async () => {
    setBusy(true);
    const pos = online ? undefined : (await locate()) ?? undefined;
    const r = await goApi.presence(role, !online, pos); setBusy(false);
    if (!r.ok) return fail(r);
    flash(online ? 'Вы не на линии' : 'Вы на линии'); reloadP();
  };
  const my = mine?.ok ? mine.data!.orders.filter((o) => (role === 'taxi_driver' ? o.kind === 'taxi' : o.kind === 'delivery')) : [];
  return (
    <Col>
      {acc?.ok && !acc.data!.allowed && (
        <Notice tone="warn">
          <b>Приём заказов закрыт:</b>
          {acc.data!.reasons.map((x) => <div key={x.code} style={{ marginTop: 4 }}>{`• ${goError({ error: x.code })}${x.note ? ` Комментарий: ${x.note}` : ''}`}</div>)}
        </Notice>)}
      <SubscriptionCard role={role} onChange={() => { reloadP(); reloadM(); reloadAcc(); }} />
      <PayDetailsCard />
      <Card><Col gap={8}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><b style={{ color: C.t1 }}>{online ? 'Вы на линии' : 'Вы не на линии'}</b>
          {stats?.ok && <span style={{ fontSize: 13, color: C.t2 }}>Выполнено: {stats.data!.done} · {fmt(stats.data!.earnedRub)}</span>}</div>
        <Btn busy={busy} kind={online ? 'soft' : 'main'} onClick={toggle}>{online ? 'Уйти с линии' : 'Выйти на линию'}</Btn>
        {!online && <div style={{ fontSize: 12, color: C.t3 }}>При выходе на линию определяется ваше местоположение (если разрешено) — чтобы показать заказы рядом.</div>}
      </Col></Card>
      {my.length > 0 && <><div style={{ fontWeight: 800, color: C.t1 }}>Ваши заказы</div>{my.map((o) => <OrderRow key={o.id} o={o} onOpen={() => onOpen(o.id)} />)}</>}
      {online && <><div style={{ fontWeight: 800, color: C.t1 }}>Новые заказы</div><AvailableList role={role} onOpen={onOpen} /></>}
    </Col>
  );
};

export const SellerCabinet = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const [pl, reload] = useLoad(() => goApi.myPlace(), []);
  const [orders, reloadO] = useLoad(() => goApi.sellerOrders(), [], 8000);
  const [pf, setPf] = useState<Record<string, string>>({}); const [it, setIt] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const place = pl?.ok ? pl.data!.place : null; const items = pl?.ok ? pl.data!.items : [];
  const savePlace = async () => {
    setBusy(true); const r = await goApi.savePlace({ name: pf.name ?? place?.name, address: pf.address ?? place?.address, category: pf.category ?? place?.category, hours: pf.hours ?? place?.hours, descr: pf.descr ?? place?.descr });
    setBusy(false); if (!r.ok) return fail(r);
    flash(r.data!.located ? 'Сохранено' : 'Сохранено, но адрес не найден на карте — уточните'); setPf({}); reload();
  };
  const addItem = async () => { const r = await goApi.saveItem({ name: it.name, priceRub: Number(it.price), category: it.category, descr: it.descr }); if (!r.ok) return fail(r); setIt({}); reload(); };
  const pub = async (on: boolean) => { const r = await goApi.publish(on); if (!r.ok) return fail(r); reload(); };
  return (
    <Col>
      <SubscriptionCard role="food_seller" onChange={reload} />
      <PayDetailsCard />
      <Card><Col gap={8}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Заведение</div>
        {([['name', 'Название'], ['address', 'Адрес'], ['category', 'Кухня / категория'], ['hours', 'Часы работы'], ['descr', 'Описание']] as const).map(([k, l]) => <Input key={k} label={l} value={pf[k] ?? String(place?.[k] ?? '')} onChange={(x) => setPf({ ...pf, [k]: x })} />)}
        <Btn busy={busy} onClick={savePlace}>Сохранить</Btn>
        {place && <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind={place.published ? 'soft' : 'main'} style={{ flex: 1 }} onClick={() => pub(!place.published)}>{place.published ? 'Снять с публикации' : 'Опубликовать'}</Btn>
          {place.published && <Btn kind="soft" style={{ flex: 1 }} onClick={async () => { const r = await goApi.accepting(!place.accepting); if (!r.ok) return fail(r); reload(); }}>{place.accepting ? 'Пауза приёма' : 'Принимать заказы'}</Btn>}
        </div>}
      </Col></Card>
      {place && <Card><Col gap={8}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Меню</div>
        {items.map((i) => <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', color: C.t1, fontSize: 14 }}>
          <span translate="no" style={{ flex: 1 }}>{i.name} — {fmt(i.priceRub)}</span>
          <Btn kind="soft" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={async () => { const r = await goApi.saveItem({ id: i.id, name: i.name, priceRub: i.priceRub, category: i.category, descr: i.descr, available: !i.available }); if (!r.ok) return fail(r); reload(); }}>{i.available ? 'Скрыть' : 'Вернуть'}</Btn>
          <Btn kind="danger" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={async () => { const r = await goApi.removeItem(i.id); if (!r.ok) return fail(r); reload(); }}>Удалить</Btn></div>)}
        <Input label="Новое блюдо" value={it.name ?? ''} onChange={(x) => setIt({ ...it, name: x })} />
        <Input label="Цена, ₽" value={it.price ?? ''} onChange={(x) => setIt({ ...it, price: x.replace(/\D/g, '') })} />
        <Input label="Категория (Супы, Напитки…)" value={it.category ?? ''} onChange={(x) => setIt({ ...it, category: x })} />
        <Btn disabled={!it.name || !it.price} onClick={addItem}>Добавить в меню</Btn>
      </Col></Card>}
      <div style={{ fontWeight: 800, color: C.t1 }}>Заказы заведения</div>
      {!orders?.ok ? <Empty text="Загрузка…" /> : orders.data!.orders.length === 0 ? <Empty text="Заказов пока нет." /> : orders.data!.orders.map((o) => <OrderRow key={o.id} o={o} onOpen={() => { onOpen(o.id); void reloadO; }} />)}
    </Col>
  );
};

export const CompanyCabinet = ({ onDeliver }: { onDeliver: () => void }) => {
  const [, reload] = useLoad(async () => 0, []);
  return (
    <Col>
      <SubscriptionCard role="company" onChange={reload} />
      <Card><Col gap={8}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Доставки от компании</div>
        <div style={{ fontSize: 13, color: C.t2 }}>Оформляйте доставки получателям от имени {ROLE_LABEL.company.toLowerCase()}. Курьеру платите напрямую после вручения.</div>
        <Btn onClick={onDeliver}>Новая доставка</Btn>
      </Col></Card>
    </Col>
  );
};
