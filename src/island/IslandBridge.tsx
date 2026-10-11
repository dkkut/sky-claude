/**
 * Источники событий острова. Ничего не выдумывает: каждое событие — это
 * реальное изменение в уже существующем хранилище (уведомления, звонки,
 * плеер, загрузки). Без интерфейса.
 */
import { useEffect, useRef } from 'react';
import { useSettings } from '@/settings/store';
import { useNotifStore, type SkyNotif } from '@/notifications/store';
import { useFloatingChatStore } from '@/notifications/floatingChatStore';
import { useCallStore } from '@/calls/store';
import { usePlayerStore } from '@/player/playerStore';
import { usePlayer as usePodcastPlayer } from '@/podcasts/playerStore';
import { useOfflineMusic } from '@/offline/musicOffline';
import { useModuleStore } from '@/data/state/modules';
import { useMessengerStore } from '@/messenger/store';
import { useIslandStore } from './islandStore';
import { useAiSession } from './aiSession';
import { syncWake, pauseWake, resumeWake } from './wake';

const islandOn = () => useSettings.getState().settings.islandMode !== 'side';
const secs = () => Math.max(2, Math.min(15, useSettings.getState().settings.islandSeconds || 4)) * 1000;

const fromToast = (n: SkyNotif) => {
  const st = useSettings.getState().settings;
  const push = useIslandStore.getState().push;
  if (n.kind === 'call_in') return; // звонок ведёт хранилище звонков (ниже)
  if (n.kind === 'message' || n.kind === 'mention') {
    if (!st.islandMessages) return;
    const body = st.islandPrivacy === 'full' ? n.body : '';
    const title = st.islandPrivacy === 'hidden' ? 'Новое сообщение' : n.title;
    push({
      kind: 'message', mergeKey: `msg:${n.chatId ?? n.title}`, title, body, userText: st.islandPrivacy !== 'hidden',
      letter: st.islandPrivacy === 'hidden' ? undefined : n.avatarLetter, color: n.color, ttl: secs(), count: 1,
      onOpen: () => {
        if (!n.chatId) return;
        useFloatingChatStore.getState().openChat(n.chatId, n.title, n.avatarLetter);
      },
    });
    return;
  }
  push({
    kind: 'system', mergeKey: `sys:${n.kind}:${n.title}`, title: n.title, body: n.body, letter: n.avatarLetter, color: n.color,
    userText: n.kind === 'like' || n.kind === 'comment' || n.kind === 'follow' || n.kind === 'repost', ttl: secs(),
    onOpen: () => {
      if (n.chatId) { useModuleStore.getState().setActiveModule('messages'); useMessengerStore.getState().setActiveChat(n.chatId); }
      else if (n.kind === 'like' || n.kind === 'comment' || n.kind === 'repost') useModuleStore.getState().setActiveModule('bloom');
      else useModuleStore.getState().setActiveModule('notifications');
    },
  });
};

