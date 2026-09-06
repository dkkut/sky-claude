/* ================================================================
   SKY BUSINESS STUDIO — Загрузка контента + Монетизация
   Для авторов: музыка · видео · подкасты · аналитика · выплаты
================================================================ */
import { useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, Music2, Film, Mic2, TrendingUp, DollarSign, BarChart3,
  Users, Eye, ChevronRight, X, Check, Edit3, Trash2, Globe, Lock,
  AlertCircle, ArrowUpRight, ArrowDownRight, CreditCard, Wallet,
  Plus, RefreshCw, Settings, Sparkles, Star, Heart,
} from 'lucide-react';
import { useMonetizationStore, type RevenueEntry } from './monetizationStore';
import { useAuthStore } from '@/core/auth/store';
import { useVideoStore } from '@/video/store';

/* ── Design tokens ─────────────────────────────────────────── */
const V = { bg:'var(--bg)', bg1:'var(--bg-l1)', bg2:'var(--bg-l2)', bg3:'var(--bg-l3)',
  border:'var(--border)', bm:'var(--border-m)', accent:'var(--accent)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)', green:'var(--green)', red:'var(--red)', amber:'var(--amber)' };

const fadeUp = (i=0) => ({ initial:{opacity:0,y:10}, animate:{opacity:1,y:0}, transition:{duration:.2,delay:i*.05,ease:[.22,1,.36,1] as any} });
const fmtMoney = (n:number) => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n);
const fmtAgo = (iso:string) => { const d=Math.floor((Date.now()-new Date(iso).getTime())/86400000); if(d===0)return'Сегодня';if(d===1)return'Вчера';return`${d} дн. назад`; };

/* ── KPI card ───────────────────────────────────────────────── */
const KPICard = ({ icon:Icon, label, value, delta, color }:{ icon:any; label:string; value:string; delta?:number; color:string }) => (
  <div className="rounded-2xl p-4" style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
    <div className="flex items-center justify-between mb-2">
      <div className="grid h-8 w-8 place-items-center rounded-xl" style={{ background:`${color}18` }}>
        <Icon size={14} style={{ color }}/>
      </div>
      {delta!=null&&(
        <span className="flex items-center gap-0.5 text-[11px] font-semibold" style={{ color:delta>=0?V.green:V.red }}>
          {delta>=0?<ArrowUpRight size={11}/>:<ArrowDownRight size={11}/>}{Math.abs(delta)}%
        </span>
      )}
    </div>
    <p className="text-xl font-black" style={{ color:V.t1 }}>{value}</p>
    <p className="text-[11px] mt-0.5" style={{ color:V.t3 }}>{label}</p>
  </div>
);

/* ── Revenue chart ──────────────────────────────────────────── */
const WEEK = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const CHART_VALS = [1200,1850,920,2400,3100,1780,2950];
const MAX_C = Math.max(...CHART_VALS);

