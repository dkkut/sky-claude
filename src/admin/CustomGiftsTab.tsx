/**
 * Вкладка «Пользовательские подарки» (право `gifts`): очередь проверки, просмотр файла, одобрить / отклонить с причиной / передать на дополнительную проверку / убрать из каталога.
 * Сервер: server/customgifts.mjs. Свой подарок не проверяют; решение по переданному на дополнительную проверку принимает ДРУГОЙ модератор (владелец сервиса — любой).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { StoryImg, StoryVideo } from '@/stories/StoryMedia';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/custom-gifts';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ST: Record<string, string> = { pending: 'На проверке', extra_review: 'Дополнительная проверка', approved: 'В каталоге', rejected: 'Отклонён', removed: 'Убран' };
const ERR: Record<string, string> = { not_allowed: 'Недостаточно прав.', self_review: 'Свой подарок проверять нельзя.', reason_required: 'Укажите причину (от 5 знаков).', second_reviewer_required: 'Решение по переданному на дополнительную проверку принимает другой модератор.', bad_state: 'В этом статусе так сделать нельзя.', not_found: 'Не найдено.', media_required: 'У подарка нет файла.' };
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);

export const CustomGiftsTab = () => {
  const [filter, setFilter] = useState(''); const [d, setD] = useState<Data | null>(null); const [open, setOpen] = useState<Data | null>(null); const [why, setWhy] = useState(''); const [log, setLog] = useState<Data[]>([]);
  const load = useCallback(async () => { const r = await apiCall<Data>(`${A}?status=${filter}`); if (r.ok) setD(r.data ?? {}); }, [filter]);
  useEffect(() => { void load(); }, [load]);
  const run = async (action: string) => {
    if (!open) return; const r = await apiCall<Data>(`${A}/${open.id}/${action}`, { method: 'POST', body: JSON.stringify({ reason: why }) });
    if (!r.ok || r.data?.error) { flash(ERR[r.data?.error ?? r.error ?? ''] ?? `Не получилось (${r.data?.error ?? r.error})`); return; } flash('Готово'); setWhy(''); setOpen(null); void load();
  };
  const view = async (g: Data) => { setOpen(g); const r = await apiCall<Data>(`${A}/${g.id}/log`); setLog(r.data?.log ?? []); };
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{[['', 'Очередь'], ['approved', 'В каталоге'], ['rejected', 'Отклонённые'], ['removed', 'Убранные']].map(([k, l]) => <Btn key={k} tone={filter === k ? 'acc' : 'plain'} onClick={() => { setFilter(k); setOpen(null); }}>{l}</Btn>)}</div>
      <div className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        {(d.gifts as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Подарков нет.</p>}
        {(d.gifts as Data[]).map((g) => <button key={g.id} type="button" onClick={() => void view(g)} className="block w-full rounded-xl px-3 py-2 text-left text-sm" style={{ background: C.l2, color: C.t1 }}><span translate="no" className="font-bold">{g.name}</span> · <span translate="no">{g.authorName}</span> · {ST[g.status]}</button>)}
      </div>
      {open && (
        <div className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-sm font-bold" style={{ color: C.t1 }}><span translate="no">{open.name}</span> — <span translate="no">{open.authorName}</span> · {ST[open.status]}</p>
          {open.hasMedia && <div className="w-48 overflow-hidden rounded-2xl">{open.mediaKind === 'video' ? <StoryVideo src={`${A}/${open.id}/media`} controls className="w-full" /> : <StoryImg src={`${A}/${open.id}/media`} className="w-full" />}</div>}
          <p translate="no" className="whitespace-pre-line text-sm" style={{ color: C.t2 }}>{open.description}</p>
          {open.escalationNote && <p translate="no" className="text-xs" style={{ color: C.amber }}>{`Передано на проверку: ${open.escalationNote}`}</p>}
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Причина или заметка (обязательна для отказа, передачи и удаления)" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />
          <div className="flex flex-wrap gap-2">
            {['pending', 'extra_review'].includes(open.status) && <><Btn onClick={() => void run('approve')}>Одобрить</Btn><Btn tone="red" onClick={() => void run('reject')}>Отклонить</Btn></>}
            {open.status === 'pending' && <Btn tone="plain" onClick={() => void run('escalate')}>Передать на дополнительную проверку</Btn>}
            {open.status === 'approved' && <Btn tone="red" onClick={() => void run('remove')}>Убрать из каталога</Btn>}
          </div>
          <div className="text-[11px]" style={{ color: C.t3 }}>{log.slice(0, 8).map((l, i) => <p key={i}>{`${new Date(l.at).toLocaleString('ru-RU')} · ${l.action}${l.detail ? ` — ${l.detail}` : ''}`}</p>)}</div>
        </div>)}
    </div>
  );
};
