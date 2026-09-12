/* ===============================================================
   SKY BOOKS  -  Площадка книг и аудиокниг
=============================================================== */
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Headphones, BookOpen, Star, ChevronLeft, Play, Pause, X, BookMarked, Sparkles,
  Library, PenLine, Rocket, Wand2, Drama, Brain, Landmark, Briefcase,
} from 'lucide-react';

type BookTab = 'home' | 'ebooks' | 'audio' | 'shelf';
type Genre   = 'all' | 'fiction' | 'scifi' | 'thriller' | 'business' | 'self' | 'history' | 'fantasy';

interface Book {
  id: string; title: string; author: string; genre: Genre;
  cover: string;       // gradient colors [from, to]
  rating: number; reviews: number;
  pages?: number; duration?: string;  // audio
  isPrime: boolean; price: number;
  description: string; hasAudio: boolean; hasEbook: boolean;
}

const BOOKS: Book[] = [
  { id:'b1', title:'Мастер и Маргарита', author:'М. Булгаков', genre:'fiction',
    cover:'#1a1a4e,#4a0080', rating:4.9, reviews:28400, pages:480, duration:'14ч 22м',
    isPrime:false, price:299, description:'Культовый роман о добре и зле, любви и свободе.',
    hasAudio:true, hasEbook:true },
  { id:'b2', title:'Dune', author:'Фрэнк Герберт', genre:'scifi',
    cover:'#3d1c00,#8b4513', rating:4.8, reviews:41200, pages:688, duration:'21ч 08м',
    isPrime:true, price:0, description:'Эпическая сага о планете Арракис и судьбах вселенной.',
    hasAudio:true, hasEbook:true },
  { id:'b3', title:'Думай медленно, решай быстро', author:'Д. Канеман', genre:'self',
    cover:'#003366,#0066cc', rating:4.7, reviews:19800, pages:499, duration:'19ч 14м',
    isPrime:true, price:0, description:'Нобелевский лауреат о двух системах мышления.',
    hasAudio:true, hasEbook:true },
  { id:'b4', title:'Преступление и наказание', author:'Ф. Достоевский', genre:'fiction',
    cover:'#1a0000,#660000', rating:4.8, reviews:35100, pages:671, duration:'23ч 45м',
    isPrime:false, price:199, description:'Психологический роман о преступлении и искуплении.',
    hasAudio:true, hasEbook:true },
  { id:'b5', title:'Сапиенс', author:'Ю. Н. Харари', genre:'history',
    cover:'#001a33,#003366', rating:4.6, reviews:52300, pages:512, duration:'15ч 17м',
    isPrime:true, price:0, description:'Краткая история человечества от камня до AI.',
    hasAudio:true, hasEbook:true },
  { id:'b6', title:'Гарри Поттер и Философский камень', author:'Дж. Роулинг', genre:'fantasy',
    cover:'#1a0033,#330066', rating:4.9, reviews:78900, pages:309, duration:'8ч 18м',
    isPrime:false, price:349, description:'Начало легендарной истории о волшебнике.',
    hasAudio:true, hasEbook:true },
  { id:'b7', title:'Атлант расправил плечи', author:'А. Рэнд', genre:'business',
    cover:'#0a0a0a,#1a1a2e', rating:4.5, reviews:12400, pages:1168, duration:'54ч 30м',
    isPrime:true, price:0, description:'Философский роман о свободе и производительности.',
    hasAudio:false, hasEbook:true },
  { id:'b8', title:'Три товарища', author:'Э. М. Ремарк', genre:'fiction',
    cover:'#1a1a00,#4a4a00', rating:4.8, reviews:24600, pages:448, duration:'13ч 02м',
    isPrime:false, price:249, description:'История дружбы и любви в послевоенной Германии.',
    hasAudio:true, hasEbook:true },
];

const GENRES: { key:Genre; label:string; Icon:typeof Library }[] = [
  { key:'all',     label:'Все',          Icon:Library },
  { key:'fiction', label:'Классика',     Icon:PenLine },
  { key:'scifi',   label:'Фантастика',   Icon:Rocket },
  { key:'fantasy', label:'Фэнтези',      Icon:Wand2 },
  { key:'thriller',label:'Триллер',      Icon:Drama },
  { key:'business',label:'Бизнес',       Icon:Briefcase },
  { key:'self',    label:'Саморазвитие', Icon:Brain },
  { key:'history', label:'История',      Icon:Landmark },
];

const B = {
  bg:'#0a0a0f', l1:'#111118', l2:'var(--bg-l2)',
  accent:'#a855f7', amber:'var(--amber)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  border:'var(--border)',
};

