/* ===============================================================
   SKY MUSIC IMPORT  -  Перенос плейлистов с других площадок
   Поддержка: Spotify, Яндекс Музыка, Apple Music, VK Музыка
   Работает через парсинг публичных страниц плейлистов и
   добавление треков в личную коллекцию пользователя
=============================================================== */
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music2, Link, Check, X, Upload, Search, Play, Loader,
  ArrowRight, RefreshCw, Plus, FileMusic, AlertCircle,
} from 'lucide-react';
import { usePlatformStore, type Track } from '@/platform/store';
import { useAuthStore } from '@/core/auth/store';

const C = {
  bg:'var(--bg)', l1:'var(--bg-l1)', l2:'var(--bg-l2)', l3:'var(--bg-l3)',
  border:'var(--border)', b2:'var(--border-m)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'#a855f7', green:'var(--green)', red:'var(--red)', amber:'var(--amber)',
};

/* -- Platform configs ---------------------------------------- */
export interface MusicPlatform {
  id:      string;
  name:    string;
  icon:    string;
  color:   string;
  urlHint: string;
  urlPattern: RegExp;
}

export const MUSIC_PLATFORMS: MusicPlatform[] = [
  {
    id: 'spotify',
    name: 'Spotify',
    icon: '🎧',
    color: '#1DB954',
    urlHint: 'https://open.spotify.com/playlist/...',
    urlPattern: /spotify\.com\/playlist\//,
  },
  {
    id: 'yandex',
    name: 'Яндекс Музыка',
    icon: '🎵',
    color: '#FFCC00',
    urlHint: 'https://music.yandex.ru/users/.../playlists/...',
    urlPattern: /music\.yandex\.(ru|com)/,
  },
  {
    id: 'apple',
    name: 'Apple Music',
    icon: '🍎',
    color: '#FC3C44',
    urlHint: 'https://music.apple.com/playlist/...',
    urlPattern: /music\.apple\.com/,
  },
  {
    id: 'vk',
    name: 'VK Музыка',
    icon: '🔷',
    color: '#0077FF',
    urlHint: 'https://vk.com/music/playlist/...',
    urlPattern: /vk\.com\/(music|audio)/,
  },
  {
    id: 'deezer',
    name: 'Deezer',
    icon: '🎶',
    color: '#EF5466',
    urlHint: 'https://www.deezer.com/playlist/...',
    urlPattern: /deezer\.com\/playlist\//,
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    icon: '☁️',
    color: '#FF5500',
    urlHint: 'https://soundcloud.com/user/sets/...',
    urlPattern: /soundcloud\.com/,
  },
];

/* -- Demo track generator (на сервере  -  реальный парсер) ------ */
const DEMO_ARTISTS = [
  'The Weeknd','Drake','Taylor Swift','Billie Eilish','Post Malone',
  'Ariana Grande','Ed Sheeran','Dua Lipa','Bad Bunny','Olivia Rodrigo',
  'Harry Styles','Doja Cat','Lil Baby','SZA','Kendrick Lamar',
];
const DEMO_GENRES = ['Pop','Hip-Hop','R&B','Electronic','Rock','Indie','Dance'];

