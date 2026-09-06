import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, X, Heart, Send, Eye, Radio, Mic, MicOff,
  Camera, Users, Flame, Play, Pause, Upload,
  Type, Image, Film, Trash2, ChevronLeft, ChevronRight,
  MessageCircle, Volume2, VolumeX, Archive, Languages, Loader2, MapPin, Music
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useStreamsStore, CATEGORY_LABEL } from '@/streams/store';
import { StreamStudio } from '@/streams/StreamStudio';
import { StreamView } from '@/streams/StreamView';
import { usePlatformStore } from '@/platform/store';
import { callAI } from '@/ai/SkyAI';
import { openProfile } from '@/profile/viewer/store';

/* --- BroadcastChannel: синхронизация историй между вкладками ----------- */
const STORIES_BC = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sky:stories:v1') : null;

// --- Типы --------------------------------------------------------------------
type StoryKind = 'photo'|'video'|'text';

interface Story {
  id: string; authorId: string; authorName: string; authorAvatar: string;
  kind: StoryKind; mediaUrl?: string; text?: string; bg: string;
  duration: number; createdAt: number; viewed: boolean; likes: string[]; views: number;
  viewedBy?: string[];           // реальные ID просмотревших
  visibility?: 'all' | 'closeFriends';
  mentions?: string[];           // упомянутые userId
  musicTrackId?: string;         // трек из каталога Sky Music
  location?: string;             // геометка (текст)
  poll?: { question: string; options: string[]; votes: Record<string, number> }; // userId -> optionIdx
  question?: { prompt: string; answers: { userId: string; userName: string; text: string }[] };
}

// --- Seed ---------------------------------------------------------------------
const DEMO_BG = [
  'linear-gradient(135deg,#1a0533,#2d1b69)',
  'linear-gradient(135deg,#0f2027,#2c5364)',
  'linear-gradient(135deg,#134e5e,#71b280)',
  'linear-gradient(135deg,#360033,#0b8793)',
  'linear-gradient(135deg,#200122,#6f0000)',
  'linear-gradient(135deg,#0a3d2e,#1b7a54)',
];

const mk = (authorId:string, name:string, av:string, text:string, bg:string): Story => ({
  id:`demo-${Math.random().toString(36).slice(2)}`,
  authorId, authorName:name, authorAvatar:av, kind:'text', text, bg,
  duration:7, createdAt:Date.now()-Math.random()*3600000, viewed:false, likes:[], views:Math.floor(Math.random()*400+50),
});

const INITIAL_STORIES: Story[] = [
  mk('acc-luna','Luna Nova','LU','Новый сетап  -  144fps стабильно!',DEMO_BG[0]),
  mk('acc-neo','Neo Driver','NE','Тест стрима  -  результат топ',DEMO_BG[1]),
  mk('acc-luna','Luna Nova','LU','Рейд в 21:00',DEMO_BG[2]),
  mk('acc-neo','Neo Driver','NE','Новая карта вышла',DEMO_BG[3]),
];

