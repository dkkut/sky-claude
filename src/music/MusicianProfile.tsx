/* ================================================================
   MUSICIAN PROFILE — профиль музыканта + настройки + статистика
================================================================ */
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music2, Users, Play, Heart, BarChart3, Upload, Check, Edit3,
  X, Camera, Plus, Minus, TrendingUp, Headphones, Star, Share2,
  ChevronLeft, Mic2, Globe, Lock,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { usePlatformStore } from '@/platform/store';

/* ── design tokens ── */
const YM = { bg:'#0a0a0f', card:'var(--bg-l2)', border:'var(--border)',
  accent:'var(--accent)', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  green:'var(--green)', red:'var(--red)', amber:'var(--amber)' };

const fu = (i=0) => ({
  initial:{opacity:0,y:14}, animate:{opacity:1,y:0},
  transition:{duration:.3,delay:i*.07,ease:[.22,1,.36,1] as any},
});

const fmtPlays = (n:number) => n>=1_000_000?`${(n/1_000_000).toFixed(1)}М`:n>=1_000?`${(n/1_000).toFixed(1)}К`:String(n);
const fmtAgo = (iso:string) => { const d=Math.floor((Date.now()-new Date(iso).getTime())/86400000); return d===0?'Сегодня':d===1?'Вчера':`${d} дн.`; };

/* ── Track row ── */
const TrackRow = ({ track, index, playing, activeId, onPlay, onLike, liked }:
  { track:any; index:number; playing:boolean; activeId:string|null; onPlay:()=>void; onLike:()=>void; liked:boolean }) => {
  const isActive = activeId === track.id;
  const [hov, setHov] = useState(false);
  const _hue = (track.id?.charCodeAt(0) ?? 200) * 47 % 360;
  const g1 = `hsl(${_hue},55%,28%)`, g2 = `hsl(${(_hue+50)%360},45%,18%)`;
  return (
    <motion.div {...fu(index)}
      className="flex items-center gap-3 px-4 py-2.5 rounded-2xl group cursor-pointer"
      style={{ background: hov||isActive ? 'rgba(255,255,255,.04)':'transparent', transition:'background .15s' }}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      onClick={onPlay}>
      {/* Cover / index */}
      <div className="relative shrink-0 rounded-xl overflow-hidden" style={{ width:40, height:40,
        background:`linear-gradient(135deg,${g1},${g2})` }}>
        {track.coverUrl && <img src={track.coverUrl} alt="" className="w-full h-full object-cover"/>}
        {(hov||isActive) && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            {isActive && playing
              ? <div className="flex gap-0.5 items-end h-4">{[1,.6,.8].map((h,i)=>(
                  <div key={i} style={{ width:2, height:`${h*100}%`, background:'#fff',
                    animation:`barBeat .8s ${i*.15}s ease-in-out infinite` }}/>))}</div>
              : <Play size={14} className="text-white ml-0.5"/>}
          </div>
        )}
        {isActive && !hov && (
          <div className="absolute bottom-0.5 left-0 right-0 flex justify-center gap-0.5 items-end h-3">
            {[1,.6,.8].map((h,i)=>(
              <div key={i} style={{ width:2, height:`${h*100}%`, background:YM.accent,
                animation:`barBeat .8s ${i*.15}s ease-in-out infinite` }}/>))}
          </div>
        )}
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold truncate"
          style={{ color: isActive ? YM.accent : YM.t1 }}>{track.title}</p>
        <p className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color:YM.t3 }}>
          <Headphones size={10}/>{fmtPlays(track.plays)}
          <span>·</span>{track.duration}
          <span>·</span>{track.genre}
        </p>
      </div>
      {/* Like */}
      <motion.button whileTap={{scale:.85}} type="button"
        onClick={e=>{e.stopPropagation();onLike();}}
        className="grid h-7 w-7 place-items-center rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
        style={{ color: liked?'#ef4444':YM.t3 }}>
        <Heart size={14} fill={liked?'#ef4444':'none'}/>
      </motion.button>
      <span className="text-[11px] tabular-nums shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
        style={{ color:YM.t3, fontFamily:'DM Mono,monospace' }}>{track.duration}</span>
    </motion.div>
  );
};

