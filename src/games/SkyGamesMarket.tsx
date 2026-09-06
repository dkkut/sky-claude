/* ===============================================================
   SKY GAMES MARKETPLACE  -  загрузка, модерация, запуск игр
=============================================================== */
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, Play, Star, Download, Check, X,
  Code2, ChevronLeft, Users, Eye, Plus, Shield,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { create } from 'zustand';

type GameStatus = 'pending' | 'approved' | 'rejected';
type GameType   = '2d' | '3d' | 'web';

interface GameEntry {
  id:          string;
  title:       string;
  description: string;
  authorId:    string;
  authorName:  string;
  type:        GameType;
  status:      GameStatus;
  codeType:    'html' | 'js' | 'ts' | 'react';
  codeSize:    string;
  coverEmoji:  string;
  genre:       string;
  downloads:   number;
  plays:       number;
  rating:      number;
  ratings:     number;
  createdAt:   string;
  rejectedReason?: string;
  // Runtime
  sourceCode?: string;  // the actual game code
}

const SEED_GAMES: GameEntry[] = [
  {
    id:'g1', title:'Snake Classic', description:'Классическая змейка на HTML5 Canvas.',
    authorId:'neo', authorName:'Neo', type:'2d', status:'approved',
    codeType:'html', codeSize:'8 КБ', coverEmoji:'🐍', genre:'Аркада',
    downloads:1240, plays:8900, rating:4.7, ratings:234, createdAt:new Date(Date.now()-7*86400000).toISOString(),
    sourceCode:`<!DOCTYPE html><html><head><title>Snake</title><style>body{margin:0;background:#111;display:flex;justify-content:center;align-items:center;height:100vh;}canvas{border:2px solid #4f6ef7;}</style></head><body><canvas id="c" width="400" height="400"></canvas><script>const c=document.getElementById('c'),ctx=c.getContext('2d');let s=[{x:10,y:10}],d={x:1,y:0},f={x:5,y:5},sc=0;document.addEventListener('keydown',e=>{if(e.key==='ArrowUp'&&d.y!==1)d={x:0,y:-1};if(e.key==='ArrowDown'&&d.y!==-1)d={x:0,y:1};if(e.key==='ArrowLeft'&&d.x!==1)d={x:-1,y:0};if(e.key==='ArrowRight'&&d.x!==-1)d={x:1,y:0};});function loop(){ctx.fillStyle='#111';ctx.fillRect(0,0,400,400);s.unshift({x:s[0].x+d.x,y:s[0].y+d.y});if(s[0].x===f.x&&s[0].y===f.y){sc++;f={x:Math.floor(Math.random()*20),y:Math.floor(Math.random()*20)};}else s.pop();if(s[0].x<0||s[0].x>=20||s[0].y<0||s[0].y>=20){s=[{x:10,y:10}];d={x:1,y:0};sc=0;}ctx.fillStyle='var(--accent)';s.forEach(p=>ctx.fillRect(p.x*20,p.y*20,18,18));ctx.fillStyle='var(--green)';ctx.fillRect(f.x*20,f.y*20,18,18);ctx.fillStyle='white';ctx.font='16px Arial';ctx.fillText('Score: '+sc,8,20);}setInterval(loop,100);</script></body></html>`,
  },
  {
    id:'g2', title:'Space Shooter', description:'Уничтожай астероиды и набирай очки!',
    authorId:'kutuzov', authorName:'Kutuzov', type:'2d', status:'approved',
    codeType:'html', codeSize:'12 КБ', coverEmoji:'🚀', genre:'Шутер',
    downloads:2100, plays:15400, rating:4.8, ratings:412, createdAt:new Date(Date.now()-3*86400000).toISOString(),
    sourceCode:`<!DOCTYPE html><html><head><title>Space</title><style>body{margin:0;background:#000;overflow:hidden;}</style></head><body><canvas id="c"></canvas><script>const c=document.getElementById('c');c.width=window.innerWidth;c.height=window.innerHeight;const ctx=c.getContext('2d');let ship={x:c.width/2,y:c.height-80,w:30,h:40},bullets=[],asteroids=[],sc=0,keys={};document.addEventListener('keydown',e=>keys[e.key]=true);document.addEventListener('keyup',e=>keys[e.key]=false);let lastBullet=0;function rand(a,b){return Math.random()*(b-a)+a;}for(let i=0;i<8;i++)asteroids.push({x:rand(0,c.width),y:rand(-200,-50),r:rand(20,45),dx:rand(-1,1),dy:rand(1,3)});function loop(){ctx.fillStyle='#000';ctx.fillRect(0,0,c.width,c.height);if(keys['ArrowLeft']&&ship.x>0)ship.x-=5;if(keys['ArrowRight']&&ship.x<c.width-ship.w)ship.x+=5;if(keys[' ']&&Date.now()-lastBullet>200){bullets.push({x:ship.x+ship.w/2,y:ship.y});lastBullet=Date.now();}ctx.fillStyle='var(--accent)';ctx.beginPath();ctx.moveTo(ship.x+ship.w/2,ship.y);ctx.lineTo(ship.x,ship.y+ship.h);ctx.lineTo(ship.x+ship.w,ship.y+ship.h);ctx.fill();bullets=bullets.filter(b=>{b.y-=8;ctx.fillStyle='var(--amber)';ctx.fillRect(b.x-2,b.y,4,10);return b.y>0;});asteroids.forEach((a,i)=>{a.x+=a.dx;a.y+=a.dy;if(a.y>c.height+50){a.y=-50;a.x=rand(0,c.width);}ctx.strokeStyle='var(--t2)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(a.x,a.y,a.r,0,Math.PI*2);ctx.stroke();bullets.forEach((b,j)=>{if(Math.hypot(b.x-a.x,b.y-a.y)<a.r){asteroids.splice(i,1);bullets.splice(j,1);sc+=10;asteroids.push({x:rand(0,c.width),y:-50,r:rand(20,45),dx:rand(-1,1),dy:rand(1,3)});}});});ctx.fillStyle='white';ctx.font='20px Arial';ctx.fillText('Score: '+sc,10,30);}setInterval(loop,1000/60);</script></body></html>`,
  },
];

