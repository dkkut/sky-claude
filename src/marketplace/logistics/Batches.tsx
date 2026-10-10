/**
 * Поставки: продавец собирает пакет своих заказов для развоза и передаёт
 * курьеру; у курьера по адресам строится маршрут. Всё решает сервер
 * (server/logibatches.mjs) — здесь только экраны.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Package, MapPin, Route as RouteIcon, Truck, Check, RefreshCw } from 'lucide-react';
import { C } from '../SkyMarket';
import { EmptyState } from './shared';
import { useCourierStore } from './courierStore';
import {
  apiBatches, apiBatch, apiEligibleOrders, apiCreateBatch, apiCancelBatch, apiHandoffBatch, apiBuildRoute,
  apiPoolBatches, apiTakeBatch, batchMapUrl, batchError,
  type Batch, type BatchItem, type EligibleOrder,
} from './batchApi';

const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Черновик', color: C.t3 }, open: { label: 'В пуле', color: C.amber }, handed: { label: 'У курьера', color: C.acc },
  done: { label: 'Выполнена', color: C.green }, cancelled: { label: 'Отменена', color: C.red },
};
const ITEM_STATUS: Record<string, string> = { assigned: 'ждёт забора', picked_up: 'забран', in_transit: 'в пути', delivered: 'доставлен', problem: 'проблема' };

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} км` : `${m} м`);
const fmtDur = (s: number) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };
const Wait = () => <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
const box = { background: C.l1, border: `1px solid ${C.brd}` } as const;

/* ── Карточка поставки: состав, маршрут, карта, действия ─────────────── */