const RevenueChart = () => {
  const [hov, setHov] = useState<number|null>(null);
  return (
    <div className="rounded-2xl p-4" style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-bold" style={{ color:V.t1 }}>Выручка за 7 дней</p>
          <p className="text-[11px]" style={{ color:V.t3 }}>Все источники дохода</p>
        </div>
        <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color:V.green }}>
          <ArrowUpRight size={11}/>+24.8%
        </span>
      </div>
      <div className="flex items-end gap-1.5 h-24">
        {CHART_VALS.map((v,i)=>{
          const h=(v/MAX_C)*100; const isH=hov===i;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 cursor-pointer"
              onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}>
              {isH&&(
                <motion.div initial={{opacity:0,y:3}} animate={{opacity:1,y:0}}
                  className="text-[9px] font-bold rounded-lg px-1.5 py-0.5 whitespace-nowrap"
                  style={{ background:V.accent, color:'#fff' }}>
                  {fmtMoney(v)}
                </motion.div>
              )}
              <motion.div className="w-full rounded-t-lg" initial={{height:0}}
                animate={{height:`${h}%`}} transition={{delay:.05+i*.04,type:'spring',stiffness:280,damping:26}}
                style={{ background:isH?V.accent:`linear-gradient(to top,rgba(79,110,247,.7),rgba(79,110,247,.25))`, minHeight:3 }}/>
              <p className="text-[9px]" style={{ color:isH?V.accent:V.t3 }}>{WEEK[i]}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ── Upload form ────────────────────────────────────────────── */
type ContentType = 'music'|'video'|'podcast';

const UploadForm = ({ onDone }:{ onDone:()=>void }) => {
  const { currentUserId, accounts } = useAuthStore();
  const me = accounts.find(a=>a.id===currentUserId);
  const { addVideo } = useVideoStore();

  const [type,    setType]   = useState<ContentType>('music');
  const [file,    setFile]   = useState<File|null>(null);
  const [cover,   setCover]  = useState<string|undefined>();
  const [title,   setTitle]  = useState('');
  const [desc,    setDesc]   = useState('');
  const [tags,    setTags]   = useState('');
  const [status,  setStatus] = useState<'draft'|'published'>('published');
  const [isPaid,  setIsPaid] = useState(false);
  const [price,   setPrice]  = useState(99);
  const [loading, setLoad]   = useState(false);
  const [prog,    setProg]   = useState(0);
  const fileRef  = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const TYPE_ACCEPT:Record<ContentType,string> = { music:'audio/*', video:'video/*', podcast:'audio/*' };

  const handleFile = (f:File) => { setFile(f); if(!title) setTitle(f.name.replace(/\.[^.]+$/,'')); };

  const submit = async () => {
    if(!file||!title.trim()||!currentUserId||!me) return;
    setLoad(true); setProg(15);
    try {
      const url = URL.createObjectURL(file);
      if(type==='video') {
        const dur = await new Promise<number>(r=>{
          const v=document.createElement('video'); v.preload='metadata';
          const u=URL.createObjectURL(file);
          v.onloadedmetadata=()=>{URL.revokeObjectURL(u);r(v.duration);}; v.onerror=()=>r(0); v.src=u;
        });
        setProg(55);
        const toDur=(s:number)=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;};
        const tagList=tags.split(/[,\s]+/).map(t=>t.trim().toLowerCase()).filter(Boolean);
        await addVideo({ title:title.trim(),description:desc.trim(),uploadedBy:currentUserId,uploaderName:me.name,
          duration:toDur(dur),durationSec:dur,category:'other',tags:tagList,isShort:false,
          sourceUrl:url,thumbnailUrl:cover,thumbnailGrad:undefined,
          fileName:file.name,mimeType:file.type,bytes:file.size,isDraft:status==='draft',
          isPaid,paidPrice:isPaid?price:undefined,
        },file);
      }
      setProg(100);
      setTimeout(()=>{ setLoad(false); onDone(); },400);
    } catch { setLoad(false); setProg(0); }
  };

  const iS = { background:V.bg2, border:`1px solid ${V.border}`, color:V.t1 };
  const iC = 'w-full rounded-2xl px-4 py-2.5 text-sm outline-none';

  return (
    <div className="space-y-4 px-4 py-4 overflow-y-auto h-full" style={{ scrollbarWidth:'none' }}>
      {/* Type selector */}
      <div className="grid grid-cols-3 gap-2">
        {([['music','Музыка',Music2,'#8b5cf6'],['video','Видео',Film,'#0ea5e9'],['podcast','Подкаст',Mic2,'#f59e0b']] as const).map(([k,l,Icon,c])=>(
          <button key={k} type="button" onClick={()=>setType(k)}
            className="flex flex-col items-center gap-2 rounded-2xl py-3.5 text-xs font-semibold transition-all"
            style={{ background:type===k?`${c}14`:V.bg2, border:`1px solid ${type===k?c+'40':V.border}`, color:type===k?c:V.t2 }}>
            <Icon size={18} style={{ color:type===k?c:V.t3 }}/>{l}
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <div className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 py-10 cursor-pointer transition-all"
        style={{ borderColor:file?V.accent:V.bm, background:file?`${V.accent}05`:'transparent' }}
        onClick={()=>fileRef.current?.click()}
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f);}}>
        <input ref={fileRef} type="file" accept={TYPE_ACCEPT[type]} className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);}}/>
        <div className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background:file?`${V.accent}18`:V.bg3 }}>
          {file?<Check size={24} style={{ color:V.accent }}/>:<Upload size={24} style={{ color:V.t3 }}/>}
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color:file?V.accent:V.t2 }}>{file?file.name:'Нажмите или перетащите файл'}</p>
          {!file&&<p className="text-xs mt-1" style={{ color:V.t3 }}>{type==='video'?'MP4 · MOV · MKV':'MP3 · FLAC · WAV · M4A'}</p>}
        </div>
      </div>

      {file&&<motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="space-y-3">
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название *" className={iC} style={iS}/>
        <textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Описание" rows={3} className={`${iC} resize-none`} style={iS}/>
        <input value={tags} onChange={e=>setTags(e.target.value)} placeholder="Теги: музыка, sky, 2026..." className={iC} style={iS}/>

        {/* Cover */}
        <div className="flex items-center gap-3">
          <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f){const r=new FileReader();r.onload=()=>setCover(r.result as string);r.readAsDataURL(f);}}}/>
          <button type="button" onClick={()=>coverRef.current?.click()}
            className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold transition-colors"
            style={{ background:V.bg2, border:`1px solid ${V.border}`, color:V.t2 }}>
            🖼 {cover?'✅ Обложка':'Добавить обложку'}
          </button>
          {cover&&<img src={cover} alt="" className="h-10 w-10 rounded-xl object-cover"/>}
        </div>

        {/* Status */}
        <div className="flex gap-2">
          {(['published','draft'] as const).map(s=>(
            <button key={s} type="button" onClick={()=>setStatus(s)}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold"
              style={{ background:status===s?`${V.accent}15`:V.bg2, border:`1px solid ${status===s?V.accent+'35':V.border}`, color:status===s?V.accent:V.t2 }}>
              {s==='published'?<Globe size={12}/>:<Lock size={12}/>}
              {s==='published'?'Опубликовать':'Черновик'}
            </button>
          ))}
        </div>

        {/* Paid content toggle */}
        <div className="flex items-center justify-between rounded-2xl px-4 py-3"
          style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
          <div>
            <p className="text-sm font-semibold" style={{ color:V.t1 }}>Платный контент</p>
            <p className="text-[11px] mt-0.5" style={{ color:V.t3 }}>Пользователи платят за доступ</p>
          </div>
          <motion.div className="h-6 w-11 rounded-full cursor-pointer flex items-center px-0.5"
            style={{ background:isPaid?V.accent:V.bg3 }}
            onClick={()=>setIsPaid(p=>!p)}>
            <motion.div className="h-5 w-5 rounded-full bg-white shadow"
              animate={{ x:isPaid?20:0 }} transition={{ type:'spring',stiffness:700,damping:36 }}/>
          </motion.div>
        </div>
        {isPaid&&(
          <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background:`${V.amber}08`, border:`1px solid ${V.amber}20` }}>
            <DollarSign size={16} style={{ color:V.amber }}/>
            <div className="flex-1">
              <p className="text-xs font-semibold" style={{ color:V.t1 }}>Цена доступа</p>
            </div>
            <div className="flex items-center gap-1">
              <input type="number" value={price} onChange={e=>setPrice(+e.target.value)} min={9} max={9999}
                className="w-20 rounded-xl px-3 py-1.5 text-sm text-right outline-none"
                style={{ background:V.bg3, border:`1px solid ${V.bm}`, color:V.t1 }}/>
              <span className="text-sm font-semibold" style={{ color:V.t2 }}>₽</span>
            </div>
          </div>
        )}

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
          <Upload size={15}/>{loading?`${prog}%…`:`Опубликовать ${type==='music'?'трек':type==='video'?'видео':'подкаст'}`}
        </motion.button>
      </motion.div>}
    </div>
  );
};

