/* ===============================================================
   ARTIST SUBMIT  -  подача песен артистом на модерацию
   + ADMIN MUSIC PANEL  -  расширенная карточка модерации
=============================================================== */
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music2, Upload, FileText, Shield, Check, X, ChevronLeft,
  Play, Pause, AlertCircle, CheckCircle, XCircle, Clock,
  BookOpen, Mic2, Star, Tag, Calendar,
} from 'lucide-react';
import { usePlatformStore } from '@/platform/store';
import { useMusicianStore } from './MusicianHub';
import { useAuthStore } from '@/core/auth/store';

const C = {
  bg:'#0a0a0f', l1:'#111118', l2:'var(--bg-l2)', l3:'#1e1e26',
  border:'var(--border)', b2:'var(--border-m)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)', amber:'var(--amber)', red:'var(--red)',
};

const COPYRIGHT_TYPES = [
  { key:'author',  label:'Я автор',           desc:'Написал(а) сам(а)',          icon:'✍️' },
  { key:'license', label:'Лицензия',          desc:'Creative Commons или другая', icon:'📜' },
  { key:'label',   label:'Лейбл/издатель',    desc:'Официальный договор с лейблом', icon:'🏢' },
  { key:'other',   label:'Другой документ',   desc:'Иное подтверждение прав',     icon:'📋' },
] as const;

const GENRES = ['Electronic','Hip-Hop','Pop','Rock','R&B','Jazz','Classical','Folk','Metal','Indie','Trap','House','Ambient','Other'];

