/**
 * Массовая загрузка в «Студии»: несколько файлов за раз — Sky Video, кино, музыка, подкасты, книги.
 * Файлы перетаскиваются в окно (ПК) или выбираются списком; у каждого своё название, ход загрузки и
 * кнопка «Повторить». Идёт по два файла одновременно. Ничего нового на сервере: каждый файл проходит
 * те же ручки и те же проверки (лимиты, тип по содержимому, модерация), что и одиночная загрузка.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Upload, X, Check, RotateCcw, Loader2, FileAudio, FileVideo, FileText } from 'lucide-react';
import { useSkyVideoStore } from '@/video/serverStore';
import { readVideoMeta as readVideoMetaSv } from '@/video/skyVideoApi';
import { useFilmStore } from '@/film/serverStore';
import { readVideoMeta as readFilmMeta } from '@/film/filmApi';
import { useMusicStore } from '@/music/serverStore';
import { apiMine as apiMyPodcasts, apiCreatePodcast, apiCreateEpisode, apiUploadMedia, type Podcast } from '@/podcasts/podcastApi';
import { apiCreateBook, apiCreateChapter, apiUploadChapterAudio, apiSubmitBook, CATEGORIES as BOOK_CATEGORIES } from '@/books/booksApi';

export type BulkKind = 'video' | 'film' | 'music' | 'podcast' | 'book';
type Palette = Record<'bg' | 'bg1' | 'bg2' | 'bg3' | 'border' | 'bm' | 'accent' | 't1' | 't2' | 't3' | 'green' | 'red' | 'amber', string>;
type Status = 'wait' | 'run' | 'ok' | 'err';
type Item = { id: number; file: File; title: string; status: Status; pct: number; reason?: string };

const MAX_FILES = 50;
const PARALLEL = 2;

const ACCEPT: Record<BulkKind, string> = {
  video: 'video/*', film: 'video/*', music: 'audio/*', podcast: 'audio/*,video/*', book: 'audio/*,.txt,.md,text/plain',
};
const HINT: Record<BulkKind, string> = {
  video: 'Каждый ролик станет отдельным видео Sky Video.',
  film: 'Каждый файл ляжет в вашу личную коллекцию закрытым; в каталог — только через проверку.',
  music: 'Каждый файл станет отдельным треком. Название берётся из имени файла («Артист - Название»), его можно поправить.',
  podcast: 'Каждый файл станет новым выпуском выбранной передачи (аудио или видео).',
  book: 'Каждый аудиофайл или текст (.txt, .md) станет отдельной книгой с первой главой.',
};

/** «01 - Artist_Name - Title.mp3» → «Title» (или «Artist Name - Title» без номера). */
const titleFromName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/^\s*\d{1,3}\s*[-._)]\s*/, '').replace(/_/g, ' ').trim() || name;

const audioDuration = (f: Blob) => new Promise<number>((resolve) => {
  const url = URL.createObjectURL(f); const a = new Audio();
  const done = (d: number) => { URL.revokeObjectURL(url); resolve(d); };
  a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
  a.onerror = () => done(0);
  a.src = url;
});

const iconOf = (f: File) => (f.type.startsWith('video/') ? FileVideo : f.type.startsWith('audio/') ? FileAudio : FileText);