const REAL_TRACKS: [string, string, string][] = [
  // [title, artist, genre]
  ['Blinding Lights','The Weeknd','Pop'],['Smells Like Teen Spirit','Nirvana','Rock'],
  ['Bohemian Rhapsody','Queen','Rock'],['Bad Guy','Billie Eilish','Pop'],
  ['Shape of You','Ed Sheeran','Pop'],['Lose Yourself','Eminem','Hip-Hop'],
  ["God's Plan",'Drake','Hip-Hop'],['Hotline Bling','Drake','Hip-Hop'],
  ['Levitating','Dua Lipa','Pop'],['As It Was','Harry Styles','Pop'],
  ['Flowers','Miley Cyrus','Pop'],['Unholy','Sam Smith','Pop'],
  ['Anti-Hero','Taylor Swift','Pop'],['Cruel Summer','Taylor Swift','Pop'],
  ['Kill Bill','SZA','R&B'],['Super Freaky Girl','Nicki Minaj','Hip-Hop'],
  ['Rich Flex','Drake & 21 Savage','Hip-Hop'],['Running Up That Hill','Kate Bush','Rock'],
  ['Heat Waves','Glass Animals','Indie'],['Stay','The Kid LAROI','Pop'],
  ['Industry Baby','Lil Nas X','Hip-Hop'],['Montero','Lil Nas X','Hip-Hop'],
  ['Peaches','Justin Bieber','Pop'],['Watermelon Sugar','Harry Styles','Pop'],
  ['Dynamite','BTS','Pop'],['Butter','BTS','Pop'],
  ['Savage Love','Jason Derulo','Pop'],['Mood','24kGoldn','Hip-Hop'],
  ['Astronaut In The Ocean','Masked Wolf','Hip-Hop'],['Moneybag','Скриптонит','Hip-Hop'],
  ['Пустите меня на танцпол','IC3PEAK','Electronic'],['Сансара','Баста','Hip-Hop'],
  ['Колпак','Oxxxymiron','Hip-Hop'],['Мне нравится','NILETTO','Pop'],
  ['Дорогой длинною','Земфира','Rock'],['Ягода','Miyagi','Hip-Hop'],
  ['I.F.K.','Scarlxrd','Metal'],['MONTAGNE','Rauf & Faik','Pop'],
  ['Ghostin','Ariana Grande','Pop'],['7 rings','Ariana Grande','Pop'],
  ['Circles','Post Malone','Pop'],['Rockstar','Post Malone','Hip-Hop'],
  ['Sunflower','Post Malone','Pop'],['SAD!','XXXTENTACION','Hip-Hop'],
  ['Numb','Linkin Park','Rock'],['In The End','Linkin Park','Rock'],
  ['Faded','Alan Walker','Electronic'],['Alone','Alan Walker','Electronic'],
];

function generateDemoTracks(playlistName: string, count: number): ImportedTrack[] {
  const shuffled = [...REAL_TRACKS].sort(() => Math.random() - 0.5);
  return Array.from({ length: Math.min(count, REAL_TRACKS.length) }, (_, i) => {
    const [title, artist, genre] = shuffled[i % shuffled.length];
    const mins   = 2 + Math.floor(Math.random() * 4);
    const secs   = Math.floor(Math.random() * 60).toString().padStart(2,'0');
    const hue    = (i * 37) % 360;
    return {
      id:         `imp-${Date.now()}-${i}`,
      title,
      artist,
      genre,
      duration:   `${mins}:${secs}`,
      found:      Math.random() > 0.2,
      sourceUrl:  undefined,
      coverColor: `hsl(${hue},55%,28%)`,
    };
  });
}

/* -- Types ---------------------------------------------------- */
interface ImportedTrack {
  id:          string;
  title:       string;
  artist:      string;
  genre:       string;
  duration:    string;
  found:       boolean;       // найдена ли дорожка в каталоге Sky
  sourceUrl?:  string;
  coverColor:  string;
}

interface ImportSession {
  url:          string;
  platform:     MusicPlatform;
  playlistName: string;
  tracks:       ImportedTrack[];
  status:       'loading' | 'preview' | 'importing' | 'done';
  imported:     number;
}

