/* ===========================================================
   SKY CAR — Книги.
   Аудиокниги слушать можно всегда (как подкасты) — с короткой пометкой «следите за дорогой». Чтение текста — как видео: только когда
   автомобиль стоит (driveLogic.ts); едет или неизвестно — текст закрыт, предлагается слушать, если у главы есть озвучка.
   Тот же каталог, права и прогресс, что в Sky Books (`/api/books/*`, Prime).
=========================================================== */
import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, Play, Pause, SkipBack, SkipForward, Headphones } from 'lucide-react';
import { apiCatalog, apiChapters, apiChapter, apiProgress, apiSetProgress, apiNotePlayed, apiMediaTicket, chapterAudioUrl, bookCoverUrl, type Book, type ChapterMeta, type Chapter } from '@/books/booksApi';
import { useAuthStore } from '@/core/auth/store';
import { reloadWithFreshTicket } from '@/core/mediaTicketRefresh';
import { CAR_GLASS, CAR_GLASS_BORDER, CAR_BLUR, CAR_ACCENT, fmtTime } from './carTheme';
import { useDriveWatch } from './driveState';
import { mayShowVideo } from './driveLogic';
import { CarWarningGate, DriveBadge, LockedNote, UnknownBanner } from './CarWarning';

const BookRow = ({ b, onOpen }: { b: Book; onOpen: () => void }) => (
  <button type="button" onClick={onOpen} aria-label={b.title} className="flex w-full items-center gap-5 rounded-3xl px-4 text-left outline-none transition active:scale-[0.985] focus-visible:ring-4 focus-visible:ring-violet-300" style={{ minHeight: 104 }}>
    <span className="h-[80px] w-[60px] shrink-0 overflow-hidden rounded-xl" style={{ background: b.hasCover ? `center/cover url(${bookCoverUrl(b.id)})` : 'linear-gradient(160deg,#2b2440,#12101f)' }}>
      {!b.hasCover && <span className="grid h-full w-full place-items-center"><BookOpen size={24} color="rgba(255,255,255,0.4)" /></span>}
    </span>
    <span className="min-w-0 flex-1"><span className="block truncate text-[26px] font-bold text-white" translate="no">{b.title}</span>
      <span className="block truncate text-[18px] text-white/55" translate="no">{[b.authorName, b.hasAudio ? 'аудио' : null, b.hasText ? 'текст' : null].filter(Boolean).join(' · ')}</span></span>
  </button>
);

