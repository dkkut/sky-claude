/* ================================================================
   SKY STUDIO — единая панель автора
   Загрузка видео, кино, музыки и подкастов — каждое на свой настоящий
   сервер. Публикация и монетизация показаны для Sky Video: у кино,
   музыки и подкастов свои экраны с той же ролью (заявка → проверка),
   дублировать их здесь незачем — Studio отсюда только заводит контент.
================================================================ */
import { useState, useEffect } from 'react';
import { BulkUploadPanel } from './BulkUpload';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, Film, TrendingUp, DollarSign, BarChart3,
  Eye, Check, Trash2, Sparkles, Clock3, ThumbsUp,
  Video as VideoIcon, Music2, Mic2, Loader2, BookOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Transition } from 'framer-motion';
import { useSkyVideoStore, resetSkyVideoForUser } from '@/video/serverStore';
import { apiSkyVideoRevenue, fmtDuration, thumbnailUrl, type ServerVideo, type RevenueEntry } from '@/video/skyVideoApi';
import { useAuthStore } from '@/core/auth/store';
import { useFilmStore } from '@/film/serverStore';
import { readVideoMeta as readFilmVideoMeta } from '@/film/filmApi';
import { useMusicStore } from '@/music/serverStore';
import {
  apiMine as apiMyPodcasts, apiCreatePodcast, apiCreateEpisode, apiUploadMedia,
  apiPatchEpisode, apiSubmitPodcast, type Podcast,
} from '@/podcasts/podcastApi';
import {
  apiCreateBook, apiCreateChapter, apiUploadChapterAudio, apiUploadCover as apiUploadBookCover,
  apiSubmitBook, CATEGORIES as BOOK_CATEGORIES,
} from '@/books/booksApi';

/* ── Design tokens ─────────────────────────────────────────── */
const V = { bg:'var(--bg)', bg1:'var(--bg-l1)', bg2:'var(--bg-l2)', bg3:'var(--bg-l3)',
  border:'var(--border)', bm:'var(--border-m)', accent:'var(--accent)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)', green:'var(--green)', red:'var(--red)', amber:'var(--amber)' };

const fadeUp = (i=0) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: .2, delay: i * .05, ease: [.22, 1, .36, 1] } as Transition,
});
const fmtMoney = (kopecks:number) => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(kopecks/100);
const fmtAgo = (iso:string) => { const d=Math.floor((Date.now()-new Date(iso).getTime())/86400000); if(d===0)return'Сегодня';if(d===1)return'Вчера';return`${d} дн. назад`; };
const fmtViews = (n:number) => n>=1000 ? `${(n/1000).toFixed(1)}К` : String(n);

/* ── KPI card ───────────────────────────────────────────────── */
const KPICard = ({ icon:Icon, label, value, color }:{ icon:LucideIcon; label:string; value:string; color:string }) => (
  <div className="rounded-2xl p-4" style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
    <div className="grid h-8 w-8 place-items-center rounded-xl mb-2" style={{ background:`${color}18` }}>
      <Icon size={14} style={{ color }}/>
    </div>
    <p className="text-xl font-black" style={{ color:V.t1 }}>{value}</p>
    <p className="text-[11px] mt-0.5" style={{ color:V.t3 }}>{label}</p>
  </div>
);

/* ── Загрузка видео: тот же поток, что во вкладке «Загрузить» Sky Video ── */
const VideoUploadForm = ({ onDone }:{ onDone:()=>void }) => {
  const { upload, setThumbnail, publish } = useSkyVideoStore();
  const categories = useSkyVideoStore(s => s.categories);

  const [file,    setFile]    = useState<File|null>(null);
  const [cover,   setCover]   = useState<File|null>(null);
  const [coverPreview, setCoverPreview] = useState<string|undefined>();
  const [title,   setTitle]   = useState('');
  const [desc,    setDesc]    = useState('');
  const [cat,     setCat]     = useState('Другое');
  const [tags,    setTags]    = useState('');
  const [publishNow, setPublishNow] = useState(true);
  const [loading, setLoad]    = useState(false);
  const [prog,    setProg]    = useState(0);
  const [error,   setError]   = useState<string|null>(null);

  const handleFile = (f:File) => { setFile(f); setError(null); if(!title) setTitle(f.name.replace(/\.[^.]+$/,'')); };

  const submit = async () => {
    if(!file||!title.trim()) return;
    setLoad(true); setProg(0); setError(null);
    const { readVideoMeta } = await import('@/video/skyVideoApi');
    const meta = await readVideoMeta(file);
    const { promise } = upload(file, {
      title: title.trim(), description: desc.trim(), category: cat, tags,
      duration: meta.duration, width: meta.width, height: meta.height,
    }, setProg);
    const res = await promise;
    if (!res.ok || !res.id) { setLoad(false); setError(res.reason ?? 'Не получилось'); return; }
    if (cover) await setThumbnail(res.id, cover);
    if (publishNow) await publish(res.id, true);
    setLoad(false);
    onDone();
  };

  const iS = { background:V.bg2, border:`1px solid ${V.border}`, color:V.t1 };
  const iC = 'w-full rounded-2xl px-4 py-2.5 text-sm outline-none';

  return (
    <div className="space-y-4 px-4 py-4 overflow-y-auto h-full" style={{ scrollbarWidth:'none' }}>
      {error && (
        <div className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background:'rgba(248,113,113,0.1)', color:V.red }}>{error}</div>
      )}

      <div className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 py-10 cursor-pointer transition-all"
        style={{ borderColor:file?V.accent:V.bm, background:file?`${V.accent}05`:'transparent' }}
        onClick={()=>document.getElementById('studio-video-input')?.click()}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f);}}>
        <input id="studio-video-input" type="file" accept="video/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);}}/>
        <div className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background:file?`${V.accent}18`:V.bg3 }}>
          {file?<Check size={24} style={{ color:V.accent }}/>:<Upload size={24} style={{ color:V.t3 }}/>}
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color:file?V.accent:V.t2 }}>{file?file.name:'Нажмите или перетащите файл'}</p>
          {!file&&<p className="text-xs mt-1" style={{ color:V.t3 }}>MP4 · WebM · AVI · OGV</p>}
        </div>
      </div>

      {file&&<motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-3">
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название *" className={iC} style={iS}/>
        <textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Описание" rows={3} className={`${iC} resize-none`} style={iS}/>
        <select value={cat} onChange={e=>setCat(e.target.value)} className={iC} style={{ ...iS, cursor:'pointer' }}>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={tags} onChange={e=>setTags(e.target.value)} placeholder="Теги: sky, обзор, 2026..." className={iC} style={iS}/>

        <div className="flex items-center gap-3">
          <input id="studio-cover-input" type="file" accept="image/*" className="hidden"
            onChange={e=>{ const f=e.target.files?.[0]; if(f){ setCover(f); setCoverPreview(URL.createObjectURL(f)); } }}/>
          <button type="button" onClick={()=>document.getElementById('studio-cover-input')?.click()}
            className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold transition-colors"
            style={{ background:V.bg2, border:`1px solid ${V.border}`, color:V.t2 }}>
            {cover ? <><Check size={15} style={{ color:'var(--green)' }}/> Обложка</> : 'Добавить обложку'}
          </button>
          {coverPreview&&<img src={coverPreview} alt="" className="h-10 w-10 rounded-xl object-cover"/>}
        </div>

        <div className="flex gap-2">
          {([[true,'Опубликовать'],[false,'Черновик']] as const).map(([v,l])=>(
            <button key={String(v)} type="button" onClick={()=>setPublishNow(v)}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold"
              style={{ background:publishNow===v?`${V.accent}15`:V.bg2, border:`1px solid ${publishNow===v?V.accent+'35':V.border}`, color:publishNow===v?V.accent:V.t2 }}>
              {l}
            </button>
          ))}
        </div>

        {loading&&(
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs" style={{ color:V.t3 }}>
              <span>Загрузка...</span><span>{prog}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background:V.bg3 }}>
              <motion.div className="h-full rounded-full" style={{ width:`${prog}%`, background:`linear-gradient(90deg,${V.accent},#818cf8)` }} transition={{ duration:.3 }}/>
            </div>
          </div>
        )}

        <motion.button whileTap={{scale:.97}} type="button" onClick={submit}
          disabled={loading||!title.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black disabled:opacity-40"
          style={{ background:V.accent, color:'#fff', boxShadow:`0 4px 16px ${V.accent}40` }}>
          <Upload size={15}/>{loading?`${prog}%…`:publishNow?'Опубликовать видео':'Сохранить черновик'}
        </motion.button>
      </motion.div>}
    </div>
  );
};

