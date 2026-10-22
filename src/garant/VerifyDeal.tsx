/**
 * Sky Garant: сделка с проверкой данных и обмен — экран сделки. Сервер — server/garantverify.mjs.
 *
 *  Сделка:  продавец передаёт данные гаранту → режим проверки: покупатель видит данные и жмёт «Оплатить» → продавец закрывает сделку.
 *  Обмен:   обе стороны передают данные → каждая подтверждает, что они верны → режим проверки: каждая видит данные другой и подтверждает «всё верно».
 *  В режиме проверки «что-то не так» — спор. Данные другой стороны открываются только в режиме проверки; открытие пишется в журнал.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, Loader2, Plus, Trash2, ShieldCheck, Eye, AlertCircle } from 'lucide-react';
import {
  apiDealData, apiSubmitDealData, apiConfirmOwnData, apiApproveData, apiPayVerified, apiCloseVerified, apiCancelVerified, apiVerifyDispute,
  type GarantDeal, type DealDataView, type DataField,
} from './garantApi';
import { useGarantStore } from './store';

const C = { bg: 'var(--bg)', l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', border: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.border}`, color: C.t1 };
const ERR: Record<string, string> = {
  view_first: 'Сначала откройте данные другой стороны — подтвердить вслепую нельзя.', data_locked: 'Данные уже подтверждены и не правятся.', bad_data: 'Заполните хотя бы одно поле (название и значение).',
  confirm_required: 'Подтвердите, что данные верны.', bad_status: 'Состояние сделки изменилось — обновите экран.', insufficient_funds: 'Недостаточно средств.', insufficient_points: 'Недостаточно баллов.',
  already_confirmed: 'Уже подтверждено.', bad_reason: 'Опишите, что не так.', not_allowed: 'Это действие недоступно вам.', refund_failed: 'Не удалось зачислить — обратитесь в поддержку.',
};
const errText = (e?: string) => (e && ERR[e]) || 'Не получилось выполнить действие.';

const Fields = ({ title, d }: { title: string; d: { fields?: DataField[]; note?: string } | null }) => (
  <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.border}` }}>
    <p className="mb-2 text-xs font-bold" style={{ color: C.t3 }}>{title}</p>
    {d?.fields?.map((f, i) => (
      <div key={i} className="mb-1.5 flex flex-col">
        <span className="text-[11px]" style={{ color: C.t3 }} translate="no">{f.label}</span>
        <span className="break-all text-sm font-semibold select-all" style={{ color: C.t1 }} translate="no">{f.value}</span>
      </div>
    ))}
    {d?.note && <p className="mt-1 text-xs" style={{ color: C.t2 }} translate="no">{d.note}</p>}
  </div>
);

const DataForm = ({ initial, sale, onSubmit, busy }: { initial?: { fields?: DataField[]; note?: string } | null; sale: boolean; onSubmit: (f: DataField[], note: string, confirmed: boolean) => void; busy: boolean }) => {
  const [fields, setFields] = useState<DataField[]>(initial?.fields?.length ? initial.fields : [{ label: '', value: '' }]);
  const [note, setNote] = useState(initial?.note ?? '');
  const [ok, setOk] = useState(false);
  const set = (i: number, k: 'label' | 'value', v: string) => setFields((a) => a.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  const valid = fields.some((f) => f.label.trim() && f.value.trim()) && (!sale || ok);
  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="flex gap-2">
          <input value={f.label} onChange={(e) => set(i, 'label', e.target.value)} maxLength={60} placeholder="Название (логин, пароль…)" className="w-[38%] min-w-0 rounded-xl px-3 py-2.5 text-sm outline-none" style={field} />
          <input value={f.value} onChange={(e) => set(i, 'value', e.target.value)} maxLength={500} placeholder="Значение" className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={field} />
          {fields.length > 1 && <button type="button" aria-label="Убрать поле" onClick={() => setFields((a) => a.filter((_, j) => j !== i))} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: C.l2, color: C.t2 }}><Trash2 size={14} /></button>}
        </div>
      ))}
      {fields.length < 10 && <button type="button" onClick={() => setFields((a) => [...a, { label: '', value: '' }])} className="flex items-center gap-1 text-xs font-bold" style={{ color: C.acc }}><Plus size={13} />Добавить поле</button>}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="Пояснение (необязательно)" className="w-full min-w-0 resize-none rounded-xl px-3 py-2.5 text-sm outline-none" style={field} />
      {sale && (
        <label className="flex items-start gap-2 text-xs" style={{ color: C.t2 }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-0.5" />Подтверждаю, что данные верны. После отправки они не правятся.
        </label>
      )}
      <button type="button" disabled={busy || !valid} onClick={() => onSubmit(fields.filter((f) => f.label.trim() && f.value.trim()), note, ok)}
        className="w-full rounded-2xl py-3.5 text-sm font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff', minHeight: 44 }}>
        {busy ? 'Отправляем…' : sale ? 'Передать данные гаранту' : 'Передать / обновить данные'}
      </button>
    </div>
  );
};

export const VerifyDeal = ({ deal, myId, onBack }: { deal: GarantDeal; myId: string; onBack: () => void }) => {
  const apply = useGarantStore((s) => s.applyDealUpdate);
  const reload = useGarantStore((s) => s.load);
  const [view, setView] = useState<DealDataView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reason, setReason] = useState(''); const [disputing, setDisputing] = useState(false);

  const exchange = deal.flow === 'exchange';
  const role = deal.sellerId === myId ? 'seller' : 'buyer';
  const isSeller = role === 'seller';
  const loadData = useCallback(async () => { const r = await apiDealData(deal.id); if (r.ok && r.data) setView(r.data); }, [deal.id]);
  useEffect(() => { void loadData(); }, [loadData, deal.status]);

  const run = async (fn: () => Promise<{ ok: boolean; data?: { deal: GarantDeal }; error?: string }>) => {
    setBusy(true); setErr('');
    const r = await fn();
    setBusy(false);
    if (!r.ok || !r.data) { setErr(errText(r.error)); void reload(); return; }
    apply(r.data.deal); void loadData();
  };
  const mineState = isSeller ? deal.sellerData : deal.buyerData;
  const theirState = isSeller ? deal.buyerData : deal.sellerData;
  const myApproved = isSeller ? deal.sellerApproved : deal.buyerApproved;
  const status = deal.status;
  const other = isSeller ? (deal.buyerName ?? deal.buyerUsername) : (deal.sellerName ?? deal.sellerUsername);

  const LABEL: Record<string, [string, string]> = {
    awaiting_data: ['Ждём данные', 'Стороны передают данные гаранту'], confirming: ['Подтверждение данных', 'Каждая сторона подтверждает, что её данные верны'],
    verifying: ['Режим проверки', 'Проверьте данные другой стороны'], paid: ['Оплачено', 'Ждём закрытия сделки продавцом'],
    completed: ['Завершена', 'Сделка успешно завершена'], cancelled: ['Отменена', 'Сделка отменена'], disputed: ['Спор', 'Решение примет администратор'],
  };
  const [lab, sub] = LABEL[status] ?? [status, ''];

  return (
    <div className="flex h-full flex-col overflow-y-auto" style={{ background: C.bg, color: C.t1 }}>
      <div className="flex shrink-0 items-center gap-3 px-4 py-3.5" style={{ borderBottom: `1px solid ${C.border}` }}>
        <button type="button" aria-label="Назад" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full"><ChevronLeft size={18} style={{ color: C.t2 }} /></button>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold" translate="no">{deal.title}</p><p className="text-[10px]" style={{ color: C.t3 }}>{exchange ? 'Обмен' : 'Сделка с проверкой'} · #{deal.id.slice(-8)}</p></div>
        <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: 'var(--bg-l2)', color: C.acc }}>{lab}</span>
      </div>

      <div className="space-y-3 px-4 py-4">
        <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.border}` }}>
          <p className="text-sm font-bold">{lab}</p><p className="text-xs" style={{ color: C.t3 }}>{sub}</p>
          <div className="mt-2 space-y-1 text-xs" style={{ color: C.t2 }}>
            <p>Вторая сторона: <span translate="no">{other}</span> · {isSeller ? (exchange ? 'вы начали обмен' : 'вы продаёте') : (exchange ? 'вам предложили обмен' : 'вы покупаете')}</p>
            {exchange ? <p>Вы отдаёте: <span translate="no">{deal.itemName}</span> · получаете: <span translate="no">{deal.counterItemName}</span></p> : <p>Товар: <span translate="no">{deal.itemName}</span> · {deal.payType === 'rubles' ? `${deal.price.toLocaleString('ru')} ₽` : `${deal.price.toLocaleString('ru')} баллов`}</p>}
          </div>
        </div>

        {/* Передача данных */}
        {(status === 'awaiting_data' || status === 'confirming') && (exchange || isSeller) && (
          <div className="space-y-2">
            <p className="text-sm font-bold">{mineState === 'confirmed' ? 'Ваши данные подтверждены' : mineState === 'submitted' ? 'Ваши данные переданы' : exchange ? 'Передайте свои данные гаранту' : 'Передайте данные гаранту'}</p>
            {mineState === 'confirmed' ? <Fields title="Ваши данные" d={view?.mine ?? null} /> : (
              <DataForm key={`${deal.id}-${view?.mine?.submittedAt ?? 'new'}`} initial={view?.mine} sale={!exchange} busy={busy}
                onSubmit={(f, n, c) => void run(() => apiSubmitDealData(deal.id, { fields: f, note: n, confirmed: c }))} />
            )}
            {exchange && status === 'confirming' && mineState === 'submitted' && (
              <button type="button" disabled={busy} onClick={() => void run(() => apiConfirmOwnData(deal.id))} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold disabled:opacity-40" style={{ background: C.green, color: '#fff', minHeight: 44 }}>
                <ShieldCheck size={15} />Мои данные верны — подтвердить
              </button>
            )}
            {exchange && <p className="text-[11px]" style={{ color: C.t3 }}>Вторая сторона: {theirState === 'confirmed' ? 'данные подтверждены' : theirState === 'submitted' ? 'данные переданы' : 'ещё не передала данные'}.</p>}
          </div>
        )}
        {status === 'awaiting_data' && !exchange && !isSeller && <p className="text-sm" style={{ color: C.t2 }}>Ждём, пока продавец передаст данные гаранту.</p>}

        {/* Режим проверки */}
        {(status === 'verifying' || status === 'paid' || status === 'completed' || status === 'disputed') && view && (
          <div className="space-y-2">
            {view.canSeeTheirs && view.theirs ? <Fields title={exchange ? 'Данные другой стороны' : 'Данные продавца'} d={view.theirs} />
              : view.canSeeTheirs ? <p className="text-sm" style={{ color: C.t3 }}>Данные не найдены.</p>
              : isSeller && !exchange ? <p className="text-sm" style={{ color: C.t2 }}>Покупатель проверяет переданные вами данные.</p> : null}
            {view.mine && <Fields title="Ваши данные" d={view.mine} />}
          </div>
        )}

        {status === 'verifying' && !exchange && !isSeller && (
          <div className="space-y-2 rounded-2xl p-3" style={{ background: 'var(--bg-l1)', border: `1px solid ${C.border}` }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: C.t2 }}><Eye size={13} />Проверьте данные выше. Если всё верно — оплатите: деньги будут у гаранта, пока продавец не закроет сделку.</p>
            <button type="button" disabled={busy} onClick={() => void run(() => apiPayVerified(deal.id))} className="w-full rounded-2xl py-3.5 text-sm font-bold disabled:opacity-40" style={{ background: C.green, color: '#fff', minHeight: 44 }}>
              {busy ? 'Оплачиваем…' : `Оплатить ${deal.payType === 'rubles' ? `${deal.price.toLocaleString('ru')} ₽` : `${deal.price.toLocaleString('ru')} баллов`}`}
            </button>
          </div>
        )}
        {status === 'verifying' && exchange && !myApproved && (
          <button type="button" disabled={busy} onClick={() => void run(() => apiApproveData(deal.id))} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold disabled:opacity-40" style={{ background: C.green, color: '#fff', minHeight: 44 }}>
            <ShieldCheck size={15} />Данные верны — подтвердить обмен
          </button>
        )}
        {status === 'verifying' && exchange && myApproved && <p className="text-sm" style={{ color: C.t2 }}>Вы подтвердили. Ждём подтверждения второй стороны.</p>}
        {status === 'paid' && isSeller && !exchange && (
          <button type="button" disabled={busy} onClick={() => void run(() => apiCloseVerified(deal.id))} className="w-full rounded-2xl py-3.5 text-sm font-bold disabled:opacity-40" style={{ background: C.green, color: '#fff', minHeight: 44 }}>Подтвердить закрытие сделки и получить оплату</button>
        )}
        {status === 'paid' && !isSeller && !exchange && <p className="text-sm" style={{ color: C.t2 }}>Оплата у гаранта. Продавец подтвердит закрытие — тогда деньги уйдут ему. Если что-то не так, откройте спор.</p>}

        {/* Спор и отмена */}
        {(status === 'verifying' || (status === 'paid' && !isSeller)) && (
          disputing ? (
            <div className="space-y-2">
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} placeholder="Что не так? Опишите подробно" className="w-full min-w-0 resize-none rounded-xl px-3 py-2.5 text-sm outline-none" style={field} />
              <div className="flex gap-2">
                <button type="button" disabled={busy || !reason.trim()} onClick={() => void run(() => apiVerifyDispute(deal.id, reason))} className="flex-1 rounded-2xl py-3 text-sm font-bold disabled:opacity-40" style={{ background: C.red, color: '#fff' }}>Открыть спор</button>
                <button type="button" onClick={() => setDisputing(false)} className="rounded-2xl px-4 py-3 text-sm font-bold" style={{ background: C.l2, color: C.t1 }}>Отмена</button>
              </div>
            </div>
          ) : <button type="button" onClick={() => setDisputing(true)} className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.red }}><AlertCircle size={13} />Что-то не так — открыть спор</button>
        )}
        {(status === 'awaiting_data' || status === 'confirming') && (
          <button type="button" disabled={busy} onClick={() => void run(() => apiCancelVerified(deal.id))} className="text-xs font-bold" style={{ color: C.t3 }}>Отменить сделку</button>
        )}
        {status === 'disputed' && (
          <div className="rounded-2xl p-3 text-sm" style={{ background: 'var(--bg-l1)', border: `1px solid ${C.red}` }}>
            <p className="font-bold" style={{ color: C.red }}>Открыт спор</p>
            {deal.disputeReason && <p className="mt-1 text-xs" style={{ color: C.t2 }} translate="no">{deal.disputeReason}</p>}
            <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Администратор изучит данные и решит спор. Данные сторон ему открыты только в споре.</p>
          </div>
        )}
        {err && <p role="alert" className="text-sm" style={{ color: C.red }}>{err}</p>}
        {busy && <div className="grid place-items-center"><Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} /></div>}
      </div>
    </div>
  );
};
