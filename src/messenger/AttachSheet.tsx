/**
 * Вложения как в Телеграме: нижняя шторка с вкладками (Камера / Галерея / Подарок / Файл / Геолокация / Опрос / Звук)
 * и экран предпросмотра выбранных фото и видео с подписью, поворотом, обрезкой, рисованием и выбором качества.
 *
 * Честно о границах: браузер не отдаёт приложению список последних снимков устройства, поэтому вместо сетки
 * «недавних» есть кнопка выбора из галереи (системное окно, можно отметить несколько). Видео уходит как есть —
 * сжатие и правка работают только для фото.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  X, Camera, Images, Gift, FileText, MapPin, BarChart2, Music2, Send, RotateCw, Crop, Pencil, Trash2, Check, Undo2, Plus,
} from 'lucide-react';

export interface AttachAction {
  camera?: boolean;
  onCamera: () => void;
  onGallery: () => void;
  onGift: () => void;
  onFile: () => void;
  onLocation: () => void;
  onPoll: () => void;
  onAudio: () => void;
}

/* ── Шторка выбора ─────────────────────────────────────────────── */

export const AttachSheet = ({ accent, a, onClose }: { accent: string; a: AttachAction; onClose: () => void }) => {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const done = (fn: () => void) => () => { onClose(); fn(); };
  const tabs = [
    { icon: Images, label: 'Галерея', run: a.onGallery },
    { icon: Gift, label: 'Подарок', run: a.onGift },
    { icon: FileText, label: 'Файл', run: a.onFile },
    { icon: MapPin, label: 'Геолокация', run: a.onLocation },
    { icon: BarChart2, label: 'Опрос', run: a.onPoll },
    { icon: Music2, label: 'Звук', run: a.onAudio },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[10040]" onClick={onClose}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[560px] rounded-t-[28px] px-4 pt-2.5"
        style={{ background: 'var(--bg-l2, #1e2c3a)', paddingBottom: 'calc(var(--safe-bottom, 0px) + 16px)', boxShadow: '0 -12px 48px rgba(0,0,0,0.5)' }}
        role="dialog" aria-label="Вложение" onClick={e => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: 'rgba(255,255,255,0.25)' }} />
        <div className="mb-3 grid grid-cols-2 gap-2.5">
          <button type="button" onClick={done(a.onGallery)}
            className="flex h-[132px] flex-col items-center justify-center gap-2 rounded-2xl"
            style={{ background: `${accent}22`, color: 'var(--t1)' }}>
            <Images size={30} style={{ color: accent }} />
            <span className="text-sm font-semibold">Выбрать из галереи</span>
            <span className="px-3 text-center text-[11px]" style={{ color: 'var(--t3)' }}>Можно отметить несколько фото и видео</span>
          </button>
          <button type="button" onClick={done(a.onCamera)}
            className="flex h-[132px] flex-col items-center justify-center gap-2 rounded-2xl"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--t1)' }}>
            <Camera size={30} style={{ color: accent }} />
            <span className="text-sm font-semibold">Камера</span>
            <span className="px-3 text-center text-[11px]" style={{ color: 'var(--t3)' }}>Снять и сразу отправить</span>
          </button>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {tabs.map(({ icon: Icon, label, run }) => (
            <button key={label} type="button" onClick={done(run)} className="flex min-w-0 flex-col items-center gap-1 rounded-2xl py-2"
              style={{ color: 'var(--t2)' }}>
              <span className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <Icon size={19} style={{ color: accent }} />
              </span>
              <span className="w-full truncate text-center text-[10.5px]">{label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
};

/* ── Работа с картинкой ────────────────────────────────────────── */

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('image')); img.src = src;
});
const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));
const isGifLike = (f: File) => /gif|svg/i.test(f.type);

/** Заменяет имя на то же с расширением нового типа. */
const renamed = (name: string, mime: string) => {
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  return name.replace(/\.[^.]+$/, '') + '.' + ext;
};

/** Повернуть на 90° по часовой. */
const rotateFile = async (file: File, url: string): Promise<File> => {
  const img = await loadImage(url);
  const c = document.createElement('canvas'); c.width = img.naturalHeight; c.height = img.naturalWidth;
  const g = c.getContext('2d')!; g.translate(c.width / 2, c.height / 2); g.rotate(Math.PI / 2); g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const b = await toBlob(c, type, 0.92); if (!b) return file;
  return new File([b], renamed(file.name, type), { type });
};

const cropFile = async (file: File, url: string, ratio: number): Promise<File> => {
  const img = await loadImage(url);
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w / h > ratio) w = Math.round(h * ratio); else h = Math.round(w / ratio);
  const sx = Math.round((img.naturalWidth - w) / 2), sy = Math.round((img.naturalHeight - h) / 2);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const b = await toBlob(c, type, 0.92); if (!b) return file;
  return new File([b], renamed(file.name, type), { type });
};