export const IslandBridge = () => {
  const mode = useSettings((s) => s.settings.islandMode);
  const notifsOn = useSettings((s) => s.settings.islandNotifs);
  const wakeOn = useSettings((s) => s.settings.aiWake);
  const seen = useRef<Set<string>>(new Set());

  /* Всплывающие уведомления → остров (и убираем дубль-тост). */
  useEffect(() => {
    if (mode === 'side' || !notifsOn) return undefined;
    const handle = (toasts: SkyNotif[]) => {
      for (const t of toasts) {
        if (seen.current.has(t.id)) continue;
        seen.current.add(t.id);
        if (seen.current.size > 200) seen.current = new Set([...seen.current].slice(-100));
        fromToast(t);
        useNotifStore.getState().dismissToast(t.id);
      }
    };
    handle(useNotifStore.getState().toasts);
    return useNotifStore.subscribe((s, p) => { if (s.toasts !== p.toasts) handle(s.toasts); });
  }, [mode, notifsOn]);

  /* Входящий звонок: держится, пока звонок звонит. */
  useEffect(() => {
    if (mode === 'side') return undefined;
    const sync = (inc: ReturnType<typeof useCallStore.getState>['incoming']) => {
      if (!inc) { useIslandStore.getState().resolve('call'); return; }
      useIslandStore.getState().push({
        kind: 'call', mergeKey: 'call', ttl: 0, color: '#34d399', userText: true,
        title: inc.callerName, body: inc.mode === 'video' ? 'Видеозвонок' : 'Звонок', letter: inc.callerAvatar,
        actions: [
          { label: 'Принять', primary: true, run: () => { void useCallStore.getState().acceptIncoming(); } },
          { label: 'Отклонить', run: () => useCallStore.getState().declineIncoming() },
        ],
      });
    };
    sync(useCallStore.getState().incoming);
    return useCallStore.subscribe((s, p) => { if (s.incoming?.callId !== p.incoming?.callId) sync(s.incoming); });
  }, [mode]);

  /* Смена трека. Первый запуск и пауза — не «смена». */
  useEffect(() => {
    if (mode === 'side') return undefined;
    let lastKey = '';
    const announce = (key: string, title: string, sub: string, cover?: string) => {
      if (key === lastKey) return;
      const had = lastKey !== '';
      lastKey = key;
      const st = useSettings.getState().settings;
      if (!had || !st.islandTracks || !islandOn()) return;
      useIslandStore.getState().push({ kind: 'track', mergeKey: 'track', title, body: sub, cover, userText: true, ttl: 3000 });
    };
    const m = usePlayerStore.subscribe((s, p) => { if (s.item?.id !== p.item?.id && s.item && s.isPlaying) announce(`m:${s.item.id}`, s.item.title, s.item.author, s.item.coverUrl); else if (s.item && s.item.id !== p.item?.id) lastKey = `m:${s.item.id}`; });
    const pd = usePodcastPlayer.subscribe((s, p) => { if (s.episode?.id !== p.episode?.id && s.episode) announce(`p:${s.episode.id}`, s.episode.title, s.episode.podcastTitle ?? ''); });
    return () => { m(); pd(); };
  }, [mode]);

  /* Пачка скачиваний закончилась. */
  useEffect(() => {
    if (mode === 'side') return undefined;
    return useOfflineMusic.subscribe((s, p) => {
      const st = useSettings.getState().settings;
      if (!(p.bulk?.running && s.bulk && !s.bulk.running) || !st.islandDownloads) return;
      const { done, failed, total } = s.bulk;
      useIslandStore.getState().push({
        kind: 'download', mergeKey: 'dl', ttl: 5000, color: failed ? '#f59e0b' : '#34d399',
        title: failed ? 'Скачано не всё' : 'Скачивание завершено',
        body: failed ? `Скачано ${done} из ${total}, не удалось ${failed}` : `Скачано треков: ${done}`,
        onOpen: () => { useModuleStore.getState().setActiveModule('extras'); useModuleStore.getState().setPendingExtrasTab('music'); },
      });
    });
  }, [mode]);

  /* Фраза «Привет, Скай»: только пока вкладка видна и пока включена. */
  useEffect(() => {
    syncWake(wakeOn && mode !== 'side');
    const onVis = () => { if (document.visibilityState === 'visible') resumeWake(); else pauseWake(); };
    document.addEventListener('visibilitychange', onVis);
    const unsub = useAiSession.subscribe((s, p) => { if (p.phase !== 'off' && s.phase === 'off') resumeWake(); });
    return () => { document.removeEventListener('visibilitychange', onVis); unsub(); syncWake(false); };
  }, [wakeOn, mode]);

  /* Выход из режима «только боковой плеер» гасит остров. */
  useEffect(() => {
    if (mode === 'side') { useIslandStore.getState().clear(); useAiSession.getState().stop(); }
  }, [mode]);

  return null;
};
