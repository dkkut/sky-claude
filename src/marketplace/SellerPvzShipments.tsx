/**
 * Кабинет продавца: «Поставка в ПВЗ».
 *
 * Один физический вывоз — это поставка: несколько заказов сразу, свой
 * QR (его сканирует ПВЗ, чтобы открыть приёмку) и у каждого заказа
 * внутри — свой собственный QR, отдельный от QR поставки. Печатается
 * он на коробку, и печатать нужно каждый раз: без него сотрудник ПВЗ
 * не отличит одну коробку от другой при сканировании.
 *
 * Поставку можно завести только на пункт выдачи, где уже есть свои
 * заказы в статусе «на сборке» (fulfillment) — так их выбрал покупатель
 * при оформлении, и сервер не даст добавить в поставку заказ с другим
 * pickupPointId.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PackagePlus, QrCode, Printer, ArrowLeft, Truck, CheckCircle2,
  AlertTriangle, RefreshCw, X,
} from 'lucide-react';
import { C, fmtTime, Empty, Field, inputStyle, Alert } from './ui';
import { useMarketStore } from './store';
import { apiPickupPoints } from './marketApi';
import type { PickupPoint } from './types';
import {
  apiPvzShipmentCreate, apiPvzShipmentsMine, apiPvzShipmentDetail,
  apiPvzShipmentAddOrder, apiPvzShipmentRemoveOrder, apiPvzShipmentQr, apiPvzShipmentDispatch,
  type PvzShipment, type PvzShipmentDetail, type ShipmentMethod,
} from './pvzShipmentsApi';
import { apiOrderQr } from './pvzStaffApi';
import { qrDataUri } from '@/shared/qr';
import { ReportProblemButton } from './pvzSupport';

const METHOD_LABEL: Record<ShipmentMethod, string> = {
  seller_self: 'Везу сам', carrier: 'Службой доставки', other: 'Другое',
};
const STATUS_LABEL: Record<PvzShipment['status'], string> = {
  created: 'Собирается', shipped: 'В пути / на приёмке',
  received: 'Принята полностью', received_partial: 'Принята частично', cancelled: 'Отменена',
};
const STATUS_COLOR: Record<PvzShipment['status'], string> = {
  created: C.t2, shipped: C.amber, received: C.green, received_partial: C.amber, cancelled: C.red,
};

/* ── QR-код заказа для одной коробки ──────────────────────────────── */