/* ── Загрузка кино: та же форма, что в разделе «Личная коллекция» Sky Film ── */
const FilmUploadForm = ({ onDone }:{ onDone:()=>void }) => {
  const { upload, setPoster, categories, load: loadCategories } = useFilmStore();

  const [file, setFile] = useState<File|null>(null);
  const [poster, setPoster_] = useState<File|null>(null);
  const [posterPreview, setPosterPreview] = useState<string|undefined>();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState('');
  const [genre, setGenre] = useState('');
  const [year, setYear] = useState('');
  const [director, setDirector] = useState('');
  const [loading, setLoad] = useState(false);
  const [prog, setProg] = useState(0);
  const [error, setError] = useState<string|null>(null);

  useEffect(() => { void loadCategories(); }, []);
  useEffect(() => { if (!cat && categories.length) setCat(categories[0].name); }, [categories]);

  const handleFile = (f:File) => { setFile(f); setError(null); if(!title) setTitle(f.name.replace(/\.[^.]+$/,'')); };

  const submit = async () => {
    if (!file || !title.trim()) return;
    setLoad(true); setProg(0); setError(null);
    const meta = await readFilmVideoMeta(file);
    const { promise } = upload(file, {
      title: title.trim(), description: desc.trim(), category: cat || undefined,
      genre: genre.trim() || undefined, year: year ? Number(year) : undefined,
      director: director.trim() || undefined,
      duration: meta.duration, width: meta.width, height: meta.height,
    }, setProg);
    const res = await promise;
    if (!res.ok || !res.id) { setLoad(false); setError(res.reason ?? 'Не получилось'); return; }
    if (poster) await setPoster(res.id, poster);
    setLoad(false);
    onDone();
  };

  const iS = { background:V.bg2, border:`1px solid ${V.border}`, color:V.t1 };
  const iC = 'w-full rounded-2xl px-4 py-2.5 text-sm outline-none';

  return (
    <div className="space-y-4 px-4 py-4 overflow-y-auto h-full" style={{ scrollbarWidth:'none' }}>
      {error && <div className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background:'rgba(248,113,113,0.1)', color:V.red }}>{error}</div>}
      <p className="text-xs" style={{ color:V.t3 }}>
        Фильм ложится в личную коллекцию закрытым — опубликовать его в общем каталоге можно
        только после проверки модерацией, в разделе «Личная коллекция» Sky Film.
      </p>

      <div className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 py-10 cursor-pointer transition-all"
        style={{ borderColor:file?V.accent:V.bm, background:file?`${V.accent}05`:'transparent' }}
        onClick={()=>document.getElementById('studio-film-input')?.click()}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f);}}>
        <input id="studio-film-input" type="file" accept="video/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);}}/>
        <div className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background:file?`${V.accent}18`:V.bg3 }}>
          {file?<Check size={24} style={{ color:V.accent }}/>:<Upload size={24} style={{ color:V.t3 }}/>}
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color:file?V.accent:V.t2 }}>{file?file.name:'Нажмите или перетащите файл'}</p>
          {!file&&<p className="text-xs mt-1" style={{ color:V.t3 }}>MP4 · MOV · MKV · WebM · AVI</p>}
        </div>
      </div>

      {file&&<motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-3">
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название *" className={iC} style={iS}/>
        <textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Описание" rows={3} className={`${iC} resize-none`} style={iS}/>
        {categories.length > 0 && (
          <select value={cat} onChange={e=>setCat(e.target.value)} className={iC} style={{ ...iS, cursor:'pointer' }}>
            {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        )}
        <div className="flex gap-2">
          <input value={genre} onChange={e=>setGenre(e.target.value)} placeholder="Жанр" className={`flex-1 ${iC}`} style={iS}/>
          <input value={year} onChange={e=>setYear(e.target.value.replace(/\D/g,'').slice(0,4))} inputMode="numeric" placeholder="Год" className="w-24 rounded-2xl px-4 py-2.5 text-sm outline-none" style={iS}/>
        </div>
        <input value={director} onChange={e=>setDirector(e.target.value)} placeholder="Режиссёр" className={iC} style={iS}/>

        <div className="flex items-center gap-3">
          <input id="studio-poster-input" type="file" accept="image/*" className="hidden"
            onChange={e=>{ const f=e.target.files?.[0]; if(f){ setPoster_(f); setPosterPreview(URL.createObjectURL(f)); } }}/>
          <button type="button" onClick={()=>document.getElementById('studio-poster-input')?.click()}
            className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold transition-colors"
            style={{ background:V.bg2, border:`1px solid ${V.border}`, color:V.t2 }}>
            {poster ? <><Check size={15} style={{ color:'var(--green)' }}/> Постер</> : 'Добавить постер'}
          </button>
          {posterPreview&&<img src={posterPreview} alt="" className="h-10 w-10 rounded-xl object-cover"/>}
        </div>

        {loading&&(
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs" style={{ color:V.t3 }}><span>Загрузка...</span><span>{prog}%</span></div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background:V.bg3 }}>
              <motion.div className="h-full rounded-full" style={{ width:`${prog}%`, background:`linear-gradient(90deg,${V.accent},#818cf8)` }} transition={{ duration:.3 }}/>
            </div>
          </div>
        )}

        <motion.button whileTap={{scale:.97}} type="button" onClick={submit}
          disabled={loading||!title.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black disabled:opacity-40"
          style={{ background:V.accent, color:'#fff', boxShadow:`0 4px 16px ${V.accent}40` }}>
          <Upload size={15}/>{loading?`${prog}%…`:'Добавить в личную коллекцию'}
        </motion.button>
      </motion.div>}
    </div>
  );
};

