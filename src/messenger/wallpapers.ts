/* ===============================================================
   ОБОИ ЧАТА — фон за сообщениями: готовые (рисуются кодом, без файлов) или своя картинка.
   Только на этом устройстве: настройки в localStorage, картинка — в IndexedDB; собеседник их не видит.
   Обои можно задать для одного чата или для всех сразу; «Без обоев» у чата перекрывает общие.
=============================================================== */
import { create } from 'zustand';

export interface WallpaperSpec {
  kind: 'none' | 'preset' | 'image';
  id?: string;
  /** Затемнение поверх обоев, 0–80 %. */
  dim: number;
  /** Размытие, 0–20 px. */
  blur: number;
}

export interface WallpaperPreset {
  id: string;
  name: string;
  background: string;
  size?: string;
}

const svg = (body: string, w = 48, h = 48) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;

export const WALLPAPERS: WallpaperPreset[] = [
  { id: 'sunrise',  name: 'Рассвет',   background: 'linear-gradient(160deg,#ff9a76 0%,#ff6f91 50%,#845ec2 100%)' },
  { id: 'ocean',    name: 'Океан',     background: 'linear-gradient(180deg,#0f2027 0%,#203a43 50%,#2c5364 100%)' },
  { id: 'forest',   name: 'Лес',       background: 'linear-gradient(160deg,#134e5e 0%,#3f8f6b 60%,#71b280 100%)' },
  { id: 'night',    name: 'Ночь',
    background: 'radial-gradient(1.5px 1.5px at 20% 30%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 70% 20%,#fff 50%,transparent 51%),radial-gradient(1.5px 1.5px at 40% 70%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 85% 60%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 10% 85%,#fff 50%,transparent 51%),linear-gradient(180deg,#0b1026 0%,#1b2a4e 100%)' },
  { id: 'aurora',   name: 'Сияние',
    background: 'radial-gradient(ellipse at 20% 20%,rgba(52,211,153,.55),transparent 55%),radial-gradient(ellipse at 80% 30%,rgba(99,102,241,.55),transparent 55%),radial-gradient(ellipse at 50% 90%,rgba(236,72,153,.35),transparent 60%),#0b1020' },
  { id: 'sakura',   name: 'Сакура',    background: 'linear-gradient(160deg,#fbc2eb 0%,#a6c1ee 100%)' },
  { id: 'sand',     name: 'Песок',     background: 'linear-gradient(160deg,#f6d365 0%,#fda085 100%)' },
  { id: 'mint',     name: 'Мята',      background: 'linear-gradient(160deg,#d4fc79 0%,#96e6a1 100%)' },
  { id: 'graphite', name: 'Графит',    background: 'linear-gradient(160deg,#232526 0%,#414345 100%)' },
  { id: 'dots',     name: 'Точки',     background: `${svg("<circle cx='6' cy='6' r='1.6' fill='rgba(255,255,255,.14)'/><circle cx='30' cy='30' r='1.6' fill='rgba(255,255,255,.14)'/>")},#14161c`, size: '48px 48px' },
  { id: 'waves',    name: 'Волны',     background: `${svg("<path d='M0 20 Q15 8 30 20 T60 20' fill='none' stroke='rgba(255,255,255,.12)' stroke-width='2'/>", 60, 40)},#10202e`, size: '60px 40px' },
  { id: 'grid',     name: 'Сетка',     background: `${svg("<path d='M40 0H0V40' fill='none' stroke='rgba(255,255,255,.08)' stroke-width='1'/>", 40, 40)},#12141a`, size: '40px 40px' },
  { id: 'triangles',name: 'Грани',     background: `${svg("<path d='M0 48L24 0l24 48z' fill='rgba(255,255,255,.05)'/>")},#181326`, size: '48px 48px' },
];

export const DEFAULT_SPEC: WallpaperSpec = { kind: 'none', dim: 20, blur: 0 };

const SK = 'sky:wallpapers:v1';
const W = typeof window !== 'undefined';

interface Stored { global: WallpaperSpec | null; chats: Record<string, WallpaperSpec> }

