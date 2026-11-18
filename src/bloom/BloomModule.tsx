import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Clock, Bookmark, User, Search, Hash, Plus, X, Flower2, Bell, PenLine, Users } from 'lucide-react';
import { FeedAd } from '@/ads/AdBlocks';
import { useBloomStore, type FeedTab } from './store';
import { PostCard }        from './components/PostCard';
import { CreatePost }      from './components/CreatePost';
import { ExploreView }     from './components/ExploreView';
import { CommunitiesView } from './Communities';
import { FeedWidgets }     from './components/FeedWidgets';
import { NotificationsView } from './components/NotificationsView';
import { PostDetailView }  from './components/PostDetailView';
import {
  PopularTodayCard, WhoToFollowCard, NewAuthorsCard, TrendingCard,
  MusicFeedCard, HotCommentsCard, PlatformNewsCard, buildFeedRows,
} from './components/FeedInserts';
import { openProfile } from '@/profile/viewer/store';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { useModuleStore } from '@/data/state/modules';

const TABS: { key: FeedTab; label: string; icon: any }[] = [
  { key: 'algo',  label: 'Для вас',       icon: Sparkles },
  { key: 'fresh', label: 'Свежее',        icon: Clock    },
  { key: 'saved', label: 'Сохранённые',   icon: Bookmark },
  { key: 'mine',  label: 'Мои посты',     icon: User     },
];

const INSERT_MAP: Record<string, (props: { onOpenPost: (id:string)=>void; onTagClick: (t:string)=>void }) => any> = {
  ad:       () => <FeedAd/>,
  popular:  ({ onOpenPost }) => <PopularTodayCard onOpenPost={onOpenPost}/>,
  who:      () => <WhoToFollowCard/>,
  trending: ({ onTagClick }) => <TrendingCard onTagClick={onTagClick}/>,
  music:    () => <MusicFeedCard/>,
  hot:      ({ onOpenPost }) => <HotCommentsCard onOpenPost={onOpenPost}/>,
  new:      () => <NewAuthorsCard/>,
  news:     () => <PlatformNewsCard/>,
};

