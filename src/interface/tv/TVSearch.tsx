/* ===========================================================
   SKY TV — Поиск
   Ищет на сервере (кино и музыка общего каталога), а не по уже
   загруженной первой странице. Экранная клавиатура остаётся на
   экране, пока вводишь; физическая клавиатура тоже работает.
   История запросов — по профилю.
=========================================================== */
import { useEffect, useRef, useState } from 'react';
import { Search as SearchIcon, X, Delete, Globe } from 'lucide-react';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl, type ServerMovie } from '@/film/filmApi';
import { useMusicStore } from '@/music/serverStore';
import { playMusicQueue } from '@/music/useMusicSync';
import type { Track } from '@/platform/store';
import { useAuthStore } from '@/core/auth/store';
import { TVFocusable } from './TVFocusable';
import { TVCard } from './TVCard';
import { TVCarousel } from './TVCarousel';
import { tvFocusManager } from './focusManager';

const hKey = () => `sky:tv:searchHistory:v2:${useAuthStore.getState().currentUserId ?? 'anon'}`;
const loadHistory = (): string[] => { try { return JSON.parse(localStorage.getItem(hKey()) || '[]'); } catch { return []; } };
const saveHistory = (h: string[]) => { try { localStorage.setItem(hKey(), JSON.stringify(h.slice(0, 10))); } catch { /* приватный режим */ } };

const RU = ['1234567890', 'ЙЦУКЕНГШЩЗХ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ'];
const EN = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

interface TVSearchProps { onOpenMovie: (id: string) => void; onBack: () => void; }

