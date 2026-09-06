/* ===============================================================
   SKY VIDEO  -  YouTube-style video hosting + Shorts
   Dark Sky aesthetic, Nunito/system font, accent #4f6ef7
=============================================================== */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { MobileVideoGestures } from '@/interface/mobile/MobileVideoGestures';
import { useModerationStore } from '@/shared/moderationStore';
import { ContentWarningGate, BlockedChannelBadge } from '@/shared/ContentWarningGate';
import {
  Play, Pause, Volume2, VolumeX, Maximize2, ThumbsUp, ThumbsDown,
  MessageCircle, Share2, Upload, Search, X, ChevronLeft, MoreVertical,
  Trash2, Eye, Clock, Plus, Check, ArrowUp, ArrowDown, Heart, Pin,
} from 'lucide-react';
import { AiVideoSummarize, AiVideoQA } from '@/ai/SkyAI';
import { AdBanner } from '@/feedback/Feedback';
import { useVideoStore, fmtViews, fmtAgo, getVideoGrad, CATEGORY_LABEL, type VideoEntry, type VideoComment } from '@/video/store';
import { useAuthStore } from '@/core/auth/store';
import { openProfile } from '@/profile/viewer/store';
import { useSocialGraph } from '@/profile/viewer/social';

/* -- Design tokens ------------------------------------------- */
const V = {
  bg:      'var(--bg)',
  bg1:     'var(--bg-l1)',
  bg2:     'var(--bg-l2)',
  bg3:     'var(--bg-l3)',
  border:  'var(--border)',
  border2: 'var(--border-m)',
  accent:  'var(--accent)',
  t1:      'var(--t1)',
  t2:      'var(--t2)',
  t3:      'var(--t3)',
  green:   'var(--green)',
  red:     'var(--red)',
};

