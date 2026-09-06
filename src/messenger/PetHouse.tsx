/* ===================================================================
   SKY PET HOUSE  v5 — CSS-rendered pet · живая 3D комната
   Без Three.js · CSS transforms · плавный FPS
=================================================================== */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { X, ShoppingBag, Palette, Users, Heart, Zap } from 'lucide-react';
import { PETS, RARITY_CFG, type Pet, type PetMood } from './petData';
import { useAuthStore } from '@/core/auth/store';

/* ── Storage ─────────────────────────────────────────────────── */
const PREFS_KEY = 'sky:pets3d:v5';
const COIN_KEY  = 'sky:pet:coins:v1';
const ROOM_KEY  = 'sky:pet:room:v3';

interface PetNeeds  { hunger:number; happiness:number; energy:number; hygiene:number; }
interface PetPrefs  { owned:string[]; active:string|null; friendship:Record<string,number>; xp:Record<string,number>; needs:Record<string,PetNeeds>; }
interface RoomState { theme:string; items:string[]; }

const DEF_NEEDS:PetNeeds = { hunger:72, happiness:65, energy:80, hygiene:70 };
const lsGet = (k:string,d:any) => { try{ const r=localStorage.getItem(k); return r?JSON.parse(r):d; }catch{ return d; }};
const lsSet = (k:string,v:any) => { try{ localStorage.setItem(k,JSON.stringify(v)); }catch{} };
const loadPrefs = ():PetPrefs => lsGet(PREFS_KEY,{owned:['cat-neon','bunny-pixel'],active:'cat-neon',friendship:{},xp:{},needs:{}});
const savePrefs = (p:PetPrefs) => lsSet(PREFS_KEY,p);
const loadRoom  = ():RoomState=> lsGet(ROOM_KEY,{theme:'cozy',items:['bed','bookshelf','plant']});
const saveRoom  = (r:RoomState)=> lsSet(ROOM_KEY,r);
const getCoins  = (uid:string):number => { try{ return JSON.parse(localStorage.getItem(COIN_KEY)||'{}')[uid]??0; }catch{ return 0; }};
const addCoins  = (uid:string,n:number)=>{ try{ const a=JSON.parse(localStorage.getItem(COIN_KEY)||'{}'); a[uid]=(a[uid]??0)+n; lsSet(COIN_KEY,a); }catch{} };
const spendCoins= (uid:string,n:number):boolean=>{ try{ const a=JSON.parse(localStorage.getItem(COIN_KEY)||'{}'); if((a[uid]??0)<n)return false; a[uid]=(a[uid]??0)-n; lsSet(COIN_KEY,a); return true; }catch{ return false; }};

const XP_LVL=100;
const lvl    =(xp:number)=>Math.floor(xp/XP_LVL)+1;
const lvlPct =(xp:number)=>((xp%XP_LVL)/XP_LVL)*100;

/* ── Themes ─────────────────────────────────────────────────── */
const THEMES:{[k:string]:{label:string;emoji:string;price:number;wall:string;wall2:string;floor:string;floor2:string;accent:string;trim:string;light:string}} = {
  cozy:  {label:'Уютная',  emoji:'🏠',price:0,  wall:'#fdf0e0',wall2:'#f5dfc0',floor:'#d4a96a',floor2:'#c49454',accent:'#c8956b',trim:'#8B6345',light:'#fff5e6'},
  night: {label:'Ночная',  emoji:'🌙',price:80, wall:'#1a1730',wall2:'#14112a',floor:'#2d2650',floor2:'#241e40',accent:'#4a3f7a',trim:'#6b5ca0',light:'#2a2060'},
  mint:  {label:'Мятная',  emoji:'🌿',price:60, wall:'#e0f5ee',wall2:'#c8ecdf',floor:'#9eded0',floor2:'#7fcec0',accent:'#4ab8a8',trim:'#2e9988',light:'#e8fff8'},
  sakura:{label:'Сакура',  emoji:'🌸',price:100,wall:'#fff0f5',wall2:'#fce4ec',floor:'#f9cad8',floor2:'#f0a8bc',accent:'#e879a0',trim:'#c05070',light:'#fff0f8'},
  space: {label:'Космос',  emoji:'🚀',price:150,wall:'#080d18',wall2:'#0d1525',floor:'#1a1f2e',floor2:'#151a27',accent:'#2a3a5e',trim:'#3d5a8a',light:'#101828'},
};

/* ── Furniture ──────────────────────────────────────────────── */
interface FDef { label:string;emoji:string;price:number;bonus:string;w:number;h:number; }
const FURNI:{[k:string]:FDef} = {
  bed:       {label:'Кроватка',      emoji:'🛏️',price:0,  bonus:'+20% энергии',  w:64,h:56},
  bookshelf: {label:'Книжная полка', emoji:'📚',price:0,  bonus:'+10% умности',  w:46,h:52},
  plant:     {label:'Цветок',        emoji:'🪴',price:0,  bonus:'+5% настроения', w:34,h:38},
  lamp:      {label:'Торшер',        emoji:'🪔',price:40, bonus:'+10% уюта',      w:30,h:42},
  rug:       {label:'Ковёр',         emoji:'🟫',price:60, bonus:'+15% счастья',   w:110,h:46},
  tv:        {label:'Телевизор',     emoji:'📺',price:90, bonus:'+25% счастья',   w:56,h:48},
  aquarium:  {label:'Аквариум',      emoji:'🐠',price:120,bonus:'+20% покоя',     w:52,h:44},
  starlight: {label:'Звездопад',     emoji:'🌠',price:200,bonus:'+30% сна',       w:36,h:50},
  piano:     {label:'Пианино',       emoji:'🎹',price:180,bonus:'+35% таланта',   w:60,h:52},
  telescope: {label:'Телескоп',      emoji:'🔭',price:250,bonus:'+40% мечтания',  w:38,h:50},
};
const FPOS:{id:string;x:number;y:number;z:number}[] = [
  {id:'bed',       x:74, y:76,z:6},{id:'bookshelf',x:14,y:54,z:5},
  {id:'plant',     x:88, y:26,z:4},{id:'lamp',     x:20,y:78,z:5},
  {id:'rug',       x:48, y:70,z:3},{id:'tv',       x:48,y:14,z:4},
  {id:'aquarium',  x:87, y:50,z:5},{id:'starlight', x:24,y:30,z:4},
  {id:'piano',     x:30, y:14,z:4},{id:'telescope', x:78,y:14,z:4},
];

type PetState = 'idle'|'walk'|'sit'|'sleep'|'jump'|'dance'|'eat'|'happy';