/* -- Book Card -------------------------------------------- */
const BookCard = ({ book, onOpen }: { book:Book; onOpen:()=>void }) => {
  const [from, to] = book.cover.split(',');
  return (
    <motion.button type="button" whileTap={{ scale:.95 }} onClick={onOpen}
      className="flex flex-col text-left relative overflow-hidden rounded-2xl">
      {/* Cover */}
      <div className="relative w-full rounded-2xl overflow-hidden"
        style={{ aspectRatio:'2/3', background:`linear-gradient(155deg,${from},${to})` }}>
        <div className="absolute inset-0 flex items-center justify-center text-5xl">
          {(() => { const I = GENRES.find(g=>g.key===book.genre)?.Icon ?? BookOpen;
            return <I size={26} style={{ color:'rgba(255,255,255,0.8)' }}/>; })()}
        </div>
        {/* Prime badge */}
        {book.isPrime && (
          <div className="absolute top-2 left-2 rounded-full px-2 py-0.5 text-[9px] font-black"
            style={{ background:'var(--amber)', color:'#000' }}>PRIME</div>
        )}
        {/* Type badges */}
        <div className="absolute bottom-2 right-2 flex gap-1">
          {book.hasAudio && (
            <div className="grid h-5 w-5 place-items-center rounded-full"
              style={{ background:'rgba(0,0,0,0.7)' }}>
              <Headphones size={10} className="text-white"/>
            </div>
          )}
          {book.hasEbook && (
            <div className="grid h-5 w-5 place-items-center rounded-full"
              style={{ background:'rgba(0,0,0,0.7)' }}>
              <BookOpen size={10} className="text-white"/>
            </div>
          )}
        </div>
      </div>
      {/* Info */}
      <div className="pt-2 px-0.5">
        <p className="text-xs font-bold text-white leading-tight line-clamp-2">{book.title}</p>
        <p className="text-[10px] mt-0.5 truncate" style={{ color:B.t3 }}>{book.author}</p>
        <div className="flex items-center gap-1 mt-1">
          <Star size={9} style={{ color:B.amber }} fill={B.amber}/>
          <span className="text-[10px] font-semibold" style={{ color:B.t2 }}>{book.rating}</span>
        </div>
        <p className="text-[10px] font-bold mt-1" style={{ color: book.isPrime ? B.amber : B.accent }}>
          {book.isPrime ? 'Prime' : `${book.price} ₽`}
        </p>
      </div>
    </motion.button>
  );
};

