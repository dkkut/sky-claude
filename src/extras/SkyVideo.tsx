/* ===============================================================
   SKY VIDEO  -  видеохостинг и Shorts на сервере
   Dark Sky aesthetic, Nunito/system font, accent #4f6ef7
=============================================================== */
import { VerifiedBadge } from '@/verification/marks';
import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { MobileVideoGestures } from '@/interface/mobile/MobileVideoGestures';
import { useModerationStore } from '@/shared/moderationStore';
import { BlockedChannelBadge } from '@/shared/ContentWarningGate';
import {
  Play, Pause, Volume2, VolumeX, Maximize2, ThumbsUp,
  MessageCircle, Share2, Upload, Search, X, ChevronLeft, MoreVertical,
  Trash2, Plus, Check, ArrowUp, ArrowDown, Heart,
  Image as ImageIcon, DollarSign, Clock3,
} from 'lucide-react';
import { AiVideoSummarize, AiVideoQA } from '@/ai/SkyAI';
import { AdBanner } from '@/feedback/Feedback';
import { PrerollAd } from '@/ads/AdBlocks';
import { useSkyVideoStore, resetSkyVideoForUser } from '@/video/serverStore';
import { ChannelAnalyticsView } from '@/video/ChannelAnalytics';
import { useRegisterMedia } from '@/island/mediaRegistry';
import { videoUrl, thumbnailUrl, fmtDuration, readVideoMeta, apiSkyVideoTicket, type ServerVideo, type VideoComment } from '@/video/skyVideoApi';
import { reloadWithFreshTicket } from '@/core/mediaTicketRefresh';
import {
  apiSkyVideoComments, apiAddSkyVideoComment, apiDeleteSkyVideoComment,
  apiSkyVideoChannels, apiSkyVideoChannel, type ChannelListEntry, type ChannelInfo,
} from '@/video/skyVideoApi';
import { useAuthStore } from '@/core/auth/store';
import { openProfile } from '@/profile/viewer/store';
import { useSocialGraph } from '@/profile/viewer/social';
import { useModuleStore } from '@/data/state/modules';
import { ACCEPT_VIDEO, ACCEPT_IMAGE } from '@/shared/fileAccept';

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
  amber:   'var(--amber)',
};

const isShortVideo = (v: ServerVideo) => Boolean(v.height && v.width && v.height >= v.width);

const fmtViews = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

const fmtAgo = (iso?: string) => {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  if (d < 3600000) return `${Math.max(0, Math.floor(d / 60000))} мин назад`;
  if (d < 86400000) return `${Math.floor(d / 3600000)} ч назад`;
  if (d < 2592000000) return `${Math.floor(d / 86400000)} дн назад`;
  return `${Math.floor(d / 2592000000)} мес назад`;
};

/* -- Thumbnail ----------------------------------------------- */
const gradFor = (id: string): [string, string] => {
  const GRADS: [string, string][] = [
    ['#0d1422', '#1a3a5c'], ['#1a0533', '#4f2e8a'], ['#0f2417', '#1a7a43'],
    ['#1f0e0e', '#8a1a1a'], ['#0a1628', '#1e4080'], ['#1a1a0e', '#6b5a00'],
    ['#0e1a1a', '#006b5a'], ['#1a0e1a', '#6b006b'],
  ];
  const h = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return GRADS[h % GRADS.length];
};

const Thumbnail = ({ video, size = 'md' }: { video: ServerVideo; size?: 'sm' | 'md' | 'lg' }) => {
  const [g1, g2] = gradFor(video.id);
  const h = size === 'sm' ? 70 : size === 'lg' ? 180 : 110;
  return (
    <div className="relative overflow-hidden rounded-xl shrink-0" style={{ width: '100%', height: h, background: `linear-gradient(160deg,${g1},${g2})` }}>
      {video.hasThumbnail && <img src={thumbnailUrl(video.id)} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      <div className="absolute bottom-1.5 right-1.5 rounded-md px-1.5 py-0.5"
        style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: 'DM Mono,monospace' }}>{fmtDuration(video.duration)}</span>
      </div>
      {isShortVideo(video) && (
        <div className="absolute top-1.5 left-1.5 rounded-full px-1.5 py-0.5"
          style={{ background: `${V.accent}cc`, fontSize: 9, fontWeight: 700, color: '#fff' }}>
          SHORT
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
        style={{ background: 'rgba(0,0,0,0.35)' }}>
        <div className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <Play size={18} className="text-white ml-0.5" />
        </div>
      </div>
    </div>
  );
};

/* -- Avatar --------------------------------------------------- */
const Avatar = ({ name, size = 32, avatar }: { name: string; size?: number; avatar?: string | null }) => {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  if (avatar) {
    return <img src={avatar} alt="" className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }} />;
  }
  return (
    <div className="shrink-0 grid place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38,
        background: `linear-gradient(135deg,hsl(${hue},65%,42%),hsl(${(hue + 40) % 360},70%,36%))` }}>
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  );
};

/* -- Subscribe button (реальная подписка на автора канала) ----- */
const SubscribeButton = ({ targetId }: { targetId?: string }) => {
  const currentUserId = useAuthStore(s => s.currentUserId);
  const isFollowing = useSocialGraph(s => targetId ? s.isFollowing(currentUserId ?? '', targetId) : false);
  const toggleFollow = useSocialGraph(s => s.toggleFollow);
  const fetchFollows = useSocialGraph(s => s.fetchFollows);
  useEffect(() => { if (targetId) void fetchFollows(targetId); }, [targetId, fetchFollows]);
  if (!currentUserId || !targetId || currentUserId === targetId) return null;
  return (
    <motion.button whileTap={{ scale: 0.95 }} type="button"
      onClick={() => toggleFollow(currentUserId, targetId)}
      className="px-4 py-2 rounded-full text-xs font-bold"
      style={{ background: isFollowing ? 'var(--bg-l2)' : 'var(--accent)', color: isFollowing ? 'var(--t1)' : '#fff' }}>
      {isFollowing ? 'Вы подписаны' : 'Подписаться'}
    </motion.button>
  );
};

