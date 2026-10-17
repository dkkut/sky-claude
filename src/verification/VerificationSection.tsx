/** Профиль → «Верификация»: критерии, мои объекты (профиль, видеоканал, группы и каналы), статус и подача заявки. */
import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Loader2, Clock, XCircle, CheckCircle2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Cur { id: string; status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'withdrawn'; mark: 'verified' | 'official'; reason?: string }
interface Subj { type: string; id: string; title?: string; handle?: string; eligible: boolean; problems: string[]; current?: Cur }
interface Mine { enabled: boolean; criteriaText: string; minimums: { retryDays: number }; subjects: Subj[] }

const TYPE_LABEL: Record<string, string> = { user: 'Профиль', video_channel: 'Видеоканал Sky Video', chat_group: 'Группа', chat_channel: 'Канал' };
const ERR: Record<string, string> = {
  note_required: 'Опишите, почему вам нужна отметка (не короче 10 знаков).', already_pending: 'Заявка уже на проверке.', already_verified: 'Отметка уже стоит.',
  retry_later: 'После отказа повторная заявка возможна позже.', closed: 'Приём заявок сейчас закрыт.', not_owner: 'Заявку подаёт владелец.', not_eligible: 'Не выполнены условия.',
  too_many_requests: 'Слишком часто. Попробуйте позже.',
};
const box = { background: 'var(--bg-l1)', border: '1px solid var(--border)' };
const field = { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' };

const Status = ({ c }: { c?: Cur }) => {
  if (!c) return null;
  if (c.status === 'approved') return <span className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--green)' }}><CheckCircle2 size={13} />{c.mark === 'official' ? 'Официальный' : 'Подтверждено'}</span>;
  if (c.status === 'pending') return <span className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--amber, #f59e0b)' }}><Clock size={13} />На проверке</span>;
  if (c.status === 'rejected' || c.status === 'revoked') return <span className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--red)' }}><XCircle size={13} />{c.status === 'rejected' ? 'Отклонено' : 'Отметка снята'}{c.reason ? `: ${c.reason}` : ''}</span>;
  return null;
};

export const VerificationSection = () => {
  const [d, setD] = useState<Mine | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState(''); const [links, setLinks] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const load = useCallback(async () => { const r = await apiCall<Mine>('/api/verification/mine'); if (r.ok && r.data) setD(r.data); }, []);
  useEffect(() => { void load(); }, [load]);

  const send = async (s: Subj) => {
    setBusy(true); setErr('');
    const r = await apiCall<{ ok: boolean; problems?: string[] }>('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: s.type, subjectId: s.id, note, links: links.split(/\s+/).filter(Boolean) }) });
    setBusy(false);
    if (!r.ok) { setErr(ERR[r.error ?? ''] ?? 'Не получилось отправить заявку'); return; }
    flash('Заявка отправлена'); setOpen(null); setNote(''); setLinks(''); void load();
  };
  const withdraw = async (c: Cur) => { await apiCall(`/api/verification/${c.id}/withdraw`, { method: 'POST', body: '{}' }); void load(); };

  if (!d) return <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--t3)' }}><Loader2 size={14} className="animate-spin" />Загрузка…</p>;
  return (
    <section className="space-y-3 rounded-2xl p-4" style={box} data-verification>
      <p className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--t1)' }}><BadgeCheck size={16} style={{ color: 'var(--accent)' }} />Верификация</p>
      <p className="text-[12px]" style={{ color: 'var(--t2)' }}>Отметка показывает, что аккаунт или сообщество подтверждены сотрудниками Sky. Проверка ручная: мы не сверяем данные с государственными реестрами. Выдать отметку себе нельзя.</p>
      {d.criteriaText && <ul className="list-disc space-y-0.5 pl-5 text-[12px]" style={{ color: 'var(--t2)' }}>{d.criteriaText.split('\n').filter(Boolean).map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {!d.enabled && <p className="text-[12px]" style={{ color: 'var(--red)' }}>Приём заявок сейчас закрыт.</p>}
      <ul className="space-y-2">
        {d.subjects.map((s) => {
          const busyState = s.current?.status === 'pending' || s.current?.status === 'approved';
          return (
            <li key={`${s.type}:${s.id}`} className="rounded-xl p-3" style={{ background: 'var(--bg-l2)' }}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--t1)' }} translate="no">{s.title}</p>
                  <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{TYPE_LABEL[s.type]}{s.handle ? ` · ${s.handle}` : ''}</p>
                </div>
                <Status c={s.current} />
              </div>
              {s.current?.status === 'pending' && <button type="button" onClick={() => void withdraw(s.current!)} className="mt-2 text-[11px] underline" style={{ color: 'var(--t3)' }}>Отозвать заявку</button>}
              {!busyState && d.enabled && (
                s.eligible ? (open === s.id
                  ? (
                    <div className="mt-2 space-y-2">
                      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1500} placeholder="Почему вам нужна отметка, кто вы" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} aria-label="Пояснение" />
                      <textarea value={links} onChange={(e) => setLinks(e.target.value)} rows={2} placeholder="Ссылки-подтверждения (https://…, через пробел или с новой строки)" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} aria-label="Ссылки" />
                      {err && <p className="text-[12px]" style={{ color: 'var(--red)' }}>{err}</p>}
                      <div className="flex gap-2">
                        <button type="button" disabled={busy || note.trim().length < 10} onClick={() => void send(s)} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: 'var(--accent)' }}>Отправить заявку</button>
                        <button type="button" onClick={() => { setOpen(null); setErr(''); }} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: 'var(--bg-l1)', color: 'var(--t2)' }}>Отмена</button>
                      </div>
                    </div>)
                  : <button type="button" onClick={() => { setOpen(s.id); setErr(''); }} className="mt-2 rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: 'var(--accent)' }}>Подать заявку</button>)
                  : <ul className="mt-2 list-disc pl-5 text-[11.5px]" style={{ color: 'var(--t3)' }}>{s.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