/* ── Загрузка музыки: тот же поток, что в загрузке Sky Music ──────── */
const MusicUploadForm = ({ onDone }:{ onDone:()=>void }) => {
  const upload = useMusicStore(s => s.upload);

  const [file, setFile] = useState<File|null>(null);
  const [cover, setCover] = useState<File|null>(null);
  const [coverPreview, setCoverPreview] = useState<string|undefined>();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [genre, setGenre] = useState('');
  const [loading, setLoad] = useState(false);
  const [error, setError] = useState<string|null>(null);

  const handleFile = (f:File) => { setFile(f); setError(null); if(!title) setTitle(f.name.replace(/\.[^.]+$/,'')); };

  const readAudioDuration = (f: Blob) => new Promise<number>((resolve) => {
    const url = URL.createObjectURL(f);
    const a = new Audio();
    const done = (d: number) => { URL.revokeObjectURL(url); resolve(d); };
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    a.src = url;
  });

  const submit = async () => {
    if (!file || !title.trim() || !artist.trim()) return;
    setLoad(true); setError(null);
    const duration = await readAudioDuration(file);
    const res = await upload(file, {
      title: title.trim(), artist: artist.trim(), album: album.trim() || undefined,
      genre: genre.trim() || undefined, duration,
    });
    if (!res.ok || !res.id) { setLoad(false); setError(res.reason ?? 'Не получилось'); return; }
    const { apiUploadCover } = await import('@/music/musicApi');
    if (cover) await apiUploadCover(res.id, cover);
    setLoad(false);
    onDone();
  };

  const iS = { background:V.bg2, border:`1px solid ${V.border}`, color:V.t1 };
  const iC = 'w-full rounded-2xl px-4 py-2.5 text-sm outline-none';

  return (
    <div className="space-y-4 px-4 py-4 overflow-y-auto h-full" style={{ scrollbarWidth:'none' }}>
      {error && <div className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background:'rgba(248,113,113,0.1)', color:V.red }}>{error}</div>}

      <div className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 py-10 cursor-pointer transition-all"
        style={{ borderColor:file?V.accent:V.bm, background:file?`${V.accent}05`:'transparent' }}
        onClick={()=>document.getElementById('studio-music-input')?.click()}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f);}}>
        <input id="studio-music-input" type="file" accept="audio/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);}}/>
        <div className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background:file?`${V.accent}18`:V.bg3 }}>
          {file?<Check size={24} style={{ color:V.accent }}/>:<Upload size={24} style={{ color:V.t3 }}/>}
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color:file?V.accent:V.t2 }}>{file?file.name:'Нажмите или перетащите файл'}</p>
          {!file&&<p className="text-xs mt-1" style={{ color:V.t3 }}>MP3 · OGG · FLAC · WAV · M4A</p>}
        </div>
      </div>

      {file&&<motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-3">
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название *" className={iC} style={iS}/>
        <input value={artist} onChange={e=>setArtist(e.target.value)} placeholder="Исполнитель *" className={iC} style={iS}/>
        <div className="flex gap-2">
          <input value={album} onChange={e=>setAlbum(e.target.value)} placeholder="Альбом" className={`flex-1 ${iC}`} style={iS}/>
          <input value={genre} onChange={e=>setGenre(e.target.value)} placeholder="Жанр" className={`flex-1 ${iC}`} style={iS}/>
        </div>

        <div className="flex items-center gap-3">
          <input id="studio-trackcover-input" type="file" accept="image/*" className="hidden"
            onChange={e=>{ const f=e.target.files?.[0]; if(f){ setCover(f); setCoverPreview(URL.createObjectURL(f)); } }}/>
          <button type="button" onClick={()=>document.getElementById('studio-trackcover-input')?.click()}
            className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold transition-colors"
            style={{ background:V.bg2, border:`1px solid ${V.border}`, color:V.t2 }}>
            {cover ? <><Check size={15} style={{ color:'var(--green)' }}/> Обложка</> : 'Добавить обложку'}
          </button>
          {coverPreview&&<img src={coverPreview} alt="" className="h-10 w-10 rounded-xl object-cover"/>}
        </div>

        {loading && <div className="flex items-center gap-2 text-xs" style={{ color:V.t3 }}><Loader2 size={13} className="animate-spin"/>Загрузка...</div>}

        <motion.button whileTap={{scale:.97}} type="button" onClick={submit}
          disabled={loading||!title.trim()||!artist.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black disabled:opacity-40"
          style={{ background:V.accent, color:'#fff', boxShadow:`0 4px 16px ${V.accent}40` }}>
          <Upload size={15}/>{loading?'Загрузка…':'Загрузить трек'}
        </motion.button>
      </motion.div>}
    </div>
  );
};

