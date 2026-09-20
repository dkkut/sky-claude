import { useEffect } from 'react';
import { UserPlus, UserCheck, TrendingUp, Music2, MessageCircle, Sparkles, Megaphone, Hash, Heart } from 'lucide-react';
import { useBloomStore, fmtViews, type BloomPost } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { useSocialGraph } from '@/profile/viewer/social';
import { usePlayerStore } from '@/player/playerStore';
import { useModuleStore } from '@/data/state/modules';
import { Av } from './Primitives';

const InsertShell = ({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
    <div className="mb-3 flex items-center gap-1.5">
      <Icon size={13} style={{ color: 'var(--accent)' }}/>
      <h3 className="text-[13px] font-bold" style={{ color: 'var(--t1)' }}>{title}</h3>
    </div>
    {children}
  </div>
);

/* Подписка — та же единая таблица follows, что у SkyVideo и общего
   профиля (server/follows.mjs), не своя копия внутри Bloom. */
const FollowBtn = ({ authorId }: { authorId: string }) => {
  const currentUserId = useAuthStore(s => s.currentUserId) ?? '';
  const isF = useSocialGraph(s => s.isFollowing(currentUserId, authorId));
  const fetchFollows = useSocialGraph(s => s.fetchFollows);
  const toggleFollow = useSocialGraph(s => s.toggleFollow);

  useEffect(() => { void fetchFollows(authorId); }, [authorId, fetchFollows]);

  return (
    <button type="button" onClick={() => void toggleFollow(currentUserId, authorId)}
      className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold shrink-0"
      style={{
        background: isF ? 'transparent' : 'var(--accent)',
        color: isF ? 'var(--t2)' : '#fff',
        border: isF ? '1px solid var(--border)' : 'none',
      }}>
      {isF ? <><UserCheck size={11}/>Вы подписаны</> : <><UserPlus size={11}/>Подписаться</>}
    </button>
  );
};

/* ── Популярное сегодня ────────────────────────────────────── */
export const PopularTodayCard = ({ onOpenPost }: { onOpenPost: (id: string) => void }) => {
  const posts = useBloomStore(s => s.feedCache.fresh) ?? [];
  const loadFeed = useBloomStore(s => s.loadFeed);
  useEffect(() => { void loadFeed('fresh'); }, [loadFeed]);
  const top = [...posts].sort((a,b) => b.views - a.views).slice(0, 3);
  if (top.length === 0) return null;
  return (
    <InsertShell icon={TrendingUp} title="Популярное сегодня">
      <div className="space-y-2.5">
        {top.map((p, i) => (
          <button key={p.id} type="button" onClick={() => onOpenPost(p.id)} className="flex w-full items-start gap-2.5 text-left">
            <span className="text-[15px] font-extrabold shrink-0" style={{ color: 'var(--t3)' }}>{i+1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--t1)' }}>{p.authorName}</p>
              <p className="line-clamp-1 text-[12px]" style={{ color: 'var(--t3)' }}>{p.text}</p>
            </div>
            <span className="shrink-0 text-[11px]" style={{ color: 'var(--t3)' }}>{fmtViews(p.views)}</span>
          </button>
        ))}
      </div>
    </InsertShell>
  );
};

/* ── Кого читать ───────────────────────────────────────────── */
export const WhoToFollowCard = () => {
  const suggested = useBloomStore(s => s.suggested);
  const loadSuggested = useBloomStore(s => s.loadSuggested);
  useEffect(() => { void loadSuggested(); }, [loadSuggested]);
  const { accounts } = useAuthStore();
  const list = suggested.map(id => accounts.find(a => a.id === id)).filter(Boolean).slice(0, 3);
  if (list.length === 0) return null;
  return (
    <InsertShell icon={Sparkles} title="Кого читать">
      <div className="space-y-3">
        {list.map(a => a && (
          <div key={a.id} className="flex items-center gap-2.5">
            <Av name={a.name} size={9}/>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--t1)' }}>{a.name}</p>
              <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>@{a.username}</p>
            </div>
            <FollowBtn authorId={a.id}/>
          </div>
        ))}
      </div>
    </InsertShell>
  );
};

/* ── Новые авторы ──────────────────────────────────────────── */
// accounts в useAuthStore — это учётки, добавленные на этом устройстве
// (переключатель нескольких Sky ID в одном браузере), а не список всех
// пользователей Sky, и в нём всегда сидят три демо-профиля Sky
// (kutuzov/luna_nova/neon_driver) — их Bloom не должен показывать как
// «новых авторов», это не настоящие люди.
const DEMO_ACCOUNT_IDS = new Set(['acc-kutuzov', 'acc-luna', 'acc-neo']);
export const NewAuthorsCard = () => {
  const { accounts, currentUserId } = useAuthStore();
  const list = [...accounts]
    .filter(a => a.id !== currentUserId && !DEMO_ACCOUNT_IDS.has(a.id))
    .sort((a,b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 3);
  if (list.length === 0) return null;
  return (
    <InsertShell icon={UserPlus} title="Новые авторы">
      <div className="space-y-3">
        {list.map(a => (
          <div key={a.id} className="flex items-center gap-2.5">
            <Av name={a.name} size={9}/>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--t1)' }}>{a.name}</p>
              <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>@{a.username}</p>
            </div>
            <FollowBtn authorId={a.id}/>
          </div>
        ))}
      </div>
    </InsertShell>
  );
};