/* ═══════════════════════════════════════════════════════════════
   CSS-RENDERED PET CHARACTER
═══════════════════════════════════════════════════════════════ */
const CSSPet = ({ pet, state, mood, size=80 }: { pet:Pet; state:PetState; mood:PetMood; size?:number }) => {
  const c  = pet.color;
  const c2 = `${c}cc`;
  const s  = size / 80; // scale factor
  const sc = (n:number) => Math.round(n * s);

  // animation based on state
  const anim =
    state==='idle'  ? 'petFloat 2.4s ease-in-out infinite' :
    state==='walk'  ? 'petWalk .65s ease-in-out infinite' :
    state==='sleep' ? 'petSleep 2.2s ease-in-out infinite' :
    state==='dance' ? 'petDance .45s ease-in-out infinite' :
    state==='jump'  ? 'petJump .55s ease-out 1' :
    state==='happy' ? 'petFloat 1s ease-in-out infinite' : 'none';

  const eyeStyle = (state==='sleep')
    ? { width: sc(9), height: sc(3), borderRadius: sc(2), background: '#2d1a0e' }
    : (mood==='excited' || state==='happy' || state==='dance')
    ? { width: sc(9), height: sc(12), borderRadius: '50%', background: '#2d1a0e', boxShadow:`0 0 0 ${sc(2)}px #fff` }
    : { width: sc(9), height: sc(10), borderRadius: '50%', background: '#2d1a0e' };

  return (
    <div style={{ position:'relative', width: sc(72), height: sc(82), animation: anim }}>
      {/* Shadow */}
      <div style={{ position:'absolute', bottom:-sc(4), left:'50%', transform:'translateX(-50%) scaleY(.4)',
        width:sc(52), height:sc(14), borderRadius:'50%', background:'rgba(0,0,0,.22)', filter:'blur(4px)' }}/>

      {/* Tail */}
      <div style={{
        position:'absolute', bottom:sc(10), right:-sc(12),
        width:sc(22), height:sc(18),
        borderRadius:`${sc(10)}px ${sc(16)}px ${sc(16)}px ${sc(4)}px`,
        background:c2,
        transform: state==='dance' ? 'rotate(-30deg)' : state==='happy' ? 'rotate(-20deg)' : 'rotate(-8deg)',
        transition:'transform .3s',
        zIndex:0,
      }}/>

      {/* Body */}
      <div style={{
        position:'absolute', bottom:sc(8), left:sc(8),
        width:sc(56), height:sc(46),
        borderRadius:`${sc(24)}px ${sc(24)}px ${sc(20)}px ${sc(20)}px`,
        background:`linear-gradient(160deg,${c} 0%,${c2} 100%)`,
        boxShadow:`0 ${sc(8)}px ${sc(22)}px ${c}55, inset 0 ${sc(2)}px ${sc(6)}px rgba(255,255,255,.3)`,
        zIndex:1,
      }}>
        {/* Belly spot */}
        <div style={{
          position:'absolute', bottom:sc(4), left:'50%', transform:'translateX(-50%)',
          width:sc(26), height:sc(22),
          borderRadius:'50%',
          background:'rgba(255,255,255,.25)',
        }}/>
      </div>

      {/* Left ear */}
      <div style={{
        position:'absolute', top:sc(2), left:sc(10),
        width:sc(18), height:sc(20),
        borderRadius:`${sc(10)}px ${sc(4)}px ${sc(4)}px ${sc(10)}px`,
        background:`linear-gradient(135deg,${c},${c2})`,
        transform:'rotate(-12deg)',
        zIndex:2,
      }}>
        <div style={{ position:'absolute', top:sc(4), left:sc(4), width:sc(8), height:sc(11),
          borderRadius:'50%', background:'rgba(255,255,255,.25)' }}/>
      </div>
      {/* Right ear */}
      <div style={{
        position:'absolute', top:sc(2), right:sc(10),
        width:sc(18), height:sc(20),
        borderRadius:`${sc(4)}px ${sc(10)}px ${sc(10)}px ${sc(4)}px`,
        background:`linear-gradient(135deg,${c2},${c})`,
        transform:'rotate(12deg)',
        zIndex:2,
      }}>
        <div style={{ position:'absolute', top:sc(4), right:sc(4), width:sc(8), height:sc(11),
          borderRadius:'50%', background:'rgba(255,255,255,.25)' }}/>
      </div>

      {/* Head */}
      <div style={{
        position:'absolute', top:sc(8), left:sc(6),
        width:sc(60), height:sc(56),
        borderRadius:`${sc(32)}px ${sc(32)}px ${sc(26)}px ${sc(26)}px`,
        background:`linear-gradient(155deg,${c} 0%,${c2} 100%)`,
        boxShadow:`0 ${sc(6)}px ${sc(18)}px ${c}44, inset 0 ${sc(2)}px ${sc(5)}px rgba(255,255,255,.25)`,
        zIndex:3,
      }}>
        {/* Face */}
        <div style={{ position:'absolute', top:'28%', left:'50%', transform:'translateX(-50%)', width:'80%', display:'flex', justifyContent:'space-around', alignItems:'center' }}>
          {/* Left eye */}
          <div style={{ ...eyeStyle, position:'relative' }}>
            {(mood==='excited'||state==='happy') && <div style={{ position:'absolute', top:sc(1), right:sc(1), width:sc(3), height:sc(3), borderRadius:'50%', background:'#fff' }}/>}
          </div>
          {/* Right eye */}
          <div style={{ ...eyeStyle, position:'relative' }}>
            {(mood==='excited'||state==='happy') && <div style={{ position:'absolute', top:sc(1), right:sc(1), width:sc(3), height:sc(3), borderRadius:'50%', background:'#fff' }}/>}
          </div>
        </div>

        {/* Nose */}
        <div style={{
          position:'absolute', top:'55%', left:'50%', transform:'translateX(-50%)',
          width:sc(10), height:sc(7),
          borderRadius:`${sc(5)}px ${sc(5)}px ${sc(5)}px ${sc(5)}px`,
          background:'rgba(255,255,255,.55)',
        }}/>

        {/* Mouth */}
        <div style={{
          position:'absolute', top:'67%', left:'50%', transform:'translateX(-50%)',
          fontSize: sc(state==='happy'||state==='dance'||mood==='excited' ? 11 : 9),
        }}>
          {state==='sleep'?'😴'
           :mood==='excited'||state==='happy'||state==='dance'?'🥰'
           :state==='eat'?'😋'
           :'🐱'}
        </div>

        {/* Blush when happy */}
        {(mood==='love'||state==='happy'||state==='dance') && <>
          <div style={{ position:'absolute', top:'58%', left:'12%', width:sc(14), height:sc(8), borderRadius:'50%', background:'rgba(255,120,150,.35)' }}/>
          <div style={{ position:'absolute', top:'58%', right:'12%', width:sc(14), height:sc(8), borderRadius:'50%', background:'rgba(255,120,150,.35)' }}/>
        </>}
      </div>

      {/* Paws */}
      <div style={{ position:'absolute', bottom:sc(2), left:sc(12), width:sc(18), height:sc(12),
        borderRadius:'50%', background:c2, zIndex:2 }}/>
      <div style={{ position:'absolute', bottom:sc(2), right:sc(12), width:sc(18), height:sc(12),
        borderRadius:'50%', background:c2, zIndex:2 }}/>

      {/* ZZZ sleep */}
      {state==='sleep' && [0,1,2].map(i=>(
        <div key={i} style={{
          position:'absolute', top:-sc(8)-i*sc(10), right:-sc(4),
          color:c, fontWeight:900, fontSize:sc(10)+i*sc(2),
          opacity:.85, animation:`zzz 1.8s ${i*.5}s ease-in infinite`,
        }}>
          {i===2?'Z':'z'}
        </div>
      ))}

      {/* Hearts/stars float */}
      {(state==='happy'||state==='dance'||mood==='love') && (
        <div style={{ position:'absolute', top:-sc(20), left:'50%', marginLeft:-sc(10),
          fontSize:sc(18), animation:'floatUp .9s ease-out infinite' }}>
          {mood==='love'?'💖':'✨'}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   3D ROOM
═══════════════════════════════════════════════════════════════ */
const W=530, H=370, FH=116;

const Room = ({ pet,theme,items,petState,petPos,petMood,onPetTap,onFurnitureTap }:{
  pet:Pet; theme:typeof THEMES[string]; items:string[];
  petState:PetState; petPos:{x:number;y:number;facing:-1|1};
  petMood:PetMood; onPetTap:()=>void; onFurnitureTap:(id:string)=>void;
}) => {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotX = useSpring(useTransform(my,[-100,100],[2.5,-2.5]),{stiffness:45,damping:20});
  const rotY = useSpring(useTransform(mx,[-200,200],[-3.5,3.5]),{stiffness:45,damping:20});
  const hr = new Date().getHours();
  const isNight = hr<7||hr>21;
  const isEvening = hr>=18&&hr<=21;

  // ambient light color based on time
  const lightColor = isNight ? 'rgba(30,20,60,.72)' : isEvening ? 'rgba(80,40,0,.18)' : 'rgba(255,240,200,.08)';

  return (
    <div className="relative overflow-hidden select-none"
      style={{ width:W, height:H, borderRadius:28, cursor:'default', boxShadow:'0 24px 70px rgba(0,0,0,.7)' }}
      onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect();mx.set(e.clientX-r.left-W/2);my.set(e.clientY-r.top-H/2);}}
      onMouseLeave={()=>{mx.set(0);my.set(0);}}>

      <motion.div className="absolute inset-0" style={{ rotateX: rotX, rotateY: rotY, transformStyle:'preserve-3d', perspective:1000 }}>

        {/* ── BACK WALL ─────────────────────────────────── */}
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius:28,
          background:`linear-gradient(175deg,${theme.wall} 0%,${theme.wall2} 65%,${theme.floor}55 100%)` }}>

          {/* Wallpaper pattern */}
          <div className="absolute inset-0 pointer-events-none opacity-15"
            style={{ backgroundImage:`radial-gradient(circle,${theme.accent}55 1px,transparent 1px)`, backgroundSize:'24px 24px' }}/>

          {/* Ceiling edge shadow */}
          <div className="absolute top-0 left-0 right-0 h-8 pointer-events-none"
            style={{ background:'linear-gradient(180deg,rgba(0,0,0,.14),transparent)' }}/>

          {/* ── Window ─────────────────────────────────── */}
          <div className="absolute" style={{ top:20, left:'50%', marginLeft:-70, width:140, height:100 }}>
            <div className="w-full h-full relative" style={{ borderRadius:16, overflow:'hidden',
              border:`3px solid ${theme.trim}60`,
              boxShadow:`0 0 0 6px ${theme.wall}, 0 6px 20px rgba(0,0,0,.2), inset 0 0 20px rgba(0,0,0,.05)` }}>
              {/* Sky */}
              <div className="w-full h-full" style={{
                background: isNight
                  ? 'linear-gradient(180deg,#060d1f 0%,#0f1a35 100%)'
                  : isEvening
                    ? 'linear-gradient(180deg,#ff6b35 0%,#ffd166 60%,#87ceeb 100%)'
                    : 'linear-gradient(180deg,#64b5f6 0%,#bbdefb 70%,#e3f2fd 100%)' }}>
                {isNight ? <>
                  {[...Array(12)].map((_,i)=><div key={i} className="absolute rounded-full"
                    style={{ width:i%3===0?2.5:1.5, height:i%3===0?2.5:1.5, background:'#fff',
                      top:`${8+i%4*22}%`, left:`${7+i*8}%`, opacity:.7+Math.sin(i)*.3,
                      animation:`pulse3d ${1.5+i*.2}s ease-in-out infinite` }}/>)}
                  <div className="absolute top-2 right-4 text-lg">🌙</div>
                </> : isEvening ? <>
                  <div className="absolute top-2 right-3 text-xl">🌅</div>
                  {[...Array(3)].map((_,i)=>(
                    <div key={i} className="absolute rounded-full opacity-60"
                      style={{ width:30+i*10, height:12+i*4, background:'rgba(255,200,150,.5)',
                        top:`${25+i*20}%`, left:`${10+i*25}%`, borderRadius:8 }}/>
                  ))}
                </> : <>
                  <div className="absolute top-1.5 right-3 text-lg">☀️</div>
                  {[...Array(3)].map((_,i)=>(
                    <div key={i} className="absolute rounded-full"
                      style={{ width:32+i*14, height:14+i*5, background:'rgba(255,255,255,.75)',
                        top:`${20+i*25}%`, left:`${5+i*30}%`, borderRadius:10 }}/>
                  ))}
                  <div className="absolute bottom-0 left-0 right-0 rounded-t-full"
                    style={{ height:32, background:'#7ec8e3', opacity:.55 }}/>
                </>}
              </div>
              {/* Window frame */}
              <div className="absolute inset-0 pointer-events-none" style={{ borderRadius:14, border:`2px solid ${theme.trim}44` }}>
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-px" style={{ background:`${theme.trim}55` }}/>
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-px" style={{ background:`${theme.trim}55` }}/>
              </div>
            </div>
            {/* Window sill */}
            <div className="absolute -bottom-2 -left-2 -right-2 h-3 rounded-b-xl"
              style={{ background:theme.trim, boxShadow:'0 3px 8px rgba(0,0,0,.2)' }}/>
            {/* Plants on sill */}
            <div className="absolute -bottom-1 -right-6 text-base">🌸</div>
          </div>

          {/* ── Wall shelves ───────────────────────────── */}
          {/* Right shelf */}
          <div className="absolute" style={{ top:76, right:28, width:72, height:9, borderRadius:5, background:theme.trim, boxShadow:'0 3px 10px rgba(0,0,0,.25)' }}>
            <div className="absolute flex gap-2 items-end" style={{ bottom:-16, left:2 }}>
              <span className="text-xl">📦</span>
              <span className="text-base">🕯️</span>
              <span className="text-sm">🐚</span>
            </div>
            {/* Shelf support brackets */}
            <div className="absolute bottom-0 left-2 w-1 h-4" style={{ background:theme.trim, opacity:.6 }}/>
            <div className="absolute bottom-0 right-4 w-1 h-4" style={{ background:theme.trim, opacity:.6 }}/>
          </div>

          {/* Left shelf */}
          <div className="absolute" style={{ top:86, left:28, width:62, height:8, borderRadius:5, background:theme.trim, boxShadow:'0 2px 8px rgba(0,0,0,.2)' }}>
            <div className="absolute flex gap-1.5 items-end" style={{ bottom:-14, left:4 }}>
              <span className="text-lg">📷</span>
              <span className="text-sm">🌟</span>
              <span className="text-xs">🧸</span>
            </div>
            <div className="absolute bottom-0 left-2 w-1 h-3.5" style={{ background:theme.trim, opacity:.6 }}/>
            <div className="absolute bottom-0 right-3 w-1 h-3.5" style={{ background:theme.trim, opacity:.6 }}/>
          </div>

          {/* ── Wall picture frame ─────────────────────── */}
          <div className="absolute" style={{ top:50, left:80, width:52, height:44, borderRadius:8,
            background:`linear-gradient(135deg,${theme.accent}66,${theme.accent}28)`,
            border:`3px solid ${theme.trim}70`, boxShadow:'0 4px 14px rgba(0,0,0,.25)' }}>
            <div className="absolute inset-0 flex items-center justify-center text-2xl">🎨</div>
            {/* Frame inner shadow */}
            <div className="absolute inset-0 rounded-md" style={{ boxShadow:'inset 0 2px 6px rgba(0,0,0,.15)' }}/>
          </div>

          {/* Corner lamp */}
          {items.includes('lamp') && (
            <div className="absolute" style={{ top:8, right:8 }}>
              <div className="text-2xl" style={{ filter:`drop-shadow(0 0 14px ${theme.light}) drop-shadow(0 0 6px ${theme.light})` }}>🪔</div>
              {/* light cone */}
              <div className="absolute top-6 left-1/2 pointer-events-none"
                style={{ width:60, height:80, marginLeft:-30,
                  background:`radial-gradient(ellipse at top,${theme.light}88,transparent 70%)`,
                  mixBlendMode:'screen', pointerEvents:'none' }}/>
            </div>
          )}

          {/* Starlight effect */}
          {items.includes('starlight') && isNight && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {[...Array(18)].map((_,i)=>(
                <div key={i} className="absolute rounded-full"
                  style={{ width:2, height:2, background:'#fff',
                    top:`${5+Math.random()*55}%`, left:`${Math.random()*100}%`,
                    opacity:.6+Math.random()*.4,
                    animation:`pulse3d ${1.2+i*.15}s ease-in-out ${i*.1}s infinite` }}/>
              ))}
            </div>
          )}
        </div>

        {/* ── LEFT WALL SHADOW ─────────────────────────── */}
        <div className="absolute inset-y-0 left-0 pointer-events-none"
          style={{ width:52, background:'linear-gradient(90deg,rgba(0,0,0,.2),transparent)', borderRadius:'28px 0 0 28px' }}/>

        {/* ── FLOOR ────────────────────────────────────── */}
        <div className="absolute bottom-0 left-0 right-0" style={{ height:FH+50,
          background:`linear-gradient(180deg,${theme.floor}55 0%,${theme.floor} 30%,${theme.floor2} 100%)`,
          transform:`perspective(750px) rotateX(28deg)`, transformOrigin:'top center',
          borderRadius:'0 0 28px 28px' }}>
          {/* Tile grid */}
          <div className="absolute inset-0 opacity-30"
            style={{ backgroundImage:`linear-gradient(${theme.floor2} 1px,transparent 1px),linear-gradient(90deg,${theme.floor2} 1px,transparent 1px)`,
              backgroundSize:'48px 48px' }}/>
          {/* Baseboard */}
          <div className="absolute top-0 left-0 right-0 opacity-50" style={{ height:4, background:theme.trim }}/>
          {/* Floor shadow (depth) */}
          <div className="absolute top-0 left-0 right-0 h-12 pointer-events-none"
            style={{ background:'linear-gradient(180deg,rgba(0,0,0,.1),transparent)' }}/>
        </div>

        {/* ── RUG ──────────────────────────────────────── */}
        {items.includes('rug') && (
          <div className="absolute pointer-events-none" style={{
            left:'26%', bottom:'28%', width:150, height:60, borderRadius:36,
            background:`radial-gradient(ellipse,${theme.accent}70 0%,${theme.accent}28 100%)`,
            border:`2.5px solid ${theme.accent}50`,
            transform:`perspective(450px) rotateX(30deg)`, transformOrigin:'center top', zIndex:3 }}>
            {/* Rug pattern */}
            <div className="absolute inset-2 rounded-full border" style={{ borderColor:`${theme.accent}40` }}/>
          </div>
        )}

        {/* ── FURNITURE ────────────────────────────────── */}
        {FPOS.filter(p=>items.includes(p.id)).map(piece=>{
          const fd=FURNI[piece.id]; if(!fd)return null;
          const xPx=(piece.x/100)*W;
          const yPx=(piece.y/100)*FH+(H-FH-40);
          return(
            <motion.div key={piece.id} className="absolute cursor-pointer"
              style={{ left:xPx-fd.w/2, top:yPx-fd.h*.7, zIndex:piece.z+Math.round(piece.y/10) }}
              whileHover={{ scale:1.12, y:-5, transition:{ type:'spring',stiffness:400 } }}
              whileTap={{ scale:.88 }}
              onClick={()=>onFurnitureTap(piece.id)}
              title={fd.label}>
              <div style={{ fontSize:fd.w*.58, lineHeight:1, filter:`drop-shadow(0 6px 12px rgba(0,0,0,.3)) drop-shadow(0 2px 4px rgba(0,0,0,.2))` }}>
                {fd.emoji}
              </div>
            </motion.div>
          );
        })}

        {/* ── CSS PET ──────────────────────────────────── */}
        <div className="absolute cursor-pointer" style={{
          left:petPos.x-36, top:petPos.y-56, zIndex:60,
          transform:`scaleX(${petPos.facing})`,
          filter:`drop-shadow(0 ${petState==='jump'?12:6}px ${petState==='jump'?28:14}px ${pet.color}60)`,
        }} onClick={onPetTap}>
          <CSSPet pet={pet} state={petState} mood={petMood} size={80}/>
        </div>

        {/* ── Ambient light overlay ─────────────────────── */}
        <div className="absolute inset-0 pointer-events-none rounded-[28px]"
          style={{ background:lightColor, mixBlendMode: isNight?'multiply':'overlay' }}/>

        {/* ── Time badge ───────────────────────────────── */}
        <div className="absolute bottom-3 right-4 rounded-full px-3 py-1 text-[10px] font-bold"
          style={{ background:'rgba(0,0,0,.42)', color:'rgba(255,255,255,.75)', backdropFilter:'blur(8px)', zIndex:25, border:'1px solid rgba(255,255,255,.08)' }}>
          {isNight?'🌙 Ночь':hr<12?'🌅 Утро':isEvening?'🌆 Вечер':'☀️ День'}
        </div>
      </motion.div>
    </div>
  );
};

