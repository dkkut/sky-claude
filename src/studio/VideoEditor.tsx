/**
 * Sky Studio → «Редактор»: видеоредактор в браузере. Всё считается на устройстве: файлы не уходят на сервер, пока человек сам не загрузит готовый ролик.
 * Что есть: временная шкала (видео, текст, звук), добавление нескольких клипов и склейка, обрезка, разрезание по маркеру, перестановка,
 * звуковые дорожки со сдвигом и громкостью, текст поверх, эффекты (цветовые фильтры, плавное появление/затухание), проекты в памяти браузера
 * (IndexedDB: сам проект и исходные файлы), экспорт в WebM.
 * Честные границы: экспорт идёт В РЕАЛЬНОМ ВРЕМЕНИ (ролик в 2 минуты пишется 2 минуты, вкладку закрывать и сворачивать нельзя),
 * формат результата — WebM (MP4 браузер здесь не пишет); эффекты-фильтры не работают в Safari (там их нет у canvas) — клип выводится без фильтра.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Scissors, Trash2, Plus, Type, Music2, Film, Save, FolderOpen, Download, ChevronLeft, ChevronRight, FilePlus2 } from 'lucide-react';
import { flash } from '@/shared/flash';

const W = 1280, H = 720;
const FX: Record<string, { label: string; css: string }> = {
  none: { label: 'Без эффекта', css: 'none' },
  gray: { label: 'Чёрно-белое', css: 'grayscale(1)' },
  sepia: { label: 'Сепия', css: 'sepia(.85)' },
  bright: { label: 'Ярче', css: 'brightness(1.25) saturate(1.1)' },
  dark: { label: 'Темнее', css: 'brightness(.72)' },
  contrast: { label: 'Контраст', css: 'contrast(1.35)' },
  vivid: { label: 'Насыщенно', css: 'saturate(1.7)' },
  blur: { label: 'Размытие', css: 'blur(4px)' },
};
const id = () => Math.random().toString(36).slice(2, 10);
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

interface Clip { id: string; fileId: string; name: string; dur: number; in: number; out: number; fx: string; fadeIn: number; fadeOut: number; vol: number }
interface ATrack { id: string; fileId: string; name: string; dur: number; start: number; in: number; out: number; vol: number }
interface TextItem { id: string; text: string; start: number; dur: number; x: number; y: number; size: number; color: string }
interface Project { id: string; name: string; clips: Clip[]; audios: ATrack[]; texts: TextItem[] }
type Sel = { kind: 'clip' | 'audio' | 'text'; id: string } | null;

/* -- хранилище проектов -------------------------------------------------------------------------------------- */
const DB = 'sky-studio-editor';
const openDb = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('projects', { keyPath: 'id' }); r.result.createObjectStore('files'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async <T,>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((res, rej) => { const r = fn(db.transaction(store, mode).objectStore(store)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
};

const readDuration = (url: string, video: boolean) => new Promise<number>((res, rej) => {
  const el = document.createElement(video ? 'video' : 'audio'); el.preload = 'metadata'; el.src = url;
  el.onloadedmetadata = () => (Number.isFinite(el.duration) && el.duration > 0 ? res(el.duration) : rej(new Error('no_duration')));
  el.onerror = () => rej(new Error('bad_file'));
});

const empty = (): Project => ({ id: id(), name: 'Новый проект', clips: [], audios: [], texts: [] });

export const VideoEditor = () => {
  const [proj, setProj] = useState<Project>(empty);
  const [sel, setSel] = useState<Sel>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [px, setPx] = useState(48);
  const [exporting, setExporting] = useState<number | null>(null);
  const [list, setList] = useState<{ id: string; name: string; updatedAt: number }[] | null>(null);
  const [dirty, setDirty] = useState(false);

  const canvas = useRef<HTMLCanvasElement>(null);
  const urls = useRef(new Map<string, string>());                // fileId → blob-ссылка
  const blobs = useRef(new Map<string, Blob>());                 // fileId → файл (для сохранения)
  const vEls = useRef(new Map<string, HTMLVideoElement>());      // clipId → <video>
  const aEls = useRef(new Map<string, HTMLAudioElement>());      // audioId → <audio>
  const ctxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const gains = useRef(new Map<HTMLMediaElement, GainNode>());
  const tRef = useRef(0); const playRef = useRef(false); const projRef = useRef(proj);
  const recRef = useRef<MediaRecorder | null>(null); const exportRef = useRef(false);
  projRef.current = proj;

  /* раскладка: начало каждого клипа на шкале */
  const layout = useMemo(() => { let s = 0; return proj.clips.map((c) => { const o = { c, start: s, len: Math.max(0.05, c.out - c.in) }; s += o.len; return o; }); }, [proj.clips]);
  const total = useMemo(() => {
    const v = layout.reduce((m, o) => Math.max(m, o.start + o.len), 0);
    const a = proj.audios.reduce((m, x) => Math.max(m, x.start + (x.out - x.in)), 0);
    const x = proj.texts.reduce((m, y) => Math.max(m, y.start + y.dur), 0);
    return Math.max(v, a, x);
  }, [layout, proj.audios, proj.texts]);
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const totalRef = useRef(total); totalRef.current = total;

  const update = (fn: (p: Project) => Project) => { setProj((p) => fn(p)); setDirty(true); };

  /* элементы <video>/<audio> под клипы и дорожки */
  useEffect(() => {
    const live = new Set(proj.clips.map((c) => c.id));
    proj.clips.forEach((c) => { if (!vEls.current.has(c.id)) { const el = document.createElement('video'); el.src = urls.current.get(c.fileId) ?? ''; el.preload = 'auto'; el.playsInline = true; vEls.current.set(c.id, el); } });
    [...vEls.current.keys()].filter((k) => !live.has(k)).forEach((k) => { vEls.current.get(k)?.pause(); vEls.current.delete(k); });
    const liveA = new Set(proj.audios.map((a) => a.id));
    proj.audios.forEach((a) => { if (!aEls.current.has(a.id)) { const el = document.createElement('audio'); el.src = urls.current.get(a.fileId) ?? ''; el.preload = 'auto'; aEls.current.set(a.id, el); } });
    [...aEls.current.keys()].filter((k) => !liveA.has(k)).forEach((k) => { aEls.current.get(k)?.pause(); aEls.current.delete(k); });
  }, [proj.clips, proj.audios]);

  const setVol = (el: HTMLMediaElement, v: number) => { const g = gains.current.get(el); if (g) g.gain.value = v; else el.volume = clamp(v, 0, 1); };
  const ensureAudio = useCallback(async () => {
    if (!ctxRef.current) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new Ctx(); destRef.current = ctxRef.current.createMediaStreamDestination();
    }
    const ctx = ctxRef.current!;
    for (const el of [...vEls.current.values(), ...aEls.current.values()]) {
      if (gains.current.has(el)) continue;
      const src = ctx.createMediaElementSource(el); const g = ctx.createGain();
      src.connect(g); g.connect(ctx.destination); g.connect(destRef.current!); gains.current.set(el, g);
    }
    await ctx.resume().catch(() => {});
  }, []);

  /* отрисовка кадра и синхронизация воспроизведения */
  useEffect(() => {
    let raf = 0; let last = performance.now();
    const ctx2d = () => canvas.current?.getContext('2d') ?? null;
    const frame = (now: number) => {
      const dt = Math.min(0.2, (now - last) / 1000); last = now;
      const p = projRef.current; const lay = layoutRef.current; const tot = totalRef.current;
      if (playRef.current) {
        tRef.current += dt;
        if (tRef.current >= tot) { tRef.current = tot; playRef.current = false; setPlaying(false); finishExport(); }
        setT(tRef.current);
      }
      const tt = tRef.current;
      const active = lay.find((o) => tt >= o.start && tt < o.start + o.len) ?? (tt >= tot ? lay[lay.length - 1] : undefined);
      lay.forEach((o) => {
        const el = vEls.current.get(o.c.id); if (!el) return;
        if (o === active) {
          const local = o.c.in + clamp(tt - o.start, 0, o.len);
          setVol(el, o.c.vol);
          if (playRef.current) { if (Math.abs(el.currentTime - local) > 0.35) el.currentTime = local; if (el.paused) void el.play().catch(() => {}); }
          else { el.pause(); if (Math.abs(el.currentTime - local) > 0.04) el.currentTime = local; }
        } else if (!el.paused) el.pause();
      });
      p.audios.forEach((a) => {
        const el = aEls.current.get(a.id); if (!el) return;
        const on = tt >= a.start && tt < a.start + (a.out - a.in); setVol(el, a.vol);
        const local = a.in + (tt - a.start);
        if (on && playRef.current) { if (Math.abs(el.currentTime - local) > 0.35) el.currentTime = local; if (el.paused) void el.play().catch(() => {}); }
        else if (!el.paused) el.pause();
      });
      const g = ctx2d();
      if (g) {
        g.filter = 'none'; g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        if (active) {
          const el = vEls.current.get(active.c.id);
          if (el && el.readyState >= 2 && el.videoWidth) {
            const local = tt - active.start; const c = active.c;
            let alpha = 1;
            if (c.fadeIn > 0 && local < c.fadeIn) alpha = local / c.fadeIn;
            if (c.fadeOut > 0 && active.len - local < c.fadeOut) alpha = Math.min(alpha, (active.len - local) / c.fadeOut);
            const k = Math.min(W / el.videoWidth, H / el.videoHeight); const dw = el.videoWidth * k, dh = el.videoHeight * k;
            g.globalAlpha = clamp(alpha, 0, 1); g.filter = FX[c.fx]?.css ?? 'none';
            g.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh); g.filter = 'none'; g.globalAlpha = 1;
          }
        }
        p.texts.forEach((x) => {
          if (tt < x.start || tt >= x.start + x.dur) return;
          g.font = `800 ${x.size}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.lineWidth = Math.max(3, x.size / 9); g.strokeStyle = 'rgba(0,0,0,.75)'; g.fillStyle = x.color;
          g.strokeText(x.text, (x.x / 100) * W, (x.y / 100) * H); g.fillText(x.text, (x.x / 100) * W, (x.y / 100) * H);
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { playRef.current = false; vEls.current.forEach((e) => e.pause()); aEls.current.forEach((e) => e.pause()); void ctxRef.current?.close().catch(() => {}); urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const seek = (v: number) => { const x = clamp(v, 0, totalRef.current); tRef.current = x; setT(x); };
  const toggle = async () => {
    if (playRef.current) { playRef.current = false; setPlaying(false); return; }
    if (!proj.clips.length && !proj.audios.length) return flash('Сначала добавьте видео или звук');
    await ensureAudio(); if (tRef.current >= totalRef.current - 0.05) seek(0);
    playRef.current = true; setPlaying(true);
  };

  /* добавление файлов */
  const addFiles = async (files: FileList | null, kind: 'video' | 'audio') => {
    if (!files) return;
    for (const f of [...files]) {
      if (!f.type.startsWith(kind)) { flash(kind === 'video' ? `«${f.name}» — не видеофайл` : `«${f.name}» — не звуковой файл`); continue; }
      const fileId = id(); const url = URL.createObjectURL(f);
      try {
        const dur = await readDuration(url, kind === 'video');
        urls.current.set(fileId, url); blobs.current.set(fileId, f);
        if (kind === 'video') update((p) => ({ ...p, clips: [...p.clips, { id: id(), fileId, name: f.name, dur, in: 0, out: dur, fx: 'none', fadeIn: 0, fadeOut: 0, vol: 1 }] }));
        else update((p) => ({ ...p, audios: [...p.audios, { id: id(), fileId, name: f.name, dur, start: 0, in: 0, out: dur, vol: 1 }] }));
      } catch { URL.revokeObjectURL(url); flash(`Не удалось прочитать «${f.name}» — браузер не открывает такой файл`); }
    }
  };
  const addText = () => { const x: TextItem = { id: id(), text: 'Текст', start: tRef.current, dur: 3, x: 50, y: 85, size: 56, color: '#ffffff' }; update((p) => ({ ...p, texts: [...p.texts, x] })); setSel({ kind: 'text', id: x.id }); };

  /* правки выбранного */
  const patchClip = (cid: string, d: Partial<Clip>) => update((p) => ({ ...p, clips: p.clips.map((c) => (c.id === cid ? { ...c, ...d } : c)) }));
  const patchAudio = (aid: string, d: Partial<ATrack>) => update((p) => ({ ...p, audios: p.audios.map((c) => (c.id === aid ? { ...c, ...d } : c)) }));
  const patchText = (xid: string, d: Partial<TextItem>) => update((p) => ({ ...p, texts: p.texts.map((c) => (c.id === xid ? { ...c, ...d } : c)) }));
  const remove = () => { if (!sel) return; update((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== sel.id), audios: p.audios.filter((c) => c.id !== sel.id), texts: p.texts.filter((c) => c.id !== sel.id) })); setSel(null); };
  const move = (cid: string, dir: -1 | 1) => update((p) => { const i = p.clips.findIndex((c) => c.id === cid); const j = i + dir; if (i < 0 || j < 0 || j >= p.clips.length) return p; const a = [...p.clips]; [a[i], a[j]] = [a[j], a[i]]; return { ...p, clips: a }; });
  const split = () => {
    const o = layout.find((x) => t > x.start + 0.15 && t < x.start + x.len - 0.15);
    if (!o) return flash('Поставьте маркер внутри клипа, не у самого края');
    const cut = o.c.in + (t - o.start); const b: Clip = { ...o.c, id: id(), in: cut, fadeIn: 0 };
    update((p) => ({ ...p, clips: p.clips.flatMap((c) => (c.id === o.c.id ? [{ ...c, out: cut, fadeOut: 0 }, b] : [c])) }));
  };

  /* проекты */
  const save = async () => {
    try {
      const keep = new Set([...proj.clips.map((c) => c.fileId), ...proj.audios.map((a) => a.fileId)]);
      for (const fid of keep) { const b = blobs.current.get(fid); if (b) await tx('files', 'readwrite', (s) => s.put(b, fid)); }
      await tx('projects', 'readwrite', (s) => s.put({ id: proj.id, name: proj.name, json: JSON.stringify(proj), updatedAt: Date.now() }));
      setDirty(false); flash('Проект сохранён в этом браузере');
    } catch { flash('Не удалось сохранить: в браузере не хватает места или он запретил хранилище'); }
  };
  const openList = async () => { const all = await tx<{ id: string; name: string; updatedAt: number }[]>('projects', 'readonly', (s) => s.getAll()); setList(all.sort((a, b) => b.updatedAt - a.updatedAt)); };
  const load = async (pid: string) => {
    const row = await tx<{ json: string } | undefined>('projects', 'readonly', (s) => s.get(pid)); if (!row) return;
    const p = JSON.parse(row.json) as Project;
    playRef.current = false; setPlaying(false);
    urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current.clear(); blobs.current.clear();
    for (const fid of new Set([...p.clips.map((c) => c.fileId), ...p.audios.map((a) => a.fileId)])) {
      const b = await tx<Blob | undefined>('files', 'readonly', (s) => s.get(fid)); if (b) { blobs.current.set(fid, b); urls.current.set(fid, URL.createObjectURL(b)); }
    }
    vEls.current.clear(); aEls.current.clear(); gains.current.clear();
    setProj(p); setSel(null); seek(0); setDirty(false); setList(null);
  };
  const removeProject = async (pid: string) => { if (!window.confirm('Удалить проект из этого браузера?')) return; await tx('projects', 'readwrite', (s) => s.delete(pid)); void openList(); };
  const fresh = () => { if (dirty && !window.confirm('Несохранённые изменения пропадут. Начать новый проект?')) return; playRef.current = false; setPlaying(false); urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current.clear(); blobs.current.clear(); vEls.current.clear(); aEls.current.clear(); gains.current.clear(); setProj(empty()); setSel(null); seek(0); setDirty(false); };

  /* экспорт: запись холста и звука в реальном времени */
  const finishExport = () => { if (exportRef.current && recRef.current && recRef.current.state !== 'inactive') recRef.current.stop(); };
  const doExport = async () => {
    if (!proj.clips.length) return flash('Добавьте хотя бы один видеоклип');
    if (typeof MediaRecorder === 'undefined' || !canvas.current) return flash('Этот браузер не умеет записывать видео');
    await ensureAudio();
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) return flash('Этот браузер не умеет записывать WebM');
    const stream = canvas.current.captureStream(30); destRef.current?.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 }); const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      exportRef.current = false; setExporting(null); playRef.current = false; setPlaying(false);
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })); const a = document.createElement('a');
      a.href = url; a.download = `${(proj.name || 'sky-video').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'sky-video'}.webm`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); flash('Готово: файл скачан');
    };
    recRef.current = rec; exportRef.current = true; seek(0); rec.start(1000); playRef.current = true; setPlaying(true); setExporting(0);
  };
  useEffect(() => { if (exporting === null) return; setExporting(totalRef.current ? t / totalRef.current : 0); }, [t]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cancelExport = () => { exportRef.current = false; playRef.current = false; setPlaying(false); if (recRef.current && recRef.current.state !== 'inactive') { recRef.current.onstop = null; recRef.current.stop(); } setExporting(null); };

  /* интерфейс */
  const card = { background: 'var(--bg-l2)', border: '1px solid var(--border)' } as const;
  const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 text-xs font-bold';
  const bs = { minHeight: 40, background: 'var(--bg-l3)', color: 'var(--t1)', border: '1px solid var(--border)' } as const;
  const num = (v: number, set: (n: number) => void, step = 0.1, min = 0, max = 1e5) => (
    <input type="number" step={step} min={min} max={max} value={Number(v.toFixed(2))} onChange={(e) => set(clamp(Number(e.target.value) || 0, min, max))}
      className="w-20 rounded-lg px-2 py-1.5 text-xs" style={{ background: 'var(--bg)', color: 'var(--t1)', border: '1px solid var(--border)' }} />);
  const selClip = sel?.kind === 'clip' ? proj.clips.find((c) => c.id === sel.id) : undefined;
  const selAudio = sel?.kind === 'audio' ? proj.audios.find((c) => c.id === sel.id) : undefined;
  const selText = sel?.kind === 'text' ? proj.texts.find((c) => c.id === sel.id) : undefined;
  const width = Math.max(total + 4, 12) * px;
  const onTrack = (e: React.MouseEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left + e.currentTarget.scrollLeft) / px); };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: 'none' }}>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Название проекта" value={proj.name} onChange={(e) => update((p) => ({ ...p, name: e.target.value.slice(0, 80) }))} translate="no"
          className="min-w-0 flex-1 rounded-xl px-3 text-sm font-bold" style={{ minHeight: 40, background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }} />
        <button type="button" className={btn} style={bs} onClick={fresh}><FilePlus2 size={14} />Новый</button>
        <button type="button" className={btn} style={bs} onClick={() => void openList()}><FolderOpen size={14} />Проекты</button>
        <button type="button" className={btn} style={{ ...bs, background: dirty ? 'var(--accent)' : 'var(--bg-l3)', color: dirty ? '#fff' : 'var(--t1)' }} onClick={() => void save()}><Save size={14} />Сохранить</button>
        <button type="button" disabled={exporting !== null} className={btn} style={{ ...bs, opacity: exporting !== null ? 0.5 : 1 }} onClick={() => void doExport()}><Download size={14} />Экспорт WebM</button>
      </div>

      {list && (
        <div className="rounded-2xl p-3" style={card}>
          <div className="mb-2 flex items-center"><p className="flex-1 text-sm font-bold" style={{ color: 'var(--t1)' }}>Сохранённые проекты</p><button type="button" className="text-xs" style={{ color: 'var(--t3)', minHeight: 36 }} onClick={() => setList(null)}>Закрыть</button></div>
          {list.length === 0 ? <p className="text-xs" style={{ color: 'var(--t3)' }}>Пока ничего не сохранено.</p> : list.map((x) => (
            <div key={x.id} className="flex items-center gap-2 py-1.5">
              <button type="button" className="min-w-0 flex-1 text-left text-sm" style={{ color: 'var(--t1)', minHeight: 36 }} onClick={() => void load(x.id)}><span translate="no">{x.name}</span> <span className="text-[11px]" style={{ color: 'var(--t3)' }}>{new Date(x.updatedAt).toLocaleString()}</span></button>
              <button type="button" aria-label="Удалить проект" className="grid h-9 w-9 place-items-center rounded-lg" style={{ color: 'var(--red)' }} onClick={() => void removeProject(x.id)}><Trash2 size={15} /></button>
            </div>))}
        </div>)}

      <div className="relative overflow-hidden rounded-2xl" style={{ background: '#000', border: '1px solid var(--border)' }}>
        <canvas ref={canvas} width={W} height={H} className="block w-full" style={{ aspectRatio: '16 / 9' }} />
        {exporting !== null && (
          <div className="absolute inset-x-0 bottom-0 p-3" style={{ background: 'rgba(0,0,0,.7)', color: '#fff' }}>
            <p className="mb-1 text-xs font-bold">{`Запись видео… ${Math.round(exporting * 100)}% — не сворачивайте и не закрывайте вкладку`}</p>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.2)' }}><div className="h-full" style={{ width: `${exporting * 100}%`, background: '#a78bfa' }} /></div>
            <button type="button" className="mt-2 text-xs underline" style={{ minHeight: 32 }} onClick={cancelExport}>Отменить запись</button>
          </div>)}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label={playing ? 'Пауза' : 'Играть'} onClick={() => void toggle()} className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'var(--accent)', color: '#fff' }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--t1)' }}>{fmt(t)} / {fmt(total)}</span>
        <button type="button" className={btn} style={bs} onClick={split}><Scissors size={14} />Разрезать</button>
        <label className={`${btn} cursor-pointer`} style={bs}><Film size={14} />Видео<input type="file" hidden multiple accept="video/*" onChange={(e) => { void addFiles(e.target.files, 'video'); e.target.value = ''; }} /></label>
        <label className={`${btn} cursor-pointer`} style={bs}><Music2 size={14} />Звук<input type="file" hidden multiple accept="audio/*" onChange={(e) => { void addFiles(e.target.files, 'audio'); e.target.value = ''; }} /></label>
        <button type="button" className={btn} style={bs} onClick={addText}><Type size={14} />Текст</button>
        <label className="ml-auto flex items-center gap-2 text-[11px]" style={{ color: 'var(--t3)' }}>Масштаб<input type="range" min={16} max={140} value={px} onChange={(e) => setPx(Number(e.target.value))} aria-label="Масштаб шкалы" /></label>
      </div>

      <div className="overflow-x-auto rounded-2xl" style={card} onClick={onTrack}>
        <div className="relative" style={{ width, minHeight: 168 }}>
          <div className="relative h-5">{Array.from({ length: Math.ceil(width / px) }, (_, i) => <span key={i} className="absolute text-[9px]" style={{ left: i * px + 2, color: 'var(--t3)' }}>{i}с</span>)}</div>
          {[['Видео', 36], ['Текст', 30], ['Звук', 36]].map(([n, h], row) => (
            <div key={n as string} className="relative border-t" style={{ height: h as number, borderColor: 'var(--border)' }}>
              {row === 0 && layout.map((o) => (
                <button key={o.c.id} type="button" onClick={(e) => { e.stopPropagation(); setSel({ kind: 'clip', id: o.c.id }); }} translate="no"
                  className="absolute top-1 overflow-hidden rounded-lg px-1.5 text-left text-[10px] font-bold" style={{ left: o.start * px, width: o.len * px - 2, height: 28, background: sel?.id === o.c.id ? '#7c3aed' : '#4c1d95', color: '#fff' }}>{o.c.name}</button>))}
              {row === 1 && proj.texts.map((x) => (
                <button key={x.id} type="button" onClick={(e) => { e.stopPropagation(); setSel({ kind: 'text', id: x.id }); }} translate="no"
                  className="absolute top-1 overflow-hidden rounded-lg px-1.5 text-left text-[10px] font-bold" style={{ left: x.start * px, width: Math.max(18, x.dur * px - 2), height: 22, background: sel?.id === x.id ? '#db2777' : '#9d174d', color: '#fff' }}>{x.text}</button>))}
              {row === 2 && proj.audios.map((a) => (
                <button key={a.id} type="button" onClick={(e) => { e.stopPropagation(); setSel({ kind: 'audio', id: a.id }); }} translate="no"
                  className="absolute top-1 overflow-hidden rounded-lg px-1.5 text-left text-[10px] font-bold" style={{ left: a.start * px, width: Math.max(18, (a.out - a.in) * px - 2), height: 28, background: sel?.id === a.id ? '#0891b2' : '#155e75', color: '#fff' }}>{a.name}</button>))}
            </div>))}
          <div className="pointer-events-none absolute bottom-0 top-0 w-0.5" style={{ left: t * px, background: '#fbbf24' }} />
        </div>
      </div>

      {!sel && <p className="text-xs" style={{ color: 'var(--t3)' }}>Нажмите на дорожку, чтобы поставить маркер, или на клип, текст и звук, чтобы править. Всё считается в вашем браузере и никуда не отправляется.</p>}

      {selClip && (
        <div className="grid gap-2 rounded-2xl p-3" style={card}>
          <p className="text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{selClip.name}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--t2)' }}>
            <span>Начало среза {num(selClip.in, (v) => patchClip(selClip.id, { in: Math.min(v, selClip.out - 0.1) }), 0.1, 0, selClip.dur)}</span>
            <span>Конец среза {num(selClip.out, (v) => patchClip(selClip.id, { out: Math.max(v, selClip.in + 0.1) }), 0.1, 0.1, selClip.dur)}</span>
            <span>Громкость {num(selClip.vol, (v) => patchClip(selClip.id, { vol: v }), 0.1, 0, 2)}</span>
            <span>Появление, с {num(selClip.fadeIn, (v) => patchClip(selClip.id, { fadeIn: v }), 0.1, 0, 5)}</span>
            <span>Затухание, с {num(selClip.fadeOut, (v) => patchClip(selClip.id, { fadeOut: v }), 0.1, 0, 5)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Эффект" value={selClip.fx} onChange={(e) => patchClip(selClip.id, { fx: e.target.value })} className="rounded-xl px-2 text-xs" style={{ minHeight: 40, background: 'var(--bg)', color: 'var(--t1)', border: '1px solid var(--border)' }}>
              {Object.entries(FX).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
            <button type="button" aria-label="Левее" className={btn} style={bs} onClick={() => move(selClip.id, -1)}><ChevronLeft size={14} /></button>
            <button type="button" aria-label="Правее" className={btn} style={bs} onClick={() => move(selClip.id, 1)}><ChevronRight size={14} /></button>
            <button type="button" className={btn} style={{ ...bs, color: 'var(--red)' }} onClick={remove}><Trash2 size={14} />Удалить</button>
          </div>
        </div>)}

      {selAudio && (
        <div className="grid gap-2 rounded-2xl p-3" style={card}>
          <p className="text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{selAudio.name}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--t2)' }}>
            <span>Начать на шкале с, с {num(selAudio.start, (v) => patchAudio(selAudio.id, { start: v }), 0.1, 0, 3600)}</span>
            <span>Начало среза {num(selAudio.in, (v) => patchAudio(selAudio.id, { in: Math.min(v, selAudio.out - 0.1) }), 0.1, 0, selAudio.dur)}</span>
            <span>Конец среза {num(selAudio.out, (v) => patchAudio(selAudio.id, { out: Math.max(v, selAudio.in + 0.1) }), 0.1, 0.1, selAudio.dur)}</span>
            <span>Громкость {num(selAudio.vol, (v) => patchAudio(selAudio.id, { vol: v }), 0.1, 0, 2)}</span>
          </div>
          <button type="button" className={`${btn} self-start`} style={{ ...bs, color: 'var(--red)' }} onClick={remove}><Trash2 size={14} />Удалить</button>
        </div>)}

      {selText && (
        <div className="grid gap-2 rounded-2xl p-3" style={card}>
          <input aria-label="Текст" value={selText.text} maxLength={120} onChange={(e) => patchText(selText.id, { text: e.target.value })} translate="no" className="rounded-xl px-3 text-sm" style={{ minHeight: 40, background: 'var(--bg)', color: 'var(--t1)', border: '1px solid var(--border)' }} />
          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--t2)' }}>
            <span>Начало, с {num(selText.start, (v) => patchText(selText.id, { start: v }), 0.1, 0, 3600)}</span>
            <span>Длительность, с {num(selText.dur, (v) => patchText(selText.id, { dur: v }), 0.1, 0.2, 600)}</span>
            <span>Слева направо, % {num(selText.x, (v) => patchText(selText.id, { x: v }), 1, 0, 100)}</span>
            <span>Сверху вниз, % {num(selText.y, (v) => patchText(selText.id, { y: v }), 1, 0, 100)}</span>
            <span>Размер {num(selText.size, (v) => patchText(selText.id, { size: v }), 2, 12, 200)}</span>
            <label className="flex items-center gap-1">Цвет<input type="color" value={selText.color} onChange={(e) => patchText(selText.id, { color: e.target.value })} aria-label="Цвет текста" /></label>
          </div>
          <button type="button" className={`${btn} self-start`} style={{ ...bs, color: 'var(--red)' }} onClick={remove}><Trash2 size={14} />Удалить</button>
        </div>)}

      <p className="text-[11px]" style={{ color: 'var(--t3)' }}><Plus size={10} className="mr-1 inline" />Экспорт записывает ролик в реальном времени в WebM (MP4 браузер не пишет). Эффекты-фильтры в Safari недоступны. Проекты хранятся только в этом браузере.</p>
    </div>
  );
};
