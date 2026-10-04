/**
 * Вкладка «Нарушения и штрафы» — одна на кабинет магазина Market и
 * кабинет ПВЗ: разница только в том, чьи нарушения запрашиваются
 * (apiMyViolations — свои, apiPvzViolations — всей точки). Сама карточка
 * нарушения и штрафа — общая, см. server/violations.mjs.
 */
import { useEffect, useState } from 'react';
import { ShieldAlert, Clock, CheckCircle2 } from 'lucide-react';
import { C, fmt, fmtTime, Empty, inputStyle } from './ui';
import {
  apiMyViolations, apiPvzViolations, apiDeclarePenaltyPaid, apiSubmitAppeal,
  type ViolationItem, type ViolationPenalty,
} from './violationsApi';

const STATUS_LABEL: Record<string, string> = {
  DETECTED: 'Выявлено', UNDER_REVIEW: 'На рассмотрении', CONFIRMED: 'Подтверждено',
  REJECTED: 'Отклонено', APPEALED: 'Обжалуется', CANCELLED: 'Аннулировано', CLOSED: 'Закрыто',
};
const SEVERITY_LABEL: Record<string, string> = {
  warning: 'Предупреждение', minor: 'Лёгкое', moderate: 'Среднее', severe: 'Тяжёлое', critical: 'Критическое',
};
const PENALTY_STATUS_LABEL: Record<string, string> = {
  accrued: 'Начислен', payment_declared: 'Оплата заявлена', paid: 'Оплачен', cancelled: 'Отменён', waived: 'Списан',
};

const PenaltyCard = ({ penalty, onDeclared }: { penalty: ViolationPenalty; onDeclared: () => void }) => {
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const payable = penalty.status === 'accrued';

  return (
    <div className="rounded-xl p-3" style={{ background: C.l2 }}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold" style={{ color: C.t1 }}>
          {penalty.amountKop != null ? fmt(penalty.amountKop / 100) : '—'}
        </span>
        <span className="text-[10px] font-semibold" style={{ color: C.t3 }}>
          {PENALTY_STATUS_LABEL[penalty.status] ?? penalty.status}
        </span>
      </div>
      <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>{penalty.paymentPurpose}</p>
      {penalty.dueAt && (
        <p className="mt-1 flex items-center gap-1 text-[10px]" style={{ color: C.t3 }}>
          <Clock size={11} /> Оплатить до {fmtTime(penalty.dueAt)}
        </p>
      )}
      {penalty.paymentRequisites && (
        <div className="mt-2 rounded-lg p-2" style={{ background: C.l1 }}>
          <p className="mb-1 text-[10px] font-semibold" style={{ color: C.t3 }}>Реквизиты для перевода</p>
          {Object.entries(penalty.paymentRequisites).map(([k, v]) => (
            <p key={k} className="text-[11px]" style={{ color: C.t1 }}>{k}: {v}</p>
          ))}
        </div>
      )}
      {payable && (
        <div className="mt-2 flex gap-1.5">
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Номер перевода (необязательно)"
            className="flex-1 rounded-lg px-2 py-1.5 text-[11px]" style={inputStyle} />
          <button type="button" disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await apiDeclarePenaltyPaid(penalty.id, ref);
              setBusy(false);
              if (r.ok) onDeclared();
            }}
            className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold disabled:opacity-40"
            style={{ background: C.acc, color: '#fff' }}>
            Я оплатил
          </button>
        </div>
      )}
      {penalty.status === 'payment_declared' && (
        <p className="mt-2 text-[10px]" style={{ color: C.amber }}>Оплата заявлена, ждём подтверждения администрацией</p>
      )}
      {penalty.status === 'paid' && (
        <p className="mt-2 flex items-center gap-1 text-[10px]" style={{ color: C.green }}>
          <CheckCircle2 size={11} /> Оплачено
        </p>
      )}
    </div>
  );
};

