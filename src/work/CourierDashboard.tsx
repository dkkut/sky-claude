/**
 * Рабочий кабинет курьера: на связи, пул заказов, текущее поручение
 * (получение от продавца и доставка покупателю кодом/QR), заработок.
 *
 * Ничего из происходящего здесь не решает браузер: взятие заказа —
 * условный UPDATE на сервере (server/logistics.mjs::takeOrder), приём и
 * сдача — проверка QR/кода (server/courierdelivery.mjs), начисление —
 * серверная вставка с UNIQUE(order_id). Экран только показывает ответ.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Power, Package, MapPin, QrCode, Wallet, AlertTriangle, Star, RefreshCw, ChevronRight,
} from 'lucide-react';
import { VEHICLE_CFG } from '@/marketplace/logistics/shared';
import { useCourierStore } from '@/marketplace/logistics/courierStore';
import type { Courier } from '@/marketplace/logistics/types';

const PROBLEM_REASONS: { key: string; label: string }[] = [
  { key: 'no_answer',     label: 'Получатель не отвечает' },
  { key: 'not_home',      label: 'Получателя нет на месте' },
  { key: 'bad_address',   label: 'Неверный адрес' },
  { key: 'cannot_handoff',label: 'Невозможно передать заказ' },
  { key: 'damaged',       label: 'Повреждение отправления' },
  { key: 'other',         label: 'Другая причина' },
];

export const CourierDashboard = ({ courier }: { courier: Courier }) => {
  const {
    setMyOnline, poolOrders, loadPool, takeOrder,
    myActiveAssignment, confirmPickup, confirmDelivery, reportProblem,
    stats, loadStats, earnings, loadEarnings,
  } = useCourierStore();

  const active = myActiveAssignment();
  const [proof, setProof] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showProblem, setShowProblem] = useState(false);
  const [showEarnings, setShowEarnings] = useState(false);

  useEffect(() => { loadStats(); loadEarnings(); }, [loadStats, loadEarnings]);
  useEffect(() => {
    if (courier.online && !active) loadPool();
  }, [courier.online, active, loadPool]);

  const toggleOnline = async () => {
    setBusy(true);
    const r = await setMyOnline(!courier.online);
    setBusy(false);
    if (!r.ok) {
      setMsg({ text: r.error === 'passport_unverified' ? 'Паспорт ещё не подтверждён' : 'Не получилось выйти на связь', ok: false });
    }
  };

  const take = async (orderId: string) => {
    setBusy(true);
    const r = await takeOrder(orderId);
    setBusy(false);
    setMsg(r.ok ? { text: 'Заказ взят', ok: true } : { text: 'Заказ уже взял другой курьер', ok: false });
  };

  const doPickup = async () => {
    if (!active || !proof.trim()) return;
    setBusy(true);
    const r = await confirmPickup(active.orderId, proof.trim());
    setBusy(false);
    setProof('');
    setMsg(r.ok ? { text: 'Получение подтверждено', ok: true } : { text: 'Код или QR не подошёл', ok: false });
  };

  const doDelivery = async () => {
    if (!active || !proof.trim()) return;
    setBusy(true);
    const r = await confirmDelivery(active.orderId, proof.trim());
    setBusy(false);
    setProof('');
    setMsg(r.ok ? { text: `Доставка подтверждена · +${r.earned ?? 0} ₽`, ok: true } : { text: 'Код или QR не подошёл', ok: false });
  };

  const submitProblem = async (reason: string) => {
    if (!active) return;
    setBusy(true);
    const r = await reportProblem(active.id, reason);
    setBusy(false);
    setShowProblem(false);
    setMsg(r.ok ? { text: 'Обращение в поддержку создано', ok: true } : { text: 'Не получилось отправить', ok: false });
  };

  const Icon = VEHICLE_CFG[courier.vehicle].icon;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-4">
      <div className="rounded-3xl p-5" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.15), var(--bg-l1))', border: '1px solid rgba(6,182,212,0.25)' }}>
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full" style={{ background: 'var(--bg-l2)' }}>
            <Icon size={22} style={{ color: 'var(--t2)' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-black" style={{ color: 'var(--t1)' }}>{courier.name}</p>
            <div className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--t3)' }}>
              <Star size={11} fill="#f59e0b" color="#f59e0b" />{courier.rating} · {stats?.deliveredCount ?? courier.deliveriesCount} доставок
            </div>
          </div>
        </div>

        <button type="button" onClick={toggleOnline} disabled={busy || Boolean(active)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[13.5px] font-bold disabled:opacity-50"
          style={{ background: courier.online ? 'rgba(34,197,94,0.15)' : 'var(--bg-l2)', color: courier.online ? 'var(--green)' : 'var(--t3)' }}>
          <Power size={15} />{courier.online ? 'Вы на линии' : 'Выйти на линию'}
        </button>
        {active && <p className="mt-1.5 text-center text-[11px]" style={{ color: 'var(--t3)' }}>Нельзя уйти со связи, пока не закрыт текущий заказ</p>}
      </div>

      {msg && (
        <div className="mt-3 rounded-xl px-3 py-2 text-[12px]" style={{ background: msg.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: msg.ok ? 'var(--green)' : '#ef4444' }}>
          {msg.text}
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-2xl p-3 text-center" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <p className="text-base font-black" style={{ color: 'var(--t1)' }}>{stats?.deliveredCount ?? 0}</p>
          <p className="text-[10.5px]" style={{ color: 'var(--t3)' }}>доставок</p>
        </div>
        <div className="rounded-2xl p-3 text-center" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <p className="text-base font-black" style={{ color: 'var(--t1)' }}>{stats?.activeCount ?? 0}</p>
          <p className="text-[10.5px]" style={{ color: 'var(--t3)' }}>в работе</p>
        </div>
        <button type="button" onClick={() => setShowEarnings((v) => !v)}
          className="rounded-2xl p-3 text-center" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <p className="text-base font-black" style={{ color: 'var(--t1)' }}>{stats?.totalEarned ?? 0} ₽</p>
          <p className="text-[10.5px]" style={{ color: 'var(--t3)' }}>заработано</p>
        </button>
      </div>

      {showEarnings && (
        <div className="mt-3 rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold" style={{ color: 'var(--t2)' }}><Wallet size={14} />История заработка</p>
          {earnings.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Пока пусто</p>
          ) : (
            <div className="space-y-1.5">
              {earnings.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-[12px]">
                  <span className="truncate pr-2" style={{ color: 'var(--t2)' }}>{e.orderTitle}</span>
                  <span className="shrink-0 font-bold" style={{ color: 'var(--green)' }}>+{e.amount} ₽</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Текущее поручение ────────────────────────────────────────── */}
      {active && (
        <div className="mt-4 rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Package size={15} style={{ color: 'var(--accent)' }} />
            <p className="text-[13px] font-bold" style={{ color: 'var(--t1)' }}>Текущий заказ</p>
          </div>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--t3)' }}>
            {active.district || active.cityId} · {active.price} ₽ за доставку
          </p>

          {active.status === 'assigned' && (
            <div className="mt-3 space-y-2">
              <p className="text-[12px]" style={{ color: 'var(--t2)' }}>Отсканируйте или введите QR продавца для получения отправления</p>
              <input type="text" value={proof} onChange={(e) => setProof(e.target.value)} placeholder="skypvz:order:…"
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }} />
              <button type="button" disabled={busy || !proof.trim()} onClick={doPickup}
                className="sky-btn-primary w-full justify-center py-2.5 text-[13px] disabled:opacity-50">
                <QrCode size={14} />Подтвердить получение
              </button>
            </div>
          )}

          {(active.status === 'picked_up' || active.status === 'in_transit') && (
            <div className="mt-3 space-y-2">
              <p className="text-[12px]" style={{ color: 'var(--t2)' }}>Введите код или QR покупателя для подтверждения доставки</p>
              <input type="text" value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Код или QR"
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
                style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }} />
              <button type="button" disabled={busy || !proof.trim()} onClick={doDelivery}
                className="sky-btn-primary w-full justify-center py-2.5 text-[13px] disabled:opacity-50">
                <QrCode size={14} />Подтвердить доставку
              </button>
            </div>
          )}

          {active.status === 'problem' && (
            <p className="mt-2 text-[12px]" style={{ color: '#ef4444' }}>Заявлена проблема: {active.problemReason}. Обращение передано в поддержку.</p>
          )}

          {active.status !== 'problem' && (
            <button type="button" onClick={() => setShowProblem((v) => !v)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-semibold"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              <AlertTriangle size={13} />Проблема с доставкой
            </button>
          )}

          {showProblem && (
            <div className="mt-2 space-y-1.5">
              {PROBLEM_REASONS.map((r) => (
                <button key={r.key} type="button" disabled={busy} onClick={() => submitProblem(r.key)}
                  className="w-full rounded-xl px-3 py-2 text-left text-[12px] disabled:opacity-50"
                  style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Пул доступных заказов ────────────────────────────────────── */}
      {!active && courier.online && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-bold" style={{ color: 'var(--t1)' }}>Доступные заказы</p>
            <button type="button" onClick={() => loadPool()} className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'var(--bg-l1)' }}>
              <RefreshCw size={13} style={{ color: 'var(--t3)' }} />
            </button>
          </div>
          {poolOrders.length === 0 ? (
            <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <MapPin size={20} className="mx-auto mb-2" style={{ color: 'var(--t3)' }} />
              <p className="text-[12.5px]" style={{ color: 'var(--t3)' }}>Пока нет заказов в вашем районе</p>
            </div>
          ) : (
            <div className="space-y-2">
              {poolOrders.map((o) => (
                <motion.div key={o.id} whileTap={{ scale: 0.99 }}
                  className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold" style={{ color: 'var(--t1)' }}>{o.orderTitle}</p>
                    <p className="text-[11.5px]" style={{ color: 'var(--t3)' }}>{o.district || o.cityId} · заказ {o.orderTotal} ₽</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-black" style={{ color: 'var(--green)' }}>{o.price} ₽</p>
                  </div>
                  <button type="button" disabled={busy} onClick={() => take(o.orderId)}
                    className="shrink-0 rounded-xl px-3 py-2 text-[12px] font-bold disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: '#fff' }}>
                    Взять<ChevronRight size={12} className="inline" />
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {!active && !courier.online && (
        <p className="mt-6 text-center text-[12px]" style={{ color: 'var(--t3)' }}>
          Выйдите на связь, чтобы видеть доступные заказы
        </p>
      )}
    </div>
  );
};