const SK = 'sky:gamestore:v1';
const load = ():GameEntry[] => { try{const s=JSON.parse(localStorage.getItem(SK)||'[]');return[...SEED_GAMES,...s.filter((g:any)=>!SEED_GAMES.find(sg=>sg.id===g.id))];}catch{return SEED_GAMES;} };
const save = (g:GameEntry[]) => { try{localStorage.setItem(SK,JSON.stringify(g.filter(x=>!SEED_GAMES.find(s=>s.id===x.id))));}catch{} };

interface GameStoreState {
  games: GameEntry[];
  upload:   (g:Omit<GameEntry,'id'|'createdAt'|'downloads'|'plays'|'rating'|'ratings'|'status'>)=>string;
  approve:  (id:string)=>void;
  reject:   (id:string,reason:string)=>void;
  play:     (id:string)=>void;
  download: (id:string)=>void;
  rate:     (id:string,stars:number)=>void;
}
export const useGameStore = create<GameStoreState>((set,get)=>({
  games: load(),
  upload:(params)=>{
    const id=`gm-${Date.now()}`;
    const g:GameEntry={...params,id,status:'pending',createdAt:new Date().toISOString(),downloads:0,plays:0,rating:0,ratings:0};
    const next=[...get().games,g]; save(next); set({games:next}); return id;
  },
  approve:(id)=>{ const next=get().games.map(g=>g.id===id?{...g,status:'approved' as const}:g); save(next); set({games:next}); },
  reject:(id,reason)=>{ const next=get().games.map(g=>g.id===id?{...g,status:'rejected' as const,rejectedReason:reason}:g); save(next); set({games:next}); },
  play:(id)=>{ const next=get().games.map(g=>g.id===id?{...g,plays:g.plays+1}:g); set({games:next}); },
  download:(id)=>{ const next=get().games.map(g=>g.id===id?{...g,downloads:g.downloads+1}:g); set({games:next}); },
  rate:(id,stars)=>{ const next=get().games.map(g=>g.id===id?{...g,rating:(g.rating*g.ratings+stars)/(g.ratings+1),ratings:g.ratings+1}:g); set({games:next}); },
}));

