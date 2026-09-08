import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Send, ChevronRight, Bot, Search, Zap } from 'lucide-react';
import { useIsMobile } from '@/interface/mobile/useIsMobile';

/* ── Bot data ───────────────────────────────────────────────────────────── */
export const BOTS_REGISTRY = [
  {
    id:'weather', name:'SkyWeather', username:'@skyweather', cat:'Утилиты', verified:true,
    emoji:'🌤', color:'#4e8cf7', shortDesc:'Погода онлайн',
    desc:'Погода в любой точке мира. Текущая, прогноз на 7 дней.',
    commands:[{cmd:'/weather',desc:'Погода'},{cmd:'/forecast',desc:'Прогноз'},{cmd:'/start',desc:'Начало'}],
    respond: async (msg: string) => {
      const lower = msg.toLowerCase();
      if(lower.includes('/start')||lower==='привет') return {type:'text',text:'👋 Привет! Я SkyWeather.\n\n/weather — погода сейчас\n/forecast — прогноз 7 дней'};
      if(lower.includes('/weather')||lower.includes('погода')) {
        try {
          const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=55.75&longitude=37.62&current=temperature_2m,wind_speed_10m,weather_code,cloud_cover&timezone=auto',{cache:'no-store',signal:AbortSignal.timeout(5000)});
          const d = await r.json(); const cur = d.current;
          const WX:Record<number,string>={0:'☀️ Ясно',1:'🌤 Ясно',2:'⛅ Облачно',3:'☁️ Пасмурно',45:'🌫 Туман',51:'🌦 Морось',61:'🌧 Дождь',71:'❄️ Снег',80:'🌧 Ливень',95:'⛈ Гроза'};
          const codeKey = Object.keys(WX).map(Number).reverse().find(k=>k<=cur.weather_code) as number;
          return {type:'weather',temp:Math.round(cur.temperature_2m),wind:Math.round(cur.wind_speed_10m),condition:WX[codeKey]||'Ясно',cloud:cur.cloud_cover};
        } catch { return {type:'text',text:'🌤 **Москва**\n\nТемпература: +12°C · Ветер: 5 м/с\nОблачность: 40% · Давление: 756 мм'}; }
      }
      if(lower.includes('/forecast')) return {type:'forecast',days:[{d:'Сег.',ico:'☀️',hi:12,lo:5},{d:'Завт.',ico:'🌦',hi:15,lo:7},{d:'Ср.',ico:'🌧',hi:10,lo:4},{d:'Чт.',ico:'⛅',hi:14,lo:6},{d:'Пт.',ico:'☀️',hi:18,lo:8}]};
      return {type:'text',text:'Используй /weather для погоды или укажи город'};
    }
  },
  {
    id:'news', name:'SkyNews', username:'@skynews', cat:'Новости', verified:true,
    emoji:'📰', color:'#f43f5e', shortDesc:'Новости дня',
    desc:'Главные новости без воды. Технологии, финансы, спорт.',
    commands:[{cmd:'/top',desc:'Топ новостей'},{cmd:'/tech',desc:'Технологии'},{cmd:'/sport',desc:'Спорт'}],
    respond: async (msg: string) => {
      const lower = msg.toLowerCase();
      const TOP = [{h:'Мосбиржа выросла на 1.8%',t:'8 мин',cat:'Финансы'},{h:'Apple анонсировала iPhone 17',t:'1 ч',cat:'Тех'},{h:'ЦСКА обыграл Зенит 2:1',t:'2 ч',cat:'Спорт'},{h:'Яндекс запустил новую LLM',t:'3 ч',cat:'Тех'},{h:'Нефть Brent упала ниже $85',t:'4 ч',cat:'Финансы'}];
      if(lower.includes('/start')) return {type:'text',text:'📰 **SkyNews**\n\n/top — главное\n/tech — технологии\n/sport — спорт'};
      if(lower.includes('/tech')) return {type:'news',items:TOP.filter(n=>n.cat==='Тех'),title:'🖥 Технологии'};
      if(lower.includes('/sport')) return {type:'news',items:TOP.filter(n=>n.cat==='Спорт'),title:'⚽ Спорт'};
      return {type:'news',items:TOP,title:'📰 Главные новости'};
    }
  },
  {
    id:'calc', name:'SkyCalc', username:'@skycalc', cat:'Утилиты', verified:false,
    emoji:'🧮', color:'#f59e0b', shortDesc:'Калькулятор',
    desc:'Математика и конвертер валют. Мгновенные расчёты.',
    commands:[{cmd:'/usd',desc:'Курс USD'},{cmd:'/eur',desc:'Курс EUR'},{cmd:'/calc',desc:'Вычислить'}],
    respond: async (msg: string) => {
      const lower = msg.toLowerCase().trim();
      if(lower.includes('/start')) return {type:'text',text:'🧮 **SkyCalc**\n\nВведи выражение: 2+2*5\n/usd — курс доллара\n/eur — курс евро'};
      if(lower.includes('/usd')) return {type:'currency',pairs:[{from:'USD',to:'RUB',rate:'91.42'},{from:'USD',to:'EUR',rate:'0.92'}],updated:'только что'};
      if(lower.includes('/eur')) return {type:'currency',pairs:[{from:'EUR',to:'RUB',rate:'99.15'},{from:'EUR',to:'USD',rate:'1.09'}],updated:'только что'};
      const expr = lower.replace('/calc','').trim();
      try {
        const result = Function('"use strict";return ('+expr+')')();
        if(typeof result==='number'&&!isNaN(result)) return {type:'calc',expr,result:result%1===0?result:result.toFixed(4)};
      } catch {}
      return {type:'text',text:'Введи выражение (2+2) или /usd для курса валют'};
    }
  },
  {
    id:'ai_help', name:'SkyAI Assistant', username:'@skyai', cat:'ИИ', verified:true,
    emoji:'✦', color:'#8b5cf6', shortDesc:'ИИ-помощник',
    desc:'ИИ-ассистент на базе Claude. Ответы, тексты, советы.',
    commands:[{cmd:'/ask',desc:'Спросить'},{cmd:'/write',desc:'Написать текст'},{cmd:'/start',desc:'Начало'}],
    respond: async (msg: string) => {
      if(msg.toLowerCase().includes('/start')) return {type:'text',text:'✦ **Sky AI**\n\nПросто напиши вопрос или задачу, я помогу!'};
      if(msg.length<5) return {type:'text',text:'Напиши вопрос подробнее!'};
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:250,
            system:'Ты встроенный ИИ-ассистент Sky. Кратко (2-3 предложения), по-русски, без markdown.',
            messages:[{role:'user',content:msg}]})});
        const d = await r.json();
        return {type:'text',text:d?.content?.[0]?.text||'Ошибка ответа.'};
      } catch { return {type:'text',text:'Сервис временно недоступен.'}; }
    }
  },
  {
    id:'market', name:'SkyMarket Bot', username:'@skymarketbot', cat:'Маркет', verified:true,
    emoji:'🛒', color:'#a855f7', shortDesc:'Маркет-помощник',
    desc:'Поиск товаров и скидки прямо в чате.',
    commands:[{cmd:'/deals',desc:'Скидки дня'},{cmd:'/orders',desc:'Заказы'},{cmd:'/start',desc:'Начало'}],
    respond: async (msg: string) => {
      const lower = msg.toLowerCase();
      if(lower.includes('/start')) return {type:'text',text:'🛒 **Sky Market**\n\n/deals — скидки дня\n/orders — мои заказы'};
      if(lower.includes('/deals')) return {type:'products',title:'🔥 Скидки',items:[{name:'AirPods Pro 2',price:'18 990 ₽',old:'24 990 ₽',discount:'-24%',emoji:'🎧'},{name:'iPhone Case',price:'990 ₽',old:'1 490 ₽',discount:'-33%',emoji:'📱'}]};
      if(lower.includes('/orders')) return {type:'text',text:'📦 **Заказы**\n\n#SKY-4821 · Доставка сегодня\nAirPods Pro 2 · 18 990 ₽\n\n#SKY-4780 · Доставлен 12 апр\nUSB-C Hub · 2 490 ₽'};
      return {type:'text',text:'Используй /deals или /orders'};
    }
  },
];

