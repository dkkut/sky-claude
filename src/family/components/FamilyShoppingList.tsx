import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, X, Check, ShoppingCart, Trash2 } from 'lucide-react';
import { useFamilyStore } from '../store';

export const FamilyShoppingList = ({ onBack }: { onBack: () => void }) => {
  const { family, addShoppingItem, toggleBought, removeShoppingItem, clearBought } = useFamilyStore();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [store, setStore] = useState('');
  const [assignedTo, setAssignedTo] = useState<string>('');

  if (!family) return null;
  const todo = family.shoppingList.filter(i => !i.bought);
  const done = family.shoppingList.filter(i => i.bought);

  const submit = () => {
    if (!title.trim()) return;
    addShoppingItem(title.trim(), price ? Number(price) : undefined, store.trim() || undefined, assignedTo || undefined);
    setAdding(false); setTitle(''); setPrice(''); setStore(''); setAssignedTo('');
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
          <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Список покупок</h2>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: 'var(--accent)' }}>
          <Plus size={13} className="inline"/> Товар
        </button>
      </div>

      <div className="flex-1 px-4 py-3 space-y-2">
        {family.shoppingList.length === 0 && (
          <div className="sky-empty py-10">
            <div className="sky-empty-icon"><ShoppingCart size={26}/></div>
            <p style={{ color: 'var(--t2)' }}>Список покупок пуст</p>
            <button type="button" onClick={() => setAdding(true)} className="sky-btn-primary mt-2 px-5 py-2.5">Добавить товар</button>
          </div>
        )}

        {todo.map(item => {
          const member = family.members.find(m => m.id === item.assignedTo);
          return (
            <motion.div key={item.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <button type="button" onClick={() => toggleBought(item.id)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ border: '2px solid var(--border)' }}/>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold" style={{ color: 'var(--t1)' }}>{item.title}</p>
                <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>
                  {[item.store, item.price ? `${item.price.toLocaleString('ru')} ₽` : null, member ? `→ ${member.name}` : null].filter(Boolean).join(' · ') || 'Без деталей'}
                </p>
              </div>
              <button type="button" onClick={() => removeShoppingItem(item.id)}><X size={14} style={{ color: 'var(--t3)' }}/></button>
            </motion.div>
          );
        })}

        {done.length > 0 && (
          <div className="pt-2">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Куплено</p>
              <button type="button" onClick={clearBought} className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--t3)' }}>
                <Trash2 size={11}/>Очистить
              </button>
            </div>
            {done.map(item => (
              <div key={item.id} className="mb-2 flex items-center gap-3 rounded-2xl p-3.5 opacity-50" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                <button type="button" onClick={() => toggleBought(item.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white" style={{ background: 'var(--green)' }}>
                  <Check size={14}/>
                </button>
                <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold line-through" style={{ color: 'var(--t2)' }}>{item.title}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setAdding(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl p-5" style={{ background: 'var(--bg-l1)' }}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Новый товар</p>
                <button type="button" onClick={() => setAdding(false)}><X size={16} style={{ color: 'var(--t3)' }}/></button>
              </div>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Что купить?" maxLength={40}
                className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <div className="mt-2.5 flex gap-2.5">
                <input value={price} onChange={e => setPrice(e.target.value.replace(/\D/g,''))} placeholder="Цена, ₽" inputMode="numeric"
                  className="w-1/2 rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
                <input value={store} onChange={e => setStore(e.target.value)} placeholder="Магазин" maxLength={20}
                  className="w-1/2 rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              </div>
              <p className="mb-1.5 mt-3 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Назначить исполнителя</p>
              <div className="flex flex-wrap gap-2">
                {family.members.map(m => (
                  <button key={m.id} type="button" onClick={() => setAssignedTo(v => v === m.id ? '' : m.id)}
                    className="rounded-xl px-3 py-1.5 text-[12px] font-semibold" style={{ background: assignedTo === m.id ? 'var(--accent)' : 'var(--bg-l2)', color: assignedTo === m.id ? '#fff' : 'var(--t2)' }}>
                    {m.name}
                  </button>
                ))}
              </div>
              <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={submit} className="sky-btn-primary mt-4 w-full justify-center py-3.5">Добавить</motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
