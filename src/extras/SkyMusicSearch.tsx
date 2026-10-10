import { useEffect, useMemo, useState, useRef } from 'react';
import { useDictation } from '@/messenger/useDictation';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Mic, Clock, TrendingUp, Mic2, ListMusic, FileText } from 'lucide-react';
import type { Track } from '@/platform/store';
import { useMusicStore } from '@/music/serverStore';
import { getG } from '@/music/utils';

const HISTORY_KEY = 'sky:music:searchHistory:v1';
const loadHist = (): string[] => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } };
const saveHist = (h: string[]) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {} };

// Простое расстояние Левенштейна — для "возможно, вы имели в виду" без ИИ.
const lev = (a: string, b: string): number => {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = a[i-1] === b[j-1] ? d[i-1][j-1] : 1 + Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
  return d[m][n];
};

export const SkyMusicSearch = ({
  tracks, favorites, playing, activeId, onPlay, onLike, onArtist, onClose,
}: {
  tracks: Track[]; favorites: string[]; playing: boolean; activeId: string | null;
  onPlay: (t: Track, pool: Track[]) => void; onLike: (id: string) => void;
  onArtist: (a: string) => void; onClose: () => void;
}) => {
  const playlists = useMusicStore(st => st.playlists);
  const searchServer = useMusicStore(st => st.search);
  // Каталог на устройстве — только первая сотня треков, поэтому поиск
  // спрашивает и сервер. Быстрый ответ даёт местный список, полный —
  // сервер; результаты объединяются по идентификатору.
  const [remote, setRemote] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [q, setQ] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setHistory(loadHist()); inputRef.current?.focus(); }, []);

  const pub = useMemo(() => tracks.filter(t => t.status === 'published'), [tracks]);
  const allArtists = useMemo(() => [...new Set(pub.map(t => t.artist))], [pub]);
  const allGenres  = useMemo(() => [...new Set(pub.map(t => t.genre))], [pub]);
  const albumNames = useMemo(() => [...new Set(pub.map(t => `${t.artist} · ${t.genre}`))], [pub]);

  const popularQueries = useMemo(() => {
    const topArtists = [...allArtists].slice(0, 3);
    const topGenres = [...allGenres].slice(0, 3);
    return [...topArtists, ...topGenres].slice(0, 6);
  }, [allArtists, allGenres]);

  const commit = (term: string) => {
    const t = term.trim(); if (!t) return;
    const next = [t, ...history.filter(h => h !== t)].slice(0, 12);
    setHistory(next); saveHist(next);
  };

  const dictation = useDictation({ oneShot: true, onText: (text) => { setQ(text); commit(text); } });
  const startVoice = () => { void dictation.toggle(); };

  const query = q.toLowerCase().trim();

  useEffect(() => {
    if (query.length < 2) { setRemote([]); setSearching(false); setSearchError(false); return; }
    let alive = true;
    setSearching(true);
    // Пауза перед запросом: иначе на каждую букву уходил бы свой запрос.
    const t = setTimeout(() => {
      void searchServer(query)
        .then(found => { if (alive) { setRemote(found); setSearchError(false); } })
        .catch(() => { if (alive) setSearchError(true); })
        .finally(() => { if (alive) setSearching(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); setSearching(false); };
  }, [query, searchServer]);

  const results = useMemo(() => {
    if (!query) return null;
    const local = pub.filter(t => t.title.toLowerCase().includes(query));
    const seen = new Set(local.map(t => t.id));
    const tr = [...local, ...remote.filter(t => !seen.has(t.id))];
    const ar = allArtists.filter(a => a.toLowerCase().includes(query));
    const ge = allGenres.filter(g => g.toLowerCase().includes(query));
    const al = albumNames.filter(a => a.toLowerCase().includes(query));
    const pl = playlists.filter(p => p.name.toLowerCase().includes(query));
    const lyr = pub.filter(t => t.lyrics && t.lyrics.toLowerCase().includes(query) && !t.title.toLowerCase().includes(query));
    return { tr, ar, ge, al, pl, lyr };
  }, [query, pub, remote, allArtists, allGenres, albumNames, playlists]);

  const totalCount = results ? results.tr.length + results.ar.length + results.ge.length + results.al.length + results.pl.length + results.lyr.length : 0;

  const suggestion = useMemo(() => {
    if (!query || totalCount > 0 || query.length < 3) return null;
    const pool = [...allArtists, ...allGenres, ...pub.map(t => t.title)];
    let best: string | null = null; let bestD = Infinity;
    for (const cand of pool) {
      const d = lev(query, cand.toLowerCase());
      if (d < bestD) { bestD = d; best = cand; }
    }
    return best && bestD <= 2 && bestD > 0 ? best : null;
  }, [query, totalCount, allArtists, allGenres, pub]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="sky-music-scope absolute inset-0 z-30 flex flex-col" style={{ background: 'var(--bg)' }}>
      <div className="flex shrink-0 items-center gap-2 px-4 pt-4 pb-2">
        <div className="flex flex-1 items-center gap-2 rounded-2xl px-3.5 py-2.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <Search size={16} color="#5c626e"/>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(q); }}
            placeholder="Треки, исполнители, тексты песен..."
            className="flex-1 bg-transparent text-[13.5px] outline-none" style={{ color: '#f2f5f8' }}/>
          {q && <button type="button" onClick={() => setQ('')}><X size={15} color="#5c626e"/></button>}
          <button type="button" onClick={startVoice}>
            <Mic size={16} color={dictation.active ? '#4fe3d0' : '#5c626e'}/>
          </button>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-[13px] font-medium" style={{ color: '#8a8f9a' }}>Отмена</button>
      </div>


      <div className="flex-1 overflow-y-auto px-4 pb-8" style={{ scrollbarWidth: 'none' }}>
        {!query && (
          <>
            {history.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#5c626e' }}><Clock size={12}/>История поиска</p>
                <div className="flex flex-wrap gap-1.5">
                  {history.map(h => (
                    <button key={h} type="button" onClick={() => setQ(h)}
                      className="rounded-full px-3 py-1.5 text-[12px]" style={{ background: 'rgba(255,255,255,0.05)', color: '#c7ccd6' }}>{h}</button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#5c626e' }}><TrendingUp size={12}/>Популярные запросы</p>
              <div className="flex flex-wrap gap-1.5">
                {popularQueries.map(p => (
                  <button key={p} type="button" onClick={() => setQ(p)}
                    className="rounded-full px-3 py-1.5 text-[12px]" style={{ background: 'rgba(79,227,208,0.1)', color: '#4fe3d0' }}>{p}</button>
                ))}
              </div>
            </div>
          </>
        )}

        {query && results && (
          <>
            {totalCount === 0 && searching && (
              <div className="py-10 text-center">
                <p className="text-[13px]" style={{ color: '#5c626e' }}>Ищем…</p>
              </div>
            )}
            {totalCount === 0 && !searching && searchError && (
              <div className="py-10 text-center">
                <p className="text-[13px]" style={{ color: '#5c626e' }}>Поиск сейчас недоступен</p>
                <button type="button" onClick={() => setQ(q)} className="mt-2 text-[12.5px]"
                  style={{ color: '#4fe3d0' }}>Повторить</button>
              </div>
            )}
            {totalCount === 0 && !searching && !searchError && (
              <div className="py-10 text-center">
                <p className="text-[13px]" style={{ color: '#5c626e' }}>Ничего не найдено</p>
                {suggestion && (
                  <button type="button" onClick={() => setQ(suggestion)} className="mt-2 text-[12.5px]" style={{ color: '#4fe3d0' }}>
                    Возможно, вы имели в виду «{suggestion}»?
                  </button>
                )}
              </div>
            )}

            {results.tr.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 text-[12px] font-semibold" style={{ color: '#5c626e' }}>Треки</p>
                {results.tr.map(t => {
                  const [c1,c2] = getG(t.id);
                  return (
                    <button key={t.id} type="button" onClick={() => { commit(q); onPlay(t, results.tr); }}
                      className="flex w-full items-center gap-3 py-2 text-left">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `linear-gradient(145deg,${c1},${c2})` }}/>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium" style={{ color: activeId===t.id ? '#4fe3d0' : '#f2f5f8' }}>{t.title}</p>
                        <p className="truncate text-[11.5px]" style={{ color: '#8a8f9a' }}>{t.artist}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {results.ar.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#5c626e' }}><Mic2 size={12}/>Исполнители</p>
                {results.ar.map(a => (
                  <button key={a} type="button" onClick={() => { commit(q); onArtist(a); }} className="flex w-full items-center gap-3 py-2 text-left">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: `linear-gradient(145deg,${getG(a)[0]},${getG(a)[1]})` }}/>
                    <p className="text-[13px] font-medium" style={{ color: '#f2f5f8' }}>{a}</p>
                  </button>
                ))}
              </div>
            )}

            {results.al.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#5c626e' }}><ListMusic size={12}/>Альбомы</p>
                {results.al.map(a => (
                  <button key={a} type="button" onClick={() => { commit(q); const first = pub.find(t => `${t.artist} · ${t.genre}` === a); if (first) onPlay(first, pub.filter(t => `${t.artist} · ${t.genre}` === a)); }}
                    className="flex w-full items-center gap-3 py-2 text-left">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `linear-gradient(145deg,${getG(a)[0]},${getG(a)[1]})` }}/>
                    <p className="text-[13px] font-medium" style={{ color: '#f2f5f8' }}>{a.split(' · ')[0]} <span style={{ color:'#5c626e' }}>· {a.split(' · ')[1]}</span></p>
                  </button>
                ))}
              </div>
            )}

            {results.pl.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 text-[12px] font-semibold" style={{ color: '#5c626e' }}>Плейлисты</p>
                {results.pl.map(p => (
                  <div key={p.id} className="flex items-center gap-3 py-2">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `linear-gradient(145deg,${getG(p.id)[0]},${getG(p.id)[1]})` }}/>
                    <p className="text-[13px] font-medium" style={{ color: '#f2f5f8' }}>{p.name}</p>
                  </div>
                ))}
              </div>
            )}

            {results.ge.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 text-[12px] font-semibold" style={{ color: '#5c626e' }}>Жанры</p>
                <div className="flex flex-wrap gap-1.5">
                  {results.ge.map(g => (
                    <button key={g} type="button" onClick={() => setQ(g)} className="rounded-full px-3 py-1.5 text-[12px]" style={{ background: 'rgba(255,255,255,0.05)', color: '#c7ccd6' }}>{g}</button>
                  ))}
                </div>
              </div>
            )}

            {results.lyr.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#5c626e' }}><FileText size={12}/>Совпадения в текстах песен</p>
                {results.lyr.map(t => (
                  <button key={t.id} type="button" onClick={() => { commit(q); onPlay(t, results.lyr); }} className="flex w-full items-center gap-3 py-2 text-left">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `linear-gradient(145deg,${getG(t.id)[0]},${getG(t.id)[1]})` }}/>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium" style={{ color: '#f2f5f8' }}>{t.title}</p>
                      <p className="truncate text-[11.5px]" style={{ color: '#8a8f9a' }}>{t.artist}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
};
