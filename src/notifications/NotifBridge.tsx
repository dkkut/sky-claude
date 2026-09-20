/**
 * NotifBridge  —  невидимый компонент, слушает события из всех модулей
 * и автоматически создаёт уведомления.
 *
 * Источники:
 * - messenger/socket.ts  —  входящие сообщения (событие окна
 *   'sky:incoming-message'; раньше это был BroadcastChannel, но
 *   сообщения теперь приходят с сервера, а не из соседней вкладки)
 * - calls/store.ts  —  входящие и пропущенные звонки
 * - bloom  —  лайки, комментарии и подписки; Bloom не держит свой
 *   websocket, поэтому реальные новые события опрашиваются периодически
 *   через /api/bloom/events (см. server/bloom.mjs::recentEvents) —
 *   не выдуманные данные, просто без сокета, как у мессенджера
 *
 * Новое:
 * - Web Notifications API (push при неактивной вкладке)
 * - Page Visibility API (определяем когда вкладка скрыта)
 */
import { useEffect, useRef } from 'react';
import { playMessageSound, playMentionSound } from '@/audio/sounds';
import { useSettings }         from '@/settings/store';
import { useNotifStore }       from './store';
import { useAuthStore }        from '@/core/auth/store';
import { useCallStore }        from '@/calls/store';
import { useModuleStore }      from '@/data/state/modules';
import { usePushNotifications } from './usePushNotifications';
import { apiBloomEvents } from '@/bloom/bloomApi';

const BLOOM_POLL_MS = 20_000;

export const NotifBridge = () => {
  const push          = useNotifStore(s => s.push);
  const { settings }  = useSettings();
  const activeModule  = useModuleStore(s => s.activeModule);
  const activeModRef  = useRef(activeModule);
  activeModRef.current = activeModule;

  const incomingCall  = useCallStore(s => s.incoming);
  const activeCall    = useCallStore(s => s.active);
  const prevIncoming  = useRef<string | null>(null);
  const prevActive    = useRef<typeof activeCall>(null);

  // Web Push hook
  const { send: sendWebPush } = usePushNotifications();

  // -- Входящий звонок → уведомление --------------------------------
  useEffect(() => {
    if (!incomingCall) {
      if (prevIncoming.current && !activeCall) {
        const name = prevIncoming.current;
        push({
          kind:         'call_missed',
          title:        'Пропущенный звонок',
          body:         `Вы пропустили звонок от ${name}`,
          avatarLetter: name[0]?.toUpperCase() ?? '?',
          color:        'var(--red)',
        });
      }
      prevIncoming.current = null;
      return;
    }
    prevIncoming.current = incomingCall.callerName;

    push({
      kind:         'call_in',
      title:        incomingCall.callerName,
      body:         `Входящий ${incomingCall.mode === 'video' ? 'видео' : 'голосовой'} звонок`,
      avatarLetter: incomingCall.callerAvatar,
      color:        'var(--green)',
    });
  }, [incomingCall?.callId]);

  // -- Входящие сообщения от сервера ----------------------------------
  useEffect(() => {
    const onIncoming = (e: Event) => {
      const { message: msg, senderName } = (e as CustomEvent).detail ?? {};
      const myId = useAuthStore.getState().currentUserId;
      if (!msg || !myId || msg.authorId === myId) return;

      const name   = senderName || 'Кто-то';
      const letter = name[0]?.toUpperCase() ?? '?';

      const body = msg.kind === 'text'
        ? (msg.text.length > 60 ? msg.text.slice(0, 57) + '...' : msg.text)
        : msg.kind === 'photo'  ? 'Фото'
        : msg.kind === 'voice'  ? 'Голосовое'
        : msg.kind === 'file'   ? (msg.fileName ?? 'Файл')
        : 'Сообщение';

      const myAccount = useAuthStore.getState().accounts.find(a => a.id === myId);
      const isMention = !!myAccount && msg.text?.includes(`@${myAccount.username}`);

      if (settings.soundMessages) {
        if (isMention && settings.soundMentions) playMentionSound();
        else playMessageSound();
      }

      // 1️⃣ Внутренний тост (всегда)
      push({
        kind:         isMention ? 'mention' : 'message',
        title:        name,
        body,
        avatarLetter: letter,
        color:        'var(--accent)',
        chatId:       msg.chatId,
      });

      // 2️⃣ Web Push (только когда вкладка неактивна и push разрешён).
      // Раньше тумблер «Push-уведомления браузера» лишь спрашивал
      // разрешение, а уведомления уходили независимо от него.
      if (!settings.desktopNotifs) return;
      sendWebPush({
        title:        name,
        body,
        chatId:       msg.chatId,
        senderName:   name,
        senderLetter: letter,
      });
    };

    window.addEventListener('sky:incoming-message', onIncoming);
    return () => window.removeEventListener('sky:incoming-message', onIncoming);
  }, [sendWebPush, push, settings.soundMessages, settings.soundMentions, settings.desktopNotifs]);

  // -- Не удалось дозвониться -----------------------------------------
  useEffect(() => {
    const onUnavailable = (e: Event) => {
      const { peerName } = (e as CustomEvent).detail ?? {};
      const name = peerName || 'Собеседник';
      push({
        kind:         'call_missed',
        title:        'Не удалось дозвониться',
        body:         `${name} сейчас не в сети`,
        avatarLetter: name[0]?.toUpperCase() ?? '?',
        color:        'var(--red)',
      });
    };
    window.addEventListener('sky:call-unavailable', onUnavailable);
    return () => window.removeEventListener('sky:call-unavailable', onUnavailable);
  }, [push]);

  // -- Bloom  —  лайки, комментарии, новые подписчики -------------------
  // Нет своего сокета (как у мессенджера) — опрашиваем реальные новые
  // события с сервера и толкаем их в тот же useNotifStore. sinceRef
  // двигаем по часам сервера (ответ возвращает now), а не клиента —
  // иначе рассинхрон часов мог бы или потерять событие, или повторить.
  const currentUserId = useAuthStore(s => s.currentUserId);
  const bloomSinceRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!currentUserId) return;
    bloomSinceRef.current = Date.now();
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      const { events, now } = await apiBloomEvents(bloomSinceRef.current);
      bloomSinceRef.current = now;
      for (const ev of events) {
        const letter = ev.actorName[0]?.toUpperCase() ?? '?';
        if (ev.kind === 'like') {
          push({ kind: 'like', title: ev.actorName, body: 'Оценил ваш пост в Bloom',
            avatarLetter: letter, color: 'var(--red)', postId: ev.postId });
        } else if (ev.kind === 'comment') {
          const preview = ev.text && ev.text.length > 50 ? ev.text.slice(0, 47) + '...' : (ev.text || 'Оставил комментарий');
          push({ kind: 'comment', title: ev.actorName, body: preview,
            avatarLetter: letter, color: 'var(--accent)', postId: ev.postId });
        } else {
          push({ kind: 'follow', title: ev.actorName, body: 'Подписался(-ась) на вас в Bloom',
            avatarLetter: letter, color: 'var(--green)' });
        }
      }
    };

    const id = setInterval(tick, BLOOM_POLL_MS);
    void tick();
    return () => { stopped = true; clearInterval(id); };
  }, [currentUserId, push]);

  return null;
};