const BOT_STORE_KEY = 'sky:bots:v1';
const getBotStore = () => { try { return JSON.parse(localStorage.getItem(BOT_STORE_KEY)||'{}'); } catch { return {}; } };
const setBotStore = (d: any) => { try { localStorage.setItem(BOT_STORE_KEY,JSON.stringify(d)); } catch {} };

/* ── Bot Response Renderer ─────────────────────────────────────────────── */
const BotResp = ({ resp, color }: { resp: any, color: string }) => {
  if(!resp) return null;
  if(resp.type==='weather') return (
    <div className="rounded-2xl p-4" style={{background:`${color}15`,border:`1px solid ${color}30`,minWidth:180}}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-3xl">☁️</span>
        <div><p className="text-3xl font-black text-white leading-none">+{resp.temp}°</p>
          <p className="text-xs mt-1" style={{color:'rgba(255,255,255,0.6)'}}>{resp.condition}</p></div>
      </div>
      <div className="flex gap-4">
        <span className="text-xs" style={{color:'rgba(255,255,255,0.5)'}}>💨 {resp.wind} м/с</span>
        <span className="text-xs" style={{color:'rgba(255,255,255,0.5)'}}>☁ {resp.cloud}%</span>
      </div>
    </div>
  );
  if(resp.type==='forecast') return (
    <div className="flex gap-2 overflow-x-auto pb-1" style={{scrollbarWidth:'none'}}>
      {(resp.days||[]).map((d:any,i:number)=>(
        <div key={i} className="shrink-0 text-center rounded-xl px-3 py-2" style={{background:`${color}15`,border:`1px solid ${color}25`}}>
          <p className="text-[10px] mb-1" style={{color:'rgba(255,255,255,0.5)'}}>{d.d}</p>
          <p className="text-lg mb-1">{d.ico}</p>
          <p className="text-xs font-bold text-white">+{d.hi}°</p>
          <p className="text-[10px]" style={{color:'rgba(255,255,255,0.4)'}}>+{d.lo}°</p>
        </div>
      ))}
    </div>
  );
  if(resp.type==='news') return (
    <div className="rounded-2xl overflow-hidden" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',minWidth:240}}>
      <p className="text-sm font-bold px-4 py-3 text-white" style={{borderBottom:'1px solid rgba(255,255,255,0.06)'}}>{resp.title}</p>
      {(resp.items||[]).map((n:any,i:number)=>(
        <div key={i} className="px-4 py-3" style={{borderBottom:i<resp.items.length-1?'1px solid rgba(255,255,255,0.05)':'none'}}>
          <p className="text-sm leading-snug mb-1" style={{color:'rgba(255,255,255,0.88)'}}>{n.h}</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{background:`${color}22`,color}}>{n.cat}</span>
            <span className="text-[10px]" style={{color:'rgba(255,255,255,0.35)'}}>{n.t}</span>
          </div>
        </div>
      ))}
    </div>
  );
  if(resp.type==='calc') return (
    <div className="rounded-2xl px-5 py-4 text-center" style={{background:`${color}15`,border:`1px solid ${color}30`}}>
      <p className="text-xs mb-2" style={{color:'rgba(255,255,255,0.5)'}}>{resp.expr}</p>
      <p className="text-3xl font-black text-white">= {resp.result}</p>
    </div>
  );
  if(resp.type==='currency') return (
    <div className="rounded-2xl overflow-hidden" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',minWidth:180}}>
      <p className="text-xs px-4 py-2 font-bold uppercase tracking-widest" style={{color:'rgba(255,255,255,0.35)',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>Курсы · {resp.updated}</p>
      {(resp.pairs||[]).map((p:any,i:number)=>(
        <div key={i} className="flex justify-between items-center px-4 py-2.5" style={{borderBottom:i<resp.pairs.length-1?'1px solid rgba(255,255,255,0.05)':'none'}}>
          <p className="text-sm" style={{color:'rgba(255,255,255,0.7)'}}>{p.from} / {p.to}</p>
          <p className="text-sm font-bold text-white">{p.rate}</p>
        </div>
      ))}
    </div>
  );
  if(resp.type==='products') return (
    <div className="rounded-2xl overflow-hidden" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',minWidth:220}}>
      <p className="text-sm font-bold px-4 py-3 text-white" style={{borderBottom:'1px solid rgba(255,255,255,0.06)'}}>{resp.title}</p>
      {(resp.items||[]).map((p:any,i:number)=>(
        <div key={i} className="flex items-center gap-3 px-4 py-3" style={{borderBottom:i<resp.items.length-1?'1px solid rgba(255,255,255,0.05)':'none'}}>
          <span className="text-xl">{p.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate text-white">{p.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm font-bold" style={{color}}>{p.price}</span>
              <span className="text-xs line-through" style={{color:'rgba(255,255,255,0.3)'}}>{p.old}</span>
              <span className="text-[10px] font-bold px-1 rounded" style={{background:'rgba(244,63,94,0.2)',color:'#f43f5e'}}>{p.discount}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
  // Text with **bold**
  const text = (resp.text||'') as string;
  const parts = text.split(/\*\*(.+?)\*\*/);
  return <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{color:'rgba(255,255,255,0.88)'}}>
    {parts.map((part,i) => i%2===1 ? <strong key={i} className="text-white font-bold">{part}</strong> : part)}
  </p>;
};

/* ── Hash Inline Menu ───────────────────────────────────────────────────── */
export const HashInlineMenu = ({ query, onSelect, onClose }: { query: string, onSelect: (bot:any)=>void, onClose: ()=>void }) => {
  const bs = getBotStore();
  const q = query.toLowerCase();
  const recent = Object.entries((bs.recentUse||{}) as Record<string,number>)
    .sort((a,b)=>b[1]-a[1]).slice(0,4)
    .map(([id])=>BOTS_REGISTRY.find(b=>b.id===id)).filter(Boolean) as typeof BOTS_REGISTRY;
  const filtered = q
    ? BOTS_REGISTRY.filter(b=>b.id.includes(q)||b.name.toLowerCase().includes(q)||b.username.includes(q)||b.shortDesc.toLowerCase().includes(q)).slice(0,5)
    : (recent.length>0 ? recent : BOTS_REGISTRY.slice(0,5));

  return (
    <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:8}}
      transition={{duration:0.12}}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl overflow-hidden z-50"
      style={{background:'#1c1c28',border:'1px solid rgba(255,255,255,0.1)',
        boxShadow:'0 -12px 40px rgba(0,0,0,0.6)',maxHeight:320}}>
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
        <div className="flex items-center gap-2">
          <div className="grid h-5 w-5 place-items-center rounded-md text-[11px] font-black text-white"
            style={{background:'#4e8cf7'}}>#</div>
          <p className="text-xs font-bold text-white">{q?`Боты: «${query}»`:recent.length>0?'Недавние':'Доступные боты'}</p>
        </div>
        <button type="button" onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-full text-sm transition-colors hover:bg-white/10"
          style={{color:'rgba(255,255,255,0.4)'}}>×</button>
      </div>
      <div className="overflow-y-auto" style={{scrollbarWidth:'none',maxHeight:240}}>
        {filtered.length===0&&(
          <p className="text-center text-sm py-6" style={{color:'rgba(255,255,255,0.3)'}}>Ботов не найдено</p>
        )}
        {filtered.map(bot=>(
          <button key={bot.id} type="button" onClick={()=>onSelect(bot)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5"
            style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
            <div className="grid h-9 w-9 place-items-center rounded-xl text-xl shrink-0"
              style={{background:`${bot.color}20`,border:`1px solid ${bot.color}35`}}>{bot.emoji}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-white">{bot.name}</p>
                {bot.verified&&<span className="text-[11px]" style={{color:'#4e8cf7'}}>✓</span>}
                <span className="ml-auto text-[10px] font-bold shrink-0" style={{color:bot.color}}>{bot.cat}</span>
              </div>
              <p className="text-xs truncate mt-0.5" style={{color:'rgba(255,255,255,0.45)'}}>{bot.username} · {bot.shortDesc}</p>
            </div>
          </button>
        ))}
        <button type="button" onClick={()=>onSelect({__browse__:true})}
          className="flex w-full items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors hover:bg-white/5"
          style={{color:'#4e8cf7',borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          Все боты ({BOTS_REGISTRY.length}) <ChevronRight size={12}/>
        </button>
      </div>
    </motion.div>
  );
};

/* ── Bot Chat Overlay (full chat with bot) ─────────────────────────────── */
export const BotChatOverlay = ({ bot, onClose }: { bot: any, onClose: ()=>void }) => {
  const isMobile = useIsMobile();
  const startM = {id:'s0',fromBot:true,resp:{type:'text',text:''},text:'',time:''};
  const [msgs, setMsgs] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCmds, setShowCmds] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{ listRef.current?.scrollTo(0,99999); },[msgs,loading]);
  useEffect(()=>{ handleSend('/start'); },[]);

  const handleSend = async (text?: string) => {
    const t = (text||input).trim();
    if(!t) return;
    setInput('');
    setLoading(true);
    const now = new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
    if(t!=='/start') setMsgs(p=>[...p,{id:'u'+Date.now(),fromBot:false,text:t,time:now}]);
    try {
      const resp = await bot.respond(t);
      setMsgs(p=>[...p,{id:'b'+Date.now(),fromBot:true,resp,text:'',time:now}]);
      const st = getBotStore();
      st.recentUse = st.recentUse||{};
      st.recentUse[bot.id] = (st.recentUse[bot.id]||0)+1;
      setBotStore(st);
    } catch {
      setMsgs(p=>[...p,{id:'err'+Date.now(),fromBot:true,resp:{type:'text',text:'Ошибка. Попробуй ещё раз.'},text:'',time:now}]);
    }
    setLoading(false);
  };

  return (
    <div className={`fixed inset-0 z-[200] flex pointer-events-none ${isMobile ? 'items-stretch justify-stretch' : 'items-end justify-end'}`}>
      <motion.div initial={{opacity:0,x:isMobile?0:20,y:isMobile?20:0,scale:isMobile?1:0.95}} animate={{opacity:1,x:0,y:0,scale:1}} exit={{opacity:0,x:isMobile?0:20,y:isMobile?20:0}}
        className={`pointer-events-auto flex flex-col overflow-hidden shadow-2xl ${isMobile ? 'w-full h-full rounded-none' : 'rounded-2xl'}`}
        style={isMobile
          ? {background:'#0f0f18',paddingTop:'var(--safe-top)',paddingBottom:'var(--safe-bottom)'}
          : {width:360,height:520,background:'#0f0f18',border:'1px solid rgba(255,255,255,0.1)',
             margin:'0 16px 80px 0',boxShadow:'0 20px 60px rgba(0,0,0,0.8)'}}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{borderBottom:'1px solid rgba(255,255,255,0.07)',background:'#111'}}>
          <div className="grid h-9 w-9 place-items-center rounded-xl text-xl shrink-0"
            style={{background:`${bot.color}20`,border:`1px solid ${bot.color}35`}}>{bot.emoji}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-white">{bot.name}</p>
              {bot.verified&&<span className="text-[11px]" style={{color:'#4e8cf7'}}>✓</span>}
            </div>
            <p className="text-[11px]" style={{color:'rgba(255,255,255,0.4)'}}>{bot.username} · бот</p>
          </div>
          <button type="button" onClick={()=>setShowCmds(v=>!v)}
            className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold transition-colors hover:bg-white/10"
            style={{color:'rgba(255,255,255,0.5)',background:'rgba(255,255,255,0.06)'}}>⌘</button>
          <button type="button" onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-white/10">
            <X size={16} style={{color:'rgba(255,255,255,0.5)'}}/>
          </button>
        </div>
        {/* Commands */}
        <AnimatePresence>
          {showCmds&&(
            <motion.div initial={{height:0}} animate={{height:'auto'}} exit={{height:0}}
              className="overflow-hidden shrink-0" style={{borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
              <div className="flex flex-wrap gap-2 px-4 py-3">
                {bot.commands.map((cmd:any)=>(
                  <button key={cmd.cmd} type="button"
                    onClick={()=>{handleSend(cmd.cmd);setShowCmds(false);}}
                    className="rounded-full px-3 py-1.5 text-xs font-bold"
                    style={{background:`${bot.color}15`,color:bot.color,border:`1px solid ${bot.color}35`}}>
                    {cmd.cmd}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Messages */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
          style={{scrollbarWidth:'none'}}>
          {msgs.map(msg=>msg.fromBot?(
            <div key={msg.id} className="flex items-end gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-lg text-base shrink-0"
                style={{background:`${bot.color}20`}}>{bot.emoji}</div>
              <div className="flex flex-col gap-1">
                <div className="rounded-2xl rounded-bl-sm overflow-hidden"
                  style={{background:'#1c1c28',border:'1px solid rgba(255,255,255,0.08)',
                    padding:msg.resp?.type&&msg.resp.type!=='text'?0:'10px 14px'}}>
                  <BotResp resp={msg.resp} color={bot.color}/>
                </div>
                <p className="text-[10px] pl-1" style={{color:'rgba(255,255,255,0.25)'}}>{msg.time}</p>
              </div>
            </div>
          ):(
            <div key={msg.id} className="flex justify-end">
              <div>
                <div className="rounded-2xl rounded-br-sm px-4 py-2.5"
                  style={{background:`linear-gradient(135deg,${bot.color},${bot.color}cc)`}}>
                  <p className="text-sm text-white">{msg.text}</p>
                </div>
                <p className="text-[10px] text-right mt-1 pr-1" style={{color:'rgba(255,255,255,0.25)'}}>{msg.time}</p>
              </div>
            </div>
          ))}
          {loading&&(
            <div className="flex items-end gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-lg text-base shrink-0"
                style={{background:`${bot.color}20`}}>{bot.emoji}</div>
              <div className="rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5 items-center"
                style={{background:'#1c1c28',border:'1px solid rgba(255,255,255,0.08)'}}>
                {[0,1,2].map(i=><div key={i} className="h-1.5 w-1.5 rounded-full animate-bounce"
                  style={{background:'rgba(255,255,255,0.4)',animationDelay:`${i*0.15}s`}}/>)}
              </div>
            </div>
          )}
        </div>
        {/* Quick cmds */}
        <div className="flex gap-2 px-4 pb-2 overflow-x-auto shrink-0" style={{scrollbarWidth:'none'}}>
          {bot.commands.slice(0,3).map((cmd:any)=>(
            <button key={cmd.cmd} type="button" onClick={()=>handleSend(cmd.cmd)}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/10"
              style={{background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.6)',
                border:'1px solid rgba(255,255,255,0.08)'}}>
              {cmd.cmd}
            </button>
          ))}
        </div>
        {/* Input */}
        <div className="flex gap-2 items-center px-4 py-3 shrink-0"
          style={{borderTop:'1px solid rgba(255,255,255,0.07)'}}>
          <input value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handleSend()}
            placeholder="Сообщение боту..."
            className="flex-1 rounded-2xl px-4 py-2.5 text-sm outline-none"
            style={{background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.1)',
              color:'white',caretColor:bot.color}}/>
          <motion.button whileTap={{scale:0.9}} type="button" onClick={()=>handleSend()}
            className="grid h-10 w-10 place-items-center rounded-full shrink-0"
            style={{background:input.trim()&&!loading?bot.color:'rgba(255,255,255,0.07)'}}>
            <Send size={16} style={{color:input.trim()&&!loading?'white':'rgba(255,255,255,0.3)',marginLeft:2}}/>
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
};

/* ── Bot Browser (full page) ────────────────────────────────────────────── */
export const BotsBrowser = ({ onClose }: { onClose: ()=>void }) => {
  const [q, setQ]         = useState('');
  const [cat, setCat]     = useState('Все');
  const [openBot, setOpenBot] = useState<any>(null);
  const CATS = ['Все',...new Set(BOTS_REGISTRY.map(b=>b.cat))];
  const shown = BOTS_REGISTRY.filter(b=>{
    if(cat!=='Все'&&b.cat!==cat) return false;
    if(q&&!b.name.toLowerCase().includes(q.toLowerCase())&&!b.shortDesc.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{borderBottom:'1px solid var(--border)'}}>
        <div className="flex items-center gap-2">
          <Bot size={16} style={{color:'var(--accent)'}}/>
          <h2 className="text-base font-bold" style={{color:'var(--t1)'}}>Sky Боты</h2>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background:'rgba(79,110,247,0.12)',color:'var(--accent)'}}>{BOTS_REGISTRY.length}</span>
        </div>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/10"><X size={16} style={{color:'var(--t3)'}}/></button>
      </div>
      <div className="flex items-center gap-2 mx-5 my-3 rounded-2xl px-4 py-2.5 shrink-0" style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
        <Search size={14} style={{color:'var(--t3)'}}/>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Найти бота..."
          className="flex-1 bg-transparent text-sm outline-none" style={{color:'var(--t1)'}}/>
      </div>
      <div className="flex gap-1.5 px-5 pb-3 overflow-x-auto shrink-0" style={{scrollbarWidth:'none'}}>
        {CATS.map(c=>(
          <button key={c} type="button" onClick={()=>setCat(c)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold"
            style={{background:cat===c?'var(--accent)':'var(--bg-l2)',color:cat===c?'#fff':'var(--t3)',border:`1px solid ${cat===c?'transparent':'var(--border)'}`}}>{c}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2" style={{scrollbarWidth:'none'}}>
        {shown.map(bot=>(
          <button key={bot.id} type="button" onClick={()=>setOpenBot(bot)}
            className="flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-white/5"
            style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
            <div className="grid h-12 w-12 place-items-center rounded-xl text-2xl shrink-0"
              style={{background:`${bot.color}20`,border:`1px solid ${bot.color}35`}}>{bot.emoji}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-sm font-bold" style={{color:'var(--t1)'}}>{bot.name}</p>
                {bot.verified&&<span className="text-[11px]" style={{color:'var(--accent)'}}>✓</span>}
                <span className="ml-auto text-[10px] font-bold shrink-0" style={{color:bot.color}}>{bot.cat}</span>
              </div>
              <p className="text-xs truncate mb-2" style={{color:'var(--t3)'}}>{bot.desc}</p>
              <div className="flex gap-1.5">
                {bot.commands.slice(0,3).map((cmd:any)=>(
                  <span key={cmd.cmd} className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{background:'rgba(255,255,255,0.06)',color:'var(--t3)'}}>{cmd.cmd}</span>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
      <AnimatePresence>
        {openBot&&<BotChatOverlay bot={openBot} onClose={()=>setOpenBot(null)}/>}
      </AnimatePresence>
    </div>
  );
};
