/**
 * usePushNotifications
 * ─────────────────────────────────────────────────────────────────────────────
 * Web Notifications API + Page Visibility API
 *
 * • Запрашивает разрешение один раз
 * • Отправляет браузерное уведомление ТОЛЬКО когда вкладка неактивна
 * • При клике на уведомление — фокусирует вкладку и открывает FloatingChat
 * • Экспортирует функцию sendPush(...) для использования в NotifBridge
 */

import { useEffect, useRef, useCallback } from 'react';
import { useFloatingChatStore }           from './floatingChatStore';

const W = typeof window !== 'undefined';

/* ── Permission management ────────────────────────────────────────────── */
export type PermissionState = 'default' | 'granted' | 'denied';

export const getNotifPermission = (): PermissionState => {
  if (!W || !('Notification' in window)) return 'denied';
  return Notification.permission as PermissionState;
};

export const requestNotifPermission = async (): Promise<PermissionState> => {
  if (!W || !('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied')  return 'denied';
  const result = await Notification.requestPermission();
  return result as PermissionState;
};

/* ── Is page hidden? ──────────────────────────────────────────────────── */
const isHidden = () =>
  W && typeof document !== 'undefined' && document.visibilityState === 'hidden';

/* ── Send a Web push notification ─────────────────────────────────────── */
interface PushPayload {
  title:      string;
  body:       string;
  icon?:      string;
  chatId?:    string;
  senderName: string;
  senderLetter: string;
}

const NOTIF_TIMEOUT_MS = 6000;

export const sendWebPush = (payload: PushPayload) => {
  if (!W || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!isHidden()) return; // показываем только когда вкладка неактивна

  try {
    const n = new Notification(payload.title, {
      body:    payload.body,
      icon:    payload.icon ?? '/logo.png',
      badge:   '/logo.png',
      tag:     payload.chatId ?? 'sky-msg',   // группируем по чату
      renotify: true,
      silent:  false,
    });

    // Авто-закрытие
    const timer = setTimeout(() => n.close(), NOTIF_TIMEOUT_MS);

    // Клик → фокус вкладки + открыть мини-чат
    n.onclick = () => {
      clearTimeout(timer);
      n.close();
      try { window.focus(); } catch {}
      if (payload.chatId) {
        useFloatingChatStore.getState().openChat(payload.chatId, payload.senderName, payload.senderLetter);
      }
    };
  } catch {
    // Некоторые браузеры могут бросить ошибку (Safari, Firefox в iframe)
  }
};

/* ── React hook ───────────────────────────────────────────────────────── */
export const usePushNotifications = () => {
  const permRef = useRef<PermissionState>(getNotifPermission());

  useEffect(() => {
    if (!W) return;

    // Запрашиваем разрешение при первом заходе (ненавязчиво — без модалки)
    const key = 'sky:notif:perm:asked';
    if (permRef.current === 'default' && !localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      requestNotifPermission().then(p => { permRef.current = p; });
    }
  }, []);

  const send = useCallback((p: PushPayload) => {
    if (permRef.current !== 'granted') {
      // Повторная попытка получить разрешение
      requestNotifPermission().then(res => {
        permRef.current = res;
        if (res === 'granted') sendWebPush(p);
      });
      return;
    }
    sendWebPush(p);
  }, []);

  return { send, permission: permRef.current, requestPermission: requestNotifPermission };
};
