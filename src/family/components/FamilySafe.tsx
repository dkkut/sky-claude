import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, X, Lock, FileText, Image, KeyRound, StickyNote, Users, User } from 'lucide-react';
import { useFamilyStore } from '../store';
import type { SafeItemKind, SafeVisibility } from '../types';

const KIND_ICON: Record<SafeItemKind, any> = { document: FileText, photo: Image, password: KeyRound, note: StickyNote };
const KIND_LABEL: Record<SafeItemKind, string> = { document: 'Документ', photo: 'Фото', password: 'Пароль', note: 'Заметка' };
const VIS_LABEL: Record<SafeVisibility, string> = { owner: 'Только я', adults: 'Взрослые', everyone: 'Все' };

export const FamilySafe = ({ onBack }: { onBack: () => void }) => {
  const { visibleSafeItems, addSafeItem, removeSafeItem } = useFamilyStore();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<SafeItemKind>('note');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<SafeVisibility>('adults');
  const [reveal, setReveal] = useState<string | null>(null);

  const items = visibleSafeItems();

  const submit = () => {
    if (!title.trim() || !content.trim()) return;
    addSafeItem(kind, title.trim(), content.trim(), visibility);
    setAdding(false); setTitle(''); setContent(''); setKind('note'); setVisibility('adults');
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
          <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Семейный сейф</h2>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: 'var(--accent)' }}>
          <Plus size={13} className="inline"/> Добавить
        </button>
      </div>

      <div className="mx-4 mt-1 flex items-center gap-2 rounded-2xl p-3" style={{ background: 'rgba(79,110,247,0.08)', border: '1px solid rgba(79,110,247,0.2)' }}>
        <Lock size={14} style={{ color: 'var(--accent)' }}/>
        <p className="text-[11px] leading-tight" style={{ color: 'var(--t3)' }}>Хранилище для семейных заметок и документов внутри Sky. Не используйте его для чувствительных паролей — это не сертифицированное шифрованное хранилище.</p>
      </div>

      <div className="flex-1 px-4 py-3 space-y-2.5">
        {items.length === 0 && (
          <div className="sky-empty py-10"><div className="sky-empty-icon"><Lock size={26}/></div><p style={{ color: 'var(--t2)' }}>Сейф пуст</p></div>
        )}
        {items.map(item => {
          const Icon = KIND_ICON[item.kind];
          const isRevealed = reveal === item.id;
          return (
            <div key={item.id} className="rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: 'var(--bg-l2)' }}><Icon size={16} style={{ color: 'var(--t2)' }}/></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>{item.title}</p>
                  <p className="flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--t3)' }}>
                    {KIND_LABEL[item.kind]} · {item.visibility === 'everyone' ? <Users size={9}/> : <User size={9}/>} {VIS_LABEL[item.visibility]}
                  </p>
                </div>
                <button type="button" onClick={() => removeSafeItem(item.id)}><X size={14} style={{ color: 'var(--t3)' }}/></button>
              </div>
              <button type="button" onClick={() => setReveal(v => v === item.id ? null : item.id)}
                className="mt-2.5 w-full rounded-xl py-2 text-left text-[12px]" style={{ background: 'var(--bg-l2)', color: isRevealed ? 'var(--t1)' : 'var(--t3)', padding: '8px 12px' }}>
                {isRevealed ? item.content : '•••••• (нажмите, чтобы показать)'}
              </button>
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setAdding(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl p-5" style={{ background: 'var(--bg-l1)' }}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Добавить в сейф</p>
                <button type="button" onClick={() => setAdding(false)}><X size={16} style={{ color: 'var(--t3)' }}/></button>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {(Object.keys(KIND_LABEL) as SafeItemKind[]).map(k => (
                  <button key={k} type="button" onClick={() => setKind(k)}
                    className="rounded-xl px-3 py-1.5 text-[12px] font-semibold" style={{ background: kind === k ? 'var(--accent)' : 'var(--bg-l2)', color: kind === k ? '#fff' : 'var(--t2)' }}>
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название" maxLength={40}
                className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <textarea value={content} onChange={e => setContent(e.target.value)} rows={3} placeholder="Содержимое"
                className="mt-2.5 w-full resize-none rounded-2xl px-4 py-3 text-[13px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <p className="mb-1.5 mt-3 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Кто может видеть</p>
              <div className="flex gap-2">
                {(Object.keys(VIS_LABEL) as SafeVisibility[]).map(v => (
                  <button key={v} type="button" onClick={() => setVisibility(v)}
                    className="flex-1 rounded-xl py-2 text-[12px] font-semibold" style={{ background: visibility === v ? 'var(--accent)' : 'var(--bg-l2)', color: visibility === v ? '#fff' : 'var(--t2)' }}>
                    {VIS_LABEL[v]}
                  </button>
                ))}
              </div>
              <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={submit} className="sky-btn-primary mt-4 w-full justify-center py-3.5">Сохранить</motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