/* -- Video Card (grid) --------------------------------------- */
const VideoCard = ({ video, onClick, onOpenChannel }: { video: ServerVideo; onClick: () => void; onOpenChannel?: (authorId: string) => void }) => {
  const isBlocked = useModerationStore(s => (video.own || !video.authorId) ? false : s.isBlocked('video-channel', video.authorId));
  if (isBlocked) return <div className="mb-2.5"><BlockedChannelBadge size="sm" /></div>;
  return (
    <motion.div className="cursor-pointer" whileTap={{ scale: 0.97 }} onClick={onClick}>
      <div className="mb-2.5"><Thumbnail video={video} size="md" /></div>
      <div className="flex gap-2.5">
        <span onClick={e => { e.stopPropagation(); if (video.authorId) (onOpenChannel ?? openProfile)(video.authorId); }}>
          <Avatar name={video.authorName ?? '?'} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug line-clamp-2" style={{ color: V.t1 }}>{video.title}</p>
          <p className="text-xs mt-1 cursor-pointer" style={{ color: V.t2 }}
            onClick={e => { e.stopPropagation(); if (video.authorId) (onOpenChannel ?? openProfile)(video.authorId); }}>{video.authorName}<VerifiedBadge type="video_channel" id={video.authorId} size={12} /></p>
          <p className="text-xs" style={{ color: V.t3 }}>
            {fmtViews(video.views)} просм. · {fmtAgo(video.publishedAt ?? video.createdAt)}
          </p>
        </div>
      </div>
    </motion.div>
  );
};

const openSkyVideo = () => useModuleStore.getState().setActiveModule('video');

