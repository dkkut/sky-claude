/** Sky для бизнеса → Sky GO → «Транспорт»: топливо, удобства, акции, заказ-наряды (ход работ), оплата через SkyKassa Business. Доступно организациям категорий «Для транспорта». */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { goError } from '@/go/api';
import { trOwner, WORK_LABEL, type TrPromo, type TrWork } from '@/go/transportApi';
import { Btn, In, Stat, card } from './ui';

type R<T = unknown> = { ok: boolean; data?: T; error?: string; reason?: string; status?: number };
const Box = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="rounded-2xl p-4" style={card}><p className="mb-2 text-sm font-black" style={{ color: 'var(--t1)' }}>{title}</p>{children}</div>;
const useRun = () => {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<R<T>>, after?: (d: T) => void) => { if (busy) return; setBusy(true); try { const r = await fn(); if (!r.ok) { flash(goError(r)); return; } after?.(r.data as T); } finally { setBusy(false); } };
  return [busy, run] as const;
};

const Features = () => {
  const [cat, setCat] = useState<Record<string, string>>({}); const [on, setOn] = useState<string[]>([]); const [busy, run] = useRun();
  useEffect(() => { void trOwner.catalog().then((r) => r.ok && setCat(r.data!.features)); }, []);
  return (
    <Box title="Услуги и удобства">
      <div className="flex flex-wrap gap-1.5">{Object.entries(cat).map(([k, n]) => (
        <button key={k} type="button" aria-pressed={on.includes(k)} onClick={() => setOn((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))} className="rounded-full px-3 py-1.5 text-xs font-semibold"
          style={on.includes(k) ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--bg-l2)', color: 'var(--t2)' }}>{n}</button>))}</div>
      <div className="mt-3"><Btn tone="accent" disabled={busy} onClick={() => void run(() => trOwner.setFeatures(on), () => flash('Сохранено'))}>Сохранить удобства</Btn></div>
    </Box>
  );
};

const FuelPrices = () => {
  const [fuels, setFuels] = useState<Record<string, string>>({}); const [rows, setRows] = useState<Record<string, { price: string; available: boolean }>>({}); const [busy, run] = useRun(); const [no, setNo] = useState(false);
  useEffect(() => { void trOwner.fuel().then((r) => {
    if (!r.ok) { if (r.error === 'not_transport') setNo(true); return; }
    setFuels(r.data!.fuels); setRows(Object.fromEntries(r.data!.prices.map((p) => [p.fuel, { price: String(p.priceRub), available: p.available }])));
  }); }, []);
  if (no) return null;
  const save = () => void run(() => trOwner.setFuel(Object.entries(rows).filter(([, v]) => v.price.trim()).map(([fuel, v]) => ({ fuel, priceRub: Number(v.price.replace(',', '.')), available: v.available }))), () => flash('Цены сохранены'));
  return (
    <Box title="Цены на топливо">
      <p className="mb-2 text-[11px]" style={{ color: 'var(--t3)' }}>Только для категории «Заправки и АЗС». Цены вносите вы; клиенты видят дату обновления, через 7 дней цена помечается как устаревшая. Пустое поле — вида топлива нет.</p>
      <div className="grid gap-2 sm:grid-cols-2">{Object.entries(fuels).map(([k, n]) => (
        <div key={k} className="flex items-end gap-2">
          <div className="flex-1"><In label={`${n}, ₽`} value={rows[k]?.price ?? ''} ph="например 61.40" max={8} onChange={(v) => setRows((x) => ({ ...x, [k]: { price: v, available: x[k]?.available ?? true } }))} /></div>
          <label className="mb-2 flex items-center gap-1 text-[11px]" style={{ color: 'var(--t3)' }}><input type="checkbox" checked={rows[k]?.available ?? true} onChange={(e) => setRows((x) => ({ ...x, [k]: { price: x[k]?.price ?? '', available: e.target.checked } }))} />есть</label>
        </div>))}</div>
      <div className="mt-3"><Btn tone="accent" disabled={busy} onClick={save}>Сохранить цены</Btn></div>
    </Box>
  );
};

const Promos = () => {
  const [list, setList] = useState<TrPromo[]>([]); const [f, setF] = useState({ title: '', body: '', startsOn: '', endsOn: '' }); const [busy, run] = useRun();
  const load = useCallback(() => { void trOwner.promos().then((r) => r.ok && setList(r.data!.promos)); }, []); useEffect(load, [load]);
  return (
    <Box title="Акции">
      {list.map((p) => <div key={p.id} className="mb-1.5 flex items-start justify-between gap-2 text-sm" style={{ color: 'var(--t1)' }}><span translate="no"><b>{p.title}</b>{p.body ? ` — ${p.body}` : ''}{p.endsOn ? ` (до ${p.endsOn})` : ''}</span>
        <button type="button" aria-label="Удалить акцию" onClick={() => void run(() => trOwner.delPromo(p.id), load)}><Trash2 size={15} /></button></div>)}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <In label="Название" value={f.title} onChange={(v) => setF({ ...f, title: v })} max={80} /><In label="Описание" value={f.body} onChange={(v) => setF({ ...f, body: v })} max={400} />
        <In label="С (ГГГГ-ММ-ДД)" value={f.startsOn} onChange={(v) => setF({ ...f, startsOn: v })} max={10} /><In label="По (ГГГГ-ММ-ДД)" value={f.endsOn} onChange={(v) => setF({ ...f, endsOn: v })} max={10} />
      </div>
      <div className="mt-2"><Btn tone="accent" disabled={busy} onClick={() => void run(() => trOwner.addPromo(f), () => { setF({ title: '', body: '', startsOn: '', endsOn: '' }); load(); })}>Добавить акцию</Btn></div>
    </Box>
  );
};

const WorkRow = ({ w, reload }: { w: TrWork; reload: () => void }) => {
  const [busy, run] = useRun(); const [price, setPrice] = useState(w.priceRub != null ? String(w.priceRub) : ''); const [note, setNote] = useState('');
  const go = (to: string) => void run(() => {
    if (to === 'cancelled' && !note.trim()) { flash('Укажите причину отмены в поле «Комментарий»'); return Promise.resolve({ ok: true } as R); }
    return trOwner.status(w.id, to, note, price ? Number(price) : undefined);
  }, () => { setNote(''); reload(); });
  const pay = (kind: 'prepay' | 'full') => void run(() => trOwner.pay(w.id, kind, kind === 'prepay' ? Number(window.prompt('Сумма предоплаты, ₽') || 0) : undefined), (d) => { flash(`Страница оплаты создана: ${(d as { payUrl: string }).payUrl}`); reload(); });
  const next = w.actions.filter((a) => a !== 'cancelled');
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--bg-l2)' }}>
      <div className="flex justify-between gap-2 text-sm" style={{ color: 'var(--t1)' }}><b translate="no">{w.title}</b><span>{w.statusLabel}</span></div>
      <p className="text-xs" style={{ color: 'var(--t3)' }} translate="no">{w.buyer ? `@${w.buyer.username}` : ''}{w.vehicle.model ? ` · ${w.vehicle.model}` : ''}{w.vehicle.plate ? ` · ${w.vehicle.plate}` : ''} · {w.payLabel}{w.paidRub ? ` (${w.paidRub} ₽)` : ''}</p>
      {!['issued', 'cancelled'].includes(w.status) && <>
        <div className="mt-2 grid grid-cols-2 gap-2"><In label="Стоимость, ₽" value={price} onChange={(v) => setPrice(v.replace(/\D/g, ''))} max={8} /><In label="Комментарий клиенту" value={note} onChange={setNote} max={300} /></div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {next.map((a) => <Btn key={a} small disabled={busy} onClick={() => go(a)}>→ {WORK_LABEL[a]}</Btn>)}
          {w.actions.includes('cancelled') && <Btn small tone="danger" disabled={busy} onClick={() => go('cancelled')}>Отменить</Btn>}
          {w.priceRub ? <><Btn small disabled={busy} onClick={() => pay('prepay')}>Запросить предоплату</Btn><Btn small disabled={busy} onClick={() => pay('full')}>Запросить оплату</Btn></> : null}
        </div></>}
    </div>
  );
};

const Work = () => {
  const [orders, setOrders] = useState<TrWork[] | null>(null); const [f, setF] = useState({ title: '', username: '', plate: '', model: '', priceRub: '' }); const [busy, run] = useRun();
  const load = useCallback(() => { void trOwner.work('open').then((r) => r.ok && setOrders(r.data!.orders)); }, []); useEffect(load, [load]);
  return (
    <Box title="Заказ-наряды: ход работ по автомобилю">
      <p className="mb-2 text-[11px]" style={{ color: 'var(--t3)' }}>Клиент — пользователь Sky (по @нику). Он видит статус в Sky GO → Организации → «Мои работы», получает уведомления и сам согласовывает работы. Оплата — прямым переводом вам через SkyKassa Business; поступление подтверждаете вы во вкладке платежей.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <In label="Что делаем" value={f.title} onChange={(v) => setF({ ...f, title: v })} max={120} /><In label="@ник клиента" value={f.username} onChange={(v) => setF({ ...f, username: v })} max={40} />
        <In label="Автомобиль" value={f.model} onChange={(v) => setF({ ...f, model: v })} max={60} /><In label="Госномер" value={f.plate} onChange={(v) => setF({ ...f, plate: v })} max={20} />
        <In label="Предварительная стоимость, ₽" value={f.priceRub} onChange={(v) => setF({ ...f, priceRub: v.replace(/\D/g, '') })} max={8} />
      </div>
      <div className="my-2"><Btn tone="accent" disabled={busy} onClick={() => void run(() => trOwner.createWork({ ...f, priceRub: f.priceRub ? Number(f.priceRub) : null }), () => { setF({ title: '', username: '', plate: '', model: '', priceRub: '' }); load(); })}>Принять автомобиль</Btn></div>
      {!orders ? <Loader2 className="animate-spin" size={16} /> : orders.length === 0 ? <p className="text-xs" style={{ color: 'var(--t3)' }}>Открытых работ нет</p> : <div className="space-y-2">{orders.map((w) => <WorkRow key={w.id} w={w} reload={load} />)}</div>}
    </Box>
  );
};

const TStats = () => {
  const [s, setS] = useState<{ byStatus: Record<string, number>; paidRub: number; ordersMonth: number } | null>(null);
  useEffect(() => { void trOwner.stats().then((r) => r.ok && setS(r.data!)); }, []);
  if (!s) return null;
  return <div className="grid grid-cols-2 gap-2"><Stat k="Работ за 30 дней" v={s.ordersMonth} /><Stat k="Подтверждено оплат, ₽" v={s.paidRub} sub="по подтверждённым вами платежам" />
    {Object.entries(s.byStatus).map(([k, n]) => <Stat key={k} k={WORK_LABEL[k] ?? k} v={n} />)}</div>;
};

export const GoTransport = () => {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { void trOwner.stats().then((r) => setOk(r.ok || r.error !== 'not_transport')); }, []);
  if (ok === null) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} /></div>;
  if (!ok) return <p className="text-sm" style={{ color: 'var(--t2)' }}>Раздел доступен организациям категорий «Для транспорта» (АЗС, мойки, автосервисы, детейлинг, запчасти, стоянки, парковки, эвакуаторы, автосалоны, прокат). Выберите такую категорию во вкладке «Карточка».</p>;
  return <div className="space-y-3"><TStats /><FuelPrices /><Features /><Promos /><Work /></div>;
};
