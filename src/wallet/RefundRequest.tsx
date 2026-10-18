import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { apiCreateTicket } from '@/moderation/supportApi';
import { fmtSigned, type Transaction } from './store';

const REASONS = ['Списано по ошибке', 'Услуга не оказана', 'Товар не получен', 'Дублирующее списание', 'Другое'];

/**
 * Бланк на возврат. Sky деньги автоматически не возвращает: бланк создаёт
 * обычное обращение в поддержку с выбранной операцией, суммой и причиной —
 * решение принимает сотрудник, ответ приходит в «Поддержке».
 */
export const RefundRequest = ({ txs, onBack }: { txs: Transaction[]; onBack: () => void }) => {
  const spent = txs.filter((t) => t.amount < 0).slice(0, 50);
  const [txId, setTxId] = useState('');
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const tx = spent.find((t) => t.id === txId);

  const send = async () => {
    if (!tx) { setErr('Выберите операцию, по которой нужен возврат.'); return; }
    if (reason === 'Другое' && note.trim().length < 5) { setErr('Опишите причину подробнее.'); return; }
    setBusy(true); setErr('');
    const body = [
      'Заявка на возврат (Sky Money)',
      `Операция: ${tx.id}`,
      `Описание: ${tx.desc}`,
      `Сумма: ${fmtSigned(tx.amount)}`,
      `Дата: ${tx.createdAt}`,
      tx.ref ? `Ссылка: ${tx.ref}` : '',
      `Причина: ${reason}`,
      note.trim() ? `Пояснение: ${note.trim()}` : '',
    ].filter(Boolean).join('\n');
    const r = await apiCreateTicket({ subject: 'Возврат средств', body, kind: 'question' });
    setBusy(false);
    if (!r.ok) { setErr(r.reason ?? 'Не удалось отправить заявку. Повторите.'); return; }
    setSent(true);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <button type="button" onClick={onBack} aria-label="Закрыть" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5"><X size={16} /></button>
        <span className="text-sm font-semibold">Бланк на возврат</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ overscrollBehavior: 'contain' }}>
        {sent ? (
          <div className="text-center py-10 space-y-3">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full" style={{ background: 'var(--green)', color: '#fff' }}><Check size={22} /></div>
            <p className="font-semibold">Заявка отправлена</p>
            <p className="text-sm opacity-70">Ответ придёт в раздел «Поддержка». Деньги возвращаются только по решению сотрудника.</p>
            <button type="button" onClick={onBack} className="rounded-full px-5 h-10 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>Готово</button>
          </div>
        ) : (<>
          <p className="text-xs opacity-70">Sky не возвращает деньги автоматически: заявку рассматривает сотрудник поддержки.</p>
          <label className="block text-xs font-semibold">Операция
            <select value={txId} onChange={(e) => setTxId(e.target.value)} className="mt-1 w-full h-11 rounded-xl px-3 text-sm" style={{ background: 'var(--l2, transparent)', border: '1px solid var(--border)', color: 'inherit' }}>
              <option value="">Выберите списание…</option>
              {spent.map((t) => <option key={t.id} value={t.id}>{`${fmtSigned(t.amount)} · ${t.desc}`.slice(0, 80)}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold">Причина
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full h-11 rounded-xl px-3 text-sm" style={{ background: 'var(--l2, transparent)', border: '1px solid var(--border)', color: 'inherit' }}>
              {REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold">Пояснение
            <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={4} translate="no" className="mt-1 w-full rounded-xl p-3 text-sm" style={{ background: 'var(--l2, transparent)', border: '1px solid var(--border)', color: 'inherit' }} />
          </label>
          {err && <p role="alert" className="text-xs" style={{ color: 'var(--red, #e5484d)' }}>{err}</p>}
          <button type="button" disabled={busy} onClick={send} className="w-full h-11 rounded-full text-sm font-semibold disabled:opacity-60" style={{ background: 'var(--accent)', color: '#fff' }}>{busy ? 'Отправка…' : 'Отправить заявку'}</button>
        </>)}
      </div>
    </div>
  );
};