const C = { bg:'#0a0a0f',l1:'#111118',l2:'var(--bg-l2)',border:'var(--border)',t1:'var(--t1)',t2:'var(--t2)',t3:'var(--t3)',accent:'var(--accent)',green:'var(--green)',amber:'var(--amber)',red:'var(--red)' };
const CODE_TYPES: GameEntry['codeType'][] = ['html','js','ts','react'];
const GENRES = ['Аркада','Шутер','Платформер','Головоломка','RPG','Стратегия','Гонки','Другое'];
const TYPES: {key:GameType,label:string,icon:string}[] = [
  {key:'2d',label:'2D игра',icon:'🎮'},{key:'3d',label:'3D игра',icon:'🧊'},{key:'web',label:'Web-игра',icon:'🌐'},
];

/* -- Game Card -------------------------------------------- */
const GameCard = ({g, onPlay}: {g:GameEntry; onPlay:()=>void}) => (
  <motion.div whileTap={{scale:.97}} className="rounded-2xl overflow-hidden" style={{background:C.l1,border:`1px solid ${C.border}`}}>
    <div className="h-28 flex items-center justify-center text-5xl" style={{background:C.l2}}>
      {g.coverEmoji}
    </div>
    <div className="p-3">
      <div className="flex items-start justify-between gap-1 mb-1">
        <p className="text-sm font-bold text-white leading-tight">{g.title}</p>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-bold"
          style={{background:`${C.accent}15`,color:C.accent}}>{g.type.toUpperCase()}</span>
      </div>
      <p className="text-[10px] truncate mb-2" style={{color:C.t3}}>{g.genre} · {g.authorName}</p>
      <div className="flex items-center gap-2 mb-2 text-[10px]" style={{color:C.t3}}>
        <span>▶ {g.plays.toLocaleString('ru')}</span>
        <span>⬇ {g.downloads.toLocaleString('ru')}</span>
        {g.ratings>0&&<span>⭐ {g.rating.toFixed(1)}</span>}
      </div>
      <motion.button whileTap={{scale:.94}} type="button" onClick={onPlay}
        className="flex items-center justify-center gap-1.5 w-full rounded-xl py-2 text-xs font-bold text-white"
        style={{background:C.accent}}>
        <Play size={12}/>Играть
      </motion.button>
    </div>
  </motion.div>
);

/* -- Game Player ------------------------------------------ */
const GamePlayer = ({g, onBack}: {g:GameEntry; onBack:()=>void}) => {
  const {play} = useGameStore();
  useState(()=>{play(g.id);});
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{background:'#000'}}>
      <div className="flex items-center gap-2 px-4 py-2 shrink-0" style={{background:C.l1}}>
        <button type="button" onClick={onBack} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10">
          <ChevronLeft size={16} style={{color:C.t2}}/></button>
        <span className="text-xl">{g.coverEmoji}</span>
        <p className="text-sm font-bold text-white flex-1">{g.title}</p>
        <span className="text-[10px]" style={{color:C.t3}}>▶ {g.plays.toLocaleString('ru')}</span>
      </div>
      {g.sourceCode ? (
        <iframe
          srcDoc={g.sourceCode} className="flex-1 w-full border-0" title={g.title}
          sandbox="allow-scripts allow-same-origin"
          style={{background:'#111'}}/>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <span className="text-6xl">{g.coverEmoji}</span>
          <p className="text-sm" style={{color:C.t3}}>Файл игры недоступен</p>
        </div>
      )}
    </div>
  );
};

