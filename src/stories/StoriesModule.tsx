import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, X, Heart, Eye, Radio,
  Camera, Users, Upload,
  Type, Image, Film, Trash2, ChevronLeft, ChevronRight,
  Archive, Languages, Loader2, MapPin, Music
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { apiSearchPeople, apiPeopleByIds, type DirectoryPerson } from '@/core/auth/api';
import { apiFriendsOf } from '@/profile/viewer/friendsApi';
import { useStreamsStore, CATEGORY_LABEL } from '@/streams/store';
import { StreamStudio } from '@/streams/StreamStudio';
import { StreamView } from '@/streams/StreamView';
import { usePlatformStore } from '@/platform/store';
import { apiAiAsk } from '@/ai/aiApi';
import { openProfile } from '@/profile/viewer/store';
import {
  type Story, type StoryKind,
  apiStoriesFeed, apiStoriesArchive, apiStoriesUploadMedia, apiStoriesCreate,
  apiStoriesDelete, apiStoriesLike, apiStoriesView, apiStoriesVote, apiStoriesAnswer,
  apiStoriesCloseFriends, apiStoriesSetCloseFriends,
} from './storiesApi';

// --- Utils -------------------------------------------------------------------
const initial = (name: string) => (name || '?').trim()[0]?.toUpperCase() ?? '?';

const DEMO_BG = [
  'linear-gradient(135deg,#1a0533,#2d1b69)',
  'linear-gradient(135deg,#0f2027,#2c5364)',
  'linear-gradient(135deg,#134e5e,#71b280)',
  'linear-gradient(135deg,#360033,#0b8793)',
  'linear-gradient(135deg,#200122,#6f0000)',
  'linear-gradient(135deg,#0a3d2e,#1b7a54)',
];

const fmtAgo = (ts:number) => {
  const d=(Date.now()-ts)/1000;
  if(d<60)  return 'только что';
  if(d<3600)return `${Math.floor(d/60)} мин`;
  return `${Math.floor(d/3600)} ч`;
};