/* ── Monetization settings ──────────────────────────────────── */
const MonetizationSettings = () => {
  const { settings, updateSettings } = useMonetizationStore();
  const [saved, setSaved] = useState(false);

  const save = () => { setSaved(true); setTimeout(()=>setSaved(false),2000); };

  const Toggle = ({ label, sub, value, onChange }:{ label:string; sub:string; value:boolean; onChange:(v:boolean)=>void }) => (
    <div className="flex items-center justify-between py-3" style={{ borderBottom:`1px solid ${V.border}` }}>
      <div>
        <p className="text-sm font-semibold" style={{ color:V.t1 }}>{label}</p>
        <p className="text-[11px] mt-0.5" style={{ color:V.t3 }}>{sub}</p>
      </div>
      <motion.div className="h-6 w-11 rounded-full cursor-pointer flex items-center px-0.5 shrink-0"
        style={{ background:value?V.accent:V.bg3 }} onClick={()=>onChange(!value)}>
        <motion.div className="h-5 w-5 rounded-full bg-white shadow"
          animate={{ x:value?20:0 }} transition={{ type:'spring',stiffness:700,damping:36 }}/>
      </motion.div>
    </div>
  );

  return (
    <div className="space-y-4 px-4 py-4 overflow-y-auto h-full" style={{ scrollbarWidth:'none' }}>
      {saved&&(
        <motion.div initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} exit={{opacity:0}}
          className="rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-2"
          style={{ background:'rgba(52,211,153,.08)', border:'1px solid rgba(52,211,153,.2)', color:V.green }}>
          <Check size={12}/>Настройки сохранены
        </motion.div>
      )}

      <div className="rounded-2xl px-4 py-2" style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
        <Toggle label="Подписка" sub="Ежемесячная плата за контент" value={settings.subscriptionEnabled}
          onChange={v=>updateSettings({subscriptionEnabled:v})}/>
        {settings.subscriptionEnabled&&(
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="py-3 flex items-center gap-3">
            <p className="text-xs font-semibold flex-1" style={{ color:V.t2 }}>Цена подписки</p>
            <input type="number" value={settings.subscriptionPrice}
              onChange={e=>updateSettings({subscriptionPrice:+e.target.value})} min={49}
              className="w-24 rounded-xl px-3 py-1.5 text-sm text-right outline-none"
              style={{ background:V.bg3, border:`1px solid ${V.bm}`, color:V.t1 }}/>
            <span className="text-sm" style={{ color:V.t2 }}>₽/мес</span>
          </motion.div>
        )}
        <Toggle label="Донаты" sub="Разовые пожертвования от фанатов" value={settings.donationsEnabled}
          onChange={v=>updateSettings({donationsEnabled:v})}/>
        <Toggle label="Реклама" sub="Доход от рекламы в ваших материалах" value={settings.adsEnabled}
          onChange={v=>updateSettings({adsEnabled:v})}/>
      </div>

      {/* Payout */}
      <div className="rounded-2xl p-4" style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
        <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color:V.t3 }}>Метод выплаты</p>
        <div className="flex gap-2 mb-3">
          {(['card','wallet','none'] as const).map(m=>(
            <button key={m} type="button" onClick={()=>updateSettings({payoutMethod:m})}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-semibold"
              style={{ background:settings.payoutMethod===m?`${V.accent}14`:V.bg3,
                border:`1px solid ${settings.payoutMethod===m?V.accent+'35':V.bm}`,
                color:settings.payoutMethod===m?V.accent:V.t2 }}>
              {m==='card'?<CreditCard size={12}/>:m==='wallet'?<Wallet size={12}/>:<X size={12}/>}
              {m==='card'?'Карта':m==='wallet'?'Кошелёк':'Нет'}
            </button>
          ))}
        </div>
        {settings.payoutMethod!=='none'&&(
          <input value={settings.payoutDetail} placeholder={settings.payoutMethod==='card'?'Номер карты':'Email кошелька'}
            onChange={e=>updateSettings({payoutDetail:e.target.value})}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background:V.bg3, border:`1px solid ${V.bm}`, color:V.t1 }}/>
        )}
      </div>

      <motion.button whileTap={{scale:.97}} type="button" onClick={save}
        className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold"
        style={{ background:V.accent, color:'#fff' }}>
        <Check size={14}/>Сохранить настройки
      </motion.button>
    </div>
  );
};

