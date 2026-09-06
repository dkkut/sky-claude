import { useState, useRef, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart, MessageCircle, Repeat2, Bookmark, MoreHorizontal,
  Send, Eye, X, MapPin, Pin, User, Share2, ThumbsUp, Gift,
} from 'lucide-react';
import type { BloomPost } from '../store';
import { useBloomStore, fmtAgo, fmtViews, badgeFor } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { Av, Tagged, ReactionPicker } from './Primitives';
import { CommentRow } from './CommentRow';
import { GiftPicker } from './GiftPicker';
import { ListSheet } from '@/profile/viewer/ListSheet';

export const PostCard = memo(({ post, onAuthorClick, onTagClick }: {
  post: BloomPost;
  onAuthorClick: (id: string) => void;
  onTagClick: (tag: string) => void;
}) => {
  const { react, addComment, toggleSave, repost, deletePost, incView, likeComment, votePoll, sendGift } = useBloomStore();
  const { currentUserId, accounts } = useAuthStore();
  const myName = accounts.find(a => a.id === (currentUserId ?? ''))?.name ?? 'Вы';
  const uid = currentUserId ?? '';

  const [expanded,     setExpanded]     = useState(false);
  const [showPicker,   setShowPicker]   = useState(false);
  const [showReactors, setShowReactors] = useState(false);
  const [showMenu,     setShowMenu]     = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentText,  setCommentText]  = useState('');
  const [imgExpanded,  setImgExpanded]  = useState(false);
  const [likeAnim,     setLikeAnim]     = useState(false);
  const [showGiftPicker, setShowGiftPicker] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const viewed = useRef(false);
  useEffect(() => {
    const el = cardRef.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !viewed.current) { viewed.current = true; incView(post.id); }
    }, { threshold: 0.5 });
    obs.observe(el); return () => obs.disconnect();
  }, [post.id]);

  const isSaved     = post.saved.includes(uid);
  const isOwn       = post.authorId === uid;
  const totalReacts = post.reactions.reduce((a, r) => a + r.userIds.length, 0);
  const myReaction  = post.reactions.find(r => r.userIds.includes(uid));
  const topReacts   = [...post.reactions].sort((a, b) => b.userIds.length - a.userIds.length).slice(0, 3).filter(r => r.userIds.length > 0);

  const TEXT_LIMIT = 180;
  const longText   = post.text.length > TEXT_LIMIT;

  const submitComment = () => {
    if (!commentText.trim()) return;
    addComment(post.id, commentText.trim());
    setCommentText('');
  };

  const onReact = (emoji: Parameters<typeof react>[1]) => {
    setLikeAnim(true); setTimeout(() => setLikeAnim(false), 400);
    react(post.id, emoji);
  };

  const heat = badgeFor(post.views);
  const myVoteIdx = post.poll?.options.findIndex(o => o.votes.includes(uid));
  const hasVoted = myVoteIdx !== undefined && myVoteIdx >= 0;
  const pollTotal = post.poll?.options.reduce((a,o) => a + o.votes.length, 0) ?? 0;

  return (
    <motion.div ref={cardRef} layout
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl sky-transition relative"
      style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>

      {/* Индикатор популярности */}
      {heat && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-full px-2 py-0.5"
          style={{
            background: heat === 'hot' ? 'rgba(244,33,46,0.12)' : 'rgba(255,122,0,0.10)',
            border: `1px solid ${heat === 'hot' ? 'var(--red)' : 'var(--orange, #ff7a00)'}40`,
          }}>
          <span className="text-[11px]">{heat === 'hot' ? '🔥' : '⚡'}</span>
          <span className="text-[11px] font-bold" style={{ color: heat === 'hot' ? 'var(--red)' : '#ff7a00' }}>
            {heat === 'hot' ? 'Горячее' : 'Растёт'}
          </span>
        </div>
      )}

      {/* Шапка */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={() => onAuthorClick(post.authorId)}>
          <Av name={post.authorName} size={10}/>
        </button>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onAuthorClick(post.authorId)}>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{post.authorName}</p>
            {post.isPinned && (
              <span className="text-[9px] rounded-full px-1.5 py-0.5 font-bold shrink-0"
                style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}><Pin size={10} /></span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[10px]" style={{ color: 'var(--t3)' }}>@{post.authorUsername}</p>
            <span style={{ color: 'var(--t3)' }}>·</span>
            <p className="text-[10px]" style={{ color: 'var(--t3)' }}>{fmtAgo(post.createdAt)}</p>
            {post.location && (
              <>
                <span style={{ color: 'var(--t3)' }}>·</span>
                <p className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--t3)' }}>
                  <MapPin size={9}/>{post.location}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="relative">
          <button type="button" onClick={() => setShowMenu(v => !v)}
            className="grid h-7 w-7 place-items-center rounded-lg hover:bg-white/5"
            style={{ color: 'var(--t3)' }}><MoreHorizontal size={15}/></button>
          <AnimatePresence>
            {showMenu && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="absolute right-0 z-30 overflow-hidden rounded-2xl shadow-2xl"
                style={{ top: '100%', background: 'var(--bg-l1)', border: '1px solid var(--border-m)', minWidth: 160 }}>
                <button type="button" onClick={() => { toggleSave(post.id); setShowMenu(false); }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-white/5"
                  style={{ color: isSaved ? 'var(--accent)' : 'var(--t1)' }}>
                  <Bookmark size={13} className={isSaved ? 'fill-current' : ''}/>{isSaved ? 'Убрать' : 'Сохранить'}
                </button>
                <button type="button" onClick={() => { repost(post.id); setShowMenu(false); }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-white/5 text-white">
                  <Repeat2 size={13}/>Репост
                </button>
                <button type="button" onClick={() => onAuthorClick(post.authorId)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-white/5 text-white">
                  <User size={13}/>Профиль
                </button>
                {isOwn && (
                  <button type="button" onClick={() => { deletePost(post.id); setShowMenu(false); }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-white/5"
                    style={{ color: 'var(--red)' }}>
                    <X size={13}/>Удалить
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Текст */}
      {post.text && (
        <div className="px-4 pb-2">
          <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--t1)' }}>
            <Tagged text={expanded || !longText ? post.text : post.text.slice(0, TEXT_LIMIT) + '...'} onTag={onTagClick}/>
          </p>
          {longText && (
            <button type="button" onClick={() => setExpanded(v => !v)}
              className="mt-1 text-xs font-semibold" style={{ color: 'var(--accent)' }}>
              {expanded ? 'Свернуть' : 'Читать далее'}
            </button>
          )}
        </div>
      )}

      {/* Медиа */}
      {post.mediaUrl && (
        <div className="relative overflow-hidden cursor-zoom-in"
          style={{ maxHeight: imgExpanded ? 'none' : 400 }}
          onClick={() => setImgExpanded(v => !v)}>
          {post.kind === 'video'
            ? <video src={post.mediaUrl} controls className="w-full" style={{ maxHeight: 400 }} onClick={e => e.stopPropagation()}/>
            : <img src={post.mediaUrl} alt="" className="w-full object-cover"/>}
          {!imgExpanded && post.mediaAspect && post.mediaAspect > 1.8 && (
            <div className="absolute bottom-0 inset-x-0 h-12 flex items-end pb-2 justify-center"
              style={{ background: 'linear-gradient(transparent,rgba(0,0,0,0.5))' }}>
              <span className="text-xs text-white/60">Нажмите для раскрытия</span>
            </div>
          )}
        </div>
      )}

      {/* Опрос */}
      {post.poll && (
        <div className="px-4 pb-2 space-y-1.5">
          {post.poll.options.map((opt, i) => {
            const pct = pollTotal > 0 ? Math.round((opt.votes.length / pollTotal) * 100) : 0;
            const voted = myVoteIdx === i;
            return (
              <button key={i} type="button" disabled={hasVoted}
                onClick={() => votePoll(post.id, i)}
                className="relative block w-full overflow-hidden rounded-full text-left"
                style={{ border: `1.5px solid ${voted ? 'var(--accent)' : 'var(--border)'}`, cursor: hasVoted ? 'default' : 'pointer' }}>
                {hasVoted && (
                  <div className="absolute inset-y-0 left-0 sky-transition" style={{ width: `${pct}%`, background: voted ? 'var(--accent-bg)' : 'var(--bg-l2)' }}/>
                )}
                <div className="relative flex items-center justify-between px-3.5 py-2">
                  <span className="text-sm" style={{ color: voted ? 'var(--accent)' : 'var(--t1)', fontWeight: voted ? 700 : 400 }}>{opt.label}</span>
                  {hasVoted && <span className="text-xs" style={{ color: 'var(--t3)' }}>{pct}%</span>}
                </div>
              </button>
            );
          })}
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{pollTotal} голосов</p>
        </div>
      )}

      {/* Счётчики реакций + views */}
      {(topReacts.length > 0 || post.views > 0) && (
        <div className="flex items-center gap-2 px-4 pt-2">
          {topReacts.length > 0 && (
            <button type="button" onClick={() => setShowReactors(true)}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 sky-hover-lift"
              style={{ background: 'var(--bg-l2)' }}>
              <span className="text-[13px]">{topReacts.map(r => r.emoji).join('')}</span>
              {totalReacts > 0 && <span className="text-[11px]" style={{ color: 'var(--t2)' }}>{totalReacts}</span>}
            </button>
          )}
          {post.comments.length > 0 && (
            <button type="button" onClick={() => setShowComments(v => !v)}
              className="text-[11px] transition-colors hover:text-white"
              style={{ color: 'var(--t3)' }}>
              {post.comments.length} коммент.
            </button>
          )}
          <div className="ml-auto flex items-center gap-1" style={{ color: 'var(--t3)' }}>
            <Eye size={10}/><span className="text-[10px]">{fmtViews(post.views)}</span>
          </div>
        </div>
      )}

      {/* Кнопки */}
      <div className="flex items-center px-3 pb-3 pt-1 gap-0">
        <div className="relative">
          <motion.button type="button" whileTap={{ scale: 0.88 }}
            onClick={() => setShowPicker(v => !v)}
            className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-all"
            style={{ color: myReaction ? 'var(--red)' : 'var(--t3)' }}>
            {myReaction
              ? <motion.span className="text-[15px]" animate={{ scale: likeAnim ? [1,1.5,1] : 1 }} transition={{ duration:0.4 }}>{myReaction.emoji}</motion.span>
              : <motion.span animate={{ scale: likeAnim ? [1,1.5,1] : 1 }} transition={{ duration:0.4 }}><Heart size={16} strokeWidth={1.8} /></motion.span>}
            {totalReacts > 0 && <span className="text-[11px]">{totalReacts}</span>}
          </motion.button>
          <AnimatePresence>
            {showPicker && <ReactionPicker onPick={onReact} onClose={() => setShowPicker(false)}/>}
          </AnimatePresence>
        </div>

        <motion.button type="button" whileTap={{ scale: 0.88 }}
          onClick={() => setShowComments(v => !v)}
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors"
          style={{ color: showComments ? 'var(--accent)' : 'var(--t3)' }}>
          <MessageCircle size={16} strokeWidth={1.8}/>
          {post.comments.length > 0 && <span className="text-[11px]">{post.comments.length}</span>}
        </motion.button>

        <motion.button type="button" whileTap={{ scale: 0.88 }}
          onClick={() => repost(post.id)}
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors hover:text-white"
          style={{ color: 'var(--t3)' }}>
          <Repeat2 size={16} strokeWidth={1.8}/>
          {post.reposts > 0 && <span className="text-[11px]">{post.reposts}</span>}
        </motion.button>

        <motion.button type="button" whileTap={{ scale: 0.88 }}
          onClick={() => toggleSave(post.id)}
          className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors"
          style={{ color: isSaved ? 'var(--accent)' : 'var(--t3)' }}>
          <Bookmark size={16} strokeWidth={1.8} className={isSaved ? 'fill-current' : ''}/>
        </motion.button>
      </div>

      {/* Комментарии */}
      <AnimatePresence>
        {showComments && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            <div className="px-4 py-3 space-y-3">
              {post.comments.map(c => (
                <CommentRow key={c.id} comment={c} postId={post.id} onLike={() => likeComment(post.id, c.id)} onAuthorClick={onAuthorClick}/>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <Av name={myName} size={7}/>
                <div className="flex flex-1 items-center gap-2 rounded-2xl px-3 py-2"
                  style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                  <input value={commentText} onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitComment()}
                    placeholder="Комментарий..." className="flex-1 bg-transparent text-xs outline-none"
                    style={{ color: 'var(--t1)' }}/>
                  <div className="relative">
                    <motion.button type="button" whileTap={{ scale: 0.9 }}
                      onClick={() => setShowGiftPicker(v => !v)}
                      className="grid h-6 w-6 place-items-center rounded-full"
                      style={{ background: showGiftPicker ? 'rgba(255,196,0,0.18)' : 'transparent' }}>
                      <Gift size={13} style={{ color: '#ffc400' }}/>
                    </motion.button>
                    {showGiftPicker && (
                      <GiftPicker
                        onClose={() => setShowGiftPicker(false)}
                        onPick={modelKey => { sendGift(post.authorId, post.id, modelKey); setShowGiftPicker(false); }}/>
                    )}
                  </div>
                  <motion.button type="button" whileTap={{ scale: 0.9 }}
                    onClick={submitComment} disabled={!commentText.trim()}
                    className="grid h-6 w-6 place-items-center rounded-full disabled:opacity-30"
                    style={{ background: 'var(--accent)' }}>
                    <Send size={11} className="text-white"/>
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showReactors && (
        <ListSheet
          title="Отреагировали"
          entries={(() => {
            const emojiByUser: Record<string, string[]> = {};
            post.reactions.forEach(r => r.userIds.forEach(uid => {
              (emojiByUser[uid] ??= []).push(r.emoji);
            }));
            return accounts
              .filter(a => emojiByUser[a.id])
              .map(a => ({ id: a.id, name: a.name, username: a.username, avatar: a.avatar, sub: emojiByUser[a.id].join(' ') }));
          })()}
          onClose={() => setShowReactors(false)}
        />
      )}
    </motion.div>
  );
});