const OrderQrButton = ({ orderId, title }: { orderId: string; title: string }) => {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = async () => {
    setOpen(true); setBusy(true);
    const r = await apiOrderQr(orderId);
    setBusy(false);
    if (r.ok && r.data) setPayload(r.data.payload);
  };

  return (
    <>
      <button type="button" onClick={show}
        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold"
        style={{ background: C.accBg, color: C.acc }}>
        <QrCode size={11} /> QR заказа
      </button>
      {open && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs space-y-3 rounded-2xl p-4 text-center"
            style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="truncate text-[12px] font-bold" style={{ color: C.t1 }}>{title}</p>
            {busy && <p className="text-[11px]" style={{ color: C.t3 }}>Готовим…</p>}
            {payload && (
              <img src={qrDataUri(payload, { size: 220 })} alt="QR заказа"
                className="mx-auto rounded-xl bg-white p-2" width={220} height={220} />
            )}
            <p className="text-[10px]" style={{ color: C.t3 }}>
              Каждый физический заказ, который отправляется в ПВЗ, должен иметь QR-код
              этого заказа на упаковке.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)}
                className="flex-1 rounded-xl py-2 text-[11px] font-bold"
                style={{ background: C.l2, color: C.t2 }}>Закрыть</button>
              <button type="button" onClick={() => window.print()} disabled={!payload}
                className="flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-bold disabled:opacity-40"
                style={{ background: C.acc, color: '#fff' }}>
                <Printer size={12} /> Печать
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/* ── Одна поставка целиком ────────────────────────────────────────── */

const ShipmentDetailView = ({ shipmentId, onBack, onChanged }:
{ shipmentId: string; onBack: () => void; onChanged: () => void }) => {
  const { ordersSell, loadOrders } = useMarketStore();
  const [shipment, setShipment] = useState<PvzShipmentDetail | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiPvzShipmentDetail(shipmentId);
    if (r.ok && r.data) setShipment(r.data.shipment);
    const q = await apiPvzShipmentQr(shipmentId);
    if (q.ok && q.data) setQr(q.data.payload);
  }, [shipmentId]);

  useEffect(() => { void load(); void loadOrders('seller'); }, [load]);

  const addedIds = useMemo(() => new Set(shipment?.items.map((i) => i.orderId) ?? []), [shipment]);
  const eligible = useMemo(() => ordersSell.filter((o) =>
    o.status === 'fulfillment' && o.pickupPointId === shipment?.pvzId && !addedIds.has(o.id)), [ordersSell, shipment, addedIds]);

  const addOrder = async (orderId: string) => {
    setError(null);
    const r = await apiPvzShipmentAddOrder(shipmentId, orderId);
    if (!r.ok) { setError(r.reason ?? 'Не удалось добавить заказ'); return; }
    await load();
  };
  const removeOrder = async (orderId: string) => {
    const r = await apiPvzShipmentRemoveOrder(shipmentId, orderId);
    if (r.ok) await load();
  };
  const dispatch = async () => {
    setBusy(true); setError(null);
    const r = await apiPvzShipmentDispatch(shipmentId);
    setBusy(false);
    if (!r.ok) {
      setError(r.error === 'empty_shipment' ? 'В поставке нет ни одного заказа'
        : r.reason ?? 'Не получилось подтвердить отправку');
      return;
    }
    await load(); onChanged();
  };

  if (!shipment) return <p className="p-4 text-[12px]" style={{ color: C.t3 }}>Загружаем…</p>;

  const missing = shipment.items.filter((i) => i.status === 'missing');

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <button type="button" onClick={onBack}
        className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: C.acc }}>
        <ArrowLeft size={13} /> Все поставки
      </button>

      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>{shipment.pvzTitle}</p>
          <span className="text-[10px] font-bold" style={{ color: STATUS_COLOR[shipment.status] }}>
            {STATUS_LABEL[shipment.status]}
          </span>
        </div>
        <p className="mt-0.5 text-[11px]" style={{ color: C.t3 }}>
          {METHOD_LABEL[shipment.method]} · {shipment.receivedCount}/{shipment.expectedCount} принято
        </p>
      </div>

      {missing.length > 0 && (
        <div className="space-y-2">
          <Alert kind="error" text={`Не получены ПВЗ: ${missing.map((i) => i.title).join(', ')}. Свяжитесь с покупателями или откройте спор по заказу.`} />
          <ReportProblemButton subject="ПВЗ не получил часть поставки" label="Сообщить в поддержку" context={{
            'Поставка': shipment.id, 'Точка': shipment.pvzTitle,
            'Не получены заказы': missing.map((i) => `${i.orderId} (${i.title})`).join('; '),
          }} />
        </div>
      )}
      {error && <Alert text={error} />}

      {qr && shipment.status === 'created' && (
        <div className="flex flex-col items-center gap-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[11px] font-semibold" style={{ color: C.t2 }}>QR поставки — покажите сотруднику ПВЗ при сдаче</p>
          <img src={qrDataUri(qr, { size: 180 })} alt="QR поставки" className="rounded-xl bg-white p-2" width={180} height={180} />
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold" style={{ color: C.t3 }}>В поставке · {shipment.items.length}</p>
        {shipment.items.length === 0 && <Empty title="Заказов пока нет" Icon={PackagePlus} />}
        {shipment.items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 rounded-xl p-2.5"
            style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold" style={{ color: C.t1 }}>{it.title}</p>
              <p className="text-[10px]" style={{
                color: it.status === 'received' ? C.green : it.status === 'missing' ? C.red : C.t3,
              }}>
                {it.status === 'received' ? 'Принят ПВЗ' : it.status === 'missing' ? 'Не найден при приёмке' : 'Ожидает приёмки'}
              </p>
            </div>
            <OrderQrButton orderId={it.orderId} title={it.title ?? it.orderId} />
            {shipment.status === 'created' && (
              <button type="button" onClick={() => void removeOrder(it.orderId)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-lg" style={{ background: C.l2, color: C.t3 }}>
                <X size={11} />
              </button>
            )}
          </div>
        ))}
      </div>

      {shipment.status === 'created' && eligible.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold" style={{ color: C.t3 }}>Можно добавить</p>
          {eligible.map((o) => (
            <button key={o.id} type="button" onClick={() => void addOrder(o.id)}
              className="flex w-full items-center justify-between rounded-xl p-2.5 text-left"
              style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
              <span className="truncate text-[11px]" style={{ color: C.t1 }}>{o.title}</span>
              <span className="shrink-0 text-[10px] font-bold" style={{ color: C.acc }}>Добавить</span>
            </button>
          ))}
        </div>
      )}

      {shipment.status === 'created' && (
        <button type="button" disabled={busy || shipment.items.length === 0} onClick={dispatch}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          <Truck size={14} /> Подтвердить отправку
        </button>
      )}
    </div>
  );
};

