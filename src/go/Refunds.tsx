/** Sky GO: возвраты по оплаченным заказам и отчёт получателя денег. Sky деньги не принимает и не возвращает — это запись договорённости и спор через администрацию. */
import { useState } from 'react';
import { goApi, goError, REFUND_LABEL, type Refund } from './api';
import { Btn, Card, Chip, Col, Input, Notice, fail, fmt, useLoad, C, GO } from './ui';
import { flash } from '@/shared/flash';

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const WHO: Record<string, string> = { customer: 'Заказчик', executor: 'Исполнитель', admin: 'Администрация' };

/** Блок возврата в карточке оплаченного заказа. Виден заказчику и исполнителю. */
export const RefundBlock = ({ orderId, role, onChange }: { orderId: string; role: 'customer' | 'executor' | 'staff' | 'viewer'; onChange: () => void }) => {
  const [res, reload] = useLoad(() => goApi.refund(orderId), [orderId], 10000);
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(''); const [amount, setAmount] = useState('');
  const [note, setNote] = useState(''); const [ask, setAsk] = useState<'reject' | 'escalate' | null>(null); const [busy, setBusy] = useState(false);
  if (!res?.ok) return null;
  const { refund: r, eligible, windowDays } = res.data!;
  const run = async (fn: () => ReturnType<typeof goApi.refundAct>, ok: string) => {
    setBusy(true); const x = await fn(); setBusy(false);
    if (!x.ok) { fail(x); return false; }
    flash(ok); setAsk(null); setNote(''); reload(); onChange(); return true;
  };
  if (!r) {
    if (role !== 'customer' || !eligible) return null;
    return (
      <Card><Col gap={8}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Возврат денег</div>
        {open ? (<>
          <Input area label="Причина" value={reason} onChange={setReason} max={500} placeholder="Что пошло не так" />
          <Input label="Сумма, ₽ (пусто — вся)" value={amount} onChange={(v) => setAmount(v.replace(/\D/g, ''))} />
          <Notice>Sky деньги за заказ не принимал и сам не возвращает: исполнитель вернёт их напрямую. Если откажет — можно обратиться к администрации.</Notice>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn busy={busy} disabled={reason.trim().length < 5} onClick={async () => { setBusy(true); const x = await goApi.refundRequest(orderId, reason, amount ? Number(amount) : undefined); setBusy(false); if (!x.ok) return fail(x); flash('Запрос на возврат отправлен'); setOpen(false); reload(); onChange(); }}>Запросить возврат</Btn>
            <Btn kind="soft" onClick={() => setOpen(false)}>Отмена</Btn></div>
        </>) : (<>
          <div style={{ fontSize: 13, color: C.t2 }}>{`Запросить возврат можно в течение ${windowDays} дней после оплаты.`}</div>
          <Btn kind="soft" onClick={() => setOpen(true)}>Запросить возврат</Btn></>)}
      </Col></Card>);
  }
  const cust = r.role === 'customer'; const exec = r.role === 'executor';
  return (
    <Card style={{ borderColor: ['escalated', 'rejected'].includes(r.status) ? '#f59e0b' : undefined }}><Col gap={8}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ color: C.t1 }}>Возврат · {fmt(r.amountRub)}</b><Chip color={['refunded', 'accepted', 'upheld'].includes(r.status) ? '#16a34a' : ['denied', 'rejected', 'withdrawn'].includes(r.status) ? '#ef4444' : GO}>{REFUND_LABEL[r.status] ?? r.status}</Chip></div>
      <div translate="no" style={{ fontSize: 13, color: C.t2 }}>Причина: {r.reason}</div>
      {r.adminNote && <div translate="no" style={{ fontSize: 13, color: C.t2 }}>Администрация: {r.adminNote}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{r.history.map((h, i) => <div key={i} style={{ fontSize: 12, color: C.t3 }}>{when(h.at)} — {WHO[h.who] ?? h.who}: {REFUND_LABEL[h.what] ?? h.what}{h.note ? <span translate="no">{` · ${h.note}`}</span> : null}</div>)}</div>
      {exec && r.status === 'requested' && <div style={{ display: 'flex', gap: 8 }}><Btn busy={busy} onClick={() => run(() => goApi.refundAct(orderId, 'accept'), 'Вы согласились на возврат')}>Согласен вернуть</Btn><Btn kind="soft" onClick={() => setAsk('reject')}>Отказать</Btn></div>}
      {exec && ['accepted', 'upheld'].includes(r.status) && <><Notice>Переведите деньги заказчику сами (его способ связи — в чате заказа или поддержке), затем нажмите кнопку.</Notice><Btn busy={busy} onClick={() => run(() => goApi.refundAct(orderId, 'returned'), 'Отмечено: деньги возвращены')}>Я вернул деньги</Btn></>}
      {cust && r.status === 'returned' && <div style={{ display: 'flex', gap: 8 }}><Btn busy={busy} onClick={() => run(() => goApi.refundAct(orderId, 'confirm'), 'Возврат подтверждён')}>Деньги получил</Btn><Btn kind="soft" onClick={() => setAsk('escalate')}>Деньги не пришли</Btn></div>}
      {cust && r.status === 'rejected' && <div style={{ display: 'flex', gap: 8 }}><Btn busy={busy} onClick={() => setAsk('escalate')}>Обратиться к администрации</Btn><Btn kind="soft" onClick={() => run(() => goApi.refundAct(orderId, 'withdraw'), 'Запрос отозван')}>Отозвать</Btn></div>}
      {cust && r.status === 'requested' && <Btn kind="soft" onClick={() => run(() => goApi.refundAct(orderId, 'withdraw'), 'Запрос отозван')}>Отозвать запрос</Btn>}
      {ask && (<>
        <Input area label={ask === 'reject' ? 'Причина отказа' : 'Что случилось'} value={note} onChange={setNote} max={500} />
        <div style={{ display: 'flex', gap: 8 }}><Btn busy={busy} disabled={note.trim().length < 5} onClick={() => run(() => goApi.refundAct(orderId, ask, note), ask === 'reject' ? 'Отказ отправлен' : 'Передано администрации')}>Отправить</Btn><Btn kind="soft" onClick={() => setAsk(null)}>Отмена</Btn></div>
      </>)}
    </Col></Card>
  );
};

