import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Clock, Bookmark, User, Search, Hash, Plus, X, Flower2, Bell } from 'lucide-react';
import { FeedAd } from '@/ads/AdBlocks';
import { useBloomStore, type FeedTab } from './store';
import { useAuthStore } from '@/core/auth/store';
import { PostCard }        from './components/PostCard';
import { CreatePost }      from './components/CreatePost';
import { ExploreView }     from './components/ExploreView';
import { FeedWidgets }     from './components/FeedWidgets';
import { NotificationsView } from './components/NotificationsView';
import { PostDetailView }  from './components/PostDetailView';
import {
  PopularTodayCard, WhoToFollowCard, NewAuthorsCard, TrendingCard,
  MusicFeedCard, HotCommentsCard, PlatformNewsCard, buildFeedRows,
} from './components/FeedInserts';
import { openProfile } from '@/profile/viewer/store';
import { useIsMobile } from '@/interface/mobile/useIsMobile';

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
  const { feed, posts, notificationsCount } = useBloomStore();
  const { currentUserId } = useAuthStore();
  const uid = currentUserId ?? '';
  const isMobile = useIsMobile();

  const [tab,        setTab]        = useState<FeedTab>('algo');
  const [createOpen, setCreateOpen] = useState(false);
  const [tagSearch,  setTagSearch]  = useState<string | null>(null);
  const [explore,    setExplore]    = useState(false);
  const [notifOpen,  setNotifOpen]  = useState(false);
  const [detailPost, setDetailPost] = useState<string | null>(null);

  const feedPosts = tagSearch
    ? posts.filter(p => p.tags.includes(tagSearch))
    : feed(tab);

  const rows = buildFeedRows(feedPosts);
  const notifCount = notificationsCount();

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
            <button type="button" onClick={() => setNotifOpen(true)} className="relative rounded-xl p-2"
              style={{ background: 'rgba(255,255,255,0.04)' }}>
              <Bell size={16} style={{ color: 'var(--t2)' }}/>
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold text-white"
                  style={{ background: 'var(--red)' }}>{notifCount > 9 ? '9+' : notifCount}</span>
              )}
            </button>
            <motion.button type="button" whileTap={{ scale: 0.93 }} onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white"
              style={{ background: 'var(--accent)' }}>
              <Plus size={14}/>Пост
            </motion.button>
          </div>
        </div>

        <div className={isMobile ? 'flex items-center gap-1 px-3 pb-2 overflow-x-auto' : 'flex items-center gap-1.5 px-4 pb-3 overflow-x-auto'} style={{scrollbarWidth:'none'}}>
          {TABS.map(({ key, label, icon: TabIcon }) => {
            const isActive = tab === key && !tagSearch && !explore;
            const cnt = key === 'saved' ? posts.filter(p => p.saved.includes(uid)).length
              : key === 'mine' ? posts.filter(p => p.authorId === uid).length : null;
            return (
              <button key={key} type="button"
                onClick={() => { setTab(key); setTagSearch(null); setExplore(false); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium shrink-0 transition-all"
                style={{
                  background: isActive ? 'var(--accent-bg)' : 'rgba(255,255,255,0.04)',
                  color: isActive ? 'var(--accent)' : 'var(--t3)',
                  border: isActive ? '1px solid rgba(79,110,247,0.25)' : '1px solid transparent',
                }}>
                <TabIcon size={12}/>
                {label}
                {cnt != null && cnt > 0 && (
                  <span className="text-[9px] rounded-full px-1.5 font-bold leading-4 ml-0.5"
                    style={{ background: 'var(--accent)', color: '#fff' }}>{cnt}</span>
                )}
              </button>
            );
          })}
          <button type="button" onClick={() => setExplore(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium ml-auto shrink-0 transition-all"
            style={{
              background: explore ? 'var(--accent-bg)' : 'rgba(255,255,255,0.04)',
              color: explore ? 'var(--accent)' : 'var(--t3)',
              border: explore ? '1px solid rgba(79,110,247,0.25)' : '1px solid transparent',
            }}>
            <Search size={12}/>Обзор
          </button>
        </div>
      </div>

      {/* Контент */}
      {explore ? (
        <ExploreView
          onAuthorClick={id => { openProfile(id); setExplore(false); }}
          onTagClick={t => { setTagSearch(t); setExplore(false); }}/>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {!tagSearch && tab === 'algo' && <FeedWidgets/>}
          <div className={isMobile ? 'px-2.5 py-2.5 space-y-2' : 'px-4 py-4 space-y-3'}>
            {feedPosts.length === 0 && (
              <div className="sky-empty">
                <div className="sky-empty-icon">
                  {tab === 'saved' ? '🔖' : tab === 'mine' ? '✍️' : tagSearch ? '#️⃣' : '🌸'}
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
