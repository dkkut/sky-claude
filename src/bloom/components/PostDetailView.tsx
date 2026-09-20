import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Flower2 } from 'lucide-react';
import { useBloomStore, useBloomPost } from '../store';
import { PostCard } from './PostCard';

export const PostDetailView = ({ postId, onClose, onAuthorClick, onTagClick }: {
  postId: string; onClose: () => void;
  onAuthorClick: (id: string) => void; onTagClick: (t: string) => void;
}) => {
  const loadPost = useBloomStore(s => s.loadPost);
  useEffect(() => { void loadPost(postId); }, [postId, loadPost]);
  const post = useBloomPost(postId);

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
        <h2 className="text-[14px] font-bold" style={{ color: 'var(--t1)' }}>Пост</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {post ? (
          <PostCard post={post} onAuthorClick={onAuthorClick} onTagClick={onTagClick}/>
        ) : (
          <div className="sky-empty">
            <div className="sky-empty-icon"><Flower2 size={30}/></div>
            <p style={{ color: 'var(--t2)' }}>Пост не найден или был удалён</p>
          </div>
        )}
      </div>
    </motion.div>
  );
};
