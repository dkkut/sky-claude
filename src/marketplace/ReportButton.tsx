import { useState } from 'react';
import { Flag } from 'lucide-react';
import { C, inputStyle, Alert } from './ui';
import { apiReport, REPORT_REASONS } from './verifyApi';

/** Пожаловаться на товар или магазин. Решение принимает модератор, продавец жалобу не видит и не удаляет. */
export const ReportButton = ({ targetType, targetId }: { targetType: 'product' | 'shop'; targetId: string }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('misleading');
  const [details, setDetails] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const r = await apiReport({ targetType, targetId, reason, details });
    setBusy(false);
    if (r.ok) { setMsg('Жалоба отправлена модераторам. Спасибо.'); setOpen(false); return; }
    setMsg(({
      already_reported: 'Вы уже жаловались на это — жалоба ещё рассматривается.',
      too_many_reports: 'Слишком много жалоб за сутки. Попробуйте завтра.',
      details_required: 'Опишите проблему подробнее.',
      own_target: 'На свой магазин жаловаться нельзя.',
    } as Record<string, string>)[r.error ?? ''] ?? r.reason ?? 'Не получилось отправить жалобу.');
  };

  return (
    <div className="space-y-2">
      {!open && (
        <button type="button" onClick={() => { setOpen(true); setMsg(''); }} className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: C.t3 }}>
          <Flag size={12} /> Пожаловаться
        </button>
      )}
      {open && (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
            {Object.entries(REPORT_REASONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={1000} placeholder="Что не так (необязательно)"
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-xl py-2 text-[12px] font-bold" style={{ background: C.l2, color: C.t1 }}>Отмена</button>
            <button type="button" disabled={busy} onClick={() => void send()} className="flex-1 rounded-xl py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.red }}>Отправить</button>
          </div>
        </div>
      )}
      {msg && <Alert kind="info" text={msg} />}
    </div>
  );
};