/* -- Upload Form ------------------------------------------ */
const UploadGame = ({onDone}: {onDone:()=>void}) => {
  const {currentUserId,accounts} = useAuthStore();
  const {upload} = useGameStore();
  const me = accounts.find(a=>a.id===currentUserId);
  const [title,setTitle]=useState('');
  const [desc,setDesc]=useState('');
  const [type,setType]=useState<GameType>('2d');
  const [genre,setGenre]=useState(GENRES[0]);
  const [codeType,setCodeType]=useState<GameEntry['codeType']>('html');
  const [emoji,setEmoji]=useState('🎮');
  const [code,setCode]=useState('');
  const [err,setErr]=useState('');
  const [tab,setTab]=useState<'info'|'code'>('info');

  const handleSubmit = () => {
    setErr('');
    if(!title.trim()){setErr('Укажите название');return;}
    if(!code.trim()){setErr('Вставьте код игры');return;}
    upload({
      title:title.trim(),description:desc.trim(),authorId:currentUserId??'',authorName:me?.name??'',
      type,genre,codeType,coverEmoji:emoji,codeSize:`${(new Blob([code]).size/1024).toFixed(0)} КБ`,sourceCode:code,
    });
    onDone();
  };

  const iSty = {background:C.l2,border:`1px solid ${C.border}`,color:C.t1};

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{background:C.bg}}>
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{borderColor:C.border}}>
        <button type="button" onClick={onDone} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={16} style={{color:C.t2}}/></button>
        <p className="text-sm font-bold text-white">Загрузить игру</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b shrink-0" style={{borderColor:C.border}}>
        {([['info','📝 Информация'],['code','💻 Код игры']] as const).map(([k,l])=>(
          <button key={k} type="button" onClick={()=>setTab(k)}
            className="flex-1 py-2.5 text-xs font-semibold"
            style={{borderBottom:tab===k?`2px solid ${C.accent}`:'2px solid transparent',
              color:tab===k?C.accent:C.t3}}>
            {l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{scrollbarWidth:'none'}}>
        {tab==='info'&&(
          <>
            {/* Emoji + Title */}
            <div className="flex gap-3">
              <input value={emoji} onChange={e=>setEmoji(e.target.value)} maxLength={2}
                className="w-14 rounded-xl text-3xl text-center outline-none" style={iSty}/>
              <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название игры *"
                className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={iSty}/>
            </div>
            <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={3} placeholder="Описание..."
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none" style={iSty}/>
            {/* Type */}
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map(t=>(
                <button key={t.key} type="button" onClick={()=>setType(t.key)}
                  className="flex flex-col items-center gap-1 rounded-xl py-2.5 text-center transition-all"
                  style={{background:type===t.key?`${C.accent}15`:C.l2,
                    border:`1.5px solid ${type===t.key?C.accent:C.border}`,
                    color:type===t.key?C.accent:C.t3}}>
                  <span className="text-lg">{t.icon}</span>
                  <span className="text-[10px] font-semibold">{t.label}</span>
                </button>
              ))}
            </div>
            {/* Genre */}
            <div className="flex flex-wrap gap-1.5">
              {GENRES.map(g=>(
                <button key={g} type="button" onClick={()=>setGenre(g)}
                  className="rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all"
                  style={{background:genre===g?`${C.accent}15`:'rgba(255,255,255,0.05)',
                    border:`1px solid ${genre===g?C.accent:'var(--border)'}`,
                    color:genre===g?C.accent:C.t3}}>
                  {g}
                </button>
              ))}
            </div>
          </>
        )}
        {tab==='code'&&(
          <>
            {/* Code type */}
            <div className="flex rounded-xl overflow-hidden" style={{border:`1px solid ${C.border}`}}>
              {CODE_TYPES.map((t,i)=>(
                <button key={t} type="button" onClick={()=>setCodeType(t)}
                  className="flex-1 py-2 text-[11px] font-bold transition-all"
                  style={{background:codeType===t?C.accent:'transparent',
                    color:codeType===t?'white':C.t3,
                    borderRight:i<CODE_TYPES.length-1?`1px solid ${C.border}`:'none'}}>
                  .{t}
                </button>
              ))}
            </div>
            <div className="rounded-xl px-3 py-2.5 text-[10px] leading-relaxed"
              style={{background:`${C.accent}06`,border:`1px solid ${C.accent}20`,color:C.t2}}>
              💡 Вставьте полный код игры. HTML-игры запускаются прямо в браузере через iframe. Используйте Canvas API, WebGL или чистый JavaScript.
            </div>
            <textarea value={code} onChange={e=>setCode(e.target.value)} rows={18}
              placeholder={codeType==='html'?`<!DOCTYPE html>\n<html>\n<head><title>Моя игра</title></head>\n<body>\n  <!-- Код игры -->\n</body>\n</html>`:`// Код вашей игры\nfunction gameLoop() {\n  // ...\n}`}
              className="w-full rounded-xl px-3 py-3 text-xs font-mono outline-none resize-none"
              style={{...iSty,lineHeight:1.5}}/>
            {code&&<p className="text-[10px]" style={{color:C.t3}}>Размер: {(new Blob([code]).size/1024).toFixed(1)} КБ</p>}
          </>
        )}

        {err&&<p className="text-xs text-center" style={{color:C.red}}>{err}</p>}

        <motion.button whileTap={{scale:.97}} type="button" onClick={handleSubmit}
          className="w-full rounded-2xl py-4 text-sm font-bold text-white"
          style={{background:`linear-gradient(135deg,${C.accent},#818cf8)`,boxShadow:`0 6px 24px ${C.accent}30`}}>
          🚀 Отправить на модерацию
        </motion.button>

        <p className="text-[10px] text-center" style={{color:C.t3}}>
          Игра будет проверена администраторами и опубликована в течение 24 часов
        </p>
      </div>
    </div>
  );
};

