/** Sky GO: «Заказы» и карточка заказа (общая для заказчика и исполнителя). Оплата — напрямую по реквизитам, подтверждает получатель денег. */
import { useState } from 'react';
import { Car, UtensilsCrossed, Package, Copy, BedDouble } from 'lucide-react';
import { goApi, STATUS_LABEL, type GoOrder } from './api';
import { Back, Btn, Card, Chip, Col, Empty, Input, Notice, fail, fmt, useLoad, C, GO } from './ui';
import { flash } from '@/shared/flash';

const KIND = { taxi: { Icon: Car, label: 'Такси' }, food: { Icon: UtensilsCrossed, label: 'Еда' }, delivery: { Icon: Package, label: 'Доставка' }, stay: { Icon: BedDouble, label: 'Жильё и отдых' } };
const label = (s: string, kind?: string) => (s === 'searching' && kind && kind !== 'taxi' ? 'Ищем курьера' : s === 'assigned' && kind && kind !== 'taxi' ? 'Курьер назначен' : STATUS_LABEL[s] ?? s);
const addr = (o: GoOrder) => (o.kind === 'stay' ? `${o.data.title ?? ''} · ${o.data.label ?? ''}` : `${o.data.from?.address ?? o.data.place?.name ?? ''}${o.data.to?.address ? ` → ${o.data.to.address}` : o.data.address?.address ? ` → ${o.data.address.address}` : ''}`);

/** Что исполнитель может сделать на каждом шаге. */
export const executorActions = (o: GoOrder): { action: string; text: string; code?: 'pickup' | 'handover'; danger?: boolean; kind: 'taxi' | 'delivery' | 'seller' | 'stay' }[] => {
  const s = o.status;
  if (o.kind === 'stay') return s === 'requested' ? [{ action: 'confirm', text: 'Подтвердить бронь', kind: 'stay' }, { action: 'decline', text: 'Отклонить', danger: true, kind: 'stay' }] : [];
  if (o.kind === 'taxi') return ({
    assigned: [{ action: 'en_route', text: 'Выехал к пассажиру' }, { action: 'release', text: 'Отказаться', danger: true }],
    en_route: [{ action: 'arrived', text: 'Я на месте' }, { action: 'release', text: 'Отказаться', danger: true }],
    arrived: [{ action: 'start', text: 'Начать поездку' }],
    in_ride: [{ action: 'complete', text: 'Завершить поездку' }],
  } as Record<string, any[]>)[s]?.map((a) => ({ ...a, kind: 'taxi' as const })) ?? [];
  if (o.kind === 'delivery') return ({
    assigned: [{ action: 'heading', text: 'Еду за отправлением' }, { action: 'release', text: 'Отказаться', danger: true }],
    heading_pickup: [{ action: 'arrived_pickup', text: 'Я на месте забора' }, { action: 'release', text: 'Отказаться', danger: true }],
    at_pickup: [{ action: 'pickup', text: 'Принять отправление', code: o.data.scenario === 'food' ? undefined : 'pickup' }],
    picked_up: [{ action: 'start_delivery', text: 'Выехал к получателю' }],
    delivering: [{ action: 'arrived_recipient', text: 'Я у получателя' }],
    at_recipient: [{ action: 'deliver', text: 'Вручить', code: 'handover' }],
  } as Record<string, any[]>)[s]?.map((a) => ({ ...a, kind: 'delivery' as const })) ?? [];
  if (o.kind === 'food') return ({
    pending: [{ action: 'accept', text: 'Принять заказ' }, { action: 'reject', text: 'Отказать', danger: true }],
    accepted: [{ action: 'cook', text: 'Готовлю' }, { action: 'reject', text: 'Отказать', danger: true }],
    cooking: [{ action: 'ready', text: 'Готово — вызвать курьера' }],
  } as Record<string, any[]>)[s]?.map((a) => ({ ...a, kind: 'seller' as const })) ?? [];
  return [];
};

