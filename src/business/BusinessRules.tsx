/** Sky Business → «Правила»: действующие правила организаций по разделам; владелец организации подтверждает ознакомление с конкретной редакцией (server/bizrules.mjs). */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, ChevronDown } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Rev { version: number; title: string; body: string; publishedAt?: string }
interface Sec { section: string; label: string; published: Rev | null; acknowledged: boolean; needsAck: boolean }
const card = { background: 'var(--bg-l1)', border: '1px solid var(--border)' } as const;

export const BusinessRules = () => {
  const [d, setD] = useState<{ isOrganization: boolean; sections: Sec[] } | null>(null); const [open, setOpen] = useState<string | null>(null); const [busy, setBusy] = useState('');
  const load = useCallback(async () => { const r = await apiCall<{ isOrganization: boolean; sections: Sec[] }>('/api/business/rules'); if (r.ok && r.data) setD(r.data); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <div className="grid h-40 place-items-center"><Loader2 className="animate-spin" size={18} style={{ color: 'var(--t3)' }} /></div>;
  const ack = async (section: string) => { setBusy(section); const r = await apiCall('/api/business/rules/ack', { method: 'POST', body: JSON.stringify({ section }) }); setBusy(''); if (r.ok) { flash('Ознакомление подтверждено'); void load(); } else flash(r.error === 'not_organization' ? 'Подтвердить может владелец организации' : 'Не получилось'); };
  return (
    <div className="space-y-3 p-3 sm:p-5">
      <p className="text-lg font-bold" style={{ color: 'var(--t1)' }}>Правила Sky Business</p>
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Общие требования к организациям, продавцам, пунктам выдачи и складам, использование бренда Sky. При каждой новой редакции владелец организации подтверждает ознакомление.</p>
      {d.sections.map((s) => (
        <div key={s.section} className="rounded-2xl" style={card}>
          <button type="button" onClick={() => setOpen(open === s.section ? null : s.section)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
            <span><span className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{s.label}</span>
              <span className="ml-2 text-[11px]" style={{ color: s.needsAck ? '#f59e0b' : 'var(--t3)' }}>{!s.published ? 'ещё не опубликовано' : s.needsAck ? `новая редакция v${s.published.version} — подтвердите` : `редакция v${s.published.version}`}</span></span>
            <ChevronDown size={14} style={{ color: 'var(--t3)', transform: open === s.section ? 'rotate(180deg)' : undefined }} />
          </button>
          {open === s.section && s.published && (
            <div className="space-y-2 px-4 pb-4">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }} translate="no">{s.published.body}</p>
              {s.published.publishedAt && <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Опубликовано {new Date(s.published.publishedAt).toLocaleDateString('ru')}</p>}
              {d.isOrganization && (s.acknowledged
                ? <p className="flex items-center gap-1 text-xs" style={{ color: '#22c55e' }}><Check size={13} />Вы ознакомлены с этой редакцией</p>
                : <button type="button" disabled={busy === s.section} onClick={() => void ack(s.section)} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: 'var(--accent)' }}>Я ознакомился(-ась)</button>)}
            </div>
          )}
          {open === s.section && !s.published && <p className="px-4 pb-4 text-xs" style={{ color: 'var(--t3)' }}>Правила этого раздела ещё не опубликованы.</p>}
        </div>
      ))}
    </div>
  );
};