/* === ARTIST SUBMIT FORM ==================================== */
export const ArtistSubmitTrack = ({ onDone }: { onDone: () => void }) => {
  const { currentUserId, accounts } = useAuthStore();
  const { addTrack } = usePlatformStore();
  const { getArtist } = useMusicianStore();

  const me     = accounts.find(a => a.id === currentUserId);
  const artist = getArtist(currentUserId ?? '');

  const [step,          setStep]          = useState<'meta'|'audio'|'copyright'|'review'>('meta');
  const [title,         setTitle]         = useState('');
  const [albumName,     setAlbumName]     = useState('');
  const [albumYear,     setAlbumYear]     = useState(new Date().getFullYear().toString());
  const [genre,         setGenre]         = useState('');
  const [lyrics,        setLyrics]        = useState('');
  const [coverUrl,      setCoverUrl]      = useState<string|undefined>();
  const [audioFile,     setAudioFile]     = useState<File|null>(null);
  const [audioUrl,      setAudioUrl]      = useState<string|undefined>();
  const [audioDur,      setAudioDur]      = useState('0:00');
  const [playing,       setPlaying]       = useState(false);
  const [copyrightType, setCopyrightType] = useState<'author'|'license'|'label'|'other'>('author');
  const [copyrightNote, setCopyrightNote] = useState('');
  const [docFile,       setDocFile]       = useState<File|null>(null);
  const [docName,       setDocName]       = useState('');
  const [err,           setErr]           = useState('');
  const [done,          setDone]          = useState(false);
  const [uploading,     setUploading]     = useState(false);

  const audioRef   = useRef<HTMLInputElement>(null);
  const coverRef   = useRef<HTMLInputElement>(null);
  const docRef     = useRef<HTMLInputElement>(null);
  const playerRef  = useRef<HTMLAudioElement>(null);

  const STEPS = ['meta','audio','copyright','review'];
  const stepIdx = STEPS.indexOf(step);

  const handleAudio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setAudioFile(f);
    const url = URL.createObjectURL(f);
    setAudioUrl(url);
    // Get duration
    const tmp = new Audio(url);
    tmp.onloadedmetadata = () => {
      const s = Math.floor(tmp.duration);
      setAudioDur(`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`);
    };
  };

  const handleCover = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setCoverUrl(r.result as string);
    r.readAsDataURL(f);
  };

  const handleDoc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setDocFile(f);
    setDocName(f.name);
  };

  const nextStep = () => {
    setErr('');
    if (step === 'meta') {
      if (!title.trim()) { setErr('Укажите название трека'); return; }
      if (!genre) { setErr('Выберите жанр'); return; }
    }
    if (step === 'audio') {
      if (!audioFile) { setErr('Загрузите аудиофайл'); return; }
    }
    if (step === 'copyright') {
      if (copyrightType !== 'author' && !docFile && !copyrightNote.trim()) {
        setErr('Приложите документ или опишите основание'); return;
      }
    }
    const idx = STEPS.indexOf(step);
    setStep(STEPS[idx+1] as any);
  };

  const submit = async () => {
    if (!audioFile || !currentUserId) return;
    setUploading(true);
    try {
      const audioDataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(audioFile);
      });

      addTrack({
        title:         title.trim(),
        artist:        artist?.artistName ?? me?.name ?? '',
        genre,
        lyrics:        lyrics.trim() || undefined,
        coverUrl,
        duration:      audioDur,
        premium:       false,
        sourceUrl:     audioUrl,
        fileName:      audioFile.name,
        mimeType:      audioFile.type,
        bytes:         audioFile.size,
        isLocal:       true,
        status:        'pending',
        uploadedBy:    currentUserId,
        uploaderName:  artist?.artistName ?? me?.name ?? '',
        albumName:     albumName.trim() || undefined,
        albumYear:     albumYear,
        copyrightType,
        copyrightNote: copyrightNote.trim() || undefined,
        copyrightDoc:  docFile ? docName : undefined,
        submittedAt:   new Date().toISOString(),
      }, audioDataUrl);
      setDone(true);
    } catch (e) {
      setErr('Ошибка загрузки. Попробуйте ещё раз.');
    }
    setUploading(false);
  };

  if (done) return (
    <div className="flex flex-col items-center gap-5 py-12 px-6">
      <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
        transition={{ type:'spring', stiffness:400, damping:18 }}
        className="grid h-20 w-20 place-items-center rounded-full text-4xl"
        style={{ background:`${C.green}15`, border:`2px solid ${C.green}40` }}>
        🎵
      </motion.div>
      <div className="text-center">
        <p className="text-xl font-black text-white">Трек отправлен!</p>
        <p className="text-sm mt-1.5" style={{ color:C.t2 }}>
          «{title}» передан на рассмотрение. Обычно 1-3 рабочих дня.
        </p>
      </div>
      <button type="button" onClick={onDone}
        className="rounded-2xl px-8 py-3 text-sm font-bold text-white"
        style={{ background:C.accent }}>Вернуться в профиль</button>
    </div>
  );

  const iSty = { background:C.l2, border:`1px solid ${C.border}`, color:C.t1 };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:C.bg }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b shrink-0"
        style={{ borderColor:C.border }}>
        <button type="button"
          onClick={() => step==='meta' ? onDone() : setStep(STEPS[stepIdx-1] as any)}
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={17} style={{ color:C.t2 }}/>
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold text-white">Подать трек на публикацию</p>
          <p className="text-[10px]" style={{ color:C.t3 }}>
            {['Информация','Аудио','Авторские права','Проверка'][stepIdx]}
          </p>
        </div>
        {/* Step dots */}
        <div className="flex gap-1.5">
          {STEPS.map((_,i) => (
            <div key={i} className="rounded-full transition-all"
              style={{ width:i===stepIdx?18:6, height:6,
                background:i<=stepIdx?C.accent:C.l3 }}/>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ scrollbarWidth:'none' }}>

        {/* -- STEP 1: Meta ---------------------------------- */}
        {step==='meta' && (
          <>
            {/* Cover + title */}
            <div className="flex gap-3 items-start">
              <div className="relative shrink-0">
                <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={handleCover}/>
                <div className="h-20 w-20 rounded-2xl overflow-hidden cursor-pointer flex items-center justify-center"
                  style={{ background:C.l2, border:`2px dashed ${coverUrl?C.accent:C.border}` }}
                  onClick={() => coverRef.current?.click()}>
                  {coverUrl
                    ? <img src={coverUrl} alt="" className="h-full w-full object-cover"/>
                    : <Music2 size={24} style={{ color:C.t3 }}/>
                  }
                </div>
                {coverUrl && (
                  <div className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full"
                    style={{ background:C.accent }}>
                    <Check size={10} className="text-white"/>
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <input value={title} onChange={e=>setTitle(e.target.value)}
                  placeholder="Название трека *"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none font-semibold" style={iSty}/>
                <input value={albumName} onChange={e=>setAlbumName(e.target.value)}
                  placeholder="Альбом (если есть)"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={iSty}/>
                <input value={albumYear} onChange={e=>setAlbumYear(e.target.value)}
                  placeholder="Год" maxLength={4}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={iSty}/>
              </div>
            </div>

            {/* Artist info */}
            <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
              style={{ background:`${C.accent}08`, border:`1px solid ${C.accent}20` }}>
              <Mic2 size={14} style={{ color:C.accent }}/>
              <div>
                <p className="text-xs font-bold" style={{ color:C.accent }}>
                  {artist?.artistName ?? me?.name}
                </p>
                <p className="text-[10px]" style={{ color:C.t3 }}>Ваш артист-профиль</p>
              </div>
            </div>

            {/* Genre */}
            <div>
              <p className="text-xs font-bold mb-2" style={{ color:C.t3 }}>Жанр *</p>
              <div className="flex flex-wrap gap-1.5">
                {GENRES.map(g => (
                  <button key={g} type="button" onClick={() => setGenre(g)}
                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all"
                    style={{ background:genre===g?`${C.accent}20`:'rgba(255,255,255,0.05)',
                      border:`1px solid ${genre===g?C.accent:'var(--border)'}`,
                      color:genre===g?C.accent:C.t3 }}>
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Lyrics */}
            <div>
              <p className="text-xs font-bold mb-1.5" style={{ color:C.t3 }}>Текст (необязательно)</p>
              <textarea value={lyrics} onChange={e=>setLyrics(e.target.value)} rows={6}
                placeholder="Текст песни..."
                className="w-full rounded-xl px-3 py-3 text-sm outline-none resize-none font-mono"
                style={iSty}/>
            </div>
          </>
        )}

        {/* -- STEP 2: Audio --------------------------------- */}
        {step==='audio' && (
          <>
            <input ref={audioRef} type="file" accept="audio/*" className="hidden" onChange={handleAudio}/>
            {/* Drop zone */}
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-3xl cursor-pointer transition-all py-12"
              style={{ background:audioFile?`${C.accent}08`:C.l1,
                border:`2px dashed ${audioFile?C.accent:C.border}` }}
              onClick={() => audioRef.current?.click()}>
              {audioFile ? (
                <>
                  <div className="grid h-16 w-16 place-items-center rounded-2xl text-3xl"
                    style={{ background:`${C.accent}15` }}>🎵</div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-white">{audioFile.name}</p>
                    <p className="text-xs mt-0.5" style={{ color:C.t3 }}>
                      {audioDur} · {(audioFile.size/1048576).toFixed(1)} МБ · {audioFile.type}
                    </p>
                  </div>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                    style={{ background:`${C.green}15`, color:C.green }}>✓ Загружено</span>
                </>
              ) : (
                <>
                  <div className="grid h-16 w-16 place-items-center rounded-2xl"
                    style={{ background:C.l2 }}>
                    <Upload size={28} style={{ color:C.t3 }}/>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-white">Нажмите для загрузки</p>
                    <p className="text-xs mt-1" style={{ color:C.t3 }}>MP3, WAV, FLAC, AAC</p>
                    <p className="text-[10px] mt-0.5" style={{ color:C.t3 }}>Максимум 100 МБ</p>
                  </div>
                </>
              )}
            </div>

            {/* Preview player */}
            {audioUrl && (
              <div className="rounded-2xl p-4" style={{ background:C.l1, border:`1px solid ${C.border}` }}>
                <p className="text-xs font-bold mb-3" style={{ color:C.t3 }}>Предпрослушивание</p>
                <audio ref={playerRef} src={audioUrl} onEnded={()=>setPlaying(false)}
                  className="hidden"/>
                <div className="flex items-center gap-3">
                  <button type="button"
                    onClick={() => {
                      if (playing) { playerRef.current?.pause(); setPlaying(false); }
                      else { playerRef.current?.play(); setPlaying(true); }
                    }}
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-full"
                    style={{ background:C.accent }}>
                    {playing ? <Pause size={20} className="text-white"/> : <Play size={20} className="text-white"/>}
                  </button>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white">{title || 'Без названия'}</p>
                    <p className="text-xs" style={{ color:C.t3 }}>{audioDur}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-xl px-4 py-3" style={{ background:`${C.amber}08`, border:`1px solid ${C.amber}15` }}>
              <p className="text-[11px] leading-relaxed" style={{ color:C.amber }}>
                ⚠️ Загружайте только аудиофайлы, на которые у вас есть авторские права. Нарушение авторских прав влечёт блокировку аккаунта.
              </p>
            </div>
          </>
        )}

        {/* -- STEP 3: Copyright ----------------------------- */}
        {step==='copyright' && (
          <>
            <div>
              <p className="text-sm font-bold text-white mb-1">Подтверждение прав</p>
              <p className="text-xs mb-4" style={{ color:C.t2 }}>
                Укажите основание, по которому вы вправе публиковать этот трек.
              </p>
            </div>

            {/* Copyright type */}
            <div className="space-y-2">
              {COPYRIGHT_TYPES.map(ct => (
                <button key={ct.key} type="button" onClick={() => setCopyrightType(ct.key)}
                  className="flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 text-left transition-all"
                  style={{ background:copyrightType===ct.key?`${C.accent}15`:C.l1,
                    border:`1.5px solid ${copyrightType===ct.key?C.accent:C.border}` }}>
                  <span className="text-2xl shrink-0">{ct.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold" style={{ color:C.t1 }}>{ct.label}</p>
                    <p className="text-[11px] mt-0.5" style={{ color:C.t3 }}>{ct.desc}</p>
                  </div>
                  {copyrightType===ct.key && <Check size={16} style={{ color:C.accent }}/>}
                </button>
              ))}
            </div>

            {/* Document upload */}
            {copyrightType !== 'author' && (
              <div>
                <input ref={docRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden"
                  onChange={handleDoc}/>
                <p className="text-xs font-bold mb-2" style={{ color:C.t3 }}>
                  Прикрепите документ (PDF, JPG, PNG, DOC)
                </p>
                <div className="flex items-center gap-3 rounded-xl px-4 py-3 cursor-pointer"
                  style={{ background:C.l2, border:`1px solid ${docFile?C.accent:C.border}` }}
                  onClick={() => docRef.current?.click()}>
                  <FileText size={18} style={{ color:docFile?C.accent:C.t3 }}/>
                  <p className="text-sm flex-1" style={{ color:docFile?C.t1:C.t3 }}>
                    {docFile ? docName : 'Нажмите для загрузки'}
                  </p>
                  {docFile && <Check size={14} style={{ color:C.green }}/>}
                </div>
              </div>
            )}

            {/* Note */}
            <div>
              <p className="text-xs font-bold mb-1.5" style={{ color:C.t3 }}>
                Комментарий {copyrightType==='author'?'(необязательно)':'или описание документа'}
              </p>
              <textarea value={copyrightNote} onChange={e=>setCopyrightNote(e.target.value)} rows={3}
                placeholder={copyrightType==='author'?'Я написал(а) этот трек самостоятельно...':'Номер лицензии, дата, издатель...'}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none" style={iSty}/>
            </div>

            <div className="flex items-start gap-3 rounded-xl px-3 py-3"
              style={{ background:`${C.accent}06`, border:`1px solid ${C.accent}15` }}>
              <Shield size={14} style={{ color:C.accent }} className="shrink-0 mt-0.5"/>
              <p className="text-[11px] leading-relaxed" style={{ color:C.t2 }}>
                Все документы шифруются и доступны только модераторам Sky. Мы не передаём данные третьим лицам.
              </p>
            </div>
          </>
        )}

        {/* -- STEP 4: Review -------------------------------- */}
        {step==='review' && (
          <>
            <p className="text-sm font-bold text-white">Проверьте перед отправкой</p>

            {/* Big preview card */}
            <div className="rounded-3xl overflow-hidden"
              style={{ background:`linear-gradient(135deg,#1a0533,#2d1b69,#1a1a2e)` }}>
              <div className="flex items-center gap-4 p-5">
                {coverUrl
                  ? <img src={coverUrl} alt="" className="h-20 w-20 rounded-2xl object-cover shrink-0 shadow-xl"/>
                  : <div className="h-20 w-20 rounded-2xl shrink-0 flex items-center justify-center text-3xl"
                      style={{ background:'rgba(0,0,0,0.3)' }}>🎵</div>
                }
                <div>
                  <p className="text-lg font-black text-white">{title}</p>
                  <p className="text-sm" style={{ color:'rgba(255,255,255,0.6)' }}>
                    {artist?.artistName ?? me?.name}
                  </p>
                  {albumName && <p className="text-xs mt-0.5" style={{ color:'rgba(255,255,255,0.4)' }}>
                    {albumName} · {albumYear}
                  </p>}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                      style={{ background:'rgba(79,110,247,0.25)', color:'#93c5fd' }}>{genre}</span>
                    {audioDur !== '0:00' && <span className="text-[10px]" style={{ color:'rgba(255,255,255,0.4)' }}>{audioDur}</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Details */}
            {[
              { icon:BookOpen, label:'Текст',       val:lyrics ? `${lyrics.slice(0,60)}...` : 'Не добавлен' },
              { icon:Shield,   label:'Права',        val:`${COPYRIGHT_TYPES.find(t=>t.key===copyrightType)?.label}${copyrightNote?` · ${copyrightNote.slice(0,30)}`:''}`  },
              { icon:FileText, label:'Документ',    val:docFile ? docName : (copyrightType==='author'?'Не требуется':'Не прикреплён') },
              { icon:Music2,   label:'Аудиофайл',   val:audioFile ? `${audioFile.name} · ${(audioFile.size/1048576).toFixed(1)} МБ` : ' - ' },
            ].map(({icon:Icon, label, val}) => (
              <div key={label} className="flex items-start gap-3 rounded-xl px-4 py-3"
                style={{ background:C.l1, border:`1px solid ${C.border}` }}>
                <Icon size={15} style={{ color:C.t3 }} className="mt-0.5 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color:C.t3 }}>{label}</p>
                  <p className="text-xs mt-0.5 text-white truncate">{val}</p>
                </div>
              </div>
            ))}

            <div className="rounded-xl px-4 py-3" style={{ background:`${C.amber}06`, border:`1px solid ${C.amber}15` }}>
              <p className="text-[11px] leading-relaxed" style={{ color:C.amber }}>
                После отправки трек будет проверен модераторами. Среднее время: 24-72 часа. Вы получите уведомление о результате.
              </p>
            </div>

            {err && <p className="text-xs text-center" style={{ color:C.red }}>{err}</p>}
          </>
        )}

        {/* Navigation */}
        {step !== 'review' ? (
          <>
            {err && <p className="text-xs text-center" style={{ color:C.red }}>{err}</p>}
            <motion.button whileTap={{ scale:.97 }} type="button" onClick={nextStep}
              className="w-full rounded-2xl py-4 text-sm font-bold text-white"
              style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)`, boxShadow:`0 6px 24px ${C.accent}30` }}>
              Далее →
            </motion.button>
          </>
        ) : (
          <motion.button whileTap={{ scale:.97 }} type="button" onClick={submit}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-50"
            style={{ background:`linear-gradient(135deg,${C.green},#059669)`, boxShadow:`0 6px 24px ${C.green}30` }}>
            {uploading ? (
              <><div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/>Отправка...</>
            ) : (
              <><CheckCircle size={16}/>Отправить на модерацию</>
            )}
          </motion.button>
        )}
      </div>
    </div>
  );
};

/* === ADMIN MUSIC MODERATION PANEL (enhanced) =============== */
export const AdminMusicPanel = () => {
  const { tracks, approveTrack, rejectTrack } = usePlatformStore();
  const { accounts } = useAuthStore();
  const [expanded, setExpanded] = useState<string|null>(null);
  const [rejectId, setRejectId] = useState<string|null>(null);
  const [reason,   setReason]   = useState('');
  const [playing,  setPlaying]  = useState<string|null>(null);

  const pending = tracks.filter(t => t.status === 'pending');

  const handleReject = (id: string) => {
    rejectTrack(id);
    setRejectId(null);
    setReason('');
    setExpanded(null);
  };

  if (pending.length === 0) return (
    <div className="flex flex-col items-center gap-2 py-12">
      <Music2 size={36} style={{ color:'var(--t3)', margin:'0 auto 8px' }}/>
      <p className="text-sm" style={{ color:'var(--t3)' }}>Треков на модерации нет</p>
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      {pending.map(t => {
        const isOpen    = expanded === t.id;
        const uploaderAcc = accounts.find(a => a.id === t.uploadedBy);
        const isPlaying = playing === t.id;
        const cpType    = (t as any).copyrightType as string | undefined;
        const cpNote    = (t as any).copyrightNote as string | undefined;
        const cpDoc     = (t as any).copyrightDoc  as string | undefined;
        const albumName = (t as any).albumName as string | undefined;
        const albumYear = (t as any).albumYear as string | undefined;

        return (
          <div key={t.id} className="rounded-2xl overflow-hidden"
            style={{ background:'var(--bg-l1)', border:'1.5px solid rgba(245,158,11,0.25)' }}>

            {/* Compact header - always visible */}
            <div className="flex items-center gap-3 px-4 py-3.5 cursor-pointer"
              onClick={() => setExpanded(isOpen ? null : t.id)}>
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl overflow-hidden"
                style={{ background:'linear-gradient(135deg,#1a0533,#2d1b69)' }}>
                {t.coverUrl
                  ? <img src={t.coverUrl} alt="" className="h-full w-full object-cover"/>
                  : <Music2 size={20} style={{ color:'rgba(255,255,255,0.4)' }}/>
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white truncate">{t.title}</p>
                <p className="text-xs" style={{ color:'var(--t2)' }}>
                  {t.uploaderName ?? uploaderAcc?.name ?? 'Unknown'} · {t.genre} · {t.duration}
                </p>
                {albumName && (
                  <p className="text-[10px]" style={{ color:'var(--t3)' }}>
                    {albumName} {albumYear && `(${albumYear})`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold px-2 py-1 rounded-full"
                  style={{ background:'rgba(245,158,11,0.15)', color:'var(--amber)' }}>
                  ⏳ Ожидает
                </span>
                <span className="text-xs" style={{ color:'var(--t3)', transform:isOpen?'rotate(180deg)':'rotate(0deg)', display:'inline-block', transition:'transform 0.2s' }}>▼</span>
              </div>
            </div>

            {/* Expanded detail */}
            <AnimatePresence>
              {isOpen && (
                <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }}
                  exit={{ height:0, opacity:0 }} transition={{ duration:0.2 }}
                  className="overflow-hidden">
                  <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor:'var(--border)' }}>

                    {/* Audio player */}
                    {t.sourceUrl && (
                      <div className="rounded-xl px-3 py-2.5 mt-3"
                        style={{ background:'rgba(255,255,255,0.04)' }}>
                        <div className="flex items-center gap-3">
                          <button type="button"
                            onClick={e => { e.stopPropagation();
                              const el = document.getElementById(`audio-${t.id}`) as HTMLAudioElement;
                              if (isPlaying) { el?.pause(); setPlaying(null); }
                              else { el?.play(); setPlaying(t.id); }
                            }}
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                            style={{ background:'var(--accent-bg)' }}>
                            {isPlaying ? <Pause size={16} style={{ color:'var(--accent)' }}/> : <Play size={16} style={{ color:'var(--accent)' }}/>}
                          </button>
                          <audio id={`audio-${t.id}`} src={t.sourceUrl} onEnded={()=>setPlaying(null)} className="flex-1 h-8"
                            style={{ filter:'invert(1)', opacity:0.7 }} controls/>
                        </div>
                      </div>
                    )}

                    {/* Submitter info */}
                    <div className="rounded-xl p-3" style={{ background:'rgba(255,255,255,0.03)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color:'var(--t3)' }}>Артист</p>
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                          style={{ background:'var(--accent-bg)' }}>
                          {(uploaderAcc?.name ?? 'U')[0]}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{uploaderAcc?.name ?? t.uploaderName}</p>
                          <p className="text-[10px]" style={{ color:'var(--t3)' }}>
                            @{uploaderAcc?.username ?? ' - '} ·{' '}
                            {t.submittedAt ? new Date((t as any).submittedAt).toLocaleDateString('ru',{day:'numeric',month:'long'}) : ''}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Lyrics */}
                    {t.lyrics && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color:'var(--t3)' }}>Текст</p>
                        <div className="rounded-xl p-3 max-h-32 overflow-y-auto"
                          style={{ background:'rgba(255,255,255,0.03)', scrollbarWidth:'none' }}>
                          <p className="text-xs leading-relaxed whitespace-pre-wrap text-white">{t.lyrics}</p>
                        </div>
                      </div>
                    )}

                    {/* Copyright */}
                    <div className="rounded-xl p-3"
                      style={{ background:'rgba(79,110,247,0.06)', border:'1px solid rgba(79,110,247,0.15)' }}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Shield size={13} style={{ color:'var(--accent)' }}/>
                        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color:'var(--accent)' }}>
                          Авторские права
                        </p>
                      </div>
                      <p className="text-xs font-semibold text-white">
                        {cpType ? COPYRIGHT_TYPES.find(x=>x.key===cpType)?.label : 'Не указан тип'}
                      </p>
                      {cpNote && <p className="text-[11px] mt-1" style={{ color:'var(--t2)' }}>{cpNote}</p>}
                      {cpDoc ? (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <FileText size={11} style={{ color:'var(--green)' }}/>
                          <span className="text-[10px] font-medium" style={{ color:'var(--green)' }}>
                            Документ: {cpDoc}
                          </span>
                        </div>
                      ) : cpType !== 'author' && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <AlertCircle size={11} style={{ color:'var(--amber, #f59e0b)' }}/>
                          <span className="text-[10px]" style={{ color:'var(--amber, #f59e0b)' }}>
                            Документ не приложен
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Reject reason input */}
                    {rejectId === t.id && (
                      <div className="space-y-2">
                        <input value={reason} onChange={e=>setReason(e.target.value)}
                          placeholder="Причина отказа (будет показана артисту)..."
                          className="w-full rounded-xl px-3 py-2.5 text-xs outline-none"
                          style={{ background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.25)', color:'var(--red)' }}/>
                      </div>
                    )}

                    {/* Actions */}
                    {rejectId === t.id ? (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => handleReject(t.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold"
                          style={{ background:'rgba(239,68,68,0.15)', color:'var(--red)', border:'1px solid rgba(239,68,68,0.25)' }}>
                          <XCircle size={13}/>Отклонить
                        </button>
                        <button type="button" onClick={()=>{setRejectId(null);setReason('');}}
                          className="rounded-xl px-4 py-3 text-xs" style={{ color:'var(--t3)', background:'rgba(255,255,255,0.05)' }}>
                          Отмена
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button type="button" onClick={()=>{ approveTrack(t.id); setExpanded(null); }}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold"
                          style={{ background:'rgba(34,197,94,0.15)', color:'#22c55e', border:'1px solid rgba(34,197,94,0.3)' }}>
                          <CheckCircle size={14}/>Опубликовать
                        </button>
                        <button type="button" onClick={()=>setRejectId(t.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold"
                          style={{ background:'rgba(239,68,68,0.1)', color:'var(--red)', border:'1px solid rgba(239,68,68,0.2)' }}>
                          <XCircle size={14}/>Отклонить
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};