const BatchDetail = ({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) => {
  const [d, setD] = useState<{ batch: Batch; items: BatchItem[]; role: 'seller' | 'courier' } | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const [proof, setProof] = useState<Record<string, string>>({});
  const { couriers, myCollabs, load, confirmPickup, confirmDelivery } = useCourierStore();
  const [courierId, setCourierId] = useState(''); const [price, setPrice] = useState('200'); const [district, setDistrict] = useState('');

  const refresh = useCallback(async () => {
    const r = await apiBatch(id);
    if (r.ok && r.data) setD(r.data); else setErr(batchError(r.error));
  }, [id]);
  useEffect(() => { void refresh(); void load(); }, [refresh, load]);

  if (!d) return <div className="p-4">{err ? <p className="text-[12px]" style={{ color: C.red }}>{err}</p> : <Wait />}</div>;
  const { batch, items, role } = d;
  const route = batch.route;
  const stopNo = (orderId: string) => { const i = route?.order.findIndex((p) => p.id === orderId) ?? -1; return i >= 0 ? i + 1 : null; };
  const leg = (orderId: string) => route?.legs.find((l) => l.id === orderId);
  const acceptedCouriers = couriers.filter((c) => myCollabs().some((co) => co.courierId === c.id && co.status === 'accepted'));

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, ok = '') => {
    setBusy(true); setErr(''); setMsg('');
    const r = await fn(); setBusy(false);
    if (!r.ok) { setErr(batchError(r.error)); return; }
    if (ok) setMsg(ok);
    await refresh(); onChanged();
  };
  const build = () => run(async () => { const r = await apiBuildRoute(id); if (r.ok && r.data) setD(r.data); return { ok: r.ok, error: r.error }; }, 'Маршрут построен.');

  const confirm = async (it: BatchItem, kind: 'pickup' | 'delivery') => {
    const code = (proof[it.orderId] ?? '').trim(); if (!code) return;
    setBusy(true); setErr(''); setMsg('');
    const r = kind === 'pickup' ? await confirmPickup(it.orderId, code) : await confirmDelivery(it.orderId, code);
    setBusy(false); setProof((p) => ({ ...p, [it.orderId]: '' }));
    if (!r.ok) { setErr('Код или QR не подошёл.'); return; }
    setMsg(kind === 'pickup' ? 'Получение подтверждено.' : 'Доставка подтверждена.'); await refresh(); onChanged();
  };

  return (
    <div className="space-y-3 p-4">
      <button type="button" onClick={onBack} className="text-[11px] font-semibold" style={{ color: C.acc }}>← К поставкам</button>
      <div className="rounded-2xl p-3" style={box}>
        <div className="flex items-center gap-2"><p className="flex-1 truncate text-[14px] font-bold" style={{ color: C.t1 }} translate="no">{batch.title}</p>
          <span className="rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ background: C.l2, color: STATUS[batch.status]?.color }}>{STATUS[batch.status]?.label}</span></div>
        {role === 'seller' && <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Забор: <span translate="no">{batch.originAddress}</span>{!batch.hasOrigin && ' · адрес не найден на карте'}</p>}
        <p className="text-[11px]" style={{ color: C.t3 }}>{`Заказов: ${items.length}`}</p>
      </div>

      {route && (
        <div className="space-y-2 rounded-2xl p-3" style={box}>
          <div className="flex items-center gap-2"><RouteIcon size={14} style={{ color: C.acc }} /><p className="text-[12px] font-bold" style={{ color: C.t1 }}>{`Маршрут: ${route.order.length} остановок · ${fmtDist(route.distanceM)} · ${fmtDur(route.durationS)}`}</p></div>
          <p className="text-[10px]" style={{ color: C.t3 }}>{route.origin.kind === 'courier' ? 'Считается от вашей текущей точки.' : 'Считается от точки забора.'} Время и расстояние даёт сервис карт без учёта пробок на момент выезда.</p>
          <img src={batchMapUrl(batch.id, route.builtAt)} alt="" className="w-full rounded-xl" style={{ background: C.l2, minHeight: 120 }} />
          {route.unresolved.length > 0 && <p className="text-[11px]" style={{ color: C.red }}>{`Адрес не найден на карте у заказов: ${route.unresolved.length} — они не вошли в маршрут, проверьте адрес.`}</p>}
        </div>
      )}

      <div className="space-y-2">
        {items.map((it) => {
          const n = stopNo(it.orderId); const l = leg(it.orderId);
          return (
            <div key={it.orderId} className="space-y-1 rounded-2xl p-3" style={box}>
              <div className="flex items-center gap-2">
                {n && <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black text-white" style={{ background: C.acc }}>{n}</span>}
                <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" style={{ color: C.t1 }} translate="no">{it.title}{it.quantity > 1 ? ` × ${it.quantity}` : ''}</p>
                {it.assignmentStatus && <span className="text-[10px] font-bold" style={{ color: C.t3 }}>{ITEM_STATUS[it.assignmentStatus] ?? it.assignmentStatus}</span>}
              </div>
              <p className="flex items-start gap-1 text-[11px]" style={{ color: C.t2 }}><MapPin size={11} className="mt-0.5 shrink-0" /><span translate="no">{it.address}</span></p>
              {l && <p className="text-[10px]" style={{ color: C.t3 }}>{`От предыдущей точки: ${fmtDist(l.distanceM)}, ${fmtDur(l.durationS)}`}</p>}
              {role === 'courier' && it.assignmentId && ['assigned', 'picked_up', 'in_transit'].includes(it.assignmentStatus ?? '') && (
                <div className="flex gap-1.5 pt-1">
                  <input value={proof[it.orderId] ?? ''} onChange={(e) => setProof((p) => ({ ...p, [it.orderId]: e.target.value }))} placeholder="Код или QR" className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[12px]" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }} />
                  {it.assignmentStatus === 'assigned'
                    ? <button type="button" disabled={busy} onClick={() => void confirm(it, 'pickup')} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Забрал</button>
                    : <button type="button" disabled={busy} onClick={() => void confirm(it, 'delivery')} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40" style={{ background: C.green }}>Вручил</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {msg && <p className="text-[12px]" style={{ color: C.green }}>{msg}</p>}
      {err && <p className="text-[12px]" style={{ color: C.red }}>{err}</p>}

      <div className="flex flex-wrap gap-2">
        {['draft', 'open', 'handed'].includes(batch.status) && (
          <button type="button" disabled={busy} onClick={() => void build()} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1 }}>
            {busy ? <Wait /> : <RefreshCw size={13} />}{route ? 'Перестроить маршрут' : 'Построить маршрут'}</button>
        )}
        {role === 'seller' && batch.status === 'draft' && (
          <button type="button" disabled={busy} onClick={() => { if (confirmWindow('Отменить поставку? Заказы вернутся в список.')) void run(() => apiCancelBatch(id).then((r) => ({ ok: r.ok, error: r.error })), '').then(onBack); }} className="rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ color: C.red }}>Отменить поставку</button>
        )}
      </div>

      {role === 'seller' && batch.status === 'draft' && (
        <div className="space-y-2 rounded-2xl p-3" style={{ ...box, border: `1px solid ${C.acc}` }}>
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Передать курьеру</p>
          {acceptedCouriers.length === 0
            ? <p className="text-[11px]" style={{ color: C.t3 }}>Нет курьеров с принятой заявкой о сотрудничестве. Найдите курьера во вкладке «Поиск» и отправьте заявку — или выставьте поставку в пул.</p>
            : <select value={courierId} onChange={(e) => setCourierId(e.target.value)} className="w-full rounded-lg px-2 py-2 text-[12px]" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
              <option value="">Выберите курьера</option>{acceptedCouriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          <button type="button" disabled={busy || !courierId} onClick={() => void run(() => apiHandoffBatch(id, { courierId }).then((r) => ({ ok: r.ok, error: r.error })), 'Поставка передана курьеру.')} className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12.5px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}><Truck size={14} />Передать курьеру</button>
          <p className="pt-1 text-[11px]" style={{ color: C.t3 }}>Или выставить в пул — первый подходящий курьер возьмёт всю поставку:</p>
          <div className="flex gap-2">
            <input value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Цена за поставку, ₽" className="w-32 rounded-lg px-2 py-1.5 text-[12px]" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }} />
            <input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="Район (необязательно)" className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[12px]" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }} />
          </div>
          <button type="button" disabled={busy} onClick={() => void run(() => apiHandoffBatch(id, { pool: true, priceKop: Number(price || 0) * 100, cityId: couriers[0]?.cityId ?? '', district }).then((r) => ({ ok: r.ok, error: r.error })), 'Поставка выставлена в пул.')} className="w-full rounded-xl py-2 text-[12px] font-semibold disabled:opacity-40" style={{ background: C.l2, color: C.t1 }}>Выставить в пул</button>
        </div>
      )}
    </div>
  );
};
const confirmWindow = (t: string) => { try { return window.confirm(t); } catch { return true; } };

/* ── Сборка поставки ─────────────────────────────────────────────────── */

const NewBatch = ({ onBack, onCreated }: { onBack: () => void; onCreated: (id: string) => void }) => {
  const [orders, setOrders] = useState<EligibleOrder[] | null>(null); const [sel, setSel] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState(''); const [origin, setOrigin] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { void apiEligibleOrders().then((r) => setOrders(r.ok && r.data ? r.data.orders : [])); }, []);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const create = async () => {
    setBusy(true); setErr('');
    const r = await apiCreateBatch({ title: title.trim(), orderIds: [...sel], originAddress: origin.trim() });
    setBusy(false);
    if (!r.ok || !r.data) { setErr(batchError(r.error)); return; }
    onCreated(r.data.id);
  };
  return (
    <div className="space-y-3 p-4">
      <button type="button" onClick={onBack} className="text-[11px] font-semibold" style={{ color: C.acc }}>← К поставкам</button>
      <p className="text-[14px] font-bold" style={{ color: C.t1 }}>Новая поставка</p>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название (например, «Утренний развоз»)" maxLength={80} className="w-full rounded-xl px-3 py-2 text-[12px]" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }} />
      <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Адрес, откуда курьер заберёт заказы" className="w-full rounded-xl px-3 py-2 text-[12px]" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }} />
      <p className="text-[11px]" style={{ color: C.t3 }}>Доступны ваши оплаченные заказы с доставкой на адрес, которые уже собираются или готовы к отправке (не больше 20 в поставке).</p>
      {orders === null ? <Wait /> : orders.length === 0 ? <EmptyState icon={Package} title="Нет заказов для развоза" sub="Здесь появятся оплаченные заказы с адресом доставки" />
        : orders.map((o) => (
          <button key={o.id} type="button" onClick={() => toggle(o.id)} className="flex w-full items-start gap-2 rounded-2xl p-3 text-left" style={{ ...box, border: `1px solid ${sel.has(o.id) ? C.acc : C.brd}` }}>
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ background: sel.has(o.id) ? C.acc : C.l2 }}>{sel.has(o.id) && <Check size={12} color="#fff" />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold" style={{ color: C.t1 }} translate="no">{o.title}{o.quantity > 1 ? ` × ${o.quantity}` : ''}</span>
              <span className="block text-[11px]" style={{ color: C.t3 }} translate="no">{o.address}</span></span>
          </button>))}
      {err && <p className="text-[12px]" style={{ color: C.red }}>{err}</p>}
      <button type="button" disabled={busy || sel.size === 0 || origin.trim().length < 4} onClick={() => void create()} className="w-full rounded-xl py-3 text-[13px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>{busy ? 'Собираю…' : `Собрать поставку (${sel.size})`}</button>
    </div>
  );
};

/* ── Продавец: список поставок ───────────────────────────────────────── */

export const SellerBatches = () => {
  const [list, setList] = useState<Batch[] | null>(null); const [open, setOpen] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const load = useCallback(async () => { const r = await apiBatches('seller'); setList(r.ok && r.data ? r.data.batches : []); }, []);
  useEffect(() => { void load(); }, [load]);
  if (creating) return <NewBatch onBack={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpen(id); void load(); }} />;
  if (open) return <BatchDetail id={open} onBack={() => { setOpen(null); void load(); }} onChanged={() => void load()} />;
  return (
    <div className="space-y-2 p-4">
      <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12.5px] font-bold text-white" style={{ background: C.acc }}><Package size={14} />Собрать поставку</button>
      {list === null ? <Wait /> : list.length === 0 ? <EmptyState icon={Truck} title="Поставок пока нет" sub="Соберите пакет заказов для развоза и передайте его курьеру" />
        : list.map((b) => (
          <button key={b.id} type="button" onClick={() => setOpen(b.id)} className="block w-full rounded-2xl p-3 text-left" style={box}>
            <span className="flex items-center gap-2"><span className="flex-1 truncate text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{b.title}</span>
              <span className="rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ background: C.l2, color: STATUS[b.status]?.color }}>{STATUS[b.status]?.label}</span></span>
            <span className="text-[11px]" style={{ color: C.t3 }}>{`Заказов: ${b.orders ?? 0}`}{b.route ? ` · ${fmtDist(b.route.distanceM)} · ${fmtDur(b.route.durationS)}` : ''}</span>
          </button>))}
    </div>
  );
};

/* ── Курьер: мои поставки и пул ──────────────────────────────────────── */

export const CourierBatches = ({ online }: { online: boolean }) => {
  const [mine, setMine] = useState<Batch[] | null>(null); const [pool, setPool] = useState<Batch[]>([]); const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    const [m, p] = await Promise.all([apiBatches('courier'), apiPoolBatches()]);
    setMine(m.ok && m.data ? m.data.batches : []); setPool(p.ok && p.data ? p.data.batches : []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (open) return <BatchDetail id={open} onBack={() => { setOpen(null); void load(); }} onChanged={() => void load()} />;
  const take = async (id: string) => { setBusy(id); setErr(''); const r = await apiTakeBatch(id); setBusy(''); if (!r.ok) setErr(batchError(r.error)); else setOpen(id); void load(); };
  return (
    <div className="space-y-3 py-3">
      <p className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: C.t1 }}><Truck size={14} />Поставки</p>
      {err && <p className="text-[12px]" style={{ color: C.red }}>{err}</p>}
      {mine === null ? <Wait /> : mine.length === 0 ? <p className="text-[11px]" style={{ color: C.t3 }}>Переданных вам поставок пока нет.</p>
        : mine.map((b) => (
          <button key={b.id} type="button" onClick={() => setOpen(b.id)} className="block w-full rounded-2xl p-3 text-left" style={box}>
            <span className="flex items-center gap-2"><span className="flex-1 truncate text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{b.title}</span>
              <span className="rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ background: C.l2, color: STATUS[b.status]?.color }}>{STATUS[b.status]?.label}</span></span>
            <span className="text-[11px]" style={{ color: C.t3 }}>{`Заказов: ${b.orders ?? 0}`}{b.route ? ` · ${fmtDist(b.route.distanceM)} · ${fmtDur(b.route.durationS)}` : ' · маршрут не построен'}</span>
          </button>))}
      {pool.length > 0 && <p className="pt-1 text-[11px] font-bold" style={{ color: C.t2 }}>Открытые поставки в вашем районе</p>}
      {pool.map((b) => (
        <div key={b.id} className="flex items-center gap-2 rounded-2xl p-3" style={box}>
          <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold" style={{ color: C.t1 }} translate="no">{b.title}</span>
            <span className="text-[11px]" style={{ color: C.t3 }}>{`Заказов: ${b.orders ?? 0} · ${b.price.toLocaleString('ru-RU')} ₽`}</span></span>
          <button type="button" disabled={!online || busy === b.id} onClick={() => void take(b.id)} className="shrink-0 rounded-xl px-3 py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>{online ? 'Взять' : 'Выйдите на связь'}</button>
        </div>))}
    </div>
  );
};
