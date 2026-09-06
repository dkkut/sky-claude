import { Gamepad2, Play, CircleDot, Sparkles, EyeOff, Music2, Film } from 'lucide-react';
import { fmtAgo } from '@/bloom/store';
import { SectionHead } from './Head';
import type { ProfileData } from '../useProfileData';

export const hasActivity = (data: ProfileData) =>
  data.activity.canShow && (
    !!data.activity.gaming || data.activity.recentVideos.length > 0 ||
    !!data.activity.lastStory || data.activity.recentPosts.length > 0 ||
    !!data.activity.nowPlaying || !!data.activity.nowWatching
  );

export const ActivitySection = ({ data }: { data: ProfileData }) => {
  if (!data.activity.canShow) {
    return (
      <div className="sky-card p-3.5 sm:p-5 flex items-center gap-3" style={{ background: 'var(--profile-card-bg, var(--bg-l1))', border: '1px solid var(--profile-card-border, transparent)' }}>
        <EyeOff size={18} style={{ color: 'var(--t3)' }} />
        <p className="text-sm" style={{ color: 'var(--t3)' }}>Активность скрыта настройками приватности</p>
      </div>
    );
  }
  if (!hasActivity(data)) return null;

  const { gaming, recentVideos, lastStory, recentPosts, nowPlaying, nowWatching } = data.activity;

  return (
    <div className="sky-card p-3.5 sm:p-5" style={{ background: 'var(--profile-card-bg, var(--bg-l1))', border: '1px solid var(--profile-card-border, transparent)' }}>
      <SectionHead icon={Sparkles} title="Активность" />

      <div className="mt-3 space-y-3">
        {nowPlaying && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: 'var(--bg-l2)' }}>
            <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center shrink-0"
              style={{ background: nowPlaying.coverUrl ? `center/cover url(${nowPlaying.coverUrl})` : 'var(--bg-l3)' }}>
              {!nowPlaying.coverUrl && <Music2 size={16} style={{ color: 'var(--t2)' }} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate" style={{ color: 'var(--t1)' }}>{nowPlaying.title}</div>
              <div className="text-xs flex items-center gap-1 truncate" style={{ color: 'var(--green)' }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--green)' }} />
                слушает: {nowPlaying.artist}
              </div>
            </div>
          </div>
        )}

        {nowWatching && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: 'var(--bg-l2)' }}>
            <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center shrink-0"
              style={{ background: nowWatching.coverUrl ? `center/cover url(${nowWatching.coverUrl})` : 'var(--bg-l3)' }}>
              {!nowWatching.coverUrl && <Film size={16} style={{ color: 'var(--t2)' }} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate" style={{ color: 'var(--t1)' }}>{nowWatching.title}</div>
              <div className="text-xs flex items-center gap-1" style={{ color: 'var(--green)' }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--green)' }} />
                смотрит сейчас
              </div>
            </div>
          </div>
        )}

        {gaming && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: 'var(--bg-l2)' }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0" style={{ background: 'var(--bg-l3)' }}>
              {gaming.gameIcon ?? <Gamepad2 size={16} style={{ color: 'var(--t2)' }} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate" style={{ color: 'var(--t1)' }}>{gaming.gameName}</div>
              <div className="text-xs flex items-center gap-1" style={{ color: gaming.isPlaying ? 'var(--green)' : 'var(--t3)' }}>
                {gaming.isPlaying && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--green)' }} />}
                {gaming.isPlaying ? 'играет сейчас' : `играл(а) недавно · ${gaming.totalHours} ч всего`}
              </div>
            </div>
          </div>
        )}

        {lastStory && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: 'var(--bg-l2)' }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: lastStory.bg || 'var(--bg-l3)' }}>
              <CircleDot size={16} color="#fff" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Активная история</div>
              <div className="text-xs truncate" style={{ color: 'var(--t3)' }}>
                {lastStory.text ? lastStory.text : 'Фото / видео'} · {fmtAgo(new Date(lastStory.createdAt).toISOString())}
              </div>
            </div>
          </div>
        )}

        {recentPosts.length > 0 && (
          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--t3)' }}>Последние публикации</div>
            <div className="space-y-2">
              {recentPosts.map(p => (
                <div key={p.id} className="px-3 py-2.5 rounded-xl" style={{ background: 'var(--bg-l2)' }}>
                  <p className="text-sm line-clamp-2" style={{ color: 'var(--t1)' }}>{p.text || '📷 медиа-публикация'}</p>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--t3)' }}>{fmtAgo(p.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {recentVideos.length > 0 && (
          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--t3)' }}>Недавно смотрел(а)</div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {recentVideos.map(v => (
                <div key={v.id} className="shrink-0 w-28 rounded-xl overflow-hidden" style={{ background: 'var(--bg-l2)' }}>
                  <div className="h-16 flex items-center justify-center"
                    style={{ background: v.thumbnailGrad ? `linear-gradient(135deg,${v.thumbnailGrad[0]},${v.thumbnailGrad[1]})` : 'var(--bg-l3)' }}>
                    <Play size={16} color="#fff" />
                  </div>
                  <div className="px-2 py-1.5 text-[11px] line-clamp-2" style={{ color: 'var(--t2)' }}>{v.title}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
