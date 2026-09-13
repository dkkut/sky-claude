/**
 * Sky Market: кабинет своей транспортной компании.
 *
 * Компанию заводит администрация Sky, а возит она сама. Вебхука у неё
 * нет — внешние службы шлют состояние посылки сами, а своей компании
 * его прислать неоткуда, — поэтому состояние здесь ставят руками.
 *
 * Руками и только у своих поручений: право двигать чужую посылку — это
 * «доставлено» без доставки. Проверяет это сервер, а не этот экран;
 * здесь просто не рисуются кнопки там, где их нажимать некому.
 */
import { useEffect, useState } from 'react';
import { Truck, MapPin, Warehouse, Phone, Clock } from 'lucide-react';
import { C, Empty, Alert, fmtTime } from './ui';
import { useMarketStore } from './store';
import { apiMoveShipment } from './marketApi';
import type { CarrierJob } from './types';
import { ORDER_LABEL } from './types';

const JobCard = ({ job, onMoved }: { job: CarrierJob; onMoved: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = async (status: 'in_transit' | 'arrived') => {
    setBusy(true); setError(null);
    const r = await apiMoveShipment(job.orderId, status);
    setBusy(false);
    if (!r.ok) { setError(r.reason ?? 'Не получилось отметить'); return; }
    onMoved();
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex items-center gap-2">
        <Truck size={14} style={{ color: C.acc }} />
        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold" style={{ color: C.t1 }}>{job.title}</p>
        <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold"
          style={{ background: C.l2, color: C.t2 }}>{ORDER_LABEL[job.orderStatus]}</span>
      </div>

      {job.destination === 'pickup_point' && job.pickupPoint ? (
        <div className="rounded-xl px-3 py-2 text-[11px]" style={{ background: C.l2, color: C.t2 }}>
          <p className="flex items-center gap-1" style={{ color: C.t1 }}>
            <Warehouse size={11} /> {job.pickupPoint.title}
          </p>
          <p>{job.pickupPoint.city}, {job.pickupPoint.address}</p>
          {job.pickupUntil && <p>Хранить до {fmtTime(job.pickupUntil)}</p>}
        </div>
      ) : (
        <div className="rounded-xl px-3 py-2 text-[11px]" style={{ background: C.l2, color: C.t2 }}>
          <p className="flex items-center gap-1" style={{ color: C.t1 }}>
            <MapPin size={11} /> {job.address || 'адрес не указан'}
          </p>
          {job.contact && (
            <p className="flex items-center gap-1"><Phone size={11} /> {job.contact}</p>
          )}
        </div>
      )}

      <p className="text-[11px]" style={{ color: C.t3 }}>{job.statusText}</p>
      {job.eta && (
        <p className="flex items-center gap-1 text-[10px]" style={{ color: C.t3 }}>
          <Clock size={10} /> Обещано к {fmtTime(job.eta)}
        </p>
      )}

      {error && <Alert text={error} />}

      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => move('in_transit')}
          className="flex-1 rounded-xl py-2 text-[11px] font-bold disabled:opacity-40"
          style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
          Забрал, везу
        </button>
        <button type="button" disabled={busy} onClick={() => move('arrived')}
          className="flex-1 rounded-xl py-2 text-[11px] font-bold disabled:opacity-40"
          style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
          {job.destination === 'pickup_point' ? 'Сдал в пункт' : 'Привёз'}
        </button>
      </div>
    </div>
  );
};

export const CarrierCabinet = () => {
  const { myCarriers, carrierJobs, loadCarrier, loadCarrierJobs } = useMarketStore();

  useEffect(() => {
    void loadCarrier();
    void loadCarrierJobs();
  }, []);

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {myCarriers.map((c) => (
        <div key={c.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>{c.title}</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>
            {c.city || 'без привязки к городу'} · срок {c.etaHours} ч · от {c.minPrice} ₽
            {!c.active && <span style={{ color: C.red }}> · выключена</span>}
          </p>
        </div>
      ))}

      <p className="text-[11px] font-semibold" style={{ color: C.t3 }}>
        Поручения · {carrierJobs.length}
      </p>

      {carrierJobs.length === 0 && (
        <Empty title="Поручений пока нет"
          hint="Продавцы выбирают службу при отправке заказа" Icon={Truck} />
      )}

      {carrierJobs.map((job) => (
        <JobCard key={job.orderId} job={job} onMoved={() => void loadCarrierJobs()} />
      ))}

      <p className="text-[10px]" style={{ color: C.t3 }}>
        Получение подтверждает покупатель — за него этого не делает ни продавец,
        ни служба доставки.
      </p>
    </div>
  );
};
