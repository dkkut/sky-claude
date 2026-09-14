/**
 * Снять ячейку на чужом общем складе.
 *
 * Деньги идут мимо Sky: арендатор переводит владельцу склада напрямую
 * по реквизитам, которые приходят с сервера вместе с арендой. Слово
 * «оплачено» здесь означает заявление стороны, а не проверку платежа —
 * перевода Sky не видит и видеть не может.
 *
 * Регламент принимает и тот, кто снимает: он получает доступ к складу и
 * обязан знать, чего там нельзя. Проверяет это сервер, а не эта форма.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Lock, MapPin, Video, Shield, KeyRound, Copy, Check,
} from 'lucide-react';
import { C, fmt, fmtTs } from '@/marketplace/SkyMarket';
import { SlidePanel, EmptyState } from './shared';
import { SkyMap } from './SkyMap';
import { DocumentGate } from './DocumentGate';
import {
  apiSharedWarehouses, apiCells, apiRentCell, apiMyRentals, apiMoveRental, apiCancelRental,
  CELL_SIZE_LABEL, RENTAL_LABEL, KEY_LABEL,
  type SharedWarehouse, type Cell, type Rental,
} from './sharedApi';

const inputStyle = { background: 'var(--bg-l2)', border: '1px solid var(--brd)', color: 'var(--t1)' };

/* ─── Одна аренда глазами арендатора ───────────────────────────────── */

const RentalCard = ({ rental, onChanged }: { rental: Rental; onChanged: () => void }) => {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!rental.paymentDetails) return;
    void navigator.clipboard?.writeText(rental.paymentDetails)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  return (
    <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold" style={{ color: C.t1 }}>
          {rental.warehouseName} · ячейка №{rental.cellNumber}
        </p>
        <span className="text-[10px] font-bold" style={{
          color: rental.status === 'active' ? C.green
            : rental.status === 'cancelled' ? C.red : C.amber,
        }}>{RENTAL_LABEL[rental.status]}</span>
      </div>

      <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
        {rental.days} дн. · {fmt(rental.total)} · {KEY_LABEL[rental.keyState]}
        {rental.endsAt && ` · до ${fmtTs(rental.endsAt)}`}
      </p>

      {rental.address && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: C.t2 }}>
          <MapPin size={11} /> {rental.address}
        </p>
      )}

      {rental.paymentDetails && rental.status !== 'cancelled' && rental.status !== 'ended' && (
        <div className="mt-2 rounded-xl p-2.5" style={{ background: C.l2 }}>
          <p className="text-[10px] font-bold" style={{ color: C.t3 }}>КУДА ПЛАТИТЬ</p>
          <p className="mt-1 whitespace-pre-wrap text-[11px]" style={{ color: C.t1 }}>
            {rental.paymentDetails}
          </p>
          <button type="button" onClick={copy}
            className="mt-1.5 flex items-center gap-1 text-[10px] font-bold" style={{ color: C.acc }}>
            {copied ? <Check size={10} /> : <Copy size={10} />} {copied ? 'Скопировано' : 'Скопировать'}
          </button>
          <p className="mt-1.5 text-[10px]" style={{ color: C.t3 }}>
            Перевод идёт владельцу склада напрямую. Sky его не принимает и не видит —
            подтвердить получение может только склад.
          </p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {rental.status === 'created' && (
          <button type="button"
            onClick={() => void apiMoveRental(rental.id, 'declare-paid').then(onChanged)}
            className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold" style={{ background: C.acc, color: '#fff' }}>
            Я перевёл
          </button>
        )}
        {(rental.status === 'created' || rental.status === 'payment_declared') && (
          <button type="button"
            onClick={() => void apiCancelRental(rental.id, 'Отменено арендатором').then(onChanged)}
            className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: C.l2, color: C.red }}>
            Отказаться
          </button>
        )}
      </div>
    </div>
  );
};

/* ─── Выбор ячейки на складе ───────────────────────────────────────── */

