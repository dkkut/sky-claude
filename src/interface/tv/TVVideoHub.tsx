/* ===========================================================
   SKY TV — SkyVideo
=========================================================== */
import { useEffect, useMemo } from 'react';
import { Video as VideoIcon } from 'lucide-react';
import { useSkyVideoStore } from '@/video/serverStore';
import { thumbnailUrl, type ServerVideo } from '@/video/skyVideoApi';
import { TVCarousel } from './TVCarousel';
import { TVCard } from './TVCard';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';
import { getContinueWatching } from './watchProgressStore';

const fmtViews = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

interface TVVideoHubProps { onPlayVideo: (id: string) => void; }

export const TVVideoHub = ({ onPlayVideo }: TVVideoHubProps) => {
  const { feed, load } = useSkyVideoStore();
  const { lastFocusedId } = useTVRestoreState();

  useEffect(() => { void load(); }, [load]);

  const longVideos = useMemo(() => feed.filter(v => !(v.height && v.width && v.height >= v.width)), [feed]);
  const popular = useMemo(() => [...longVideos].sort((a, b) => b.views - a.views).slice(0, 14), [longVideos]);
  const fresh = useMemo(() => [...longVideos].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).slice(0, 14), [longVideos]);
  /* «Продолжить просмотр» — из локального трекера прогресса телевизора,
     отфильтрованного по тому, что ещё есть в общей ленте. Своей истории
     просмотров Sky Video на сервере нет — раньше здесь была выдуманная. */
  const continueWatching = useMemo(() => {
    const byId = new Map(longVideos.map(v => [v.id, v]));
    return getContinueWatching()
      .map(e => byId.get(e.movieId))
      .filter((v): v is ServerVideo => Boolean(v))
      .slice(0, 14);
  }, [longVideos]);
  const byCategory = useMemo(() => {
    const map = new Map<string, ServerVideo[]>();
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

  const thumbFor = (v: ServerVideo) => v.hasThumbnail ? thumbnailUrl(v.id) : undefined;

  return (
    <div className="px-10 pt-6 pb-10">
      {continueWatching.length > 0 && (
        <TVCarousel title="Продолжить просмотр" items={continueWatching} getId={v => v.id} rowAutoFocusPriority={0}
          renderItem={(v, p) => <TVCard id={`hist-${v.id}`} title={v.title} subtitle={`${fmtViews(v.views)} просмотров`} imageUrl={thumbFor(v)} aspect="wide" onEnter={() => onPlayVideo(v.id)} autoFocusPriority={p}/>}/>
      )}
      <TVCarousel title="Популярное" items={popular} getId={v => v.id} rowAutoFocusPriority={continueWatching.length === 0 ? 0 : undefined}
        renderItem={(v, p) => <TVCard id={`pop-${v.id}`} title={v.title} subtitle={`${fmtViews(v.views)} просмотров`} imageUrl={thumbFor(v)} aspect="wide" onEnter={() => onPlayVideo(v.id)} autoFocusPriority={p}/>}/>
      <TVCarousel title="Новинки" items={fresh} getId={v => v.id}
        renderItem={(v, p) => <TVCard id={`fresh-${v.id}`} title={v.title} subtitle={`${fmtViews(v.views)} просмотров`} imageUrl={thumbFor(v)} aspect="wide" onEnter={() => onPlayVideo(v.id)} autoFocusPriority={p}/>}/>
      {byCategory.map(([cat, list]) => (
        <TVCarousel key={cat} title={cat} items={list} getId={v => v.id}
          renderItem={(v, p) => <TVCard id={`cat-${cat}-${v.id}`} title={v.title} subtitle={`${fmtViews(v.views)} просмотров`} imageUrl={thumbFor(v)} aspect="wide" onEnter={() => onPlayVideo(v.id)} autoFocusPriority={p}/>}/>
      ))}
    </div>
  );
};