export const BloomModule = () => {
  const feedCache   = useBloomStore(s => s.feedCache);
  const feedLoading = useBloomStore(s => s.feedLoading);
  const tagCache    = useBloomStore(s => s.tagCache);
  const tagLoading  = useBloomStore(s => s.tagLoading);
  const notifCount = useBloomStore(s => s.notifCount);
  const feedVersion = useBloomStore(s => s.feedVersion);
  const loadFeed        = useBloomStore(s => s.loadFeed);
  const loadTag         = useBloomStore(s => s.loadTag);
  const loadNotifCount  = useBloomStore(s => s.loadNotifCount);
  const isMobile = useIsMobile();
  const pendingBloomTab = useModuleStore(s => s.pendingBloomTab);
  const setPendingBloomTab = useModuleStore(s => s.setPendingBloomTab);

  const [tab,        setTab]        = useState<FeedTab>((pendingBloomTab as FeedTab) || 'algo');
  const [createOpen, setCreateOpen] = useState(false);
  const [tagSearch,  setTagSearch]  = useState<string | null>(null);
  const [explore,    setExplore]    = useState(false);
  const [commOpen,   setCommOpen]   = useState(false);
  const [commSlug,   setCommSlug]   = useState<string | null>(null);
  useEffect(() => { const h = (e: Event) => { const slug = (e as CustomEvent<string>).detail; setCommOpen(true); setCommSlug(slug || null); setExplore(false); setTagSearch(null); }; window.addEventListener('sky:bloom-community', h); return () => window.removeEventListener('sky:bloom-community', h); }, []);
  const [notifOpen,  setNotifOpen]  = useState(false);
  const [detailPost, setDetailPost] = useState<string | null>(null);

  useEffect(() => { if (pendingBloomTab) setPendingBloomTab(null); }, [pendingBloomTab, setPendingBloomTab]);

  // Счётчики на вкладках «Сохранённые»/«Мои посты» и переход между
  // вкладками требуют своих постов — грузим все четыре разом, чтобы
  // бейджи были видны, даже когда активна другая вкладка.
  useEffect(() => {
    loadFeed('algo'); loadFeed('fresh'); loadFeed('saved'); loadFeed('mine');
    loadNotifCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedVersion]);

  useEffect(() => {
    if (tagSearch) void loadTag(tagSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagSearch, feedVersion]);

  const posts = feedCache[tab] ?? [];
  const feedPosts = tagSearch ? (tagCache[tagSearch] ?? []) : posts;
  const loading = tagSearch ? (tagLoading[tagSearch] ?? false) : (feedLoading[tab] ?? false);

  const rows = buildFeedRows(feedPosts);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">

      {/* Шапка */}
      <div className="shrink-0 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-l1)' }}>
        <div className={isMobile ? 'flex items-center justify-between px-3.5 pb-1.5' : 'flex items-center justify-between px-5 pb-2'} style={{ paddingTop: isMobile ? 'calc(var(--safe-top) + 10px)' : 'calc(var(--safe-top) + 16px)' }}>
          <div className="flex items-center gap-2">
            <Flower2 size={16} style={{ color: "#f472b6" }} />
            <h2 className="text-base font-bold" style={{ color: 'var(--t1)' }}>Bloom</h2>
            {tagSearch && (
              <div className="flex items-center gap-1 rounded-full px-2.5 py-0.5 ml-1"
                style={{ background: 'var(--accent-bg)', border: '1px solid rgba(79,110,247,0.25)' }}>
                <Hash size={10} style={{ color: 'var(--accent)' }}/>
                <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>{tagSearch}</span>
                <button type="button" onClick={() => setTagSearch(null)}>
                  <X size={11} style={{ color: 'var(--accent)' }}/>
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Уведомления" onClick={() => setNotifOpen(true)} className="glass-btn round relative">
              <Bell size={16} style={{ color: 'var(--t2)' }}/>
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold text-white"
                  style={{ background: 'var(--red)' }}>{notifCount > 9 ? '9+' : notifCount}</span>
              )}
            </button>
            <motion.button type="button" whileTap={{ scale: 0.93 }} onClick={() => setCreateOpen(true)}
              className="glass-btn accent gap-1.5 text-xs" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <Plus size={14}/>Пост
            </motion.button>
          </div>
        </div>

        <div className={isMobile ? 'px-3 pb-2' : 'px-4 pb-3'}>
          <div className="glass-pill flex min-w-0 items-center gap-0.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {TABS.map(({ key, label, icon: TabIcon }) => {
              const isActive = tab === key && !tagSearch && !explore && !commOpen;
              const cnt = key === 'saved' ? (feedCache.saved?.length ?? null)
                : key === 'mine' ? (feedCache.mine?.length ?? null) : null;
              return (
                <button key={key} type="button"
                  onClick={() => { setTab(key); setTagSearch(null); setExplore(false); setCommOpen(false); }}
                  className="relative isolate flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold"
                  style={{ color: isActive ? 'var(--t1)' : 'var(--t3)', background: 'transparent', border: 0 }}>
                  {isActive && <motion.span layoutId="bloom-lens" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="glass-lens absolute inset-0 -z-10" />}
                  <TabIcon size={12} style={{ color: isActive ? 'var(--accent)' : undefined }}/>
                  {label}
                  {cnt != null && cnt > 0 && (
                    <span className="ml-0.5 rounded-full px-1.5 text-[9px] font-bold leading-4"
                      style={{ background: 'var(--accent)', color: '#fff' }}>{cnt}</span>
                  )}
                </button>
              );
            })}
            <button type="button" onClick={() => { setCommOpen(v => !v); setCommSlug(null); setExplore(false); setTagSearch(null); }}
              className="relative isolate flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold"
              style={{ color: commOpen ? 'var(--t1)' : 'var(--t3)', background: 'transparent', border: 0 }}>
              {commOpen && <motion.span layoutId="bloom-lens" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="glass-lens absolute inset-0 -z-10" />}
              <Users size={12} style={{ color: commOpen ? 'var(--accent)' : undefined }}/>Сообщества
            </button>
            <button type="button" onClick={() => { setExplore(v => !v); setCommOpen(false); }}
              className="relative isolate flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold"
              style={{ color: explore ? 'var(--t1)' : 'var(--t3)', background: 'transparent', border: 0 }}>
              {explore && <motion.span layoutId="bloom-lens" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="glass-lens absolute inset-0 -z-10" />}
              <Search size={12} style={{ color: explore ? 'var(--accent)' : undefined }}/>Обзор
            </button>
          </div>
        </div>
      </div>

      {/* Контент */}
      {commOpen ? (
        <div className="flex-1 overflow-y-auto">
          <CommunitiesView openSlug={commSlug} onOpen={setCommSlug} onAuthorClick={id => openProfile(id)} onTagClick={t => { setTagSearch(t); setCommOpen(false); }}/>
        </div>
      ) : explore ? (
        <ExploreView
          onAuthorClick={id => { openProfile(id); setExplore(false); }}
          onTagClick={t => { setTagSearch(t); setExplore(false); }}/>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {!tagSearch && tab === 'algo' && <FeedWidgets/>}
          <div className={isMobile ? 'px-2.5 py-2.5 space-y-2' : 'px-4 py-4 space-y-3'}>
            {feedPosts.length === 0 && !loading && (
              <div className="sky-empty">
                <div className="sky-empty-icon">
                  {tab === 'saved' ? <Bookmark size={30}/>
                    : tab === 'mine' ? <PenLine size={30}/>
                    : tagSearch ? <Hash size={30}/>
                    : <Flower2 size={30}/>}
                </div>
                <p style={{ color: 'var(--t2)' }}>
                  {tab === 'saved' ? 'Нет сохранённых постов'
                    : tab === 'mine' ? 'Ты ещё ничего не публиковал'
                    : tagSearch ? `Постов с #${tagSearch} нет`
                    : 'Лента пуста'}
                </p>
                {(tab === 'algo' || tab === 'fresh') && (
                  <button type="button" onClick={() => setCreateOpen(true)}
                    className="sky-btn-primary text-xs px-4 py-2">
                    Написать первый пост
                  </button>
                )}
              </div>
            )}
            {rows.map((row, i) => row.kind === 'post'
              ? <PostCard key={row.post.id} post={row.post}
                  onAuthorClick={id => openProfile(id)}
                  onTagClick={t => setTagSearch(t)}/>
              : <div key={`insert-${i}-${row.key}`}>{INSERT_MAP[row.key]?.({ onOpenPost: setDetailPost, onTagClick: setTagSearch })}</div>
            )}
          </div>
        </div>
      )}

      {/* Уведомления */}
      <AnimatePresence>
        {notifOpen && (
          <NotificationsView onClose={() => setNotifOpen(false)}
            onOpenPost={id => { setNotifOpen(false); setDetailPost(id); }}/>
        )}
      </AnimatePresence>

      {/* Отдельный пост */}
      <AnimatePresence>
        {detailPost && (
          <PostDetailView postId={detailPost} onClose={() => setDetailPost(null)}
            onAuthorClick={id => { setDetailPost(null); openProfile(id); }}
            onTagClick={t => { setDetailPost(null); setTagSearch(t); }}/>
        )}
      </AnimatePresence>

      {/* Создать пост */}
      <AnimatePresence>
        {createOpen && <CreatePost onClose={() => setCreateOpen(false)}/>}
      </AnimatePresence>
    </div>
  );
};