/* ── Тренды ────────────────────────────────────────────────── */
export const TrendingCard = ({ onTagClick }: { onTagClick: (t: string) => void }) => {
  const trendingTags = useBloomStore(s => s.trendingTags);
  const loadTrending = useBloomStore(s => s.loadTrending);
  useEffect(() => { void loadTrending(); }, [loadTrending]);
  const tags = trendingTags.slice(0, 5);
  if (tags.length === 0) return null;
  return (
    <InsertShell icon={Hash} title="Тренды Bloom">
      <div className="space-y-2.5">
        {tags.map(([tag, count]: any, i: number) => (
          <button key={tag} type="button" onClick={() => onTagClick(tag)} className="flex w-full items-center justify-between text-left">
            <div>
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>#{i+1} в тренде</p>
              <p className="text-[13px] font-bold" style={{ color: 'var(--t1)' }}>#{tag}</p>
            </div>
            <span className="text-[11px]" style={{ color: 'var(--t3)' }}>{count} постов</span>
          </button>
        ))}
      </div>
    </InsertShell>
  );
};
/* ── Сейчас в Sky Music ────────────────────────────────────── */
export const MusicFeedCard = () => {
  const { item, isPlaying } = usePlayerStore();
  const { setActiveModule, setPendingExtrasTab } = useModuleStore();
  const goMusic = () => { setPendingExtrasTab('music'); setActiveModule('extras'); };
  return (
    <InsertShell icon={Music2} title="Sky Music">
      {item ? (
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: 'linear-gradient(135deg,#4f6ef7,#8b5cf6)' }}>
            <Music2 size={18} color="#fff"/>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold" style={{ color: 'var(--t1)' }}>{item.title}</p>
            <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>{item.author} · {isPlaying ? 'играет сейчас' : 'на паузе'}</p>
          </div>
        </div>
      ) : (
        <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Сейчас ничего не играет</p>
      )}
      <button type="button" onClick={goMusic}
        className="mt-3 w-full rounded-xl py-2 text-[12px] font-bold"
        style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid rgba(79,110,247,0.25)' }}>
        Открыть Sky Music
      </button>
    </InsertShell>
  );
};

/* ── Горячие комментарии ──────────────────────────────────── */
export const HotCommentsCard = ({ onOpenPost }: { onOpenPost: (id: string) => void }) => {
  const hot = useBloomStore(s => s.hot);
  const loadHot = useBloomStore(s => s.loadHot);
  useEffect(() => { void loadHot(); }, [loadHot]);
  const list = hot.filter(x => x.comment.likes.length > 0);
  if (list.length === 0) return null;
  return (
    <InsertShell icon={MessageCircle} title="Горячие комментарии">
      <div className="space-y-3">
        {list.map(({ post, comment }) => (
          <button key={comment.id} type="button" onClick={() => onOpenPost(post.id)} className="flex w-full items-start gap-2.5 text-left">
            <Av name={comment.authorName} size={7}/>
            <div className="min-w-0 flex-1">
              <p className="text-[12px]"><span className="font-semibold" style={{ color: 'var(--t1)' }}>{comment.authorName}</span> <span style={{ color: 'var(--t2)' }}>{comment.text}</span></p>
              <p className="mt-0.5 flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--t3)' }}>
                <Heart size={10}/> {comment.likes.length} · к посту {post.authorName}
              </p>
            </div>
          </button>
        ))}
      </div>
    </InsertShell>
  );
};

/* ── Новости платформы ────────────────────────────────────── */
const NEWS = [
  { title: 'Опросы в постах',       body: 'Теперь можно добавлять голосование прямо в публикацию.' },
  { title: 'Реакции расширены',     body: 'Добавили 🎉 и 🤔 — выбирайте эмоцию точнее.' },
  { title: 'Раздел «Обзор» обновлён', body: 'Тренды, поиск и рекомендации авторов в одном месте.' },
];
export const PlatformNewsCard = () => (
  <InsertShell icon={Megaphone} title="Новости Sky Bloom">
    <div className="space-y-3">
      {NEWS.map(n => (
        <div key={n.title}>
          <p className="text-[12.5px] font-semibold" style={{ color: 'var(--t1)' }}>{n.title}</p>
          <p className="text-[12px]" style={{ color: 'var(--t3)' }}>{n.body}</p>
        </div>
      ))}
    </div>
  </InsertShell>
);

/* ── Интерливинг вставок между постами ────────────────────── */
export type FeedRow = { kind: 'post'; post: BloomPost } | { kind: 'insert'; key: string };
const INSERT_CYCLE = ['ad', 'popular', 'who', 'trending', 'music', 'hot', 'new', 'news'];

export const buildFeedRows = (posts: BloomPost[]): FeedRow[] => {
  const rows: FeedRow[] = [];
  let cursor = 0;
  posts.forEach((post, i) => {
    rows.push({ kind: 'post', post });
    if ((i + 1) % 4 === 0 && cursor < INSERT_CYCLE.length) {
      rows.push({ kind: 'insert', key: INSERT_CYCLE[cursor % INSERT_CYCLE.length] });
      cursor++;
    }
  });
  return rows;
};
