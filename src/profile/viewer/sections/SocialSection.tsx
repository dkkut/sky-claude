import { useState } from 'react';
import { Users2, ChevronRight } from 'lucide-react';
import { SectionHead } from './Head';
import { ListSheet, entriesFromIds } from '../ListSheet';
import type { ProfileData } from '../useProfileData';

type ListKind = 'friends' | 'followers' | 'following' | 'mutualFriends' | null;

const Stat = ({ value, label, onClick }: { value: number; label: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} disabled={value === 0}
    className="flex-1 flex flex-col items-center py-2 rounded-xl sky-hover-lift disabled:opacity-50">
    <span className="text-lg font-extrabold" style={{ color: 'var(--t1)' }}>{value}</span>
    <span className="text-[11px]" style={{ color: 'var(--t3)' }}>{label}</span>
  </button>
);

export const hasSocial = (data: ProfileData) =>
  data.social.friendIds.length + data.social.followerIds.length + data.social.followingIds.length + data.social.mutualGroups.length > 0;

export const SocialSection = ({ data }: { data: ProfileData }) => {
  const [open, setOpen] = useState<ListKind>(null);
  if (!hasSocial(data) && !data.isOwn) return null;
  const s = data.social;

  const sheets: Record<Exclude<ListKind, null>, { title: string; ids: string[] }> = {
    friends:       { title: 'Друзья', ids: s.friendIds },
    followers:     { title: 'Подписчики', ids: s.followerIds },
    following:     { title: 'Подписки', ids: s.followingIds },
    mutualFriends: { title: 'Общие друзья', ids: s.mutualFriendIds },
  };

  return (
    <div className="sky-card p-3.5 sm:p-5" style={{ background: 'var(--profile-card-bg, var(--bg-l1))', border: '1px solid var(--profile-card-border, transparent)' }}>
      <SectionHead icon={Users2} title="Социальное" />

      <div className="flex">
        <Stat value={s.friendIds.length} label="Друзья" onClick={() => setOpen('friends')} />
        <Stat value={s.followerIds.length} label="Подписчики" onClick={() => setOpen('followers')} />
        <Stat value={s.followingIds.length} label="Подписки" onClick={() => setOpen('following')} />
      </div>

      {!data.isOwn && s.mutualFriendIds.length > 0 && (
        <button type="button" onClick={() => setOpen('mutualFriends')}
          className="mt-3 w-full flex items-center justify-between px-3 py-2.5 rounded-xl sky-hover-lift"
          style={{ background: 'var(--bg-l2)' }}>
          <span className="text-sm" style={{ color: 'var(--t2)' }}>
            {s.mutualFriendIds.length} общих друзей
          </span>
          <ChevronRight size={16} style={{ color: 'var(--t3)' }} />
        </button>
      )}

      {s.mutualGroups.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--t3)' }}>Общие группы и каналы</div>
          <div className="space-y-1.5">
            {s.mutualGroups.map(g => (
              <div key={g.id} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: 'var(--bg-l2)' }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: '#6e8eff' }}>
                  {g.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--t1)' }}>{g.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--t3)' }}>{g.type === 'group' ? 'Группа' : 'Канал'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {open && (
        <ListSheet title={sheets[open].title} entries={entriesFromIds(sheets[open].ids)} onClose={() => setOpen(null)} />
      )}
    </div>
  );
};
