/* ================================================================
   SKY LIBRARY — Единая библиотека контента
   Музыка · Видео · Подкасты · История · Избранное
================================================================ */
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music2, Film, Mic2, BookOpen, History, Heart,
  Play, SkipForward, BookmarkCheck, Trash2, Search,
  X, Grid3x3, List, RefreshCw, Loader2,
} from 'lucide-react';
import { useLibraryItems, type ContentItem, type LibKind } from './libraryData';

/* ── Design tokens ─────────────────────────────────────────── */
const V = { bg:'var(--bg)', bg1:'var(--bg-l1)', bg2:'var(--bg-l2)', bg3:'var(--bg-l3)',
  border:'var(--border)', bm:'var(--border-m)', accent:'var(--accent)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)', green:'var(--green)', red:'var(--red)', amber:'var(--amber)' };

const fadeUp = (i=0) => ({ initial:{opacity:0,y:12}, animate:{opacity:1,y:0}, transition:{duration:.22,delay:i*.05,ease:[.22,1,.36,1] as any} });

/* ── Type config ────────────────────────────────────────────── */
type LibFilter = 'all'|LibKind|'favorites'|'history'|'continue';

const TYPE_CFG: Record<LibKind,{ icon:any; label:string; color:string }> = {
  music:   { icon:Music2,  label:'Музыка',   color:'#8b5cf6' },
  video:   { icon:Film,    label:'Видео',    color:'#0ea5e9' },
  podcast: { icon:Mic2,    label:'Подкасты', color:'#f59e0b' },
  book:    { icon:BookOpen,label:'Книги',    color:'#10b981' },
};

/* ── Cover component ────────────────────────────────────────── */
const Cover = ({ item, size=56 }: { item:ContentItem; size?:number }) => {
  const Icon = TYPE_CFG[item.type].icon;
  return (
    <div style={{ width:size, height:size, borderRadius:size*.16, flexShrink:0, overflow:'hidden', position:'relative',
      background:`linear-gradient(135deg,${item.coverGrad[0]},${item.coverGrad[1]})` }}>
      {item.coverUrl
        ? <img src={item.coverUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
        : <div style={{ width:'100%', height:'100%', display:'grid', placeItems:'center' }}>
            <Icon size={size*.34} style={{ color:'rgba(255,255,255,.75)' }}/>
          </div>}
      {/* Progress overlay */}
      {item.progress != null && item.progress > 0 && item.progress < 1 && (
        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:3,
          background:'rgba(0,0,0,.4)', borderRadius:'0 0 8px 8px' }}>
          <div style={{ height:'100%', width:`${item.progress*100}%`,
            background:'rgba(255,255,255,.85)', borderRadius:2 }}/>
        </div>
      )}
    </div>
  );
};

