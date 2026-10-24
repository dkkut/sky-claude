import { SkyLoader } from '@/shared/SkyLoader';
/* ===============================================================
   SKY BOOKS  -  Площадка книг и аудиокниг
=============================================================== */
import { takeStart, useHandoffStart } from '@/handoff/openContent';
import { ExplicitBadge, LegacyChip, LabelsButton } from '@/labels/Labels';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Headphones, BookOpen, ChevronLeft, BookMarked, Sparkles,
  Library, PenLine, Rocket, Wand2, Drama, Brain, Landmark, Briefcase, Loader2,
} from 'lucide-react';
import {
  apiCatalog, apiShelf, apiSetShelf, apiBook, bookCoverUrl,
  fmtAudioDuration, fmtWords, CATEGORIES,
  type Book,
} from './booksApi';
import { BookPlayer } from './BookPlayer';
import { useModuleStore } from '@/data/state/modules';
import { useAuthStore } from '@/core/auth/store';
import { PrimeGate } from '@/prime/PrimeGate';

type BookTab = 'home' | 'ebooks' | 'audio' | 'shelf';

const CATEGORY_ICON: Record<string, typeof Library> = {
  'Все': Library,
  'Художественная литература': PenLine,
  'Фантастика': Rocket,
  'Детектив': Drama,
  'Бизнес': Briefcase,
  'Саморазвитие': Brain,
  'История': Landmark,
  'Наука': Wand2,
  'Биография': BookOpen,
  'Поэзия': PenLine,
  'Другое': Library,
};

const B = {
  bg: 'var(--bg)', l1: 'var(--bg-l1)', l2: 'var(--bg-l2)',
  accent: '#a855f7', amber: 'var(--amber)',
  t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
  border: 'var(--border)',
};

/* -- Book Card -------------------------------------------- */
const BookCard = ({ book, onOpen }: { book: Book; onOpen: () => void }) => {
  const Icon = CATEGORY_ICON[book.category] ?? BookOpen;
  return (
    <motion.button type="button" whileTap={{ scale: .95 }} onClick={onOpen}
      className="flex flex-col text-left relative overflow-hidden rounded-2xl">
      <div className="relative w-full rounded-2xl overflow-hidden"
        style={{ aspectRatio: '2/3', background: `linear-gradient(155deg,${book.accent},#1a1a2e)` }}>
        {book.hasCover ? (
          <img src={bookCoverUrl(book.id)} alt="" loading="lazy" className="h-full w-full object-cover"/>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon size={26} style={{ color: 'rgba(255,255,255,0.8)' }}/>
          </div>
        )}
        <div className="absolute bottom-2 right-2 flex gap-1">
          {book.hasAudio && (
            <div className="grid h-5 w-5 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.7)' }}>
              <Headphones size={10} className="text-white"/>
            </div>
          )}
          {book.hasText && (
            <div className="grid h-5 w-5 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.7)' }}>
              <BookOpen size={10} className="text-white"/>
            </div>
          )}
        </div>
      </div>
      <div className="pt-2 px-0.5">
        <p className="text-xs font-bold text-white leading-tight line-clamp-2">{book.title}<ExplicitBadge show={book.explicit} size={12} /></p>
        <p className="text-[10px] mt-0.5 truncate" style={{ color: B.t3 }}>{book.authorName ?? 'Sky'}</p>
        <p className="text-[10px] mt-1" style={{ color: B.t3 }}>
          {book.hasAudio ? fmtAudioDuration(book.audioSeconds) : fmtWords(book.words)}
        </p>
      </div>
    </motion.button>
  );
};