/* -- Thumbnail ----------------------------------------------- */
const Thumbnail = ({ video, size = 'md' }: { video: VideoEntry; size?: 'sm'|'md'|'lg' }) => {
  const [g1, g2] = video.thumbnailGrad ?? getVideoGrad(video.id);
  const h = size === 'sm' ? 70 : size === 'lg' ? 180 : 110;
  return (
    <div className="relative overflow-hidden rounded-xl shrink-0" style={{ width:'100%', height: h, background:`linear-gradient(160deg,${g1},${g2})` }}>
      {video.thumbnailUrl && <img src={video.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover"/>}
      {/* Duration badge */}
      <div className="absolute bottom-1.5 right-1.5 rounded-md px-1.5 py-0.5"
        style={{ background:'rgba(0,0,0,0.78)', backdropFilter:'blur(4px)' }}>
        <span style={{ fontSize:11, fontWeight:700, color:'#fff', fontFamily:'DM Mono,monospace' }}>{video.duration}</span>
      </div>
      {/* Short badge */}
      {video.isShort && (
        <div className="absolute top-1.5 left-1.5 rounded-full px-1.5 py-0.5"
          style={{ background:`${V.accent}cc`, fontSize:9, fontWeight:700, color:'#fff' }}>
          SHORT
        </div>
      )}
      {/* Play overlay on hover */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
        style={{ background:'rgba(0,0,0,0.35)' }}>
        <div className="grid h-10 w-10 place-items-center rounded-full" style={{ background:'rgba(0,0,0,0.6)' }}>
          <Play size={18} className="text-white ml-0.5"/>
        </div>
      </div>
    </div>
  );
};

/* -- Avatar --------------------------------------------------- */
const Avatar = ({ name, size=32 }: { name:string; size?:number }) => {
  const hue = [...name].reduce((a,c) => a+c.charCodeAt(0), 0) % 360;
  return (
    <div className="shrink-0 grid place-items-center rounded-full font-bold text-white"
      style={{ width:size, height:size, fontSize:size*0.38,
        background:`linear-gradient(135deg,hsl(${hue},65%,42%),hsl(${(hue+40)%360},70%,36%))` }}>
      {name[0]?.toUpperCase()}
    </div>
  );
};

/* -- Subscribe button (реальная подписка на автора канала) ----- */
const SubscribeButton = ({ targetId }: { targetId: string }) => {
  const currentUserId = useAuthStore(s => s.currentUserId);
  const isFollowing = useSocialGraph(s => currentUserId ? s.follows.some(e => e.followerId === currentUserId && e.followingId === targetId) : false);
  const toggleFollow = useSocialGraph(s => s.toggleFollow);
  if (!currentUserId || currentUserId === targetId) return null;
  return (
    <motion.button whileTap={{ scale:0.95 }} type="button"
      onClick={() => toggleFollow(currentUserId, targetId)}
      className="px-4 py-2 rounded-full text-xs font-bold"
      style={{ background: isFollowing ? 'var(--bg-l2)' : 'var(--accent)', color: isFollowing ? 'var(--t1)' : '#fff' }}>
      {isFollowing ? 'Вы подписаны' : 'Подписаться'}
    </motion.button>
  );
};

/* -- Video Card (grid) --------------------------------------- */
const VideoCard = ({ video, onClick }: { video: VideoEntry; onClick: () => void }) => {
  const isBlocked = useModerationStore(s => s.isBlocked('video-channel', video.uploadedBy));
  if (isBlocked) {
    return (
      <div className="mb-2.5">
        <BlockedChannelBadge size="sm"/>
      </div>
    );
  }
  return (
    <motion.div className="cursor-pointer" whileTap={{ scale:0.97 }} onClick={onClick}>
      <div className="mb-2.5">
        <Thumbnail video={video} size="md"/>
      </div>
      <div className="flex gap-2.5">
        <span onClick={e => { e.stopPropagation(); openProfile(video.uploadedBy); }}>
          <Avatar name={video.uploaderName}/>
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug line-clamp-2" style={{ color:V.t1 }}>{video.title}</p>
          <p className="text-xs mt-1" style={{ color:V.t2 }}>{video.uploaderName}</p>
          <p className="text-xs" style={{ color:V.t3 }}>
            {fmtViews(video.views)} просм. · {fmtAgo(video.createdAt)}
          </p>
        </div>
      </div>
    </motion.div>
  );
};

/* -- Custom Video Player --------------------------------------- */
const VideoPlayer = ({ video }: { video: VideoEntry }) => {
  const vidRef = useRef<HTMLVideoElement>(null);
  const isMobile = useIsMobile();
  const [playing, setPlaying]   = useState(false);
  const [muted,   setMuted]     = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showCtrl, setShowCtrl] = useState(true);
  const hideTimer = useRef<number>(0);

  const { incrementViews } = useVideoStore();

  useEffect(() => {
    incrementViews(video.id);
    return () => { vidRef.current?.pause(); };
  }, [video.id]);

  const resetHide = () => {
    setShowCtrl(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => playing && setShowCtrl(false), 2800);
  };

  const toggle = () => {
    const v = vidRef.current; if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
    resetHide();
  };

  const fmtS = (s:number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

  return (
    <div className="relative w-full overflow-hidden rounded-2xl select-none"
      style={{ background:'#000', aspectRatio:video.isShort?'9/16':'16/9', maxHeight: video.isShort ? 420 : undefined }}
      onMouseMove={resetHide} onClick={toggle}>
      {video.sourceUrl
        ? <video ref={vidRef} src={video.sourceUrl} className="w-full h-full object-contain"
            onTimeUpdate={e => setProgress((e.currentTarget.currentTime/e.currentTarget.duration)||0)}
            onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} playsInline/>
        : <div className="w-full h-full flex flex-col items-center justify-center gap-3"
            style={{ background:`linear-gradient(160deg,${video.thumbnailGrad?.[0]??'#111'},${video.thumbnailGrad?.[1]??'#333'})` }}>
            {video.thumbnailUrl && <img src={video.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30"/>}
            <div className="relative text-center px-6">
              <div className="text-4xl mb-3">🎬</div>
              <p className="text-sm font-semibold text-white">Видео недоступно офлайн</p>
              <p className="text-xs mt-1" style={{ color:'rgba(255,255,255,0.5)' }}>Загрузите видеофайл для просмотра</p>
            </div>
          </div>
      }
      {isMobile && video.sourceUrl && (
        <MobileVideoGestures videoRef={vidRef} onSingleTap={toggle}/>
      )}
      {/* Controls overlay */}
      <AnimatePresence>
        {showCtrl && (
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            className="absolute inset-0 flex flex-col justify-between"
            style={{ background:'linear-gradient(transparent 40%,rgba(0,0,0,0.7))' }}
            onClick={e => e.stopPropagation()}>
            {/* Top bar */}
            <div/>
            {/* Center play */}
            <div className="flex items-center justify-center" onClick={toggle}>
              <motion.div key={playing?'p':'pa'} initial={{ scale:1.3, opacity:0 }} animate={{ scale:1, opacity:1 }}
                className="grid h-14 w-14 place-items-center rounded-full"
                style={{ background:'rgba(0,0,0,0.55)', backdropFilter:'blur(6px)' }}>
                {playing ? <Pause size={24} className="text-white"/> : <Play size={24} className="text-white ml-1"/>}
              </motion.div>
            </div>
            {/* Bottom controls */}
            <div className="px-3 pb-3" onClick={e => e.stopPropagation()}>
              {/* Seek bar */}
              <div className="h-1 w-full rounded-full mb-2.5 cursor-pointer relative group"
                style={{ background:'rgba(255,255,255,0.25)' }}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientX - r.left) / r.width;
                  if (vidRef.current) vidRef.current.currentTime = pct * duration;
                }}>
                <div className="h-full rounded-full transition-all" style={{ width:`${progress*100}%`, background:V.accent }}/>
                <div className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  style={{ left:`${progress*100}%`, background:'#fff', transform:'translateX(-50%) translateY(-50%)' }}/>
              </div>
              {/* Buttons row */}
              <div className="flex items-center gap-3">
                <button type="button" onClick={toggle}
                  className="grid h-7 w-7 place-items-center text-white">
                  {playing ? <Pause size={16}/> : <Play size={16}/>}
                </button>
                <button type="button" onClick={() => { setMuted(m => !m); if (vidRef.current) vidRef.current.muted = !muted; }}
                  className="grid h-7 w-7 place-items-center text-white">
                  {muted ? <VolumeX size={16}/> : <Volume2 size={16}/>}
                </button>
                <span className="text-xs text-white" style={{ fontFamily:'DM Mono,monospace' }}>
                  {fmtS(duration * progress)} / {fmtS(duration)}
                </span>
                <div className="ml-auto">
                  <button type="button" onClick={() => vidRef.current?.requestFullscreen()}
                    className="grid h-7 w-7 place-items-center text-white">
                    <Maximize2 size={15}/>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* -- Full Video View ------------------------------------------- */
const VideoView = ({ video, onBack }: { video: VideoEntry; onBack: () => void }) => {
  const { likeVideo, dislikeVideo, addComment, deleteVideo, likeComment, pinComment, deleteComment } = useVideoStore();
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [showDel, setShowDel] = useState(false);

  const liked    = video.likes.includes(currentUserId ?? '');
  const disliked = video.dislikes.includes(currentUserId ?? '');
  const isOwner  = video.uploadedBy === currentUserId;

  const { isBlocked, blockReason } = useModerationStore();
  const channelBlocked = isBlocked('video-channel', video.uploadedBy) && !isOwner;

  const handleComment = () => {
    const t = comment.trim();
    if (!t || !currentUserId || !me) return;
    addComment(video.id, currentUserId, me.name, t, replyTo?.id);
    setComment(''); setReplyTo(null);
  };

  if (channelBlocked) {
    return (
      <div className="flex h-full flex-col" style={{ background: V.bg }}>
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${V.border}` }}>
          <button type="button" onClick={onBack} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
            <ChevronLeft size={20} style={{ color: V.t2 }}/>
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <BlockedChannelBadge reason={blockReason('video-channel', video.uploadedBy)}/>
        </div>
      </div>
    );
  }

  return (
    <ContentWarningGate domain="video-channel" targetId={video.uploadedBy}>
    <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:20 }}
      className="flex flex-col h-full overflow-y-auto" style={{ background:V.bg, scrollbarWidth:'none' }}>
      {/* Back button */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom:`1px solid ${V.border}` }}>
        <button type="button" onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/5">
          <ChevronLeft size={20} style={{ color:V.t2 }}/>
        </button>
        <p className="text-sm font-semibold line-clamp-1 flex-1" style={{ color:V.t1 }}>{video.title}</p>
        {isOwner && (
          <button type="button" onClick={() => setShowDel(s => !s)}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
            <MoreVertical size={16} style={{ color:V.t2 }}/>
          </button>
        )}
      </div>

      <div className="flex-1 px-4 py-4 space-y-4">
        {/* Delete confirm */}
        <AnimatePresence>
          {showDel && (
            <motion.div initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
              className="rounded-2xl p-4 flex items-center gap-3"
              style={{ background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.2)' }}>
              <p className="text-sm flex-1" style={{ color:V.t1 }}>Удалить это видео?</p>
              <button type="button" onClick={() => { deleteVideo(video.id); onBack(); }}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold"
                style={{ background:'rgba(248,113,113,0.2)', color:V.red }}>Удалить</button>
              <button type="button" onClick={() => setShowDel(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold"
                style={{ background:V.bg3, color:V.t2 }}>Отмена</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Player */}
        <VideoPlayer video={video}/>

        {/* Title & meta */}
        <div>
          <h1 className="text-base font-bold leading-snug" style={{ color:V.t1 }}>{video.title}</h1>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap" style={{ color:V.t3, fontSize:12 }}>
            <span>{fmtViews(video.views)} просмотров</span>
            <span>·</span><span>{fmtAgo(video.createdAt)}</span>
            <span className="rounded-full px-2 py-0.5" style={{ background:V.bg3, fontSize:10, color:V.t2 }}>
              {CATEGORY_LABEL[video.category]}
            </span>
          </div>
        </div>

        {/* Author + subscribe */}
        <div className="flex items-center gap-3 py-3" style={{ borderTop:`1px solid ${V.border}`, borderBottom:`1px solid ${V.border}` }}>
          <button type="button" onClick={() => openProfile(video.uploadedBy)}>
            <Avatar name={video.uploaderName} size={40}/>
          </button>
          <button type="button" onClick={() => openProfile(video.uploadedBy)} className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold" style={{ color:V.t1 }}>{video.uploaderName}</p>
            <p className="text-xs" style={{ color:V.t3 }}>Sky Creator</p>
          </button>
          <SubscribeButton targetId={video.uploadedBy}/>
        </div>

        {/* Like / dislike / share */}
        <div className="flex gap-2">
          <motion.button whileTap={{ scale:0.92 }} type="button"
            onClick={() => currentUserId && likeVideo(video.id, currentUserId)}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors"
            style={{
              background: liked ? `${V.accent}20` : V.bg3,
              border: `1px solid ${liked ? V.accent+'60' : V.border2}`,
              color: liked ? V.accent : V.t1,
            }}>
            <ThumbsUp size={15}/>{video.likes.length}
          </motion.button>
          <motion.button whileTap={{ scale:0.92 }} type="button"
            onClick={() => currentUserId && dislikeVideo(video.id, currentUserId)}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors"
            style={{
              background: disliked ? 'rgba(248,113,113,0.12)' : V.bg3,
              border: `1px solid ${disliked ? 'rgba(248,113,113,0.4)' : V.border2}`,
              color: disliked ? V.red : V.t1,
            }}>
            <ThumbsDown size={15}/>
          </motion.button>
          <button type="button" className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
            style={{ background:V.bg3, border:`1px solid ${V.border2}`, color:V.t1 }}>
            <Share2 size={15}/>Поделиться
          </button>
        </div>

        {/* Description */}
        {video.description && (
          <div className="rounded-2xl p-4 space-y-2" style={{ background:V.bg2 }}>
            <p className="text-sm leading-relaxed" style={{ color:V.t2 }}>{video.description}</p>
            <AiVideoSummarize title={video.title} description={video.description} duration={video.duration} tags={video.tags} category={video.category}/>
            <AiVideoQA title={video.title} description={video.description} duration={video.duration} tags={video.tags} category={video.category}/>
            {video.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {video.tags.map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background:`${V.accent}15`, color:V.accent }}>#{t}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Comments */}
        <div>
          <p className="text-sm font-semibold mb-3" style={{ color:V.t1 }}>
            Комментарии · {video.comments.length}
          </p>
          {/* Add comment */}
          {replyTo && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: V.bg2, color: V.t2 }}>
              <span className="flex-1">Ответ для <span style={{ color: V.accent }}>{replyTo.name}</span></span>
              <button type="button" onClick={() => setReplyTo(null)} style={{ color: V.t3 }}><X size={13}/></button>
            </div>
          )}
          <div className="flex gap-3 mb-4">
            <Avatar name={me?.name ?? 'U'}/>
            <div className="flex-1 flex gap-2">
              <input value={comment} onChange={e => setComment(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleComment()}
                placeholder={replyTo ? `Ответить ${replyTo.name}...` : 'Напишите комментарий...'}
                className="flex-1 rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background:V.bg2, border:`1px solid ${V.border}`, color:V.t1 }}/>
              <motion.button whileTap={{ scale:0.9 }} type="button" onClick={handleComment}
                disabled={!comment.trim()}
                className="grid h-9 w-9 place-items-center rounded-xl"
                style={{ background: comment.trim() ? V.accent : V.bg3, color:'#fff' }}>
                <Plus size={16}/>
              </motion.button>
            </div>
          </div>
          {/* Comment list */}
          <div className="space-y-4">
            {[...video.comments].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).filter(c => !c.replyToId).map(c => {
              const replies = video.comments.filter(r => r.replyToId === c.id);
              const CommentRow = ({ cm, isReply }: { cm: VideoComment; isReply?: boolean }) => {
                const commentLiked = currentUserId ? cm.likes.includes(currentUserId) : false;
                return (
                  <div className="flex gap-3">
                    <button type="button" onClick={() => openProfile(cm.authorId)}>
                      <Avatar name={cm.authorName} size={isReply ? 26 : 32}/>
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <button type="button" onClick={() => openProfile(cm.authorId)}
                          className="text-xs font-semibold" style={{ color:V.t1 }}>{cm.authorName}</button>
                        {cm.pinned && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color:V.accent }}>
                            <Pin size={9}/> Закреплено
                          </span>
                        )}
                        <span className="text-[10px]" style={{ color:V.t3 }}>{fmtAgo(cm.createdAt)}</span>
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color:V.t2 }}>{cm.text}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <button type="button" onClick={() => currentUserId && likeComment(video.id, cm.id, currentUserId)}
                          className="flex items-center gap-1 text-[11px] font-semibold transition-colors"
                          style={{ color: commentLiked ? V.accent : V.t3 }}>
                          <ThumbsUp size={11} fill={commentLiked ? V.accent : 'none'}/> {cm.likes.length > 0 && cm.likes.length}
                        </button>
                        {!isReply && (
                          <button type="button" onClick={() => setReplyTo({ id: cm.id, name: cm.authorName })}
                            className="text-[11px] font-semibold" style={{ color:V.t3 }}>Ответить</button>
                        )}
                        {isOwner && !isReply && (
                          <button type="button" onClick={() => pinComment(video.id, cm.id)}
                            className="text-[11px] font-semibold" style={{ color:V.t3 }}>{cm.pinned ? 'Открепить' : 'Закрепить'}</button>
                        )}
                        {(cm.authorId === currentUserId || isOwner) && (
                          <button type="button" onClick={() => deleteComment(video.id, cm.id)}
                            className="text-[11px] font-semibold" style={{ color:V.t3 }}>Удалить</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              };
              return (
                <div key={c.id}>
                  <CommentRow cm={c}/>
                  {replies.length > 0 && (
                    <div className="ml-11 mt-3 space-y-3 border-l pl-3" style={{ borderColor: V.border }}>
                      {replies.map(r => <CommentRow key={r.id} cm={r} isReply/>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
    </ContentWarningGate>
  );
};

/* -- Shorts Player --------------------------------------------- */
const ShortsPlayer = ({ shorts, initialIndex = 0, onClose }: { shorts: VideoEntry[]; initialIndex?: number; onClose: () => void }) => {
  const [idx, setIdx]   = useState(initialIndex);
  const [playing, setPlaying] = useState(true);
  const vidRef = useRef<HTMLVideoElement>(null);
  const { likeVideo, incrementViews } = useVideoStore();
  const { currentUserId } = useAuthStore();

  const video = shorts[idx];

  useEffect(() => {
    incrementViews(video.id);
    if (vidRef.current) {
      vidRef.current.currentTime = 0;
      if (playing) vidRef.current.play().catch(() => {});
    }
  }, [idx]);

  const liked = video.likes.includes(currentUserId ?? '');

  const prev = () => idx > 0 && setIdx(i => i - 1);
  const next = () => idx < shorts.length - 1 && setIdx(i => i + 1);

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background:'#000' }}>
      {/* Close */}
      <button type="button" onClick={onClose}
        className="absolute top-4 left-4 z-10 grid h-10 w-10 place-items-center rounded-full"
        style={{ background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)' }}>
        <X size={20} className="text-white"/>
      </button>

      {/* Counter */}
      <div className="absolute top-4 right-4 z-10 rounded-full px-3 py-1"
        style={{ background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)', fontSize:12, color:'rgba(255,255,255,0.7)', fontFamily:'DM Mono,monospace' }}>
        {idx+1} / {shorts.length}
      </div>

      {/* Video area */}
      <div className="relative w-full max-w-sm h-full flex items-center justify-center"
        onClick={() => {
          if (vidRef.current?.paused) { vidRef.current.play(); setPlaying(true); }
          else { vidRef.current?.pause(); setPlaying(false); }
        }}>
        {video.sourceUrl
          ? <video ref={vidRef} src={video.sourceUrl} loop playsInline autoPlay muted={false}
              className="max-h-full max-w-full object-contain"
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}/>
          : <div className="w-full aspect-[9/16] max-h-[80vh] flex items-center justify-center"
              style={{ background:`linear-gradient(160deg,${video.thumbnailGrad?.[0]??'#111'},${video.thumbnailGrad?.[1]??'#333'})` }}>
              {video.thumbnailUrl && <img src={video.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25"/>}
              <div className="relative text-center"><div className="text-5xl mb-3">🎬</div><p className="text-sm text-white font-semibold">Нет файла</p></div>
            </div>
        }

        {/* Pause indicator */}
        <AnimatePresence>
          {!playing && (
            <motion.div initial={{ scale:1.2, opacity:0 }} animate={{ scale:1, opacity:1 }} exit={{ opacity:0 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="grid h-16 w-16 place-items-center rounded-full"
                style={{ background:'rgba(0,0,0,0.55)', backdropFilter:'blur(6px)' }}>
                <Play size={28} className="text-white ml-1"/>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom info */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-6 pt-16"
          style={{ background:'linear-gradient(transparent,rgba(0,0,0,0.75))' }}
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2 mb-2">
            <button type="button" onClick={() => openProfile(video.uploadedBy)}>
              <Avatar name={video.uploaderName} size={28}/>
            </button>
            <button type="button" onClick={() => openProfile(video.uploadedBy)}
              className="text-sm font-semibold text-white">{video.uploaderName}</button>
            <SubscribeButton targetId={video.uploadedBy}/>
          </div>
          <p className="text-sm text-white font-medium mb-1">{video.title}</p>
          <p className="text-xs" style={{ color:'rgba(255,255,255,0.55)' }}>{fmtViews(video.views)} просм.</p>
        </div>

        {/* Right actions */}
        <div className="absolute right-3 bottom-24 flex flex-col items-center gap-5"
          onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => currentUserId && likeVideo(video.id, currentUserId)}
            className="flex flex-col items-center gap-1">
            <motion.div whileTap={{ scale:1.3 }} className="grid h-10 w-10 place-items-center rounded-full"
              style={{ background: liked ? 'rgba(79,110,247,0.3)' : 'rgba(0,0,0,0.5)', backdropFilter:'blur(6px)' }}>
              <Heart size={22} style={{ color: liked ? V.accent : '#fff', fill: liked ? V.accent : 'none' }}/>
            </motion.div>
            <span className="text-xs text-white">{video.likes.length}</span>
          </button>
          <button type="button" className="flex flex-col items-center gap-1">
            <div className="grid h-10 w-10 place-items-center rounded-full"
              style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(6px)' }}>
              <MessageCircle size={22} className="text-white"/>
            </div>
            <span className="text-xs text-white">{video.comments.length}</span>
          </button>
          <button type="button" className="flex flex-col items-center gap-1">
            <div className="grid h-10 w-10 place-items-center rounded-full"
              style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(6px)' }}>
              <Share2 size={20} className="text-white"/>
            </div>
            <span className="text-xs text-white">Поделиться</span>
          </button>
        </div>

        {/* Up/Down navigation */}
        <div className="absolute left-1/2 -translate-x-1/2 top-4 flex flex-col items-center gap-2 pointer-events-none">
        </div>
      </div>

      {/* Swipe nav arrows */}
      {idx > 0 && (
        <button type="button" onClick={prev}
          className="absolute top-1/2 -translate-y-1/2 left-3 grid h-10 w-10 place-items-center rounded-full z-10"
          style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(6px)' }}>
          <ArrowUp size={20} className="text-white"/>
        </button>
      )}
      {idx < shorts.length - 1 && (
        <button type="button" onClick={next}
          className="absolute top-1/2 -translate-y-1/2 right-3 grid h-10 w-10 place-items-center rounded-full z-10"
          style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(6px)' }}>
          <ArrowDown size={20} className="text-white"/>
        </button>
      )}

      {/* Thumbnail strip */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
        {shorts.map((_, i) => (
          <button key={i} type="button" onClick={() => setIdx(i)}
            className="rounded-full transition-all"
            style={{ width: i === idx ? 20 : 6, height:6, background: i === idx ? V.accent : 'rgba(255,255,255,0.3)' }}/>
        ))}
      </div>
    </motion.div>
  );
};

/* -- Upload Tab ------------------------------------------------ */
/* -- Creator Studio: реальная аналитика + управление публикациями -- */
const StudioTab = () => {
  const { videos, publishVideoNow, deleteVideo, updateVideoSchedule } = useVideoStore();
  const { currentUserId } = useAuthStore();
  const myVideos = useMemo(() => videos.filter(v => v.uploadedBy === currentUserId), [videos, currentUserId]);
  const [editSchedule, setEditSchedule] = useState<string | null>(null);
  const [newSchedTime, setNewSchedTime] = useState('');

  const published = myVideos.filter(v => !v.isDraft && !v.isScheduled);
  const drafts    = myVideos.filter(v => v.isDraft);
  const scheduled = myVideos.filter(v => v.isScheduled);

  const totalViews     = published.reduce((s, v) => s + v.views, 0);
  const totalLikes     = published.reduce((s, v) => s + v.likes.length, 0);
  const totalComments  = published.reduce((s, v) => s + v.comments.length, 0);
  const totalSubs      = useVideoStore.getState().subscriptions;
  const subscriberCount = Object.values(totalSubs).filter(list => list.includes(currentUserId ?? '')).length;
  const avgViews = published.length ? Math.round(totalViews / published.length) : 0;
  const engagementRate = totalViews > 0 ? Math.round(((totalLikes + totalComments) / totalViews) * 100) : 0;
  const topVideo = [...published].sort((a, b) => b.views - a.views)[0];

  const Stat = ({ label, value }: { label: string; value: string | number }) => (
    <div className="rounded-2xl p-3.5" style={{ background:V.bg1, border:`1px solid ${V.border}` }}>
      <p className="text-[10px] font-semibold" style={{ color:V.t3 }}>{label}</p>
      <p className="text-xl font-extrabold mt-0.5" style={{ color:V.t1 }}>{value}</p>
    </div>
  );

  return (
    <div className="overflow-y-auto h-full px-4 py-4 space-y-6" style={{ scrollbarWidth:'none' }}>
      <div>
        <p className="text-sm font-bold mb-3" style={{ color:V.t1 }}>Аналитика канала</p>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Просмотры" value={fmtViews(totalViews)}/>
          <Stat label="Подписчики" value={subscriberCount}/>
          <Stat label="Ср. просмотров/видео" value={avgViews}/>
          <Stat label="Вовлечённость" value={`${engagementRate}%`}/>
        </div>
        {topVideo && (
          <div className="mt-2 rounded-2xl p-3.5 flex items-center gap-3" style={{ background:`${V.accent}0c`, border:`1px solid ${V.accent}30` }}>
            <Eye size={16} style={{ color:V.accent }}/>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold" style={{ color:V.accent }}>Топ по просмотрам</p>
              <p className="text-sm truncate" style={{ color:V.t1 }}>{topVideo.title} · {fmtViews(topVideo.views)}</p>
            </div>
          </div>
        )}
      </div>

      {scheduled.length > 0 && (
        <div>
          <p className="text-sm font-bold mb-3" style={{ color:V.t1 }}>Запланировано ({scheduled.length})</p>
          <div className="space-y-2">
            {scheduled.map(v => (
              <div key={v.id} className="rounded-2xl p-3" style={{ background:V.bg1, border:`1px solid ${V.border}` }}>
                <p className="text-sm font-semibold truncate mb-1" style={{ color:V.t1 }}>{v.title}</p>
                <p className="text-xs mb-2" style={{ color:V.accent }}>
                  <Clock size={11} className="inline mr-1"/>
                  {v.scheduledAt && new Date(v.scheduledAt).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                </p>
                {editSchedule === v.id ? (
                  <div className="flex gap-2">
                    <input type="datetime-local" value={newSchedTime} onChange={e => setNewSchedTime(e.target.value)}
                      className="flex-1 rounded-lg px-2 py-1.5 text-xs outline-none" style={{ background:V.bg2, border:`1px solid ${V.border}`, color:V.t1 }}/>
                    <button type="button" onClick={() => { if (newSchedTime) { updateVideoSchedule(v.id, new Date(newSchedTime).getTime()); setEditSchedule(null); } }}
                      className="rounded-lg px-3 text-xs font-bold text-white" style={{ background:V.accent }}>OK</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => publishVideoNow(v.id)}
                      className="flex-1 rounded-lg py-1.5 text-[11px] font-bold text-white" style={{ background:V.accent }}>Опубликовать сейчас</button>
                    <button type="button" onClick={() => { setEditSchedule(v.id); setNewSchedTime(''); }}
                      className="flex-1 rounded-lg py-1.5 text-[11px] font-bold" style={{ background:V.bg2, color:V.t2 }}>Перенести</button>
                    <button type="button" onClick={() => deleteVideo(v.id)}
                      className="rounded-lg px-3 py-1.5 text-[11px] font-bold" style={{ background:V.bg2, color:V.red }}><Trash2 size={12}/></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {drafts.length > 0 && (
        <div>
          <p className="text-sm font-bold mb-3" style={{ color:V.t1 }}>Черновики ({drafts.length})</p>
          <div className="space-y-2">
            {drafts.map(v => (
              <div key={v.id} className="rounded-2xl p-3 flex items-center gap-3" style={{ background:V.bg1, border:`1px solid ${V.border}` }}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate" style={{ color:V.t1 }}>{v.title || 'Без названия'}</p>
                  <p className="text-[11px]" style={{ color:V.t3 }}>{v.duration}</p>
                </div>
                <button type="button" onClick={() => publishVideoNow(v.id)}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white shrink-0" style={{ background:V.accent }}>Опубликовать</button>
                <button type="button" onClick={() => deleteVideo(v.id)}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold shrink-0" style={{ background:V.bg2, color:V.red }}><Trash2 size={12}/></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-bold mb-3" style={{ color:V.t1 }}>Опубликовано ({published.length})</p>
        {published.length === 0 ? (
          <p className="text-xs text-center py-6" style={{ color:V.t3 }}>Пока нет опубликованных видео</p>
        ) : (
          <div className="space-y-2">
            {[...published].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(v => (
              <div key={v.id} className="rounded-2xl p-3" style={{ background:V.bg1, border:`1px solid ${V.border}` }}>
                <p className="text-sm font-semibold truncate mb-1.5" style={{ color:V.t1 }}>{v.title}</p>
                <div className="flex items-center gap-3 text-[11px]" style={{ color:V.t3 }}>
                  <span><Eye size={11} className="inline mr-0.5"/> {fmtViews(v.views)}</span>
                  <span>👍 {v.likes.length}</span>
                  <span>💬 {v.comments.length}</span>
                  <span className="ml-auto">{fmtAgo(v.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const UploadTab = ({ onDone }: { onDone: () => void }) => {
  const { addVideo } = useVideoStore();
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);

  const [file,    setFile]    = useState<File|null>(null);
  const [cover,   setCover]   = useState<string|undefined>();
  const [title,   setTitle]   = useState('');
  const [desc,    setDesc]    = useState('');
  const [cat,     setCat]     = useState<string>('other');
  const [tags,    setTags]    = useState('');
  const [isShort, setIsShort] = useState(false);
  const [publishMode, setPublishMode] = useState<'now' | 'draft' | 'scheduled'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress,setProgress]= useState(0);
  const fileRef  = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const toDur = (s:number) => {
    const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60);
    return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;
  };

  const handleFile = (f: File) => {
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    // Auto-detect short by aspect ratio
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(f);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      setIsShort(video.videoHeight > video.videoWidth);
    };
    video.src = url;
  };

  const submit = async () => {
    if (!file || !title.trim() || !currentUserId || !me) return;
    setLoading(true); setProgress(10);
    try {
      const url = URL.createObjectURL(file);
      const dur = await new Promise<number>(r => {
        const v = document.createElement('video'); v.preload='metadata';
        const u = URL.createObjectURL(file);
        v.onloadedmetadata = () => { URL.revokeObjectURL(u); r(v.duration); };
        v.onerror = () => { URL.revokeObjectURL(u); r(0); }; v.src = u;
      });
      setProgress(50);
      const tagList = tags.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
      const schedTs = publishMode === 'scheduled' && scheduledAt ? new Date(scheduledAt).getTime() : undefined;
      await addVideo({
        title: title.trim(), description: desc.trim(),
        uploadedBy: currentUserId, uploaderName: me.name,
        duration: toDur(dur), durationSec: dur,
        category: cat as any, tags: tagList, isShort,
        sourceUrl: url, thumbnailUrl: cover,
        thumbnailGrad: undefined,
        fileName: file.name, mimeType: file.type, bytes: file.size,
        isDraft: publishMode === 'draft',
        isScheduled: publishMode === 'scheduled' && !!schedTs && schedTs > Date.now(),
        scheduledAt: publishMode === 'scheduled' ? schedTs : undefined,
      }, file);
      setProgress(100);
      setTimeout(() => { setLoading(false); onDone(); }, 400);
    } catch { setLoading(false); setProgress(0); }
  };

  const iSty = { background:V.bg2, border:`1px solid ${V.border}`, color:V.t1 };
  const iCls = 'w-full rounded-2xl px-4 py-2.5 text-sm outline-none';

  return (
    <div className="overflow-y-auto h-full px-4 py-4 space-y-4" style={{ scrollbarWidth:'none' }}>
      <div className="flex items-center gap-3 mb-2">
        <div className="grid h-10 w-10 place-items-center rounded-2xl"
          style={{ background:`${V.accent}20`, border:`1px solid ${V.accent}35` }}>
          <Upload size={18} style={{ color:V.accent }}/>
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color:V.t1 }}>Загрузить видео</p>
          <p className="text-xs" style={{ color:V.t3 }}>MP4, MOV, MKV, WebM · до 2 ГБ</p>
        </div>
      </div>

      {/* Drop zone */}
      <div className="rounded-2xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-3 py-8 transition-colors"
        style={{ borderColor: file ? V.accent : V.border2, background: file ? `${V.accent}06` : 'transparent' }}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); }}
        onDrop={e => { e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) handleFile(f); }}>
        <input ref={fileRef} type="file" accept="video/*" className="hidden"
          onChange={e => { const f=e.target.files?.[0]; if(f) handleFile(f); }}/>
        <div className="grid h-14 w-14 place-items-center rounded-2xl"
          style={{ background: file ? `${V.accent}20` : V.bg3 }}>
          {file ? <Check size={28} style={{ color:V.accent }}/> : <Upload size={28} style={{ color:V.t3 }}/>}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: file ? V.accent : V.t2 }}>
            {file ? file.name : 'Нажмите или перетащите файл'}
          </p>
          {!file && <p className="text-xs mt-1" style={{ color:V.t3 }}>MP4 · MOV · MKV · WebM · AVI</p>}
        </div>
      </div>

      {file && (
        <>
          {/* Short toggle */}
          <div className="flex items-center justify-between rounded-2xl px-4 py-3"
            style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
            <div>
              <p className="text-sm font-semibold" style={{ color:V.t1 }}>Это Shorts (вертикальное видео)</p>
              <p className="text-xs mt-0.5" style={{ color:V.t3 }}>Вертикальный формат 9:16</p>
            </div>
            <motion.div className="h-6 w-11 rounded-full cursor-pointer flex items-center px-0.5 transition-colors"
              style={{ background: isShort ? V.accent : V.bg3 }}
              onClick={() => setIsShort(s => !s)}>
              <motion.div className="h-5 w-5 rounded-full bg-white shadow"
                animate={{ x: isShort ? 20 : 0 }} transition={{ type:'spring', stiffness:700, damping:35 }}/>
            </motion.div>
          </div>

          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название *" className={iCls} style={iSty}/>

          <textarea value={desc} onChange={e=>setDesc(e.target.value)}
            placeholder="Описание (необязательно)" rows={3}
            className={iCls+' resize-none'} style={iSty}/>

          <select value={cat} onChange={e=>setCat(e.target.value)} className={iCls} style={{ ...iSty, cursor:'pointer' }}>
            {Object.entries(CATEGORY_LABEL).map(([k,l]) => <option key={k} value={k}>{l}</option>)}
          </select>

          <input value={tags} onChange={e=>setTags(e.target.value)}
            placeholder="Теги через запятую (gaming, sky, clip...)" className={iCls} style={iSty}/>

          {/* Cover */}
          <div className="flex items-center gap-3">
            <input ref={coverRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f=e.target.files?.[0]; if(f){const r=new FileReader();r.onload=()=>setCover(r.result as string);r.readAsDataURL(f);} }}/>
            <button type="button" onClick={() => coverRef.current?.click()}
              className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm transition-colors"
              style={{ background:V.bg2, border:`1px solid ${V.border}`, color:V.t2 }}>
              🖼 {cover ? '✅ Обложка' : 'Добавить обложку'}
            </button>
            {cover && <img src={cover} alt="" className="h-10 w-16 rounded-xl object-cover"/>}
          </div>

          {loading && (
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background:V.bg3 }}>
              <motion.div className="h-full rounded-full" style={{ background:`linear-gradient(90deg,${V.accent},#818cf8)`, width:`${progress}%` }} transition={{ duration:.3 }}/>
            </div>
          )}

          {/* Publish mode */}
          <div className="flex gap-2">
            {([['now','Сейчас'],['draft','Черновик'],['scheduled','По расписанию']] as const).map(([k,l]) => (
              <button key={k} type="button" onClick={() => setPublishMode(k)}
                className="flex-1 rounded-xl py-2 text-xs font-bold transition-colors"
                style={{ background: publishMode===k ? V.accent : V.bg3, color: publishMode===k ? '#fff' : V.t2 }}>
                {l}
              </button>
            ))}
          </div>
          {publishMode === 'scheduled' && (
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}
              className={iCls} style={iSty}/>
          )}

          <motion.button whileTap={{ scale:0.97 }} type="button" onClick={submit}
            disabled={loading || !title.trim() || (publishMode==='scheduled' && !scheduledAt)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-40"
            style={{ background:V.accent }}>
            <Upload size={15}/>{loading ? `${progress}%...` : publishMode==='draft' ? 'Сохранить черновик' : publishMode==='scheduled' ? 'Запланировать публикацию' : 'Опубликовать видео'}
          </motion.button>
        </>
      )}
    </div>
  );
};

/* -- Shorts Grid Preview --------------------------------------- */
const ShortsPreview = ({ shorts, onOpen }: { shorts: VideoEntry[]; onOpen: (i: number) => void }) => (
  <div className="px-4 py-3">
    <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color:V.t3 }}>
      Shorts · {shorts.length}
    </p>
    <div className="grid grid-cols-3 gap-2">
      {shorts.map((v, i) => {
        const [g1,g2] = v.thumbnailGrad ?? getVideoGrad(v.id);
        return (
          <motion.div key={v.id} whileTap={{ scale:0.95 }} onClick={() => onOpen(i)}
            className="relative overflow-hidden rounded-xl cursor-pointer"
            style={{ aspectRatio:'9/16', background:`linear-gradient(160deg,${g1},${g2})` }}>
            {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover"/>}
            <div className="absolute inset-0 flex flex-col justify-end p-2"
              style={{ background:'linear-gradient(transparent 40%,rgba(0,0,0,0.7))' }}>
              <p className="text-[10px] font-semibold text-white line-clamp-2 leading-tight">{v.title}</p>
              <p className="text-[9px] mt-0.5" style={{ color:'rgba(255,255,255,0.55)' }}>{fmtViews(v.views)} просм.</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  </div>
);

/* === MAIN MODULE ============================================ */
type VTab = 'home' | 'shorts' | 'subscriptions' | 'history' | 'saved' | 'upload' | 'studio';

export const SkyVideo = () => {
  const { videos, subscribe, unsubscribe, addToHistory, saveVideo, unsaveVideo, getHistory, getSaved, isSubscribed } = useVideoStore();
  const { currentUserId } = useAuthStore();
  const myId = currentUserId;
  const [tab,         setTab]         = useState<VTab>('home');
  const [activeVideo, setActiveVideo] = useState<VideoEntry|null>(null);
  const [activeShort, setActiveShort] = useState<number|null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching,   setSearching]   = useState(false);
  const [catFilter,   setCatFilter]   = useState<string>('all');

  const published = useMemo(() => videos.filter(v => v.status === 'published' && !v.isDraft && !v.isScheduled), [videos]);
  const longVids  = useMemo(() => published.filter(v => !v.isShort), [published]);
  const shorts    = useMemo(() => published.filter(v => v.isShort),  [published]);

  const { subscriptions, watchHistory } = useVideoStore();

  /* Реальный скоринг рекомендаций: категории из истории просмотров +
     подписки + вовлечённость (лайки/просмотры) + свежесть. Без ИИ —
     честный вычисляемый рейтинг на фактических данных пользователя. */
  const recommendationScore = useMemo(() => {
    const uid = currentUserId ?? '';
    const watchedIds = watchHistory[uid] ?? [];
    const watchedVideos = watchedIds.map(id => longVids.find(v => v.id === id)).filter((v): v is VideoEntry => !!v);
    const categoryWeight: Record<string, number> = {};
    watchedVideos.forEach((v, i) => {
      // недавно просмотренные категории весят больше
      categoryWeight[v.category] = (categoryWeight[v.category] ?? 0) + (watchedVideos.length - i);
    });
    const subscribedTo = new Set(subscriptions[uid] ?? []);
    const now = Date.now();

    return (v: VideoEntry) => {
      let score = 0;
      score += (categoryWeight[v.category] ?? 0) * 3;
      if (subscribedTo.has(v.uploadedBy)) score += 15;
      score += Math.log10(v.views + 1) * 2;
      score += v.likes.length * 0.5;
      const ageHours = (now - new Date(v.createdAt).getTime()) / 3_600_000;
      score += Math.max(0, 8 - Math.log2(ageHours + 2)); // свежесть, плавно затухает
      return score;
    };
  }, [longVids, watchHistory, subscriptions, currentUserId]);

  const filtered = useMemo(() => {
    let pool = tab === 'subscriptions'
      ? longVids.filter(v => v.uploadedBy !== currentUserId)
      : longVids;
    if (catFilter !== 'all') pool = pool.filter(v => v.category === catFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      pool = pool.filter(v => v.title.toLowerCase().includes(q) || v.uploaderName.toLowerCase().includes(q));
    }
    if (!searchQuery.trim()) {
      if (tab === 'subscriptions') {
        // в подписках — хронологически, без переранжирования
        pool = [...pool].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      } else {
        pool = [...pool].sort((a, b) => recommendationScore(b) - recommendationScore(a));
      }
    }
    return pool;
  }, [longVids, tab, catFilter, searchQuery, currentUserId, recommendationScore]);

  // Full video view
  if (activeVideo) {
    return (
      <AnimatePresence mode="wait">
        <VideoView key={activeVideo.id} video={activeVideo} onBack={() => setActiveVideo(null)}/>
      </AnimatePresence>
    );
  }

  // Shorts fullscreen
  if (activeShort !== null) {
    return (
      <AnimatePresence>
        <ShortsPlayer shorts={shorts} initialIndex={activeShort} onClose={() => setActiveShort(null)}/>
      </AnimatePresence>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:V.bg }}>
      {/* Header */}
      <div className="shrink-0 px-4 pt-3 pb-2" style={{ borderBottom:`1px solid ${V.border}` }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-2 flex-1">
            <div className="grid h-8 w-8 place-items-center rounded-xl"
              style={{ background:`linear-gradient(135deg,${V.accent},#818cf8)`, boxShadow:`0 4px 14px ${V.accent}40` }}>
              <Play size={16} className="text-white ml-0.5"/>
            </div>
            <span className="font-bold text-base" style={{ color:V.t1 }}>Sky Video</span>
          </div>
          {/* Search toggle */}
          <motion.button whileTap={{ scale:0.9 }} type="button"
            onClick={() => setSearching(s => !s)}
            className="grid h-8 w-8 place-items-center rounded-full transition-colors"
            style={{ background: searching ? `${V.accent}20` : 'transparent', color: searching ? V.accent : V.t2 }}>
            {searching ? <X size={16}/> : <Search size={16}/>}
          </motion.button>
        </div>

        {/* Search bar */}
        <AnimatePresence>
          {searching && (
            <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }} exit={{ height:0, opacity:0 }}
              className="overflow-hidden mb-2">
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Поиск видео и авторов..." autoFocus
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                style={{ background:V.bg2, border:`1px solid ${V.border}`, color:V.t1 }}/>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tabs */}
        <div className="flex gap-0.5 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
          {([
            { key:'home',          label:'Главная'   },
            { key:'shorts',        label:'Shorts'    },
            { key:'subscriptions', label:'Подписки'  },
            { key:'history',       label:'История'   },
            { key:'saved',         label:'Сохранено' },
            { key:'upload',        label:'Загрузить' },
            { key:'studio',        label:'Studio'    },
          ] as { key:VTab; label:string }[]).map(({ key, label }) => {
            const on = tab === key;
            return (
              <button key={key} type="button" onClick={() => setTab(key)}
                className="relative shrink-0 px-4 py-2 text-xs font-semibold transition-colors"
                style={{ color: on ? V.t1 : V.t3 }}>
                {label}
                {on && (
                  <motion.div layoutId="video-tab-line" className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
                    style={{ background:V.accent }} transition={{ type:'spring', stiffness:500, damping:40 }}/>
                )}
              </button>
            );
          })}
        </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            transition={{ duration:.12 }} className="h-full overflow-y-auto" style={{ scrollbarWidth:'none' }}>

            {/* HOME / SUBSCRIPTIONS */}
            {tab === 'home' && <AdBanner placement="video_banner"/>}
            {(tab === 'home' || tab === 'subscriptions') && (
              <div>
                {/* Category filters */}
                <div className="flex gap-2 px-4 py-2.5 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
                  {[['all','Все'], ...Object.entries(CATEGORY_LABEL)].map(([k,l]) => (
                    <button key={k} type="button" onClick={() => setCatFilter(k)}
                      className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors"
                      style={{
                        background: catFilter===k ? V.accent : V.bg3,
                        color:      catFilter===k ? '#fff'   : V.t2,
                      }}>{l}</button>
                  ))}
                </div>

                {/* Shorts strip on home */}
                {tab === 'home' && shorts.length > 0 && (
                  <div className="mb-2">
                    <div className="flex items-center justify-between px-4 py-2">
                      <p className="text-xs font-bold uppercase tracking-wider" style={{ color:V.t2 }}>Sky Shorts</p>
                      <button type="button" onClick={() => setTab('shorts')}
                        className="text-xs font-semibold" style={{ color:V.accent }}>Смотреть все →</button>
                    </div>
                    <div className="flex gap-2.5 px-4 overflow-x-auto pb-1" style={{ scrollbarWidth:'none' }}>
                      {shorts.slice(0,5).map((v,i) => {
                        const [g1,g2] = v.thumbnailGrad ?? getVideoGrad(v.id);
                        return (
                          <motion.div key={v.id} whileTap={{ scale:0.95 }}
                            className="shrink-0 overflow-hidden rounded-xl cursor-pointer relative"
                            style={{ width:72, height:128, background:`linear-gradient(160deg,${g1},${g2})` }}
                            onClick={() => setActiveShort(i)}>
                            {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover"/>}
                            <div className="absolute bottom-0 left-0 right-0 px-1.5 pb-1.5 pt-4"
                              style={{ background:'linear-gradient(transparent,rgba(0,0,0,0.75))' }}>
                              <p className="text-[9px] font-semibold text-white line-clamp-2 leading-tight">{v.title}</p>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Videos grid */}
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Play size={40} style={{ color:V.t3 }}/>
                    <p className="text-sm font-semibold" style={{ color:V.t2 }}>
                      {searchQuery ? 'Ничего не найдено' : 'Нет видео'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-5 px-4 py-3">
                    {filtered.map(v => (
                      <VideoCard key={v.id} video={v} onClick={() => setActiveVideo(v)}/>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SHORTS */}
            {tab === 'shorts' && (
              <div>
                {shorts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Play size={40} style={{ color:V.t3 }}/>
                    <p className="text-sm" style={{ color:V.t2 }}>Нет Shorts</p>
                  </div>
                ) : (
                  <ShortsPreview shorts={shorts} onOpen={setActiveShort}/>
                )}
              </div>
            )}

            {/* UPLOAD */}
            {tab === 'history' && (
              <div className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth:'none' }}>
                <p className="px-4 pt-3 pb-2 text-xs font-semibold uppercase tracking-wider" style={{ color:'rgba(255,255,255,0.35)' }}>
                  История просмотров
                </p>
                {getHistory(myId ?? '').length === 0
                  ? <div className="flex flex-col items-center gap-2 py-12 opacity-50">
                      <span className="text-4xl">🕐</span>
                      <p className="text-sm" style={{ color:'rgba(255,255,255,0.5)' }}>История пуста</p>
                    </div>
                  : getHistory(myId ?? '').map(v => (
                    <button key={v.id} type="button" onClick={() => setActiveVideo(v)}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors w-full text-left">
                      <div className="h-16 w-28 rounded-xl shrink-0 overflow-hidden"
                        style={{ background: `linear-gradient(135deg,${v.thumbnailGrad?.[0]??'#1a1a2e'},${v.thumbnailGrad?.[1]??'#16213e'})` }}>
                        {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="w-full h-full object-cover"/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate text-white">{v.title}</p>
                        <p className="text-xs mt-0.5 truncate" style={{ color:'rgba(255,255,255,0.45)' }}>
                          {v.uploaderName} · {v.views.toLocaleString('ru')} просм.
                        </p>
                      </div>
                    </button>
                  ))
                }
              </div>
            )}
            {tab === 'saved' && (
              <div className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth:'none' }}>
                <p className="px-4 pt-3 pb-2 text-xs font-semibold uppercase tracking-wider" style={{ color:'rgba(255,255,255,0.35)' }}>
                  Сохранённые видео
                </p>
                {getSaved(myId ?? '').length === 0
                  ? <div className="flex flex-col items-center gap-2 py-12 opacity-50">
                      <span className="text-4xl">🔖</span>
                      <p className="text-sm" style={{ color:'rgba(255,255,255,0.5)' }}>Нет сохранённых</p>
                    </div>
                  : getSaved(myId ?? '').map(v => (
                    <button key={v.id} type="button" onClick={() => setActiveVideo(v)}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors w-full text-left">
                      <div className="h-16 w-28 rounded-xl shrink-0 overflow-hidden"
                        style={{ background: `linear-gradient(135deg,${v.thumbnailGrad?.[0]??'#1a1a2e'},${v.thumbnailGrad?.[1]??'#16213e'})` }}>
                        {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="w-full h-full object-cover"/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate text-white">{v.title}</p>
                        <p className="text-xs mt-0.5" style={{ color:'rgba(255,255,255,0.45)' }}>
                          {v.uploaderName}
                        </p>
                      </div>
                      <button type="button" onClick={e => { e.stopPropagation(); unsaveVideo(myId??'',v.id); }}
                        className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10 shrink-0">
                        <span style={{ fontSize:16 }}>🗑</span>
                      </button>
                    </button>
                  ))
                }
              </div>
            )}

            {tab === 'upload' && (
              <UploadTab onDone={() => setTab('home')}/>
            )}

            {tab === 'studio' && <StudioTab/>}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  </div>
  );
};
