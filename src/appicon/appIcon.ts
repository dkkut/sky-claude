/**
 * Сменные иконки Sky: в браузере меняется значок вкладки и иконка «на экран Домой» (apple-touch-icon),
 * в Windows-приложении — значок окна и трея, на Android — настоящая иконка на рабочем столе (activity-alias).
 * Картинка рисуется на canvas из /logo.png поверх цвета варианта, отдельных файлов у вариантов нет.
 * Важно: иконка уже установленного PWA и файла .exe задаётся при установке и отсюда не меняется; на iOS своих иконок пока нет.
 */
import { registerPlugin } from '@capacitor/core';

export interface IconVariant { id: string; name: string; bg: string; bg2: string }
export const ICON_VARIANTS: IconVariant[] = [
  { id: 'classic', name: 'Классика', bg: '#0e0e11', bg2: '#1c1c26' },
  { id: 'violet', name: 'Фиолет', bg: '#5b3df5', bg2: '#8b7cff' },
  { id: 'ocean', name: 'Океан', bg: '#0a6cff', bg2: '#4fb0ff' },
  { id: 'mint', name: 'Мята', bg: '#0f9d78', bg2: '#3fd6a8' },
  { id: 'sunset', name: 'Закат', bg: '#ff6a3d', bg2: '#ffb347' },
  { id: 'rose', name: 'Роза', bg: '#e0407a', bg2: '#ff8fb1' },
  { id: 'gold', name: 'Золото', bg: '#b9831a', bg2: '#f1c24f' },
];
const KEY = 'sky:appicon:v1';
const AppIcon = registerPlugin<{ set: (o: { name: string }) => Promise<void> }>('AppIcon');
const isAndroidApp = () => Boolean((window as any).Capacitor?.isNativePlatform?.()) && (window as any).Capacitor?.getPlatform?.() === 'android';

export const currentIconId = (): string => { try { const v = localStorage.getItem(KEY); return ICON_VARIANTS.some((x) => x.id === v) ? (v as string) : 'classic'; } catch { return 'classic'; } };

let logo: Promise<HTMLImageElement> | null = null;
const loadLogo = () => (logo ??= new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = '/logo.png'; }));

/** PNG-картинка варианта (data:URL) нужного размера. */
export const drawIcon = async (v: IconVariant, size = 256): Promise<string> => {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const g = c.getContext('2d')!;
  const r = size * 0.22; g.beginPath(); g.roundRect(0, 0, size, size, r); g.clip();
  const grad = g.createLinearGradient(0, 0, size, size); grad.addColorStop(0, v.bg2); grad.addColorStop(1, v.bg);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  try { const img = await loadLogo(); const p = size * 0.16; g.drawImage(img, p, p, size - p * 2, size - p * 2); } catch { /* без логотипа остаётся цветной фон */ }
  return c.toDataURL('image/png');
};

const setLink = (rel: string, href: string, extra: Record<string, string> = {}) => {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"][data-sky-icon]`);
  if (!el) { el = document.createElement('link'); el.rel = rel; el.setAttribute('data-sky-icon', '1'); document.head.appendChild(el); }
  Object.entries(extra).forEach(([k, val]) => el!.setAttribute(k, val));
  el.href = href;
  document.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]:not([data-sky-icon])`).forEach((o) => o.remove());
};

/** Применить вариант на этом устройстве. Возвращает, что удалось. */
export const applyIcon = async (id: string): Promise<{ ok: boolean; where: string[]; note?: string }> => {
  const v = ICON_VARIANTS.find((x) => x.id === id); if (!v) return { ok: false, where: [] };
  try { localStorage.setItem(KEY, id); } catch { /* ok */ }
  const where: string[] = [];
  if (id === 'classic' && !(window as any).sky?.setAppIcon) {
    document.querySelectorAll('link[data-sky-icon]').forEach((e) => e.remove());   // вернуть значки из index.html
  } else {
    const url = await drawIcon(v, 256);
    setLink('icon', url, { type: 'image/png' }); setLink('apple-touch-icon', url);
  }
  where.push('вкладка браузера');
  const sky = (window as any).sky;
  if (sky?.setAppIcon) { const r = await sky.setAppIcon(await drawIcon(v, 256)).catch(() => null); if (r?.ok) where.push('окно и трей Windows'); }
  if (isAndroidApp()) {
    try { await AppIcon.set({ name: id }); where.push('иконка на рабочем столе'); }
    catch { return { ok: false, where, note: 'Не удалось сменить иконку на рабочем столе (нужна свежая версия приложения).' }; }
  }
  return { ok: true, where };
};

/** При запуске вернуть выбранное (в браузере и Windows; на Android иконку держит система). */
export const restoreIcon = () => { const id = currentIconId(); if (id !== 'classic' || (window as any).sky?.setAppIcon) void applyIcon(id).catch(() => {}); };