/* ── Загрузка подкаста: своя передача → выпуск → медиафайл ─────────── */
const PodcastUploadForm = ({ onDone }:{ onDone:()=>void }) => {
  const [shows, setShows] = useState<Podcast[]>([]);
  const [showId, setShowId] = useState<string>('');
  const [newShowTitle, setNewShowTitle] = useState('');
  const [loadingShows, setLoadingShows] = useState(true);

  const [file, setFile] = useState<File|null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [publishNow, setPublishNow] = useState(true);
  const [loading, setLoad] = useState(false);
  const [prog, setProg] = useState(0);
  const [error, setError] = useState<string|null>(null);
  const [note, setNote] = useState<string|null>(null);

  useEffect(() => {
    let live = true;
    apiMyPodcasts().then(list => {
      if (!live) return;
      setLoadingShows(false);
      if (list) { setShows(list); if (list.length) setShowId(list[0].id); }
    });
    return () => { live = false; };
  }, []);

  const handleFile = (f:File) => { setFile(f); setError(null); if(!title) setTitle(f.name.replace(/\.[^.]+$/,'')); };

  const submit = async () => {
    if (!file || !title.trim()) return;
    setLoad(true); setProg(0); setError(null); setNote(null);

    let podcastId = showId;
    if (!podcastId) {
      if (!newShowTitle.trim()) { setLoad(false); setError('Укажите название передачи'); return; }
      const created = await apiCreatePodcast({ title: newShowTitle.trim() });
      if (!created) { setLoad(false); setError('Не получилось завести передачу'); return; }
      podcastId = created.id;
      setShows(s => [created, ...s]);
      setShowId(created.id);
    }

    const episode = await apiCreateEpisode(podcastId, { title: title.trim(), description: desc.trim() });
    if (!episode) { setLoad(false); setError('Не получилось создать выпуск'); return; }

    const kind = file.type.startsWith('video/') ? 'video' : 'audio';
    const { promise } = apiUploadMedia(episode.id, kind, file, {}, setProg);
    const res = await promise;
    if (!res.ok) { setLoad(false); setError(res.reason ?? 'Не получилось'); return; }

    // setNote запланирует перерисовку, но в этой же функции переменная
    // note снаружи останется прежней (замыкание на момент вызова) —
    // поэтому решение «ждать ли перед onDone» берём из локальной
    // переменной, а не из note: иначе таймер всегда получал бы 0 и
    // сообщение исчезало бы раньше, чем человек успел бы его прочитать.
    let noteMsg: string | null = null;
    if (publishNow) {
      await apiPatchEpisode(episode.id, { published: true });
      const show = shows.find(s => s.id === podcastId);
      if (show && show.status !== 'published') {
        const submitted = await apiSubmitPodcast(podcastId);
        noteMsg = submitted.ok
          ? 'Выпуск загружен, передача отправлена на проверку модерацией.'
          : `Выпуск загружен, но передачу отправить на проверку не удалось: ${submitted.reason}`;
        setNote(noteMsg);
      }
    }

    setLoad(false);
    if (!publishNow) onDone(); else setTimeout(onDone, noteMsg ? 1800 : 0);
  };

  const iS = { background:V.bg2, border:`1px solid ${V.border}`, color:V.t1 };
  const iC = 'w-full rounded-2xl px-4 py-2.5 text-sm outline-none';

  if (loadingShows) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color:V.t3 }}/></div>;

  return (
    <div className="space-y-4 px-4 py-4 overflow-y-auto h-full" style={{ scrollbarWidth:'none' }}>
      {error && <div className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background:'rgba(248,113,113,0.1)', color:V.red }}>{error}</div>}
      {note && <div className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background:'rgba(52,211,153,0.1)', color:V.green }}>{note}</div>}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color:V.t3 }}>Передача</p>
        {shows.length > 0 ? (
          <select value={showId} onChange={e=>setShowId(e.target.value)} className={iC} style={{ ...iS, cursor:'pointer' }}>
            {shows.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            <option value="">+ Новая передача</option>
          </select>
        ) : (
          <p className="text-xs mb-2" style={{ color:V.t3 }}>У вас пока нет передачи — заведём её вместе с первым выпуском.</p>
        )}
        {!showId && (
          <input value={newShowTitle} onChange={e=>setNewShowTitle(e.target.value)} placeholder="Название передачи *"
            className={`${iC} mt-2`} style={iS}/>
        )}
      </div>

      <div className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 py-10 cursor-pointer transition-all"
        style={{ borderColor:file?V.accent:V.bm, background:file?`${V.accent}05`:'transparent' }}
        onClick={()=>document.getElementById('studio-podcast-input')?.click()}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f);}}>
        <input id="studio-podcast-input" type="file" accept="audio/*,video/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);}}/>
        <div className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background:file?`${V.accent}18`:V.bg3 }}>
          {file?<Check size={24} style={{ color:V.accent }}/>:<Upload size={24} style={{ color:V.t3 }}/>}
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color:file?V.accent:V.t2 }}>{file?file.name:'Нажмите или перетащите файл'}</p>
          {!file&&<p className="text-xs mt-1" style={{ color:V.t3 }}>Аудио или видео-выпуск</p>}
        </div>
      </div>

      {file&&<motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-3">
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название выпуска *" className={iC} style={iS}/>
        <textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Описание" rows={3} className={`${iC} resize-none`} style={iS}/>

        <div className="flex gap-2">
          {([[true,'Опубликовать'],[false,'Черновик']] as const).map(([v,l])=>(
            <button key={String(v)} type="button" onClick={()=>setPublishNow(v)}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold"
              style={{ background:publishNow===v?`${V.accent}15`:V.bg2, border:`1px solid ${publishNow===v?V.accent+'35':V.border}`, color:publishNow===v?V.accent:V.t2 }}>
              {l}
            </button>
          ))}
        </div>

        {loading&&(
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs" style={{ color:V.t3 }}><span>Загрузка...</span><span>{prog}%</span></div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background:V.bg3 }}>
              <motion.div className="h-full rounded-full" style={{ width:`${prog}%`, background:`linear-gradient(90deg,${V.accent},#818cf8)` }} transition={{ duration:.3 }}/>
            </div>
          </div>
        )}

        <motion.button whileTap={{scale:.97}} type="button" onClick={submit}
          disabled={loading||!title.trim()||(!showId && !newShowTitle.trim())}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black disabled:opacity-40"
          style={{ background:V.accent, color:'#fff', boxShadow:`0 4px 16px ${V.accent}40` }}>
          <Upload size={15}/>{loading?`${prog}%…`:publishNow?'Опубликовать выпуск':'Сохранить черновик'}
        </motion.button>
      </motion.div>}
    </div>
  );
};