// --- Utils -------------------------------------------------------------------
const fmtAgo = (ts:number) => {
  const d=(Date.now()-ts)/1000;
  if(d<60)  return 'только что';
  if(d<3600)return `${Math.floor(d/60)} мин`;
  return `${Math.floor(d/3600)} ч`;
};
const fmtDur = (sec:number) => `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;

// --- StoryCircle --------------------------------------------------------------
const StoryCircle = ({ story, hasNew, isLive, onClick }:{
  story:{authorName:string;authorAvatar:string;viewed?:boolean};
  hasNew:boolean; isLive?:boolean; onClick:()=>void;
}) => (
  <motion.button type="button" whileHover={{scale:1.05}} whileTap={{scale:0.95}} onClick={onClick}
    className="flex flex-col items-center gap-1.5">
    <div className="relative">
      <div className="rounded-full p-[2px]" style={{background:hasNew
        ?(isLive?'linear-gradient(135deg,#ef4444,#f97316)':'var(--accent)')
        :'rgba(255,255,255,0.1)'}}>
        <div className="grid h-14 w-14 place-items-center rounded-full text-lg font-bold text-white border-2"
          style={{borderColor:'var(--bg)',background:'var(--bg-l1)'}}>
          {story.authorAvatar}
        </div>
      </div>
      {isLive&&<div className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
        style={{background:'#ef4444'}}>LIVE</div>}
    </div>
    <p className="w-16 truncate text-center text-[11px]" style={{color:'var(--t2)'}}>
      {story.authorName.split(' ')[0]}
    </p>
  </motion.button>
);

// --- StoryViewer --------------------------------------------------------------
const MentionText = ({ text }: { text: string }) => (
  <>
    {text.split(/(@\w+)/g).map((part, i) =>
      part.startsWith('@')
        ? <span key={i} style={{ color: '#7ab8ff', fontWeight: 700 }}>{part}</span>
        : <React.Fragment key={i}>{part}</React.Fragment>
    )}
  </>
);

const StoryViewer = ({ stories, startIdx, onClose, currentUserId, onLike, onDelete, onVote, onAnswer, accounts }:{
  stories:Story[]; startIdx:number; onClose:()=>void;
  currentUserId:string; onLike:(id:string)=>void; onDelete:(id:string)=>void;
  onVote:(id:string,optIdx:number)=>void; onAnswer:(id:string,text:string)=>void;
  accounts:{id:string;name:string}[];
}) => {
  const [idx, setIdx] = useState(startIdx);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const intervalRef = useRef<number|null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const story = stories[idx];

  const goNext = useCallback(()=>{
    if(idx<stories.length-1){setIdx(i=>i+1);setProgress(0);}
    else onClose();
  },[idx,stories.length,onClose]);

  const goPrev = ()=>{ if(idx>0){setProgress(0);setIdx(i=>i-1);} };

  useEffect(()=>{
    if(!story) return;
    setProgress(0);
    if(intervalRef.current) clearInterval(intervalRef.current);
    if(paused) return;
    const tick=100;
    intervalRef.current=window.setInterval(()=>{
      setProgress(p=>{
        const next=p+(tick/(story.duration*1000))*100;
        if(next>=100){clearInterval(intervalRef.current!);goNext();return 100;}
        return next;
      });
    },tick);
    return ()=>{ if(intervalRef.current) clearInterval(intervalRef.current); };
  },[idx,paused,story?.id]);

  if(!story){onClose();return null;}
  const liked = story.likes.includes(currentUserId);
  const isOwn = story.authorId===currentUserId;

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.97)',display:'flex',alignItems:'center',justifyContent:'center'}}>

      {/* Навигация стрелками */}
      {idx>0&&<button type="button" onClick={goPrev}
        className="absolute left-4 top-1/2 -translate-y-1/2 z-10 grid h-10 w-10 place-items-center rounded-full"
        style={{background:'rgba(255,255,255,0.1)'}}>
        <ChevronLeft size={20} className="text-white"/>
      </button>}
      {idx<stories.length-1&&<button type="button" onClick={goNext}
        className="absolute right-4 top-1/2 -translate-y-1/2 z-10 grid h-10 w-10 place-items-center rounded-full"
        style={{background:'rgba(255,255,255,0.1)'}}>
        <ChevronRight size={20} className="text-white"/>
      </button>}

      <div className="relative flex h-full max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-xl">
        {/* Прогресс */}
        <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-3">
          {stories.map((s,i)=>(
            <div key={s.id} className="flex-1 h-0.5 overflow-hidden rounded-full" style={{background:'rgba(255,255,255,0.3)'}}>
              <div className="h-full rounded-full bg-white transition-none"
                style={{width:i<idx?'100%':i===idx?`${progress}%`:'0%'}}/>
            </div>
          ))}
        </div>

        {/* Шапка */}
        <div className="absolute top-8 left-0 right-0 z-20 flex items-center gap-3 px-4">
          <button type="button" onClick={() => openProfile(story.authorId)}
            className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white shrink-0"
            style={{background:'rgba(255,255,255,0.2)'}}>{story.authorAvatar}</button>
          <button type="button" onClick={() => openProfile(story.authorId)} className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-white truncate">{story.authorName}</p>
            <p className="text-xs text-white/60">{fmtAgo(story.createdAt)}</p>
          </button>
          {isOwn ? (
            <button type="button" onClick={()=>{setPaused(true);setShowViewers(true);}}
              className="flex items-center gap-2 text-xs text-white/60">
              <Eye size={13}/><span>{story.views}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs text-white/60">
              <Eye size={13}/><span>{story.views}</span>
            </div>
          )}
          {isOwn&&<button type="button" onClick={()=>setShowMenu(m=>!m)} className="text-white/70">
            <Trash2 size={16}/>
          </button>}
          <button type="button" onClick={onClose} className="text-white/70"><X size={20}/></button>
        </div>

        {/* Контент */}
        <div className="flex-1 relative select-none"
          onPointerDown={()=>setPaused(true)} onPointerUp={()=>setPaused(false)}>
          {story.kind==='photo'&&story.mediaUrl&&<img src={story.mediaUrl} alt="" className="h-full w-full object-cover"/>}
          {story.kind==='video'&&story.mediaUrl&&<video ref={videoRef} src={story.mediaUrl} autoPlay loop muted={false} className="h-full w-full object-cover"/>}
          {(story.kind==='text'||!story.mediaUrl)&&(
            <div className="h-full w-full flex items-center justify-center p-8" style={{background:story.bg}}>
              <p className="text-center text-xl font-bold leading-relaxed text-white"><MentionText text={story.text??''}/></p>
            </div>
          )}
          {(story.location||story.musicTrackId)&&(
            <div className="absolute top-16 left-0 right-0 px-6 flex flex-col items-center gap-1.5">
              {story.location&&(
                <div className="flex items-center gap-1.5 rounded-full px-3 py-1" style={{background:'rgba(0,0,0,0.45)',backdropFilter:'blur(6px)'}}>
                  <MapPin size={11} color="#fff"/><span className="text-xs font-medium text-white">{story.location}</span>
                </div>
              )}
              {story.musicTrackId&&(()=>{
                const track = usePlatformStore.getState().tracks.find(t=>t.id===story.musicTrackId);
                return track ? (
                  <div className="flex items-center gap-1.5 rounded-full px-3 py-1" style={{background:'rgba(0,0,0,0.45)',backdropFilter:'blur(6px)'}}>
                    <Music size={11} color="#fff"/><span className="text-xs font-medium text-white">{track.title} — {track.artist}</span>
                  </div>
                ) : null;
              })()}
            </div>
          )}
          {story.text&&story.kind!=='text'&&(
            <div className="absolute bottom-20 left-0 right-0 px-6">
              <div className="rounded-2xl px-4 py-2 text-center text-white"
                style={{background:'rgba(0,0,0,0.5)',backdropFilter:'blur(8px)'}}>
                {story.text&&<MentionText text={story.text}/>}
              </div>
            </div>
          )}
          {story.poll&&(()=>{
            const myVote = story.poll!.votes[currentUserId];
            const totalVotes = Object.keys(story.poll!.votes).length;
            const showResults = myVote!==undefined || isOwn;
            return (
              <div className="absolute inset-x-6 bottom-28 rounded-2xl p-3.5" style={{background:'rgba(20,20,26,0.85)',backdropFilter:'blur(10px)'}}>
                <p className="text-sm font-bold text-white mb-2.5 text-center">{story.poll!.question}</p>
                <div className="space-y-1.5">
                  {story.poll!.options.map((opt,i)=>{
                    const count = Object.values(story.poll!.votes).filter(v=>v===i).length;
                    const pct = totalVotes>0 ? Math.round(count/totalVotes*100) : 0;
                    return (
                      <button key={i} type="button" disabled={myVote!==undefined||isOwn}
                        onClick={()=>onVote(story.id,i)}
                        className="relative w-full rounded-xl overflow-hidden text-left px-3 py-2 text-xs font-semibold text-white"
                        style={{background:'rgba(255,255,255,0.1)'}}>
                        {showResults && (
                          <div className="absolute inset-y-0 left-0 rounded-xl" style={{width:`${pct}%`,background:i===myVote?'rgba(91,155,209,0.5)':'rgba(255,255,255,0.15)'}}/>
                        )}
                        <span className="relative flex items-center justify-between">
                          {opt} {showResults && <span>{pct}%</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {story.question&&(
            <div className="absolute inset-x-6 bottom-28 rounded-2xl p-3.5" style={{background:'rgba(20,20,26,0.85)',backdropFilter:'blur(10px)'}}>
              <p className="text-sm font-bold text-white mb-2.5 text-center">{story.question.prompt}</p>
              {isOwn ? (
                <div className="space-y-1.5 max-h-28 overflow-y-auto">
                  {story.question.answers.length===0
                    ? <p className="text-xs text-white/40 text-center">Пока нет ответов</p>
                    : story.question.answers.map((a,i)=>(
                      <div key={i} className="rounded-lg px-2.5 py-1.5 text-xs text-white" style={{background:'rgba(255,255,255,0.1)'}}>
                        <span className="font-semibold">{a.userName}:</span> {a.text}
                      </div>
                    ))}
                </div>
              ) : (
                <div className="flex gap-2" onPointerDown={e=>e.stopPropagation()}>
                  <input value={answerText} onChange={e=>setAnswerText(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter'&&answerText.trim()){onAnswer(story.id,answerText.trim());setAnswerText('');}}}
                    placeholder="Ваш ответ..." className="flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white placeholder-white/40 outline-none"/>
                  <button type="button" onClick={()=>{if(answerText.trim()){onAnswer(story.id,answerText.trim());setAnswerText('');}}}
                    className="rounded-lg px-3 text-xs font-bold text-white" style={{background:'var(--accent)'}}>Отпр.</button>
                </div>
              )}
            </div>
          )}
          {/* Навигация тапами */}
          <button type="button" onClick={goPrev} className="absolute left-0 top-0 h-full w-1/3 opacity-0"/>
          <button type="button" onClick={goNext} className="absolute right-0 top-0 h-full w-1/3 opacity-0"/>
        </div>

        {/* Кто посмотрел (только для своих историй) */}
        <AnimatePresence>
          {showViewers&&(
            <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:8}}
              className="absolute inset-x-4 bottom-20 z-30 rounded-2xl p-4 max-h-64 overflow-y-auto"
              style={{background:'var(--bg-l1)',border:'1px solid rgba(255,255,255,0.1)'}}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-white font-semibold">Просмотрели ({(story.viewedBy??[]).length})</p>
                <button type="button" onClick={()=>{setShowViewers(false);setPaused(false);}} className="text-white/60"><X size={16}/></button>
              </div>
              {(story.viewedBy??[]).length===0 ? (
                <p className="text-xs text-white/40 py-3 text-center">Пока никто не посмотрел</p>
              ) : (
                <div className="space-y-2">
                  {(story.viewedBy??[]).map(uid=>{
                    const acc = accounts.find(a=>a.id===uid);
                    const didLike = story.likes.includes(uid);
                    return (
                      <div key={uid} className="flex items-center gap-2.5">
                        <div className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold text-white shrink-0" style={{background:'rgba(255,255,255,0.15)'}}>
                          {(acc?.name??'?')[0]?.toUpperCase()}
                        </div>
                        <span className="text-sm text-white flex-1 truncate">{acc?.name??uid}</span>
                        {didLike && <Heart size={13} className="fill-red-400 text-red-400"/>}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Подтверждение удаления */}
        <AnimatePresence>
          {showMenu&&(
            <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:8}}
              className="absolute inset-x-4 bottom-20 z-30 rounded-2xl p-4 space-y-2"
              style={{background:'var(--bg-l1)',border:'1px solid rgba(255,255,255,0.1)'}}>
              <p className="text-sm text-white font-medium">Удалить эту историю?</p>
              <div className="flex gap-2">
                <button type="button" onClick={()=>setShowMenu(false)}
                  className="flex-1 rounded-xl py-2 text-sm" style={{background:'var(--border)',color:'var(--t2)'}}>
                  Отмена
                </button>
                <button type="button" onClick={()=>{onDelete(story.id);onClose();}}
                  className="flex-1 rounded-xl py-2 text-sm font-bold" style={{background:'rgba(239,68,68,0.2)',color:'var(--red)'}}>
                  Удалить
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Подвал */}
        <div className="absolute bottom-0 left-0 right-0 z-20 p-4 flex items-center gap-3"
          style={{background:'linear-gradient(transparent,rgba(0,0,0,0.7))'}}>
          <input value={reply} onChange={e=>setReply(e.target.value)} placeholder="Ответить..."
            onKeyDown={e=>{if(e.key==='Enter'&&reply.trim()){setReply('');setPaused(false);}}}
            className="flex-1 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder-white/40 outline-none"/>
          <motion.button whileTap={{scale:0.85}} type="button" onClick={()=>onLike(story.id)}
            className="grid h-10 w-10 place-items-center rounded-full transition-colors"
            style={{background:liked?'rgba(239,68,68,0.3)':'rgba(255,255,255,0.1)'}}>
            <Heart size={18} className={liked?'fill-red-400 text-red-400':'text-white'}/>
          </motion.button>
          <span className="text-xs text-white/50">{story.likes.length}</span>
        </div>
      </div>
    </motion.div>
  );
};

// --- CreateStory --------------------------------------------------------------
const CreateStory = ({ onPublish, onClose, authorId, authorName, authorAvatar }:{
  onPublish:(s:Story)=>void; onClose:()=>void;
  authorId:string; authorName:string; authorAvatar:string;
}) => {
  const [kind, setKind] = useState<StoryKind>('text');
  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState<string|undefined>();
  const [bg, setBg] = useState(DEMO_BG[0]);
  const [publishing, setPublishing] = useState(false);
  const [visibility, setVisibility] = useState<'all'|'closeFriends'>('all');
  const [musicTrackId, setMusicTrackId] = useState<string|undefined>();
  const [showMusicPicker, setShowMusicPicker] = useState(false);
  const [location, setLocation] = useState('');
  const [translating, setTranslating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { accounts } = useAuthStore();
  const tracks = usePlatformStore(s=>s.tracks);
  const pickedTrack = tracks.find(t=>t.id===musicTrackId);

  const translateText = async () => {
    const t = text.trim(); if(!t) return;
    setTranslating(true);
    try {
      const r = await callAI(`Переведи текст на английский язык, если он на русском, или на русский, если он на английском. Ответь только переводом, без пояснений:\n\n${t}`, 150);
      setText(r);
    } catch {}
    setTranslating(false);
  };

  const handleFile = (e:React.ChangeEvent<HTMLInputElement>)=>{
    const f=e.target.files?.[0]; if(!f) return;
    setMediaUrl(prev=>{ if(prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(f); });
    setKind(f.type.startsWith('video')?'video':'photo');
  };

  const publish = ()=>{
    if(!text.trim()&&!mediaUrl) return;
    setPublishing(true);
    // упоминания — реальные username, встреченные в тексте (@username)
    const mentionedNames = [...text.matchAll(/@(\w+)/g)].map(m=>m[1].toLowerCase());
    const mentions = accounts.filter(a=>mentionedNames.includes(a.username?.toLowerCase()??'')).map(a=>a.id);
    setTimeout(()=>{
      onPublish({
        id:crypto.randomUUID(), authorId, authorName, authorAvatar,
        kind, mediaUrl, text:text.trim()||undefined, bg,
        duration:kind==='text'?7:kind==='photo'?5:15,
        createdAt:Date.now(), viewed:false, likes:[], views:0,
        visibility, mentions:mentions.length?mentions:undefined,
        musicTrackId, location:location.trim()||undefined,
      });
    },300);
  };

  const canPublish = !!(text.trim()||mediaUrl);

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.92)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <motion.div initial={{scale:0.9,y:20}} animate={{scale:1,y:0}}
        className="w-full max-w-sm overflow-hidden rounded-xl"
        style={{background:'var(--bg-l1)',border:'1px solid rgba(255,255,255,0.1)'}}>

        <div className="flex items-center justify-between p-5 pb-4">
          <p className="font-bold text-white text-lg">Новая история</p>
          <button type="button" onClick={onClose} style={{color:'var(--t3)'}}><X size={20}/></button>
        </div>

        {/* Тип */}
        <div className="flex gap-2 px-5 pb-4">
          {([['text','Текст',Type],['photo','Фото',Image],['video','Видео',Film]] as const).map(([k,lbl,Icon])=>(
            <button key={k} type="button" onClick={()=>{setKind(k);setMediaUrl(undefined);}}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2 text-xs font-medium transition-all"
              style={{background:kind===k?'var(--accent-bg)':'var(--bg-l2)',
                border:kind===k?'1px solid var(--accent-bg)':'1px solid var(--border)',
                color:kind===k?'var(--accent)':'var(--t3)'}}>
              <Icon size={13}/>{lbl}
            </button>
          ))}
        </div>

        {/* Превью */}
        <div className="mx-5 mb-4 overflow-hidden rounded-2xl" style={{height:240}}>
          {kind==='text'?(
            <div className="flex h-full flex-col items-center justify-center p-6" style={{background:bg}}>
              <p className="text-center text-lg font-bold text-white">{text||'Ваш текст здесь'}</p>
            </div>
          ):mediaUrl?(
            kind==='video'
              ?<video src={mediaUrl} className="h-full w-full object-cover" autoPlay muted loop/>
              :<img src={mediaUrl} alt="" className="h-full w-full object-cover"/>
          ):(
            <button type="button" onClick={()=>fileRef.current?.click()}
              className="flex h-full w-full flex-col items-center justify-center gap-3"
              style={{background:'var(--bg-l2)',border:'2px dashed rgba(255,255,255,0.15)'}}>
              <Upload size={28} style={{color:'var(--t3)'}}/>
              <p className="text-sm" style={{color:'var(--t3)'}}>{kind==='photo'?'Выбрать фото':'Выбрать видео'}</p>
            </button>
          )}
        </div>

        <input ref={fileRef} type="file" accept={kind==='video'?'video/*':'image/*'} className="hidden" onChange={handleFile}/>

        {/* Фоны для текста */}
        {kind==='text'&&(
          <div className="flex gap-2 px-5 pb-4">
            {DEMO_BG.map(b=>(
              <button key={b} type="button" onClick={()=>setBg(b)}
                className="h-8 w-8 rounded-xl border-2 transition-transform hover:scale-110"
                style={{background:b,borderColor:bg===b?'white':'transparent'}}/>
            ))}
          </div>
        )}

        {/* Подпись */}
        <div className="px-5 pb-3 flex gap-2">
          <input value={text} onChange={e=>setText(e.target.value)}
            placeholder={kind==='text'?'Напишите что-нибудь... (@упомянуть)':'Подпись (необязательно, @упомянуть)'}
            className="flex-1 rounded-2xl px-4 py-3 text-sm text-white outline-none"
            style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}/>
          {text.trim().length>1 && (
            <button type="button" onClick={translateText} disabled={translating}
              title="Перевести"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl disabled:opacity-50"
              style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
              {translating?<Loader2 size={15} className="animate-spin" style={{color:'var(--accent)'}}/>:<Languages size={15} style={{color:'var(--t2)'}}/>}
            </button>
          )}
        </div>

        {/* Локация */}
        <div className="px-5 pb-3">
          <div className="flex items-center gap-2 rounded-2xl px-4 py-2.5" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
            <MapPin size={14} style={{color:'var(--t3)'}}/>
            <input value={location} onChange={e=>setLocation(e.target.value)}
              placeholder="Добавить локацию" className="flex-1 bg-transparent text-sm text-white outline-none"/>
          </div>
        </div>

        {/* Музыка */}
        <div className="px-5 pb-3">
          {pickedTrack ? (
            <button type="button" onClick={()=>setShowMusicPicker(true)}
              className="flex w-full items-center gap-2.5 rounded-2xl px-4 py-2.5" style={{background:'var(--accent-bg)',border:'1px solid var(--accent-bg)'}}>
              <Music size={14} style={{color:'var(--accent)'}}/>
              <span className="flex-1 truncate text-left text-sm" style={{color:'var(--accent)'}}>{pickedTrack.title} — {pickedTrack.artist}</span>
              <button type="button" onClick={e=>{e.stopPropagation();setMusicTrackId(undefined);}} style={{color:'var(--accent)'}}><X size={14}/></button>
            </button>
          ):(
            <button type="button" onClick={()=>setShowMusicPicker(true)}
              className="flex w-full items-center gap-2.5 rounded-2xl px-4 py-2.5" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
              <Music size={14} style={{color:'var(--t3)'}}/>
              <span className="text-sm" style={{color:'var(--t3)'}}>Добавить музыку</span>
            </button>
          )}
          {showMusicPicker && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-2xl p-2 space-y-1" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
              {tracks.slice(0,20).map(t=>(
                <button key={t.id} type="button" onClick={()=>{setMusicTrackId(t.id);setShowMusicPicker(false);}}
                  className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-white/5">
                  <Music size={12} style={{color:'var(--t3)'}}/>
                  <span className="flex-1 truncate text-xs text-white">{t.title}</span>
                  <span className="truncate text-[11px]" style={{color:'var(--t3)'}}>{t.artist}</span>
                </button>
              ))}
              <button type="button" onClick={()=>setShowMusicPicker(false)} className="w-full text-center text-[11px] py-1" style={{color:'var(--t3)'}}>Закрыть</button>
            </div>
          )}
        </div>

        {/* Приватность */}
        <div className="px-5 pb-4 flex gap-2">
          {([['all','Все'],['closeFriends','Близкие друзья']] as const).map(([v,l])=>(
            <button key={v} type="button" onClick={()=>setVisibility(v)}
              className="flex-1 rounded-2xl py-2 text-xs font-semibold"
              style={{background:visibility===v?'var(--accent-bg)':'var(--bg-l2)',
                border:visibility===v?'1px solid var(--accent-bg)':'1px solid var(--border)',
                color:visibility===v?'var(--accent)':'var(--t3)'}}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex gap-3 px-5 pb-5">
          {(kind==='photo'||kind==='video')&&(
            <button type="button" onClick={()=>fileRef.current?.click()}
              className="rounded-2xl px-4 py-3 text-sm"
              style={{background:'var(--border)',color:'var(--t2)',flex:1}}>
              {mediaUrl?'Изменить':'Выбрать файл'}
            </button>
          )}
          <motion.button whileTap={{scale:0.97}} type="button" onClick={publish} disabled={!canPublish||publishing}
            className="rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-40"
            style={{background:'var(--accent)',flex:2}}>
            {publishing?'Публикуем...':'Опубликовать историю'}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};


// --- LiveStreamCard (реальные трансляции из useStreamsStore) ------------------
const LiveStreamCard = ({ live, onClick }:{ live: import('../streams/store').LiveStreamEntry; onClick:()=>void }) => (
  <motion.button type="button" whileHover={{scale:1.02}} whileTap={{scale:0.98}} onClick={onClick}
    className="relative overflow-hidden rounded-2xl text-left w-full"
    style={{background:'linear-gradient(135deg,rgba(239,68,68,0.2),rgba(249,115,22,0.1))',border:'1px solid rgba(239,68,68,0.2)'}}>
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold text-white"
          style={{background:'rgba(239,68,68,0.3)'}}>{live.authorAvatar}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{live.authorName}</p>
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse"/>
            <span className="text-xs" style={{color:'var(--red)'}}>LIVE</span>
          </div>
        </div>
        <div className="flex items-center gap-1" style={{color:'var(--t2)'}}>
          <Users size={12}/><span className="text-xs">{live.viewerIds.length}</span>
        </div>
      </div>
      <p className="text-sm font-semibold text-white truncate mb-1">{live.title}</p>
      <p className="text-xs" style={{color:'var(--t3)'}}>{CATEGORY_LABEL[live.category]}</p>
    </div>
  </motion.button>
);

// --- Главный модуль -----------------------------------------------------------
// Глобальный ключ  -  истории видны всем пользователям
const STORIES_KEY = 'sky:stories:v3:global';
const MEDIA_KEY   = 'sky:stories:v3:media';
const CLOSE_FRIENDS_KEY = 'sky:stories:closeFriends:v1';

const loadCloseFriends = (): Record<string,string[]> => {
  try { return JSON.parse(localStorage.getItem(CLOSE_FRIENDS_KEY)||'{}'); } catch { return {}; }
};
const saveCloseFriends = (d: Record<string,string[]>) => {
  try { localStorage.setItem(CLOSE_FRIENDS_KEY, JSON.stringify(d)); } catch {}
};

// Track created blob URLs so we can revoke them when no longer needed
const _blobUrls = new Set<string>();

const revokeStaleBlobUrls = (activeUrls: string[]) => {
  const activeSet = new Set(activeUrls);
  for (const url of _blobUrls) {
    if (!activeSet.has(url)) {
      URL.revokeObjectURL(url);
      _blobUrls.delete(url);
    }
  }
};

const saveStories = (ss: Story[]) => {
  try {
    localStorage.setItem(STORIES_KEY, JSON.stringify(
      ss.map(s => ({ ...s, mediaUrl: s.mediaUrl?.startsWith('blob:') ? undefined : s.mediaUrl }))
    ));
    // Prune media entries for stories that no longer exist
    const activeIds = new Set(ss.map(s => s.id));
    const media: Record<string,string> = JSON.parse(localStorage.getItem(MEDIA_KEY)||'{}');
    let pruned = false;
    for (const id of Object.keys(media)) {
      if (!activeIds.has(id)) { delete media[id]; pruned = true; }
    }
    if (pruned) localStorage.setItem(MEDIA_KEY, JSON.stringify(media));
  } catch {}
};

const loadStories = (): Story[] => {
  try {
    const raw = localStorage.getItem(STORIES_KEY);
    if (!raw) return INITIAL_STORIES;
    const allSs: Story[] = JSON.parse(raw);
    const cutoff = Date.now() - 24*60*60*1000;
    const ss: Story[] = allSs.filter(s => s.createdAt > cutoff || s.authorId !== 'demo');
    const media: Record<string,string> = JSON.parse(localStorage.getItem(MEDIA_KEY)||'{}');
    return ss.map(s => {
      if (!s.mediaUrl && media[s.id]) {
        try {
          const [header, data] = media[s.id].split(',');
          const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
          const bytes = atob(data);
          const arr = new Uint8Array(bytes.length);
          for (let i=0;i<bytes.length;i++) arr[i]=bytes.charCodeAt(i);
          const blobUrl = URL.createObjectURL(new Blob([arr],{type:mime}));
          _blobUrls.add(blobUrl);
          return { ...s, mediaUrl: blobUrl };
        } catch { return s; }
      }
      return s;
    });
  } catch { return INITIAL_STORIES; }
};

export const StoriesModule = () => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a=>a.id===currentUserId);

  const [stories, setStories] = useState<Story[]>(loadStories);
  const [tab, setTab] = useState<'stories'|'live'>('stories');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIdx, setViewerIdx] = useState(0);
  const [viewerGroup, setViewerGroup] = useState<Story[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [watchingStreamId, setWatchingStreamId] = useState<string|null>(null);
  const liveStreamsMap = useStreamsStore(s=>s.streams);
  const lives = useMemo(()=>Object.values(liveStreamsMap).filter(l=>!l.ended).sort((a,b)=>b.startedAt-a.startedAt),[liveStreamsMap]);
  const myActiveStream = lives.find(l=>l.authorId===currentUserId);

  // Сохраняем истории при изменении + очищаем устаревшие blob URLs
  useEffect(()=>{
    saveStories(stories);
    revokeStaleBlobUrls(stories.map(s=>s.mediaUrl).filter(Boolean) as string[]);
  },[stories]);

  // Синхронизируем истории между вкладками
  useEffect(()=>{
    if(!STORIES_BC) return;
    const handler = (e: MessageEvent) => {
      const { type, payload } = e.data ?? {};
      if (type === 'story-new') {
        setStories(ss => ss.find(s => s.id === payload.id) ? ss : [payload, ...ss]);
      }
      if (type === 'story-delete') {
        setStories(ss => ss.filter(s => s.id !== payload.id));
      }
      if (type === 'story-like') {
        setStories(ss => ss.map(s => s.id === payload.storyId ? {...s, likes: payload.likes} : s));
      }
    };
    STORIES_BC.onmessage = handler;
    return () => { if(STORIES_BC) STORIES_BC.onmessage = null; };
  }, []);

  const grouped = useMemo(()=>{
    const cutoff = Date.now() - 24*60*60*1000;
    const closeFriends = loadCloseFriends();
    const visible = stories.filter(s => {
      if (s.createdAt <= cutoff) return false; // истёкшие — только в архиве
      if (s.authorId === currentUserId) return true;
      if (s.visibility === 'closeFriends') return (closeFriends[s.authorId]??[]).includes(currentUserId!);
      return true;
    });
    const map=new Map<string,Story[]>();
    visible.forEach(s=>{const arr=map.get(s.authorId)??[];arr.push(s);map.set(s.authorId,arr);});
    return Array.from(map.entries()).map(([id,ss])=>({
      authorId:id, authorName:ss[0].authorName, authorAvatar:ss[0].authorAvatar,
      stories:ss, hasNew:ss.some(s=>!s.viewed),
    }));
  },[stories,currentUserId]);

  /* Архив — собственные истёкшие истории (только владелец их видит) */
  const archivedStories = useMemo(()=>{
    const cutoff = Date.now() - 24*60*60*1000;
    return stories.filter(s => s.authorId===currentUserId && s.createdAt <= cutoff)
      .sort((a,b)=>b.createdAt-a.createdAt);
  },[stories,currentUserId]);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const myStoriesGroup = grouped.find(g=>g.authorId===currentUserId);

  const openStories=(group:Story[])=>{
    setViewerGroup(group);setViewerIdx(0);setViewerOpen(true);
    setStories(ss=>ss.map(s=>{
      if (!group.find(g=>g.id===s.id)) return s;
      const already = (s.viewedBy ?? []).includes(currentUserId);
      return {
        ...s, viewed:true,
        viewedBy: already ? s.viewedBy : [...(s.viewedBy ?? []), currentUserId],
        views: already ? s.views : s.views + (s.authorId===currentUserId ? 0 : 1),
      };
    }));
  };

  const publishStory = async (s: Story) => {
    // Если медиа  -  blob, конвертируем в base64 для персистентности
    if (s.mediaUrl?.startsWith('blob:')) {
      try {
        const resp = await fetch(s.mediaUrl);
        const blob = await resp.blob();
        const b64: string = await new Promise(res => {
          const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob);
        });
        const media: Record<string,string> = JSON.parse(localStorage.getItem(MEDIA_KEY)||'{}');
        media[s.id] = b64;
        localStorage.setItem(MEDIA_KEY, JSON.stringify(media));
      } catch {}
    }
    setStories(ss => [s, ...ss]);
    STORIES_BC?.postMessage({ type: 'story-new', payload: s });
    setCreateOpen(false);
  };

  const deleteStory = (id: string) => {
    setStories(ss => ss.filter(s => s.id !== id));
    STORIES_BC?.postMessage({ type: 'story-delete', payload: { id } });
    try {
      const media: Record<string,string> = JSON.parse(localStorage.getItem(MEDIA_KEY)||'{}');
      delete media[id];
      localStorage.setItem(MEDIA_KEY, JSON.stringify(media));
    } catch {}
  };

  const toggleLike=(storyId:string)=>{
    setStories(ss=>ss.map(s=>{
      if(s.id!==storyId) return s;
      const likes = s.likes.includes(currentUserId!)
        ? s.likes.filter(l=>l!==currentUserId)
        : [...s.likes,currentUserId!];
      STORIES_BC?.postMessage({ type: 'story-like', payload: { storyId, likes } });
      return {...s,likes};
    }));
  };

  const voteOnPoll = (storyId:string, optIdx:number) => {
    setStories(ss=>ss.map(s=>{
      if(s.id!==storyId||!s.poll||s.poll.votes[currentUserId!]!==undefined) return s;
      return { ...s, poll:{ ...s.poll, votes:{ ...s.poll.votes, [currentUserId!]:optIdx } } };
    }));
  };

  const answerQuestion = (storyId:string, text:string) => {
    const me2 = accounts.find(a=>a.id===currentUserId);
    setStories(ss=>ss.map(s=>{
      if(s.id!==storyId||!s.question) return s;
      return { ...s, question:{ ...s.question, answers:[...s.question.answers,{userId:currentUserId!,userName:me2?.name??'Кто-то',text}] } };
    }));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Табы */}
      <div className="flex items-center gap-0.5 border-b px-4 pt-3" style={{borderColor:'var(--border)'}}>
        {([['stories','Истории'],['live','Трансляции']] as const).map(([k,l])=>(
          <button key={k} type="button" onClick={()=>setTab(k)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all"
            style={{borderBottom:tab===k?'2px solid var(--accent)':'2px solid transparent',
              color:tab===k?'var(--accent)':'var(--t3)',background:'transparent'}}>
            {k==='live'&&<div className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse"/>}
            {l}
            {k==='live'&&lives.length>0&&<span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{background:'#ef4444'}}>{lives.length}</span>}
          </button>
        ))}
      </div>

      {/* -- Истории -- */}
      {tab==='stories'&&(
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Строка кружков */}
          <div className="flex items-start gap-4 overflow-x-auto p-4 scroll-none border-b" style={{borderColor:'var(--border)'}}>
            {/* Моя история */}
            <div className="flex flex-col items-center gap-1.5">
              <motion.button whileHover={{scale:1.05}} whileTap={{scale:0.95}} type="button"
                onClick={()=>myStoriesGroup?openStories(myStoriesGroup.stories):setCreateOpen(true)}
                className="relative">
                <div className="rounded-full p-[2px]"
                  style={{background:myStoriesGroup?'var(--accent)':'rgba(255,255,255,0.1)'}}>
                  <div className="grid h-14 w-14 place-items-center rounded-full text-lg font-bold text-white border-2"
                    style={{borderColor:'var(--bg)',background:'var(--bg-l1)'}}>
                    {me?.name?.[0]??'?'}
                  </div>
                </div>
                <div className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full text-white"
                  style={{background:'var(--accent)',fontSize:14,fontWeight:700}}>+</div>
              </motion.button>
              <p className="w-16 truncate text-center text-[11px]" style={{color:'var(--t2)'}}>Моя</p>
            </div>

            {grouped.filter(g=>g.authorId!==currentUserId).map(g=>(
              <StoryCircle key={g.authorId} story={g} hasNew={g.hasNew} isLive={false}
                onClick={()=>openStories(g.stories)}/>
            ))}

            {archivedStories.length>0 && (
              <div className="flex flex-col items-center gap-1.5">
                <motion.button whileHover={{scale:1.05}} whileTap={{scale:0.95}} type="button"
                  onClick={()=>setArchiveOpen(true)}
                  className="grid h-14 w-14 place-items-center rounded-full border-2"
                  style={{borderColor:'var(--border)',background:'var(--bg-l1)'}}>
                  <Archive size={20} style={{color:'var(--t2)'}}/>
                </motion.button>
                <p className="w-16 truncate text-center text-[11px]" style={{color:'var(--t2)'}}>Архив</p>
              </div>
            )}
          </div>

          {/* Сетка карточек */}
          <div className="flex-1 overflow-y-auto p-4">
            {stories.length===0?(
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Camera size={48} style={{color:'var(--t3)'}}/>
                <p className="text-sm" style={{color:'var(--t3)'}}>Нет историй. Добавь первую!</p>
                <motion.button whileTap={{scale:0.97}} type="button" onClick={()=>setCreateOpen(true)}
                  className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-medium text-white"
                  style={{background:'var(--accent)'}}>
                  <Plus size={15}/> Создать историю
                </motion.button>
              </div>
            ):(
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {stories.map(s=>(
                  <motion.div key={s.id} whileHover={{scale:1.02}} whileTap={{scale:0.97}}
                    className="relative cursor-pointer overflow-hidden rounded-2xl"
                    style={{aspectRatio:'9/16',maxHeight:280}}
                    onClick={()=>{const g=stories.filter(x=>x.authorId===s.authorId);openStories(g);}}>
                    {s.kind==='photo'&&s.mediaUrl&&<img src={s.mediaUrl} alt="" className="h-full w-full object-cover"/>}
                    {s.kind==='video'&&s.mediaUrl&&<video src={s.mediaUrl} muted className="h-full w-full object-cover"/>}
                    {(s.kind==='text'||!s.mediaUrl)&&(
                      <div className="h-full w-full flex items-center justify-center p-3" style={{background:s.bg}}>
                        <p className="text-center text-sm font-medium text-white line-clamp-4">{s.text}</p>
                      </div>
                    )}
                    <div className="absolute inset-0" style={{background:'linear-gradient(transparent 50%,rgba(0,0,0,0.7))'}}/>
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <p className="truncate text-xs font-semibold text-white">{s.authorName}</p>
                      <div className="flex items-center gap-1 text-white/60">
                        <Eye size={10}/><span className="text-[10px]">{s.views}</span>
                        {s.likes.length>0&&<><Heart size={10} className="ml-1 fill-red-400 text-red-400"/><span className="text-[10px]">{s.likes.length}</span></>}
                      </div>
                    </div>
                    {!s.viewed&&<div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-blue-500"/>}
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Кнопка создать */}
          <motion.button whileHover={{scale:1.05}} whileTap={{scale:0.95}} type="button"
            onClick={()=>setCreateOpen(true)}
            className="absolute bottom-6 right-6 grid h-14 w-14 place-items-center rounded-full shadow-xl"
            style={{background:'var(--accent)',boxShadow:'0 8px 32px var(--accent-bg)'}}>
            <Plus size={24} className="text-white"/>
          </motion.button>
        </div>
      )}

      {/* -- Трансляции -- */}
      {tab==='live'&&(
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!myActiveStream?(
            <div className="rounded-xl p-5 text-center"
              style={{background:'linear-gradient(135deg,rgba(239,68,68,0.1),rgba(249,115,22,0.07))',border:'1px solid rgba(239,68,68,0.2)'}}>
              <Radio size={32} style={{color:'#ef4444',margin:'0 auto 12px'}}/>
              <p className="font-semibold text-white mb-1">Начни трансляцию</p>
              <p className="text-xs mb-4" style={{color:'var(--t3)'}}>Нужна камера и микрофон</p>
              <motion.button whileTap={{scale:0.97}} type="button" onClick={()=>setStudioOpen(true)}
                className="rounded-2xl px-6 py-3 text-sm font-bold text-white"
                style={{background:'rgba(239,68,68,0.8)'}}>
                🔴 Начать трансляцию
              </motion.button>
            </div>
          ):(
            <div className="rounded-xl p-4" style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)'}}>
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-red-400 animate-pulse"/>
                <p className="font-semibold text-white flex-1">Вы в эфире: {myActiveStream.title}</p>
                <button type="button" onClick={()=>setStudioOpen(true)}
                  className="rounded-2xl px-3 py-1.5 text-xs text-white" style={{background:'rgba(239,68,68,0.8)'}}>
                  Открыть Studio
                </button>
              </div>
            </div>
          )}

          {lives.filter(l=>l.authorId!==currentUserId).length===0&&<p className="text-center text-sm py-12" style={{color:'var(--t3)'}}>Нет активных трансляций</p>}
          <div className="space-y-3">
            {lives.filter(l=>l.authorId!==currentUserId).map(live=>(
              <LiveStreamCard key={live.id} live={live} onClick={()=>setWatchingStreamId(live.id)}/>
            ))}
          </div>
        </div>
      )}

      {/* Overlays */}
      <AnimatePresence>
        {viewerOpen&&viewerGroup.length>0&&(
          <StoryViewer stories={viewerGroup} startIdx={viewerIdx}
            onClose={()=>setViewerOpen(false)} currentUserId={currentUserId!}
            onLike={toggleLike} onDelete={deleteStory}
            onVote={voteOnPoll} onAnswer={answerQuestion} accounts={accounts}/>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {archiveOpen&&archivedStories.length>0&&(
          <StoryViewer stories={archivedStories} startIdx={0}
            onClose={()=>setArchiveOpen(false)} currentUserId={currentUserId!}
            onLike={toggleLike} onDelete={deleteStory}
            onVote={voteOnPoll} onAnswer={answerQuestion} accounts={accounts}/>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {createOpen&&me&&(
          <CreateStory authorId={currentUserId!} authorName={me.name} authorAvatar={me.name[0]}
            onPublish={publishStory} onClose={()=>setCreateOpen(false)}/>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {studioOpen&&(
          <StreamStudio onClose={()=>setStudioOpen(false)}/>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {watchingStreamId&&(
          <StreamView streamId={watchingStreamId} onClose={()=>setWatchingStreamId(null)} onOpenProfile={openProfile}/>
        )}
      </AnimatePresence>
    </div>
  );
};
