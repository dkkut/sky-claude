/**
 * Обращение в поддержку по конкретному месту в ПВЗ-цепочке: заказу,
 * поставке, точке, начислению.
 *
 * Отдельной схемы «привязка обращения к заказу/поставке» нет и не
 * заводится — у существующих обращений (server/support.mjs) нет полей
 * ref_type/ref_id, и добавлять их ради одной этой кнопки означало бы
 * тянуть новую сущность туда, где хватает уже готового текстового
 * тела обращения. Вместо этого контекст (кто, какой заказ, какая
 * поставка, какая точка) кладётся в само тело обращения человеко-
 * читаемым текстом, который человек может дополнить перед отправкой —
 * это ровно то же самое, что и «Сообщить об ошибке» в остальном Sky.
 */
import { useState } from 'react';
import { LifeBuoy, Loader2, Check } from 'lucide-react';
import { C, Alert } from './ui';
import { apiCreateTicket } from '@/moderation/supportApi';

const inputStyle = {
  background: C.l2,
  border: `1px solid ${C.brd}`,
  color: C.t1,
};

export const ReportProblemButton = ({ subject, context, label = 'Сообщить о проблеме' }:
{ subject: string; context: Record<string, string | null | undefined>; label?: string }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contextLines = Object.entries(context)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const openForm = () => {
    setText(contextLines ? `${contextLines}\n\n` : '');
    setDone(false); setError(null); setOpen(true);
  };

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true); setError(null);
    const r = await apiCreateTicket({ subject, body: text.trim(), kind: 'report' });
    setBusy(false);
    if (!r.ok) { setError(r.reason ?? 'Не получилось отправить'); return; }
    setDone(true);
  };

  return (
    <>
      <button type="button" onClick={openForm}
        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold"
        style={{ background: 'rgba(239,68,68,0.1)', color: C.red }}>
        <LifeBuoy size={11} /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-[500] flex items-end justify-center p-4 sm:items-center"
          style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-2 rounded-2xl p-4"
            style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-[12px] font-bold" style={{ color: C.t1 }}>{subject}</p>
            {done ? (
              <div className="flex items-center gap-2 py-4">
                <Check size={16} style={{ color: C.green }} />
                <p className="text-[12px]" style={{ color: C.t2 }}>Обращение отправлено в поддержку.</p>
              </div>
            ) : (
              <>
                <p className="text-[10px]" style={{ color: C.t3 }}>
                  Ниже уже подставлены данные заказа/поставки/точки — опишите, что произошло, своими словами.
                </p>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} maxLength={4000}
                  className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
                {error && <Alert text={error} />}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)}
                    className="flex-1 rounded-xl py-2 text-[11px] font-bold" style={{ background: C.l2, color: C.t2 }}>Закрыть</button>
                  <button type="button" disabled={busy || !text.trim()} onClick={send}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-bold disabled:opacity-40"
                    style={{ background: C.acc, color: '#fff' }}>
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <LifeBuoy size={12} />} Отправить
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