const clamp = (n: unknown, lo: number, hi: number, d: number) => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d;
};
const clean = (v: unknown): WallpaperSpec | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<WallpaperSpec>;
  const kind = o.kind === 'preset' || o.kind === 'image' || o.kind === 'none' ? o.kind : 'none';
  const id = typeof o.id === 'string' ? o.id.slice(0, 40) : undefined;
  if (kind === 'preset' && !WALLPAPERS.some((p) => p.id === id)) return { ...DEFAULT_SPEC };
  return { kind, id, dim: clamp(o.dim, 0, 80, 20), blur: clamp(o.blur, 0, 20, 0) };
};
const load = (): Stored => {
  if (!W) return { global: null, chats: {} };
  try {
    const j = JSON.parse(localStorage.getItem(SK) || '{}');
    const chats: Record<string, WallpaperSpec> = {};
    for (const [k, v] of Object.entries(j.chats ?? {})) { const c = clean(v); if (c) chats[k] = c; }
    return { global: clean(j.global), chats };
  } catch { return { global: null, chats: {} }; }
};
const save = (s: Stored) => { try { localStorage.setItem(SK, JSON.stringify(s)); } catch { /* приватный режим — не критично */ } };

interface WpState extends Stored {
  /** Версия картинок: растёт при замене файла, чтобы экран перечитал блоб. */
  imgRev: number;
  set: (scope: 'chat' | 'global', chatId: string | undefined, spec: WallpaperSpec) => void;
  reset: (scope: 'chat' | 'global', chatId?: string) => void;
  bumpImg: () => void;
}

export const useWallpapers = create<WpState>((set, get) => ({
  ...load(),
  imgRev: 0,
  set: (scope, chatId, spec) => {
    const s = get();
    const next: Stored = scope === 'global'
      ? { global: spec, chats: s.chats }
      : { global: s.global, chats: { ...s.chats, [chatId ?? '']: spec } };
    save(next); set(next);
  },
  reset: (scope, chatId) => {
    const s = get();
    const next: Stored = scope === 'global'
      ? { global: null, chats: s.chats }
      : { global: s.global, chats: Object.fromEntries(Object.entries(s.chats).filter(([k]) => k !== chatId)) };
    save(next); set(next);
  },
  bumpImg: () => set({ imgRev: get().imgRev + 1 }),
}));

/** Какие обои действуют в чате и откуда они (для картинки нужен ключ в IndexedDB). */
export const effectiveWallpaper = (s: Stored, chatId?: string): { spec: WallpaperSpec; key: string } => {
  const own = chatId ? s.chats[chatId] : undefined;
  if (own) return { spec: own, key: chatId as string };
  if (s.global) return { spec: s.global, key: 'global' };
  return { spec: DEFAULT_SPEC, key: 'global' };
};

/** Есть ли у чата включённые обои (для прозрачности слоёв интерфейса поверх них). */
export const useHasWallpaper = (chatId?: string): boolean => {
  const global = useWallpapers((s) => s.global);
  const chats = useWallpapers((s) => s.chats);
  return effectiveWallpaper({ global, chats }, chatId).spec.kind !== 'none';
};

/* ─── картинки: IndexedDB ─── */
const DB = 'sky:wallpapers'; const STORE = 'img';
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
export const getWallpaperBlob = async (key: string): Promise<Blob | undefined> => {
  try {
    const db = await open();
    return await new Promise((res) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result as Blob | undefined); q.onerror = () => res(undefined); });
  } catch { return undefined; }
};
export const putWallpaperBlob = async (key: string, blob: Blob): Promise<boolean> => {
  try {
    const db = await open();
    return await new Promise((res) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(blob, key); t.oncomplete = () => res(true); t.onerror = () => res(false); });
  } catch { return false; }
};
export const deleteWallpaperBlob = async (key: string) => {
  try {
    const db = await open();
    await new Promise<void>((res) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(key); t.oncomplete = () => res(); t.onerror = () => res(); });
  } catch { /* нечего чистить */ }
};

/** Своя картинка: только изображение до 15 МБ; уменьшается до 1600 px по большей стороне и пишется JPEG — телефонные снимки по 8 МБ иначе забили бы хранилище. */
export const prepareWallpaper = async (file: File): Promise<{ ok: true; blob: Blob } | { ok: false; reason: string }> => {
  if (!file.type.startsWith('image/')) return { ok: false, reason: 'Выберите картинку (JPG, PNG, WebP).' };
  if (file.size > 15 * 1024 * 1024) return { ok: false, reason: 'Файл больше 15 МБ.' };
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.82));
    return blob ? { ok: true, blob } : { ok: false, reason: 'Не удалось обработать картинку.' };
  } catch { return { ok: false, reason: 'Не удалось прочитать картинку (формат не поддерживается этим устройством).' }; }
};