/* ── Загрузка книги: книга → первая глава (текст и/или озвучка) ────── */
const BookUploadForm = ({ onDone }:{ onDone:()=>void }) => {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState(BOOK_CATEGORIES[1] ?? 'Другое');
  const [genre, setGenre] = useState('');
  const [content, setContent] = useState('');
  const [audio, setAudio] = useState<File|null>(null);
  const [cover, setCover] = useState<File|null>(null);
  const [coverPreview, setCoverPreview] = useState<string|undefined>();
  const [publishNow, setPublishNow] = useState(true);
  const [loading, setLoad] = useState(false);
  const [prog, setProg] = useState(0);
  const [error, setError] = useState<string|null>(null);
  const [note, setNote] = useState<string|null>(null);

  const readAudioDuration = (f: Blob) => new Promise<number>((resolve) => {
    const url = URL.createObjectURL(f);
    const a = new Audio();
    const done = (d: number) => { URL.revokeObjectURL(url); resolve(d); };
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    a.src = url;
  });

  const submit = async () => {
    if (!title.trim()) return;
    if (!content.trim() && !audio) { setError('Добавьте текст главы или её озвучку — без этого читать или слушать нечего'); return; }
    setLoad(true); setProg(0); setError(null); setNote(null);

    const book = await apiCreateBook({ title: title.trim(), description: desc.trim(), category, genre: genre.trim() || undefined });
    if (!book) { setLoad(false); setError('Не получилось завести книгу'); return; }

    const chapter = await apiCreateChapter(book.id, { title: 'Глава 1', content: content.trim() || undefined });
    if (!chapter) { setLoad(false); setError('Не получилось создать главу'); return; }

    if (audio) {
      const duration = await readAudioDuration(audio);
      const { promise } = apiUploadChapterAudio(chapter.id, audio, duration, setProg);
      const res = await promise;
      if (!res.ok) { setLoad(false); setError(res.reason ?? 'Не получилось загрузить озвучку'); return; }
    }
    if (cover) await apiUploadBookCover(book.id, cover);

    // Как и в форме подкаста: note снаружи в этой функции ещё не
    // обновится (замыкание на момент вызова setNote), поэтому решение
    // о задержке берём из локальной переменной — иначе onDone сработал
    // бы сразу же, и сообщение о проверке никто бы не успел увидеть.
    let noteMsg: string | null = null;
    if (publishNow) {
      const submitted = await apiSubmitBook(book.id);
      noteMsg = submitted.ok
        ? 'Книга отправлена на проверку модерацией.'
        : `Книга сохранена, но отправить на проверку не удалось: ${submitted.reason}`;
      setNote(noteMsg);
    }

    setLoad(false);
    if (!publishNow) onDone(); else setTimeout(onDone, noteMsg ? 1800 : 0);
  };

  const iS = { background:V.bg2, border:`1px solid ${V.border}`, color:V.t1 };
  const iC = 'w-full rounded-2xl px-4 py-2.5 text-sm outline-none';

  return (
    <div className="space-y-4 px-4 py-4 overflow-y-auto h-full" style={{ scrollbarWidth:'none' }}>
      {error && <div className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background:'rgba(248,113,113,0.1)', color:V.red }}>{error}</div>}
      {note && <div className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background:'rgba(52,211,153,0.1)', color:V.green }}>{note}</div>}
      <p className="text-xs" style={{ color:V.t3 }}>
        Первая глава заводится вместе с книгой — остальные и обложку можно добавить позже, в кабинете книги.
      </p>

      <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название книги *" className={iC} style={iS}/>
      <textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Описание" rows={2} className={`${iC} resize-none`} style={iS}/>
      <div className="flex gap-2">
        <select value={category} onChange={e=>setCategory(e.target.value)} className={`flex-1 ${iC}`} style={{ ...iS, cursor:'pointer' }}>
          {BOOK_CATEGORIES.filter(c=>c!=='Все').map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={genre} onChange={e=>setGenre(e.target.value)} placeholder="Жанр" className={`flex-1 ${iC}`} style={iS}/>
      </div>

      <textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="Текст первой главы"
        rows={6} className={`${iC} resize-none`} style={iS}/>

      <div className="flex items-center gap-3">
        <input id="studio-book-audio-input" type="file" accept="audio/*,video/*" className="hidden"
          onChange={e=>{ const f=e.target.files?.[0]; if(f) setAudio(f); }}/>
        <button type="button" onClick={()=>document.getElementById('studio-book-audio-input')?.click()}
          className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold transition-colors"
          style={{ background:V.bg2, border:`1px solid ${V.border}`, color:V.t2 }}>
          {audio ? <><Check size={15} style={{ color:'var(--green)' }}/> {audio.name}</> : 'Добавить озвучку главы (аудио или видео)'}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input id="studio-book-cover-input" type="file" accept="image/*" className="hidden"
          onChange={e=>{ const f=e.target.files?.[0]; if(f){ setCover(f); setCoverPreview(URL.createObjectURL(f)); } }}/>
        <button type="button" onClick={()=>document.getElementById('studio-book-cover-input')?.click()}
          className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold transition-colors"
          style={{ background:V.bg2, border:`1px solid ${V.border}`, color:V.t2 }}>
          {cover ? <><Check size={15} style={{ color:'var(--green)' }}/> Обложка</> : 'Добавить обложку'}
        </button>
        {coverPreview&&<img src={coverPreview} alt="" className="h-10 w-10 rounded-xl object-cover"/>}
      </div>

      <div className="flex gap-2">
        {([[true,'Отправить на проверку'],[false,'Сохранить черновиком']] as const).map(([v,l])=>(
          <button key={String(v)} type="button" onClick={()=>setPublishNow(v)}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold"
            style={{ background:publishNow===v?`${V.accent}15`:V.bg2, border:`1px solid ${publishNow===v?V.accent+'35':V.border}`, color:publishNow===v?V.accent:V.t2 }}>
            {l}
          </button>
        ))}
      </div>

      {loading&&(
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs" style={{ color:V.t3 }}><span>Загрузка...</span><span>{prog}%</span></div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background:V.bg3 }}>
            <motion.div className="h-full rounded-full" style={{ width:`${prog}%`, background:`linear-gradient(90deg,${V.accent},#818cf8)` }} transition={{ duration:.3 }}/>
          </div>
        </div>
      )}

      <motion.button whileTap={{scale:.97}} type="button" onClick={submit}
        disabled={loading||!title.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black disabled:opacity-40"
        style={{ background:V.accent, color:'#fff', boxShadow:`0 4px 16px ${V.accent}40` }}>
        <Upload size={15}/>{loading?'Загрузка…':'Создать книгу'}
      </motion.button>
    </div>
  );
};

