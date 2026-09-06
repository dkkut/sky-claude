import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, X, Check, Trash2, MapPin, Wallet } from 'lucide-react';
import { useFamilyStore } from '../store';

export const FamilyTravel = ({ onBack }: { onBack: () => void }) => {
  const { family, createTrip, deleteTrip, addChecklistItem, toggleChecklistItem, removeChecklistItem, updateTripNotes } = useFamilyStore();
  const [creating, setCreating] = useState(false);
  const [openTrip, setOpenTrip] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [budget, setBudget] = useState('');
  const [checklistText, setChecklistText] = useState('');

  if (!family) return null;
  const trip = family.trips.find(t => t.id === openTrip);

  const submit = () => {
    if (!title.trim() || !destination.trim() || !startDate || !endDate) return;
    createTrip(title.trim(), destination.trim(), startDate, endDate, budget ? Number(budget) : undefined);
    setCreating(false); setTitle(''); setDestination(''); setStartDate(''); setEndDate(''); setBudget('');
  };

  if (trip) {
    const done = trip.checklist.filter(c => c.done).length;
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
          <button type="button" onClick={() => setOpenTrip(null)} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
          <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>{trip.title}</h2>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="rounded-3xl p-4" style={{ background: 'linear-gradient(135deg, rgba(79,110,247,0.16), var(--bg-l1))', border: '1px solid rgba(79,110,247,0.22)' }}>
            <p className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: 'var(--t1)' }}><MapPin size={13}/>{trip.destination}</p>
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--t3)' }}>
              {new Date(trip.startDate).toLocaleDateString('ru-RU')} — {new Date(trip.endDate).toLocaleDateString('ru-RU')}
            </p>
            {trip.budget && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--t2)' }}><Wallet size={12}/>Бюджет: {trip.budget.toLocaleString('ru')} ₽</p>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Чек-лист</p>
              <span className="text-[11px]" style={{ color: 'var(--t3)' }}>{done}/{trip.checklist.length}</span>
            </div>
            <div className="space-y-1.5">
              {trip.checklist.map(c => (
                <div key={c.id} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                  <button type="button" onClick={() => toggleChecklistItem(trip.id, c.id)}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white" style={{ background: c.done ? 'var(--green)' : 'transparent', border: c.done ? 'none' : '2px solid var(--border)' }}>
                    {c.done && <Check size={13}/>}
                  </button>
                  <p className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: 'var(--t1)', textDecoration: c.done ? 'line-through' : 'none', opacity: c.done ? 0.55 : 1 }}>{c.text}</p>
                  <button type="button" onClick={() => removeChecklistItem(trip.id, c.id)}><X size={12} style={{ color: 'var(--t3)' }}/></button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-xl p-1" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <input value={checklistText} onChange={e => setChecklistText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && checklistText.trim()) { addChecklistItem(trip.id, checklistText.trim()); setChecklistText(''); } }}
                placeholder="Добавить пункт (билеты, отель...)" className="flex-1 bg-transparent px-2.5 py-2 text-[12.5px] outline-none" style={{ color: 'var(--t1)' }}/>
              <button type="button" onClick={() => { if (checklistText.trim()) { addChecklistItem(trip.id, checklistText.trim()); setChecklistText(''); } }}
                className="mr-1 grid h-7 w-7 place-items-center rounded-full" style={{ background: 'var(--accent)' }}>
                <Plus size={13} className="text-white"/>
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Заметки о поездке</p>
            <textarea value={trip.notes} onChange={e => updateTripNotes(trip.id, e.target.value)} rows={4}
              placeholder="Маршрут, номера бронирований, важные детали..."
              className="w-full resize-none rounded-2xl px-4 py-3 text-[13px] outline-none" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
          </div>

          <button type="button" onClick={() => { deleteTrip(trip.id); setOpenTrip(null); }} className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--red)' }}>
            <Trash2 size={12}/>Удалить поездку
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
          <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Режим путешествий</h2>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: 'var(--accent)' }}>
          <Plus size={13} className="inline"/> Поездка
        </button>
      </div>

      <div className="flex-1 px-4 py-3 space-y-2.5">
        {family.trips.length === 0 && (
          <div className="sky-empty py-10">
            <div className="sky-empty-icon">✈️</div>
            <p style={{ color: 'var(--t2)' }}>Спланируйте первую семейную поездку</p>
            <button type="button" onClick={() => setCreating(true)} className="sky-btn-primary mt-2 px-5 py-2.5">Создать поездку</button>
          </div>
        )}
        {family.trips.map(t => {
          const done = t.checklist.filter(c => c.done).length;
          const pct = t.checklist.length ? Math.round((done/t.checklist.length)*100) : 0;
          return (
            <button key={t.id} type="button" onClick={() => setOpenTrip(t.id)}
              className="w-full rounded-2xl p-4 text-left" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <p className="text-[14px] font-bold" style={{ color: 'var(--t1)' }}>✈️ {t.title}</p>
              <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--t3)' }}>{t.destination} · {new Date(t.startDate).toLocaleDateString('ru-RU')}</p>
              {t.checklist.length > 0 && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-l2)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }}/>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {creating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setCreating(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl p-5" style={{ background: 'var(--bg-l1)' }}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Новая поездка</p>
                <button type="button" onClick={() => setCreating(false)}><X size={16} style={{ color: 'var(--t3)' }}/></button>
              </div>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название поездки" maxLength={40}
                className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="Куда едем?" maxLength={40}
                className="mt-2.5 w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <div className="mt-2.5 flex gap-2.5">
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-1/2 rounded-2xl px-4 py-3 text-[13px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-1/2 rounded-2xl px-4 py-3 text-[13px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              </div>
              <input value={budget} onChange={e => setBudget(e.target.value.replace(/\D/g,''))} placeholder="Бюджет, ₽ (необязательно)" inputMode="numeric"
                className="mt-2.5 w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={submit} className="sky-btn-primary mt-4 w-full justify-center py-3.5">Создать</motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
