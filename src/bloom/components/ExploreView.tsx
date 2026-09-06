import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Hash, X, ChevronLeft } from 'lucide-react';
import { useBloomStore } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { Av } from './Primitives';
import { PostCard } from './PostCard';

export const ExploreView = ({ onAuthorClick, onTagClick }: {
  onAuthorClick: (id: string) => void; onTagClick: (t: string) => void;
}) => {
  const { posts, trending, suggestedUsers } = useBloomStore();
  const { accounts } = useAuthStore();
  const [search, setSearch] = useState('');
  const tags = trending();
  const sugg = suggestedUsers();

  const results = search
    ? posts.filter(p =>
        p.text.toLowerCase().includes(search.toLowerCase()) ||
        p.tags.some(t => t.toLowerCase().includes(search.toLowerCase())) ||
        p.authorName.toLowerCase().includes(search.toLowerCase()))
    : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 pt-2 pb-3 shrink-0">
        <div className="flex items-center gap-2 rounded-2xl px-3.5 py-2.5"
          style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <Search size={14} style={{ color: 'var(--t3)' }}/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск постов, тегов, людей..."
            className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--t1)' }}/>
          {search && <button type="button" onClick={() => setSearch('')}><X size={13} style={{ color: 'var(--t3)' }}/></button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-5">
        {results ? (
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>
              Результаты  -  {results.length}
            </p>
            {results.map(p => <PostCard key={p.id} post={p} onAuthorClick={onAuthorClick} onTagClick={onTagClick}/>)}
            {results.length === 0 && <p className="py-8 text-center text-sm" style={{ color: 'var(--t3)' }}>Ничего не найдено</p>}
          </div>
        ) : (
          <>
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--t3)' }}>
                Трендовые теги
              </p>
              <div className="flex flex-wrap gap-2">
                {tags.map(([tag, cnt]) => (
                  <motion.button key={tag} type="button" whileTap={{ scale: 0.95 }}
                    onClick={() => setSearch(tag)}
                    className="flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-xs font-semibold"
                    style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid rgba(79,110,247,0.25)' }}>
                    <Hash size={11}/>#{tag}
                    <span className="text-[10px] ml-0.5" style={{ color: 'var(--t3)' }}>·{cnt}</span>
                  </motion.button>
                ))}
              </div>
            </section>

            {sugg.length > 0 && (
              <section>
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--t3)' }}>
                  Авторы
                </p>
                <div className="space-y-2">
                  {sugg.map(uid => {
                    const acc = accounts.find(a => a.id === uid);
                    if (!acc) return null;
                    const cnt = posts.filter(p => p.authorId === uid).length;
                    return (
                      <motion.div key={uid} whileTap={{ scale: 0.98 }}
                        className="flex items-center gap-3 rounded-2xl p-3 cursor-pointer"
                        style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}
                        onClick={() => onAuthorClick(uid)}>
                        <Av name={acc.name} size={10}/>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--t1)' }}>{acc.name}</p>
                          <p className="text-[10px]" style={{ color: 'var(--t3)' }}>@{acc.username} · {cnt} постов</p>
                        </div>
                        <ChevronLeft size={14} style={{ color: 'var(--t3)', transform: 'rotate(180deg)' }}/>
                      </motion.div>
                    );
                  })}
                </div>
              </section>
            )}

            <section>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--t3)' }}>
                Популярные
              </p>
              <div className="space-y-3">
                {[...posts].sort((a, b) =>
                  (b.reactions.reduce((s, r) => s + r.userIds.length, 0) + b.comments.length * 2 + b.reposts) -
                  (a.reactions.reduce((s, r) => s + r.userIds.length, 0) + a.comments.length * 2 + a.reposts)
                ).slice(0, 5).map(p => (
                  <PostCard key={p.id} post={p} onAuthorClick={onAuthorClick} onTagClick={t => setSearch(t)}/>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};