/* ── Edit musician profile form ── */
const EditMusicianForm = ({ onClose }:{ onClose:()=>void }) => {
  const { accounts, currentUserId, updateMusicianProfile } = useAuthStore();
  const me = accounts.find(a=>a.id===currentUserId);
  if(!me) return null;

  const [name,    setName]   = useState(me.artistName ?? me.name);
  const [bio,     setBio]    = useState(me.artistBio ?? '');
  const [genres,  setGenres] = useState<string[]>(me.artistGenres ?? []);
  const [banner,  setBanner] = useState<string|undefined>(me.artistBanner);
  const [avatar,  setAvatar] = useState<string|undefined>(me.artistAvatar ?? me.avatar);
  const [saved,   setSaved]  = useState(false);
  const bannerRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  const ALL_GENRES = ['Pop','Rock','Electronic','Hip-Hop','Jazz','Classical','Ambient','Synthwave','Indie','Soul','R&B','Folk','Metal','Другое'];

  const readFile = (f:File, cb:(url:string)=>void) => {
    const r = new FileReader(); r.onload = ()=>cb(r.result as string); r.readAsDataURL(f);
  };

  const save = () => {
    updateMusicianProfile(me.id,{ isMusician:true, artistName:name.trim(), artistBio:bio.trim(), artistBanner:banner, artistAvatar:avatar, artistGenres:genres });
    setSaved(true); setTimeout(()=>{ setSaved(false); onClose(); },800);
  };

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background:'rgba(0,0,0,.8)', backdropFilter:'blur(12px)' }}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <motion.div initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{y:40,opacity:0}}
        transition={{type:'spring',stiffness:380,damping:34}}
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        style={{ background:'var(--bg-l1)', border:'1px solid var(--border-m)', maxHeight:'90dvh' }}>

        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
          <p className="text-base font-black" style={{ color:YM.t1 }}>Профиль музыканта</p>
          <button type="button" onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/8"
            style={{ background:'var(--bg-l3)', border:'none', cursor:'pointer', color:YM.t3 }}>
            <X size={15}/>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-4" style={{ scrollbarWidth:'none' }}>
          {/* Banner */}
          <div className="relative rounded-2xl overflow-hidden cursor-pointer group" style={{ height:100 }}
            onClick={()=>bannerRef.current?.click()}>
            <input ref={bannerRef} type="file" accept="image/*" className="hidden"
              onChange={e=>{const f=e.target.files?.[0];if(f)readFile(f,setBanner);}}/>
            <div className="w-full h-full"
              style={{ background: banner ? undefined : 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
              {banner && <img src={banner} alt="" className="w-full h-full object-cover"/>}
            </div>
            <div className="absolute inset-0 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
              style={{ background:'rgba(0,0,0,.5)' }}>
              <Camera size={20} className="text-white"/>
            </div>
            <p className="absolute bottom-2 right-3 text-[10px] font-bold text-white/60">Баннер</p>
          </div>

          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative cursor-pointer group" onClick={()=>avatarRef.current?.click()}>
              <input ref={avatarRef} type="file" accept="image/*" className="hidden"
                onChange={e=>{const f=e.target.files?.[0];if(f)readFile(f,setAvatar);}}/>
              <div className="h-16 w-16 rounded-2xl overflow-hidden grid place-items-center"
                style={{ background:'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                {avatar
                  ? <img src={avatar} alt="" className="w-full h-full object-cover"/>
                  : <span className="text-2xl font-black text-white">{(me.artistName??me.name)[0]}</span>}
              </div>
              <div className="absolute inset-0 rounded-2xl flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                style={{ background:'rgba(0,0,0,.5)' }}>
                <Camera size={16} className="text-white"/>
              </div>
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color:YM.t1 }}>Фото артиста</p>
              <p className="text-xs mt-0.5" style={{ color:YM.t3 }}>JPG · PNG · WebP</p>
            </div>
          </div>

          {/* Name */}
          <div>
            <p className="text-xs font-bold mb-1.5" style={{ color:YM.t3 }}>Имя исполнителя *</p>
            <input value={name} onChange={e=>setName(e.target.value)}
              placeholder="Твой артистический псевдоним"
              className="w-full rounded-2xl px-4 py-2.5 text-sm outline-none"
              style={{ background:'var(--bg-l2)', border:'1px solid var(--border-m)', color:YM.t1 }}/>
          </div>

          {/* Bio */}
          <div>
            <p className="text-xs font-bold mb-1.5" style={{ color:YM.t3 }}>О себе</p>
            <textarea value={bio} onChange={e=>setBio(e.target.value)} rows={3}
              placeholder="Расскажи о своей музыке..."
              className="w-full rounded-2xl px-4 py-2.5 text-sm outline-none resize-none"
              style={{ background:'var(--bg-l2)', border:'1px solid var(--border-m)', color:YM.t1 }}/>
          </div>

          {/* Genres */}
          <div>
            <p className="text-xs font-bold mb-2" style={{ color:YM.t3 }}>Жанры (до 3)</p>
            <div className="flex flex-wrap gap-2">
              {ALL_GENRES.map(g=>{
                const sel = genres.includes(g);
                return (
                  <button key={g} type="button"
                    onClick={()=>setGenres(prev=>sel?prev.filter(x=>x!==g):prev.length<3?[...prev,g]:prev)}
                    className="rounded-full px-3 py-1 text-[11px] font-semibold transition-all"
                    style={{ background:sel?YM.accent:'var(--bg-l3)',
                      color:sel?'#fff':'var(--t2)', border:`1px solid ${sel?'transparent':'var(--border)'}`,
                      cursor:'pointer', opacity:!sel&&genres.length>=3?.4:1 }}>
                    {g}
                  </button>
                );
              })}
            </div>
          </div>

          {saved && (
            <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
              style={{ background:'rgba(52,211,153,.08)', border:'1px solid rgba(52,211,153,.2)', color:'var(--green)' }}>
              <Check size={14}/>Сохранено!
            </motion.div>
          )}

          <motion.button whileTap={{scale:.97}} type="button" onClick={save}
            disabled={!name.trim()}
            className="w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black disabled:opacity-40"
            style={{ background:YM.accent, color:'#fff', border:'none', cursor:'pointer' }}>
            <Mic2 size={15}/>Сохранить профиль
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};

