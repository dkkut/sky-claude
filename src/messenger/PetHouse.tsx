/* ===================================================================
   SKY PET HOUSE  v5 — CSS-rendered pet · живая 3D комната
   Без Three.js · CSS transforms · плавный FPS
=================================================================== */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { X, ShoppingBag, Palette, Users, Heart, Zap, Coins, Sparkles } from 'lucide-react';
import {
  apiMyPets, apiCareForPet, apiPetWallet, apiSetActivePet,
  CARE_ACTION_EMOJI, CARE_ACTION_COOLDOWN,
  type PetInstance, type PetMood, type CareAction,
} from './petsApi';
import { petVisual, RARITY_VISUAL } from './petVisuals';
import { PetSkinShop } from './PetSkinShop';
import { useAuthStore } from '@/core/auth/store';

/* ── Storage ─────────────────────────────────────────────────────
   Комната (тема/мебель) — чисто декоративный, локальный слой: у Sky
   Pets на сервере (server/pets.mjs, petEconomy.mjs) нет понятия
   «мебель» или «тема комнаты», только сам питомец, его характеристики
   и настоящие Pet Coins. Выдумывать для декора серверную экономику
   никто не просил, а тратить настоящие Pet Coins на то, что сервер не
   видит, значило бы расходовать реальную валюту мимо её же учёта.
   Поэтому комната финансируется отдельными, чисто косметическими
   «очками уюта» (decorPoints) — свои, маленькие, никогда не смешиваются
   с показанным ниже настоящим балансом Pet Coins. */
const ROOM_KEY  = 'sky:pet:room:v3';
const DECOR_KEY = 'sky:pet:decor:v1';

interface RoomState { theme:string; items:string[]; }

const lsGet = (k:string,d:any) => { try{ const r=localStorage.getItem(k); return r?JSON.parse(r):d; }catch{ return d; }};
const lsSet = (k:string,v:any) => { try{ localStorage.setItem(k,JSON.stringify(v)); }catch{} };
const loadRoom  = ():RoomState=> lsGet(ROOM_KEY,{theme:'cozy',items:['bed','bookshelf','plant']});
const saveRoom  = (r:RoomState)=> lsSet(ROOM_KEY,r);
const getDecor  = (uid:string):number => { try{ return JSON.parse(localStorage.getItem(DECOR_KEY)||'{}')[uid]??0; }catch{ return 0; }};
const addDecor  = (uid:string,n:number)=>{ try{ const a=JSON.parse(localStorage.getItem(DECOR_KEY)||'{}'); a[uid]=(a[uid]??0)+n; lsSet(DECOR_KEY,a); }catch{} };
const spendDecor= (uid:string,n:number):boolean=>{ try{ const a=JSON.parse(localStorage.getItem(DECOR_KEY)||'{}'); if((a[uid]??0)<n)return false; a[uid]=(a[uid]??0)-n; lsSet(DECOR_KEY,a); return true; }catch{ return false; }};

/* Уровень/XP — те же формулы, что и на сервере (server/pets.mjs,
   xp_per_level_base=200 по умолчанию); реальные level/xp всегда с
   сервера, здесь только перевод в проценты для полоски. */
