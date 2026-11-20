/** Sky Работа: окно отклика — ход найма, резюме, сообщения, контакты. Общее для кандидата и работодателя. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ChevronLeft } from 'lucide-react';
import { flash } from '@/shared/flash';
import { visibleTick } from '@/shared/visibleTick';
import { Btn, In, card, dt } from '@/kassabiz/ui';
import { jobs, jobErr, type AppFull, type Msg } from './jobsApi';

export const Head = ({ title, onBack }: { title: string; onBack: () => void }) => (
  <div className="mb-3 flex items-center gap-2"><button type="button" aria-label="Назад" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}><ChevronLeft size={18} /></button>
    <h2 className="text-lg font-black" style={{ color: 'var(--t1)' }}>{title}</h2></div>
);
const STAGES = ['sent', 'viewed', 'invited', 'interview', 'offer', 'hired'];
const TONE = (s: string) => (s === 'rejected' ? 'var(--red)' : s === 'hired' ? 'var(--green, #22c55e)' : 'var(--accent)');

export const Thread = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const [a, setA] = useState<AppFull | null>(null); const [msgs, setMsgs] = useState<Msg[]>([]); const [text, setText] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const end = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const r = await jobs.app(id); if (r.ok) setA(r.data!.application);
    const m = await jobs.messages(id); if (m.ok) setMsgs(m.data!.messages);
  }, [id]);
  useEffect(() => { void load(); const t = setInterval(visibleTick(() => { void load(); }), 8000); return () => clearInterval(t); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  if (!a) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} /></div>;
  const run = async (fn: () => Promise<{ ok: boolean; error?: string; status?: number }>) => { if (busy) return; setBusy(true); try { const r = await fn(); if (!r.ok) flash(jobErr(r)); else await load(); return r.ok; } finally { setBusy(false); } };
  const employer = a.role === 'employer';
  const send = async () => { if (!text.trim()) return; if (await run(() => jobs.send(id, text.trim()))) setText(''); };
  const LABEL: Record<string, string> = { invited: 'Пригласить', interview: 'Собеседование', offer: 'Предложение о работе', hired: 'Принят', rejected: 'Отказ', viewed: 'Просмотрен' };
  return (
    <div className="space-y-3">
      <Head title={a.vacancyTitle} onBack={onBack} />
      <div className="rounded-2xl p-4" style={card}>
        <p className="text-sm" style={{ color: 'var(--t2)' }} translate="no">{employer ? `Кандидат: ${a.applicant?.name ?? ''}` : a.company}</p>
        <p className="mt-1 text-base font-black" style={{ color: TONE(a.status) }}>{a.statusLabel}</p>
        {a.status !== 'rejected' && <div className="mt-2 flex gap-1">{STAGES.map((s, i) => <div key={s} className="h-1.5 flex-1 rounded-full" style={{ background: i <= STAGES.indexOf(a.status) ? 'var(--accent)' : 'var(--bg-l2)' }} />)}</div>}
        <div className="mt-2 space-y-0.5">{a.events.map((e, i) => <p key={i} className="text-xs" style={{ color: 'var(--t3)' }}>{e.label} · {dt(e.at)}{e.note ? ` — ${e.note}` : ''}</p>)}</div>
        {employer && a.actions.length > 0 && <>
          <div className="mt-3"><In label="Комментарий (для отказа — причина, кандидат её увидит)" value={note} onChange={setNote} max={500} /></div>
          <div className="mt-2 flex flex-wrap gap-1.5">{a.actions.map((s) => <Btn key={s} small tone={s === 'rejected' ? 'danger' : 'accent'} disabled={busy} onClick={() => void run(() => jobs.setStatus(id, s, note)).then(() => setNote(''))}>{LABEL[s] ?? s}</Btn>)}</div></>}
      </div>
      {a.cover && <div className="rounded-2xl p-4" style={card}><p className="mb-1 text-xs font-bold" style={{ color: 'var(--t3)' }}>Сопроводительное письмо</p><p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--t1)' }} translate="no">{a.cover}</p></div>}
      {employer && a.resume && (
        <div className="rounded-2xl p-4 text-sm" style={{ ...card, color: 'var(--t1)' }} translate="no">
          <p className="font-black">{a.resume.position}</p><p style={{ color: 'var(--t3)' }}>{a.resume.city} · опыт {a.resume.experienceYears} л.{a.resume.desiredSalary ? ` · ${a.resume.desiredSalary.toLocaleString('ru-RU')} ₽` : ''}</p>
          {a.resume.skills.length > 0 && <p className="mt-1">{a.resume.skills.join(', ')}</p>}{a.resume.about && <p className="mt-2 whitespace-pre-wrap">{a.resume.about}</p>}
          {(a.resume.experience ?? []).map((x, i) => <p key={i} className="mt-1"><b>{x.role}</b>, {x.company} ({x.from}–{x.to}){x.text ? ` — ${x.text}` : ''}</p>)}
          {(a.resume.education ?? []).map((x, i) => <p key={i} className="mt-1">{x.place}, {x.spec} {x.year}</p>)}
          <p className="mt-2 text-xs" style={{ color: 'var(--t3)' }}>{a.contact ? `Контакты: ${a.contact.phone} ${a.contact.email}` : 'Контакты скрыты: кандидат откроет их сам.'}</p>
        </div>)}
      {!employer && <div className="flex items-center justify-between rounded-2xl p-3 text-sm" style={{ ...card, color: 'var(--t1)' }}><span>Показать работодателю мои контакты из резюме</span>
        <input type="checkbox" aria-label="Открыть контакты" checked={a.contactsShared} onChange={(e) => void run(() => jobs.contacts(id, e.target.checked))} /></div>}
      <div className="rounded-2xl p-3" style={card}>
        <div className="max-h-72 space-y-1.5 overflow-y-auto">{msgs.length === 0 && <p className="text-xs" style={{ color: 'var(--t3)' }}>Сообщений пока нет.</p>}
          {msgs.map((m) => <div key={m.id} className={`flex ${m.mine ? 'justify-end' : ''}`}><div className="max-w-[80%] rounded-2xl px-3 py-1.5 text-sm" translate="no" style={{ background: m.mine ? 'var(--accent)' : 'var(--bg-l2)', color: m.mine ? '#fff' : 'var(--t1)' }}>{m.text}</div></div>)}<div ref={end} /></div>
        <div className="mt-2 flex gap-2"><div className="flex-1"><In label="Сообщение" value={text} onChange={setText} max={2000} /></div><div className="self-end pb-0.5"><Btn tone="accent" disabled={busy || !text.trim()} onClick={() => void send()}>Отправить</Btn></div></div>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--t3)' }}>Не передавайте пароли, коды и деньги. Работодатель не вправе требовать оплату за трудоустройство — сообщите нам через жалобу на вакансию.</p>
      </div>
    </div>
  );
};
