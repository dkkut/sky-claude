/* ===========================================================
   SKY TV — SkyVideo
=========================================================== */
import { useEffect, useMemo } from 'react';
import { Video as VideoIcon } from 'lucide-react';
import { useVideoStore, fmtViews, CATEGORY_LABEL, type VideoEntry } from '@/video/store';
import { useAuthStore } from '@/core/auth/store';
import { TVCarousel } from './TVCarousel';
import { TVCard } from './TVCard';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';

interface TVVideoHubProps { onPlayVideo: (id: string) => void; }

export const TVVideoHub = ({ onPlayVideo }: TVVideoHubProps) => {
  const { videos, getHistory, getSaved } = useVideoStore();
  const { currentUserId } = useAuthStore();
  const { lastFocusedId } = useTVRestoreState();

  const longVideos = useMemo(() => videos.filter(v => !v.isShort), [videos]);
  const popular = useMemo(() => [...longVideos].sort((a, b) => b.views - a.views).slice(0, 14), [longVideos]);
  const fresh = useMemo(() => [...longVideos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 14), [longVideos]);
  const history = useMemo(() => currentUserId ? getHistory(currentUserId).filter(v => !v.isShort).slice(0, 14) : [], [currentUserId, getHistory, videos]);
  const saved = useMemo(() => currentUserId ? getSaved(currentUserId).filter(v => !v.isShort).slice(0, 14) : [], [currentUserId, getSaved, videos]);
  const byCategory = useMemo(() => {
    const map = new Map<string, VideoEntry[]>();
    for (const v of longVideos) { if (!map.has(v.category)) map.set(v.category, []); map.get(v.category)!.push(v); }
    return [...map.entries()].slice(0, 4);
  }, [longVideos]);

  useEffect(() => { tvFocusManager.focusDefault(lastFocusedId); }, []);

  if (longVideos.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <VideoIcon size={40} color="var(--t3)"/>
        <p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Видео пока нет</p>
      </div>
    );
  }

  return (
    <div className="px-10 pt-6 pb-10">
      {history.length > 0 && (
        <TVCarousel title="Продолжить просмотр" items={history} getId={v => v.id} rowAutoFocusPriority={0}
          renderItem={(v, p) => <TVCard id={`hist-${v.id}`} title={v.title} subtitle={`${fmtViews(v.views)} просмотров`} imageUrl={v.thumbnailUrl} aspect="wide" onEnter={() => onPlayVideo(v.id)} autoFocusPriority={p}/>}/>
      )}
      <TVCarousel title="Популярное" items={popular} getId={v => v.id} rowAutoFocusPriority={history.length === 0 ? 0 : undefined}
        renderItem={(v, p) => <TVCard id={`pop-${v.id}`} title={v.title} subtitle={`${fmtViews(v.views)} просмотров`} imageUrl={v.thumbnailUrl} aspect="wide" onEnter={() => onPlayVideo(v.id)} autoFocusPriority={p}/>}/>
      <TVCarousel title="Новинки" items={fresh} getId={v => v.id}
        renderItem={(v, p) => <TVCard id={`fresh-${v.id}`} title={v.title} subtitle={`${fmtViews(v.views)} просмотров`} imageUrl={v.thumbnailUrl} aspect="wide" onEnter={() => onPlayVideo(v.id)} autoFocusPriority={p}/>}/>
      {saved.length > 0 && (
        <TVCarousel title="Сохранённое" items={saved} getId={v => v.id}
          renderItem={(v, p) => <TVCard id={`saved-${v.id}`} title={v.title} subtitle={`${fmtViews(v.views)} просмотров`} imageUrl={v.thumbnailUrl} aspect="wide" onEnter={() => onPlayVideo(v.id)} autoFocusPriority={p}/>}/>
      )}
      {byCategory.map(([cat, list]) => (
        <TVCarousel key={cat} title={CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL] ?? cat} items={list} getId={v => v.id}
          renderItem={(v, p) => <TVCard id={`cat-${cat}-${v.id}`} title={v.title} subtitle={`${fmtViews(v.views)} просмотров`} imageUrl={v.thumbnailUrl} aspect="wide" onEnter={() => onPlayVideo(v.id)} autoFocusPriority={p}/>}/>
      ))}
    </div>
  );
};