/* -- Book Detail ------------------------------------------ */
const BookDetail = ({ book, onBack, onShelfChanged }: {
  book: Book; onBack: () => void; onShelfChanged: (onShelf: boolean) => void;
}) => {
  const [shelf, setShelf] = useState(book.onShelf === true);
  const [busyShelf, setBusyShelf] = useState(false);
  const [playing, setPlaying] = useState(false);

  const toggleShelf = async () => {
    if (busyShelf) return;
    setBusyShelf(true);
    const next = !shelf;
    const r = await apiSetShelf(book.id, next);
    setBusyShelf(false);
    if (r === null) return;
    setShelf(next);
    onShelfChanged(next);
  };

  /* «Продолжить на другом устройстве»: плеер открывается сам; место сервер уже записал, плеер берёт его при открытии. */
  const handed = useHandoffStart((s) => s.start);
  useEffect(() => {
    if (handed && handed.kind === 'book' && handed.id === book.id && takeStart('book', book.id)) setPlaying(true);
  }, [handed, book.id]);

  return (
    <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }}
      className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth: 'none', background: B.bg }}>
      <div className="relative overflow-hidden"
        style={{ background: `linear-gradient(180deg,${book.accent},#1a1a2e,${B.bg})`, paddingBottom: 24 }}>
        <button type="button" onClick={onBack}
          className="absolute top-4 left-4 grid h-9 w-9 place-items-center rounded-full z-10"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}>
          <ChevronLeft size={18} className="text-white"/>
        </button>
        <button type="button" onClick={toggleShelf} disabled={busyShelf}
          className="absolute top-4 right-4 grid h-9 w-9 place-items-center rounded-full z-10"
          style={{ background: shelf ? `${B.accent}30` : 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}>
          <BookMarked size={18} style={{ color: shelf ? B.accent : 'white' }}/>
        </button>
        <div className="flex justify-center pt-12 pb-4">
          <div className="relative overflow-hidden rounded-3xl shadow-2xl"
            style={{ width: 130, height: 195, background: `linear-gradient(155deg,${book.accent},#1a1a2e)`,
              boxShadow: `0 20px 60px ${book.accent}80` }}>
            {book.hasCover
              ? <img src={bookCoverUrl(book.id)} alt="" className="h-full w-full object-cover"/>
              : <div className="absolute inset-0 flex items-center justify-center">
                <BookOpen size={40} style={{ color: 'rgba(255,255,255,0.8)' }}/>
              </div>}
          </div>
        </div>
        <div className="text-center px-6 pb-2">
          <h1 className="text-xl font-black text-white leading-snug">{book.title}<ExplicitBadge show={book.explicit} size={18} /><span className="ml-2 align-middle"><LabelsButton kind="book" id={book.id} /></span></h1>
          {book.legacy && <div className="mt-1"><LegacyChip show /></div>}
          <p className="text-sm mt-1" style={{ color: B.t2 }}>{book.authorName ?? 'Sky'}</p>
        </div>
      </div>

      <div className="px-4 pb-4 space-y-4 pt-2">
        <div className="rounded-2xl p-4" style={{ background: B.l1, border: `1px solid ${B.border}` }}>
          {book.description && (
            <>
              <p className="text-xs font-bold mb-2" style={{ color: B.t3 }}>О книге</p>
              <p className="text-sm leading-relaxed" style={{ color: B.t2 }}>{book.description}</p>
            </>
          )}
          <div className="flex gap-4 mt-3 flex-wrap">
            {book.hasText && (
              <div className="text-xs" style={{ color: B.t3 }}>
                <span className="font-bold text-white">{fmtWords(book.words)}</span>
              </div>
            )}
            {book.hasAudio && (
              <div className="text-xs" style={{ color: B.t3 }}>
                <span className="font-bold text-white">{fmtAudioDuration(book.audioSeconds)}</span> аудио
              </div>
            )}
            <div className="text-xs" style={{ color: B.t3 }}>
              <span className="font-bold" style={{ color: B.accent }}>{book.category}</span>
            </div>
          </div>
        </div>

        <motion.button whileTap={{ scale: .97 }} type="button" onClick={() => setPlaying(true)}
          className="w-full rounded-3xl py-4 text-base font-black text-white flex items-center justify-center gap-2"
          style={{ background: `linear-gradient(135deg,${B.accent},#7c3aed)`, boxShadow: `0 8px 32px ${B.accent}50` }}>
          {book.hasText ? <BookOpen size={18}/> : <Headphones size={18}/>}
          {book.hasText ? 'Читать' : 'Слушать'}
        </motion.button>
      </div>

      <AnimatePresence>
        {playing && <BookPlayer key="player" book={book} onClose={() => setPlaying(false)}/>}
      </AnimatePresence>
    </motion.div>
  );
};

/* === MAIN SkyBooks ======================================= */
/* Раздел входит в Sky Prime. Экран — вежливость: файлы и каталог закрывает сервер (`prime_required`). */
export const SkyBooks = () => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find((a) => a.id === currentUserId);
  if (!(me?.isPrime ?? false) && !(me?.isAdmin ?? false)) return <div className="flex h-full flex-col overflow-hidden"><PrimeGate service="books"/></div>;
  return <SkyBooksContent />;
};