/** Отчёт получателя денег за период: подтверждённые прямые оплаты за вычетом подтверждённых возвратов. */
export const EarningsCard = () => {
  const [days, setDays] = useState(30);
  const [res] = useLoad(() => goApi.earnings(days), [days]);
  const d = res?.ok ? res.data! : null;
  return (
    <Card><Col gap={8}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b style={{ color: C.t1 }}>Полученные оплаты</b>
        <select aria-label="Период" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ height: 38, borderRadius: 10, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 8px' }}>
          <option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option></select>
      </div>
      {!res ? <div style={{ color: C.t3, fontSize: 13 }}>Загрузка…</div> : !d ? <Notice tone="warn">{goError(res as { error?: string })}</Notice> : (<>
        <div style={{ fontSize: 26, fontWeight: 900, color: C.t1 }}>{fmt(d.netRub)}</div>
        <div style={{ fontSize: 13, color: C.t2 }}>{`Получено ${fmt(d.grossRub)} по ${d.orders} заказам${d.refundedRub ? `, возвращено ${fmt(d.refundedRub)}` : ''}${d.pendingRefundsRub ? ` · в споре о возврате ${fmt(d.pendingRefundsRub)}` : ''}`}</div>
        {d.byDay.slice(-7).map((x) => <div key={x.date} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: C.t2 }}><span>{x.date}</span><span>{`${x.orders} зак. · ${fmt(x.grossRub - x.refundedRub)}`}</span></div>)}
        <a href={`/api/go/earnings?days=${days}&format=csv`} onClick={async (e) => { e.preventDefault(); try { const { apiBlob } = await import('@/core/auth/api'); const b = await apiBlob(`/api/go/earnings?days=${days}&format=csv`); if (!b.ok || !b.blob) throw new Error('x'); const u = URL.createObjectURL(b.blob); const a = document.createElement('a'); a.href = u; a.download = 'sky-go-earnings.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); } catch { flash('Не удалось выгрузить'); } }} style={{ fontSize: 13, color: GO, fontWeight: 700 }}>Выгрузить CSV</a>
        <Notice>{d.note}</Notice>
      </>)}
    </Col></Card>
  );
};