const AppealForm = ({ violationId, onSent, onCancel }: { violationId: string; onSent: () => void; onCancel: () => void }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const send = async () => {
    if (!reason.trim()) { setFailed('Опишите, почему решение неверно'); return; }
    setBusy(true); setFailed('');
    const r = await apiSubmitAppeal(violationId, reason.trim());
    setBusy(false);
    if (!r.ok || !r.data || 'error' in r.data) { setFailed('Не удалось отправить апелляцию'); return; }
    onSent();
  };

  return (
    <div className="mt-2 rounded-xl p-2" style={{ background: C.l2 }}>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
        placeholder="Почему это решение, по-вашему, неверно?"
        className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none" style={inputStyle} />
      {failed && <p className="mt-1 text-[10px]" style={{ color: C.red }}>{failed}</p>}
      <div className="mt-1.5 flex gap-1.5">
        <button type="button" disabled={busy} onClick={() => void send()}
          className="flex-1 rounded-lg py-1.5 text-[11px] font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          Отправить апелляцию
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-[11px] font-bold" style={{ background: C.l1, color: C.t3 }}>
          Отмена
        </button>
      </div>
    </div>
  );
};

const ViolationCard = ({ v, onChanged }: { v: ViolationItem; onChanged: () => void }) => {
  const [appealing, setAppealing] = useState(false);
  return (
    <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>{v.ruleSnapshot.title}</p>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            {SEVERITY_LABEL[v.severity] ?? v.severity} · {fmtTime(v.createdAt)}
            {v.violatorName ? ` · ${v.violatorName}` : ''}
          </p>
        </div>
        <span className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold"
          style={{
            background: v.status === 'CONFIRMED' ? 'rgba(239,68,68,0.12)' : C.l2,
            color: v.status === 'CONFIRMED' ? C.red : C.t3,
          }}>
          {STATUS_LABEL[v.status] ?? v.status}
        </span>
      </div>
      {v.description && <p className="mt-2 text-[11px]" style={{ color: C.t2 }}>{v.description}</p>}
      {v.reviewComment && <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Комментарий: {v.reviewComment}</p>}
      {v.cancelReason && <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Аннулировано: {v.cancelReason}</p>}
      {v.penalties.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {v.penalties.map((p) => <PenaltyCard key={p.id} penalty={p} onDeclared={onChanged} />)}
        </div>
      )}
      {v.status === 'CONFIRMED' && !appealing && (
        <button type="button" onClick={() => setAppealing(true)}
          className="mt-2 w-full rounded-lg py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.t2 }}>
          Обжаловать
        </button>
      )}
      {appealing && (
        <AppealForm violationId={v.id} onCancel={() => setAppealing(false)}
          onSent={() => { setAppealing(false); onChanged(); }} />
      )}
      {v.status === 'APPEALED' && (
        <p className="mt-2 text-[10px]" style={{ color: C.amber }}>Апелляция отправлена, ждём решения администрации.</p>
      )}
    </div>
  );
};

const ViolationsList = ({ items, onChanged, emptyHint }:
{ items: ViolationItem[] | null; onChanged: () => void; emptyHint: string }) => {
  if (items === null) return <p className="p-4 text-[12px]" style={{ color: C.t3 }}>Загружаем…</p>;
  if (items.length === 0) return <Empty title="Нарушений нет" hint={emptyHint} Icon={ShieldAlert} />;
  return (
    <div className="flex flex-col gap-2 p-4">
      {items.map((v) => <ViolationCard key={v.id} v={v} onChanged={onChanged} />)}
    </div>
  );
};

/** Вкладка «Нарушения и штрафы» в кабинете магазина Market. */
export const SellerViolations = () => {
  const [items, setItems] = useState<ViolationItem[] | null>(null);
  const load = async () => {
    const r = await apiMyViolations('market');
    if (r.ok && r.data) setItems(r.data.violations);
  };
  useEffect(() => { void load(); }, []);
  return <ViolationsList items={items} onChanged={load}
    emptyHint="Здесь появятся зафиксированные нарушения правил Market и штрафы по ним." />;
};

/** Вкладка «Нарушения и штрафы» в кабинете ПВЗ — владелец и сотрудники. */
export const PvzViolationsTab = ({ pvzId }: { pvzId: string }) => {
  const [items, setItems] = useState<ViolationItem[] | null>(null);
  const load = async () => {
    const r = await apiPvzViolations(pvzId);
    if (r.ok && r.data) setItems(r.data.violations);
  };
  useEffect(() => { void load(); }, [pvzId]);
  return <ViolationsList items={items} onChanged={load}
    emptyHint="Здесь появятся нарушения, зафиксированные по этой точке — у владельца и сотрудников." />;
};
