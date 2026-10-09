import { useEffect, useRef } from 'react';
import { usePlayerStore } from './playerStore';
import { useAuthStore } from '@/core/auth/store';
import { useMediaPresence } from '@/profile/viewer/mediaPresence';
import { apiMediaTicket as apiMusicTicket } from '@/music/musicApi';
import { apiMediaTicket as apiPodcastTicket } from '@/podcasts/podcastApi';
import { reloadWithFreshTicket } from '@/core/mediaTicketRefresh';

/**
 * Единственный реальный <audio> элемент в приложении.
 * Монтируется один раз на уровне AppShell — переживает переключение
 * табов и модулей, поэтому музыка не обрывается при уходе со вкладки.
 * Управляется исключительно через usePlayerStore (item.srcUrl, isPlaying,
 * seekTo, volume, cmdPlay) — тот же контракт, которым уже пользуется
 * SkyMiniPlayer, так что переключать UI не пришлось.
 */
const KIND_ALBUM: Record<string, string> = {
  music: 'Sky Music', video: 'Sky Video', tv: 'Sky TV', voice: 'Sky', podcast: 'Sky Podcasts',
};

export const PlayerEngine = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const {
    item, isPlaying, volume, seekTo, cmdPlay, repeat,
    syncTime, clearSeek, setPlaying, clearCmd, nextTrack, prevTrack, requestSeek, requestPlay,
  } = usePlayerStore();
  const { currentUserId, accounts } = useAuthStore();
  const setMusicPresence = useMediaPresence(s => s.setMusicPresence);

  const srcUrl = item?.srcUrl;

  /* Экран блокировки / наушники / умные часы должны показывать РЕАЛЬНО
     играющий трек, а не название приложения — раньше здесь вообще не
     было Media Session API, поэтому ОС подставляла свой заголовок
     страницы и иконку по умолчанию вместо обложки и названия трека. */
  useEffect(() => {
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (!ms) return;
    if (!item) { try { ms.metadata = null; } catch { /* не везде есть */ } return; }
    try {
      ms.metadata = new MediaMetadata({
        title: item.title,
        artist: item.author || KIND_ALBUM[item.kind] || 'Sky',
        album: KIND_ALBUM[item.kind] ?? 'Sky',
        artwork: item.coverUrl ? [
          { src: item.coverUrl, sizes: '512x512' },
        ] : [],
      });
      ms.setActionHandler('play', () => requestPlay(true));
      ms.setActionHandler('pause', () => requestPlay(false));
      ms.setActionHandler('previoustrack', item.queue?.length ? () => prevTrack() : null);
      ms.setActionHandler('nexttrack', item.queue?.length ? () => nextTrack() : null);
      ms.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) requestSeek(details.seekTime);
      });
      ms.setActionHandler('seekbackward', () => {
        const a = audioRef.current;
        if (a) requestSeek(Math.max(0, a.currentTime - 10));
      });
      ms.setActionHandler('seekforward', () => {
        const a = audioRef.current;
        if (a) requestSeek(Math.min(a.duration || Infinity, a.currentTime + 10));
      });
    } catch { /* не везде есть */ }
  }, [item?.id, item?.kind, item?.title, item?.author, item?.coverUrl, item?.queue?.length]);

  /* Состояние play/pause на экране блокировки должно совпадать с тем,
     что реально происходит — иначе кнопка там показывает противоположное. */
  useEffect(() => {
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (!ms || !item) return;
    try { ms.playbackState = isPlaying ? 'playing' : 'paused'; } catch { /* не везде есть */ }
  }, [isPlaying, item?.id]);

  /* Сколько треков подряд не заигралось и сколько раз мы пробовали
     переподключиться к текущему. Ref, а не state: перерисовывать плеер
     из-за счётчика незачем. */
  const failsRef = useRef(0);
  const retryRef = useRef(0);
  const passTriedRef = useRef('');

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
      retryRef.current = 0;
      if (isPlaying) a.play().catch(() => setPlaying(false));
    }
  }, [srcUrl]);

  /* Трек заиграл — значит, очередь жива: счётчик неудач обнуляем. */
  const onPlaying = () => { failsRef.current = 0; retryRef.current = 0; };

  /**
   * Перейти к следующему треку, а если следующего нет — остановиться.
   *
   * nextTrack на последнем треке без повтора просто ничего не делает, и
   * плеер оставался «играющим» без звука. Сравниваем трек до и после:
   * не сдвинулись — честно гасим воспроизведение.
   */
  const advanceOrStop = () => {
    const before = usePlayerStore.getState().item?.id;
    nextTrack();
    const after = usePlayerStore.getState().item?.id;
    if (before === after) { setPlaying(false); return false; }
    return true;
  };

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
      onTimeUpdate={() => {
        const a = audioRef.current;
        if (!a) return;
        syncTime(a.currentTime, a.duration || 0);
        const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
        if (ms && Number.isFinite(a.duration) && a.duration > 0) {
          try { ms.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate }); }
          catch { /* не везде есть */ }
        }
      }}
      onLoadedMetadata={() => { const a = audioRef.current; if (a) syncTime(a.currentTime, a.duration || 0); }}
      onPlaying={onPlaying}
      onError={() => {
        const a = audioRef.current;
        if (!a || !srcUrl) return;
        const code = a.error?.code ?? 0;

        // Пропуск на выдачу мог протухнуть (вкладка открыта давно) — тогда
        // файл отвечает 401 и браузер сообщает «формат не поддерживается».
        // Один раз на трек обновляем пропуск и продолжаем с того же места,
        // прежде чем считать трек сломанным и перескакивать дальше.
        const refresh = srcUrl.includes('/api/music/') ? apiMusicTicket
          : srcUrl.includes('/api/podcasts/') ? apiPodcastTicket : null;
        if (refresh && passTriedRef.current !== srcUrl) {
          passTriedRef.current = srcUrl;
          void reloadWithFreshTicket(a, refresh, () => usePlayerStore.getState().item?.srcUrl ?? srcUrl).then((ok) => {
            // Первая попытка уже сбросила «играет» (play() отклонился вместе с
            // загрузкой), а трек выбрали, чтобы слушать, — запускаем заново.
            if (ok) { setPlaying(true); a.play().catch(() => setPlaying(false)); return; }
            failsRef.current = 0; setPlaying(false);
          });
          return;
        }

        // Обрыв связи посреди трека — не повод его выкидывать: связь
        // возвращается. Пробуем один раз с того же места.
        if (code === MediaError.MEDIA_ERR_NETWORK && retryRef.current === 0) {
          const at = a.currentTime;
          retryRef.current = 1;
          a.load();
          a.currentTime = at;
          if (isPlaying) a.play().catch(() => setPlaying(false));
          return;
        }

        // Файл не играется. Раньше плеер молча замирал на нём: кнопка
        // «играет», а звука нет и дальше очередь не идёт. Переходим к
        // следующему — но не по кругу: если не заиграл ни один трек
        // очереди, останавливаемся.
        const len = usePlayerStore.getState().item?.queue?.length ?? 0;
        failsRef.current += 1;
        if (len > 1 && failsRef.current < len && advanceOrStop()) return;
        failsRef.current = 0;
        setPlaying(false);
      }}
      onEnded={() => {
        const a = audioRef.current;
        if (repeat === 'one' && a) { a.currentTime = 0; a.play().catch(() => {}); return; }
        advanceOrStop();
      }}
    />
  );
};