/* ── Выбор типа контента для загрузки ───────────────────────────── */
type UploadKind = 'video' | 'film' | 'music' | 'podcast' | 'book';
const UPLOAD_KIND_LABEL: Record<UploadKind, string> = {
  video: 'Sky Video', film: 'Кино', music: 'Музыка', podcast: 'Подкаст', book: 'Книга',
};
const UPLOAD_KIND_ICON: Record<UploadKind, LucideIcon> = {
  video: VideoIcon, film: Film, music: Music2, podcast: Mic2, book: BookOpen,
};

const UploadTab = ({ onDone }: { onDone: (kind: UploadKind) => void }) => {
  const [kind, setKind] = useState<UploadKind>('video');
  const [bulk, setBulk] = useState(false);
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 grid grid-cols-5 gap-1.5 px-4 pt-3 pb-2">
        {(['video','film','music','podcast','book'] as UploadKind[]).map(k => {
          const Icon = UPLOAD_KIND_ICON[k];
          return (
            <button key={k} type="button" onClick={()=>setKind(k)}
              className="flex flex-col items-center gap-1.5 rounded-2xl py-2.5 text-[10px] font-semibold transition-colors"
              style={{ background:kind===k?`${V.accent}18`:V.bg2, border:`1px solid ${kind===k?V.accent+'40':V.border}`, color:kind===k?V.accent:V.t2 }}>
              <Icon size={15}/>{UPLOAD_KIND_LABEL[k]}
            </button>
          );
        })}
      </div>
      <div className="shrink-0 flex gap-2 px-4 pb-2" role="radiogroup" aria-label="Способ загрузки">
        {([[false, 'Один файл'], [true, 'Несколько файлов']] as const).map(([b, l]) => (
          <button key={l} type="button" role="radio" aria-checked={bulk === b} onClick={() => setBulk(b)}
            className="flex-1 rounded-full py-2 text-xs font-bold"
            style={{ background: bulk === b ? V.accent : V.bg2, color: bulk === b ? '#fff' : V.t2, border: `1px solid ${bulk === b ? V.accent : V.border}` }}>{l}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {bulk && <BulkUploadPanel key={kind} kind={kind} V={V} onDone={()=>onDone(kind)}/>}
        {!bulk && kind === 'video' && <VideoUploadForm onDone={()=>onDone('video')}/>}
        {!bulk && kind === 'film' && <FilmUploadForm onDone={()=>onDone('film')}/>}
        {!bulk && kind === 'music' && <MusicUploadForm onDone={()=>onDone('music')}/>}
        {!bulk && kind === 'podcast' && <PodcastUploadForm onDone={()=>onDone('podcast')}/>}
        {!bulk && kind === 'book' && <BookUploadForm onDone={()=>onDone('book')}/>}
      </div>
    </div>
  );
};

/* ── Мой контент ────────────────────────────────────────────── */
const MyContent = ({ mine, onSelect }:{ mine:ServerVideo[]; onSelect:(v:ServerVideo)=>void }) => {
  const { publish, removeVideo } = useSkyVideoStore();

  if(!mine.length) return (
    <div className="flex flex-col items-center py-16 gap-3 opacity-50">
      <Film size={28} style={{ color:V.t3 }}/>
      <p className="text-sm" style={{ color:V.t2 }}>Нет загруженного контента</p>
    </div>
  );

  return (
    <div className="space-y-2">
      {mine.map((v,i)=>(
        <motion.div key={v.id} {...fadeUp(i)} className="flex items-center gap-3 rounded-2xl px-4 py-3 cursor-pointer"
          style={{ background:V.bg2, border:`1px solid ${V.border}` }} onClick={()=>onSelect(v)}>
          <div className="shrink-0 w-14 rounded-xl overflow-hidden" style={{ aspectRatio:'16/9', background:'#333' }}>
            {v.hasThumbnail && <img src={thumbnailUrl(v.id)} alt="" className="w-full h-full object-cover"/>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold truncate" style={{ color:V.t1 }}>{v.title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px]" style={{ color:V.t3 }}>{fmtViews(v.views)} просм.</span>
              <span className="text-[10px]" style={{ color:V.t3 }}>·</span>
              <span className="text-[10px]" style={{ color:V.t3 }}>{fmtDuration(v.duration)}</span>
              {v.monetizationStatus==='approved'&&<span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background:`${V.green}18`, color:V.green }}>Монетизация</span>}
              {v.monetizationStatus==='pending'&&<span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1"
                style={{ background:`${V.amber}18`, color:V.amber }}><Clock3 size={9}/>На проверке</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0" onClick={e=>e.stopPropagation()}>
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
              style={{ background:v.status==='published'?'rgba(52,211,153,.1)':'rgba(100,116,139,.1)',
                color:v.status==='published'?V.green:'#64748b' }}>
              {v.status==='published'?'Опубл.':v.status==='draft'?'Черн.':v.status==='hidden'?'Скрыто':'Снято'}
            </span>
            {v.status === 'draft' && (
              <button type="button" onClick={()=>publish(v.id, true)}
                className="rounded-lg px-2 py-1 text-[10px] font-bold text-white" style={{ background:V.accent }}>Опубл.</button>
            )}
            <button type="button" onClick={()=>removeVideo(v.id)}
              className="grid h-6 w-6 place-items-center rounded-lg" style={{ background:V.bg3 }}>
              <Trash2 size={11} style={{ color:V.red }}/>
            </button>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

/* ── Монетизация одного ролика ─────────────────────────────── */
const VideoMonetizationCard = ({ video, onBack }:{ video:ServerVideo; onBack:()=>void }) => {
  const { requestMonetization } = useSkyVideoStore();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string|null>(null);
  const [revenue, setRevenue] = useState<RevenueEntry[]>([]);

  useEffect(() => {
    let live = true;
    apiSkyVideoRevenue(video.id).then(r => { if (live && r) setRevenue(r); });
    return () => { live = false; };
  }, [video.id]);

  const total = revenue.reduce((s,r)=>s+r.amount,0);

  const request = async () => {
    setBusy(true);
    const res = await requestMonetization(video.id);
    setBusy(false);
    setMsg(res.ok ? 'Заявка отправлена на проверку' : (res.reason ?? 'Не получилось'));
  };

  return (
    <div className="space-y-4 px-4 py-4 overflow-y-auto h-full" style={{ scrollbarWidth:'none' }}>
      <button type="button" onClick={onBack} className="text-xs font-semibold" style={{ color:V.accent }}>← Ко всем роликам</button>
      <div className="rounded-2xl p-4" style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
        <p className="text-sm font-bold truncate" style={{ color:V.t1 }}>{video.title}</p>
        <p className="text-xs mt-1" style={{ color:V.t3 }}>{fmtViews(video.views)} просмотров · {video.likes} лайков</p>
      </div>

      <div className="rounded-2xl p-4" style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color:V.t3 }}>Статус монетизации</p>
        {video.monetizationStatus === 'none' && video.status === 'published' && (
          <button type="button" onClick={request} disabled={busy}
            className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background:V.amber }}>
            {busy ? 'Отправка...' : 'Подать заявку на монетизацию'}
          </button>
        )}
        {video.monetizationStatus === 'none' && video.status !== 'published' && (
          <p className="text-xs" style={{ color:V.t3 }}>Сначала опубликуйте ролик</p>
        )}
        {video.monetizationStatus === 'pending' && (
          <p className="text-xs flex items-center gap-1.5" style={{ color:V.t2 }}><Clock3 size={12}/>Заявка на проверке у модерации</p>
        )}
        {video.monetizationStatus === 'approved' && (
          <p className="text-xs font-semibold" style={{ color:V.green }}>Монетизация одобрена</p>
        )}
        {video.monetizationStatus === 'rejected' && (
          <p className="text-xs font-semibold" style={{ color:V.red }}>Заявка отклонена</p>
        )}
        {video.monetizationStatus === 'suspended' && (
          <p className="text-xs font-semibold" style={{ color:V.red }}>Монетизация приостановлена</p>
        )}
        {msg && <p className="text-[11px] mt-2" style={{ color:V.t3 }}>{msg}</p>}
      </div>

      {video.monetizationStatus === 'approved' && (
        <div className="rounded-2xl p-4" style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color:V.t3 }}>Начислено по ролику</p>
            <p className="text-sm font-black" style={{ color:V.green }}>{fmtMoney(total)}</p>
          </div>
          {revenue.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color:V.t3 }}>Начислений пока нет</p>
          ) : (
            <div className="space-y-2">
              {revenue.map(r => (
                <div key={r.id} className="flex items-center justify-between text-xs">
                  <span style={{ color:V.t2 }}>{r.source === 'ads' ? 'Реклама' : 'Корректировка'} · {fmtAgo(r.createdAt)}</span>
                  <span className="font-bold" style={{ color: r.amount >= 0 ? V.green : V.red }}>
                    {r.amount >= 0 ? '+' : ''}{fmtMoney(r.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════
   MAIN STUDIO
══════════════════════════════════════════════════════════════ */
type StudioTab = 'overview'|'upload'|'content'|'revenue';

export const BusinessStudio = () => {
  const { mine, load } = useSkyVideoStore();
  const { currentUserId } = useAuthStore();
  const [tab, setTab] = useState<StudioTab>('overview');
  const [selected, setSelected] = useState<ServerVideo|null>(null);
  const [revenueByVideo, setRevenueByVideo] = useState<Record<string, RevenueEntry[]>>({});

  useEffect(() => { load(); }, []);
  useEffect(() => () => { if (!currentUserId) resetSkyVideoForUser(); }, [currentUserId]);

  const monetized = mine.filter(v => v.monetizationStatus === 'approved');
  useEffect(() => {
    let live = true;
    Promise.all(monetized.map(v => apiSkyVideoRevenue(v.id).then(r => [v.id, r ?? []] as const)))
      .then(pairs => { if (live) setRevenueByVideo(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [monetized.map(v => v.id).join(',')]);

  const published = mine.filter(v => v.status === 'published');
  const totalViews = published.reduce((s,v)=>s+v.views,0);
  const totalLikes = published.reduce((s,v)=>s+v.likes,0);
  const allRevenue = Object.values(revenueByVideo).flat();
  const totalEarned = allRevenue.reduce((s,r)=>s+r.amount,0);

  const TABS: { key:StudioTab; label:string; icon:LucideIcon }[] = [
    { key:'overview', label:'Обзор',      icon:BarChart3 },
    { key:'upload',   label:'Загрузить',  icon:Upload },
    { key:'content',  label:'Контент',    icon:Film },
    { key:'revenue',  label:'Доходы',     icon:TrendingUp },
  ];

  if (selected) {
    return (
      <motion.div initial={{opacity:0}} animate={{opacity:1}} className="flex flex-col h-full overflow-hidden" style={{ background:V.bg }}>
        <VideoMonetizationCard video={selected} onBack={() => setSelected(null)} />
      </motion.div>
    );
  }

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{duration:.18}}
      className="flex flex-col h-full overflow-hidden" style={{ background:V.bg }}>

      <div className="shrink-0 px-5 pt-4 pb-0" style={{ borderBottom:`1px solid ${V.border}`, background:V.bg1 }}>
        <div className="flex items-center gap-3 mb-3">
          <motion.div initial={{scale:.7,opacity:0}} animate={{scale:1,opacity:1}} transition={{type:'spring',stiffness:400,damping:26}}
            className="grid h-8 w-8 place-items-center rounded-xl shrink-0"
            style={{ background:`linear-gradient(135deg,#f59e0b,#ef4444)`, boxShadow:'0 4px 14px rgba(245,158,11,.4)' }}>
            <Sparkles size={15} className="text-white"/>
          </motion.div>
          <div>
            <p className="text-[15px] font-bold" style={{ color:V.t1 }}>Sky Studio</p>
            <p className="text-[10px]" style={{ color:V.t3 }}>Видео · Кино · Музыка · Подкасты · Книги</p>
          </div>
        </div>

        <div className="flex overflow-x-auto" style={{ scrollbarWidth:'none' }}>
          {TABS.map(({key,label,icon:Icon})=>(
            <button key={key} type="button" onClick={()=>setTab(key)}
              className="relative shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 text-[11px] font-semibold transition-colors"
              style={{ color:tab===key?V.t1:V.t3 }}>
              <Icon size={11} style={{ color:tab===key?V.accent:V.t3 }}/>
              {label}
              {tab===key&&(
                <motion.div layoutId="studio-tab" className="absolute bottom-0 left-1.5 right-1.5 h-[2.5px] rounded-full"
                  style={{ background:V.accent }} transition={{ type:'spring',stiffness:500,damping:40 }}/>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}
            transition={{duration:.15}} className="h-full">

            {tab==='overview'&&(
              <div className="overflow-y-auto h-full px-5 py-4 space-y-4" style={{ scrollbarWidth:'none' }}>
                <div className="grid grid-cols-2 gap-2">
                  <KPICard icon={Film}       label="Опубликовано"    value={String(published.length)} color={V.accent}/>
                  <KPICard icon={Eye}        label="Всего просмотров" value={fmtViews(totalViews)}     color="#f59e0b"/>
                  <KPICard icon={ThumbsUp}   label="Всего лайков"    value={fmtViews(totalLikes)}      color="#ec4899"/>
                  <KPICard icon={DollarSign} label="Заработано"      value={fmtMoney(totalEarned)}     color={V.green}/>
                </div>
                {monetized.length === 0 && (
                  <div className="rounded-2xl p-4 flex items-center gap-3"
                    style={{ background:`${V.amber}0c`, border:`1px solid ${V.amber}30` }}>
                    <DollarSign size={18} style={{ color:V.amber }}/>
                    <p className="text-xs" style={{ color:V.t2 }}>
                      Монетизация ролика открывается по заявке — подайте её со страницы ролика после публикации.
                    </p>
                  </div>
                )}
              </div>
            )}

            {tab==='upload' && <UploadTab onDone={(kind)=>setTab(kind==='video'?'content':'overview')}/>}

            {tab==='content' && (
              <div className="overflow-y-auto h-full px-5 py-4" style={{ scrollbarWidth:'none' }}>
                <p className="text-sm font-bold mb-4" style={{ color:V.t1 }}>Мой контент</p>
                <MyContent mine={mine} onSelect={setSelected}/>
              </div>
            )}

            {tab==='revenue' && (
              <div className="overflow-y-auto h-full px-5 py-4 space-y-4" style={{ scrollbarWidth:'none' }}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold" style={{ color:V.t1 }}>Доходы по роликам</p>
                  <span className="text-[11px]" style={{ color:V.t3 }}>{fmtMoney(totalEarned)}</span>
                </div>
                {monetized.length === 0 ? (
                  <div className="flex flex-col items-center py-16 gap-3 opacity-50">
                    <DollarSign size={28} style={{ color:V.t3 }}/>
                    <p className="text-sm" style={{ color:V.t2 }}>Нет роликов с монетизацией</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {monetized.map((v,i) => {
                      const entries = revenueByVideo[v.id] ?? [];
                      const sum = entries.reduce((s,r)=>s+r.amount,0);
                      return (
                        <motion.button key={v.id} {...fadeUp(i)} type="button" onClick={()=>setSelected(v)}
                          className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left"
                          style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold truncate" style={{ color:V.t1 }}>{v.title}</p>
                            <p className="text-[10px] mt-0.5" style={{ color:V.t3 }}>{entries.length} начислений</p>
                          </div>
                          <p className="text-sm font-black shrink-0" style={{ color:V.green }}>{fmtMoney(sum)}</p>
                        </motion.button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
