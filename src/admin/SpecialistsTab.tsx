/**
 * Вкладка «Биржа специалистов» (право `specialists`): анкеты на проверке, жалобы, споры по заказам, журнал. Анкету не публикует её владелец (`self_review`).
 * Сервер: server/specialists.mjs. Деньги биржа не двигает — спор закрывается только статусом.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { StoryImg } from '@/stories/StoryMedia';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/specialists';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ST: Record<string, string> = { draft: 'Черновик', pending: 'На проверке', published: 'Опубликована', rejected: 'Отклонена', suspended: 'Приостановлена' };
const REASON: Record<string, string> = { fraud: 'Мошенничество', spam: 'Спам', abuse: 'Оскорбления', fake_portfolio: 'Чужие работы', illegal: 'Запрещённый контент', other: 'Другое' };
const ERR: Record<string, string> = { not_allowed: 'Недостаточно прав.', self_review: 'Свою анкету проверять нельзя.', reason_required: 'Укажите причину (от 5 знаков).', bad_state: 'В этом статусе так сделать нельзя.', not_found: 'Не найдено.', not_disputed: 'Спор не открыт.' };
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const Box = ({ title, children }: { title: string; children: ReactNode }) => <div className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}><p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>{children}</div>;

export const SpecialistsTab = () => {
  const [d, setD] = useState<Data | null>(null); const [filter, setFilter] = useState('pending'); const [open, setOpen] = useState<Data | null>(null); const [why, setWhy] = useState('');
  const [dispute, setDispute] = useState<Data | null>(null);
  const load = useCallback(async () => { const r = await apiCall<Data>(`${A}?status=${filter}`); if (r.ok) setD(r.data ?? {}); }, [filter]);
  useEffect(() => { void load(); }, [load]);
  const run = async (path: string, body: unknown, done?: () => void) => {
    const r = await apiCall<Data>(path, { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok || r.data?.error) { flash(ERR[r.data?.error ?? r.error ?? ''] ?? `Не получилось (${r.data?.error ?? r.error})`); return; } flash('Готово'); setWhy(''); done?.(); void load();
  };
  const view = async (p: Data) => { const r = await apiCall<Data>(`${A}/${p.id}`); const l = await apiCall<Data>(`${A}/${p.id}/log`); setOpen({ ...p, ...(r.data?.specialist ?? {}), log: l.data?.log ?? [] }); };
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">{['pending', 'published', 'rejected', 'suspended', ''].map((s) => <Btn key={s || 'all'} tone={filter === s ? 'acc' : 'plain'} onClick={() => { setFilter(s); setOpen(null); }}>{s ? ST[s] : 'Все'}</Btn>)}</div>
      <Box title="Анкеты">
        {(d.profiles as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Анкет нет.</p>}
        {(d.profiles as Data[]).map((p) => <button key={p.id} type="button" onClick={() => void view(p)} className="block w-full rounded-xl px-3 py-2 text-left text-sm" style={{ background: C.l2, color: C.t1 }}><span translate="no" className="font-bold">{p.displayName}</span> · {ST[p.status]} · {p.category}</button>)}
      </Box>
      {open && (
        <Box title={`Анкета: ${open.displayName}`}>
          {open.hasPhoto && <div className="h-20 w-20 overflow-hidden rounded-2xl"><StoryImg src={`${A}/${open.id}/photo`} className="h-full w-full object-cover" /></div>}
          <p translate="no" className="whitespace-pre-line text-sm" style={{ color: C.t2 }}>{open.description}</p>
          <p className="text-xs" style={{ color: C.t3 }}>{`Специализации: ${(open.specializations ?? []).join(', ')} · Услуг: ${(open.services ?? []).length} · Работ: ${(open.portfolio ?? []).length}`}</p>
          <div className="grid gap-2 sm:grid-cols-2">{(open.portfolio ?? []).map((w: Data) => <div key={w.id} className="rounded-xl p-2" style={{ background: C.l2 }}>{w.hasImage && <StoryImg src={`${A}/work/${w.id}/image`} className="h-28 w-full rounded-lg object-cover" />}<p translate="no" className="text-xs font-bold" style={{ color: C.t1 }}>{w.title}</p>{w.url && <a href={w.url} target="_blank" rel="noopener noreferrer" className="text-xs" style={{ color: C.acc }}>{w.url}</a>}</div>)}</div>
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Причина (нужна для отказа и приостановки)" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />
          <div className="flex flex-wrap gap-2">
            {open.status === 'pending' && <><Btn onClick={() => void run(`${A}/${open.id}/approve`, {}, () => setOpen(null))}>Опубликовать</Btn><Btn tone="red" onClick={() => void run(`${A}/${open.id}/reject`, { reason: why }, () => setOpen(null))}>Отклонить</Btn></>}
            {open.status === 'published' && <Btn tone="red" onClick={() => void run(`${A}/${open.id}/suspend`, { reason: why }, () => setOpen(null))}>Приостановить</Btn>}
            {open.status === 'suspended' && <Btn onClick={() => void run(`${A}/${open.id}/restore`, {}, () => setOpen(null))}>Вернуть в каталог</Btn>}
          </div>
          <div className="text-[11px]" style={{ color: C.t3 }}>{(open.log as Data[]).slice(0, 8).map((l, i) => <p key={i}>{`${new Date(l.at).toLocaleString('ru-RU')} · ${l.action}${l.detail ? ` — ${l.detail}` : ''}`}</p>)}</div>
        </Box>)}
      <Box title={`Жалобы (${(d.reports as Data[]).length})`}>
        {(d.reports as Data[]).map((r) => (
          <div key={r.id} className="space-y-1 rounded-xl p-3 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <p>{`${r.targetType === 'offer' ? 'Предложение' : 'Анкета'} · ${REASON[r.reason] ?? r.reason}`}</p>{r.details && <p translate="no">{r.details}</p>}
            <div className="flex flex-wrap gap-2"><Btn tone="plain" onClick={() => void run(`${A}/reports/${r.id}`, { outcome: 'resolved', note: why || 'Проверено, меры приняты' })}>Решено</Btn><Btn tone="plain" onClick={() => void run(`${A}/reports/${r.id}`, { outcome: 'dismissed', note: why || 'Нарушений не найдено' })}>Отклонить жалобу</Btn></div>
          </div>))}
        {(d.reports as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Открытых жалоб нет.</p>}
      </Box>
      <Box title={`Споры (${(d.disputes as Data[]).length})`}>
        {(d.disputes as Data[]).map((x) => (
          <div key={x.id} className="space-y-1 rounded-xl p-3 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <p translate="no">{`${x.title} · ${x.specialist}`}</p><p translate="no">{`Причина: ${x.reason}`}</p>
            <div className="flex flex-wrap gap-2"><Btn tone="plain" onClick={() => void apiCall<Data>(`${A}/offers/${x.id}`).then((r) => setDispute(r.data ?? null))}>Прочитать переписку</Btn>
              <Btn onClick={() => void run(`${A}/offers/${x.id}/resolve`, { outcome: 'completed', note: why })}>Закрыть как завершённый</Btn><Btn tone="red" onClick={() => void run(`${A}/offers/${x.id}/resolve`, { outcome: 'cancelled', note: why })}>Закрыть как отменённый</Btn></div>
          </div>))}
        {dispute && <div className="space-y-1 rounded-xl p-3 text-xs" style={{ background: C.l2, color: C.t2 }}><p translate="no" className="whitespace-pre-line">{dispute.offer?.brief}</p>{(dispute.messages ?? []).map((m: Data, i: number) => <p key={i} translate="no">{`${m.side === 'client' ? 'Клиент' : 'Специалист'}: ${m.text}`}</p>)}</div>}
        <p className="text-[11px]" style={{ color: C.t3 }}>Решение — только статус заказа. Деньги биржа не принимает и не возвращает; чтение переписки пишется в журнал.</p>
        {(d.disputes as Data[]).length > 0 && <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Основание решения (от 5 знаков)" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />}
      </Box>
    </div>
  );
};