/* -- Custom Video Player --------------------------------------- */
const VideoPlayer = ({ video }: { video: ServerVideo }) => {
  const vidRef = useRef<HTMLVideoElement>(null);
  const isMobile = useIsMobile();
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showCtrl, setShowCtrl] = useState(true);
  const [failed, setFailed] = useState(false);
  const [adDone, setAdDone] = useState(false);          // реклама перед роликом: показывает сервер (не Prime, не чаще паузы), ролик ждёт
  const passTried = useRef(false);
  const hideTimer = useRef<number>(0);
  const noteView = useSkyVideoStore(s => s.noteView);
  useRegisterMedia(vidRef, { id: video.id, kind: 'video', title: video.title, subtitle: video.authorName ?? '', cover: video.hasThumbnail ? thumbnailUrl(video.id) : undefined, canSeek: true, open: openSkyVideo });

  useEffect(() => {
    noteView(video.id);
    return () => { vidRef.current?.pause(); };
  }, [video.id]);
  useEffect(() => { setAdDone(false); }, [video.id]);     // следующий ролик — снова решение сервера, показывать ли рекламу

  const resetHide = () => {
    setShowCtrl(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => playing && setShowCtrl(false), 2800);
  };

  const toggle = () => {
    const v = vidRef.current; if (!v) return;
    if (v.paused) { v.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); } else { v.pause(); setPlaying(false); }
    resetHide();
  };

  const fmtS = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const isShort = isShortVideo(video);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl select-none"
      style={{ background: '#000', aspectRatio: isShort ? '9/16' : '16/9', maxHeight: isShort ? 420 : undefined }}
      onMouseMove={resetHide} onClick={adDone ? toggle : undefined}>
      {!adDone && <PrerollAd key={video.id} onSkip={() => setAdDone(true)} />}
      <video ref={vidRef} src={adDone ? videoUrl(video.id) : undefined} className="w-full h-full object-contain"
        onTimeUpdate={e => setProgress((e.currentTarget.currentTime / e.currentTarget.duration) || 0)}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} playsInline
        onPlaying={() => { passTried.current = false; setFailed(false); }}
        onError={() => {
          // Без этого обработчика ролик, который не открылся, оставался
          // чёрным квадратом без единого объяснения. Сначала один раз
          // обновляем пропуск (он мог просто протухнуть), потом честно
          // говорим, что файл не открылся.
          const v = vidRef.current;
          if (v && !passTried.current) {
            passTried.current = true;
            void reloadWithFreshTicket(v, apiSkyVideoTicket, () => videoUrl(video.id)).then((ok) => { if (!ok) setFailed(true); });
            return;
          }
          setFailed(true); setPlaying(false);
        }} />
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
          style={{ background: 'rgba(0,0,0,0.82)' }} onClick={e => e.stopPropagation()}>
          <p className="text-sm font-bold text-white">Видео не удалось загрузить</p>
          <button className="rounded-full px-4 py-2 text-xs font-bold"
            style={{ background: 'rgba(255,255,255,0.14)', color: '#fff' }}
            onClick={() => {
              const v = vidRef.current; if (!v) return;
              passTried.current = false; setFailed(false);
              void reloadWithFreshTicket(v, apiSkyVideoTicket, () => videoUrl(video.id)).then((ok) => {
                if (ok) v.play().catch(() => {}); else setFailed(true);
              });
            }}>Повторить</button>
        </div>
      )}
      {isMobile && (
        <MobileVideoGestures videoRef={vidRef} onSingleTap={toggle} />
      )}
      <AnimatePresence>
        {showCtrl && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col justify-between"
            style={{ background: 'linear-gradient(transparent 40%,rgba(0,0,0,0.7))' }}
            onClick={e => e.stopPropagation()}>
            <div />
            <div className="flex items-center justify-center" onClick={toggle}>
              <motion.div key={playing ? 'p' : 'pa'} initial={{ scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                className="grid h-14 w-14 place-items-center rounded-full"
                style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
                {playing ? <Pause size={24} className="text-white" /> : <Play size={24} className="text-white ml-1" />}
              </motion.div>
            </div>
            <div className="px-3 pb-3" onClick={e => e.stopPropagation()}>
              <div className="h-1 w-full rounded-full mb-2.5 cursor-pointer relative group"
                style={{ background: 'rgba(255,255,255,0.25)' }}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientX - r.left) / r.width;
                  if (vidRef.current) vidRef.current.currentTime = pct * duration;
                }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${progress * 100}%`, background: V.accent }} />
                <div className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  style={{ left: `${progress * 100}%`, background: '#fff', transform: 'translateX(-50%) translateY(-50%)' }} />
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={toggle} className="grid h-7 w-7 place-items-center text-white">
                  {playing ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button type="button" onClick={() => { setMuted(m => !m); if (vidRef.current) vidRef.current.muted = !muted; }}
                  className="grid h-7 w-7 place-items-center text-white">
                  {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <span className="text-xs text-white" style={{ fontFamily: 'DM Mono,monospace' }}>
                  {fmtS(duration * progress)} / {fmtS(duration)}
                </span>
                <div className="ml-auto">
                  <button type="button" onClick={() => vidRef.current?.requestFullscreen()}
                    className="grid h-7 w-7 place-items-center text-white">
                    <Maximize2 size={15} />
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
const VideoView = ({ video, onBack, onOpenChannel }: { video: ServerVideo; onBack: () => void; onOpenChannel?: (authorId: string) => void }) => {
  const { toggleLiked, removeVideo, requestMonetization } = useSkyVideoStore();
  const { currentUserId } = useAuthStore();
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [comment, setComment] = useState('');
  const [showDel, setShowDel] = useState(false);
  const [monetizing, setMonetizing] = useState(false);
  const [monetizeMsg, setMonetizeMsg] = useState<string | null>(null);

  const isOwner = video.own === true;

  useEffect(() => {
    let live = true;
    apiSkyVideoComments(video.id).then(list => { if (live && list) setComments(list); });
    return () => { live = false; };
  }, [video.id]);

  const handleComment = async () => {
    const t = comment.trim();
    if (!t) return;
    const id = await apiAddSkyVideoComment(video.id, t);
    if (!id) return;
    setComments(c => [...c, { id, authorId: currentUserId ?? undefined, authorName: 'Вы', body: t, createdAt: new Date().toISOString() }]);
    setComment('');
  };

  const handleDeleteComment = async (id: string) => {
    if (!(await apiDeleteSkyVideoComment(id))) return;
    setComments(c => c.filter(x => x.id !== id));
  };

  const requestMonetize = async () => {
    setMonetizing(true);
    const res = await requestMonetization(video.id);
    setMonetizing(false);
    setMonetizeMsg(res.ok ? 'Заявка отправлена на проверку' : (res.reason ?? 'Не получилось'));
  };

  const { isBlocked, blockReason } = useModerationStore();
  const channelBlocked = !isOwner && Boolean(video.authorId) && isBlocked('video-channel', video.authorId!);

  if (channelBlocked) {
    return (
      <div className="flex h-full flex-col" style={{ background: V.bg }}>
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${V.border}` }}>
          <button type="button" onClick={onBack} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
            <ChevronLeft size={20} style={{ color: V.t2 }} />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <BlockedChannelBadge reason={blockReason('video-channel', video.authorId!)} />
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="flex flex-col h-full overflow-y-auto" style={{ background: V.bg, scrollbarWidth: 'none' }}>
      <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${V.border}` }}>
        <button type="button" onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/5">
          <ChevronLeft size={20} style={{ color: V.t2 }} />
        </button>
        <p className="text-sm font-semibold line-clamp-1 flex-1" style={{ color: V.t1 }}>{video.title}</p>
        {isOwner && (
          <button type="button" onClick={() => setShowDel(s => !s)}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
            <MoreVertical size={16} style={{ color: V.t2 }} />
          </button>
        )}
      </div>

      <div className="flex-1 px-4 py-4 space-y-4">
        <AnimatePresence>
          {showDel && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="rounded-2xl p-4 flex items-center gap-3"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
              <p className="text-sm flex-1" style={{ color: V.t1 }}>Удалить это видео?</p>
              <button type="button" onClick={() => { removeVideo(video.id); onBack(); }}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold"
                style={{ background: 'rgba(248,113,113,0.2)', color: V.red }}>Удалить</button>
              <button type="button" onClick={() => setShowDel(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold"
                style={{ background: V.bg3, color: V.t2 }}>Отмена</button>
            </motion.div>
          )}
        </AnimatePresence>

        <VideoPlayer video={video} />

        <div>
          <h1 className="text-base font-bold leading-snug" style={{ color: V.t1 }}>{video.title}</h1>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap" style={{ color: V.t3, fontSize: 12 }}>
            <span>{fmtViews(video.views)} просмотров</span>
            <span>·</span><span>{fmtAgo(video.publishedAt ?? video.createdAt)}</span>
            <span className="rounded-full px-2 py-0.5" style={{ background: V.bg3, fontSize: 10, color: V.t2 }}>
              {video.category}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 py-3" style={{ borderTop: `1px solid ${V.border}`, borderBottom: `1px solid ${V.border}` }}>
          <button type="button" onClick={() => video.authorId && (onOpenChannel ?? openProfile)(video.authorId)}>
            <Avatar name={video.authorName ?? '?'} size={40} />
          </button>
          <button type="button" onClick={() => video.authorId && (onOpenChannel ?? openProfile)(video.authorId)} className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold" style={{ color: V.t1 }}>{video.authorName}</p>
            <p className="text-xs" style={{ color: V.t3 }}>Открыть канал</p>
          </button>
          <SubscribeButton targetId={video.authorId} />
        </div>

        <div className="flex gap-2">
          <motion.button whileTap={{ scale: 0.92 }} type="button"
            onClick={() => toggleLiked(video.id)}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors"
            style={{
              background: video.liked ? `${V.accent}20` : V.bg3,
              border: `1px solid ${video.liked ? V.accent + '60' : V.border2}`,
              color: video.liked ? V.accent : V.t1,
            }}>
            <ThumbsUp size={15} />{video.likes}
          </motion.button>
          <button type="button" className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
            style={{ background: V.bg3, border: `1px solid ${V.border2}`, color: V.t1 }}>
            <Share2 size={15} />Поделиться
          </button>
        </div>

        {isOwner && (
          <div className="rounded-2xl p-4 space-y-2" style={{ background: `${V.amber}0c`, border: `1px solid ${V.amber}30` }}>
            <div className="flex items-center gap-2">
              <DollarSign size={15} style={{ color: V.amber }} />
              <p className="text-sm font-semibold" style={{ color: V.t1 }}>Монетизация</p>
            </div>
            {video.monetizationStatus === 'none' && video.status === 'published' && (
              <button type="button" onClick={requestMonetize} disabled={monetizing}
                className="rounded-xl px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                style={{ background: V.amber }}>
                {monetizing ? 'Отправка...' : 'Подать заявку'}
              </button>
            )}
            {video.monetizationStatus === 'pending' && (
              <p className="text-xs flex items-center gap-1.5" style={{ color: V.t2 }}><Clock3 size={12} />Заявка на проверке</p>
            )}
            {video.monetizationStatus === 'approved' && (
              <p className="text-xs" style={{ color: V.green }}>Монетизация одобрена</p>
            )}
            {video.monetizationStatus === 'rejected' && (
              <p className="text-xs" style={{ color: V.red }}>Заявка отклонена</p>
            )}
            {monetizeMsg && <p className="text-[11px]" style={{ color: V.t3 }}>{monetizeMsg}</p>}
          </div>
        )}

        {video.description && (
          <div className="rounded-2xl p-4 space-y-2" style={{ background: V.bg2 }}>
            <p className="text-sm leading-relaxed" style={{ color: V.t2 }}>{video.description}</p>
            <AiVideoSummarize title={video.title} description={video.description} duration={fmtDuration(video.duration)} tags={video.tags} category={video.category} />
            <AiVideoQA title={video.title} description={video.description} duration={fmtDuration(video.duration)} tags={video.tags} category={video.category} />
            {video.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {video.tags.map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: `${V.accent}15`, color: V.accent }}>#{t}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <p className="text-sm font-semibold mb-3" style={{ color: V.t1 }}>
            Комментарии · {comments.length}
          </p>
          <div className="flex gap-3 mb-4">
            <Avatar name="Вы" />
            <div className="flex-1 flex gap-2">
              <input value={comment} onChange={e => setComment(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleComment()}
                placeholder="Напишите комментарий..."
                className="flex-1 rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: V.bg2, border: `1px solid ${V.border}`, color: V.t1 }} />
              <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={handleComment}
                disabled={!comment.trim()}
                className="grid h-9 w-9 place-items-center rounded-xl"
                style={{ background: comment.trim() ? V.accent : V.bg3, color: '#fff' }}>
                <Plus size={16} />
              </motion.button>
            </div>
          </div>
          <div className="space-y-4">
            {comments.map(c => (
              <div key={c.id} className="flex gap-3">
                <Avatar name={c.authorName ?? '?'} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold" style={{ color: V.t1 }}>{c.authorName}</span>
                    <span className="text-[10px]" style={{ color: V.t3 }}>{fmtAgo(c.createdAt)}</span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: V.t2 }}>{c.body}</p>
                  {(c.authorId === currentUserId || isOwner) && (
                    <button type="button" onClick={() => handleDeleteComment(c.id)}
                      className="text-[11px] font-semibold mt-1.5" style={{ color: V.t3 }}>Удалить</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

/* -- Shorts Player --------------------------------------------- */
const ShortsPlayer = ({ shorts, initialIndex = 0, onClose, onOpenChannel }: { shorts: ServerVideo[]; initialIndex?: number; onClose: () => void; onOpenChannel?: (authorId: string) => void }) => {
  const [idx, setIdx] = useState(initialIndex);
  const [playing, setPlaying] = useState(true);
  const vidRef = useRef<HTMLVideoElement>(null);
  const { toggleLiked, noteView } = useSkyVideoStore();

  const video = shorts[idx];

  useEffect(() => {
    noteView(video.id);
    if (vidRef.current) {
      vidRef.current.currentTime = 0;
      if (playing) vidRef.current.play().catch(() => {});
    }
  }, [idx]);

  const prev = () => idx > 0 && setIdx(i => i - 1);
  const next = () => idx < shorts.length - 1 && setIdx(i => i + 1);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: '#000' }}>
      <button type="button" onClick={onClose}
        className="absolute top-4 left-4 z-10 grid h-10 w-10 place-items-center rounded-full"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
        <X size={20} className="text-white" />
      </button>

      <div className="absolute top-4 right-4 z-10 rounded-full px-3 py-1"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: 'DM Mono,monospace' }}>
        {idx + 1} / {shorts.length}
      </div>

      <div className="relative w-full max-w-sm h-full flex items-center justify-center"
        onClick={() => {
          if (vidRef.current?.paused) { vidRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
          else { vidRef.current?.pause(); setPlaying(false); }
        }}>
        <video ref={vidRef} src={videoUrl(video.id)} loop playsInline autoPlay
          className="max-h-full max-w-full object-contain"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onError={() => {
            const v = vidRef.current;
            if (v) void reloadWithFreshTicket(v, apiSkyVideoTicket, () => videoUrl(video.id));
          }} />

        <AnimatePresence>
          {!playing && (
            <motion.div initial={{ scale: 1.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="grid h-16 w-16 place-items-center rounded-full"
                style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
                <Play size={28} className="text-white ml-1" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute bottom-0 left-0 right-0 px-4 pb-6 pt-16"
          style={{ background: 'linear-gradient(transparent,rgba(0,0,0,0.75))' }}
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2 mb-2">
            <button type="button" onClick={() => video.authorId && (onOpenChannel ?? openProfile)(video.authorId)}>
              <Avatar name={video.authorName ?? '?'} size={28} />
            </button>
            <button type="button" onClick={() => video.authorId && (onOpenChannel ?? openProfile)(video.authorId)}
              className="text-sm font-semibold text-white">{video.authorName}</button>
            <SubscribeButton targetId={video.authorId} />
          </div>
          <p className="text-sm text-white font-medium mb-1">{video.title}</p>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>{fmtViews(video.views)} просм.</p>
        </div>

        <div className="absolute right-3 bottom-24 flex flex-col items-center gap-5"
          onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => toggleLiked(video.id)}
            className="flex flex-col items-center gap-1">
            <motion.div whileTap={{ scale: 1.3 }} className="grid h-10 w-10 place-items-center rounded-full"
              style={{ background: video.liked ? 'rgba(79,110,247,0.3)' : 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)' }}>
              <Heart size={22} style={{ color: video.liked ? V.accent : '#fff', fill: video.liked ? V.accent : 'none' }} />
            </motion.div>
            <span className="text-xs text-white">{video.likes}</span>
          </button>
          <button type="button" className="flex flex-col items-center gap-1">
            <div className="grid h-10 w-10 place-items-center rounded-full"
              style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)' }}>
              <MessageCircle size={22} className="text-white" />
            </div>
            <span className="text-xs text-white">{video.commentCount ?? 0}</span>
          </button>
          <button type="button" className="flex flex-col items-center gap-1">
            <div className="grid h-10 w-10 place-items-center rounded-full"
              style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)' }}>
              <Share2 size={20} className="text-white" />
            </div>
            <span className="text-xs text-white">Поделиться</span>
          </button>
        </div>
      </div>

      {idx > 0 && (
        <button type="button" onClick={prev}
          className="absolute top-1/2 -translate-y-1/2 left-3 grid h-10 w-10 place-items-center rounded-full z-10"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)' }}>
          <ArrowUp size={20} className="text-white" />
        </button>
      )}
      {idx < shorts.length - 1 && (
        <button type="button" onClick={next}
          className="absolute top-1/2 -translate-y-1/2 right-3 grid h-10 w-10 place-items-center rounded-full z-10"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)' }}>
          <ArrowDown size={20} className="text-white" />
        </button>
      )}

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
        {shorts.map((_, i) => (
          <button key={i} type="button" onClick={() => setIdx(i)}
            className="rounded-full transition-all"
            style={{ width: i === idx ? 20 : 6, height: 6, background: i === idx ? V.accent : 'rgba(255,255,255,0.3)' }} />
        ))}
      </div>
    </motion.div>
  );
};

/* -- Мои видео (черновики и опубликованное) --------------------- */
const MineTab = ({ onOpen }: { onOpen: (v: ServerVideo) => void }) => {
  const { mine, publish, removeVideo } = useSkyVideoStore();
  const drafts = mine.filter(v => v.status === 'draft');
  const published = mine.filter(v => v.status === 'published' || v.status === 'hidden');

  return (
    <div className="overflow-y-auto h-full px-4 py-4 space-y-6" style={{ scrollbarWidth: 'none' }}>
      {drafts.length > 0 && (
        <div>
          <p className="text-sm font-bold mb-3" style={{ color: V.t1 }}>Черновики ({drafts.length})</p>
          <div className="space-y-2">
            {drafts.map(v => (
              <div key={v.id} className="rounded-2xl p-3 flex items-center gap-3" style={{ background: V.bg1, border: `1px solid ${V.border}` }}>
                {/* Черновик нужно уметь открыть: иначе загруженный ролик нельзя
                    проверить до публикации, и «видео не включается» не
                    отличить от «я его просто не могу посмотреть». */}
                <div className="w-24 shrink-0 cursor-pointer" onClick={() => onOpen(v)}><Thumbnail video={v} size="sm" /></div>
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onOpen(v)}>
                  <p className="text-sm font-semibold truncate" style={{ color: V.t1 }}>{v.title || 'Без названия'}</p>
                  <p className="text-[11px]" style={{ color: V.t3 }}>{fmtDuration(v.duration)}</p>
                </div>
                <button type="button" onClick={() => publish(v.id, true)}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white shrink-0" style={{ background: V.accent }}>Опубликовать</button>
                <button type="button" onClick={() => removeVideo(v.id)}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold shrink-0" style={{ background: V.bg2, color: V.red }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-bold mb-3" style={{ color: V.t1 }}>Опубликовано ({published.length})</p>
        {published.length === 0 ? (
          <p className="text-xs text-center py-6" style={{ color: V.t3 }}>Пока нет опубликованных видео</p>
        ) : (
          <div className="space-y-2">
            {published.map(v => (
              <div key={v.id} className="rounded-2xl p-3" style={{ background: V.bg1, border: `1px solid ${V.border}` }}>
                <p className="text-sm font-semibold truncate mb-1.5 cursor-pointer" style={{ color: V.t1 }} onClick={() => onOpen(v)}>{v.title}</p>
                <div className="flex items-center gap-3 text-[11px]" style={{ color: V.t3 }}>
                  <span>{fmtViews(v.views)} просм.</span>
                  <span><ThumbsUp size={11} className="inline mr-0.5" /> {v.likes}</span>
                  <span className="ml-auto">{v.status === 'hidden' ? 'Скрыто' : fmtAgo(v.publishedAt)}</span>
                </div>
                <div className="flex gap-2 mt-2">
                  <button type="button" onClick={() => publish(v.id, v.status !== 'published')}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-bold" style={{ background: V.bg2, color: V.t2 }}>
                    {v.status === 'published' ? 'Скрыть' : 'Опубликовать'}
                  </button>
                  <button type="button" onClick={() => removeVideo(v.id)}
                    className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold" style={{ background: V.bg2, color: V.red }}><Trash2 size={12} /></button>
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
  const { upload, setThumbnail } = useSkyVideoStore();

  const [file, setFile] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | undefined>();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState<string>('Другое');
  const [tags, setTags] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [publishNow, setPublishNow] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const categoriesFromStore = useSkyVideoStore(s => s.categories);

  useEffect(() => { setCategories(categoriesFromStore); }, [categoriesFromStore]);

  const handleFile = (f: File) => {
    setFile(f);
    setError(null);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async () => {
    if (!file || !title.trim()) return;
    setLoading(true); setProgress(0); setError(null);
    const meta = await readVideoMeta(file);
    const { promise } = upload(file, {
      title: title.trim(), description: desc.trim(), category: cat, tags,
      duration: meta.duration, width: meta.width, height: meta.height,
    }, setProgress);
    const res = await promise;
    if (!res.ok || !res.id) { setLoading(false); setError(res.reason ?? 'Не получилось'); return; }
    if (cover) await setThumbnail(res.id, cover);
    if (publishNow) {
      const { publish } = useSkyVideoStore.getState();
      await publish(res.id, true);
    }
    setLoading(false);
    onDone();
  };

  const iSty = { background: V.bg2, border: `1px solid ${V.border}`, color: V.t1 };
  const iCls = 'w-full rounded-2xl px-4 py-2.5 text-sm outline-none';

  return (
    <div className="overflow-y-auto h-full px-4 py-4 space-y-4" style={{ scrollbarWidth: 'none' }}>
      <div className="flex items-center gap-3 mb-2">
        <div className="grid h-10 w-10 place-items-center rounded-2xl"
          style={{ background: `${V.accent}20`, border: `1px solid ${V.accent}35` }}>
          <Upload size={18} style={{ color: V.accent }} />
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: V.t1 }}>Загрузить видео</p>
          <p className="text-xs" style={{ color: V.t3 }}>MP4, WebM, AVI, OGV</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(248,113,113,0.1)', color: V.red }}>{error}</div>
      )}

      <div className="rounded-2xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-3 py-8 transition-colors"
        style={{ borderColor: file ? V.accent : V.border2, background: file ? `${V.accent}06` : 'transparent' }}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); }}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
        <input ref={fileRef} type="file" accept={ACCEPT_VIDEO} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        <div className="grid h-14 w-14 place-items-center rounded-2xl"
          style={{ background: file ? `${V.accent}20` : V.bg3 }}>
          {file ? <Check size={28} style={{ color: V.accent }} /> : <Upload size={28} style={{ color: V.t3 }} />}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: file ? V.accent : V.t2 }}>
            {file ? file.name : 'Нажмите или перетащите файл'}
          </p>
        </div>
      </div>

      {file && (
        <>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название *" className={iCls} style={iSty} />
          <textarea value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Описание (необязательно)" rows={3}
            className={iCls + ' resize-none'} style={iSty} />
          <select value={cat} onChange={e => setCat(e.target.value)} className={iCls} style={{ ...iSty, cursor: 'pointer' }}>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={tags} onChange={e => setTags(e.target.value)}
            placeholder="Теги через запятую" className={iCls} style={iSty} />

          <div className="flex items-center gap-3">
            <input ref={coverRef} type="file" accept={ACCEPT_IMAGE} className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) { setCover(f); setCoverPreview(URL.createObjectURL(f)); }
              }} />
            <button type="button" onClick={() => coverRef.current?.click()}
              className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm transition-colors"
              style={{ background: V.bg2, border: `1px solid ${V.border}`, color: V.t2 }}>
              {cover
                ? <><Check size={15} style={{ color: 'var(--green)' }} /> Обложка</>
                : <><ImageIcon size={15} /> Добавить обложку</>}
            </button>
            {coverPreview && <img src={coverPreview} alt="" className="h-10 w-16 rounded-xl object-cover" />}
          </div>

          {loading && (
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: V.bg3 }}>
              <motion.div className="h-full rounded-full" style={{ background: `linear-gradient(90deg,${V.accent},#818cf8)`, width: `${progress}%` }} transition={{ duration: .3 }} />
            </div>
          )}

          <div className="flex gap-2">
            {([[true, 'Опубликовать'], [false, 'Черновик']] as const).map(([v, l]) => (
              <button key={String(v)} type="button" onClick={() => setPublishNow(v)}
                className="flex-1 rounded-xl py-2 text-xs font-bold transition-colors"
                style={{ background: publishNow === v ? V.accent : V.bg3, color: publishNow === v ? '#fff' : V.t2 }}>
                {l}
              </button>
            ))}
          </div>

          <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={submit}
            disabled={loading || !title.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-40"
            style={{ background: V.accent }}>
            <Upload size={15} />{loading ? `${progress}%...` : publishNow ? 'Опубликовать видео' : 'Сохранить черновик'}
          </motion.button>
        </>
      )}
    </div>
  );
};

