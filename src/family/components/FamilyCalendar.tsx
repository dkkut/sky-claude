import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, X, Check } from 'lucide-react';
import { useFamilyStore } from '../store';
import { CALENDAR_KIND_LABEL, CALENDAR_KIND_ICON } from '../types';
import type { CalendarEventKind } from '../types';

const KINDS = Object.keys(CALENDAR_KIND_LABEL) as CalendarEventKind[];

export const FamilyCalendar = ({ onBack }: { onBack: () => void }) => {
  const { upcomingEvents, addEvent, removeEvent } = useFamilyStore();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<CalendarEventKind>('event');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');

  const events = upcomingEvents();
  const today = new Date(); today.setHours(0,0,0,0);
  const future = events.filter(e => new Date(e.date) >= today);
  const past = events.filter(e => new Date(e.date) < today);

  const submit = () => {
    if (!title.trim() || !date) return;
    addEvent(title.trim(), kind, date, note.trim() || undefined);
    setAdding(false); setTitle(''); setDate(''); setNote(''); setKind('event');
  };

  const Row = ({ e }: { e: typeof events[number] }) => (
    <div className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl" style={{ background: 'var(--bg-l2)' }}>{CALENDAR_KIND_ICON[e.kind]}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>{e.title}</p>
        <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>
          {CALENDAR_KIND_LABEL[e.kind]} · {new Date(e.date).toLocaleDateString('ru-RU', { day:'numeric', month:'long' })}{e.note ? ` · ${e.note}` : ''}
        </p>
      </div>
      <button type="button" onClick={() => removeEvent(e.id)}><X size={14} style={{ color: 'var(--t3)' }}/></button>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
          <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Семейный календарь</h2>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: 'var(--accent)' }}>
          <Plus size={13} className="inline"/> Событие
        </button>
      </div>

      <div className="flex-1 px-4 py-3 space-y-2">
        {events.length === 0 && (
          <div className="sky-empty py-10">
            <div className="sky-empty-icon">📅</div>
            <p style={{ color: 'var(--t2)' }}>Пока нет событий</p>
            <button type="button" onClick={() => setAdding(true)} className="sky-btn-primary mt-2 px-5 py-2.5">Добавить событие</button>
          </div>
        )}
        {future.length > 0 && (
          <>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Предстоящие</p>
            {future.map(e => <Row key={e.id} e={e}/>)}
          </>
        )}
        {past.length > 0 && (
          <>
            <p className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Прошедшие</p>
            {past.map(e => <div key={e.id} className="opacity-50"><Row e={e}/></div>)}
          </>
        )}
      </div>

      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setAdding(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl p-5" style={{ background: 'var(--bg-l1)' }}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Новое событие</p>
                <button type="button" onClick={() => setAdding(false)}><X size={16} style={{ color: 'var(--t3)' }}/></button>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {KINDS.map(k => (
                  <button key={k} type="button" onClick={() => setKind(k)}
                    className="rounded-xl px-3 py-1.5 text-[12px] font-semibold" style={{ background: kind === k ? 'var(--accent)' : 'var(--bg-l2)', color: kind === k ? '#fff' : 'var(--t2)' }}>
                    {CALENDAR_KIND_ICON[k]} {CALENDAR_KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название события" maxLength={40}
                className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="mt-2.5 w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Заметка (необязательно)" maxLength={60}
                className="mt-2.5 w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={submit} className="sky-btn-primary mt-4 w-full justify-center py-3.5">
                <Check size={15}/>Добавить
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
