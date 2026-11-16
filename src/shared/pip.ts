/** «Картинка в картинке» для <video>: стандартный API (Chrome, Edge, Windows-приложение, Safari 13.1+/iOS) и запасной режим Safari.
 *  Кнопка показывается только там, где браузер сам сообщает о поддержке: в обычном Android-WebView (приложение Sky) её нет — тогда кнопки просто нет. */
import { useEffect, useState } from 'react';

type SafariVideo = HTMLVideoElement & { webkitSupportsPresentationMode?: (m: string) => boolean; webkitSetPresentationMode?: (m: string) => void; webkitPresentationMode?: string };

export const pipSupported = (v?: HTMLVideoElement | null): boolean => {
  if (!v) return false;
  const std = 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled && !v.disablePictureInPicture;
  const sv = v as SafariVideo;
  return Boolean(std || (typeof sv.webkitSupportsPresentationMode === 'function' && sv.webkitSupportsPresentationMode('picture-in-picture')));
};
export const pipActive = (v?: HTMLVideoElement | null): boolean => !!v && (document.pictureInPictureElement === v || (v as SafariVideo).webkitPresentationMode === 'picture-in-picture');

export const togglePip = async (v?: HTMLVideoElement | null): Promise<'on' | 'off' | 'error'> => {
  if (!v) return 'error';
  try {
    if (pipActive(v)) { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else (v as SafariVideo).webkitSetPresentationMode?.('inline'); return 'off'; }
    if (typeof v.requestPictureInPicture === 'function' && document.pictureInPictureEnabled) await v.requestPictureInPicture(); else (v as SafariVideo).webkitSetPresentationMode?.('picture-in-picture');
    return 'on';
  } catch { return 'error'; }
};

/** Поддержка и состояние для кнопки. Элемент <video> появляется после монтирования, поэтому проверка — по событиям и при смене ссылки. */
export const usePip = (ref: React.RefObject<HTMLVideoElement | null>, dep?: unknown) => {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const v = ref.current; if (!v) return;
    const sync = () => { setSupported(pipSupported(v)); setActive(pipActive(v)); };
    sync();
    const evs = ['loadedmetadata', 'enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged'];
    evs.forEach((e) => v.addEventListener(e, sync));
    return () => evs.forEach((e) => v.removeEventListener(e, sync));
  }, [ref, dep]);
  return { supported, active };
};