export const OrderRow = ({ o, onOpen }: { o: GoOrder; onOpen: () => void }) => {
  const { Icon, label: kl } = KIND[o.kind];
  return (
    <Card onClick={onOpen}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ width: 42, height: 42, borderRadius: 14, background: 'rgba(14,165,164,.12)', display: 'grid', placeItems: 'center', color: GO }}><Icon size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: C.t1 }}>{kl} · {fmt(o.priceRub)}</div>
          <div translate="no" style={{ fontSize: 12.5, color: C.t2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{addr(o)}</div>
        </div>
        <Chip>{label(o.status, o.kind)}</Chip>
      </div>
    </Card>
  );
};

export const OrdersTab = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const [mode, setMode] = useState<'active' | 'history'>('active');
  const [data] = useLoad(() => goApi.orders({ status: mode }), [mode], 8000);
  return (
    <Col>
      <div style={{ display: 'flex', gap: 8 }}>
        {(['active', 'history'] as const).map((m) => (
          <Btn key={m} kind={mode === m ? 'main' : 'soft'} onClick={() => setMode(m)} style={{ height: 38, fontSize: 14 }}>{m === 'active' ? 'Активные' : 'История'}</Btn>
        ))}
      </div>
      {!data?.ok ? <Empty text="Загрузка…" /> : data.data!.orders.length === 0
        ? <Empty text={mode === 'active' ? 'Активных заказов нет.' : 'История пуста.'} />
        : data.data!.orders.map((o) => <OrderRow key={o.id} o={o} onOpen={() => onOpen(o.id)} />)}
    </Col>
  );
};

