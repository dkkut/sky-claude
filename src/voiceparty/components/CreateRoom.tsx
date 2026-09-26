import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Lock, Globe2, Check } from 'lucide-react';
import { useVoicePartyStore } from '../store';
import { CATEGORY_LABEL, CATEGORY_ICON } from '../types';
import type { VPCategory } from '../types';

const CATS = Object.keys(CATEGORY_LABEL) as VPCategory[];
const SIZES = [8, 20, 50, 100];

export const CreateRoom = ({ onBack, onCreated }: { onBack: () => void; onCreated: (id: string) => void }) => {
  const { createRoom } = useVoicePartyStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<VPCategory>('interests');
  const [isPrivate, setIsPrivate] = useState(false);
  const [maxParticipants, setMaxParticipants] = useState(20);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    const scheduled = scheduleMode && !!scheduledFor;
    const id = await createRoom(title.trim(), description.trim(), category, isPrivate, maxParticipants, scheduled ? new Date(scheduledFor).toISOString() : undefined);
    setSubmitting(false);
    if (!id) return;
    if (scheduled) onBack(); else onCreated(id);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Новая комната</h2>
      </div>

      <div className="flex-1 px-4 py-3 space-y-4">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название комнаты" maxLength={50}
          className="w-full rounded-2xl px-4 py-3.5 text-[15px] font-semibold outline-none" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Описание (необязательно)"
          className="w-full resize-none rounded-2xl px-4 py-3 text-[13.5px] outline-none" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>

        <div>
          <p className="mb-2 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Категория</p>
          <div className="flex flex-wrap gap-2">
            {CATS.map(c => (
              <button key={c} type="button" onClick={() => setCategory(c)}
                className="rounded-xl px-3 py-2 text-[12.5px] font-semibold" style={{ background: category === c ? 'var(--accent)' : 'var(--bg-l1)', color: category === c ? '#fff' : 'var(--t2)', border: '1px solid var(--border)' }}>
                {(() => { const Icon = CATEGORY_ICON[c]; return <Icon size={13}/>; })()} {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Тип комнаты</p>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" onClick={() => setIsPrivate(false)}
              className="flex items-center gap-2 rounded-2xl p-3.5" style={{ background: !isPrivate ? 'var(--accent-bg)' : 'var(--bg-l1)', border: `1.5px solid ${!isPrivate ? 'var(--accent)' : 'var(--border)'}` }}>
              <Globe2 size={16} style={{ color: !isPrivate ? 'var(--accent)' : 'var(--t3)' }}/>
              <span className="text-[12.5px] font-semibold" style={{ color: 'var(--t1)' }}>Открытая</span>
            </button>
            <button type="button" onClick={() => setIsPrivate(true)}
              className="flex items-center gap-2 rounded-2xl p-3.5" style={{ background: isPrivate ? 'var(--accent-bg)' : 'var(--bg-l1)', border: `1.5px solid ${isPrivate ? 'var(--accent)' : 'var(--border)'}` }}>
              <Lock size={16} style={{ color: isPrivate ? 'var(--accent)' : 'var(--t3)' }}/>
              <span className="text-[12.5px] font-semibold" style={{ color: 'var(--t1)' }}>Приватная</span>
            </button>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Максимум участников</p>
          <div className="flex gap-2">
            {SIZES.map(s => (
              <button key={s} type="button" onClick={() => setMaxParticipants(s)}
                className="flex-1 rounded-xl py-2.5 text-[13px] font-bold" style={{ background: maxParticipants === s ? 'var(--accent)' : 'var(--bg-l1)', color: maxParticipants === s ? '#fff' : 'var(--t2)', border: '1px solid var(--border)' }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <button type="button" onClick={() => setScheduleMode(v => !v)}
          className="flex w-full items-center justify-between rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--t1)' }}>Запланировать на будущее</span>
          <span className="h-5 w-9 rounded-full p-0.5" style={{ background: scheduleMode ? 'var(--accent)' : 'var(--border)' }}>
            <motion.span className="block h-4 w-4 rounded-full bg-white" animate={{ x: scheduleMode ? 16 : 0 }}/>
          </span>
        </button>
        {scheduleMode && (
          <input type="datetime-local" value={scheduledFor} onChange={e => setScheduledFor(e.target.value)}
            className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
        )}
      </div>

      <div className="shrink-0 p-4">
        <motion.button type="button" whileTap={title.trim() ? { scale: 0.98 } : {}} disabled={!title.trim() || submitting} onClick={submit}
          className="sky-btn-primary w-full justify-center py-3.5 text-[14.5px] disabled:opacity-40">
          <Check size={15}/>{submitting ? 'Секунду…' : scheduleMode ? 'Запланировать' : 'Создать и начать'}
        </motion.button>
      </div>
    </div>
  );
};