/* ── Revenue log ────────────────────────────────────────────── */
const RevenueLog = ({ revenue }:{ revenue:RevenueEntry[] }) => {
  const TYPE_C:Record<string,{ label:string; color:string; icon:any }> = {
    subscription:{ label:'Подписка',    color:V.accent, icon:Star },
    donation:    { label:'Донат',       color:V.green,  icon:Heart },
    paid_content:{ label:'Платн. конт.',color:V.amber,  icon:DollarSign },
    ad_revenue:  { label:'Реклама',     color:'#64748b',icon:Eye },
  };
  return (
    <div className="space-y-2">
      {revenue.slice(0,20).map((r,i)=>{
        const tc=TYPE_C[r.type];
        return (
          <motion.div key={r.id} {...fadeUp(i)} className="flex items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
            <div className="grid h-8 w-8 place-items-center rounded-xl shrink-0"
              style={{ background:`${tc.color}14` }}>
              <tc.icon size={14} style={{ color:tc.color }}/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold truncate" style={{ color:V.t1 }}>{r.desc}</p>
              <p className="text-[10px] mt-0.5" style={{ color:V.t3 }}>{tc.label} · {fmtAgo(r.date)}</p>
            </div>
            <p className="text-sm font-black shrink-0" style={{ color:V.green }}>+{fmtMoney(r.amount)}</p>
          </motion.div>
        );
      })}
    </div>
  );
};