/* ── Список поставок и создание новой ─────────────────────────────── */

export const SellerPvzShipments = () => {
  const { ordersSell, loadOrders } = useMarketStore();
  const [shipments, setShipments] = useState<PvzShipment[]>([]);
  const [points, setPoints] = useState<Record<string, PickupPoint>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pvzId, setPvzId] = useState('');
  const [method, setMethod] = useState<ShipmentMethod>('seller_self');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiPvzShipmentsMine();
    if (r.ok && r.data) setShipments(r.data.shipments);
  }, []);

  useEffect(() => {
    void load();
    void loadOrders('seller');
    void (async () => {
      const r = await apiPickupPoints();
      if (r.ok && r.data) setPoints(Object.fromEntries(r.data.points.map((p) => [p.id, p])));
    })();
  }, [load]);

  /* Точки, где у продавца уже есть заказы «на сборке» — только туда и
     можно собрать поставку. */
  const pendingByPvz = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of ordersSell) {
      if (o.status === 'fulfillment' && o.pickupPointId) {
        m.set(o.pickupPointId, (m.get(o.pickupPointId) ?? 0) + 1);
      }
    }
    return m;
  }, [ordersSell]);

  const create = async () => {
    if (!pvzId) return;
    setError(null);
    const r = await apiPvzShipmentCreate(pvzId, method);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Не получилось завести поставку'); return; }
    setCreating(false); setPvzId('');
    await load();
    setOpen(r.data.id);
  };

  if (open) {
    return <ShipmentDetailView shipmentId={open} onBack={() => { setOpen(null); void load(); }} onChanged={load} />;
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <div className="rounded-2xl px-3 py-2 text-[11px]" style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>
        Каждый физический заказ, который отправляется в ПВЗ, должен иметь QR-код этого заказа
        на упаковке. QR поставки открывает приёмку целиком, а QR заказа — отдельную коробку внутри неё.
      </div>

      {!creating ? (
        <button type="button" onClick={() => setCreating(true)} disabled={pendingByPvz.size === 0}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
          style={{ background: C.accBg, color: C.acc }}>
          <PackagePlus size={14} /> Собрать поставку
        </button>
      ) : (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <Field label="Пункт выдачи">
            <select value={pvzId} onChange={(e) => setPvzId(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
              <option value="">Выберите точку</option>
              {[...pendingByPvz.entries()].map(([id, n]) => (
                <option key={id} value={id}>
                  {points[id] ? `${points[id].city}, ${points[id].address}` : id} — {n} на сборке
                </option>
              ))}
            </select>
          </Field>
          <Field label="Как везёте">
            <div className="flex gap-1.5">
              {(Object.keys(METHOD_LABEL) as ShipmentMethod[]).map((m) => (
                <button key={m} type="button" onClick={() => setMethod(m)}
                  className="flex-1 rounded-lg py-1.5 text-[10px] font-bold"
                  style={{ background: method === m ? C.accBg : C.l2, color: method === m ? C.acc : C.t3 }}>
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </Field>
          {error && <Alert text={error} />}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setCreating(false); setError(null); }}
              className="flex-1 rounded-xl py-2 text-[11px] font-bold" style={{ background: C.l2, color: C.t2 }}>Отмена</button>
            <button type="button" disabled={!pvzId} onClick={create}
              className="flex-1 rounded-xl py-2 text-[11px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
              Завести поставку
            </button>
          </div>
        </div>
      )}

      {shipments.length === 0 && <Empty title="Поставок пока нет" hint="Соберите заказы одного пункта выдачи в одну поставку" Icon={Truck} />}

      <div className="space-y-1.5">
        {shipments.map((s) => (
          <button key={s.id} type="button" onClick={() => setOpen(s.id)}
            className="flex w-full items-center gap-2 rounded-xl p-3 text-left"
            style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            {s.status === 'received' ? <CheckCircle2 size={14} style={{ color: C.green }} />
              : s.status === 'received_partial' ? <AlertTriangle size={14} style={{ color: C.amber }} />
                : <RefreshCw size={14} style={{ color: C.t3 }} />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold" style={{ color: C.t1 }}>{s.pvzTitle}</p>
              <p className="text-[10px]" style={{ color: C.t3 }}>
                {s.receivedCount}/{s.expectedCount} · {fmtTime(s.createdAt)}
              </p>
            </div>
            <span className="shrink-0 text-[10px] font-bold" style={{ color: STATUS_COLOR[s.status] }}>
              {STATUS_LABEL[s.status]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
