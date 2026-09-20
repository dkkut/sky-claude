import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Bell } from 'lucide-react';
import { useBloomStore, fmtAgo } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { Av } from './Primitives';

type NotifRow =
  | { kind: 'comment'; postId: string; authorName: string; text: string; at: string }
  | { kind: 'reaction'; postId: string; authorName: string; emoji: string; at: string };

export const NotificationsView = ({ onClose, onOpenPost }: { onClose: () => void; onOpenPost: (id: string) => void }) => {
  const mine = useBloomStore(s => s.feedCache.mine) ?? [];
  const loadFeed = useBloomStore(s => s.loadFeed);
  const { currentUserId } = useAuthStore();
  const uid = currentUserId ?? '';

  useEffect(() => { void loadFeed('mine'); }, [loadFeed]);

  const rows: NotifRow[] = [];

  mine.forEach(p => {
    p.comments.filter(c => c.authorId !== uid).forEach(c => {
      rows.push({ kind: 'comment', postId: p.id, authorName: c.authorName, text: c.text, at: c.createdAt });
    });
    p.reactions.forEach(r => {
      r.userIds.filter(id => id !== uid).forEach(userId => {
        const name = mine.flatMap(pp => pp.comments).find(c => c.authorId === userId)?.authorName
          ?? (userId === p.authorId ? p.authorName : 'Подписчик');
        rows.push({ kind: 'reaction', postId: p.id, authorName: name, emoji: r.emoji, at: p.createdAt });
      });
    });
  });

  rows.sort((a, b) => +new Date(b.at) - +new Date(a.at));

  return (
    <motion.div
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="absolute inset-0 z-30 flex flex-col"
      style={{ background: 'var(--bg-l0, var(--bg))' }}>

      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3.5"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-l1)' }}>
        <button type="button" onClick={onClose} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <ArrowLeft size={16} style={{ color: 'var(--t1)' }}/>
        </button>
        <h2 className="text-[14px] font-bold" style={{ color: 'var(--t1)' }}>Уведомления</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {rows.length === 0 && (
          <div className="sky-empty">
            <div className="sky-empty-icon"><Bell size={28}/></div>
            <p style={{ color: 'var(--t2)' }}>Пока нет уведомлений</p>
          </div>
        )}
        {rows.map((r, i) => (
          <button key={i} type="button" onClick={() => onOpenPost(r.postId)}
            className="flex w-full items-start gap-3 rounded-2xl p-3 text-left"
            style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <Av name={r.authorName} size={9}/>
            <div className="min-w-0 flex-1">
              <p className="text-[13px]" style={{ color: 'var(--t1)' }}>
                <span className="font-semibold">{r.authorName}</span>{' '}
                {r.kind === 'comment'
                  ? <>прокомментировал(а) ваш пост: <span style={{ color: 'var(--t3)' }}>«{r.text}»</span></>
                  : <>отреагировал(а) {r.emoji} на ваш пост</>}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--t3)' }}>{fmtAgo(r.at)}</p>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  );
};