export const OrderScreen = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const [res, reload] = useLoad(() => goApi.order(id), [id], 5000);
  const [busy, setBusy] = useState(false);
  const [dispute, setDispute] = useState('');
  const [showDispute, setShowDispute] = useState(false);
  const [code, setCode] = useState('');
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const o = res?.ok ? res.data!.order : null;

  const run = async (fn: () => Promise<{ ok: boolean; error?: string; reason?: string; status: number; data?: any }>, done?: string) => {
    setBusy(true); const r = await fn(); setBusy(false);
    if (!r.ok) { fail(r); if (r.data?.left != null) flash(`Осталось попыток: ${r.data.left}`); return false; }
    if (done) flash(done); reload(); return true;
  };

  if (!o) return <><Back onClick={onBack} title="Заказ" /><Empty text={res && !res.ok ? 'Заказ не найден.' : 'Загрузка…'} /></>;
  const mine = o.role === 'executor';
  const acts = mine ? executorActions(o) : [];
  const payer = o.role === 'customer';
  const cancelable = payer && (o.kind === 'stay' ? ['requested', 'awaiting_payment'] : o.kind === 'taxi' ? ['searching', 'assigned', 'en_route', 'arrived'] : o.kind === 'delivery' ? ['searching', 'assigned', 'heading_pickup', 'at_pickup'] : ['pending', 'accepted']).includes(o.status);

  const doAct = (a: ReturnType<typeof executorActions>[number], withCode?: string) => {
    if (a.kind === 'stay') return run(() => goApi.stayAct(o.id, a.action, a.action === 'decline' ? reason : undefined));
    if (a.kind === 'taxi') return run(() => goApi.taxiAct(o.id, a.action));
    if (a.kind === 'delivery') return run(() => goApi.deliveryAct(o.id, a.action, withCode));
    return run(() => goApi.sellerAct(o.id, a.action, a.action === 'reject' ? reason : undefined));
  };
  const copy = (t: string) => { void navigator.clipboard?.writeText(t); flash('Скопировано'); };

  return (
    <>
      <Back onClick={onBack} title={`${KIND[o.kind].label} · ${fmt(o.priceRub)}`} />
      <Col>
        <Card>
          <Chip>{label(o.status, o.kind)}</Chip>
          <div translate="no" style={{ marginTop: 10, fontSize: 15, color: C.t1, lineHeight: 1.45 }}>
            {o.data.from?.address && <div>Откуда: {o.data.from.address}</div>}
            {(o.data.to?.address || o.data.address?.address) && <div>Куда: {o.data.to?.address ?? o.data.address.address}</div>}
            {o.data.items && o.data.items.map((i: any) => <div key={i.id}>{i.name} × {i.qty} — {fmt(i.priceRub * i.qty)}</div>)}
            {o.kind === 'stay' && <>
              <div>{o.data.title}</div>
              {o.data.listingKind === 'tour' ? <div>Отправление: {o.data.date} · человек: {o.data.people}</div> : <div>Даты: {o.data.checkIn} — {o.data.checkOut} ({o.data.nights} н.) · гостей: {o.data.guests}{o.data.roomName ? ` · ${o.data.roomName}` : ''}</div>}
              {o.data.address && (o.role === 'executor' || o.status === 'awaiting_payment' || o.status === 'payment_reported' || o.status === 'paid') && <div>Адрес: {o.data.address}</div>}
              {o.role === 'executor' && o.data.contact && <div>Гость: {o.data.contact.name}, <a href={`tel:${o.data.contact.phone}`}>{o.data.contact.phone}</a></div>}
              {o.data.holdUntil && o.status === 'awaiting_payment' && <div>Оплатить до: {new Date(o.data.holdUntil).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
            </>}
            {o.data.comment && <div>Комментарий: {o.data.comment}</div>}
            {o.data.parcel?.description && <div>Отправление: {o.data.parcel.description}</div>}
          </div>
          {(o.data.recipient?.phone || o.data.sender?.phone) && mine && (
            <div translate="no" style={{ marginTop: 8, fontSize: 14, color: C.t2 }}>
              {o.data.sender && <div>Отправитель: {o.data.sender.name}, <a href={`tel:${o.data.sender.phone}`}>{o.data.sender.phone}</a></div>}
              {o.data.recipient && <div>Получатель: {o.data.recipient.name}, <a href={`tel:${o.data.recipient.phone}`}>{o.data.recipient.phone}</a></div>}
            </div>
          )}
          {o.executor && !mine && (
            <div translate="no" style={{ marginTop: 8, fontSize: 14, color: C.t2 }}>
              Исполнитель: @{o.executor.username}
              {o.executor.car && <div>{o.executor.car.carColor} {o.executor.car.carMake} {o.executor.car.carModel}, {o.executor.car.plate}</div>}
            </div>
          )}
          {o.cancelReason && <Notice tone="warn">Отмена: {o.cancelReason}</Notice>}
        </Card>

        {payer && o.codes && (
          <Card>
            <div style={{ fontWeight: 700, color: C.t1, marginBottom: 6 }}>Коды для курьера</div>
            {o.codes.pickup && <CodeLine title="Код передачи отправления" code={o.codes.pickup.code} onCopy={copy} />}
            {o.codes.handover && <CodeLine title="Код вручения получателю" code={o.codes.handover.code} onCopy={copy} />}
            <Notice>Назовите код курьеру только при передаче/получении. Код одноразовый, после 5 неверных попыток блокируется.</Notice>
          </Card>
        )}

        {o.pay && (
          <Card>
            <div style={{ fontWeight: 700, color: C.t1 }}>Оплата напрямую: {fmt(o.pay.amountRub)}</div>
            <div style={{ fontSize: 13, color: C.t2, margin: '4px 0 8px' }}>Sky не принимает и не удерживает эти деньги — перевод идёт исполнителю напрямую.</div>
            {payer && o.pay.details && (
              <div translate="no" style={{ background: C.l2, borderRadius: 12, padding: 10, fontSize: 14, color: C.t1 }}>
                {Object.entries(o.pay.details).filter(([, v]) => v).map(([k, v]) => <div key={k}><span style={{ color: C.t3 }}>{PAY_LABEL[k] ?? k}:</span> {String(v)}</div>)}
              </div>
            )}
            {payer && o.status === 'awaiting_payment' && <Btn busy={busy} style={{ marginTop: 10, width: '100%' }} onClick={() => run(() => goApi.paid(o.id), 'Исполнитель получил уведомление')}>Я оплатил</Btn>}
            {payer && o.status === 'payment_reported' && <Notice>Ждём подтверждения от исполнителя.</Notice>}
            {mine && o.status === 'payment_reported' && <Btn busy={busy} style={{ marginTop: 10, width: '100%' }} onClick={() => run(() => goApi.confirmPaid(o.id), 'Оплата подтверждена')}>Деньги получил</Btn>}
            {mine && o.status === 'awaiting_payment' && <Notice>Ждём, пока заказчик сообщит об оплате.</Notice>}
            {o.status === 'paid' && <Chip color={C.green}>Оплата подтверждена</Chip>}
          </Card>
        )}

        {acts.length > 0 && (
          <Card>
            <Col>
              {acts.some((a) => a.action === 'reject' || a.action === 'decline') && <Input label="Причина отказа (для отказа)" value={reason} onChange={setReason} />}
              {acts.map((a) => a.code
                ? <Btn key={a.action} busy={busy} onClick={() => setCodeFor(a.action)}>{a.text}</Btn>
                : <Btn key={a.action} kind={a.danger ? 'danger' : 'main'} busy={busy} onClick={() => void doAct(a)}>{a.text}</Btn>)}
              {codeFor && (
                <>
                  <Input label="Код от заказчика (6 цифр)" value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} />
                  <Btn busy={busy} disabled={code.length !== 6} onClick={async () => { const a = acts.find((x) => x.action === codeFor)!; if (await doAct(a, code)) { setCode(''); setCodeFor(null); } }}>Подтвердить</Btn>
                </>
              )}
            </Col>
          </Card>
        )}

        {cancelable && <Btn kind="danger" busy={busy} onClick={() => run(() => (o.kind === 'stay' ? goApi.stayCancel(o.id) : o.kind === 'taxi' ? goApi.taxiCancel(o.id) : o.kind === 'delivery' ? goApi.deliveryCancel(o.id) : goApi.foodCancel(o.id)), 'Заказ отменён')}>Отменить заказ</Btn>}

        {o.events && o.events.length > 0 && (
          <Card>
            <div style={{ fontWeight: 700, color: C.t1, marginBottom: 6 }}>История</div>
            {o.events.map((e, i) => (
              <div key={i} style={{ fontSize: 13, color: C.t2, padding: '3px 0' }}>
                {new Date(e.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — {e.note || label(e.to, o.kind)}
              </div>
            ))}
          </Card>
        )}

        {!['paid', 'cancelled', 'dispute'].includes(o.status) && (o.role === 'customer' || o.role === 'executor') && (
          showDispute ? (
            <Card>
              <Col>
                <Input area label="Что случилось" value={dispute} onChange={setDispute} max={300} />
                <Btn busy={busy} disabled={dispute.trim().length < 5} onClick={async () => { if (await run(() => goApi.dispute(o.id, dispute), 'Спор открыт — администрация рассмотрит')) setShowDispute(false); }}>Открыть спор</Btn>
              </Col>
            </Card>
          ) : <Btn kind="soft" onClick={() => setShowDispute(true)}>Проблема с заказом</Btn>
        )}
        {o.status === 'dispute' && <Notice tone="warn">Открыт спор. Решение примет администрация Sky; вы получите уведомление.</Notice>}
      </Col>
    </>
  );
};

const PAY_LABEL: Record<string, string> = { method: 'Способ', number: 'Номер карты', holder: 'Получатель', bank: 'Банк', account: 'Счёт', bik: 'БИК', phone: 'Телефон' };

const CodeLine = ({ title, code, onCopy }: { title: string; code: string; onCopy: (c: string) => void }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
    <div style={{ fontSize: 13, color: C.t2 }}>{title}</div>
    <button onClick={() => onCopy(code)} style={{ display: 'flex', gap: 8, alignItems: 'center', border: 'none', background: 'none', color: C.t1, fontSize: 22, fontWeight: 800, letterSpacing: 3 }}>{code}<Copy size={15} /></button>
  </div>
);
