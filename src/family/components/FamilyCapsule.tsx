import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, X, Lock, Unlock, Mail, Hourglass} from 'lucide-react';
import { useFamilyStore } from '../store';

export const FamilyCapsule = ({ onBack }: { onBack: () => void }) => {
  const { family, createCapsule, openCapsule } = useFamilyStore();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [unlockAt, setUnlockAt] = useState('');
  const [opened, setOpened] = useState<string | null>(null);

  if (!family) return null;

  const submit = () => {
    if (!title.trim() || !message.trim() || !unlockAt) return;
    createCapsule(title.trim(), message.trim(), new Date(unlockAt).toISOString());
    setCreating(false); setTitle(''); setMessage(''); setUnlockAt('');
  };

  const tryOpen = (id: string) => {
    openCapsule(id);
    setOpened(id);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
          <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Капсула времени</h2>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: 'var(--accent)' }}>
          <Plus size={13} className="inline"/> Капсула
        </button>
      </div>

      <div className="flex-1 px-4 py-3 space-y-2.5">
        {family.capsules.length === 0 && (
          <div className="sky-empty py-10">
            <div className="sky-empty-icon"><Hourglass size={30}/></div>
            <p style={{ color: 'var(--t2)' }}>Сохраните письмо или сообщение — и откройте его в будущем всей семьёй</p>
            <button type="button" onClick={() => setCreating(true)} className="sky-btn-primary mt-2 px-5 py-2.5">Создать капсулу</button>
          </div>
        )}
        {family.capsules.map(c => {
          const locked = new Date(c.unlockAt).getTime() > Date.now();
          const showContent = c.opened || opened === c.id;
          return (
            <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-3xl p-4" style={{ background: locked ? 'var(--bg-l2)' : 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-lg" style={{ background: locked ? 'var(--bg-l1)' : 'rgba(79,110,247,0.14)' }}>
                  {locked ? <Lock size={17} style={{ color: 'var(--t3)' }}/> : <Unlock size={17} style={{ color: 'var(--accent)' }}/>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>{c.title}</p>
                  <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
                    от {c.authorName} · {locked ? `откроется ${new Date(c.unlockAt).toLocaleDateString('ru-RU')}` : 'можно открыть'}
                  </p>
                </div>
              </div>

              {!locked && !showContent && (
                <button type="button" onClick={() => tryOpen(c.id)} className="sky-btn-primary mt-3 w-full justify-center py-2.5 text-[12.5px]">
                  <Mail size={13}/>Открыть капсулу
                </button>
              )}
              {showContent && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 rounded-2xl p-3 text-[13px] leading-relaxed" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
                  {c.message}
                </motion.p>
              )}
            </motion.div>
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
                <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Новая капсула</p>
                <button type="button" onClick={() => setCreating(false)}><X size={16} style={{ color: 'var(--t3)' }}/></button>
              </div>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название" maxLength={40}
                className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} placeholder="Письмо, воспоминание или пожелание будущему..."
                className="mt-2.5 w-full resize-none rounded-2xl px-4 py-3 text-[13px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <p className="mb-1.5 mt-3 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Дата открытия</p>
              <input type="date" value={unlockAt} onChange={e => setUnlockAt(e.target.value)}
                className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={submit} className="sky-btn-primary mt-4 w-full justify-center py-3.5">Запечатать капсулу</motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
