/* ===========================================================
   SKY TV — Поиск
   Физическая клавиатура работает «из коробки» (обычный <input>),
   плюс экранная TV-клавиатура для пульта без клавиатуры.
=========================================================== */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search as SearchIcon, X, Delete } from 'lucide-react';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl } from '@/film/filmApi';
import { TVFocusable } from './TVFocusable';
import { TVCard } from './TVCard';
import { tvFocusManager } from './focusManager';

const SK_HISTORY = 'sky:tv:searchHistory:v1';
const loadHistory = (): string[] => { try { return JSON.parse(localStorage.getItem(SK_HISTORY) || '[]'); } catch { return []; } };
const saveHistory = (h: string[]) => { try { localStorage.setItem(SK_HISTORY, JSON.stringify(h.slice(0, 10))); } catch {} };

const ROWS = ['ЙЦУКЕНГШЩЗХ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ'];

interface TVSearchProps { onOpenMovie: (id: string) => void; onBack: () => void; }

export const TVSearch = ({ onOpenMovie, onBack }: TVSearchProps) => {
  // Поиск идёт по общему каталогу. Личные фильмы в него не попадают:
  // сервер их в каталоге не отдаёт вовсе.
  const movies = useFilmStore(s => s.catalog);
  const loadFilm = useFilmStore(s => s.load);
  useEffect(() => { void loadFilm(); }, [loadFilm]);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<string[]>(loadHistory());
  const inputRef = useRef<HTMLInputElement>(null);

  // Реальный <input>, а не TVFocusable-div — регистрируем его вручную,
  // чтобы геометрическая навигация (Down от крестика, Up от клавиатуры)
  // реально находила это поле, а не пролетала мимо несуществующего узла.
  useEffect(() => {
    if (!inputRef.current) return;
    const unregister = tvFocusManager.register({
      id: 'search-input', el: inputRef.current,
      onEnter: () => inputRef.current?.focus(),
    });
    return unregister;
  }, []);
  useEffect(() => { tvFocusManager.focusDefault('search-input'); inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return movies.filter(m => !m.isShort && (m.title.toLowerCase().includes(q) || m.genre?.toLowerCase().includes(q))).slice(0, 24);
  }, [movies, query]);

  const commit = (q: string) => {
    const t = q.trim();
    if (!t) return;
    const next = [t, ...history.filter(h => h !== t)];
    setHistory(next); saveHistory(next);
  };

  const typeChar = (c: string) => setQuery(q => q + c);
  const backspace = () => setQuery(q => q.slice(0, -1));

  return (
    <div className="px-10 pt-6 pb-10 h-full overflow-y-auto">
      <div className="flex items-center gap-3 mb-6">
        <TVFocusable id="search-back" onEnter={onBack}>
          {({ focused }) => (
            <div className="grid h-12 w-12 place-items-center rounded-full" style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)' }}>
              <X size={20} color={focused ? '#fff' : 'var(--t2)'}/>
            </div>
          )}
        </TVFocusable>
        <div className="flex-1 flex items-center gap-3 rounded-2xl px-5 py-4" style={{ background: 'var(--bg-l1)', border: '2px solid var(--accent)' }}>
          <SearchIcon size={22} color="var(--t3)"/>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(query); }}
            placeholder="Название фильма или жанр..." data-tv-focusable="search-input"
            className="flex-1 bg-transparent outline-none text-[20px] font-semibold" style={{ color: 'var(--t1)' }}/>
        </div>
      </div>

      {!query && history.length > 0 && (
        <div className="mb-8">
          <p className="mb-3 text-[16px] font-bold" style={{ color: 'var(--t3)' }}>История поиска</p>
          <div className="flex flex-wrap gap-2">
            {history.map(h => (
              <TVFocusable key={h} id={`hist-${h}`} onEnter={() => setQuery(h)}>
                {({ focused }) => (
                  <div className="rounded-full px-4 py-2 text-[14px] font-semibold" style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)', color: focused ? '#fff' : 'var(--t2)' }}>{h}</div>
                )}
              </TVFocusable>
            ))}
          </div>
        </div>
      )}

      {!query && (
        <div className="mb-8">
          <p className="mb-3 text-[16px] font-bold" style={{ color: 'var(--t3)' }}>Экранная клавиатура</p>
          <div className="inline-flex flex-col gap-2 rounded-2xl p-4" style={{ background: 'var(--bg-l1)' }}>
            {ROWS.map((row, ri) => (
              <div key={ri} className="flex gap-2">
                {row.split('').map(c => (
                  <TVFocusable key={c} id={`kb-${c}`} onEnter={() => typeChar(c)}>
                    {({ focused }) => (
                      <div className="grid h-11 w-11 place-items-center rounded-lg text-[16px] font-bold"
                        style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)', color: focused ? '#fff' : 'var(--t1)' }}>{c}</div>
                    )}
                  </TVFocusable>
                ))}
              </div>
            ))}
            <div className="flex gap-2">
              <TVFocusable id="kb-space" onEnter={() => typeChar(' ')}>
                {({ focused }) => <div className="grid h-11 place-items-center rounded-lg px-10 text-[14px] font-bold" style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)', color: focused ? '#fff' : 'var(--t1)' }}>Пробел</div>}
              </TVFocusable>
              <TVFocusable id="kb-back" onEnter={backspace}>
                {({ focused }) => <div className="grid h-11 w-11 place-items-center rounded-lg" style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)' }}><Delete size={17} color={focused ? '#fff' : 'var(--t1)'}/></div>}
              </TVFocusable>
              <TVFocusable id="kb-go" onEnter={() => commit(query)}>
                {({ focused }) => <div className="grid h-11 place-items-center rounded-lg px-6 text-[14px] font-bold text-white" style={{ background: focused ? 'var(--accent)' : 'rgba(var(--accent-rgb,79,110,247),0.6)' }}>Найти</div>}
              </TVFocusable>
            </div>
          </div>
        </div>
      )}

      {query && (
        results.length === 0 ? (
          <p className="text-[16px]" style={{ color: 'var(--t3)' }}>Ничего не найдено по запросу «{query}»</p>
        ) : (
          <div className="flex flex-wrap gap-5">
            {results.map((m, i) => (
              <TVCard key={m.id} id={`res-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={m.hasPoster ? posterUrl(m.id) : undefined} rating={m.rating}
                onEnter={() => { commit(query); onOpenMovie(m.id); }} autoFocusPriority={i === 0 ? 0 : undefined}/>
            ))}
          </div>
        )
      )}
    </div>
  );
};