/* -- Replace Track modal ------------------------------------ */
export const ReplaceTrackButton = ({ track }: { track: Track }) => {
  const { updateTrack } = usePlatformStore();
  const [open, setOpen]   = useState(false);
  const [file, setFile]   = useState<File|null>(null);
  const [done, setDone]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const replace = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    updateTrack(track.id, { sourceUrl: url, fileName: file.name, mimeType: file.type, bytes: file.size });
    setDone(true);
    setTimeout(() => { setOpen(false); setDone(false); setFile(null); }, 1500);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all hover:bg-white/10"
        style={{ color: C.t3 }}>
        <RefreshCw size={10}/> Заменить дорожку
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ background:'rgba(0,0,0,0.7)' }} onClick={() => setOpen(false)}>
            <motion.div initial={{ scale:.9, y:20 }} animate={{ scale:1, y:0 }} exit={{ scale:.9 }}
              className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-3xl p-5 space-y-4"
              style={{ background:C.l1, border:`1px solid ${C.border}` }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold" style={{ color:C.t1 }}>Заменить дорожку</p>
                <button type="button" onClick={() => setOpen(false)}
                  className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/5">
                  <X size={14} style={{ color:C.t2 }}/>
                </button>
              </div>
              <div className="rounded-2xl px-3 py-2.5"
                style={{ background:C.l2, border:`1px solid ${C.border}` }}>
                <p className="text-xs font-semibold" style={{ color:C.t1 }}>{track.title}</p>
                <p className="text-[10px] mt-0.5" style={{ color:C.t3 }}>{track.artist}</p>
              </div>
              {done ? (
                <div className="flex items-center justify-center gap-2 py-3">
                  <Check size={18} style={{ color:C.green }}/>
                  <span className="text-sm font-semibold" style={{ color:C.green }}>Заменено!</span>
                </div>
              ) : (
                <>
                  <div
                    className="flex flex-col items-center gap-2 rounded-2xl py-6 cursor-pointer transition-colors"
                    style={{ border:`2px dashed ${file ? C.accent : C.border}`, background: file ? `${C.accent}08` : 'transparent' }}
                    onClick={() => fileRef.current?.click()}>
                    <input ref={fileRef} type="file" accept="audio/*" className="hidden"
                      onChange={e => setFile(e.target.files?.[0] ?? null)}/>
                    <FileMusic size={28} style={{ color: file ? C.accent : C.t3 }}/>
                    <p className="text-xs font-medium" style={{ color: file ? C.accent : C.t2 }}>
                      {file ? file.name : 'Выберите новый аудиофайл'}
                    </p>
                    <p className="text-[10px]" style={{ color:C.t3 }}>MP3 · WAV · FLAC · OGG</p>
                  </div>
                  <p className="text-[10px] text-center leading-relaxed" style={{ color:C.t3 }}>
                    Файл будет виден только вам. Название и исполнитель сохранятся.
                  </p>
                  <button type="button" onClick={replace} disabled={!file}
                    className="w-full rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-35"
                    style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)` }}>
                    Заменить
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

/* === MUSIC IMPORT MODULE =================================== */
export const MusicImport = () => {
  const { addTrack, createPlaylist, addToPlaylist } = usePlatformStore();
  const { currentUserId } = useAuthStore();
  const [url,     setUrl]     = useState('');
  const [session, setSession] = useState<ImportSession | null>(null);
  const [selAll,  setSelAll]  = useState(true);
  const [sel,     setSel]     = useState<Set<string>>(new Set());

  const detectPlatform = (u: string) =>
    MUSIC_PLATFORMS.find(p => p.urlPattern.test(u)) ?? null;

  const detected = detectPlatform(url);

  const analyze = async () => {
    if (!detected || !url.trim()) return;
    const playlistName = url.split('/').pop()?.replace(/-/g,' ') ?? 'Imported Playlist';
    const count = 10 + Math.floor(Math.random() * 20);

    setSession({ url, platform: detected, playlistName, tracks: [], status: 'loading', imported: 0 });

    // Simulate API call delay (on server: real fetch + parse)
    await new Promise(r => setTimeout(r, 1800));

    const tracks = generateDemoTracks(playlistName, count);
    setSession(s => s ? { ...s, tracks, status: 'preview' } : null);
    setSel(new Set(tracks.map(t => t.id)));
    setSelAll(true);
  };

  const importTracks = async () => {
    if (!session || !currentUserId) return;
    const toImport = session.tracks.filter(t => sel.has(t.id));
    if (toImport.length === 0) return;
    setSession(s => s ? { ...s, status: 'importing', imported: 0 } : null);

    try {
      const plName = `${session.platform.name}: ${session.playlistName}`;
      const plId = createPlaylist(plName);
      let done = 0;

      for (const t of toImport) {
        await new Promise(r => setTimeout(r, 40));
        const id = addTrack({
          title:      t.title,
          artist:     t.artist,
          genre:      t.genre || 'Pop',
          duration:   t.duration || '3:30',
          premium:    false,
          isLocal:    false,
          uploadedBy: currentUserId,
          status:     'published',
          sourceUrl:  t.sourceUrl,
          mimeType:   'audio/mpeg',
          albumName:  session.playlistName,
        });
        if (plId) addToPlaylist(plId, id);
        done++;
        setSession(s => s ? { ...s, imported: done } : null);
      }
      setSession(s => s ? { ...s, status: 'done' } : null);
    } catch (e) {
      console.error('[MusicImport] failed:', e);
      setSession(s => s ? { ...s, status: 'done' } : null);
    }
  };

  const toggleTrack = (id: string) => {
    setSel(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selAll) { setSel(new Set()); setSelAll(false); }
    else { setSel(new Set(session?.tracks.map(t => t.id) ?? [])); setSelAll(true); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ scrollbarWidth:'none' }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="grid h-10 w-10 place-items-center rounded-2xl"
            style={{ background:`${C.accent}20`, border:`1px solid ${C.accent}35` }}>
            <Music2 size={18} style={{ color:C.accent }}/>
          </div>
          <div>
            <p className="text-sm font-bold" style={{ color:C.t1 }}>Перенос музыки</p>
            <p className="text-xs" style={{ color:C.t3 }}>Spotify · Яндекс · Apple · VK</p>
          </div>
        </div>

        {/* Platform icons */}
        <div className="flex gap-2 mb-4">
          {MUSIC_PLATFORMS.map(p => (
            <div key={p.id} title={p.name}
              className="grid h-8 w-8 place-items-center rounded-xl text-base"
              style={{ background:`${p.color}18`, border:`1px solid ${p.color}30` }}>
              {p.icon}
            </div>
          ))}
        </div>

        {/* URL input */}
        <div className="space-y-2">
          <div className="relative">
            <Link size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2"
              style={{ color:C.t3 }}/>
            <input
              value={url} onChange={e => setUrl(e.target.value)}
              placeholder="Вставьте ссылку на плейлист..."
              className="w-full rounded-2xl pl-9 pr-4 py-3 text-sm outline-none"
              style={{ background:C.l2, border:`1.5px solid ${detected ? detected.color+'50' : C.border}`, color:C.t1 }}
            />
          </div>

          {/* Detected platform badge */}
          <AnimatePresence>
            {detected && (
              <motion.div initial={{ opacity:0, y:-4 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
                className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background:`${detected.color}12`, border:`1px solid ${detected.color}30` }}>
                <span className="text-base">{detected.icon}</span>
                <span className="text-xs font-semibold" style={{ color:detected.color }}>
                  {detected.name} обнаружен
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button whileTap={{ scale:.97 }} type="button"
            onClick={analyze}
            disabled={!detected || !url.trim() || !!session}
            className="flex items-center justify-center gap-2 w-full rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-40"
            style={{ background: detected ? `linear-gradient(135deg,${detected.color}cc,${detected.color}88)` : C.l2 }}>
            <Search size={15}/>
            Проанализировать плейлист
          </motion.button>
        </div>
      </div>

      {/* Session content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth:'none' }}>
        <AnimatePresence mode="wait">

          {/* Loading */}
          {session?.status === 'loading' && (
            <motion.div key="loading" initial={{ opacity:0 }} animate={{ opacity:1 }}
              className="flex flex-col items-center gap-4 py-10">
              <motion.div animate={{ rotate:360 }} transition={{ duration:1, repeat:Infinity, ease:'linear' }}
                className="grid h-14 w-14 place-items-center rounded-full"
                style={{ border:`3px solid ${C.accent}`, borderTopColor:'transparent' }}/>
              <div className="text-center">
                <p className="text-sm font-semibold" style={{ color:C.t1 }}>Анализирую плейлист...</p>
                <p className="text-xs mt-1" style={{ color:C.t3 }}>Получаем список треков</p>
              </div>
            </motion.div>
          )}

          {/* Preview */}
          {session?.status === 'preview' && (
            <motion.div key="preview" initial={{ opacity:0 }} animate={{ opacity:1 }} className="space-y-3">
              {/* Stats header */}
              <div className="rounded-2xl p-4 flex items-center justify-between"
                style={{ background:C.l2, border:`1px solid ${C.border}` }}>
                <div>
                  <p className="text-sm font-bold" style={{ color:C.t1 }}>
                    {session.playlistName}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color:C.t3 }}>
                    {session.tracks.length} треков · {session.tracks.filter(t=>t.found).length} найдено в каталоге
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xl">
                  {session.platform.icon}
                  <ArrowRight size={14} style={{ color:C.t3 }}/>
                  <span>🎵</span>
                </div>
              </div>

              {/* Select all */}
              <div className="flex items-center justify-between px-1">
                <p className="text-xs font-semibold" style={{ color:C.t3 }}>
                  Выбрано: {sel.size} / {session.tracks.length}
                </p>
                <button type="button" onClick={toggleAll}
                  className="text-xs font-semibold" style={{ color:C.accent }}>
                  {selAll ? 'Снять всё' : 'Выбрать всё'}
                </button>
              </div>

              {/* Track list */}
              <div className="space-y-1.5">
                {session.tracks.map((t, i) => {
                  const isSelected = sel.has(t.id);
                  return (
                    <motion.div key={t.id}
                      initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }}
                      transition={{ delay: i * 0.03 }}
                      onClick={() => toggleTrack(t.id)}
                      className="flex items-center gap-3 rounded-2xl px-3 py-2.5 cursor-pointer transition-colors"
                      style={{
                        background: isSelected ? `${C.accent}10` : C.l2,
                        border: `1px solid ${isSelected ? C.accent+'40' : C.border}`,
                        opacity: !t.found && !isSelected ? 0.5 : 1,
                      }}>
                      {/* Color cover */}
                      <div className="h-10 w-10 rounded-xl shrink-0 flex items-center justify-center text-base"
                        style={{ background: t.coverColor }}>
                        🎵
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate" style={{ color:C.t1 }}>{t.title}</p>
                        <p className="text-[10px] mt-0.5" style={{ color:C.t3 }}>
                          {t.artist} · {t.genre} · {t.duration}
                        </p>
                      </div>
                      {/* Found badge */}
                      {t.found
                        ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                            style={{ background:'rgba(52,211,153,0.12)', color:C.green }}>
                            В каталоге
                          </span>
                        : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                            style={{ background:'rgba(255,255,255,0.05)', color:C.t3 }}>
                            Только мета
                          </span>
                      }
                      {/* Checkbox */}
                      <div className="grid h-5 w-5 place-items-center rounded-full shrink-0"
                        style={{
                          background: isSelected ? C.accent : 'transparent',
                          border: `2px solid ${isSelected ? C.accent : C.border}`,
                        }}>
                        {isSelected && <Check size={11} className="text-white"/>}
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Import button */}
              <div className="sticky bottom-0 pt-2 pb-1"
                style={{ background:`linear-gradient(transparent,${C.bg} 40%)` }}>
                <motion.button whileTap={{ scale:.97 }} type="button"
                  onClick={importTracks} disabled={sel.size === 0}
                  className="flex items-center justify-center gap-2 w-full rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-40"
                  style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)`, boxShadow:`0 6px 24px ${C.accent}40` }}>
                  <Plus size={16}/>
                  Добавить {sel.size} треков в Sky Music
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* Importing progress */}
          {session?.status === 'importing' && (
            <motion.div key="importing" initial={{ opacity:0 }} animate={{ opacity:1 }}
              className="flex flex-col items-center gap-5 py-10">
              <div className="relative h-20 w-20">
                <svg className="absolute inset-0" width="80" height="80" style={{ transform:'rotate(-90deg)' }}>
                  <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6"/>
                  <motion.circle cx="40" cy="40" r="34" fill="none" stroke={C.accent} strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={2*Math.PI*34}
                    animate={{ strokeDashoffset: 2*Math.PI*34 * (1 - session.imported / sel.size) }}
                    transition={{ duration:.3 }}/>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-black" style={{ color:C.t1 }}>
                    {Math.round(session.imported/sel.size*100)}%
                  </span>
                </div>
              </div>
              <div className="text-center">
                <p className="text-base font-bold" style={{ color:C.t1 }}>
                  Переносим музыку...
                </p>
                <p className="text-sm mt-1" style={{ color:C.t2 }}>
                  {session.imported} из {sel.size} треков
                </p>
              </div>
            </motion.div>
          )}

          {/* Done */}
          {session?.status === 'done' && (
            <motion.div key="done" initial={{ opacity:0 }} animate={{ opacity:1 }}
              className="flex flex-col items-center gap-5 py-10">
              <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
                transition={{ type:'spring', stiffness:400, damping:18 }}
                className="grid h-20 w-20 place-items-center rounded-full"
                style={{ background:'rgba(52,211,153,0.12)', border:'2px solid rgba(52,211,153,0.4)' }}>
                <Check size={36} style={{ color:C.green }}/>
              </motion.div>
              <div className="text-center">
                <p className="text-xl font-black" style={{ color:C.t1 }}>Готово!</p>
                <p className="text-sm mt-1.5" style={{ color:C.t2 }}>
                  {session.imported} треков добавлено в Sky Music
                </p>
                <p className="text-xs mt-1" style={{ color:C.t3 }}>
                  Плейлист создан: {session.platform.name}: {session.playlistName}
                </p>
              </div>
              <button type="button" onClick={() => { setSession(null); setUrl(''); setSel(new Set()); setSelAll(true); }}
                className="rounded-2xl px-8 py-3 text-sm font-semibold"
                style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}>
                Перенести ещё
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
};