/* -- Shorts Grid Preview --------------------------------------- */
const ShortsPreview = ({ shorts, onOpen }: { shorts: ServerVideo[]; onOpen: (i: number) => void }) => (
  <div className="px-4 py-3">
    <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: V.t3 }}>
      Shorts · {shorts.length}
    </p>
    <div className="grid grid-cols-3 gap-2">
      {shorts.map((v, i) => {
        const [g1, g2] = gradFor(v.id);
        return (
          <motion.div key={v.id} whileTap={{ scale: 0.95 }} onClick={() => onOpen(i)}
            className="relative overflow-hidden rounded-xl cursor-pointer"
            style={{ aspectRatio: '9/16', background: `linear-gradient(160deg,${g1},${g2})` }}>
            {v.hasThumbnail && <img src={thumbnailUrl(v.id)} alt="" className="absolute inset-0 w-full h-full object-cover" />}
            <div className="absolute inset-0 flex flex-col justify-end p-2"
              style={{ background: 'linear-gradient(transparent 40%,rgba(0,0,0,0.7))' }}>
              <p className="text-[10px] font-semibold text-white line-clamp-2 leading-tight">{v.title}</p>
              <p className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>{fmtViews(v.views)} просм.</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  </div>
);

/* -- Каналы: список и страница автора --------------------------- */
const ChannelsListView = ({ onOpen }: { onOpen: (authorId: string) => void }) => {
  const [channels, setChannels] = useState<ChannelListEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    apiSkyVideoChannels({ limit: 50 }).then(list => { if (live) setChannels(list ?? []); });
    return () => { live = false; };
  }, []);

  if (channels === null) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm" style={{ color: V.t2 }}>Загрузка…</p>
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Play size={40} style={{ color: V.t3 }} />
        <p className="text-sm font-semibold" style={{ color: V.t2 }}>Пока нет каналов</p>
        <p className="text-xs" style={{ color: V.t3 }}>Каналы появляются, как только у автора выходит первый ролик</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-2">
      {channels.map(c => (
        <motion.div key={c.authorId} whileTap={{ scale: 0.98 }} onClick={() => onOpen(c.authorId)}
          className="flex items-center gap-3 rounded-2xl p-3 cursor-pointer"
          style={{ background: V.bg1, border: `1px solid ${V.border}` }}>
          <Avatar name={c.authorName} avatar={c.avatar} size={44} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: V.t1 }}>{c.authorName}</p>
            <p className="text-xs" style={{ color: V.t3 }}>@{c.authorUsername}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-semibold" style={{ color: V.t2 }}>{c.videoCount} видео</p>
            <p className="text-[11px]" style={{ color: V.t3 }}>{fmtViews(c.totalViews)} просм.</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

type ChTab = 'home' | 'videos' | 'shorts';

const ChannelPage = ({ authorId, onBack, onOpenVideo, initialAnalytics }: {
  authorId: string; onBack: () => void; onOpenVideo: (v: ServerVideo) => void; initialAnalytics?: boolean;
}) => {
  const me = useAuthStore(s => s.currentUserId);
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [videos, setVideos] = useState<ServerVideo[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<ChTab>('videos');
  const [analytics, setAnalytics] = useState(Boolean(initialAnalytics));

  useEffect(() => {
    let live = true;
    setChannel(null); setVideos(null); setNotFound(false);
    apiSkyVideoChannel(authorId, { limit: 100 }).then(r => {
      if (!live) return;
      if (!r) { setNotFound(true); return; }
      setChannel(r.channel);
      setVideos(r.videos);
    });
    return () => { live = false; };
  }, [authorId]);

  const longs = useMemo(() => (videos ?? []).filter(v => !isShortVideo(v)), [videos]);
  const shortsList = useMemo(() => (videos ?? []).filter(v => isShortVideo(v)), [videos]);
  const isOwner = Boolean(me) && me === authorId;

  if (analytics && channel) {
    return <ChannelAnalyticsView name={channel.authorName} avatar={channel.avatar} onBack={() => setAnalytics(false)} onOpenVideo={onOpenVideo} />;
  }

  if (notFound) {
    return (
      <div className="flex h-full flex-col" style={{ background: V.bg }}>
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${V.border}` }}>
          <button type="button" onClick={onBack} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
            <ChevronLeft size={20} style={{ color: V.t2 }} />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm" style={{ color: V.t3 }}>Канал не найден</p>
        </div>
      </div>
    );
  }

  const shortsRow = (list: ServerVideo[]) => (
    <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
      {list.map(v => {
        const [g1, g2] = gradFor(v.id);
        return (
          <motion.div key={v.id} whileTap={{ scale: 0.96 }} onClick={() => onOpenVideo(v)} className="relative shrink-0 cursor-pointer overflow-hidden rounded-xl"
            style={{ width: 118, aspectRatio: '9/16', background: `linear-gradient(160deg,${g1},${g2})` }}>
            {v.hasThumbnail && <img src={thumbnailUrl(v.id)} alt="" className="absolute inset-0 h-full w-full object-cover" />}
            <div className="absolute inset-0 flex flex-col justify-end p-2" style={{ background: 'linear-gradient(transparent 45%,rgba(0,0,0,0.75))' }}>
              <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-white" translate="no">{v.title}</p>
              <p className="mt-0.5 text-[10px]" style={{ color: 'rgba(255,255,255,0.65)' }}>{fmtViews(v.views)} просм.</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  /* Ролик в списке канала: слева превью, справа название и счётчики — как в привычных видеосервисах. */
  const row = (v: ServerVideo) => (
    <motion.div key={v.id} whileTap={{ scale: 0.98 }} onClick={() => onOpenVideo(v)} className="flex cursor-pointer gap-3">
      <div className="w-[44%] shrink-0"><Thumbnail video={v} size="md" /></div>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="line-clamp-3 text-sm font-semibold leading-snug" style={{ color: V.t1 }} translate="no">{v.title}</p>
        <p className="mt-1 text-xs" style={{ color: V.t3 }}>{fmtViews(v.views)} просм. · {fmtAgo(v.publishedAt ?? v.createdAt)}</p>
      </div>
    </motion.div>
  );

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="flex flex-col h-full overflow-y-auto" style={{ background: V.bg, scrollbarWidth: 'none' }}>
      <div className="flex items-center gap-2 px-4 py-3 shrink-0">
        <button type="button" onClick={onBack} aria-label="Назад"
          className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/5">
          <ChevronLeft size={20} style={{ color: V.t2 }} />
        </button>
      </div>

      {channel && (
        <div className="px-4 pb-6 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={channel.authorName} avatar={channel.avatar} size={76} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[22px] font-extrabold" style={{ color: V.t1 }} translate="no">{channel.authorName}<VerifiedBadge type="video_channel" id={channel.authorId} size={18} /></p>
              <p className="text-xs" style={{ color: V.t3 }} translate="no">@{channel.authorUsername}</p>
              <p className="mt-1 text-xs" style={{ color: V.t2 }}>
                {`${fmtViews(channel.subscribers ?? 0)} подписчиков · ${channel.videoCount} видео · ${fmtViews(channel.totalViews)} просмотров`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SubscribeButton targetId={channel.authorId} />
            {isOwner && (
              <button type="button" onClick={() => setAnalytics(true)} className="rounded-full px-4 py-2 text-xs font-bold" style={{ background: V.bg2, color: V.t1 }}>Аналитика</button>
            )}
          </div>

          <div className="flex gap-0.5 overflow-x-auto" style={{ borderBottom: `1px solid ${V.border}`, scrollbarWidth: 'none' }}>
            {([['home', 'Главная'], ['videos', 'Видео'], ['shorts', 'Shorts']] as [ChTab, string][]).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className="relative shrink-0 px-4 py-2.5 text-[13px] font-semibold" style={{ color: tab === k ? V.t1 : V.t3 }}>
                {label}
                {tab === k && <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full" style={{ background: V.t1 }} />}
              </button>
            ))}
          </div>

          {videos === null ? (
            <p className="text-xs text-center py-6" style={{ color: V.t3 }}>Загрузка видео…</p>
          ) : videos.length === 0 ? (
            <p className="text-xs text-center py-6" style={{ color: V.t3 }}>У канала пока нет роликов</p>
          ) : (
            <>
              {tab === 'home' && (
                <div className="space-y-6">
                  {longs.length > 0 && <div className="space-y-4">{longs.slice(0, 4).map(row)}</div>}
                  {longs.length > 4 && <button type="button" onClick={() => setTab('videos')} className="text-xs font-semibold" style={{ color: V.accent }}>{`Все видео (${longs.length})`}</button>}
                  {shortsList.length > 0 && (
                    <div>
                      <p className="mb-2 text-lg font-bold" style={{ color: V.t1 }}>Shorts</p>
                      {shortsRow(shortsList)}
                    </div>
                  )}
                </div>
              )}
              {tab === 'videos' && (longs.length ? <div className="space-y-4">{longs.map(row)}</div> : <p className="text-xs text-center py-6" style={{ color: V.t3 }}>Обычных видео пока нет</p>)}
              {tab === 'shorts' && (shortsList.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {shortsList.map(v => {
                    const [g1, g2] = gradFor(v.id);
                    return (
                      <motion.div key={v.id} whileTap={{ scale: 0.96 }} onClick={() => onOpenVideo(v)} className="relative cursor-pointer overflow-hidden rounded-xl"
                        style={{ aspectRatio: '9/16', background: `linear-gradient(160deg,${g1},${g2})` }}>
                        {v.hasThumbnail && <img src={thumbnailUrl(v.id)} alt="" className="absolute inset-0 h-full w-full object-cover" />}
                        <div className="absolute inset-0 flex flex-col justify-end p-2" style={{ background: 'linear-gradient(transparent 45%,rgba(0,0,0,0.75))' }}>
                          <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-white" translate="no">{v.title}</p>
                          <p className="mt-0.5 text-[10px]" style={{ color: 'rgba(255,255,255,0.65)' }}>{fmtViews(v.views)} просм.</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              ) : <p className="text-xs text-center py-6" style={{ color: V.t3 }}>Shorts пока нет</p>)}
            </>
          )}
        </div>
      )}
    </motion.div>
  );
};

type VTab = 'home' | 'shorts' | 'upload' | 'mine' | 'channels';

export const SkyVideo = () => {
  const { feed, categories, load, search } = useSkyVideoStore();
  const { currentUserId } = useAuthStore();
  const pendingVideoTab = useModuleStore(s => s.pendingVideoTab);
  const setPendingVideoTab = useModuleStore(s => s.setPendingVideoTab);
  const [tab, setTab] = useState<VTab>((pendingVideoTab as VTab) || 'home');
  const [activeVideo, setActiveVideo] = useState<ServerVideo | null>(null);
  const [activeShort, setActiveShort] = useState<number | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [channelAnalytics, setChannelAnalytics] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [catFilter, setCatFilter] = useState<string>('all');
  // Поиск и фильтр по категории идут на сервер (весь каталог), а не по
  // первым 100 роликам, что успели загрузиться в feed при открытии
  // вкладки — иначе искалось бы только среди уже подгруженного.
  const [searchResults, setSearchResults] = useState<ServerVideo[] | null>(null);

  useEffect(() => { load(); }, []);
  useEffect(() => () => { if (!currentUserId) resetSkyVideoForUser(); }, [currentUserId]);
  useEffect(() => { if (pendingVideoTab) setPendingVideoTab(null); }, [pendingVideoTab, setPendingVideoTab]);

  const longVids = useMemo(() => feed.filter(v => !isShortVideo(v)), [feed]);
  const shorts = useMemo(() => feed.filter(v => isShortVideo(v)), [feed]);

  const [searchLoading, setSearchLoading] = useState(false);
  const active = searchQuery.trim() !== '' || catFilter !== 'all';
  useEffect(() => {
    if (!active) { setSearchResults(null); setSearchLoading(false); return; }
    let cancelled = false;
    setSearchLoading(true);
    const t = setTimeout(() => {
      void search(searchQuery.trim(), { category: catFilter !== 'all' ? catFilter : undefined })
        .then(r => { if (!cancelled) { setSearchResults(r); setSearchLoading(false); } });
    }, searchQuery.trim() ? 300 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [active, searchQuery, catFilter, search]);

  const filtered = useMemo(() => {
    if (active) return (searchResults ?? []).filter(v => !isShortVideo(v));
    return longVids;
  }, [active, searchResults, longVids]);

  // Нажатие на автора (карточка, страница ролика, Shorts) открывает его канал: все видео и «Подписаться».
  const openChannel = (authorId: string) => { setActiveVideo(null); setActiveShort(null); setChannelAnalytics(false); setActiveChannelId(authorId); };

  if (activeVideo) {
    return (
      <AnimatePresence mode="wait">
        <VideoView key={activeVideo.id} video={activeVideo} onBack={() => setActiveVideo(null)} onOpenChannel={openChannel} />
      </AnimatePresence>
    );
  }

  if (activeShort !== null) {
    return (
      <AnimatePresence>
        <ShortsPlayer shorts={shorts} initialIndex={activeShort} onClose={() => setActiveShort(null)} onOpenChannel={openChannel} />
      </AnimatePresence>
    );
  }

  if (activeChannelId) {
    return (
      <AnimatePresence mode="wait">
        <ChannelPage key={activeChannelId + String(channelAnalytics)} authorId={activeChannelId} initialAnalytics={channelAnalytics}
          onBack={() => { setActiveChannelId(null); setChannelAnalytics(false); }} onOpenVideo={setActiveVideo} />
      </AnimatePresence>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: V.bg }}>
      <div className="shrink-0 px-4 pt-3 pb-2" style={{ borderBottom: `1px solid ${V.border}` }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-2 flex-1">
            <div className="grid h-8 w-8 place-items-center rounded-xl"
              style={{ background: `linear-gradient(135deg,${V.accent},#818cf8)`, boxShadow: `0 4px 14px ${V.accent}40` }}>
              <Play size={16} className="text-white ml-0.5" />
            </div>
            <span className="font-bold text-base" style={{ color: V.t1 }}>Sky Video</span>
          </div>
          <motion.button whileTap={{ scale: 0.9 }} type="button"
            onClick={() => setSearching(s => !s)}
            className="grid h-8 w-8 place-items-center rounded-full transition-colors"
            style={{ background: searching ? `${V.accent}20` : 'transparent', color: searching ? V.accent : V.t2 }}>
            {searching ? <X size={16} /> : <Search size={16} />}
          </motion.button>
        </div>

        <AnimatePresence>
          {searching && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-2">
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Поиск видео и авторов..." autoFocus
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                style={{ background: V.bg2, border: `1px solid ${V.border}`, color: V.t1 }} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-0.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {([
            { key: 'home', label: 'Главная' },
            { key: 'shorts', label: 'Shorts' },
            { key: 'channels', label: 'Каналы' },
            { key: 'upload', label: 'Загрузить' },
            { key: 'mine', label: 'Мои видео' },
          ] as { key: VTab; label: string }[]).map(({ key, label }) => {
            const on = tab === key;
            return (
              <button key={key} type="button" onClick={() => setTab(key)}
                className="relative shrink-0 px-4 py-2 text-xs font-semibold transition-colors"
                style={{ color: on ? V.t1 : V.t3 }}>
                {label}
                {on && (
                  <motion.div layoutId="video-tab-line" className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
                    style={{ background: V.accent }} transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: .12 }} className="h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

              {tab === 'home' && <AdBanner placement="video_banner" />}
              {tab === 'home' && (
                <div>
                  <div className="flex gap-2 px-4 py-2.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                    {[['all', 'Все'], ...categories.map(c => [c, c])].map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setCatFilter(k)}
                        className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors"
                        style={{
                          background: catFilter === k ? V.accent : V.bg3,
                          color: catFilter === k ? '#fff' : V.t2,
                        }}>{l}</button>
                    ))}
                  </div>

                  {shorts.length > 0 && (
                    <div className="mb-2">
                      <div className="flex items-center justify-between px-4 py-2">
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: V.t2 }}>Sky Shorts</p>
                        <button type="button" onClick={() => setTab('shorts')}
                          className="text-xs font-semibold" style={{ color: V.accent }}>Смотреть все →</button>
                      </div>
                      <div className="flex gap-2.5 px-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                        {shorts.slice(0, 5).map((v, i) => {
                          const [g1, g2] = gradFor(v.id);
                          return (
                            <motion.div key={v.id} whileTap={{ scale: 0.95 }}
                              className="shrink-0 overflow-hidden rounded-xl cursor-pointer relative"
                              style={{ width: 72, height: 128, background: `linear-gradient(160deg,${g1},${g2})` }}
                              onClick={() => setActiveShort(i)}>
                              {v.hasThumbnail && <img src={thumbnailUrl(v.id)} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                              <div className="absolute bottom-0 left-0 right-0 px-1.5 pb-1.5 pt-4"
                                style={{ background: 'linear-gradient(transparent,rgba(0,0,0,0.75))' }}>
                                <p className="text-[9px] font-semibold text-white line-clamp-2 leading-tight">{v.title}</p>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {active && searchLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                      <Play size={40} style={{ color: V.t3 }} />
                      <p className="text-sm font-semibold" style={{ color: V.t2 }}>Ищем…</p>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                      <Play size={40} style={{ color: V.t3 }} />
                      <p className="text-sm font-semibold" style={{ color: V.t2 }}>
                        {searchQuery ? 'Ничего не найдено' : 'Нет видео'}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-5 px-4 py-3">
                      {filtered.map(v => (
                        <VideoCard key={v.id} video={v} onClick={() => setActiveVideo(v)} onOpenChannel={openChannel} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'shorts' && (
                <div>
                  {shorts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                      <Play size={40} style={{ color: V.t3 }} />
                      <p className="text-sm" style={{ color: V.t2 }}>Нет Shorts</p>
                    </div>
                  ) : (
                    <ShortsPreview shorts={shorts} onOpen={setActiveShort} />
                  )}
                </div>
              )}

              {tab === 'channels' && (
                <ChannelsListView onOpen={setActiveChannelId} />
              )}

              {tab === 'upload' && (
                <UploadTab onDone={() => setTab('mine')} />
              )}

              {tab === 'mine' && (
                <>
                  {currentUserId && (
                    <div className="flex gap-2 px-4 pt-3">
                      <button type="button" onClick={() => { setChannelAnalytics(false); setActiveChannelId(currentUserId); }} className="rounded-full px-4 py-2 text-xs font-bold" style={{ background: V.bg2, color: V.t1 }}>Мой канал</button>
                      <button type="button" onClick={() => { setChannelAnalytics(true); setActiveChannelId(currentUserId); }} className="rounded-full px-4 py-2 text-xs font-bold" style={{ background: V.accent, color: '#fff' }}>Аналитика</button>
                    </div>
                  )}
                  <MineTab onOpen={setActiveVideo} />
                </>
              )}

            </motion.div>
          </AnimatePresence>
        </div>
      </div>
  );
};