/* -- Book Detail ------------------------------------------ */
const BookDetail = ({ book, onBack }: { book:Book; onBack:()=>void }) => {
  const [mode, setMode] = useState<'ebook'|'audio'>('ebook');
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const SK = 'sky:books:shelf:v1';
  const [shelf, setShelf] = useState(() => {
    try { return (JSON.parse(localStorage.getItem(SK)||'[]') as string[]).includes(book.id); } catch { return false; }
  });
  const toggleShelf = () => {
    setShelf(v => {
      const next = !v;
      try {
        const cur: string[] = JSON.parse(localStorage.getItem(SK)||'[]');
        const updated = next ? [...cur, book.id] : cur.filter((x:string)=>x!==book.id);
        localStorage.setItem(SK, JSON.stringify(updated));
      } catch {}
      return next;
    });
  };
  const [from, to] = book.cover.split(',');

  return (
    <motion.div initial={{ opacity:0, x:30 }} animate={{ opacity:1, x:0 }}
      className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth:'none', background:B.bg }}>
      {/* Hero */}
      <div className="relative overflow-hidden"
        style={{ background:`linear-gradient(180deg,${from},${to},${B.bg})`, paddingBottom:24 }}>
        {/* Back */}
        <button type="button" onClick={onBack}
          className="absolute top-4 left-4 grid h-9 w-9 place-items-center rounded-full z-10"
          style={{ background:'rgba(0,0,0,0.4)', backdropFilter:'blur(8px)' }}>
          <ChevronLeft size={18} className="text-white"/>
        </button>
        {/* Save */}
        <button type="button" onClick={toggleShelf}
          className="absolute top-4 right-4 grid h-9 w-9 place-items-center rounded-full z-10"
          style={{ background: shelf ? `${B.accent}30` : 'rgba(0,0,0,0.4)', backdropFilter:'blur(8px)' }}>
          <BookMarked size={18} style={{ color: shelf ? B.accent : 'white' }}/>
        </button>
        {/* Cover art */}
        <div className="flex justify-center pt-12 pb-4">
          <div className="relative rounded-3xl overflow-hidden shadow-2xl"
            style={{ width:130, height:195,
              background:`linear-gradient(155deg,${from},${to})`,
              boxShadow:`0 20px 60px ${from}80` }}>
            <div className="absolute inset-0 flex items-center justify-center text-6xl">
              {(() => { const I = GENRES.find(g=>g.key===book.genre)?.Icon ?? BookOpen;
            return <I size={26} style={{ color:'rgba(255,255,255,0.8)' }}/>; })()}
            </div>
          </div>
        </div>
        {/* Info */}
        <div className="text-center px-6 pb-2">
          <h1 className="text-xl font-black text-white leading-snug">{book.title}</h1>
          <p className="text-sm mt-1" style={{ color:B.t2 }}>{book.author}</p>
          <div className="flex items-center justify-center gap-3 mt-2">
            <div className="flex items-center gap-1">
              <Star size={13} style={{ color:B.amber }} fill={B.amber}/>
              <span className="text-sm font-bold" style={{ color:B.t1 }}>{book.rating}</span>
              <span className="text-xs" style={{ color:B.t3 }}>({book.reviews.toLocaleString('ru')})</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 px-4 mb-4">
        {book.hasEbook && (
          <button type="button" onClick={() => setMode('ebook')}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-bold transition-all"
            style={{ background: mode==='ebook' ? B.accent : B.l2,
              color: mode==='ebook' ? '#fff' : B.t2 }}>
            <BookOpen size={15}/> Читать {book.pages && `· ${book.pages} стр.`}
          </button>
        )}
        {book.hasAudio && (
          <button type="button" onClick={() => setMode('audio')}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-bold transition-all"
            style={{ background: mode==='audio' ? B.accent : B.l2,
              color: mode==='audio' ? '#fff' : B.t2 }}>
            <Headphones size={15}/> Слушать {book.duration && `· ${book.duration}`}
          </button>
        )}
      </div>

      {/* Audio player */}
      {mode === 'audio' && book.hasAudio && (
        <div className="mx-4 rounded-3xl p-4 mb-4"
          style={{ background:`linear-gradient(135deg,${from}30,${B.l2})`, border:`1px solid ${from}40` }}>
          <p className="text-xs font-bold mb-3" style={{ color:B.t3 }}>Аудиокнига · {book.duration}</p>
          {/* Seek bar */}
          <div className="h-1.5 rounded-full mb-3" style={{ background:'rgba(255,255,255,0.1)' }}>
            <div className="h-full w-1/4 rounded-full" style={{ background:B.accent }}/>
          </div>
          <div className="flex items-center justify-between text-[10px] mb-3" style={{ color:B.t3 }}>
            <span>0:00</span><span>{book.duration}</span>
          </div>
          {/* Hidden audio */}
          <audio ref={audioRef} onEnded={()=>setPlaying(false)} preload="none"/>
          {/* Controls */}
          <div className="flex items-center justify-center gap-6">
            {['⏮','⏪'].map(ic => (
              <button key={ic} type="button" className="text-xl" style={{ color:B.t2 }}>{ic}</button>
            ))}
            <motion.button type="button" whileTap={{ scale:.9 }}
              onClick={() => {
                if (playing) { audioRef.current?.pause(); setPlaying(false); }
                else { audioRef.current?.play().catch(()=>{}); setPlaying(true); }
              }}
              className="grid h-14 w-14 place-items-center rounded-full"
              style={{ background:B.accent, boxShadow:`0 8px 24px ${B.accent}50` }}>
              {playing ? <Pause size={24} className="text-white"/> : <Play size={24} className="text-white"/>}
            </motion.button>
            {['⏩','⏭'].map(ic => (
              <button key={ic} type="button" className="text-xl" style={{ color:B.t2 }}>{ic}</button>
            ))}
          </div>
          {playing && (
            <div className="flex items-end justify-center gap-0.5 h-6 mt-3">
              {[...Array(16)].map((_,i) => (
                <motion.div key={i} className="w-0.5 rounded-full"
                  style={{ background:B.accent }}
                  animate={{ height:[2,4+Math.sin(i)*8+6,2] }}
                  transition={{ duration:0.4+i%3*0.1, repeat:Infinity, repeatType:'reverse' }}/>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Description */}
      <div className="px-4 pb-4 space-y-4">
        <div className="rounded-2xl p-4" style={{ background:B.l1, border:`1px solid ${B.border}` }}>
          <p className="text-xs font-bold mb-2" style={{ color:B.t3 }}>О книге</p>
          <p className="text-sm leading-relaxed" style={{ color:B.t2 }}>{book.description}</p>
          {/* Metadata */}
          <div className="flex gap-4 mt-3 flex-wrap">
            {book.pages && (
              <div className="text-xs" style={{ color:B.t3 }}>
                <span className="font-bold text-white">{book.pages}</span> страниц
              </div>
            )}
            {book.duration && (
              <div className="text-xs" style={{ color:B.t3 }}>
                <span className="font-bold text-white">{book.duration}</span> аудио
              </div>
            )}
            <div className="text-xs" style={{ color:B.t3 }}>
              <span className="font-bold" style={{ color:B.accent }}>
                {GENRES.find(g=>g.key===book.genre)?.label}
              </span>
            </div>
          </div>
        </div>

        {/* CTA */}
        <motion.button whileTap={{ scale:.97 }} type="button"
          className="w-full rounded-3xl py-4 text-base font-black text-white"
          style={{ background: book.isPrime
            ? `linear-gradient(135deg,#f59e0b,#d97706)`
            : `linear-gradient(135deg,${B.accent},#7c3aed)`,
            boxShadow:`0 8px 32px ${book.isPrime?'#f59e0b50':B.accent+'50'}` }}>
          {book.isPrime ? 'Читать с Prime' : `Купить за ${book.price} ₽`}
        </motion.button>
      </div>
    </motion.div>
  );
};

/* === MAIN SkyBooks ======================================= */
export const SkyBooks = () => {
  const [tab,    setTab]    = useState<BookTab>('home');
  const [genre,  setGenre]  = useState<Genre>('all');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Book|null>(null);
  const [shelf,  setShelf]  = useState<string[]>([]);
  // Состояние — до любого возврата: хук, вызванный через раз, роняет
  // экран целиком, а не портит вид.
  const [shelfIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('sky:books:shelf:v1')||'[]'); } catch { return []; }
  });

  if (detail) return <BookDetail book={detail} onBack={() => setDetail(null)}/>;
  const filtered = BOOKS.filter(b => {
    if (genre !== 'all' && b.genre !== genre) return false;
    if (tab === 'audio' && !b.hasAudio)  return false;
    if (tab === 'ebooks' && !b.hasEbook) return false;
    if (tab === 'shelf' && !shelfIds.includes(b.id)) return false;
    if (search && !b.title.toLowerCase().includes(search.toLowerCase()) &&
        !b.author.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:B.bg }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-black text-white">Sky Books</h1>
            <p className="text-xs" style={{ color:B.t3 }}>Книги и аудиокниги</p>
          </div>
          <div className="flex items-center gap-1">
            <Sparkles size={16} style={{ color:B.accent }}/>
            <span className="text-xs font-bold" style={{ color:B.accent }}>Prime included</span>
          </div>
        </div>
        {/* Search */}
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2.5 mb-3"
          style={{ background:B.l1, border:`1px solid ${B.border}` }}>
          <Search size={14} style={{ color:B.t3 }}/>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Поиск книг, авторов..." className="flex-1 bg-transparent text-sm outline-none"
            style={{ color:B.t1 }}/>
        </div>
        {/* Tabs */}
        <div className="flex gap-1.5 mb-3">
          {([['home',Library,'Главная'],['ebooks',BookOpen,'Электронные'],['audio',Headphones,'Аудио'],['shelf',BookMarked,'Полка']] as const).map(([k,TabIcon,l])=>(
            <button key={k} type="button" onClick={()=>setTab(k)}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all"
              style={{ background:tab===k?B.accent:'var(--border)',
                color:tab===k?'#fff':B.t3 }}>
              <TabIcon size={12}/>{l}
            </button>
          ))}
        </div>
        {/* Genre pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth:'none' }}>
          {GENRES.map(g => (
            <button key={g.key} type="button" onClick={()=>setGenre(g.key)}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold shrink-0 transition-all"
              style={{ background:genre===g.key?`${B.accent}20`:'rgba(255,255,255,0.05)',
                border:`1px solid ${genre===g.key?B.accent+'50':'transparent'}`,
                color:genre===g.key?B.accent:B.t3 }}>
              <g.Icon size={13} className="inline mr-1.5"/>{g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Featured (home only) */}
      {tab === 'home' && !search && (
        <div className="px-4 mb-4 shrink-0">
          <div className="rounded-3xl overflow-hidden relative cursor-pointer"
            style={{ background:'linear-gradient(135deg,#1a0533,#4a007a)', height:140 }}
            onClick={() => setDetail(BOOKS[2])}>
            <div className="absolute inset-0 flex items-center gap-4 px-5">
              <BookOpen size={44} style={{ color:'rgba(255,255,255,0.8)' }}/>
              <div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background:'var(--amber)', color:'#000' }}>PRIME</span>
                <p className="text-base font-black text-white mt-1 leading-tight">{BOOKS[2].title}</p>
                <p className="text-xs mt-0.5" style={{ color:'rgba(255,255,255,0.6)' }}>{BOOKS[2].author}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth:'none' }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <Library size={36} style={{ color:'var(--t3)' }}/>
            <p className="text-sm" style={{ color:B.t3 }}>Ничего не найдено</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {filtered.map(b => (
              <BookCard key={b.id} book={b} onOpen={() => setDetail(b)}/>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