/** Уменьшение и пересжатие перед отправкой. Если стало больше исходника — отправляем исходник. */
const compressFile = async (file: File, url: string, hd: boolean): Promise<File> => {
  if (isGifLike(file) || !file.type.startsWith('image/')) return file;
  const img = await loadImage(url);
  const max = hd ? 2560 : 1280;
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1 && hd) return file;
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const b = await toBlob(c, 'image/jpeg', hd ? 0.9 : 0.72); if (!b) return file;
  if (b.size >= file.size && k === 1) return file;
  return new File([b], renamed(file.name, 'image/jpeg'), { type: 'image/jpeg' });
};

interface Item { id: string; file: File; url: string; video: boolean }
const COLORS = ['#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#000000'];
const CROPS: { label: string; ratio: number | null }[] = [
  { label: 'Свободно', ratio: null }, { label: '1:1', ratio: 1 }, { label: '4:3', ratio: 4 / 3 }, { label: '3:4', ratio: 3 / 4 }, { label: '16:9', ratio: 16 / 9 },
];

/* ── Экран предпросмотра ───────────────────────────────────────── */

export const MediaComposer = ({ files, accent, onSend, onClose, onAddMore }: {
  files: File[]; accent: string;
  onSend: (items: { file: File; caption: string }[]) => void | Promise<void>;
  onClose: () => void; onAddMore: () => void;
}) => {
  const mk = useCallback((f: File): Item => ({ id: Math.random().toString(36).slice(2), file: f, url: URL.createObjectURL(f), video: f.type.startsWith('video/') }), []);
  const [items, setItems] = useState<Item[]>(() => files.map(mk));
  const [idx, setIdx] = useState(0);
  const [caption, setCaption] = useState('');
  const [hd, setHd] = useState(false);
  const [tool, setTool] = useState<'none' | 'crop' | 'draw'>('none');
  const [color, setColor] = useState(COLORS[1]);
  const [busy, setBusy] = useState(false);
  const urls = useRef<string[]>([]);
  urls.current = items.map((i) => i.url);
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  // Добавили файлы из «ещё» — дописываем.
  const known = useRef(files.length);
  useEffect(() => {
    if (files.length > known.current) { setItems((p) => [...p, ...files.slice(known.current).map(mk)]); known.current = files.length; }
  }, [files, mk]);

  const cur = items[Math.min(idx, items.length - 1)];
  const imgRef = useRef<HTMLImageElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<{ c: string; p: [number, number][] }[]>([]);
  const drawing = useRef(false);

  const replace = (id: string, f: File) => setItems((p) => p.map((i) => {
    if (i.id !== id) return i;
    URL.revokeObjectURL(i.url);
    return { ...i, file: f, url: URL.createObjectURL(f) };
  }));
  const remove = (id: string) => setItems((p) => { const n = p.filter((i) => i.id !== id); if (n.length === 0) setTimeout(onClose, 0); return n; });

  const redraw = useCallback(() => {
    const cv = cvRef.current; const img = imgRef.current; if (!cv || !img) return;
    const g = cv.getContext('2d')!; g.clearRect(0, 0, cv.width, cv.height);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of strokes.current) {
      g.strokeStyle = s.c; g.lineWidth = Math.max(4, cv.width / 120); g.beginPath();
      s.p.forEach(([x, y], i) => (i ? g.lineTo(x * cv.width, y * cv.height) : g.moveTo(x * cv.width, y * cv.height)));
      g.stroke();
    }
  }, []);

  const startDraw = () => { strokes.current = []; setTool('draw'); };
  useEffect(() => {
    if (tool !== 'draw') return;
    const cv = cvRef.current; const img = imgRef.current; if (!cv || !img) return;
    cv.width = img.naturalWidth; cv.height = img.naturalHeight; redraw();
  }, [tool, cur?.url, redraw]);

  const pt = (e: React.PointerEvent): [number, number] => {
    const r = cvRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const finishDraw = async (save: boolean) => {
    if (save && cur && strokes.current.length && cvRef.current) {
      const img = await loadImage(cur.url);
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d')!; g.drawImage(img, 0, 0); g.drawImage(cvRef.current, 0, 0);
      const type = cur.file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const b = await toBlob(c, type, 0.92);
      if (b) replace(cur.id, new File([b], renamed(cur.file.name, type), { type }));
    }
    strokes.current = []; setTool('none');
  };

  const send = async () => {
    if (busy) return; setBusy(true);
    try {
      const out: { file: File; caption: string }[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const f = it.video ? it.file : await compressFile(it.file, it.url, hd).catch(() => it.file);
        out.push({ file: f, caption: i === 0 ? caption.trim() : '' });
      }
      await onSend(out);
    } finally { setBusy(false); }
  };

  const tools = useMemo(() => !cur?.video && !isGifLike(cur?.file ?? new File([], 'x')), [cur]);
  if (!cur) return null;

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[10060] flex flex-col" data-keep-dark
      style={{ background: '#0b0f14', color: '#fff', paddingTop: 'var(--safe-top, 0px)' }} translate="no">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button type="button" onClick={tool === 'draw' ? () => void finishDraw(false) : onClose} aria-label="Закрыть"
          className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}><X size={18} /></button>
        <p className="text-sm font-semibold" translate="yes">{items.length > 1 ? `${idx + 1} из ${items.length}` : 'Предпросмотр'}</p>
        <button type="button" onClick={() => remove(cur.id)} aria-label="Убрать" className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}>
          <Trash2 size={17} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2">
        <div className="relative inline-block max-h-full max-w-full">
          {cur.video
            ? <video src={cur.url} controls playsInline className="max-h-[60vh] max-w-full rounded-xl" />
            : <img ref={imgRef} src={cur.url} alt="" className="block max-h-[60vh] max-w-full rounded-xl object-contain select-none" draggable={false} />}
          {tool === 'draw' && !cur.video && (
            <canvas ref={cvRef} className="absolute inset-0 h-full w-full touch-none rounded-xl"
              onPointerDown={(e) => { drawing.current = true; (e.target as Element).setPointerCapture(e.pointerId); strokes.current.push({ c: color, p: [pt(e)] }); redraw(); }}
              onPointerMove={(e) => { if (!drawing.current) return; strokes.current[strokes.current.length - 1].p.push(pt(e)); redraw(); }}
              onPointerUp={() => { drawing.current = false; }} />
          )}
        </div>
      </div>

      {tool === 'crop' && (
        <div className="flex gap-2 overflow-x-auto px-3 py-2" style={{ scrollbarWidth: 'none' }} translate="yes">
          {CROPS.map(({ label, ratio }) => (
            <button key={label} type="button" onClick={async () => { if (ratio) replace(cur.id, await cropFile(cur.file, cur.url, ratio)); setTool('none'); }}
              className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold" style={{ background: 'rgba(255,255,255,0.12)' }}>{label}</button>
          ))}
        </div>
      )}
      {tool === 'draw' && (
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex flex-1 items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className="h-7 w-7 shrink-0 rounded-full"
                style={{ background: c, border: color === c ? `3px solid ${accent}` : '2px solid rgba(255,255,255,0.4)' }} />
            ))}
          </div>
          <button type="button" aria-label="Отменить штрих" onClick={() => { strokes.current.pop(); redraw(); }} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}><Undo2 size={16} /></button>
          <button type="button" aria-label="Готово" onClick={() => void finishDraw(true)} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: accent }}><Check size={17} /></button>
        </div>
      )}

      {items.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-3 py-1.5" style={{ scrollbarWidth: 'none' }}>
          {items.map((it, i) => (
            <button key={it.id} type="button" onClick={() => { if (tool === 'none') setIdx(i); }}
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl" style={{ outline: i === idx ? `2px solid ${accent}` : 'none' }}>
              {it.video ? <video src={it.url} className="h-full w-full object-cover" muted /> : <img src={it.url} alt="" className="h-full w-full object-cover" />}
            </button>
          ))}
        </div>
      )}

      <div className="px-3 pt-1" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 10px)' }}>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center rounded-full px-4" style={{ background: 'rgba(255,255,255,0.12)', minHeight: 44 }}>
            <input value={caption} onChange={(e) => setCaption(e.target.value.slice(0, 1024))} placeholder="Добавить подпись…" translate="yes"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/50" aria-label="Подпись" />
          </div>
          <button type="button" onClick={() => void send()} disabled={busy} aria-label="Отправить"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-60" style={{ background: accent }}>
            <Send size={18} />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-center gap-1.5" translate="yes">
          <button type="button" aria-label="Добавить ещё" onClick={onAddMore} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}><Plus size={17} /></button>
          {tools && tool === 'none' && (
            <>
              <button type="button" aria-label="Повернуть" onClick={async () => replace(cur.id, await rotateFile(cur.file, cur.url))} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}><RotateCw size={17} /></button>
              <button type="button" aria-label="Обрезать" onClick={() => setTool('crop')} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}><Crop size={17} /></button>
              <button type="button" aria-label="Рисовать" onClick={startDraw} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}><Pencil size={17} /></button>
            </>
          )}
          {!cur.video && (
            <button type="button" onClick={() => setHd((v) => !v)} aria-pressed={hd}
              className="h-10 rounded-full px-3.5 text-xs font-bold" style={{ background: hd ? accent : 'rgba(255,255,255,0.12)' }}>{hd ? 'HD' : 'SD'}</button>
          )}
        </div>
        {cur.video && <p className="mt-1 text-center text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }} translate="yes">Видео отправляется как есть (до 10 МБ)</p>}
      </div>
    </motion.div>,
    document.body,
  );
};