/* ── My content table ───────────────────────────────────────── */
const MyContent = () => {
  const { videos } = useVideoStore();
  const { currentUserId } = useAuthStore();
  const mine = videos.filter(v=>v.uploadedBy===currentUserId);

  if(!mine.length) return (
    <div className="flex flex-col items-center py-16 gap-3 opacity-50">
      <Film size={28} style={{ color:V.t3 }}/>
      <p className="text-sm" style={{ color:V.t2 }}>Нет загруженного контента</p>
    </div>
  );

  const fmtViews=(n:number)=>n>=1000?`${(n/1000).toFixed(1)}К`:String(n);

  return (
    <div className="space-y-2">
      {mine.map((v,i)=>(
        <motion.div key={v.id} {...fadeUp(i)} className="flex items-center gap-3 rounded-2xl px-4 py-3"
          style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
          {/* Thumb */}
          <div className="shrink-0 w-14 rounded-xl overflow-hidden" style={{ aspectRatio:'16/9',
            background:`linear-gradient(135deg,${v.thumbnailGrad?.[0]??'#333'},${v.thumbnailGrad?.[1]??'#555'})` }}>
            {v.thumbnailUrl&&<img src={v.thumbnailUrl} alt="" className="w-full h-full object-cover"/>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold truncate" style={{ color:V.t1 }}>{v.title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px]" style={{ color:V.t3 }}>{fmtViews(v.views)} просм.</span>
              <span className="text-[10px]" style={{ color:V.t3 }}>·</span>
              <span className="text-[10px]" style={{ color:V.t3 }}>{v.duration}</span>
              {v.isPaid&&<span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background:`${V.amber}18`, color:V.amber }}>Платное</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full`}
              style={{ background:v.status==='published'?'rgba(52,211,153,.1)':'rgba(100,116,139,.1)',
                color:v.status==='published'?V.green:'#64748b' }}>
              {v.status==='published'?'Опубл.':'Черн.'}
            </span>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════
   MAIN STUDIO
══════════════════════════════════════════════════════════════ */
type StudioTab = 'overview'|'upload'|'content'|'monetization'|'revenue';

export const BusinessStudio = () => {
  const { settings, revenue } = useMonetizationStore();
  const [tab, setTab] = useState<StudioTab>('overview');

  const totalThisWeek = CHART_VALS.reduce((a,b)=>a+b,0);

  const TABS: { key:StudioTab; label:string; icon:any }[] = [
    { key:'overview',     label:'Обзор',         icon:BarChart3 },
    { key:'upload',       label:'Загрузить',      icon:Upload },
    { key:'content',      label:'Контент',        icon:Film },
    { key:'monetization', label:'Монетизация',    icon:DollarSign },
    { key:'revenue',      label:'Доходы',         icon:TrendingUp },
  ];

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{duration:.18}}
      className="flex flex-col h-full overflow-hidden" style={{ background:V.bg }}>

      {/* Header */}
      <div className="shrink-0 px-5 pt-4 pb-0" style={{ borderBottom:`1px solid ${V.border}`, background:V.bg1 }}>
        <div className="flex items-center gap-3 mb-3">
          <motion.div initial={{scale:.7,opacity:0}} animate={{scale:1,opacity:1}} transition={{type:'spring',stiffness:400,damping:26}}
            className="grid h-8 w-8 place-items-center rounded-xl shrink-0"
            style={{ background:`linear-gradient(135deg,#f59e0b,#ef4444)`, boxShadow:'0 4px 14px rgba(245,158,11,.4)' }}>
            <Sparkles size={15} className="text-white"/>
          </motion.div>
          <div>
            <p className="text-[15px] font-bold" style={{ color:V.t1 }}>Sky Studio</p>
            <p className="text-[10px]" style={{ color:V.t3 }}>Панель автора · Создавай и зарабатывай</p>
          </div>
        </div>

        {/* Tabs */}
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

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}
            transition={{duration:.15}} className="h-full">

            {/* Overview */}
            {tab==='overview'&&(
              <div className="overflow-y-auto h-full px-5 py-4 space-y-4" style={{ scrollbarWidth:'none' }}>
                {/* KPI grid */}
                <div className="grid grid-cols-2 gap-2">
                  <KPICard icon={DollarSign} label="Доход за неделю"     value={fmtMoney(totalThisWeek)} delta={24}  color={V.accent}/>
                  <KPICard icon={Users}      label="Подписчиков"          value="1 204"                   delta={6}   color={V.green}/>
                  <KPICard icon={Eye}        label="Просмотры за месяц"   value="48.2К"                   delta={31}  color="#f59e0b"/>
                  <KPICard icon={TrendingUp} label="Всего заработано"     value={fmtMoney(settings.totalEarned)} delta={18} color="#ec4899"/>
                </div>
                <RevenueChart/>
                {/* Pending payout */}
                <div className="rounded-2xl p-4 flex items-center gap-4"
                  style={{ background:'rgba(52,211,153,.06)', border:'1px solid rgba(52,211,153,.18)' }}>
                  <div className="grid h-11 w-11 place-items-center rounded-2xl shrink-0"
                    style={{ background:'rgba(52,211,153,.12)' }}>
                    <Wallet size={20} style={{ color:V.green }}/>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-black" style={{ color:V.t1 }}>К выплате</p>
                    <p className="text-[11px] mt-0.5" style={{ color:V.t3 }}>Доступно для вывода</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-black" style={{ color:V.green }}>{fmtMoney(settings.pendingPayout)}</p>
                    <button type="button" className="text-[11px] font-semibold mt-0.5 flex items-center gap-0.5" style={{ color:V.accent }}>
                      Вывести <ChevronRight size={11}/>
                    </button>
                  </div>
                </div>
                {/* Quick actions */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { icon:Upload, label:'Загрузить контент', sub:'Музыка · Видео · Подкасты', color:V.accent, action:()=>setTab('upload') },
                    { icon:Settings, label:'Монетизация',      sub:'Настройки дохода',           color:'#f59e0b', action:()=>setTab('monetization') },
                  ].map(item=>(
                    <motion.button key={item.label} whileTap={{scale:.97}} type="button" onClick={item.action}
                      className="flex items-start gap-3 rounded-2xl p-4 text-left"
                      style={{ background:V.bg2, border:`1px solid ${V.border}` }}>
                      <div className="grid h-9 w-9 place-items-center rounded-xl shrink-0" style={{ background:`${item.color}14` }}>
                        <item.icon size={16} style={{ color:item.color }}/>
                      </div>
                      <div>
                        <p className="text-[12px] font-bold" style={{ color:V.t1 }}>{item.label}</p>
                        <p className="text-[10px] mt-0.5" style={{ color:V.t3 }}>{item.sub}</p>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {tab==='upload' && <UploadForm onDone={()=>setTab('content')}/>}

            {tab==='content' && (
              <div className="overflow-y-auto h-full px-5 py-4" style={{ scrollbarWidth:'none' }}>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-bold" style={{ color:V.t1 }}>Мой контент</p>
                  <button type="button" onClick={()=>setTab('upload')}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold"
                    style={{ background:V.accent, color:'#fff' }}>
                    <Plus size={11}/>Загрузить
                  </button>
                </div>
                <MyContent/>
              </div>
            )}

            {tab==='monetization' && <MonetizationSettings/>}

            {tab==='revenue' && (
              <div className="overflow-y-auto h-full px-5 py-4 space-y-4" style={{ scrollbarWidth:'none' }}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold" style={{ color:V.t1 }}>История доходов</p>
                  <span className="text-[11px]" style={{ color:V.t3 }}>{revenue.length} транзакций</span>
                </div>
                <RevenueLog revenue={revenue}/>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