export const TVSearch = ({ onOpenMovie, onBack }: TVSearchProps) => {
  const searchFilm = useFilmStore(s => s.search);
  const searchMusic = useMusicStore(s => s.search);
  const [query, setQuery] = useState('');
  const [ru, setRu] = useState(true);
  const [history, setHistory] = useState<string[]>(loadHistory());
  const [movies, setMovies] = useState<ServerMovie[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Реальный <input> регистрируем в фокус-менеджере вручную: стрелки находят его как узел.
  useEffect(() => {
    if (!inputRef.current) return undefined;
    return tvFocusManager.register({ id: 'search-input', el: inputRef.current, onEnter: () => inputRef.current?.focus() });
  }, []);
  useEffect(() => { tvFocusManager.focusDefault('kb-1'); }, []);

  // Поиск на сервере с задержкой; устаревший ответ не затирает свежий.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setMovies([]); setTracks([]); setBusy(false); setFailed(false); return undefined; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const [m, tr] = await Promise.all([searchFilm(q), searchMusic(q)]);
        if (!alive) return;
        setMovies(m.filter(x => !x.isShort)); setTracks(tr); setFailed(false);
      } catch { if (alive) setFailed(true); }
      if (alive) setBusy(false);
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [query, searchFilm, searchMusic]);

  const commit = (q: string) => {
    const t = q.trim(); if (!t) return;
    const next = [t, ...history.filter(h => h !== t)];
    setHistory(next); saveHistory(next);
  };
  const typeChar = (c: string) => setQuery(q => q + (ru ? c : c.toLowerCase()));
  const backspace = () => setQuery(q => q.slice(0, -1));
  const rows = ru ? RU : EN;
  const key = (id: string, onEnter: () => void, children: React.ReactNode, wide = false, label?: string) => (
    <TVFocusable key={id} id={id} onEnter={onEnter}>
      {({ focused }) => (
        <div aria-label={label} className="grid h-14 place-items-center rounded-xl text-[22px] font-bold"
          style={{ minWidth: wide ? 120 : 56, padding: wide ? '0 22px' : 0, background: focused ? '#8b7cff' : 'rgba(255,255,255,0.1)', color: '#fff', boxShadow: focused ? '0 0 0 3px rgba(179,167,255,0.9)' : 'none', transform: focused ? 'scale(1.08)' : 'scale(1)', transition: 'all .12s' }}>
          {children}
        </div>
      )}
    </TVFocusable>
  );

  return (
    <div className="px-12 pt-8 pb-14">
      <div className="mb-6 flex items-center gap-4">
        <TVFocusable id="search-back" onEnter={onBack}>
          {({ focused }) => (
            <div aria-label="Закрыть" className="grid h-14 w-14 place-items-center rounded-full" style={{ background: focused ? '#8b7cff' : 'rgba(255,255,255,0.1)', boxShadow: focused ? '0 0 0 3px rgba(179,167,255,0.9)' : 'none' }}>
              <X size={24} color="#fff"/>
            </div>
          )}
        </TVFocusable>
        <div className="flex flex-1 items-center gap-4 rounded-2xl px-6 py-4" style={{ background: 'rgba(255,255,255,0.07)', border: '2px solid #8b7cff' }}>
          <SearchIcon size={26} color="var(--t3)"/>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(query); }}
            placeholder="Фильм, жанр, трек или исполнитель" data-tv-focusable="search-input" aria-label="Поиск" translate="no"
            className="flex-1 bg-transparent text-[26px] font-semibold outline-none" style={{ color: 'var(--t1)' }}/>
        </div>
      </div>

      <div className="mb-8 inline-flex flex-col gap-2 rounded-3xl p-5" style={{ background: 'rgba(255,255,255,0.05)' }}>
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-2">{row.split('').map(c => key(`kb-${ri === 0 ? c : c + ri}`.replace('kb-1', 'kb-1'), () => typeChar(c), c))}</div>
        ))}
        <div className="flex gap-2">
          {key('kb-lang', () => setRu(v => !v), <span className="flex items-center gap-2"><Globe size={22}/>{ru ? 'RU' : 'EN'}</span>, true, 'Язык')}
          {key('kb-space', () => typeChar(' '), 'Пробел', true)}
          {key('kb-back', backspace, <Delete size={22}/>, true, 'Стереть')}
          {key('kb-go', () => commit(query), 'Найти', true)}
        </div>
      </div>

      {!query && history.length > 0 && (
        <div className="mb-8">
          <p className="mb-3 text-[20px] font-bold" style={{ color: 'var(--t3)' }}>Недавние запросы</p>
          <div className="flex flex-wrap gap-3">
            {history.map(h => (
              <TVFocusable key={h} id={`hist-${h}`} onEnter={() => setQuery(h)}>
                {({ focused }) => <div className="rounded-full px-6 py-3 text-[20px] font-semibold" style={{ background: focused ? '#8b7cff' : 'rgba(255,255,255,0.1)', color: '#fff', boxShadow: focused ? '0 0 0 3px rgba(179,167,255,0.9)' : 'none' }} translate="no">{h}</div>}
              </TVFocusable>
            ))}
          </div>
        </div>
      )}

      {query && busy && <p className="text-[20px]" style={{ color: 'var(--t3)' }} role="status">Ищем…</p>}
      {query && failed && <p className="text-[20px]" style={{ color: '#ff8aa0' }} role="alert">Не удалось выполнить поиск — проверьте соединение</p>}
      {query && !busy && !failed && movies.length === 0 && tracks.length === 0 && (
        <p className="text-[20px]" style={{ color: 'var(--t3)' }}>Ничего не найдено по запросу «<span translate="no">{query}</span>»</p>
      )}
      {movies.length > 0 && (
        <TVCarousel title="Кино" items={movies} getId={m => `res-${m.id}`}
          renderItem={(m, p) => <TVCard id={`res-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={m.hasPoster ? posterUrl(m.id) : undefined} rating={m.rating} onEnter={() => { commit(query); onOpenMovie(m.id); }} autoFocusPriority={p}/>}/>
      )}
      {tracks.length > 0 && (
        <TVCarousel title="Музыка" items={tracks} getId={t => `rt-${t.id}`}
          renderItem={(t, p) => <TVCard id={`rt-${t.id}`} title={t.title} subtitle={t.artist} imageUrl={t.coverUrl} aspect="square" onEnter={() => { commit(query); playMusicQueue(tracks, t.id); }} autoFocusPriority={p}/>}/>
      )}
    </div>
  );
};
