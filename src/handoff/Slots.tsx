/** Готовые кнопки «Продолжить на другом устройстве» для плееров, у которых состояние лежит в общих хранилищах (музыка, подкасты). */
import { usePlayerStore } from '@/player/playerStore';
import { usePlayer as usePodcastPlayer } from '@/podcasts/playerStore';
import { ContinueOnDevice, type Variant } from './ContinueButton';

interface SlotProps { variant?: Variant; label?: boolean; tvScope?: string; className?: string; style?: React.CSSProperties }

export const MusicContinue = (p: SlotProps) => {
  const item = usePlayerStore((s) => (s.item?.kind === 'music' ? s.item : null));
  if (!item) return null;
  return <ContinueOnDevice {...p} kind="music" itemId={item.id} title={item.title}
    read={() => { const s = usePlayerStore.getState(); return { position: s.currentTime, duration: s.duration }; }}
    pause={() => usePlayerStore.getState().requestPlay(false)} resume={() => usePlayerStore.getState().requestPlay(true)} />;
};

export const PodcastContinue = (p: SlotProps) => {
  const ep = usePodcastPlayer((s) => s.episode);
  if (!ep) return null;
  return <ContinueOnDevice {...p} kind="podcast" itemId={ep.id} title={ep.title}
    read={() => { const s = usePodcastPlayer.getState(); return { position: s.currentTime, duration: s.duration }; }}
    pause={() => { const s = usePodcastPlayer.getState(); if (s.playing) s.toggle(); }} resume={() => { const s = usePodcastPlayer.getState(); if (!s.playing) s.toggle(); }} />;
};