/* ── Content card (list row) ────────────────────────────────── */
const ContentRow = ({ item, index, onPlay, onToggleFav, onRemove }:{
  item:ContentItem; index:number; onPlay:()=>void; onToggleFav:()=>void; onRemove:()=>void;
}) => {
  const [hover, setHover] = useState(false);
  const tc = TYPE_CFG[item.type];
  return (
    <motion.div {...fadeUp(index)}
      className="flex items-center gap-3 rounded-2xl px-3 py-2.5 group"
      style={{ background: hover ? V.bg2 : 'transparent', transition:'background .15s', cursor:'pointer' }}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      onClick={onPlay}>
      <Cover item={item} size={48}/>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold truncate" style={{ color:V.t1 }}>{item.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <tc.icon size={10} style={{ color:tc.color }}/>
          <p className="text-[11px] truncate" style={{ color:V.t2 }}>{item.subtitle ?? tc.label}</p>
          {item.duration && <><span style={{ color:V.t3, fontSize:10 }}>·</span>
            <span className="text-[11px]" style={{ color:V.t3, fontFamily:'DM Mono,monospace' }}>{item.duration}</span></>}
        </div>
        {item.progress != null && item.progress > 0 && item.progress < 1 && (
          <div className="mt-1.5 h-0.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,.08)' }}>
            <div style={{ width:`${item.progress*100}%`, height:'100%', background:V.accent, borderRadius:1 }}/>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <motion.button whileTap={{scale:.88}} type="button" onClick={e=>{e.stopPropagation();onToggleFav();}}
          className="grid h-7 w-7 place-items-center rounded-xl hover:bg-white/8 transition-colors"
          style={{ color: item.isFavorite ? '#ef4444' : V.t3 }}>
          <Heart size={13} fill={item.isFavorite?'#ef4444':'none'}/>
        </motion.button>
        {item.isFavorite && (
          <motion.button whileTap={{scale:.88}} type="button" onClick={e=>{e.stopPropagation();onRemove();}}
            className="grid h-7 w-7 place-items-center rounded-xl hover:bg-red-500/10 transition-colors"
            style={{ color:V.t3 }}>
            <Trash2 size={12}/>
          </motion.button>
        )}
      </div>
      {/* Play button */}
      {hover && (
        <motion.div initial={{scale:.7,opacity:0}} animate={{scale:1,opacity:1}}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
          style={{ background:V.accent, boxShadow:`0 4px 14px ${V.accent}55` }}>
          <Play size={15} className="text-white ml-0.5"/>
        </motion.div>
      )}
    </motion.div>
  );
};

/* ── Grid card ──────────────────────────────────────────────── */
const ContentCard = ({ item, index, onPlay, onToggleFav }:{
  item:ContentItem; index:number; onPlay:()=>void; onToggleFav:()=>void;
}) => {
  const tc = TYPE_CFG[item.type];
  return (
    <motion.div {...fadeUp(index)} className="group cursor-pointer flex flex-col gap-2" onClick={onPlay}>
      <div className="relative">
        {/* Square cover */}
        <div className="relative overflow-hidden rounded-2xl aspect-square"
          style={{ background:`linear-gradient(135deg,${item.coverGrad[0]},${item.coverGrad[1]})` }}>
          {item.coverUrl
            ? <img src={item.coverUrl} alt="" className="w-full h-full object-cover"/>
            : <div className="w-full h-full grid place-items-center">
                <tc.icon size={32} style={{ color:'rgba(255,255,255,.7)' }}/>
              </div>}
          {/* Hover overlay */}
          <div className="absolute inset-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-center"
            style={{ background:'rgba(0,0,0,.4)' }}>
            <motion.div whileTap={{scale:.9}}
              className="grid h-12 w-12 place-items-center rounded-full"
              style={{ background:V.accent, boxShadow:`0 4px 18px ${V.accent}66` }}>
              <Play size={20} className="text-white ml-0.5"/>
            </motion.div>
          </div>
          {/* Progress */}
          {item.progress!=null&&item.progress>0&&item.progress<1&&(
            <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background:'rgba(0,0,0,.4)' }}>
              <div style={{ width:`${item.progress*100}%`, height:'100%', background:'rgba(255,255,255,.8)' }}/>
            </div>
          )}
          {/* Fav button */}
          <button type="button" onClick={e=>{e.stopPropagation();onToggleFav();}}
            className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
            style={{ background:'rgba(0,0,0,.55)', backdropFilter:'blur(6px)' }}>
            <Heart size={12} style={{ color:item.isFavorite?'#ef4444':'#fff' }} fill={item.isFavorite?'#ef4444':'none'}/>
          </button>
        </div>
      </div>
      <div className="px-0.5">
        <p className="text-[12px] font-semibold line-clamp-1" style={{ color:V.t1 }}>{item.title}</p>
        <p className="text-[10px] truncate mt-0.5" style={{ color:V.t3 }}>{item.subtitle ?? tc.label}</p>
      </div>
    </motion.div>
  );
};