const xpForLevel = (level:number) => level*200;
const lvlPct = (level:number, xp:number) => Math.min(100, (xp / xpForLevel(level)) * 100);

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
const CSSPet = ({ color, state, mood, size=80 }: { color:string; state:PetState; mood:PetMood; size?:number }) => {
  const c  = color;
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

const Room = ({ petColor,theme,items,petState,petPos,petMood,onPetTap,onFurnitureTap }:{
  petColor:string; theme:typeof THEMES[string]; items:string[];
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
        {/* Пол — это настоящая 3D-плоскость (perspective+rotateX), а не
            плоская картинка: у родителя стоит transform-style:preserve-3d,
            и мышиный параллакс (rotateX/rotateY всей сцены) поворачивает
            всё в честном 3D. Ближний (нижний) край наклонённого пола
            физически выступает вперёд, к зрителю, — а питомец без
            собственного translateZ остаётся плоским на глубине 0 и на
            определённых углах наклона проваливается ЗА пол, будто тонет
            в нём. Раньше это лечилось только z-index, который в 3D-сцене
            с реальной глубиной не спасает: нужно явно вынести питомца
            вперёд по оси Z, а не понадеяться на порядок в разметке.
            translateZ ставим ДО scaleX — тогда отражение по X (взгляд
            питомца) не переворачивает знак сдвига по Z. */}
        <div className="absolute cursor-pointer" style={{
          left:petPos.x-36, top:petPos.y-56, zIndex:60,
          transform:`translateZ(64px) scaleX(${petPos.facing})`,
          filter:`drop-shadow(0 ${petState==='jump'?12:6}px ${petState==='jump'?28:14}px ${petColor}60)`,
        }} onClick={onPetTap}>
          <CSSPet color={petColor} state={petState} mood={petMood} size={80}/>
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
export interface PetHouseProps {
  onClose:()=>void;
  onSendSticker:(typeId:string,mood:PetMood,sound:string,petName:string,petColor:string)=>void;
}

export const PetHouse = ({ onClose, onSendSticker }:PetHouseProps) => {
  const { currentUserId } = useAuthStore();
  const uid = currentUserId ?? 'guest';

  const [pets,    setPets]   = useState<PetInstance[]|null>(null);
  const [activeId,setActiveId]=useState<string|null>(null);
  const [wallet,  setWallet] = useState(0);
  const [room,    setRoom]   = useState<RoomState>(loadRoom);
  const [decor,   setDecor]  = useState(()=>getDecor(uid));
  const [panel,   setPanel]  = useState<'info'|'shop'|'themes'|'pets'>('info');
  const [msg,     setMsg]    = useState('');
  const [shopMsg, setSM]     = useState('');
  const [cooldownUntil, setCooldownUntil] = useState<Partial<Record<CareAction,number>>>({});
  const [busyAction, setBusyAction] = useState<CareAction|null>(null);
  const [showMarket, setShowMarket] = useState(false);

  const [petState, setPetSt]  = useState<PetState>('idle');
  const [petMood,  setPetMd]  = useState<PetMood>('idle');
  const [petPos,   setPetPos] = useState({ x:220, y:258, facing:1 as -1|1 });
  const [particles,setParts]  = useState<{id:number;x:number;y:number;emoji:string}[]>([]);
  const stRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const pid   = useRef(0);

  // Комната нарисована в фиксированных пикселях (W×H) — на телефоне
  // это шире и выше, чем есть места в колонке сцены, а сама колонка
  // обрезает всё, что не влезло (overflow-hidden у общего родителя).
  // Раньше от этого пропадала не картинка целиком, а именно нижняя
  // половина — пол и стоящий на нём питомец, — потому что обрезка
  // симметричная (items-center), а не пропорциональное уменьшение.
  // Здесь считаем реальное свободное место и масштабируем всю сцену
  // (комнату вместе с частицами — они делят одну систему координат)
  // так, чтобы она целиком помещалась, вместо того чтобы обрезаться.
  const sceneColRef = useRef<HTMLDivElement>(null);
  const actionsRef  = useRef<HTMLDivElement>(null);
  const [sceneScale, setSceneScale] = useState(1);
  useEffect(() => {
    const col = sceneColRef.current;
    if (!col) return;
    const recalc = () => {
      const colRect = col.getBoundingClientRect();
      const actionsH = actionsRef.current?.getBoundingClientRect().height ?? 0;
      const reserveForBubbleAndGaps = 84; // речевой пузырь + отступы, даже когда сейчас скрыт
      const availW = colRect.width - 16;
      const availH = colRect.height - actionsH - reserveForBubbleAndGaps;
      const next = Math.min(1, availW / W, availH / H);
      setSceneScale(Number.isFinite(next) && next > 0 ? next : 1);
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(col);
    if (actionsRef.current) ro.observe(actionsRef.current);
    window.addEventListener('orientationchange', recalc);
    return () => { ro.disconnect(); window.removeEventListener('orientationchange', recalc); };
  }, []);

  const load = useCallback(async () => {
    const [petsR, walletR] = await Promise.all([apiMyPets(), apiPetWallet()]);
    if (petsR.ok && petsR.data) {
      setPets(petsR.data.pets);
      setActiveId(cur => cur ?? (petsR.data!.pets.find(p=>p.isActive) ?? petsR.data!.pets[0])?.id ?? null);
    }
    if (walletR.ok && walletR.data) setWallet(walletR.data.balance);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const activePet  = useMemo(() => pets?.find(p=>p.id===activeId) ?? pets?.[0] ?? null, [pets, activeId]);
  const visual     = useMemo(() => petVisual(activePet?.typeId ?? '', activePet?.type?.species), [activePet]);
  const petColor   = activePet?.type?.color ?? '#8b5cf6';
  const rarityCfg  = RARITY_VISUAL[activePet?.rarity ?? 'common'];
  const theme      = THEMES[room.theme]??THEMES.cozy;
  const rd = useCallback(()=>setDecor(getDecor(uid)),[uid]);
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

  const showMsg=(m:string,ms=2200)=>{ setMsg(m); setTimeout(()=>setMsg(''),ms); };

  /* Уход — настоящий запрос на сервер (server/pets.mjs::careForPet).
   *  Кулдаун/эффект на характеристики/XP/шанс Pet Coins считает только
   *  сервер — здесь только показ результата и локальный отсчёт между
   *  попытками, чтобы не долбить ручку без толку. */
  const doCare = useCallback(async (action: CareAction, state: PetState, mood: PetMood, reactionMsg: string) => {
    if (!activePet || busyAction) return;
    const remaining = (cooldownUntil[action] ?? 0) - Date.now();
    if (remaining > 0) { showMsg('Рано — питомец пока отдыхает от этого'); return; }

    setBusyAction(action);
    const r = await apiCareForPet(activePet.id, action);
    setBusyAction(null);

    if (!r.ok || !r.data || 'error' in r.data) {
      const remainingSeconds = (r.data && 'remainingSeconds' in r.data) ? r.data.remainingSeconds : undefined;
      if (remainingSeconds) setCooldownUntil(c => ({ ...c, [action]: Date.now() + remainingSeconds * 1000 }));
      showMsg('Не получилось — попробуй чуть позже');
      return;
    }

    const { pet: updated, coinsEarned, leveledUp } = r.data;
    setPets(prev => prev?.map(p => p.id===updated.id ? updated : p) ?? prev);
    setCooldownUntil(c => ({ ...c, [action]: Date.now() + CARE_ACTION_COOLDOWN[action]*1000 }));
    setPetSt(state); setPetMd(mood);
    spawn(CARE_ACTION_EMOJI[action]);
    showMsg(coinsEarned > 0 ? `${reactionMsg} · +${coinsEarned} 🪙` : reactionMsg);
    if (coinsEarned > 0) { setWallet(w => w + coinsEarned); spawn('🪙'); }
    if (leveledUp) { setTimeout(() => showMsg(`Новый уровень — ${updated.level}! 🎉`), 1400); }
    setTimeout(()=>{ setPetSt('idle'); setPetMd('idle'); },2200);
  }, [activePet, busyAction, cooldownUntil, spawn]);

  const handleFeed    = () => void doCare('feed', 'eat', 'happy', 'Ням-ням! Очень вкусно! 😋');
  const handlePlay     = () => void doCare('play', 'jump', 'excited', 'Ура! Играем! 🎉');
  const handlePetTap   = () => void doCare('pet', 'happy', (activePet?.loyalty ?? 0) > 70 ? 'love' : 'excited', 'Обнимашки! 🥰');
  const handleToy       = () => void doCare('toy', 'dance', 'happy', 'Любимая игрушка! 🧸');

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
    setTimeout(()=>{ setPetSt('idle'); setPetMd('idle'); },3000);
  },[spawn]);

  const handleSticker=()=>{
    if (!activePet) return;
    const mood:PetMood=petMood==='idle'?'happy':petMood;
    const sound = visual.sounds[Math.floor(Math.random()*visual.sounds.length)];
    onSendSticker(activePet.typeId, mood, sound, activePet.name, petColor);
    spawn('💌'); showMsg('Стикер отправлен! 💌');
    addDecor(uid,1); rd();
  };

  const buyFurni=(id:string)=>{
    const fd=FURNI[id]; if(!fd||room.items.includes(id))return;
    if(!spendDecor(uid,fd.price)){ setSM('❌ Недостаточно очков уюта!'); setTimeout(()=>setSM(''),1800); return; }
    rd(); const nr={...room,items:[...room.items,id]}; setRoom(nr); saveRoom(nr);
    setSM(`✓ ${fd.label} куплен!`); setTimeout(()=>setSM(''),1800);
    spawn('🎁',W/2+120,180);
  };

  const buyTheme=(key:string)=>{
    const td=THEMES[key]; if(!td||room.theme===key)return;
    if(td.price>0&&!spendDecor(uid,td.price)){ setSM('❌ Недостаточно очков уюта!'); setTimeout(()=>setSM(''),1800); return; }
    if(td.price>0) rd();
    const nr={...room,theme:key}; setRoom(nr); saveRoom(nr);
    setSM(`✓ Тема «${td.label}» применена!`); setTimeout(()=>setSM(''),1800);
  };

  const activatePet=(id:string)=>{
    setActiveId(id);
    void apiSetActivePet(id);
    const p=pets?.find(x=>x.id===id);
    if(p){ showMsg(`Привет! Я ${p.name}! 👋`); }
  };

  const PANEL_TABS = [
    {k:'info',   icon:<Heart size={13}/>,   label:'Питомец'},
    {k:'shop',   icon:<ShoppingBag size={13}/>, label:'Магазин'},
    {k:'themes', icon:<Palette size={13}/>, label:'Темы'},
    {k:'pets',   icon:<Users size={13}/>,   label:'Питомцы'},
  ] as const;

  if (pets === null) {
    return (
      <div className="fixed inset-0 z-[300] flex items-center justify-center" style={{ background:'rgba(0,0,0,.92)' }}>
        <p className="text-sm" style={{ color:'rgba(255,255,255,.5)' }}>Загрузка питомцев…</p>
      </div>
    );
  }
  if (!activePet) {
    return (
      <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center gap-3" style={{ background:'rgba(0,0,0,.92)' }}>
        <p className="text-3xl">🐾</p>
        <p className="text-sm" style={{ color:'rgba(255,255,255,.6)' }}>Питомца пока нет — загляни в Магазин.</p>
        <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-xs font-bold"
          style={{ background:'rgba(255,255,255,.08)', color:'#fff' }}>Закрыть</button>
      </div>
    );
  }

  const petXP = activePet.xp, petLevel = activePet.level;
  const petLvlPct = lvlPct(petLevel, petXP);
  const xpNeeded = xpForLevel(petLevel);

  return (
    <div className="fixed inset-0 z-[300] flex flex-col overflow-hidden"
      style={{ background:'rgba(0,0,0,.92)', backdropFilter:'blur(20px)' }}>
      <style>{CSS_ANIM}</style>

      {/* ── HEADER ──────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 pb-3 shrink-0"
        style={{ borderBottom:'1px solid rgba(255,255,255,.08)', background:'rgba(0,0,0,.4)', paddingTop: 'calc(var(--safe-top) + 12px)' }}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <CSSPet color={petColor} state="idle" mood={petMood} size={36}/>
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2"
              style={{ background:'#22c55e', borderColor:'rgba(0,0,0,.8)' }}/>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-black text-white">{activePet.name}</p>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background:`${rarityCfg.color}22`, color:rarityCfg.color }}>
                Lv.{petLevel} · {rarityCfg.label}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="w-28 h-1.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,.1)' }}>
                <div className="h-full rounded-full" style={{ width:petLvlPct+'%', background:`linear-gradient(90deg,${petColor},#22d3ee)` }}/>
              </div>
              <span className="text-[10px]" style={{ color:'var(--t3)' }}>{petXP}/{xpNeeded} XP</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => setShowMarket(true)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ background:'rgba(245,158,11,.12)', border:'1px solid rgba(245,158,11,.2)', cursor:'pointer' }}
            title="Настоящие Pet Coins — открыть Sky Skin Market">
            <Coins size={14} style={{ color:'#f59e0b' }}/>
            <span className="text-sm font-black" style={{ color:'#f59e0b' }}>{wallet}</span>
            <Sparkles size={11} style={{ color:'#f59e0b', opacity:.7 }}/>
          </button>
          <div className="flex items-center gap-1 rounded-full px-2.5 py-1.5"
            style={{ background:'rgba(244,63,94,.1)', border:'1px solid rgba(244,63,94,.2)' }} title="Привязанность питомца">
            <span className="text-sm">❤️</span>
            <span className="text-xs font-bold" style={{ color:'#f43f5e' }}>{activePet.loyalty}</span>
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
        <div ref={sceneColRef} className="flex-1 flex flex-col items-center justify-center relative p-4 min-w-0">
          {/* Внешняя обёртка занимает реальное (уменьшенное) место в
              раскладке, внутренняя — исходные W×H с CSS-масштабом:
              комната и частицы остаются в одной системе координат. */}
          <div style={{ width: W * sceneScale, height: H * sceneScale, position: 'relative' }}>
            <div style={{ width: W, height: H, position: 'relative', transform: `scale(${sceneScale})`, transformOrigin: 'top left' }}>
              <Room
                petColor={petColor} theme={theme} items={room.items}
                petState={petState} petPos={petPos} petMood={petMood}
                onPetTap={handlePetTap} onFurnitureTap={handleFurnitureTap}
              />

              {/* Particles */}
              {particles.map(p=>(
                <Particle key={p.id} x={p.x} y={p.y} emoji={p.emoji}
                  done={()=>setParts(ps=>ps.filter(x=>x.id!==p.id))}/>
              ))}
            </div>
          </div>

          {/* Speech bubble */}
          <AnimatePresence>
            {msg && (
              <motion.div
                initial={{ opacity:0, y:14, scale:.85 }} animate={{ opacity:1, y:0, scale:1 }}
                exit={{ opacity:0, y:-8 }} transition={{ type:'spring', stiffness:420, damping:26 }}
                className="mt-3 rounded-3xl px-5 py-3 text-sm font-bold text-white text-center relative"
                style={{ background:`linear-gradient(135deg,${petColor}dd,${petColor}99)`,
                  boxShadow:`0 6px 24px ${petColor}55`, maxWidth:320, backdropFilter:'blur(10px)',
                  border:'1px solid rgba(255,255,255,.15)' }}>
                {/* Tail */}
                <div className="absolute -top-2 left-1/2 w-4 h-4 rotate-45 -translate-x-1/2"
                  style={{ background:petColor }}/>
                {msg}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action buttons — настоящий уход через server/pets.mjs::careForPet,
              кроме «Стикер» (просто отправка в чат, без сервера). */}
          <div ref={actionsRef} className="flex flex-wrap justify-center gap-2 mt-4">
            {([
              {action:'feed' as const,icon:CARE_ACTION_EMOJI.feed,label:'Кормить', run:handleFeed,  color:'#f59e0b'},
              {action:'play' as const,icon:CARE_ACTION_EMOJI.play,label:'Играть',  run:handlePlay,  color:'#8b5cf6'},
              {action:'toy' as const, icon:CARE_ACTION_EMOJI.toy, label:'Игрушка', run:handleToy,   color:'#22d3ee'},
              {action:null,            icon:'💌',                  label:'Стикер',  run:handleSticker, color:'#f43f5e'},
              {action:'pet' as const,  icon:CARE_ACTION_EMOJI.pet, label:'Обнять',  run:handlePetTap, color:'#ec4899'},
            ]).map(({icon,label,run,color,action})=>{
              const cdRemaining = action ? (cooldownUntil[action] ?? 0) - Date.now() : 0;
              const onCooldown = cdRemaining > 0;
              return (
                <motion.button key={label} type="button" disabled={onCooldown || busyAction!==null}
                  whileHover={!onCooldown ? { scale:1.1, y:-3 } : {}} whileTap={!onCooldown ? { scale:.88 } : {}}
                  onClick={run}
                  className="flex flex-col items-center gap-1 rounded-2xl px-3 py-2.5 disabled:opacity-40"
                  style={{ background:'rgba(255,255,255,.06)', border:`1px solid ${color}28`, cursor:onCooldown?'default':'pointer', minWidth:54 }}>
                  <span style={{ fontSize:20 }}>{busyAction===action ? '⏳' : icon}</span>
                  <span className="text-[9px] font-bold whitespace-nowrap" style={{ color:'rgba(255,255,255,.65)' }}>{label}</span>
                  {onCooldown && <span className="text-[8px]" style={{ color:'rgba(255,255,255,.4)' }}>{Math.ceil(cdRemaining/60000)}м</span>}
                </motion.button>
              );
            })}
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
                  borderBottom:panel===t.k?`2px solid ${petColor}`:'2px solid transparent',
                  color:panel===t.k?'#fff':'rgba(255,255,255,.3)', cursor:'pointer' }}>
                <span style={{ color:panel===t.k?petColor:'rgba(255,255,255,.35)' }}>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3.5" style={{ scrollbarWidth:'none' }}>

            {/* ── PET INFO ─── */}
            {panel==='info' && <>
              {/* Mini pet card */}
              <div className="rounded-2xl p-4" style={{ background:`${petColor}10`, border:`1px solid ${petColor}25` }}>
                <div className="flex items-center gap-3 mb-2">
                  <CSSPet color={petColor} state="idle" mood="happy" size={44}/>
                  <div>
                    <p className="text-sm font-black text-white">{activePet.name}</p>
                    <p className="text-[10px]" style={{ color:'var(--t3)' }}>{activePet.type?.species ?? ''}</p>
                    <div className="flex gap-1 mt-0.5">
                      {[...Array(Math.min(5,petLevel))].map((_,i)=>(
                        <Zap key={i} size={8} style={{ color:petColor }} fill={petColor}/>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] leading-relaxed" style={{ color:'rgba(255,255,255,.45)' }}>{activePet.type?.description ?? ''}</p>
              </div>

              {/* Характеристики — настоящие, с сервера (server/pets.mjs). */}
              <div className="space-y-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--t3)' }}>Состояние</p>
                <NBar label="Сытость"  v={activePet.hunger}    c="#f59e0b" emoji="🍖"/>
                <NBar label="Счастье"  v={activePet.happiness} c="#f43f5e" emoji="💖"/>
                <NBar label="Энергия"  v={activePet.energy}    c="#22d3ee" emoji="⚡"/>
                <NBar label="Привязанность" v={activePet.loyalty} c="#a855f7" emoji="🫶"/>
              </div>

              {/* Привязанность — то же поле, что и бейдж в хедере (loyalty). */}
              <div className="rounded-xl p-3" style={{ background:'rgba(244,63,94,.08)', border:'1px solid rgba(244,63,94,.15)' }}>
                <div className="flex justify-between mb-1.5">
                  <p className="text-[10px] font-bold" style={{ color:'#f43f5e' }}>❤️ Привязанность</p>
                  <p className="text-[10px]" style={{ color:'var(--t3)' }}>{activePet.loyalty}/100</p>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,.08)' }}>
                  <div className="h-full rounded-full" style={{ width:activePet.loyalty+'%', background:'linear-gradient(90deg,#f43f5e,#ec4899)' }}/>
                </div>
                <p className="text-[9px] mt-1.5" style={{ color:'rgba(255,255,255,.3)' }}>
                  {activePet.loyalty<30?'Только познакомились':activePet.loyalty<60?'Хорошие друзья':activePet.loyalty<90?'Лучшие друзья':'Неразлучны! 💖'}
                </p>
              </div>

              {/* Items in room — чисто декоративная комната, см. комментарий у ROOM_KEY. */}
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
                  Уход (кормить/играть/обнять/игрушка) иногда приносит настоящие Pet Coins — их можно потратить в Sky Skin Market.
                </p>
              </div>
            </>}

            {/* ── SHOP (мебель) ───────────────────────────────────────
                Чисто декоративная, за локальные «очки уюта» — у этого
                обустройства нет серверного аналога (см. комментарий у
                ROOM_KEY), поэтому ценник не трогает настоящие Pet Coins. */}
            {panel==='shop' && <>
              <p className="text-[9px]" style={{ color:'rgba(255,255,255,.35)' }}>
                За очки уюта (сейчас: {decor}) — зарабатываются отправкой стикеров в чат. Отдельно от настоящих Pet Coins выше.
              </p>
              {shopMsg && (
                <div className="rounded-xl px-3 py-2 text-xs font-bold text-center"
                  style={{ background:shopMsg.startsWith('✓')?'rgba(34,197,94,.1)':'rgba(244,63,94,.1)',
                    border:`1px solid ${shopMsg.startsWith('✓')?'rgba(34,197,94,.2)':'rgba(244,63,94,.2)'}`,
                    color:shopMsg.startsWith('✓')?'#22c55e':'#f43f5e' }}>{shopMsg}</div>
              )}
              {Object.entries(FURNI).map(([id,fd])=>{
                const owned=room.items.includes(id);
                const can=decor>=fd.price;
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
                      {owned?'✓':fd.price===0?'Бесп.':`✨${fd.price}`}
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
                const can=decor>=td.price||td.price===0;
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
                      <p className="text-[10px]" style={{ color:'var(--t3)' }}>{td.price===0?'Бесплатно':`✨${td.price}`}</p>
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
                      {active?'✓':td.price===0?'Выбр.':`✨${td.price}`}
                    </motion.button>
                  </div>
                );
              })}
            </>}

            {/* ── PETS ─── */}
            {panel==='pets' && <>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color:'var(--t3)' }}>
                Питомцы ({pets.length})
              </p>
              {pets.map(p=>{
                const active=p.id===activeId;
                const rc = RARITY_VISUAL[p.rarity];
                const color = p.type?.color ?? '#8b5cf6';
                return(
                  <motion.div key={p.id} whileHover={{x:2}}
                    className="flex items-center gap-3 rounded-2xl p-3 cursor-pointer"
                    style={{ background:active?`${color}14`:'rgba(255,255,255,.04)',
                      border:`1px solid ${active?color+'35':'rgba(255,255,255,.07)'}` }}
                    onClick={()=>!active&&activatePet(p.id)}>
                    <div className="relative shrink-0">
                      <CSSPet color={color} state="idle" mood="idle" size={32}/>
                      {active && <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
                        style={{ background:'#22c55e', border:'1.5px solid rgba(0,0,0,.5)' }}/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-bold truncate text-white">{p.name}</p>
                        <span className="text-[9px] font-bold" style={{ color:rc.color }}>Lv.{p.level}</span>
                      </div>
                      <p className="text-[10px] truncate" style={{ color:'var(--t3)' }}>
                        {p.type?.species ?? ''}
                      </p>
                      <div className="mt-1 h-0.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,.1)' }}>
                        <div className="h-full rounded-full" style={{ width:lvlPct(p.level,p.xp)+'%', background:color }}/>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              {pets.length===0 && (
                <p className="py-6 text-center text-[11px]" style={{ color:'var(--t3)' }}>Пока пусто — загляни в «Магазин».</p>
              )}
            </>}

          </div>
        </div>
      </div>

      <AnimatePresence>
        {showMarket && (
          <PetSkinShop activePetId={activePet.id} onClose={() => setShowMarket(false)}
            onEquipped={() => void load()} />
        )}
      </AnimatePresence>
    </div>
  );
};