export const BulkUploadPanel = ({ kind, V, onDone }: { kind: BulkKind; V: Palette; onDone: () => void }) => {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [drag, setDrag] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const seq = useRef(0);
  const itemsRef = useRef<Item[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const stop = useRef(false);

  // Общие поля (у каждого вида свои)
  const videoCats = useSkyVideoStore((s) => s.categories);
  const [cat, setCat] = useState('Другое');
  const [publishNow, setPublishNow] = useState(true);
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [genre, setGenre] = useState('');
  const [shows, setShows] = useState<Podcast[] | null>(null);
  const [showId, setShowId] = useState('');
  const [newShow, setNewShow] = useState('');
  const [bookCat, setBookCat] = useState(BOOK_CATEGORIES[1] ?? 'Другое');

  const videoUpload = useSkyVideoStore((s) => s.upload);
  const videoPublish = useSkyVideoStore((s) => s.publish);
  const filmUpload = useFilmStore((s) => s.upload);
  const musicUpload = useMusicStore((s) => s.upload);

  useEffect(() => {
    if (kind !== 'podcast') return;
    let live = true;
    void apiMyPodcasts().then((l) => { if (!live) return; setShows(l ?? []); if (l?.length) setShowId(l[0].id); });
    return () => { live = false; };
  }, [kind]);
  useEffect(() => { if (kind === 'video' && !videoCats.includes(cat) && videoCats.length) setCat(videoCats[0]); }, [videoCats, kind, cat]);

  itemsRef.current = items;
  const patch = (id: number, p: Partial<Item>) => setItems((a) => a.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    const okType = list.filter((f) => {
      if (kind === 'book') return f.type.startsWith('audio/') || /\.(txt|md)$/i.test(f.name);
      if (kind === 'music') return f.type.startsWith('audio/');
      if (kind === 'podcast') return f.type.startsWith('audio/') || f.type.startsWith('video/');
      return f.type.startsWith('video/');
    });
    const skipped = list.length - okType.length;
    setItems((a) => {
      const room = Math.max(0, MAX_FILES - a.length);
      const take = okType.slice(0, room);
      const over = okType.length - take.length;
      setMsg(skipped || over ? `${skipped ? `Не подходят по типу: ${skipped}. ` : ''}${over ? `Сверх предела в ${MAX_FILES} файлов: ${over}.` : ''}` : null);
      return [...a, ...take.map((file) => ({ id: ++seq.current, file, title: titleFromName(file.name), status: 'wait' as Status, pct: 0 }))];
    });
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); };

  /** Один файл → готово/ошибка. Пользуется теми же хранилищами и ручками, что одиночные формы. */
  const uploadOne = async (it: Item, setPct: (n: number) => void): Promise<{ ok: boolean; reason?: string }> => {
    const f = it.file; const title = it.title.trim() || titleFromName(f.name);
    if (kind === 'video') {
      const m = await readVideoMetaSv(f);
      const res = await videoUpload(f, { title, description: '', category: cat, tags: '', duration: m.duration, width: m.width, height: m.height }, setPct).promise;
      if (!res.ok || !res.id) return { ok: false, reason: res.reason };
      if (publishNow) await videoPublish(res.id, true);
      return { ok: true };
    }
    if (kind === 'film') {
      const m = await readFilmMeta(f);
      const res = await filmUpload(f, { title, genre: genre.trim() || undefined, duration: m.duration, width: m.width, height: m.height }, setPct).promise;
      return res.ok ? { ok: true } : { ok: false, reason: res.reason };
    }
    if (kind === 'music') {
      if (!artist.trim()) return { ok: false, reason: 'Укажите исполнителя' };
      const dur = await audioDuration(f);
      const dash = title.split(/\s+[-–—]\s+/);   // «Артист - Название» в самом названии перекрывает общего исполнителя
      const own = dash.length >= 2 ? dash[0].trim() : '';
      const res = await musicUpload(f, { title: own ? dash.slice(1).join(' - ').trim() : title, artist: own || artist.trim(), album: album.trim() || undefined, genre: genre.trim() || undefined, duration: dur });
      return res.ok ? { ok: true } : { ok: false, reason: res.reason };
    }
    if (kind === 'podcast') {
      let pid = showId;
      if (!pid) {
        if (!newShow.trim()) return { ok: false, reason: 'Выберите передачу или назовите новую' };
        const made = await apiCreatePodcast({ title: newShow.trim() });
        if (!made) return { ok: false, reason: 'Не получилось завести передачу' };
        pid = made.id; setShowId(made.id); setShows((s) => [made, ...(s ?? [])]);
      }
      const ep = await apiCreateEpisode(pid, { title });
      if (!ep) return { ok: false, reason: 'Не получилось создать выпуск' };
      const res = await apiUploadMedia(ep.id, f.type.startsWith('video/') ? 'video' : 'audio', f, {}, setPct).promise;
      return res.ok ? { ok: true } : { ok: false, reason: res.reason };
    }
    // book
    const isText = !f.type.startsWith('audio/');
    const text = isText ? (await f.text()).trim() : '';
    if (isText && !text) return { ok: false, reason: 'Файл пустой' };
    const book = await apiCreateBook({ title, description: '', category: bookCat, genre: genre.trim() || undefined });
    if (!book) return { ok: false, reason: 'Не получилось завести книгу' };
    const ch = await apiCreateChapter(book.id, { title: 'Глава 1', content: text || undefined });
    if (!ch) return { ok: false, reason: 'Не получилось создать главу' };
    if (!isText) {
      const res = await apiUploadChapterAudio(ch.id, f, await audioDuration(f), setPct).promise;
      if (!res.ok) return { ok: false, reason: res.reason };
    }
    if (publishNow) { const s = await apiSubmitBook(book.id); if (!s.ok) return { ok: false, reason: `Книга сохранена, но на проверку не ушла: ${s.reason}` }; }
    return { ok: true };
  };

  const start = async () => {
    if (running) return;
    stop.current = false; setRunning(true); setMsg(null);
    const queue = items.filter((x) => x.status === 'wait' || x.status === 'err').map((x) => x.id);
    const byId = new Map(items.map((x) => [x.id, x] as const));
    let next = 0;
    const worker = async () => {
      while (!stop.current) {
        const id = queue[next++]; if (id === undefined) return;
        const it = byId.get(id)!;
        patch(id, { status: 'run', pct: 0, reason: undefined });
        try {
          const res = await uploadOne(itemsRef.current.find((x) => x.id === id) ?? it, (n) => patch(id, { pct: n }));
          patch(id, res.ok ? { status: 'ok', pct: 100 } : { status: 'err', reason: res.reason ?? 'Не получилось' });
        } catch (e) { patch(id, { status: 'err', reason: e instanceof Error ? e.message : 'Не получилось' }); }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    setRunning(false);
  };

  const done = items.filter((x) => x.status === 'ok').length;
  const failed = items.filter((x) => x.status === 'err').length;
  const left = items.filter((x) => x.status === 'wait' || x.status === 'err').length;
  const iS = { background: V.bg2, border: `1px solid ${V.border}`, color: V.t1 };
  const iC = 'w-full rounded-2xl px-3 py-2 text-sm outline-none';

  return (
    <div className="space-y-3 px-4 py-4 overflow-y-auto h-full" style={{ scrollbarWidth: 'none' }}>
      <p className="text-xs" style={{ color: V.t3 }}>{HINT[kind]} До {MAX_FILES} файлов за раз, по два одновременно.</p>

      {/* Общие поля */}
      <div className="grid gap-2 sm:grid-cols-2">
        {kind === 'video' && <select value={cat} onChange={(e) => setCat(e.target.value)} className={iC} style={iS} aria-label="Категория">{(videoCats.length ? videoCats : ['Другое']).map((c) => <option key={c} value={c}>{c}</option>)}</select>}
        {kind === 'music' && <>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Исполнитель (для всех) *" className={iC} style={iS} translate="no" />
          <input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Альбом (для всех)" className={iC} style={iS} translate="no" />
        </>}
        {(kind === 'music' || kind === 'film' || kind === 'book') && <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Жанр (для всех)" className={iC} style={iS} />}
        {kind === 'book' && <select value={bookCat} onChange={(e) => setBookCat(e.target.value)} className={iC} style={iS} aria-label="Категория">{BOOK_CATEGORIES.filter((c) => c !== 'Все').map((c) => <option key={c} value={c}>{c}</option>)}</select>}
        {kind === 'podcast' && (shows === null ? <p className="text-xs" style={{ color: V.t3 }}>Загружаем ваши передачи…</p> : <>
          <select value={showId} onChange={(e) => setShowId(e.target.value)} className={iC} style={iS} aria-label="Передача">
            {shows.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            <option value="">+ Новая передача</option>
          </select>
          {!showId && <input value={newShow} onChange={(e) => setNewShow(e.target.value)} placeholder="Название новой передачи *" className={iC} style={iS} translate="no" />}
        </>)}
      </div>
      {(kind === 'video' || kind === 'book') && (
        <label className="flex items-center gap-2 text-xs" style={{ color: V.t2 }}>
          <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
          {kind === 'video' ? 'Сразу опубликовать' : 'Сразу отправить на проверку'}
        </label>
      )}

      {/* Зона перетаскивания */}
      <div role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-8 text-center transition-colors"
        style={{ borderColor: drag ? V.accent : V.bm, background: drag ? `${V.accent}10` : 'transparent' }}>
        <Upload size={22} style={{ color: V.accent }} />
        <p className="text-sm font-bold" style={{ color: V.t1 }}>Перетащите файлы сюда или нажмите, чтобы выбрать</p>
        <p className="text-[11px]" style={{ color: V.t3 }}>Можно выбрать сразу много (Ctrl/Shift или всю папку выделением)</p>
        <input ref={input} type="file" multiple accept={ACCEPT[kind]} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </div>
      {msg && <p className="text-xs font-semibold" style={{ color: V.amber }}>{msg}</p>}

      {/* Очередь */}
      {items.length > 0 && <div className="space-y-1.5">
        {items.map((it) => {
          const Icon = iconOf(it.file);
          return (
            <div key={it.id} className="rounded-xl px-3 py-2" style={{ background: V.bg2, border: `1px solid ${it.status === 'err' ? V.red : V.border}` }}>
              <div className="flex items-center gap-2">
                <Icon size={15} style={{ color: V.t3 }} className="shrink-0" />
                <input value={it.title} disabled={it.status === 'run' || it.status === 'ok'} onChange={(e) => patch(it.id, { title: e.target.value })}
                  aria-label="Название" className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none" style={{ color: V.t1 }} translate="no" />
                <span className="shrink-0 text-[10.5px]" style={{ color: V.t3 }}>{(it.file.size / 1048576).toFixed(1)} МБ</span>
                {it.status === 'run' && <Loader2 size={15} className="shrink-0 animate-spin" style={{ color: V.accent }} />}
                {it.status === 'ok' && <Check size={16} className="shrink-0" style={{ color: V.green }} />}
                {it.status === 'err' && <RotateCcw size={15} className="shrink-0" style={{ color: V.red }} aria-hidden />}
                {(it.status === 'wait' || it.status === 'err') && !running && <button type="button" aria-label="Убрать" onClick={() => setItems((a) => a.filter((x) => x.id !== it.id))}><X size={15} style={{ color: V.t3 }} /></button>}
              </div>
              {it.status === 'run' && <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: V.bg3 }}><div className="h-full rounded-full" style={{ width: `${it.pct}%`, background: V.accent, transition: 'width .2s' }} /></div>}
              {it.status === 'err' && <p className="mt-1 text-[11px]" style={{ color: V.red }}>{it.reason}</p>}
            </div>
          );
        })}
      </div>}

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs" style={{ color: V.t2 }}>Готово: {done} из {items.length}{failed ? ` · с ошибкой: ${failed}` : ''}</p>
          <div className="flex-1" />
          {running
            ? <button type="button" onClick={() => { stop.current = true; }} className="rounded-2xl px-4 py-2.5 text-sm font-bold" style={{ background: V.bg2, color: V.t1, border: `1px solid ${V.border}` }}>Остановить после текущих</button>
            : <>
                {done === items.length && <button type="button" onClick={onDone} className="rounded-2xl px-4 py-2.5 text-sm font-bold" style={{ background: V.bg2, color: V.t1, border: `1px solid ${V.border}` }}>Готово</button>}
                {left > 0 && <button type="button" onClick={() => void start()} className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-black" style={{ background: V.accent, color: '#fff' }}><Upload size={15} />{failed && done + failed === items.length ? 'Повторить ошибочные' : `Загрузить (${left})`}</button>}
              </>}
        </div>
      )}
    </div>
  );
};