/* ── Particle ────────────────────────────────────────────────── */
const Particle = ({x,y,emoji,done}:{x:number;y:number;emoji:string;done:()=>void}) => (
  <div className="pointer-events-none absolute select-none text-2xl"
    style={{ left:x, top:y, zIndex:90, animation:'floatUp .9s ease-out forwards' }}
    onAnimationEnd={done}>{emoji}</div>
);

/* ── Needs bar ───────────────────────────────────────────────── */
const NBar = ({label,v,c,emoji}:{label:string;v:number;c:string;emoji:string}) => (
  <div>
    <div className="flex justify-between mb-1">
      <span className="text-[11px] font-semibold" style={{ color:'var(--t2)' }}>{emoji} {label}</span>
      <span className="text-[10px] tabular-nums" style={{ color:'var(--t3)' }}>{Math.round(v)}%</span>
    </div>
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,.08)' }}>
      <motion.div className="h-full rounded-full" animate={{ width:`${v}%` }} transition={{ duration:.7 }}
        style={{ background:c }}/>
    </div>
  </div>
);

/* ── CSS keyframes ───────────────────────────────────────────── */
const CSS_ANIM = `
@keyframes petFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
@keyframes petWalk  { 0%,100%{transform:translateX(0) rotate(0deg)} 25%{transform:translateX(3px) rotate(1.5deg)} 75%{transform:translateX(-3px) rotate(-1.5deg)} }
@keyframes petSleep { 0%,100%{transform:rotate(-7deg) scaleX(1.08)} 50%{transform:rotate(-9deg) scaleX(1.12)} }
@keyframes petDance { 0%{transform:rotate(-8deg) scaleY(.93)} 50%{transform:rotate(8deg) scaleY(1.06)} 100%{transform:rotate(-8deg) scaleY(.93)} }
@keyframes petJump  { 0%{transform:translateY(0)} 35%{transform:translateY(-36px)} 100%{transform:translateY(0)} }
@keyframes floatUp  { 0%{opacity:1;transform:translateY(0) scale(.8)} 100%{opacity:0;transform:translateY(-72px) scale(1.4)} }
@keyframes pulse3d  { 0%,100%{transform:scale(1);opacity:.9} 50%{transform:scale(1.6);opacity:.35} }
@keyframes zzz      { 0%{opacity:0;transform:translateY(0)} 40%{opacity:.9} 100%{opacity:0;transform:translateY(-20px)} }
@keyframes shimmerBg{ 0%{background-position:0 50%} 100%{background-position:200% 50%} }
`;

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export interface PetHouseProps { onClose:()=>void; onSendSticker:(petId:string,mood:PetMood,sound:string)=>void; }