const PickCell = ({ wh, onDone, onNeedRules }: {
  wh: SharedWarehouse; onDone: () => void; onNeedRules: () => void;
}) => {
  const [cells, setCells] = useState<Cell[] | null>(null);
  const [days, setDays] = useState(String(wh.minRentDays));
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiCells(wh.id).then((r) => setCells(r.ok ? (r.data?.cells ?? []) : []));
  }, [wh.id]);

  const rent = async (cell: Cell) => {
    setBusy(true); setFailed('');
    const r = await apiRentCell(cell.id, Number(days));
    setBusy(false);
    if (!r.ok) {
      if (r.error === 'warehouse_rules_required') { onNeedRules(); return; }
      setFailed(
        r.error === 'cell_taken' ? 'Эту ячейку только что сняли. Выберите другую.'
          : r.error === 'cell_blocked' ? 'Ячейка выведена из эксплуатации.'
            : r.error === 'bad_days' ? `Срок должен быть от ${wh.minRentDays} до ${wh.maxRentDays} дней.`
              : r.error === 'own_warehouse' ? 'Это ваш собственный склад.'
                : r.error === 'not_shared' ? 'Склад больше не принимает новых.'
                  : 'Не получилось снять ячейку.');
      return;
    }
    onDone();
  };

  const total = (cell: Cell) => {
    const price = cell.price ?? wh.cellPrice;
    return Math.round(price * (Number(days) / wh.cellPeriodDays));
  };

  return (
    <div className="space-y-3 p-4">
      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>{wh.name}</p>
        <p className="mt-0.5 text-[11px]" style={{ color: C.t3 }}>
          {fmt(wh.cellPrice)} за {wh.cellPeriodDays} дн. · срок от {wh.minRentDays} до {wh.maxRentDays} дн.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2 text-[10px]" style={{ color: C.t3 }}>
          {wh.hasCctv && <span className="flex items-center gap-1"><Video size={10} /> видеонаблюдение</span>}
          {wh.hasGuard && <span className="flex items-center gap-1"><Shield size={10} /> охрана</span>}
          <span className="flex items-center gap-1"><KeyRound size={10} /> запираемые ячейки с ключами</span>
        </div>
        {wh.rules && (
          <p className="mt-2 whitespace-pre-wrap text-[11px]" style={{ color: C.t2 }}>{wh.rules}</p>
        )}
        <p className="mt-2 text-[10px]" style={{ color: C.t3 }}>
          Адрес склада придёт вместе с арендой: до неё он не нужен, после неё без него не приедешь.
        </p>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-bold" style={{ color: C.t3 }}>НА СКОЛЬКО ДНЕЙ</p>
        <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
        <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
          Итоговую сумму считает сервер по своей базе — не этот экран.
        </p>
      </div>

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {cells === null && <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />}
      {cells?.length === 0 && (
        <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Свободных ячеек сейчас нет.</p>
      )}

      {cells?.map((c) => (
        <button key={c.id} type="button" disabled={busy} onClick={() => void rent(c)}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left"
          style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <Lock size={14} style={{ color: C.green }} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>
              №{c.number}{c.zone && <span className="font-normal" style={{ color: C.t3 }}> · {c.zone}</span>}
            </p>
            <p className="text-[10px]" style={{ color: C.t3 }}>{CELL_SIZE_LABEL[c.size]}</p>
          </div>
          <p className="text-xs font-black" style={{ color: C.t1 }}>{fmt(total(c))}</p>
        </button>
      ))}
    </div>
  );
};

/* ─── Экран ────────────────────────────────────────────────────────── */

export const CellMarket = () => {
  const [warehouses, setWarehouses] = useState<SharedWarehouse[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picking, setPicking] = useState<SharedWarehouse | null>(null);
  const [gate, setGate] = useState(false);

  const load = useCallback(async () => {
    const [w, r] = await Promise.all([apiSharedWarehouses(), apiMyRentals()]);
    setWarehouses(w.ok ? (w.data?.warehouses ?? []) : []);
    setRentals(r.ok ? (r.data?.rentals ?? []) : []);
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const live = rentals.filter((r) => r.status !== 'ended' && r.status !== 'cancelled');
  const past = rentals.filter((r) => r.status === 'ended' || r.status === 'cancelled');

  if (gate) {
    return (
      <SlidePanel open onClose={() => setGate(false)} onBack={() => setGate(false)}
        title="Регламент общедоступного склада">
        <DocumentGate code="shared_warehouse_rules"
          note="Вы получаете доступ к чужому складу и обязаны знать, чего там нельзя. Незнание регламента от ответственности не освобождает (п. 12.7)."
          onAccepted={() => { setGate(false); void load(); }} />
      </SlidePanel>
    );
  }

  if (picking) {
    return (
      <SlidePanel open onClose={() => setPicking(null)} onBack={() => setPicking(null)} title="Снять ячейку">
        <PickCell wh={picking}
          onNeedRules={() => { setPicking(null); setGate(true); }}
          onDone={() => { setPicking(null); void load(); }} />
      </SlidePanel>
    );
  }

  if (!loaded) {
    return <div className="grid place-items-center py-10"><Loader2 size={18} className="animate-spin" style={{ color: C.t3 }} /></div>;
  }

  return (
    <div className="space-y-4 p-4">
      {live.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold" style={{ color: C.t3 }}>МОИ ЯЧЕЙКИ</p>
          {live.map((r) => <RentalCard key={r.id} rental={r} onChanged={() => void load()} />)}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[10px] font-bold" style={{ color: C.t3 }}>ОТКРЫТЫЕ СКЛАДЫ</p>

        {warehouses.length === 0 ? (
          <EmptyState icon={Lock} title="Открытых складов пока нет"
            sub="Общий склад открывается только после того, как администрация посмотрела видеообзор помещения." />
        ) : (
          <>
            <SkyMap height={180} points={warehouses.map((w) => ({
              id: w.id, pos: w.location, label: w.name, kind: 'warehouse' as const,
            }))} />

            {warehouses.map((w) => (
              <button key={w.id} type="button" onClick={() => setPicking(w)}
                className="w-full rounded-2xl p-3 text-left"
                style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold" style={{ color: C.t1 }}>{w.name}</p>
                  <p className="text-xs font-black" style={{ color: C.t1 }}>{fmt(w.cellPrice)}</p>
                </div>
                <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
                  {w.freeCells} из {w.totalCells} ячеек свободно · за {w.cellPeriodDays} дн.
                </p>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px]" style={{ color: C.t3 }}>
                  {w.hasCctv && <span className="flex items-center gap-1"><Video size={10} /> видеонаблюдение</span>}
                  {w.hasGuard && <span className="flex items-center gap-1"><Shield size={10} /> охрана</span>}
                </div>
              </button>
            ))}
          </>
        )}
      </div>

      {past.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold" style={{ color: C.t3 }}>ЗАКРЫТЫЕ</p>
          {past.map((r) => <RentalCard key={r.id} rental={r} onChanged={() => void load()} />)}
        </div>
      )}
    </div>
  );
};
