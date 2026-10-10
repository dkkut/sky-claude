/**
 * Срок жизни личного файла (кино, музыка).
 *
 * Сервер стирает личный файл безвозвратно, если владелец не открывал его
 * PERSONAL_RETENTION_DAYS дней, а человек об этом не знал и кнопки
 * «хранить» в интерфейсе не было. Здесь срок показан прямо, а защита
 * включается одним нажатием. Если сервер не присылает ни срока, ни
 * защиты (уборка выключена), блок не показывается вовсе.
 */
import { useState } from 'react';
import { Clock, ShieldCheck } from 'lucide-react';
import { flash } from './flash';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

export const RetentionNote = ({ expiresAt, keep, onKeep, compact }: {
  expiresAt?: string; keep?: boolean; onKeep: (keep: boolean) => Promise<boolean>; compact?: boolean;
}) => {
  const [busy, setBusy] = useState(false);
  if (!expiresAt && keep !== true) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onKeep(keep !== true).catch(() => false);
    setBusy(false);
    if (!ok) flash('Не удалось изменить срок хранения');
  };

  return (
    <div className={`flex items-start gap-1.5 rounded-xl px-3 py-2 text-[11px] ${compact ? 'mt-2' : 'mb-4'}`}
      style={{ background: keep ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
        border: `1px solid ${keep ? 'rgba(34,197,94,0.22)' : 'rgba(245,158,11,0.25)'}`, color: 'var(--t2)' }}>
      {keep ? <ShieldCheck size={13} className="mt-0.5 shrink-0" style={{ color: '#22c55e' }}/>
            : <Clock size={13} className="mt-0.5 shrink-0" style={{ color: '#f59e0b' }}/>}
      <span className="flex-1">
        {keep
          ? 'Файл хранится без срока, пока вы сами его не удалите.'
          : `Если не открывать этот файл, он будет удалён ${fmtDate(expiresAt!)}. Откройте его или включите хранение без срока.`}
      </span>
      <button type="button" onClick={() => void toggle()} disabled={busy}
        className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold"
        style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--t1)' }}>
        {keep ? 'Снять защиту' : 'Хранить всегда'}
      </button>
    </div>
  );
};