export const PetHouse = ({ onClose, onSendSticker }:PetHouseProps) => {
  const { currentUserId } = useAuthStore();
  const uid = currentUserId ?? 'guest';

  const [prefs,  setPrefs] = useState<PetPrefs>(loadPrefs);
  const [room,   setRoom]  = useState<RoomState>(loadRoom);
  const [coins,  setCoins] = useState(()=>getCoins(uid));
  const [panel,  setPanel] = useState<'info'|'shop'|'themes'|'pets'>('info');
  const [msg,    setMsg]   = useState('');
  const [shopMsg,setSM]    = useState('');

  const [petState, setPetSt]  = useState<PetState>('idle');
  const [petMood,  setPetMd]  = useState<PetMood>('idle');
  const [petPos,   setPetPos] = useState({ x:220, y:258, facing:1 as -1|1 });
  const [particles,setParts]  = useState<{id:number;x:number;y:number;emoji:string}[]>([]);
  const stRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const pid   = useRef(0);

  const activePet  = useMemo(()=>PETS.find(p=>p.id===prefs.active)??PETS[0],[prefs.active]);
  const petXP      = prefs.xp?.[activePet.id]??0;
  const petLevel   = lvl(petXP);
  const petLvlPct  = lvlPct(petXP);
  const needs      = prefs.needs?.[activePet.id]??DEF_NEEDS;
  const friendship = prefs.friendship?.[activePet.id]??0;
  const theme      = THEMES[room.theme]??THEMES.cozy;
  const rc = useCallback(()=>setCoins(getCoins(uid)),[uid]);
  const upd = useCallback((fn:(p:PetPrefs)=>PetPrefs)=>{
    setPrefs(prev=>{ const n=fn(prev); savePrefs(n); return n; });
  },[]);
  const spawn = useCallback((emoji:string,x?:number,y?:number)=>{
    const id=++pid.current;
    setParts(p=>[...p,{id,x:x??petPos.x+100,y:y??petPos.y-20,emoji}]);
  },[petPos]);

  /* Pet AI */
  useEffect(()=>{
    let i=0;
    const states:PetState[] = ['idle','walk','sit','idle','walk','idle','idle'];
    const cycle=()=>{
      const s=states[i%states.length]; i++;
      setPetSt(s);
      if(s==='walk'){
        const nx=80+Math.random()*(W-160);
        const ny=190+Math.random()*85;
        setPetPos(p=>({x:nx,y:ny,facing:(nx>p.x?1:-1) as -1|1}));
      }
      stRef.current=setTimeout(cycle,2500+Math.random()*3000);
    };
    stRef.current=setTimeout(cycle,1000);
    return()=>{ if(stRef.current)clearTimeout(stRef.current); };
  },[]);

  /* Daily bonus */
  useEffect(()=>{
    const k=`sky:pet:daily:${uid}:${new Date().toDateString()}`;
    if(!localStorage.getItem(k)){
      addCoins(uid,20); localStorage.setItem(k,'1'); rc();
      setMsg('🎁 +20 монет за вход!'); setTimeout(()=>setMsg(''),2500);
    }
  },[uid]);

  const showMsg=(m:string,ms=2200)=>{ setMsg(m); setTimeout(()=>setMsg(''),ms); };

  const handlePetTap=useCallback(()=>{
    const icons=['😸','💖','⭐','✨','💫','🎉','🫶'];
    spawn(icons[Math.floor(Math.random()*icons.length)]);
    setPetSt('happy'); setPetMd(friendship>70?'love':'excited');
    showMsg(activePet.sounds[Math.floor(Math.random()*activePet.sounds.length)]);
    upd(p=>({...p,
      xp:{...p.xp,[activePet.id]:(p.xp?.[activePet.id]??0)+3},
      friendship:{...p.friendship,[activePet.id]:Math.min(100,(p.friendship?.[activePet.id]??0)+1)},
    }));
    if(Math.random()<.25){ addCoins(uid,1); rc(); spawn('🪙'); }
    setTimeout(()=>{ setPetSt('idle'); setPetMd('idle'); },2000);
  },[activePet,spawn,upd,uid,rc,friendship]);

  const handleFurnitureTap=useCallback((id:string)=>{
    const map:{[k:string]:{msg:string;e:string;s:PetState;m:PetMood}}={
      bed:       {msg:'😴 Забирается в кровать...', e:'💤',s:'sleep',m:'sleepy'},
      tv:        {msg:'📺 Смотрит мультики!',        e:'✨', s:'sit',  m:'happy'},
      bookshelf: {msg:'📚 Читает книжку...',          e:'📖',s:'sit',  m:'idle'},
      piano:     {msg:'🎹 Играет сонату!',            e:'🎵',s:'dance',m:'excited'},
      aquarium:  {msg:'🐠 Смотрит на рыбок...',      e:'💧',s:'sit',  m:'idle'},
      telescope: {msg:'🔭 Смотрит на звёзды!',       e:'🌟',s:'sit',  m:'excited'},
    };
    const a=map[id]; if(!a)return;
    setPetSt(a.s); setPetMd(a.m); showMsg(a.msg); spawn(a.e);
    upd(p=>({...p,xp:{...p.xp,[activePet.id]:(p.xp?.[activePet.id]??0)+2}}));
    setTimeout(()=>{ setPetSt('idle'); setPetMd('idle'); },3000);
  },[activePet,spawn,upd]);

  const handleFeed=()=>{
    if(!spendCoins(uid,5)){ setSM('❌ Мало монет (нужно 🪙5)'); setTimeout(()=>setSM(''),1600); return; }
    rc(); setPetSt('eat'); setPetMd('happy'); spawn('🍖');
    showMsg('Ням-ням! Очень вкусно! 😋');
    upd(p=>({...p,
      needs:{...p.needs,[activePet.id]:{...(p.needs?.[activePet.id]??DEF_NEEDS),hunger:Math.min(100,(p.needs?.[activePet.id]?.hunger??72)+22)}},
      xp:{...p.xp,[activePet.id]:(p.xp?.[activePet.id]??0)+5},
    }));
    setTimeout(()=>{ setPetSt('idle'); setPetMd('idle'); },2500);
  };

  const handlePlay=()=>{
    setPetSt('jump'); setPetMd('excited'); spawn('🎮');
    showMsg('Ура! Играем! 🎉');
    upd(p=>({...p,
      needs:{...p.needs,[activePet.id]:{...(p.needs?.[activePet.id]??DEF_NEEDS),happiness:Math.min(100,(p.needs?.[activePet.id]?.happiness??65)+16)}},
      xp:{...p.xp,[activePet.id]:(p.xp?.[activePet.id]??0)+4},
    }));
    addCoins(uid,3); rc();
    setTimeout(()=>setPetSt('dance'),640);
    setTimeout(()=>{ setPetSt('idle'); setPetMd('idle'); },3000);
  };

  const handleSticker=()=>{
    const mood:PetMood=petMood==='idle'?'happy':petMood;
    onSendSticker(activePet.id,mood,activePet.sounds[Math.floor(Math.random()*activePet.sounds.length)]);
    spawn('💌'); showMsg('Стикер отправлен! 💌');
    addCoins(uid,2); rc();
    upd(p=>({...p,xp:{...p.xp,[activePet.id]:(p.xp?.[activePet.id]??0)+2}}));
  };

  const handleClean=()=>{
    if(!spendCoins(uid,3)){ setSM('❌ Нужно 🪙3'); setTimeout(()=>setSM(''),1400); return; }
    rc(); spawn('🫧'); showMsg('Чистый и пушистый! 🫧✨');
    upd(p=>({...p,
      needs:{...p.needs,[activePet.id]:{...(p.needs?.[activePet.id]??DEF_NEEDS),hygiene:Math.min(100,(p.needs?.[activePet.id]?.hygiene??70)+25)}},
      xp:{...p.xp,[activePet.id]:(p.xp?.[activePet.id]??0)+3},
    }));
  };

  const buyFurni=(id:string)=>{
    const fd=FURNI[id]; if(!fd||room.items.includes(id))return;
    if(!spendCoins(uid,fd.price)){ setSM('❌ Недостаточно монет!'); setTimeout(()=>setSM(''),1800); return; }
    rc(); const nr={...room,items:[...room.items,id]}; setRoom(nr); saveRoom(nr);
    setSM(`✓ ${fd.label} куплен!`); setTimeout(()=>setSM(''),1800);
    spawn('🎁',W/2+120,180);
  };

  const buyTheme=(key:string)=>{
    const td=THEMES[key]; if(!td||room.theme===key)return;
    if(td.price>0&&!spendCoins(uid,td.price)){ setSM('❌ Недостаточно монет!'); setTimeout(()=>setSM(''),1800); return; }
    if(td.price>0) rc();
    const nr={...room,theme:key}; setRoom(nr); saveRoom(nr);
    setSM(`✓ Тема «${td.label}» применена!`); setTimeout(()=>setSM(''),1800);
  };

  const activatePet=(id:string)=>{
    upd(p=>({...p,active:id}));
    const p=PETS.find(x=>x.id===id);
    if(p){ showMsg(`Привет! Я ${p.name}! 👋`); }
  };

  const PANEL_TABS = [
    {k:'info',   icon:<Heart size={13}/>,   label:'Питомец'},
    {k:'shop',   icon:<ShoppingBag size={13}/>, label:'Магазин'},
    {k:'themes', icon:<Palette size={13}/>, label:'Темы'},
    {k:'pets',   icon:<Users size={13}/>,   label:'Питомцы'},
  ] as const;

  return (
    <div className="fixed inset-0 z-[300] flex flex-col overflow-hidden"
      style={{ background:'rgba(0,0,0,.92)', backdropFilter:'blur(20px)' }}>
      <style>{CSS_ANIM}</style>

      {/* ── HEADER ──────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 pb-3 shrink-0"
        style={{ borderBottom:'1px solid rgba(255,255,255,.08)', background:'rgba(0,0,0,.4)', paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <CSSPet pet={activePet} state="idle" mood={petMood} size={36}/>
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2"
              style={{ background:'#22c55e', borderColor:'rgba(0,0,0,.8)' }}/>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-black text-white">{activePet.name}</p>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background:`${RARITY_CFG[activePet.rarity].color}22`, color:RARITY_CFG[activePet.rarity].color }}>
                Lv.{petLevel} · {RARITY_CFG[activePet.rarity].label}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="w-28 h-1.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,.1)' }}>
                <div className="h-full rounded-full" style={{ width:petLvlPct+'%', background:`linear-gradient(90deg,${activePet.color},#22d3ee)` }}/>
              </div>
              <span className="text-[10px]" style={{ color:'var(--t3)' }}>{petXP%XP_LVL}/{XP_LVL} XP</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ background:'rgba(245,158,11,.12)', border:'1px solid rgba(245,158,11,.2)' }}>
            <span className="text-base">🪙</span>
            <span className="text-sm font-black" style={{ color:'#f59e0b' }}>{coins}</span>
          </div>
          <div className="flex items-center gap-1 rounded-full px-2.5 py-1.5"
            style={{ background:'rgba(244,63,94,.1)', border:'1px solid rgba(244,63,94,.2)' }}>
            <span className="text-sm">❤️</span>
            <span className="text-xs font-bold" style={{ color:'#f43f5e' }}>{friendship}</span>
          </div>
          <button type="button" onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"
            style={{ background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)', cursor:'pointer', color:'rgba(255,255,255,.6)' }}>
            <X size={16}/>
          </button>
        </div>
      </div>

      {/* ── BODY ─────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden sm:flex-row">

        {/* Scene column */}
        <div className="flex-1 flex flex-col items-center justify-center relative p-4 min-w-0">
          <Room
            pet={activePet} theme={theme} items={room.items}
            petState={petState} petPos={petPos} petMood={petMood}
            onPetTap={handlePetTap} onFurnitureTap={handleFurnitureTap}
          />

          {/* Particles */}
          {particles.map(p=>(
            <Particle key={p.id} x={p.x} y={p.y} emoji={p.emoji}
              done={()=>setParts(ps=>ps.filter(x=>x.id!==p.id))}/>
          ))}

          {/* Speech bubble */}
          <AnimatePresence>
            {msg && (
              <motion.div
                initial={{ opacity:0, y:14, scale:.85 }} animate={{ opacity:1, y:0, scale:1 }}
                exit={{ opacity:0, y:-8 }} transition={{ type:'spring', stiffness:420, damping:26 }}
                className="mt-3 rounded-3xl px-5 py-3 text-sm font-bold text-white text-center relative"
                style={{ background:`linear-gradient(135deg,${activePet.color}dd,${activePet.color}99)`,
                  boxShadow:`0 6px 24px ${activePet.color}55`, maxWidth:320, backdropFilter:'blur(10px)',
                  border:'1px solid rgba(255,255,255,.15)' }}>
                {/* Tail */}
                <div className="absolute -top-2 left-1/2 w-4 h-4 rotate-45 -translate-x-1/2"
                  style={{ background:activePet.color }}/>
                {msg}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action buttons */}
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {[
              {icon:'🍖',label:'Кормить', action:handleFeed,    cost:'🪙5', color:'#f59e0b'},
              {icon:'🎮',label:'Играть',  action:handlePlay,    cost:'',    color:'#8b5cf6'},
              {icon:'🫧',label:'Купать',  action:handleClean,   cost:'🪙3', color:'#22d3ee'},
              {icon:'💌',label:'Стикер',  action:handleSticker, cost:'',    color:'#f43f5e'},
              {icon:'🫶',label:'Обнять',  action:handlePetTap,  cost:'',    color:'#ec4899'},
            ].map(({icon,label,action,cost,color})=>(
              <motion.button key={label} type="button"
                whileHover={{ scale:1.1, y:-3 }} whileTap={{ scale:.88 }}
                onClick={action}
                className="flex flex-col items-center gap-1 rounded-2xl px-3 py-2.5"
                style={{ background:'rgba(255,255,255,.06)', border:`1px solid ${color}28`, cursor:'pointer', minWidth:54 }}>
                <span style={{ fontSize:20 }}>{icon}</span>
                <span className="text-[9px] font-bold whitespace-nowrap" style={{ color:'rgba(255,255,255,.65)' }}>{label}</span>
                {cost && <span className="text-[8px]" style={{ color:'#f59e0b' }}>{cost}</span>}
              </motion.button>
            ))}
          </div>
        </div>

        {/* ── RIGHT PANEL ──────────────────────────────── */}
        <div className="w-full max-h-[42vh] shrink-0 flex flex-col border-t overflow-hidden sm:w-60 sm:max-h-none sm:border-l sm:border-t-0"
          style={{ borderColor:'rgba(255,255,255,.06)', background:'rgba(0,0,0,.45)' }}>

          {/* Tabs */}
          <div className="flex shrink-0" style={{ borderBottom:'1px solid rgba(255,255,255,.07)' }}>
            {PANEL_TABS.map(t=>(
              <button key={t.k} type="button" onClick={()=>setPanel(t.k as typeof panel)}
                className="flex-1 py-2.5 text-[9px] font-bold flex flex-col items-center gap-0.5"
                style={{ background:panel===t.k?'rgba(255,255,255,.04)':'transparent',
                  borderBottom:panel===t.k?`2px solid ${activePet.color}`:'2px solid transparent',
                  color:panel===t.k?'#fff':'rgba(255,255,255,.3)', cursor:'pointer' }}>
                <span style={{ color:panel===t.k?activePet.color:'rgba(255,255,255,.35)' }}>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3.5" style={{ scrollbarWidth:'none' }}>

            {/* ── PET INFO ─── */}
            {panel==='info' && <>
              {/* Mini pet card */}
              <div className="rounded-2xl p-4" style={{ background:`${activePet.color}10`, border:`1px solid ${activePet.color}25` }}>
                <div className="flex items-center gap-3 mb-2">
                  <CSSPet pet={activePet} state="idle" mood="happy" size={44}/>
                  <div>
                    <p className="text-sm font-black text-white">{activePet.name}</p>
                    <p className="text-[10px]" style={{ color:'var(--t3)' }}>{activePet.species}</p>
                    <div className="flex gap-1 mt-0.5">
                      {[...Array(Math.min(5,petLevel))].map((_,i)=>(
                        <Zap key={i} size={8} style={{ color:activePet.color }} fill={activePet.color}/>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] leading-relaxed" style={{ color:'rgba(255,255,255,.45)' }}>{activePet.description}</p>
              </div>

              {/* Needs */}
              <div className="space-y-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--t3)' }}>Состояние</p>
                <NBar label="Сытость"  v={needs.hunger}    c="#f59e0b" emoji="🍖"/>
                <NBar label="Счастье"  v={needs.happiness} c="#f43f5e" emoji="💖"/>
                <NBar label="Энергия"  v={needs.energy}    c="#22d3ee" emoji="⚡"/>
                <NBar label="Чистота"  v={needs.hygiene}   c="#34d399" emoji="🫧"/>
              </div>

              {/* Friendship */}
              <div className="rounded-xl p-3" style={{ background:'rgba(244,63,94,.08)', border:'1px solid rgba(244,63,94,.15)' }}>
                <div className="flex justify-between mb-1.5">
                  <p className="text-[10px] font-bold" style={{ color:'#f43f5e' }}>❤️ Дружба</p>
                  <p className="text-[10px]" style={{ color:'var(--t3)' }}>{friendship}/100</p>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,.08)' }}>
                  <div className="h-full rounded-full" style={{ width:friendship+'%', background:'linear-gradient(90deg,#f43f5e,#ec4899)' }}/>
                </div>
                <p className="text-[9px] mt-1.5" style={{ color:'rgba(255,255,255,.3)' }}>
                  {friendship<30?'Только познакомились':friendship<60?'Хорошие друзья':friendship<90?'Лучшие друзья':'Неразлучны! 💖'}
                </p>
              </div>

              {/* Items in room */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:'var(--t3)' }}>В комнате</p>
                <div className="flex flex-wrap gap-2">
                  {room.items.map(id=>(
                    <span key={id} className="text-xl" title={FURNI[id]?.label}>{FURNI[id]?.emoji??'?'}</span>
                  ))}
                </div>
              </div>

              {/* Tip */}
              <div className="rounded-xl px-3 py-2.5" style={{ background:'rgba(79,110,247,.08)', border:'1px solid rgba(79,110,247,.15)' }}>
                <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color:'rgba(79,110,247,.8)' }}>💡 Совет</p>
                <p className="text-[10px] leading-relaxed" style={{ color:'rgba(255,255,255,.4)' }}>
                  Пиши сообщения в чате — питомец получает монеты! 5 сообщений = 🪙3
                </p>
              </div>
            </>}

            {/* ── SHOP ─── */}
            {panel==='shop' && <>
              {shopMsg && (
                <div className="rounded-xl px-3 py-2 text-xs font-bold text-center"
                  style={{ background:shopMsg.startsWith('✓')?'rgba(34,197,94,.1)':'rgba(244,63,94,.1)',
                    border:`1px solid ${shopMsg.startsWith('✓')?'rgba(34,197,94,.2)':'rgba(244,63,94,.2)'}`,
                    color:shopMsg.startsWith('✓')?'#22c55e':'#f43f5e' }}>{shopMsg}</div>
              )}
              {Object.entries(FURNI).map(([id,fd])=>{
                const owned=room.items.includes(id);
                const can=coins>=fd.price;
                return(
                  <div key={id} className="flex items-center gap-2.5 rounded-2xl p-3"
                    style={{ background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.07)' }}>
                    <span className="text-2xl shrink-0">{fd.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate text-white">{fd.label}</p>
                      <p className="text-[10px] truncate" style={{ color:'var(--t3)' }}>{fd.bonus}</p>
                    </div>
                    <motion.button whileTap={{ scale:.9 }} type="button"
                      onClick={()=>buyFurni(id)} disabled={owned}
                      className="shrink-0 rounded-xl px-2 py-1.5 text-[10px] font-black"
                      style={{
                        background:owned?'rgba(34,197,94,.12)':can||fd.price===0?'rgba(245,158,11,.15)':'rgba(255,255,255,.04)',
                        color:owned?'#22c55e':can||fd.price===0?'#f59e0b':'rgba(255,255,255,.2)',
                        border:`1px solid ${owned?'rgba(34,197,94,.2)':can||fd.price===0?'rgba(245,158,11,.2)':'rgba(255,255,255,.06)'}`,
                        cursor:owned?'default':'pointer',
                      }}>
                      {owned?'✓':fd.price===0?'Бесп.':`🪙${fd.price}`}
                    </motion.button>
                  </div>
                );
              })}
            </>}

            {/* ── THEMES ─── */}
            {panel==='themes' && <>
              {shopMsg && (
                <div className="rounded-xl px-3 py-2 text-xs font-bold text-center"
                  style={{ background:'rgba(34,197,94,.1)', color:'#22c55e', border:'1px solid rgba(34,197,94,.2)' }}>{shopMsg}</div>
              )}
              {Object.entries(THEMES).map(([key,td])=>{
                const active=room.theme===key;
                const can=coins>=td.price||td.price===0;
                return(
                  <div key={key} className="flex items-center gap-3 rounded-2xl p-3"
                    style={{ background:active?`${td.accent}15`:'rgba(255,255,255,.04)',
                      border:`1px solid ${active?td.accent+'35':'rgba(255,255,255,.07)'}` }}>
                    {/* mini preview */}
                    <div className="shrink-0 rounded-xl overflow-hidden" style={{ width:38, height:38 }}>
                      <div style={{ width:'100%', height:'55%', background:td.wall }}/>
                      <div style={{ width:'100%', height:'45%', background:td.floor }}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white">{td.emoji} {td.label}</p>
                      <p className="text-[10px]" style={{ color:'var(--t3)' }}>{td.price===0?'Бесплатно':`🪙${td.price}`}</p>
                    </div>
                    <motion.button whileTap={{ scale:.9 }} type="button" disabled={active}
                      onClick={()=>buyTheme(key)}
                      className="shrink-0 rounded-xl px-2 py-1.5 text-[10px] font-black"
                      style={{
                        background:active?`${td.accent}20`:can?'rgba(79,110,247,.15)':'rgba(255,255,255,.04)',
                        color:active?td.accent:can?'var(--accent)':'rgba(255,255,255,.2)',
                        border:`1px solid ${active?td.accent+'40':can?'rgba(79,110,247,.2)':'rgba(255,255,255,.06)'}`,
                        cursor:active?'default':'pointer',
                      }}>
                      {active?'✓':td.price===0?'Выбр.':`🪙${td.price}`}
                    </motion.button>
                  </div>
                );
              })}
            </>}

            {/* ── PETS ─── */}
            {panel==='pets' && <>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--t3)' }}>
                Питомцы ({prefs.owned.length}/{PETS.length})
              </p>
              {PETS.map(pet=>{
                const owned=prefs.owned.includes(pet.id);
                const active=prefs.active===pet.id;
                const xp=prefs.xp?.[pet.id]??0;
                return(
                  <motion.div key={pet.id} whileHover={owned?{x:2}:{}}
                    className="flex items-center gap-3 rounded-2xl p-3 cursor-pointer"
                    style={{ background:active?`${pet.color}14`:'rgba(255,255,255,.04)',
                      border:`1px solid ${active?pet.color+'35':'rgba(255,255,255,.07)'}`,
                      opacity:owned?1:.45 }}
                    onClick={()=>owned&&!active&&activatePet(pet.id)}>
                    <div className="relative shrink-0" style={{ filter:owned?undefined:'grayscale(100%)' }}>
                      <CSSPet pet={pet} state="idle" mood="idle" size={32}/>
                      {active && <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
                        style={{ background:'#22c55e', border:'1.5px solid rgba(0,0,0,.5)' }}/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-bold truncate text-white">{pet.name}</p>
                        {owned && <span className="text-[9px] font-bold" style={{ color:RARITY_CFG[pet.rarity].color }}>Lv.{lvl(xp)}</span>}
                      </div>
                      <p className="text-[10px] truncate" style={{ color:'var(--t3)' }}>
                        {owned?pet.species:'🔒 Не разблокирован'}
                      </p>
                      {owned && (
                        <div className="mt-1 h-0.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,.1)' }}>
                          <div className="h-full rounded-full" style={{ width:lvlPct(xp)+'%', background:pet.color }}/>
                        </div>
                      )}
                    </div>
                    {!owned && <span className="text-xs shrink-0">🔒</span>}
                  </motion.div>
                );
              })}
            </>}

          </div>
        </div>
      </div>
    </div>
  );
};
