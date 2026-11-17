import { Heart } from 'lucide-react';
import { VerifiedBadge } from '@/verification/marks';
import type { BloomComment } from '../store';
import { fmtAgo, useBloomStore } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { Av } from './Primitives';
import { GiftBadge } from '@/gifts/models';

export const CommentRow = ({ comment, postId, onLike, onAuthorClick }: {
  comment: BloomComment; postId: string; onLike: () => void; onAuthorClick?: (id: string) => void;
}) => {
  const uid   = useAuthStore(s => s.currentUserId) ?? '';
  const liked = comment.likes.includes(uid);
  const goToAuthor = () => onAuthorClick?.(comment.authorId);

  if (comment.gift) {
    return (
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={goToAuthor}><Av name={comment.authorName} size={7}/></button>
        <div className="flex flex-1 items-center gap-2.5 rounded-2xl px-3 py-2"
          style={{ background: 'linear-gradient(90deg, rgba(255,196,0,0.08), rgba(255,196,0,0.02))', border: '1px solid rgba(255,196,0,0.18)' }}>
          <GiftBadge modelKey={comment.gift.modelKey} rarity={comment.gift.rarity} size={34}/>
          <div className="min-w-0 flex-1">
            <p className="text-xs" style={{ color: 'var(--t1)' }}>
              <button type="button" onClick={goToAuthor} className="font-bold" style={{ color: 'var(--accent)' }}>{comment.authorName}<VerifiedBadge type="user" id={comment.authorId} size={12} /></button>{' '}
              {comment.text}
            </p>
            <span className="text-[10px]" style={{ color: 'var(--t3)' }}>{fmtAgo(comment.createdAt)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <button type="button" onClick={goToAuthor} className="shrink-0"><Av name={comment.authorName} size={7}/></button>
      <div className="flex-1 min-w-0">
        <div className="rounded-2xl px-3 py-2" style={{ background: 'var(--bg-l2)' }}>
          <button type="button" onClick={goToAuthor} className="text-[11px] font-bold mb-0.5 block" style={{ color: 'var(--accent)' }}>
            {comment.authorName}
          </button>
          <p translate="no" className="text-xs leading-relaxed" style={{ color: 'var(--t1)' }}>{comment.text}</p>
        </div>
        <div className="flex items-center gap-3 mt-1 px-1">
          <span className="text-[10px]" style={{ color: 'var(--t3)' }}>{fmtAgo(comment.createdAt)}</span>
          <button type="button" onClick={onLike}
            className="flex items-center gap-1 text-[10px] font-semibold"
            style={{ color: liked ? 'var(--red)' : 'var(--t3)' }}>
            <Heart size={10} className={liked ? 'fill-current' : ''}/>{comment.likes.length > 0 && comment.likes.length}
          </button>
        </div>
      </div>
    </div>
  );
};
