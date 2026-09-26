/* ===========================================================
   PC Quick Actions — мост со стороны ОСНОВНОГО окна Electron.

   Единственное место, которое реально трогает плеер: overlay
   (QuickActionsShell) — только пульт, он не держит собственного
   <audio>. Здесь: на каждое изменение музыки/подкаста в основном окне
   шлём объединённое состояние в overlay через главный процесс, и
   выполняем команды, которые overlay прислал обратно.

   Активируется только в Electron (isElectron()) и только когда ЭТО
   окно не является самим overlay (!isQuickActionsWindow()) — иначе
   получился бы бессмысленный цикл «overlay слушает сам себя».
=========================================================== */
import { useEffect } from 'react';
import { usePlayerStore } from '@/player/playerStore';
import { usePlayer as usePodcastPlayer } from '@/podcasts/playerStore';
import { isElectron, type SkyPlayerState, type SkyPlayerCommand } from '@/core/nativeApp';
import { isQuickActionsWindow } from './useQuickActionsWindow';

const computeState = (): SkyPlayerState => {
  const podcast = usePodcastPlayer.getState();
  if (podcast.episode) {
    return {
      kind: 'podcast',
      title: podcast.episode.title,
      author: podcast.episode.podcastTitle ?? '',
      isPlaying: podcast.playing,
      currentTime: podcast.currentTime,
      duration: podcast.duration,
    };
  }
  const music = usePlayerStore.getState();
  if (music.item) {
    return {
      kind: 'music',
      title: music.item.title,
      author: music.item.author,
      coverUrl: music.item.coverUrl,
      isPlaying: music.isPlaying,
      currentTime: music.currentTime,
      duration: music.duration,
    };
  }
  return { kind: null, title: '', author: '', isPlaying: false, currentTime: 0, duration: 0 };
};

export const useMainWindowPlayerBridge = () => {
  useEffect(() => {
    if (!isElectron() || isQuickActionsWindow()) return;

    const push = () => window.sky!.quickActions.sendPlayerState(computeState());
    push();
    const offMusic = usePlayerStore.subscribe(push);
    const offPodcast = usePodcastPlayer.subscribe(push);

    const offCommand = window.sky!.quickActions.onPlayerCommand((cmd: SkyPlayerCommand) => {
      const podcast = usePodcastPlayer.getState();
      if (podcast.episode) {
        if (cmd.type === 'toggle') podcast.toggle();
        if (cmd.type === 'skip') podcast.skip(cmd.deltaSec);
        return;
      }
      const music = usePlayerStore.getState();
      if (!music.item) return;
      if (cmd.type === 'toggle') music.setPlaying(!music.isPlaying);
      if (cmd.type === 'next') music.nextTrack();
      if (cmd.type === 'prev') music.prevTrack();
    });

    return () => { offMusic(); offPodcast(); offCommand(); };
  }, []);
};