/* === MAIN ================================================== */
export const SkyGamesMarket = () => {
  const {games} = useGameStore();
  const [view, setView] = useState<'list'|'upload'|'play'>('list');
  const [playing, setPlaying] = useState<GameEntry|null>(null);
  const [filter, setFilter] = useState<'all'|'2d'|'3d'|'web'>('all');
  const [search, setSearch] = useState('');

  if (view==='upload') return <UploadGame onDone={()=>setView('list')}/>;
  if (view==='play'&&playing) return <GamePlayer g={playing} onBack={()=>{setView('list');setPlaying(null);}}/>;

  const approved = games.filter(g=>g.status==='approved'&&(filter==='all'||g.type===filter)&&(!search||(g.title+g.genre+g.authorName).toLowerCase().includes(search.toLowerCase())));
  const myGames  = games.filter(g=>g.authorId===useAuthStore.getState().currentUserId);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{background:C.bg}}>
      <div className="px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-lg font-black text-white">Sky Games</p>
            <p className="text-xs" style={{color:C.t3}}>{approved.length} игр доступно</p>
          </div>
          <motion.button whileTap={{scale:.94}} type="button" onClick={()=>setView('upload')}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white"
            style={{background:C.accent}}><Plus size={13}/>Создать</motion.button>
        </div>
        {/* Search */}
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-2" style={{background:C.l1,border:`1px solid ${C.border}`}}>
          <Code2 size={12} style={{color:C.t3}}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск игр..."
            className="flex-1 bg-transparent text-xs outline-none" style={{color:C.t1}}/>
        </div>
        {/* Filter */}
        <div className="flex gap-1.5">
          {(['all','2d','3d','web'] as const).map(f=>(
            <button key={f} type="button" onClick={()=>setFilter(f)}
              className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all"
              style={{background:filter===f?C.accent:'var(--border)',color:filter===f?'white':C.t3}}>
              {f==='all'?'🎮 Все':f==='2d'?'🎮 2D':f==='3d'?'🧊 3D':'🌐 Web'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{scrollbarWidth:'none'}}>
        {/* My games */}
        {myGames.length>0&&(
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{color:C.t3}}>Мои игры</p>
            <div className="space-y-2">
              {myGames.map(g=>(
                <div key={g.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{background:C.l1,border:`1px solid ${g.status==='pending'?C.amber+'30':g.status==='approved'?C.green+'30':C.red+'30'}`}}>
                  <span className="text-2xl">{g.coverEmoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate text-white">{g.title}</p>
                    <span className="text-[10px] font-semibold"
                      style={{color:g.status==='pending'?C.amber:g.status==='approved'?C.green:C.red}}>
                      {g.status==='pending'?'⏳ На модерации':g.status==='approved'?'✅ Опубликована':'❌ Отклонена'}
                    </span>
                    {g.rejectedReason&&<p className="text-[9px]" style={{color:C.t3}}>{g.rejectedReason}</p>}
                  </div>
                  {g.status==='approved'&&(
                    <button type="button" onClick={()=>{setPlaying(g);setView('play');}}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-white"
                      style={{background:C.accent}}><Play size={11}/></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Game grid */}
        {approved.length===0?(
          <div className="flex flex-col items-center gap-3 py-12">
            <span className="text-5xl">🕹️</span>
            <p className="text-sm" style={{color:C.t3}}>Игр не найдено</p>
          </div>
        ):(
          <div className="grid grid-cols-2 gap-3">
            {approved.map(g=>(
              <GameCard key={g.id} g={g} onPlay={()=>{setPlaying(g);setView('play');}}/>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* -- Admin games moderation (exported for ExtrasModule) ---- */
export const GamesAdminPanel = () => {
  const {games,approve,reject} = useGameStore();
  const pending = games.filter(g=>g.status==='pending');
  const [rejectId, setRejectId] = useState<string|null>(null);
  const [reason, setReason] = useState('');

  return (
    <div className="p-4 space-y-3">
      {pending.length===0&&<div className="py-12 text-center"><p className="text-sm" style={{color:'var(--t3)'}}>Игр на модерации нет</p></div>}
      {pending.map(g=>(
        <div key={g.id} className="rounded-2xl p-4 space-y-3"
          style={{background:'var(--bg-l1)',border:'1px solid rgba(245,158,11,0.2)'}}>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{g.coverEmoji}</span>
            <div>
              <p className="font-bold text-white">{g.title}</p>
              <p className="text-xs" style={{color:'var(--t2)'}}>{g.type.toUpperCase()} · {g.genre} · {g.authorName}</p>
              {g.description&&<p className="text-[11px] mt-1" style={{color:'var(--t3)'}}>{g.description}</p>}
              <p className="text-[10px] mt-0.5" style={{color:'var(--t3)'}}>Код: {g.codeType} · {g.codeSize}</p>
            </div>
          </div>
          {rejectId===g.id?(
            <div className="space-y-2">
              <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Причина отказа..."
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{background:'var(--bg-l2)',border:'1px solid var(--border)',color:'var(--t1)'}}/>
              <div className="flex gap-2">
                <button type="button" onClick={()=>{reject(g.id,reason||'Нарушение правил');setRejectId(null);setReason('');}}
                  className="flex-1 rounded-xl py-2 text-xs font-bold" style={{background:'rgba(239,68,68,0.15)',color:'var(--red)'}}>
                  Подтвердить
                </button>
                <button type="button" onClick={()=>setRejectId(null)}
                  className="rounded-xl px-4 py-2 text-xs" style={{color:'var(--t3)'}}>Отмена</button>
              </div>
            </div>
          ):(
            <div className="flex gap-2">
              <button type="button" onClick={()=>approve(g.id)}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                style={{background:'rgba(34,197,94,0.15)',color:'#22c55e',border:'1px solid rgba(34,197,94,0.3)'}}>
                <Check size={13}/>Опубликовать
              </button>
              <button type="button" onClick={()=>setRejectId(g.id)}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                style={{background:'rgba(239,68,68,0.1)',color:'var(--red)',border:'1px solid rgba(239,68,68,0.2)'}}>
                <X size={13}/>Отклонить
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