/* ── Continue listening strip ────────────────────────────────── */
const ContinueStrip = ({ items, onPlay }:{ items:ContentItem[]; onPlay:(item:ContentItem)=>void; }) => {
  const inProgress = items.filter(x=>x.progress!=null&&x.progress>0&&x.progress<1).slice(0,6);
  if(!inProgress.length) return null;
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <SkipForward size={14} style={{ color:V.accent }}/>
          <p className="text-sm font-bold" style={{ color:V.t1 }}>Продолжить</p>
        </div>
        <span className="text-[11px]" style={{ color:V.t3 }}>{inProgress.length} незавершённых</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth:'none' }}>
        {inProgress.map((item,i)=>{
          const tc=TYPE_CFG[item.type];
          return (
            <motion.div key={item.id} {...fadeUp(i)} className="shrink-0 cursor-pointer group"
              style={{ width:140 }} onClick={()=>onPlay(item)}>
              <div className="relative overflow-hidden rounded-2xl mb-2" style={{ aspectRatio:'16/9',
                background:`linear-gradient(135deg,${item.coverGrad[0]},${item.coverGrad[1]})` }}>
                {item.coverUrl&&<img src={item.coverUrl} alt="" className="w-full h-full object-cover"/>}
                <div className="absolute inset-0 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  style={{ background:'rgba(0,0,0,.4)' }}>
                  <Play size={20} className="text-white"/>
                </div>
                {/* Arc progress */}
                <div className="absolute bottom-0 left-0 right-0 h-1" style={{ background:'rgba(0,0,0,.5)' }}>
                  <div style={{ width:`${(item.progress??0)*100}%`, height:'100%', background:V.accent }}/>
                </div>
                <div className="absolute top-1.5 left-1.5 rounded-full px-1.5 py-0.5"
                  style={{ background:'rgba(0,0,0,.6)', backdropFilter:'blur(4px)' }}>
                  <tc.icon size={8} style={{ color:'rgba(255,255,255,.8)' }}/>
                </div>
              </div>
              <p className="text-[11px] font-semibold truncate" style={{ color:V.t1 }}>{item.title}</p>
              <p className="text-[10px] mt-0.5" style={{ color:V.t3 }}>
                {Math.round((item.progress??0)*100)}% · {item.duration}
              </p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════
   MAIN
══════════════════════════════════════════════════════════════ */
export const LibraryModule = () => {
  const { items: library, loading, toggleFavorite, remove, play } = useLibraryItems();
  const [filter,   setFilter]  = useState<LibFilter>('all');
  const [search,   setSearch]  = useState('');
  const [viewMode, setViewMode]= useState<'list'|'grid'>('list');
  const [showSearch, setShowSearch] = useState(false);

  const filtered = useMemo(()=>{
    let items = library;
    if(filter==='favorites') items=items.filter(x=>x.isFavorite);
    else if(filter==='history') items=items.filter(x=>x.isHistory);
    else if(filter==='continue') items=items.filter(x=>x.progress!=null&&x.progress>0&&x.progress<1);
    else if(filter!=='all') items=items.filter(x=>x.type===filter);
    if(search.trim()) { const q=search.toLowerCase(); items=items.filter(x=>x.title.toLowerCase().includes(q)||(x.subtitle??'').toLowerCase().includes(q)); }
    return items;
  },[library,filter,search]);

  const FILTER_TABS: { key:LibFilter; label:string; icon:any }[] = [
    { key:'all',      label:'Всё',          icon:BookmarkCheck },
    { key:'continue', label:'Продолжить',   icon:SkipForward },
    { key:'favorites',label:'Избранное',    icon:Heart },
    { key:'music',    label:'Музыка',       icon:Music2 },
    { key:'video',    label:'Видео',        icon:Film },
    { key:'podcast',  label:'Подкасты',     icon:Mic2 },
    { key:'book',     label:'Книги',        icon:BookOpen },
    { key:'history',  label:'История',      icon:History },
  ];

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{duration:.18}}
      className="flex flex-col h-full overflow-hidden" style={{ background:V.bg }}>

      {/* Header */}
      <div className="shrink-0 px-5 pt-4 pb-0" style={{ borderBottom:`1px solid ${V.border}`, background:V.bg1 }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <motion.div initial={{scale:.7,opacity:0}} animate={{scale:1,opacity:1}} transition={{type:'spring',stiffness:400,damping:26}}
              className="grid h-8 w-8 place-items-center rounded-xl"
              style={{ background:`linear-gradient(135deg,${V.accent},#818cf8)`, boxShadow:`0 4px 14px ${V.accent}44` }}>
              <BookmarkCheck size={15} className="text-white"/>
            </motion.div>
            <div>
              <p className="text-[15px] font-bold" style={{ color:V.t1 }}>Библиотека</p>
              <p className="text-[10px]" style={{ color:V.t3 }}>{library.length} объектов</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {loading && <Loader2 size={14} className="animate-spin" style={{ color:V.t3 }}/>}
            <motion.button whileTap={{scale:.9}} type="button" onClick={()=>setShowSearch(s=>!s)}
              className="grid h-8 w-8 place-items-center rounded-full transition-colors"
              style={{ background:showSearch?`${V.accent}18`:'transparent', color:showSearch?V.accent:V.t2 }}>
              {showSearch?<X size={15}/>:<Search size={15}/>}
            </motion.button>
            <div className="flex rounded-xl overflow-hidden" style={{ border:`1px solid ${V.border}` }}>
              {(['list','grid'] as const).map(m=>(
                <button key={m} type="button" onClick={()=>setViewMode(m)}
                  className="grid h-7 w-7 place-items-center transition-colors"
                  style={{ background:viewMode===m?`${V.accent}18`:'transparent', color:viewMode===m?V.accent:V.t3 }}>
                  {m==='list'?<List size={12}/>:<Grid3x3 size={12}/>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Search bar */}
        <AnimatePresence>
          {showSearch&&(
            <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} className="overflow-hidden mb-3">
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск в библиотеке..." autoFocus
                className="w-full rounded-2xl px-4 py-2.5 text-sm outline-none"
                style={{ background:V.bg2, border:`1px solid ${V.bm}`, color:V.t1 }}/>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-3 mt-1" style={{ scrollbarWidth:'none' }}>
          {FILTER_TABS.map(({key,label,icon:Icon})=>(
            <button key={key} type="button" onClick={()=>setFilter(key)}
              className="shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all"
              style={{ background:filter===key?V.accent:V.bg3, color:filter===key?'#fff':V.t2,
                border:`1px solid ${filter===key?'transparent':V.border}` }}>
              <Icon size={11}/>{label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 pt-5 pb-8" style={{ scrollbarWidth:'none' }}>

        {/* Continue watching strip (only on 'all') */}
        {filter==='all'&&!search&&(
          <ContinueStrip items={library} onPlay={play}/>
        )}

        {/* Stats row */}
        {filter==='all'&&!search&&(
          <div className="grid grid-cols-3 gap-2 mb-6">
            {[
              { icon:Music2,    label:'Музыка',   val:library.filter(x=>x.type==='music').length,   color:'#8b5cf6' },
              { icon:Film,      label:'Видео',    val:library.filter(x=>x.type==='video').length,   color:'#0ea5e9' },
              { icon:Heart,     label:'Избранное',val:library.filter(x=>x.isFavorite).length,       color:'#ef4444' },
            ].map(({icon:Icon,label,val,color},i)=>(
              <motion.div key={label} {...fadeUp(i)} className="rounded-2xl px-3 py-3 text-center"
                style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
                <Icon size={16} className="mx-auto mb-1" style={{ color }}/>
                <p className="text-base font-black" style={{ color:V.t1 }}>{val}</p>
                <p className="text-[10px]" style={{ color:V.t3 }}>{label}</p>
              </motion.div>
            ))}
          </div>
        )}

        {/* Main list/grid */}
        {filtered.length===0 ? (
          <div className="flex flex-col items-center py-20 gap-3 opacity-50">
            {loading
              ? <Loader2 size={28} className="animate-spin" style={{ color:V.t3 }}/>
              : <RefreshCw size={28} style={{ color:V.t3 }}/>}
            <p className="text-sm" style={{ color:V.t2 }}>
              {loading ? 'Загружаем библиотеку…'
                : search?'Ничего не найдено'
                : filter==='favorites'?'Нет избранного'
                : filter==='continue'?'Нет незавершённого'
                : filter==='history'?'История пуста'
                : 'Библиотека пуста'}
            </p>
            {search&&<button type="button" onClick={()=>setSearch('')} className="text-xs" style={{ color:V.accent }}>Сбросить поиск</button>}
          </div>
        ) : viewMode==='list' ? (
          <div className="space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-3 px-1" style={{ color:V.t3 }}>
              {filtered.length} {filter==='favorites'?'избранных':filter==='continue'?'незавершённых':filter==='history'?'в истории':'объектов'}
            </p>
            {filtered.map((item,i)=>(
              <ContentRow key={item.id} item={item} index={i}
                onPlay={()=>play(item)}
                onToggleFav={()=>toggleFavorite(item)}
                onRemove={()=>remove(item)}/>
            ))}
          </div>
        ) : (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color:V.t3 }}>{filtered.length} объектов</p>
            <div className="grid grid-cols-3 gap-3">
              {filtered.map((item,i)=>(
                <ContentCard key={item.id} item={item} index={i}
                  onPlay={()=>play(item)}
                  onToggleFav={()=>toggleFavorite(item)}/>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};