// --- StoryCircle --------------------------------------------------------------
const StoryCircle = ({ authorName, hasNew, isLive, onClick }:{
  authorName:string; hasNew:boolean; isLive?:boolean; onClick:()=>void;
}) => (
  <motion.button type="button" whileHover={{scale:1.05}} whileTap={{scale:0.95}} onClick={onClick}
    className="flex flex-col items-center gap-1.5">
    <div className="relative">
      <div className="rounded-full p-[2px]" style={{background:hasNew
        ?(isLive?'linear-gradient(135deg,#ef4444,#f97316)':'var(--accent)')
        :'rgba(255,255,255,0.1)'}}>
        <div className="grid h-14 w-14 place-items-center rounded-full text-lg font-bold text-white border-2"
          style={{borderColor:'var(--bg)',background:'var(--bg-l1)'}}>
          {initial(authorName)}
        </div>
      </div>
      {isLive&&<div className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
        style={{background:'#ef4444'}}>LIVE</div>}
    </div>
    <p className="w-16 truncate text-center text-[11px]" style={{color:'var(--t2)'}}>
      {authorName.split(' ')[0]}
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

const StoryViewer = ({ stories, startIdx, onClose, currentUserId, onLike, onDelete, onVote, onAnswer }:{
  stories:Story[]; startIdx:number; onClose:()=>void;
  currentUserId:string; onLike:(id:string)=>void; onDelete:(id:string)=>void;
  onVote:(id:string,optionId:string)=>void; onAnswer:(id:string,text:string)=>void;
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
  const myPollOption = story.poll?.options.find(o=>o.votes.includes(currentUserId));
  const pollTotal = story.poll?.options.reduce((n,o)=>n+o.votes.length,0) ?? 0;
  const showPollResults = !!myPollOption || isOwn;

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
            style={{background:'rgba(255,255,255,0.2)'}}>{initial(story.authorName)}</button>
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
          {story.poll&&(
            <div className="absolute inset-x-6 bottom-28 rounded-2xl p-3.5" style={{background:'rgba(20,20,26,0.85)',backdropFilter:'blur(10px)'}}>
              <p className="text-sm font-bold text-white mb-2.5 text-center">{story.poll.question}</p>
              <div className="space-y-1.5">
                {story.poll.options.map(opt=>{
                  const count = opt.votes.length;
                  const pct = pollTotal>0 ? Math.round(count/pollTotal*100) : 0;
                  return (
                    <button key={opt.id} type="button" disabled={!!myPollOption||isOwn}
                      onClick={()=>onVote(story.id,opt.id)}
                      className="relative w-full rounded-xl overflow-hidden text-left px-3 py-2 text-xs font-semibold text-white"
                      style={{background:'rgba(255,255,255,0.1)'}}>
                      {showPollResults && (
                        <div className="absolute inset-y-0 left-0 rounded-xl" style={{width:`${pct}%`,background:opt.id===myPollOption?.id?'rgba(91,155,209,0.5)':'rgba(255,255,255,0.15)'}}/>
                      )}
                      <span className="relative flex items-center justify-between">
                        {opt.label} {showPollResults && <span>{pct}%</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {story.question&&(
            <div className="absolute inset-x-6 bottom-28 rounded-2xl p-3.5" style={{background:'rgba(20,20,26,0.85)',backdropFilter:'blur(10px)'}}>
              <p className="text-sm font-bold text-white mb-2.5 text-center">{story.question.prompt}</p>
              {isOwn ? (
                <div className="space-y-1.5 max-h-28 overflow-y-auto">
                  {story.question.answers.length===0
                    ? <p className="text-xs text-white/40 text-center">Пока нет ответов</p>
                    : story.question.answers.map(a=>(
                      <div key={a.id} className="rounded-lg px-2.5 py-1.5 text-xs text-white" style={{background:'rgba(255,255,255,0.1)'}}>
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
                  {(story.viewedBy??[]).map(v=>{
                    const didLike = story.likes.includes(v.userId);
                    return (
                      <div key={v.userId} className="flex items-center gap-2.5">
                        <div className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold text-white shrink-0" style={{background:'rgba(255,255,255,0.15)'}}>
                          {initial(v.userName)}
                        </div>
                        <span className="text-sm text-white flex-1 truncate">{v.userName}</span>
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

// --- CloseFriendsEditor --------------------------------------------------------
const CloseFriendsEditor = ({ myId, onClose }:{ myId:string; onClose:()=>void }) => {
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<DirectoryPerson[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(()=>{
    let cancelled = false;
    (async ()=>{
      const [friendsOf, current] = await Promise.all([apiFriendsOf(myId), apiStoriesCloseFriends()]);
      const ids = friendsOf?.friendIds ?? [];
      const people = ids.length ? (await apiPeopleByIds(ids)).data?.people ?? [] : [];
      if (cancelled) return;
      setCandidates(people);
      setSelected(new Set(current));
      setLoading(false);
    })();
    return ()=>{ cancelled = true; };
  },[myId]);

  const toggle = (id:string) => setSelected(s=>{
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const save = async () => {
    setSaving(true);
    await apiStoriesSetCloseFriends([...selected]);
    setSaving(false);
    onClose();
  };

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      style={{position:'fixed',inset:0,zIndex:10000,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
      onClick={onClose}>
      <motion.div initial={{scale:0.95,y:10}} animate={{scale:1,y:0}} onClick={e=>e.stopPropagation()}
        className="w-full max-w-sm max-h-[70vh] overflow-hidden rounded-2xl flex flex-col"
        style={{background:'var(--bg-l1)',border:'1px solid rgba(255,255,255,0.1)'}}>
        <div className="flex items-center justify-between p-4 pb-2">
          <p className="font-bold text-white">Близкие друзья</p>
          <button type="button" onClick={onClose} style={{color:'var(--t3)'}}><X size={18}/></button>
        </div>
        <p className="px-4 pb-3 text-xs" style={{color:'var(--t3)'}}>
          Истории с видимостью «Близкие друзья» увидят только выбранные ниже — из ваших подтверждённых друзей.
        </p>
        <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-1">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin" style={{color:'var(--accent)'}}/></div>
          ) : candidates.length===0 ? (
            <p className="text-sm text-center py-8" style={{color:'var(--t3)'}}>
              У вас пока нет друзей, кого можно добавить — сначала подружитесь с кем-нибудь в профиле.
            </p>
          ) : candidates.map(p=>(
            <button key={p.id} type="button" onClick={()=>toggle(p.id)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/5">
              <div className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white shrink-0"
                style={{background:'rgba(255,255,255,0.15)'}}>{initial(p.name)}</div>
              <span className="flex-1 truncate text-sm text-white">{p.name}</span>
              <div className="grid h-5 w-5 place-items-center rounded-md border-2"
                style={{borderColor:selected.has(p.id)?'var(--accent)':'var(--border)',background:selected.has(p.id)?'var(--accent)':'transparent'}}>
                {selected.has(p.id)&&<span className="text-white text-xs font-bold">✓</span>}
              </div>
            </button>
          ))}
        </div>
        <div className="p-4 pt-2">
          <button type="button" onClick={save} disabled={saving||loading}
            className="w-full rounded-2xl py-2.5 text-sm font-bold text-white disabled:opacity-50"
            style={{background:'var(--accent)'}}>
            {saving?'Сохраняем...':`Готово (${selected.size})`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// --- CreateStory --------------------------------------------------------------
const CreateStory = ({ onPublished, onClose }:{ onPublished:()=>void; onClose:()=>void }) => {
  const { currentUserId } = useAuthStore();
  const [kind, setKind] = useState<StoryKind>('text');
  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState<string|undefined>();
  const [mediaFile, setMediaFile] = useState<File|undefined>();
  const [bg, setBg] = useState(DEMO_BG[0]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [visibility, setVisibility] = useState<'all'|'closeFriends'>('all');
  const [showCFEditor, setShowCFEditor] = useState(false);
  const [musicTrackId, setMusicTrackId] = useState<string|undefined>();
  const [showMusicPicker, setShowMusicPicker] = useState(false);
  const [location, setLocation] = useState('');
  const [translating, setTranslating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const tracks = usePlatformStore(s=>s.tracks);
  const pickedTrack = tracks.find(t=>t.id===musicTrackId);

  const translateText = async () => {
    const t = text.trim(); if(!t) return;
    setTranslating(true);
    try {
      const r = await apiAiAsk('translate', t, /[а-яё]/i.test(t) ? 'English' : 'Русский');
      if (r.ok) setText(r.text);
    } catch { /* сеть/лимит — оставляем исходный текст */ }
    setTranslating(false);
  };

  const handleFile = (e:React.ChangeEvent<HTMLInputElement>)=>{
    const f=e.target.files?.[0]; if(!f) return;
    setMediaUrl(prev=>{ if(prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(f); });
    setKind(f.type.startsWith('video')?'video':'photo');
    setMediaFile(f);
  };

  // Упоминания — реальные люди, найденные на сервере по @username,
  // а не что попало из локального списка аккаунтов этого браузера.
  const resolveMentions = async (body: string): Promise<string[]> => {
    const names = [...new Set([...body.matchAll(/@(\w+)/g)].map(m=>m[1].toLowerCase()))];
    if (!names.length) return [];
    const ids: string[] = [];
    for (const uname of names) {
      const r = await apiSearchPeople(uname);
      const hit = r.ok ? r.data?.people.find(p=>p.username.toLowerCase()===uname) : undefined;
      if (hit) ids.push(hit.id);
    }
    return ids;
  };

  const publish = async () => {
    if(!text.trim()&&!mediaFile) return;
    setPublishing(true);
    setError(null);
    try {
      let mediaId: string|undefined;
      let mediaMime: string|undefined;
      if (mediaFile) {
        const uploaded = await apiStoriesUploadMedia(mediaFile);
        if (!uploaded) { setError('Не получилось загрузить файл.'); return; }
        mediaId = uploaded.mediaId; mediaMime = uploaded.mime;
      }
      const mentions = await resolveMentions(text);
      const r = await apiStoriesCreate({
        text: text.trim() || undefined,
        mediaId, mediaMime, bg, visibility,
        mentions: mentions.length ? mentions : undefined,
        musicTrackId, location: location.trim() || undefined,
      });
      if ('error' in r) { setError('Не получилось опубликовать историю.'); return; }
      onPublished();
    } finally {
      setPublishing(false);
    }
  };

  const canPublish = !!(text.trim()||mediaFile);

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
            <button key={k} type="button" onClick={()=>{setKind(k);setMediaUrl(undefined);setMediaFile(undefined);}}
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
        <div className="px-5 pb-2 flex gap-2">
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
        {visibility==='closeFriends' && currentUserId && (
          <div className="px-5 pb-4">
            <button type="button" onClick={()=>setShowCFEditor(true)}
              className="w-full text-center text-xs font-medium py-1.5" style={{color:'var(--accent)'}}>
              Настроить список близких друзей
            </button>
          </div>
        )}

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
        {error && <p className="px-5 pb-4 -mt-2 text-xs" style={{color:'var(--red)'}}>{error}</p>}
      </motion.div>
      <AnimatePresence>
        {showCFEditor && currentUserId && (
          <CloseFriendsEditor myId={currentUserId} onClose={()=>setShowCFEditor(false)}/>
        )}
      </AnimatePresence>
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
          <Users size={12}/><span className="text-xs">{live.viewerCount}</span>
        </div>
      </div>
      <p className="text-sm font-semibold text-white truncate mb-1">{live.title}</p>
      <p className="text-xs" style={{color:'var(--t3)'}}>{CATEGORY_LABEL[live.category]}</p>
    </div>
  </motion.button>
);

// --- Главный модуль -----------------------------------------------------------
const FEED_POLL_MS = 20_000;

export const StoriesModule = () => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a=>a.id===currentUserId);

  const [stories, setStories] = useState<Story[]>([]);
  const [archivedStories, setArchivedStories] = useState<Story[]>([]);
  const [tab, setTab] = useState<'stories'|'live'>('stories');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIdx, setViewerIdx] = useState(0);
  const [viewerAuthorId, setViewerAuthorId] = useState<string|null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [watchingStreamId, setWatchingStreamId] = useState<string|null>(null);
  const liveStreamsMap = useStreamsStore(s=>s.streams);
  const loadStreamsList = useStreamsStore(s=>s.loadList);
  const lives = useMemo(()=>Object.values(liveStreamsMap).filter(l=>!l.ended).sort((a,b)=>b.startedAt-a.startedAt),[liveStreamsMap]);
  const myActiveStream = lives.find(l=>l.authorId===currentUserId);

  const refresh = useCallback(async () => {
    setStories(await apiStoriesFeed());
  }, []);

  useEffect(()=>{
    void refresh();
    void (async () => setArchivedStories(await apiStoriesArchive()))();
    const id = window.setInterval(refresh, FEED_POLL_MS);
    return () => clearInterval(id);
  },[refresh]);

  // Трансляции — реестр с сервера, не BroadcastChannel: видно с любого
  // устройства и от любого человека, не только соседняя вкладка.
  useEffect(()=>{
    void loadStreamsList();
    const id = window.setInterval(loadStreamsList, FEED_POLL_MS);
    return () => clearInterval(id);
  },[loadStreamsList]);

  const grouped = useMemo(()=>{
    const map=new Map<string,Story[]>();
    stories.forEach(s=>{const arr=map.get(s.authorId)??[];arr.push(s);map.set(s.authorId,arr);});
    return Array.from(map.entries()).map(([id,ss])=>({
      authorId:id, authorName:ss[0].authorName,
      stories:ss, hasNew:ss.some(s=>!s.viewed),
    }));
  },[stories]);

  const myStoriesGroup = grouped.find(g=>g.authorId===currentUserId);
  const viewerGroup = useMemo(
    ()=> viewerAuthorId ? stories.filter(s=>s.authorId===viewerAuthorId) : [],
    [stories,viewerAuthorId],
  );

  const openStories=(authorId:string)=>{
    const group = stories.filter(s=>s.authorId===authorId);
    if(!group.length) return;
    setViewerAuthorId(authorId);setViewerIdx(0);setViewerOpen(true);
    const uid = currentUserId;
    if (!uid) return;
    for (const s of group) if (!s.viewed) void apiStoriesView(s.id);
    setStories(ss=>ss.map(s=>{
      if (s.authorId!==authorId || s.viewed) return s;
      return { ...s, viewed:true, views: s.authorId===uid ? s.views : s.views+1 };
    }));
  };

  /** Применяет изменение и к живой ленте, и к архиву — своя история
   *  может быть открыта в любом из двух просмотрщиков. */
  const patchStory = (id:string, updater:(s:Story)=>Story) => {
    const apply = (s:Story) => s.id===id ? updater(s) : s;
    setStories(ss=>ss.map(apply));
    setArchivedStories(ss=>ss.map(apply));
  };

  const publishStory = () => {
    setCreateOpen(false);
    void refresh();
  };

  const deleteStory = async (id:string) => {
    const ok = await apiStoriesDelete(id);
    if (!ok) return;
    setStories(ss=>ss.filter(s=>s.id!==id));
    setArchivedStories(ss=>ss.filter(s=>s.id!==id));
  };

  const toggleLike = async (storyId:string) => {
    const liked = await apiStoriesLike(storyId);
    if (liked===null || !currentUserId) return;
    patchStory(storyId, s=>({
      ...s,
      likes: liked ? [...s.likes,currentUserId] : s.likes.filter(l=>l!==currentUserId),
    }));
  };

  const voteOnPoll = async (storyId:string, optionId:string) => {
    const ok = await apiStoriesVote(storyId, optionId);
    if (!ok || !currentUserId) return;
    patchStory(storyId, s=>!s.poll ? s : ({
      ...s,
      poll: { ...s.poll, options: s.poll.options.map(o=>o.id===optionId ? { ...o, votes:[...o.votes,currentUserId] } : o) },
    }));
  };

  const answerQuestion = async (storyId:string, text:string) => {
    const r = await apiStoriesAnswer(storyId, text);
    if (!r || !currentUserId) return;
    const myName = me?.name ?? 'Кто-то';
    patchStory(storyId, s=>!s.question ? s : ({
      ...s,
      question: { ...s.question, answers:[...s.question.answers,{id:r.id,userId:currentUserId,userName:myName,text,createdAt:Date.now()}] },
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
                onClick={()=>myStoriesGroup?openStories(myStoriesGroup.authorId):setCreateOpen(true)}
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
              <StoryCircle key={g.authorId} authorName={g.authorName} hasNew={g.hasNew} isLive={false}
                onClick={()=>openStories(g.authorId)}/>
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
                    onClick={()=>openStories(s.authorId)}>
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
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-white"/> Начать трансляцию
                </span>
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
            onVote={voteOnPoll} onAnswer={answerQuestion}/>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {archiveOpen&&archivedStories.length>0&&(
          <StoryViewer stories={archivedStories} startIdx={0}
            onClose={()=>setArchiveOpen(false)} currentUserId={currentUserId!}
            onLike={toggleLike} onDelete={deleteStory}
            onVote={voteOnPoll} onAnswer={answerQuestion}/>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {createOpen&&me&&(
          <CreateStory onPublished={publishStory} onClose={()=>setCreateOpen(false)}/>
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
