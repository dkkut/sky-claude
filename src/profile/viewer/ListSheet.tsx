import { motion, AnimatePresence } from 'framer-motion';
import { X, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuthStore } from '@/core/auth/store';
import type { PersonEntry } from './types';
import { openProfile } from './store';
import { activeFrame } from './cosmetics';
import { useGamingAccounts } from '@/gaming/accounts';

const Av = ({ p, size = 44 }: { p: PersonEntry; size?: number }) => {
  const acc = useAuthStore.getState().accounts.find(a => a.id === p.id);
  const frame = activeFrame(acc);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {frame.ring !== 'transparent' && (
        <div className="absolute rounded-full" style={{ inset: -2, background: frame.ring, boxShadow: frame.glow }} />
      )}
      {p.avatar
        ? <img src={p.avatar} alt="" className="absolute inset-0 rounded-full object-cover w-full h-full" />
        : (
          <div className="absolute inset-0 rounded-full flex items-center justify-center font-bold text-white"
            style={{ fontSize: size * 0.4, background: `linear-gradient(135deg,#6e8eff,#a78bfa)` }}>
            {p.name?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
    </div>
  );
};

export const ListSheet = ({ title, entries, onClose, emptyLabel }: {
  title: string;
  entries: PersonEntry[];
  onClose: () => void;
  emptyLabel?: string;
}) => {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return entries;
    return entries.filter(e => e.name.toLowerCase().includes(s) || e.username.toLowerCase().includes(s));
  }, [entries, q]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10020] flex items-end sm:items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          onClick={e => e.stopPropagation()}
          className="sky-glass w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl flex flex-col overflow-hidden"
          style={{ maxHeight: '75vh', background: 'var(--bg-l1)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 className="font-bold text-base" style={{ color: 'var(--t1)' }}>{title} · {entries.length}</h3>
            <button type="button" onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center sky-hover-lift"
              style={{ background: 'var(--bg-l2)' }}>
              <X size={16} style={{ color: 'var(--t2)' }} />
            </button>
          </div>

          {entries.length > 6 && (
            <div className="px-5 pt-3 shrink-0">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--bg-l2)' }}>
                <Search size={14} style={{ color: 'var(--t3)' }} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск..."
                  className="bg-transparent outline-none text-sm flex-1" style={{ color: 'var(--t1)' }} />
              </div>
            </div>
          )}

          <div className="overflow-y-auto px-3 py-2 flex-1">
            {filtered.length === 0 && (
              <div className="sky-empty py-10 text-center text-sm" style={{ color: 'var(--t3)' }}>
                {emptyLabel ?? 'Пока никого нет'}
              </div>
            )}
            {filtered.map(p => (
              <button key={p.id} type="button"
                onClick={() => { onClose(); openProfile(p.id); }}
                className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl sky-hover-lift text-left">
                <Av p={p} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate" style={{ color: 'var(--t1)' }}>{p.name}</div>
                  <PlayingOrSub p={p} />
                </div>
              </button>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

/** Показывает «Играет в X», если человек сейчас в игре, иначе — обычную подпись. */
const PlayingOrSub = ({ p }: { p: PersonEntry }) => {
  const activity = useGamingAccounts(s => s.activity[p.id]);
  if (activity?.isPlaying) {
    return (
      <div className="text-xs truncate font-medium" style={{ color: '#22c55e' }}>
        Играет в {activity.gameIcon} {activity.gameName}
      </div>
    );
  }
  return <div className="text-xs truncate" style={{ color: 'var(--t3)' }}>{p.sub ?? `@${p.username}`}</div>;
};

/** Собирает PersonEntry[] из массива userId, подставляя реальные аккаунты. */
export function entriesFromIds(ids: string[], sub?: (id: string) => string | undefined): PersonEntry[] {
  const accounts = useAuthStore.getState().accounts;
  return ids
    .map(id => accounts.find(a => a.id === id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map(a => ({ id: a.id, name: a.name, username: a.username, avatar: a.avatar, sub: sub?.(a.id) }));
}
