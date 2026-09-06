import { useEffect, useRef } from 'react';
import { usePlayerStore } from './playerStore';
import { useAuthStore } from '@/core/auth/store';
import { useMediaPresence } from '@/profile/viewer/mediaPresence';

/**
 * Единственный реальный <audio> элемент в приложении.
 * Монтируется один раз на уровне AppShell — переживает переключение
 * табов и модулей, поэтому музыка не обрывается при уходе со вкладки.
 * Управляется исключительно через usePlayerStore (item.srcUrl, isPlaying,
 * seekTo, volume, cmdPlay) — тот же контракт, которым уже пользуется
 * SkyMiniPlayer, так что переключать UI не пришлось.
 */
export const PlayerEngine = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const {
    item, isPlaying, volume, seekTo, cmdPlay, repeat,
    syncTime, clearSeek, setPlaying, clearCmd, nextTrack,
  } = usePlayerStore();
  const { currentUserId, accounts } = useAuthStore();
  const setMusicPresence = useMediaPresence(s => s.setMusicPresence);

  const srcUrl = item?.srcUrl;

  /* «Сейчас слушает музыку» — реальный live-статус в профиле,
     выключается автоматически, если владелец скрыл showMusic. */
  useEffect(() => {
    if (!currentUserId) return;
    const me = accounts.find(a => a.id === currentUserId);
    const allowed = me?.privacy?.showMusic ?? true;
    if (item?.kind === 'music' && isPlaying && allowed) {
      setMusicPresence({ userId: currentUserId, title: item.title, artist: item.author, coverUrl: item.coverUrl }, currentUserId);
    } else {
      setMusicPresence(null, currentUserId);
    }
  }, [item?.id, item?.kind, isPlaying, currentUserId]);

  /* Периодически «подтверждаем» presence, пока играет — иначе она
     протухнет через 2 минуты по TTL в mediaPresence.ts */
  useEffect(() => {
    if (!currentUserId || item?.kind !== 'music' || !isPlaying) return;
    const me = accounts.find(a => a.id === currentUserId);
    if (!(me?.privacy?.showMusic ?? true)) return;
    const t = setInterval(() => {
      setMusicPresence({ userId: currentUserId, title: item.title, artist: item.author, coverUrl: item.coverUrl }, currentUserId);
    }, 60_000);
    return () => clearInterval(t);
  }, [item?.id, isPlaying, currentUserId]);

  /* Смена трека — подставляем источник и продолжаем/начинаем воспроизведение */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!srcUrl) { a.pause(); return; }
    if (a.src !== srcUrl) {
      a.src = srcUrl;
      a.currentTime = 0;
      if (isPlaying) a.play().catch(() => setPlaying(false));
    }
  }, [srcUrl]);

  /* Play / pause */
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !srcUrl) return;
    if (isPlaying) a.play().catch(() => setPlaying(false));
    else a.pause();
  }, [isPlaying, srcUrl]);

  /* Громкость */
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  /* Команды play/pause из мини-плеера (тот же канал, что слушали локальные движки) */
  useEffect(() => {
    if (cmdPlay === null) return;
    setPlaying(cmdPlay);
    clearCmd();
  }, [cmdPlay]);

  /* Перемотка по запросу (прогресс-бар мини-плеера / вкладки музыки) */
  useEffect(() => {
    if (seekTo === null) return;
    const a = audioRef.current;
    if (a && srcUrl) a.currentTime = seekTo;
    clearSeek();
  }, [seekTo]);

  return (
    <audio
      ref={audioRef}
      id="sky-player-audio"
      crossOrigin="anonymous"
      style={{ display: 'none' }}
      onTimeUpdate={() => { const a = audioRef.current; if (a) syncTime(a.currentTime, a.duration || 0); }}
      onLoadedMetadata={() => { const a = audioRef.current; if (a) syncTime(a.currentTime, a.duration || 0); }}
      onEnded={() => {
        const a = audioRef.current;
        if (repeat === 'one' && a) { a.currentTime = 0; a.play().catch(() => {}); return; }
        nextTrack();
      }}
    />
  );
};