/** Озвучка главы: крупные кнопки, позиция уходит на сервер. */
const CarAudioBook = ({ book, chapters, startChapter, startPos, onClose }: { book: Book; chapters: ChapterMeta[]; startChapter: number; startPos: number; onClose: () => void }) => {
  const a = useRef<HTMLAudioElement>(null);
  const withAudio = chapters.filter((c) => c.hasAudio);
  const [idx, setIdx] = useState(Math.max(0, withAudio.findIndex((c) => c.number === startChapter)));
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const tried = useRef(false);
  const ch = withAudio[idx];
  const lastSave = useRef(0);
  useEffect(() => { void apiNotePlayed(book.id, 'audio'); return () => { a.current?.pause(); }; }, [book.id]);
  const save = (pos: number) => { if (ch) void apiSetProgress(book.id, { mode: 'audio', audioChapter: ch.number, audioPosition: Math.floor(pos) }); };
  useEffect(() => () => { if (lastSave.current > 3) save(lastSave.current); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [idx]);
  if (!ch) return <p className="p-6 text-[24px] text-white/70">У этой книги нет озвучки.</p>;
  const src = chapterAudioUrl(ch.id);
  return (
    <div className="flex h-full flex-col justify-between gap-5" data-car-audiobook>
      <button type="button" onClick={onClose} className="flex items-center gap-2 self-start text-[22px] font-bold text-white/80" style={{ minHeight: 72 }}><ChevronLeft size={30} /> Назад</button>
      <div className="text-center"><p className="text-[34px] font-extrabold text-white" translate="no">{book.title}</p><p className="mt-2 text-[24px] text-white/65" translate="no">{`Глава ${ch.number}. ${ch.title}`}</p></div>
      <audio ref={a} key={ch.id} src={src} preload="metadata" autoPlay
        onLoadedMetadata={() => { const el = a.current; if (el) { setDur(el.duration || 0); if (startPos > 3 && ch.number === startChapter && !lastSave.current) el.currentTime = startPos; } }}
        onTimeUpdate={() => { const el = a.current; if (!el) return; setCur(el.currentTime); if (Math.abs(el.currentTime - lastSave.current) >= 10) { lastSave.current = el.currentTime; save(el.currentTime); } }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { lastSave.current = 0; if (idx < withAudio.length - 1) setIdx(idx + 1); else void apiSetProgress(book.id, { mode: 'audio', completed: true }); }}
        onError={() => { const el = a.current; if (el && !tried.current) { tried.current = true; void reloadWithFreshTicket(el, apiMediaTicket, () => src); } }} />
      <div className="flex items-center justify-center gap-6">
        <button type="button" disabled={idx === 0} onClick={() => { lastSave.current = 0; setIdx(idx - 1); }} aria-label="Предыдущая глава" className="grid h-[88px] w-[88px] place-items-center rounded-3xl disabled:opacity-30" style={{ background: CAR_GLASS }}><SkipBack size={36} color="#fff" /></button>
        <button type="button" onClick={() => { const el = a.current; if (!el) return; if (el.paused) void el.play().catch(() => setPlaying(false)); else el.pause(); }} aria-label={playing ? 'Пауза' : 'Играть'} className="grid h-[112px] w-[112px] place-items-center rounded-full" style={{ background: CAR_ACCENT }}>{playing ? <Pause size={50} color="#fff" fill="#fff" /> : <Play size={50} color="#fff" fill="#fff" />}</button>
        <button type="button" disabled={idx >= withAudio.length - 1} onClick={() => { lastSave.current = 0; setIdx(idx + 1); }} aria-label="Следующая глава" className="grid h-[88px] w-[88px] place-items-center rounded-3xl disabled:opacity-30" style={{ background: CAR_GLASS }}><SkipForward size={36} color="#fff" /></button>
      </div>
      <p className="text-center text-[22px] tabular-nums text-white/70" translate="no">{fmtTime(cur)} / {fmtTime(dur)}</p>
      <p className="text-center text-[18px] text-white/45">Следите за дорогой.</p>
    </div>
  );
};

/** Чтение текста: только когда автомобиль стоит. */
const CarReader = ({ book, chapters, parked, onClose, onListen }: { book: Book; chapters: ChapterMeta[]; parked: boolean; onClose: () => void; onListen: () => void }) => {
  const withText = chapters.filter((c) => c.hasText);
  const [i, setI] = useState(0);
  const [ch, setCh] = useState<Chapter | null>(null);
  useEffect(() => { if (parked && withText[i]) void apiChapter(withText[i].id).then(setCh); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [i, parked, chapters]);
  useEffect(() => { void apiNotePlayed(book.id, 'text'); }, [book.id]);
  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-car-reader data-text={parked ? 'on' : 'off'}>
      <div className="flex items-center justify-between"><button type="button" onClick={onClose} className="flex items-center gap-2 text-[22px] font-bold text-white/80" style={{ minHeight: 72 }}><ChevronLeft size={30} /> Назад</button><span className="min-w-0 truncate text-[24px] font-bold text-white" translate="no">{book.title}</span></div>
      {!parked ? (<>
        <LockedNote state="driving" what="Чтение" />
        {chapters.some((c) => c.hasAudio) && <button type="button" onClick={onListen} className="mx-auto flex items-center gap-3 rounded-3xl px-10 text-[26px] font-bold text-white" style={{ minHeight: 88, background: CAR_ACCENT }}><Headphones size={32} /> Слушать вместо чтения</button>}
      </>) : (<>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl p-8" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
          <p className="mb-4 text-[26px] font-extrabold text-white" translate="no">{withText[i] ? `Глава ${withText[i].number}. ${withText[i].title}` : ''}</p>
          <p className="whitespace-pre-wrap text-[28px] leading-relaxed text-white/90" translate="no">{ch?.content ?? 'Загрузка…'}</p>
        </div>
        <div className="flex gap-4"><button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="flex-1 rounded-3xl text-[24px] font-bold text-white disabled:opacity-30" style={{ minHeight: 84, background: CAR_GLASS }}>Предыдущая глава</button>
          <button type="button" disabled={i >= withText.length - 1} onClick={() => setI(i + 1)} className="flex-1 rounded-3xl text-[24px] font-bold text-white disabled:opacity-30" style={{ minHeight: 84, background: CAR_GLASS }}>Следующая глава</button></div>
      </>)}
    </div>
  );
};

const Inner = () => {
  const drive = useDriveWatch();
  const parked = mayShowVideo(drive.state);
  const isPrime = useAuthStore((s) => s.accounts.find((a) => a.id === s.currentUserId)?.isPrime ?? false);
  const [books, setBooks] = useState<Book[] | null>(null);
  const [open, setOpen] = useState<{ book: Book; chapters: ChapterMeta[]; mode: 'menu' | 'listen' | 'read'; ch: number; pos: number } | null>(null);
  useEffect(() => { void apiMediaTicket(); void apiCatalog({ limit: 40 }).then(setBooks); }, []);

  const pick = async (b: Book) => {
    const [chs, pr] = await Promise.all([apiChapters(b.id), apiProgress(b.id)]);
    setOpen({ book: b, chapters: chs ?? [], mode: 'menu', ch: pr?.audioChapter || 1, pos: pr?.audioPosition || 0 });
  };
  if (open?.mode === 'listen') return <CarAudioBook book={open.book} chapters={open.chapters} startChapter={open.ch} startPos={open.pos} onClose={() => setOpen({ ...open, mode: 'menu' })} />;
  if (open?.mode === 'read') return <CarReader book={open.book} chapters={open.chapters} parked={parked} onClose={() => setOpen({ ...open, mode: 'menu' })} onListen={() => setOpen({ ...open, mode: 'listen' })} />;
  if (open) {
    const hasAudio = open.chapters.some((c) => c.hasAudio); const hasText = open.chapters.some((c) => c.hasText);
    return (
      <div className="flex h-full flex-col gap-5">
        <button type="button" onClick={() => setOpen(null)} className="flex items-center gap-2 self-start text-[22px] font-bold text-white/80" style={{ minHeight: 72 }}><ChevronLeft size={30} /> Назад</button>
        <p className="text-[34px] font-extrabold text-white" translate="no">{open.book.title}</p>
        <div className="flex gap-4">
          {hasAudio && <button type="button" onClick={() => setOpen({ ...open, mode: 'listen' })} className="flex flex-1 items-center justify-center gap-3 rounded-3xl text-[26px] font-bold text-white" style={{ minHeight: 100, background: CAR_ACCENT }}><Headphones size={34} /> Слушать</button>}
          {hasText && <button type="button" onClick={() => setOpen({ ...open, mode: 'read' })} className="flex flex-1 items-center justify-center gap-3 rounded-3xl text-[26px] font-bold text-white" style={{ minHeight: 100, background: CAR_GLASS, border: CAR_GLASS_BORDER }}><BookOpen size={34} /> Читать{parked ? '' : ' (когда стоите)'}</button>}
        </div>
        {!hasAudio && !hasText && <p className="text-[22px] text-white/60">В книге пока нет глав.</p>}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between"><p className="text-[32px] font-extrabold text-white">Книги</p><DriveBadge state={drive.state} /></div>
      {drive.state === 'unknown' && <UnknownBanner />}
      {!isPrime ? <p className="text-[24px] text-white/70">Книги входят в Sky Prime. Оформите подписку с телефона.</p> : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl p-2" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR, scrollbarWidth: 'none' }}>
          {books === null && <p className="p-4 text-[20px] text-white/55">Загрузка…</p>}
          {books?.map((b) => <BookRow key={b.id} b={b} onOpen={() => void pick(b)} />)}
          {books?.length === 0 && <p className="p-4 text-[20px] text-white/55">Пока ничего нет</p>}
        </div>)}
      <p className="text-[18px] text-white/45">Аудиокниги можно слушать в пути — следите за дорогой. Читать текст можно, только когда автомобиль стоит.</p>
    </div>
  );
};

export const CarBooks = () => <CarWarningGate><Inner /></CarWarningGate>;