/* ════════════════════════════════════════════════════════
   MUSICIAN PROFILE PAGE  — вкладка «Мой профиль»
════════════════════════════════════════════════════════ */
export const MusicianProfileTab = ({
  playing, activeId, onPlay, onLike, favorites,
}:{
  playing:boolean; activeId:string|null; favorites:string[];
  onPlay:(t:any,pool:any[])=>void; onLike:(id:string)=>void;
}) => {
  const { accounts, currentUserId, followArtist, unfollowArtist } = useAuthStore();
  const { tracks } = usePlatformStore();
  const me = accounts.find(a=>a.id===currentUserId);
  const [editOpen, setEditOpen] = useState(false);
  const [viewArtist, setViewArtist] = useState<string|null>(null);
  const [artistTab, setArtistTab] = useState<'tracks'|'stats'>('tracks');

  /* ── My tracks ── */
  const myTracks = tracks.filter(t=>t.uploadedBy===currentUserId && t.status==='published');
  const totalPlays = myTracks.reduce((s,t)=>s+t.plays,0);
  const totalLikes = myTracks.reduce((s,t)=>s+t.likes.length,0);
  const followers  = me?.artistFollowers?.length ?? 0;

  /* ── Other artist profiles ── */
  const artists = accounts.filter(a=>a.isMusician && a.id !== currentUserId);

  /* ── View another artist ── */
  if(viewArtist) {
    const artist = accounts.find(a=>a.id===viewArtist);
    if(!artist) { setViewArtist(null); return null; }
    const artTracks = tracks.filter(t=>t.uploadedBy===viewArtist && t.status==='published');
    const isFollowing = (me?.artistFollowers ?? []).length > 0 ||
      (artist.artistFollowers??[]).includes(currentUserId??'');
    const iFollow = (artist.artistFollowers??[]).includes(currentUserId??'');

    return (
      <div className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth:'none' }}>
        {/* Banner */}
        <div className="relative shrink-0" style={{ height:140 }}>
          <div className="w-full h-full"
            style={{ background: artist.artistBanner ? undefined : 'linear-gradient(135deg,#1e1b4b,#312e81)' }}>
            {artist.artistBanner && <img src={artist.artistBanner} alt="" className="w-full h-full object-cover"/>}
          </div>
          <div className="absolute inset-0" style={{ background:'linear-gradient(transparent 40%,rgba(10,10,15,.95))' }}/>
          <button type="button" onClick={()=>setViewArtist(null)}
            className="absolute top-3 left-3 grid h-8 w-8 place-items-center rounded-full"
            style={{ background:'rgba(0,0,0,.6)', backdropFilter:'blur(8px)', border:'none', cursor:'pointer', color:'#fff' }}>
            <ChevronLeft size={16}/>
          </button>
        </div>

        {/* Profile row */}
        <div className="px-4 -mt-10 pb-4 flex items-end gap-4 relative z-10">
          <div className="h-20 w-20 rounded-2xl overflow-hidden shrink-0"
            style={{ border:'3px solid #0a0a0f', background:'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow:'0 8px 24px rgba(0,0,0,.6)' }}>
            {artist.artistAvatar
              ? <img src={artist.artistAvatar} alt="" className="w-full h-full object-cover"/>
              : <div className="w-full h-full grid place-items-center text-3xl font-black text-white">{(artist.artistName??artist.name)[0]}</div>}
          </div>
          <div className="flex-1 min-w-0 pb-1">
            <p className="text-lg font-black text-white truncate">{artist.artistName ?? artist.name}</p>
            {artist.artistGenres?.length ? (
              <p className="text-[11px] mt-0.5" style={{ color:YM.t3 }}>{artist.artistGenres.join(' · ')}</p>
            ) : null}
          </div>
          <motion.button whileTap={{scale:.93}} type="button"
            onClick={()=>iFollow ? unfollowArtist(currentUserId!,artist.id) : followArtist(currentUserId!,artist.id)}
            className="shrink-0 rounded-2xl px-4 py-2 text-xs font-black mb-1"
            style={{ background:iFollow?'var(--bg-l3)':YM.accent, color:iFollow?YM.t2:'#fff',
              border:`1px solid ${iFollow?'var(--border)':'transparent'}`, cursor:'pointer' }}>
            {iFollow ? 'Подписан ✓' : '+ Подписаться'}
          </motion.button>
        </div>

        {/* Bio */}
        {artist.artistBio && (
          <p className="px-4 pb-4 text-[13px] leading-relaxed" style={{ color:YM.t2 }}>{artist.artistBio}</p>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 px-4 mb-4">
          {[
            { label:'Треков', val:artTracks.length, icon:Music2, color:'#6366f1' },
            { label:'Прослушиваний', val:fmtPlays(artTracks.reduce((s,t)=>s+t.plays,0)), icon:Headphones, color:'#22d3ee' },
            { label:'Подписчиков', val:artist.artistFollowers?.length??0, icon:Users, color:'#f43f5e' },
          ].map(({label,val,icon:Icon,color})=>(
            <div key={label} className="rounded-2xl px-3 py-3 text-center"
              style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
              <Icon size={14} className="mx-auto mb-1" style={{ color }}/>
              <p className="text-base font-black" style={{ color:YM.t1 }}>{val}</p>
              <p className="text-[9px] mt-0.5" style={{ color:YM.t3 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Tracks */}
        <div className="px-4 pb-2">
          <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color:YM.t3 }}>Треки</p>
        </div>
        {artTracks.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2 opacity-40">
            <Music2 size={24} style={{ color:YM.t3 }}/><p className="text-sm" style={{ color:YM.t2 }}>Нет треков</p>
          </div>
        ) : artTracks.map((t,i)=>(
          <TrackRow key={t.id} track={t} index={i} playing={playing} activeId={activeId}
            onPlay={()=>onPlay(t,artTracks)} onLike={()=>onLike(t.id)}
            liked={favorites.includes(t.id)}/>
        ))}
        <div className="h-8"/>
      </div>
    );
  }

  /* ── My profile view ── */
  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth:'none' }}>
      <AnimatePresence>{editOpen && <EditMusicianForm onClose={()=>setEditOpen(false)}/>}</AnimatePresence>

      {me?.isMusician ? (
        <>
          {/* ── My artist banner ── */}
          <div className="relative shrink-0" style={{ height:130 }}>
            <div className="w-full h-full"
              style={{ background: me.artistBanner ? undefined : 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
              {me.artistBanner && <img src={me.artistBanner} alt="" className="w-full h-full object-cover"/>}
            </div>
            <div className="absolute inset-0" style={{ background:'linear-gradient(transparent 35%,rgba(10,10,15,.95))' }}/>
            <button type="button" onClick={()=>setEditOpen(true)}
              className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold"
              style={{ background:'rgba(0,0,0,.6)', backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,.12)', cursor:'pointer', color:'#fff' }}>
              <Edit3 size={11}/>Редактировать
            </button>
          </div>

          {/* Profile row */}
          <div className="px-4 -mt-10 pb-4 flex items-end gap-4 relative z-10">
            <div className="h-20 w-20 rounded-2xl overflow-hidden shrink-0"
              style={{ border:'3px solid #0a0a0f', background:'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow:'0 8px 24px rgba(0,0,0,.5)' }}>
              {me.artistAvatar
                ? <img src={me.artistAvatar} alt="" className="w-full h-full object-cover"/>
                : <div className="w-full h-full grid place-items-center text-3xl font-black text-white">{(me.artistName??me.name)[0]}</div>}
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <p className="text-xl font-black text-white truncate">{me.artistName ?? me.name}</p>
              {me.artistGenres?.length
                ? <p className="text-[11px] mt-0.5" style={{ color:YM.t3 }}>{me.artistGenres.join(' · ')}</p>
                : <p className="text-[11px] mt-0.5" style={{ color:YM.t3 }}>Музыкант</p>}
            </div>
          </div>

          {me.artistBio && (
            <motion.p {...fu(0)} className="px-4 pb-3 text-[13px] leading-relaxed" style={{ color:YM.t2 }}>
              {me.artistBio}
            </motion.p>
          )}

          {/* Stats */}
          <motion.div {...fu(1)} className="grid grid-cols-3 gap-2 px-4 mb-5">
            {[
              { label:'Треков',          val:myTracks.length,    icon:Music2,     color:'#6366f1' },
              { label:'Прослушиваний',   val:fmtPlays(totalPlays),icon:Headphones, color:'#22d3ee' },
              { label:'Подписчиков',     val:followers,           icon:Users,      color:'#f43f5e' },
            ].map(({label,val,icon:Icon,color})=>(
              <div key={label} className="rounded-2xl px-3 py-3 text-center"
                style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
                <Icon size={14} className="mx-auto mb-1.5" style={{ color }}/>
                <p className="text-base font-black" style={{ color:YM.t1 }}>{val}</p>
                <p className="text-[9px] mt-0.5" style={{ color:YM.t3 }}>{label}</p>
              </div>
            ))}
          </motion.div>

          {/* Tabs */}
          <div className="flex gap-1 px-4 mb-4">
            {([['tracks','Мои треки'],['stats','Статистика']] as const).map(([k,l])=>(
              <button key={k} type="button" onClick={()=>setArtistTab(k)}
                className="rounded-xl px-4 py-2 text-[11px] font-bold transition-all"
                style={{ background:artistTab===k?YM.accent:'var(--bg-l2)',
                  color:artistTab===k?'#fff':YM.t3, border:'none', cursor:'pointer' }}>
                {l}
              </button>
            ))}
          </div>

          {artistTab==='tracks' && (
            myTracks.length===0 ? (
              <div className="flex flex-col items-center py-12 gap-3 opacity-50">
                <Music2 size={28} style={{ color:YM.t3 }}/>
                <p className="text-sm" style={{ color:YM.t2 }}>Нет опубликованных треков</p>
                <p className="text-xs text-center px-8" style={{ color:YM.t3 }}>Загрузи первый трек во вкладке «Загрузить»</p>
              </div>
            ) : myTracks.map((t,i)=>(
              <TrackRow key={t.id} track={t} index={i} playing={playing} activeId={activeId}
                onPlay={()=>onPlay(t,myTracks)} onLike={()=>onLike(t.id)}
                liked={favorites.includes(t.id)}/>
            ))
          )}

          {artistTab==='stats' && (
            <div className="px-4 space-y-3 pb-8">
              <div className="rounded-2xl p-4" style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
                <p className="text-[10px] font-black uppercase tracking-wider mb-4" style={{ color:YM.t3 }}>Топ треков</p>
                {myTracks.sort((a,b)=>b.plays-a.plays).slice(0,5).map((t,i)=>{
                  const pct = totalPlays > 0 ? (t.plays/totalPlays)*100 : 0;
                  return (
                    <div key={t.id} className={i>0?'mt-3':''}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-semibold truncate max-w-[60%]" style={{ color:YM.t1 }}>{t.title}</span>
                        <span className="text-[11px]" style={{ color:YM.t3 }}>{fmtPlays(t.plays)} прослуш.</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,.06)' }}>
                        <motion.div initial={{width:0}} animate={{width:`${pct}%`}}
                          transition={{delay:.1+i*.08,duration:.6,ease:[.22,1,.36,1]}}
                          style={{ height:'100%', background:`linear-gradient(90deg,${YM.accent},#818cf8)`, borderRadius:2 }}/>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Revenue hint */}
              <div className="rounded-2xl p-4" style={{ background:'rgba(245,158,11,.06)', border:'1px solid rgba(245,158,11,.15)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={14} style={{ color:YM.amber }}/>
                  <p className="text-sm font-bold" style={{ color:YM.t1 }}>Монетизация</p>
                </div>
                <p className="text-[12px] leading-relaxed mb-3" style={{ color:YM.t2 }}>
                  Включи монетизацию в Sky Studio, чтобы зарабатывать на своей музыке.
                </p>
                <p className="text-[11px]" style={{ color:YM.t3 }}>
                  Доход · Подписки · Донаты → <span style={{ color:YM.accent }}>Studio</span>
                </p>
              </div>
            </div>
          )}
        </>
      ) : (
        /* ── Not musician yet ── */
        <div className="flex flex-col items-center justify-center flex-1 px-8 py-12 text-center gap-6">
          <motion.div {...fu(0)}
            className="h-24 w-24 rounded-3xl grid place-items-center"
            style={{ background:'linear-gradient(135deg,rgba(99,102,241,.2),rgba(168,85,247,.15))', border:'1px solid rgba(99,102,241,.25)' }}>
            <Mic2 size={40} style={{ color:'#6366f1' }}/>
          </motion.div>
          <motion.div {...fu(1)}>
            <p className="text-xl font-black text-white mb-2">Стань музыкантом</p>
            <p className="text-[13px] leading-relaxed" style={{ color:YM.t2 }}>
              Создай профиль артиста, загружай свою музыку и расти вместе со Sky
            </p>
          </motion.div>
          <motion.div {...fu(2)} className="w-full space-y-2.5">
            {['✦ Профиль исполнителя с аватаром и баннером','🎵 Публикация треков и статистика','💰 Монетизация через Sky Studio','👥 Подписчики и аналитика'].map((f,i)=>(
              <div key={i} className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left"
                style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
                <p className="text-[12px]" style={{ color:YM.t1 }}>{f}</p>
              </div>
            ))}
          </motion.div>
          <motion.button {...fu(3)} whileTap={{scale:.97}} type="button" onClick={()=>setEditOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-black"
            style={{ background:YM.accent, color:'#fff', border:'none', cursor:'pointer',
              boxShadow:`0 8px 28px ${YM.accent}44` }}>
            <Mic2 size={16}/>Создать профиль музыканта
          </motion.button>
        </div>
      )}

      {/* ── Other musicians ── */}
      {artists.length > 0 && (
        <motion.div {...fu(4)} className="px-4 pb-8 mt-4">
          <p className="text-[10px] font-black uppercase tracking-wider mb-3" style={{ color:YM.t3 }}>
            Музыканты Sky
          </p>
          <div className="space-y-2">
            {artists.map((a,i)=>{
              const artTracks = tracks.filter(t=>t.uploadedBy===a.id&&t.status==='published');
              const iFollow = (a.artistFollowers??[]).includes(currentUserId??'');
              return (
                <motion.div key={a.id} {...fu(i)}
                  className="flex items-center gap-3 rounded-2xl px-4 py-3 cursor-pointer hover:bg-white/4 transition-colors"
                  style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}
                  onClick={()=>setViewArtist(a.id)}>
                  <div className="h-11 w-11 rounded-xl overflow-hidden shrink-0"
                    style={{ background:'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                    {a.artistAvatar
                      ? <img src={a.artistAvatar} alt="" className="w-full h-full object-cover"/>
                      : <div className="w-full h-full grid place-items-center text-lg font-black text-white">{(a.artistName??a.name)[0]}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold truncate" style={{ color:YM.t1 }}>{a.artistName??a.name}</p>
                    <p className="text-[11px] mt-0.5" style={{ color:YM.t3 }}>
                      {artTracks.length} треков · {a.artistFollowers?.length??0} подп.
                    </p>
                  </div>
                  <button type="button"
                    onClick={e=>{e.stopPropagation();iFollow?unfollowArtist(currentUserId!,a.id):followArtist(currentUserId!,a.id);}}
                    className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-bold"
                    style={{ background:iFollow?'var(--bg-l3)':YM.accent, color:iFollow?YM.t2:'#fff',
                      border:`1px solid ${iFollow?'var(--border)':'transparent'}`, cursor:'pointer' }}>
                    {iFollow?'✓':'+ Подп.'}
                  </button>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      <style>{`@keyframes barBeat{0%,100%{height:40%}50%{height:100%}}`}</style>
    </div>
  );
};