const SkyBooksContent = () => {

  const [tab, setTab] = useState<BookTab>('home');
  const [category, setCategory] = useState('Все');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Book | null>(null);
  const [books, setBooks] = useState<Book[] | null>(null);
  const [shelf, setShelf] = useState<Book[]>([]);

  useEffect(() => {
    let alive = true;
    void apiShelf().then((r) => { if (alive) setShelf(r); });
    return () => { alive = false; };
  }, []);

  /* Дипссылка из Библиотеки: «открой именно вот эту книгу» — запрашиваем
     её напрямую по id, тем же приёмом, что pendingExtrasTab. */
  const pendingItemId = useModuleStore(s => s.pendingExtrasItemId);
  const setPendingItemId = useModuleStore(s => s.setPendingExtrasItemId);
  useEffect(() => {
    if (!pendingItemId) return;
    const id = pendingItemId;
    setPendingItemId(null);
    void apiBook(id).then((b) => { if (b) setDetail(b); });
  }, [pendingItemId, setPendingItemId]);

  useEffect(() => {
    if (tab === 'shelf') return;
    let alive = true;
    setBooks(null);
    void apiCatalog({
      q: search || undefined,
      category: category !== 'Все' ? category : undefined,
      sort: search ? undefined : 'new',
    }).then((r) => { if (alive) setBooks(r ?? []); });
    return () => { alive = false; };
  }, [tab, category, search]);

  const onShelfChanged = (bookId: string, onShelf: boolean) => {
    setShelf((cur) => (onShelf
      ? (detail ? [detail, ...cur.filter((b) => b.id !== bookId)] : cur)
      : cur.filter((b) => b.id !== bookId)));
  };

  if (detail) {
    return (
      <BookDetail book={detail} onBack={() => setDetail(null)}
        onShelfChanged={(on) => onShelfChanged(detail.id, on)}/>
    );
  }

  const source = tab === 'shelf' ? shelf : books;
  const filtered = (source ?? []).filter((b) => {
    if (tab === 'audio' && !b.hasAudio) return false;
    if (tab === 'ebooks' && !b.hasText) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: B.bg }}>
      <div className="px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-black text-white">Sky Books</h1>
            <p className="text-xs" style={{ color: B.t3 }}>Книги и аудиокниги</p>
          </div>
          <div className="flex items-center gap-1">
            <Sparkles size={16} style={{ color: B.accent }}/>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2.5 mb-3"
          style={{ background: B.l1, border: `1px solid ${B.border}` }}>
          <Search size={14} style={{ color: B.t3 }}/>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск книг, авторов..." className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: B.t1 }}/>
        </div>
        <div className="flex gap-1.5 mb-3">
          {([['home', Library, 'Главная'], ['ebooks', BookOpen, 'Электронные'], ['audio', Headphones, 'Аудио'], ['shelf', BookMarked, 'Полка']] as const).map(([k, TabIcon, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all"
              style={{ background: tab === k ? B.accent : 'var(--border)', color: tab === k ? '#fff' : B.t3 }}>
              <TabIcon size={12}/>{l}
            </button>
          ))}
        </div>
        {tab !== 'shelf' && (
          <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {CATEGORIES.map((c) => {
              const Icon = CATEGORY_ICON[c] ?? Library;
              return (
                <button key={c} type="button" onClick={() => setCategory(c)}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold shrink-0 transition-all"
                  style={{ background: category === c ? `${B.accent}20` : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${category === c ? `${B.accent}50` : 'transparent'}`,
                    color: category === c ? B.accent : B.t3 }}>
                  <Icon size={13} className="inline mr-1.5"/>{c}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth: 'none' }}>
        {source === null ? (
          <SkyLoader className="py-12" label="Загружаем книги…"/>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <Library size={36} style={{ color: 'var(--t3)' }}/>
            <p className="text-sm" style={{ color: B.t3 }}>
              {tab === 'shelf' ? 'На полке пока пусто' : 'Ничего не найдено'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {filtered.map((b) => (
              <BookCard key={b.id} book={b} onOpen={() => setDetail(b)}/>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
