/* ===============================================================
   SKY BUSINESS UTILITIES
   Sky Mail · Sky Drive · Sky ID · Бизнес инструменты
=============================================================== */
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail, HardDrive, Key, BarChart2, ChevronLeft, Plus, Search,
  Star, Trash2, Reply, Forward, Send, Paperclip, X, Check,
  Folder, Upload, File, Image, FileText, Download, Eye,
  Users, TrendingUp, DollarSign, Package, Bell, Calendar,
  Shield, Smartphone, QrCode, LogIn, Globe, Lock,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { create } from 'zustand';

const C = {
  bg:'#0a0a0f', l1:'#111118', l2:'var(--bg-l2)', l3:'#1e1e26',
  border:'var(--border)', b2:'var(--border-m)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)', amber:'var(--amber)', red:'var(--red)',
};

/* === TYPES ================================================== */
interface SkyEmail {
  id:string; from:string; fromName:string; to:string;
  subject:string; body:string; timestamp:number;
  read:boolean; starred:boolean; folder:'inbox'|'sent'|'spam'|'trash';
  attachments?:{ name:string; size:string }[];
}
interface DriveFile {
  id:string; name:string; type:'folder'|'image'|'document'|'video'|'other';
  size:string; modifiedAt:number; parentId:string|null; shared:boolean;
  preview?:string;
}
interface SkyIDSession { app:string; icon:string; linkedAt:string; lastUsed:string; }
interface BizMetric { label:string; value:string; change:string; positive:boolean; icon:any; color:string; }

/* === MAIL STORE ============================================ */
const SEED_EMAILS: SkyEmail[] = [
  { id:'e1', from:'no-reply@skymessenger.online', fromName:'Sky Team', to:'user@skymessenger.online',
    subject:'Добро пожаловать в Sky Mail!', timestamp:Date.now()-3600000,
    body:'Привет! Это ваш персональный почтовый ящик в экосистеме Sky. Здесь вы можете получать письма от других пользователей и сервисов.\n\nС уважением,\nКоманда Sky',
    read:false, starred:true, folder:'inbox' },
  { id:'e2', from:'security@skymessenger.online', fromName:'Sky Security', to:'user@skymessenger.online',
    subject:'Вход в аккаунт с нового устройства', timestamp:Date.now()-86400000,
    body:'Обнаружен вход в ваш аккаунт Sky с нового устройства.\n\nЕсли это были не вы  -  немедленно смените пароль.',
    read:true, starred:false, folder:'inbox',
    attachments:[{name:'security_report.pdf', size:'24 КБ'}] },
  { id:'e3', from:'prime@skymessenger.online', fromName:'Sky Prime', to:'user@skymessenger.online',
    subject:'Ваша Prime подписка активирована!', timestamp:Date.now()-172800000,
    body:'Поздравляем! Ваша Sky Prime подписка успешно активирована. Наслаждайтесь всеми преимуществами.',
    read:true, starred:false, folder:'inbox' },
];

const SK_MAIL = 'sky:mail:v1';
const loadMail = ():SkyEmail[] => { try{return[...SEED_EMAILS,...JSON.parse(localStorage.getItem(SK_MAIL)||'[]')];}catch{return SEED_EMAILS;} };
const saveMail = (e:SkyEmail[]) => { try{localStorage.setItem(SK_MAIL,JSON.stringify(e.filter(m=>!SEED_EMAILS.find(s=>s.id===m.id))));}catch{} };

interface MailState {
  emails: SkyEmail[];
  send:(e:Omit<SkyEmail,'id'|'timestamp'>)=>void;
  markRead:(id:string)=>void;
  star:(id:string)=>void;
  trash:(id:string)=>void;
  delete:(id:string)=>void;
}
const useMailStore = create<MailState>((set,get)=>({
  emails: loadMail(),
  send:(params)=>{
    const e:SkyEmail={...params,id:`em-${Date.now()}`,timestamp:Date.now()};
    const next=[...get().emails,e]; saveMail(next); set({emails:next});
  },
  markRead:(id)=>{ const next=get().emails.map(e=>e.id===id?{...e,read:true}:e); saveMail(next); set({emails:next}); },
  star:(id)=>{ const next=get().emails.map(e=>e.id===id?{...e,starred:!e.starred}:e); saveMail(next); set({emails:next}); },
  trash:(id)=>{ const next=get().emails.map(e=>e.id===id?{...e,folder:'trash' as const}:e); saveMail(next); set({emails:next}); },
  delete:(id)=>{ const next=get().emails.filter(e=>e.id!==id); saveMail(next); set({emails:next}); },
}));

/* === DRIVE STORE ============================================ */
const SEED_FILES: DriveFile[] = [
  {id:'f1',name:'Документы',type:'folder',size:' - ',modifiedAt:Date.now()-86400000,parentId:null,shared:false},
  {id:'f2',name:'Фотографии',type:'folder',size:' - ',modifiedAt:Date.now()-3600000,parentId:null,shared:true},
  {id:'f3',name:'Проект Sky.pptx',type:'document',size:'2.4 МБ',modifiedAt:Date.now()-7200000,parentId:'f1',shared:true},
  {id:'f4',name:'Отчёт Q1 2026.xlsx',type:'document',size:'580 КБ',modifiedAt:Date.now()-3600000,parentId:'f1',shared:false},
  {id:'f5',name:'photo_sky.jpg',type:'image',size:'1.2 МБ',modifiedAt:Date.now()-600000,parentId:'f2',shared:false},
  {id:'f6',name:'Дизайн логотипа.png',type:'image',size:'840 КБ',modifiedAt:Date.now()-1200000,parentId:'f2',shared:true},
];

const SK_DRIVE = 'sky:drive:v1';
const loadDrive = ():DriveFile[] => { try{const s=JSON.parse(localStorage.getItem(SK_DRIVE)||'[]');return s.length?[...SEED_FILES,...s.filter((f:any)=>!SEED_FILES.find(sf=>sf.id===f.id))]:SEED_FILES;}catch{return SEED_FILES;} };

interface DriveState { files:DriveFile[]; upload:(name:string,size:string,type:DriveFile['type'],parentId:string|null)=>void; toggleShare:(id:string)=>void; delete:(id:string)=>void; }
const useDriveStore = create<DriveState>((set,get)=>({
  files:loadDrive(),
  upload:(name,size,type,parentId)=>{
    const f:DriveFile={id:`df-${Date.now()}`,name,size,type,modifiedAt:Date.now(),parentId,shared:false};
    const next=[...get().files,f]; try{localStorage.setItem(SK_DRIVE,JSON.stringify(next.filter(f=>!SEED_FILES.find(s=>s.id===f.id))));}catch{}; set({files:next});
  },
  toggleShare:(id)=>{ const next=get().files.map(f=>f.id===id?{...f,shared:!f.shared}:f); set({files:next}); },
  delete:(id)=>{ const next=get().files.filter(f=>f.id!==id); set({files:next}); },
}));

/* === SKY MAIL ============================================== */
type MailFolder = 'inbox'|'sent'|'starred'|'trash';
const FILE_ICONS:Record<DriveFile['type'],string> = { folder:'📁', image:'🖼️', document:'📄', video:'🎬', other:'📎' };

const SkyMail = () => {
  const { emails, send, markRead, star, trash } = useMailStore();
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a=>a.id===currentUserId);
  const isPrimeBusiness = me?.isPrimeBusiness ?? false;
  const myEmail = isPrimeBusiness ? `${me?.username ?? 'user'}@sky.business` : `${me?.username ?? 'user'}@skymessenger.online`;

  const [folder, setFolder] = useState<MailFolder>('inbox');
  const [detail, setDetail] = useState<SkyEmail|null>(null);
  const [composing, setComposing] = useState(false);
  const [search, setSearch] = useState('');
  const [to, setTo] = useState(''); const [subject, setSubject] = useState(''); const [body, setBody] = useState('');

  const filtered = emails.filter(e => {
    if (folder==='starred') return e.starred && e.folder!=='trash';
    return e.folder===folder;
  }).filter(e=>!search||(e.subject+e.fromName+e.body).toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>b.timestamp-a.timestamp);

  const unread = emails.filter(e=>!e.read&&e.folder==='inbox').length;

  const handleSend = () => {
    if (!to.trim()||!subject.trim()) return;
    send({ from:myEmail, fromName:me?.name??'', to:to.trim(), subject:subject.trim(), body, read:true, starred:false, folder:'sent' });
    setComposing(false); setTo(''); setSubject(''); setBody('');
  };

  const FOLDERS:{key:MailFolder;label:string;icon:any}[] = [
    {key:'inbox', label:`Входящие${unread?` (${unread})`:''}`, icon:Mail},
    {key:'sent',  label:'Отправленные', icon:Send},
    {key:'starred',label:'Отмеченные',  icon:Star},
    {key:'trash', label:'Корзина',      icon:Trash2},
  ];

  if (detail) return (
    <motion.div initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} className="flex flex-col h-full overflow-y-auto" style={{scrollbarWidth:'none',background:C.bg}}>
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{borderColor:C.border}}>
        <button type="button" onClick={()=>{setDetail(null);}} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={16} style={{color:C.t2}}/></button>
        <p className="flex-1 text-sm font-bold truncate text-white">{detail.subject}</p>
        <button type="button" onClick={()=>star(detail.id)} style={{color:detail.starred?C.amber:C.t3}}>
          <Star size={16} fill={detail.starred?C.amber:'none'}/></button>
        <button type="button" onClick={()=>{trash(detail.id);setDetail(null);}} style={{color:C.t3}}>
          <Trash2 size={16}/></button>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
            style={{background:C.accent}}>{detail.fromName[0]}</div>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">{detail.fromName}</p>
            <p className="text-[11px]" style={{color:C.t3}}>{detail.from} → {detail.to}</p>
            <p className="text-[10px] mt-0.5" style={{color:C.t3}}>
              {new Date(detail.timestamp).toLocaleString('ru',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}
            </p>
          </div>
        </div>
        <div className="rounded-2xl p-4" style={{background:C.l1,border:`1px solid ${C.border}`}}>
          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{color:C.t1}}>{detail.body}</p>
        </div>
        {detail.attachments?.map(a=>(
          <div key={a.name} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{background:C.l2,border:`1px solid ${C.border}`}}>
            <File size={16} style={{color:C.accent}}/><div className="flex-1"><p className="text-xs font-semibold text-white">{a.name}</p><p className="text-[10px]" style={{color:C.t3}}>{a.size}</p></div>
            <button type="button"><Download size={14} style={{color:C.t2}}/></button>
          </div>
        ))}
        <div className="flex gap-2">
          {[{icon:Reply,label:'Ответить'},{icon:Forward,label:'Переслать'}].map(({icon:Icon,label})=>(
            <button key={label} type="button" onClick={()=>{setComposing(true);setTo(detail.from);setSubject(`Re: ${detail.subject}`);setDetail(null);}}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold"
              style={{background:C.l2,color:C.t1,border:`1px solid ${C.border}`}}>
              <Icon size={13}/>{label}</button>
          ))}
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden sm:flex-row" style={{background:C.bg}}>
      {/* Sidebar */}
      <div className="flex w-full max-h-[34vh] shrink-0 flex-col border-b py-3 px-2 overflow-y-auto sm:w-36 sm:max-h-none sm:border-b-0 sm:border-r" style={{borderColor:C.border}}>
        <button type="button" onClick={()=>setComposing(true)}
          className="flex items-center gap-1.5 w-full rounded-xl px-3 py-2.5 mb-3 text-xs font-bold text-white"
          style={{background:C.accent}}><Plus size={13}/>Написать</button>
        {FOLDERS.map(({key,label,icon:Icon})=>(
          <button key={key} type="button" onClick={()=>setFolder(key)}
            className="flex items-center gap-2 w-full rounded-lg px-2 py-2 text-xs font-medium transition-all mb-0.5"
            style={{background:folder===key?`${C.accent}15`:'transparent',color:folder===key?C.accent:C.t2}}>
            <Icon size={13}/><span className="truncate">{label}</span></button>
        ))}
        <div className="mt-4 px-2 pt-3 border-t" style={{borderColor:C.border}}>
          <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{color:C.t3}}>Почтовый ящик</p>
          <p className="text-[10px] font-medium break-all" style={{color:C.t3}}>{myEmail}</p>
          {isPrimeBusiness && (
            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full mt-0.5 inline-block"
              style={{background:'rgba(79,110,247,0.2)',color:'var(--accent)'}}>✦ Business</span>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="px-3 py-2 border-b shrink-0" style={{borderColor:C.border}}>
          <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{background:C.l1}}>
            <Search size={12} style={{color:C.t3}}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск писем..." className="flex-1 bg-transparent text-xs outline-none" style={{color:C.t1}}/>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" style={{scrollbarWidth:'none'}}>
          {filtered.length===0?(<div className="flex flex-col items-center gap-2 py-12"><Mail size={32} style={{color:C.t3}}/><p className="text-sm" style={{color:C.t3}}>Писем нет</p></div>)
          :filtered.map(e=>(
            <motion.button key={e.id} type="button" whileTap={{scale:.98}}
              onClick={()=>{markRead(e.id);setDetail(e);}}
              className="flex items-start gap-2.5 w-full px-3 py-3 border-b transition-colors hover:bg-white/[0.03] text-left"
              style={{borderColor:C.border,background:!e.read?`${C.accent}06`:'transparent'}}>
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white mt-0.5"
                style={{background:!e.read?C.accent:`${C.accent}40`}}>{e.fromName[0]}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-1">
                  <p className="text-[12px] font-semibold truncate" style={{color:!e.read?C.t1:C.t2}}>{e.fromName}</p>
                  <span className="text-[9px] shrink-0" style={{color:C.t3}}>
                    {new Date(e.timestamp).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}</span>
                </div>
                <p className="text-[11px] truncate" style={{color:!e.read?C.t1:C.t3}}>{e.subject}</p>
                <p className="text-[10px] truncate mt-0.5" style={{color:C.t3}}>{e.body.slice(0,60)}...</p>
              </div>
              {e.starred&&<Star size={10} fill={C.amber} style={{color:C.amber,shrink:0,marginTop:4}}/>}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Compose */}
      <AnimatePresence>
        {composing&&(
          <motion.div initial={{opacity:0,y:30}} animate={{opacity:1,y:0}} exit={{opacity:0,y:30}}
            className="absolute bottom-0 right-0 w-full max-w-sm overflow-hidden shadow-2xl z-50"
            style={{background:C.l1,border:`1px solid ${C.border}`,borderRadius:'16px 16px 0 0'}}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{borderColor:C.border}}>
              <p className="text-sm font-bold text-white">Новое письмо</p>
              <button type="button" onClick={()=>setComposing(false)}><X size={16} style={{color:C.t2}}/></button>
            </div>
            <div className="p-3 space-y-2">
              {([{ph:'Кому (email@skymessenger.online или @sky.business)',val:to,set:setTo},{ph:'Тема',val:subject,set:setSubject}]).map(({ph,val,set})=>(
                <input key={ph} value={val} onChange={e=>set(e.target.value)} placeholder={ph}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{background:C.l2,border:`1px solid ${C.border}`,color:C.t1}}/>
              ))}
              <textarea value={body} onChange={e=>setBody(e.target.value)} rows={5} placeholder="Текст письма..."
                className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none"
                style={{background:C.l2,border:`1px solid ${C.border}`,color:C.t1}}/>
              <div className="flex justify-end">
                <motion.button whileTap={{scale:.96}} type="button" onClick={handleSend}
                  disabled={!to.trim()||!subject.trim()}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                  style={{background:C.accent}}><Send size={14}/>Отправить</motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* === SKY DRIVE ============================================= */
const fmtDate = (ts:number)=>new Date(ts).toLocaleDateString('ru',{day:'numeric',month:'short'});

const SkyDrive = ({ isPrimeBusiness }: { isPrimeBusiness: boolean }) => {
  const { files, upload, toggleShare, delete:del } = useDriveStore();
  const [parentId, setParentId] = useState<string|null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid'|'list'>('grid');
  const inputRef = useRef<HTMLInputElement>(null);

  const current = files.filter(f=>f.parentId===parentId&&(!search||(f.name).toLowerCase().includes(search.toLowerCase())));
  const path = parentId ? [files.find(f=>f.id===parentId)] : [];
  const totalSize = '2.4 ГБ из 15 ГБ';

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{background:C.bg}}>
      {/* Header */}
      <div className="px-4 pt-4 pb-2 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {parentId&&<button type="button" onClick={()=>setParentId(null)}><ChevronLeft size={16} style={{color:C.t2}}/></button>}
            <p className="text-base font-black text-white">{parentId?path[0]?.name:'Sky Drive'}</p>
          </div>
          <div className="flex gap-2">
            <input ref={inputRef} type="file" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)upload(f.name,`${(f.size/1024).toFixed(0)} КБ`,f.type.startsWith('image/')?'image':'document',parentId);}}/>
            <button type="button" onClick={()=>inputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white"
              style={{background:C.accent}}><Upload size={13}/>Загрузить</button>
          </div>
        </div>
        {/* Storage bar */}
        <div className="rounded-xl p-2.5" style={{background:C.l1,border:`1px solid ${C.border}`}}>
          <div className="flex justify-between text-[10px] mb-1" style={{color:C.t3}}>
            <span>Использовано: 2.4 ГБ</span><span>Всего: {isPrimeBusiness?'50 ГБ':'5 ГБ'}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{background:C.l2}}>
            <div className="h-full rounded-full" style={{width:isPrimeBusiness?'5%':'48%',background:`linear-gradient(90deg,${C.accent},#818cf8)`}}/>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{background:C.l1}}>
          <Search size={12} style={{color:C.t3}}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск файлов..." className="flex-1 bg-transparent text-xs outline-none" style={{color:C.t1}}/>
        </div>
      </div>

      {/* Files */}
      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{scrollbarWidth:'none'}}>
        {current.length===0?(<div className="flex flex-col items-center gap-2 py-10"><HardDrive size={32} style={{color:C.t3}}/><p className="text-sm" style={{color:C.t3}}>Файлов нет</p></div>)
        :(
          <div className="grid grid-cols-2 gap-3 pt-2">
            {current.map(f=>(
              <motion.div key={f.id} whileTap={{scale:.96}}
                className="rounded-2xl overflow-hidden cursor-pointer"
                style={{background:C.l1,border:`1px solid ${C.border}`}}
                onClick={()=>f.type==='folder'&&setParentId(f.id)}>
                <div className="h-20 flex items-center justify-center text-4xl"
                  style={{background:C.l2}}>{FILE_ICONS[f.type]}</div>
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold truncate text-white">{f.name}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[9px]" style={{color:C.t3}}>{f.size!==' - '?f.size:fmtDate(f.modifiedAt)}</span>
                    {f.shared&&<span className="text-[8px] px-1 py-0.5 rounded" style={{background:`${C.accent}20`,color:C.accent}}>Общий</span>}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* === SKY ID ================================================ */
const SKY_ID_APPS: SkyIDSession[] = [
  { app:'Sky Business', icon:'💼', linkedAt:'2026-01-15', lastUsed:'Сегодня' },
  { app:'Sky Games',    icon:'🎮', linkedAt:'2026-02-01', lastUsed:'Вчера' },
  { app:'Sky Books',    icon:'📚', linkedAt:'2026-02-20', lastUsed:'3 дня назад' },
];

const SkyIDPanel = () => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a=>a.id===currentUserId);
  const [sessions] = useState(SKY_ID_APPS);
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);

  const skyId = `sky:${me?.username}`;

  const copyId = async()=>{
    await navigator.clipboard.writeText(skyId).catch(()=>{});
    setCopied(true); setTimeout(()=>setCopied(false),2000);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto px-4 py-4 space-y-4" style={{scrollbarWidth:'none',background:C.bg}}>
      {/* ID Card */}
      <div className="relative overflow-hidden rounded-3xl p-5"
        style={{background:'linear-gradient(135deg,#1a1a4e,#2d1b69,#4f6ef7)',boxShadow:'0 8px 32px rgba(79,110,247,0.3)'}}>
        <div className="absolute inset-0 pointer-events-none" style={{background:'linear-gradient(135deg,rgba(255,255,255,0.08),transparent)'}}/>
        <div className="flex items-start justify-between relative z-10">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{color:'rgba(255,255,255,0.5)'}}>Sky ID</p>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xl font-black text-white">{me?.name}</p>
              <Shield size={14} style={{color:'#60a5fa'}}/>
            </div>
            <p className="text-sm font-mono" style={{color:'rgba(255,255,255,0.7)'}}>{skyId}</p>
            <p className="text-[10px] mt-2" style={{color:'rgba(255,255,255,0.4)'}}>Единый вход во все сервисы Sky</p>
          </div>
          <div className="h-16 w-16 rounded-full border-4 border-white/20 overflow-hidden" style={{background:`${C.accent}30`}}>
            {me?.avatar?<img src={me.avatar} alt="" className="h-full w-full object-cover"/>
              :<div className="h-full w-full flex items-center justify-center text-2xl font-black text-white">{me?.name[0]}</div>}
          </div>
        </div>
        <div className="flex gap-2 mt-4 relative z-10">
          <button type="button" onClick={copyId}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold"
            style={{background:'rgba(255,255,255,0.15)',color:'white'}}>
            {copied?<><Check size={11}/>Скопировано</>:<><Key size={11}/>Скопировать ID</>}
          </button>
          <button type="button" onClick={()=>setShowQR(v=>!v)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold"
            style={{background:'rgba(255,255,255,0.15)',color:'white'}}>
            <QrCode size={11}/>QR-код
          </button>
        </div>
      </div>

      {/* QR placeholder */}
      <AnimatePresence>
        {showQR&&(
          <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}}
            className="overflow-hidden rounded-2xl p-4 flex flex-col items-center gap-2"
            style={{background:C.l1,border:`1px solid ${C.border}`}}>
            <div className="h-36 w-36 rounded-xl overflow-hidden" style={{background:'white',padding:8}}>
              <div className="h-full w-full" style={{background:'repeating-conic-gradient(#000 0%25%,#fff 0%50%) 0/8px 8px',opacity:0.9}}/>
            </div>
            <p className="text-xs" style={{color:C.t3}}>Отсканируйте для входа без пароля</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Linked apps */}
      <div className="rounded-2xl overflow-hidden" style={{background:C.l1,border:`1px solid ${C.border}`}}>
        <p className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider" style={{color:C.t3}}>
          🔗 Подключённые приложения
        </p>
        {sessions.map((s,i)=>(
          <div key={s.app}>
            {i>0&&<div className="h-px mx-4" style={{background:C.border}}/>}
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-xl">{s.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">{s.app}</p>
                <p className="text-[10px]" style={{color:C.t3}}>Последний вход: {s.lastUsed}</p>
              </div>
              <span className="text-[9px] px-2 py-0.5 rounded-full" style={{background:`${C.green}15`,color:C.green}}>Активно</span>
            </div>
          </div>
        ))}
      </div>

      {/* Security */}
      <div className="rounded-2xl overflow-hidden" style={{background:C.l1,border:`1px solid ${C.border}`}}>
        <p className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider" style={{color:C.t3}}>🛡️ Безопасность</p>
        {[
          {icon:Lock, label:'Двухфакторная аутентификация', status:'Включена', ok:true},
          {icon:Smartphone, label:'Доверенные устройства', status:'2 устройства', ok:true},
          {icon:Globe, label:'Активные сессии', status:'1 активная', ok:true},
        ].map(({icon:Icon,label,status,ok})=>(
          <div key={label} className="flex items-center gap-3 px-4 py-3 border-t" style={{borderColor:C.border}}>
            <Icon size={15} style={{color:ok?C.green:C.amber}}/>
            <div className="flex-1"><p className="text-sm text-white">{label}</p></div>
            <span className="text-[10px] font-semibold" style={{color:ok?C.green:C.amber}}>{status}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* === BUSINESS TOOLS ======================================== */
const BIZ_METRICS: BizMetric[] = [
  {label:'Выручка (мес.)',value:'₽148 500',change:'+12%',positive:true,  icon:DollarSign,color:'#22c55e'},
  {label:'Заказы',        value:'342',     change:'+8%', positive:true,  icon:Package,   color:'var(--accent)'},
  {label:'Клиенты',       value:'1 204',   change:'+5%', positive:true,  icon:Users,     color:'#a855f7'},
  {label:'Конверсия',     value:'3.2%',    change:'-0.4%',positive:false,icon:TrendingUp,color:'var(--amber)'},
];

const BusinessTools = ({ locked }: { locked: boolean }) => {
  if (locked) return (
    <div className="flex flex-col items-center justify-center gap-4 h-full px-6" style={{background:C.bg}}>
      <span className="text-5xl">💼</span>
      <div className="text-center">
        <p className="text-base font-bold" style={{color:C.t1}}>Prime Business</p>
        <p className="text-sm mt-1" style={{color:C.t2}}>Бизнес-инструменты доступны с подпиской Prime Business за 249 ₽/мес.</p>
      </div>
      <p className="text-xs" style={{color:C.t3}}>Профиль → Настройки → Подписки</p>
    </div>
  );
  const [tool, setTool] = useState<'dashboard'|'tasks'|'crm'|'calendar'>('dashboard');

  const TOOLS = [
    {key:'dashboard',label:'Сводка',icon:'📊'},
    {key:'tasks',   label:'Задачи', icon:'✅'},
    {key:'crm',     label:'CRM',    icon:'👥'},
    {key:'calendar',label:'Кал.',   icon:'📅'},
  ] as const;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{background:C.bg}}>
      <div className="flex gap-1 px-4 pt-4 pb-2 shrink-0">
        {TOOLS.map(t=>(
          <button key={t.key} type="button" onClick={()=>setTool(t.key)}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl text-center transition-all"
            style={{background:tool===t.key?`${C.accent}15`:'transparent',
              border:`1px solid ${tool===t.key?C.accent:'transparent'}`,color:tool===t.key?C.accent:C.t3}}>
            <span className="text-lg">{t.icon}</span>
            <span className="text-[10px] font-semibold">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{scrollbarWidth:'none'}}>
        {tool==='dashboard'&&(
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              {BIZ_METRICS.map(m=>(
                <div key={m.label} className="rounded-2xl p-4" style={{background:C.l1,border:`1px solid ${C.border}`}}>
                  <div className="flex items-center justify-between mb-2">
                    <m.icon size={16} style={{color:m.color}}/>
                    <span className="text-[10px] font-bold" style={{color:m.positive?C.green:C.red}}>{m.change}</span>
                  </div>
                  <p className="text-xl font-black text-white">{m.value}</p>
                  <p className="text-[10px] mt-0.5" style={{color:C.t3}}>{m.label}</p>
                </div>
              ))}
            </div>
            {/* Chart placeholder */}
            <div className="rounded-2xl p-4" style={{background:C.l1,border:`1px solid ${C.border}`}}>
              <p className="text-xs font-bold mb-3 text-white">Продажи по дням</p>
              <div className="flex items-end gap-1 h-24">
                {[40,65,45,80,55,90,70,85,60,95,75,88].map((v,i)=>(
                  <div key={i} className="flex-1 rounded-t" style={{height:`${v}%`,background:`linear-gradient(180deg,${C.accent},${C.accent}60)`}}/>
                ))}
              </div>
              <div className="flex justify-between mt-2">
                {['Пн','Вт','Ср','Чт','Пт','Сб','Вс','Пн','Вт','Ср','Чт','Пт'].map(d=>(
                  <span key={d+Math.random()} className="text-[8px]" style={{color:C.t3}}>{d}</span>
                ))}
              </div>
            </div>
            {/* Recent activity */}
            <div className="rounded-2xl overflow-hidden" style={{background:C.l1,border:`1px solid ${C.border}`}}>
              <p className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider" style={{color:C.t3}}>Последние заказы</p>
              {[
                {id:'#4821',client:'ООО «Альфа»',amount:'₽12 400',status:'Выполнен'},
                {id:'#4820',client:'ИП Петров',  amount:'₽3 200', status:'В работе'},
                {id:'#4819',client:'Зайцева А.', amount:'₽8 900', status:'Выполнен'},
              ].map((o,i)=>(
                <div key={o.id} className={`flex items-center gap-3 px-4 py-3${i>0?' border-t':''}`} style={{borderColor:C.border}}>
                  <div><p className="text-xs font-bold text-white">{o.id} · {o.client}</p>
                    <p className="text-[10px]" style={{color:C.t3}}>{o.amount}</p></div>
                  <span className="ml-auto text-[9px] px-2 py-0.5 rounded-full font-bold"
                    style={{background:o.status==='Выполнен'?`${C.green}15`:`${C.amber}15`,
                      color:o.status==='Выполнен'?C.green:C.amber}}>{o.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tool==='tasks'&&(
          <div className="space-y-2 pt-2">
            {[
              {text:'Подготовить отчёт Q1',done:true,priority:'high'},
              {text:'Встреча с клиентом в 15:00',done:false,priority:'high'},
              {text:'Обновить прайс-лист',done:false,priority:'normal'},
              {text:'Проверить рекламную кампанию',done:false,priority:'normal'},
              {text:'Отправить коммерческое предложение',done:false,priority:'low'},
            ].map((t,i)=>(
              <div key={i} className="flex items-center gap-3 rounded-xl px-4 py-3" style={{background:C.l1,border:`1px solid ${C.border}`,opacity:t.done?0.5:1}}>
                <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2"
                  style={{borderColor:t.done?C.green:C.border,background:t.done?C.green:'transparent'}}>
                  {t.done&&<Check size={11} className="text-black"/>}
                </div>
                <p className="flex-1 text-sm" style={{color:C.t1,textDecoration:t.done?'line-through':'none'}}>{t.text}</p>
                <span className="text-[9px] px-1.5 py-0.5 rounded" style={{
                  background:t.priority==='high'?`${C.red}15`:t.priority==='normal'?`${C.amber}15`:`${C.green}15`,
                  color:t.priority==='high'?C.red:t.priority==='normal'?C.amber:C.green}}>
                  {t.priority==='high'?'Срочно':t.priority==='normal'?'Обычный':'Низкий'}</span>
              </div>
            ))}
            <button type="button" className="flex items-center gap-2 w-full rounded-xl px-4 py-3 text-sm" style={{color:C.accent}}>
              <Plus size={14}/>Добавить задачу</button>
          </div>
        )}

        {tool==='crm'&&(
          <div className="space-y-2 pt-2">
            {[
              {name:'ООО «Альфа»',contact:'Иванов А.А.',revenue:'₽48 000',stage:'Клиент'},
              {name:'ИП Петров',  contact:'Петров В.В.',revenue:'₽12 000',stage:'Лид'},
              {name:'ООО «Бета»', contact:'Сидорова Е.',revenue:'₽95 000',stage:'Переговоры'},
              {name:'Зайцева А.', contact:'Зайцева А.С.',revenue:'₽8 900', stage:'Клиент'},
            ].map((c,i)=>(
              <div key={i} className="rounded-xl px-4 py-3" style={{background:C.l1,border:`1px solid ${C.border}`}}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-bold text-white">{c.name}</p>
                  <span className="text-[9px] px-2 py-0.5 rounded-full font-bold"
                    style={{background:c.stage==='Клиент'?`${C.green}15`:c.stage==='Переговоры'?`${C.accent}15`:`${C.amber}15`,
                      color:c.stage==='Клиент'?C.green:c.stage==='Переговоры'?C.accent:C.amber}}>{c.stage}</span>
                </div>
                <p className="text-[11px]" style={{color:C.t3}}>Контакт: {c.contact} · {c.revenue}</p>
              </div>
            ))}
          </div>
        )}

        {tool==='calendar'&&(
          <div className="space-y-3 pt-2">
            <div className="rounded-2xl p-4" style={{background:C.l1,border:`1px solid ${C.border}`}}>
              <p className="text-xs font-bold mb-2 text-white">Март 2026</p>
              <div className="grid grid-cols-7 gap-1 text-center">
                {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=><span key={d} className="text-[9px] font-bold py-1" style={{color:C.t3}}>{d}</span>)}
                {[...Array(3)].map((_,i)=><span key={`e${i}`}/>)}
                {[...Array(31)].map((_,i)=>(
                  <div key={i} className="rounded-lg py-1 text-[11px] font-medium cursor-pointer hover:bg-white/5"
                    style={{color:i+1===19?'white':C.t2,background:i+1===19?C.accent:'transparent',fontWeight:i+1===19?'bold':'normal'}}>
                    {i+1}</div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl overflow-hidden" style={{background:C.l1,border:`1px solid ${C.border}`}}>
              <p className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase" style={{color:C.t3}}>Сегодня, 19 марта</p>
              {[{time:'10:00',label:'Созвон с командой',color:C.accent},{time:'15:00',label:'Встреча с клиентом',color:'#22c55e'},{time:'18:00',label:'Дедлайн отчёта',color:C.red}].map(e=>(
                <div key={e.time} className="flex items-center gap-3 px-4 py-3 border-t" style={{borderColor:C.border}}>
                  <div className="w-0.5 h-10 rounded-full shrink-0" style={{background:e.color}}/>
                  <div><p className="text-xs font-semibold text-white">{e.label}</p><p className="text-[10px]" style={{color:C.t3}}>{e.time}</p></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* === MAIN HUB ============================================== */
type BizView = 'hub' | 'mail' | 'drive' | 'id' | 'tools';

export const SkyBusiness = () => {
  const [view, setView] = useState<BizView>('hub');
  const { emails } = useMailStore();
  const { accounts, currentUserId } = useAuthStore();
  const isPrimeBusiness = accounts.find(a=>a.id===currentUserId)?.isPrimeBusiness ?? false;
  const unreadMail = emails.filter(e=>!e.read&&e.folder==='inbox').length;

  const APPS = [
    { key:'mail' as BizView,  label:'Sky Mail',    icon:'✉️', desc:'Корпоративная почта', color:'var(--accent)', badge:unreadMail },
    { key:'drive' as BizView, label:'Sky Drive',   icon:'☁️', desc:'Облачное хранилище',  color:'#06b6d4', badge:0 },
    { key:'id' as BizView,    label:'Sky ID',      icon:'🪪', desc:'Единая авторизация',  color:'#8b5cf6', badge:0 },
    { key:'tools' as BizView, label:'Бизнес',      icon:'📊', desc:'Инструменты и CRM',   color:'#10b981', badge:0 },
  ];


  if (view !== 'hub') return (
    <div className="flex flex-col h-full overflow-hidden" style={{background:C.bg}}>
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{borderColor:C.border}}>
        <button type="button" onClick={()=>setView('hub')} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={18} style={{color:C.t2}}/></button>
        <p className="text-sm font-bold text-white">{APPS.find(a=>a.key===view)?.label}</p>
      </div>
      <div className="flex-1 overflow-hidden">
        {view==='mail'&&<SkyMail/>}
        {view==='drive'&&<SkyDrive isPrimeBusiness={isPrimeBusiness}/>}
        {view==='id'&&<SkyIDPanel/>}
        {view==='tools'&&<BusinessTools locked={!isPrimeBusiness}/>}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{background:C.bg}}>
      <div className="px-4 pt-5 pb-3 shrink-0">
        <p className="text-xl font-black text-white mb-0.5">Sky Business</p>
        <p className="text-xs" style={{color:C.t3}}>Инструменты для работы и бизнеса</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{scrollbarWidth:'none'}}>
        <div className="grid grid-cols-2 gap-4">
          {APPS.map(app=>(
            <motion.button key={app.key} type="button" whileTap={{scale:.95}}
              onClick={()=>setView(app.key)}
              className="relative flex flex-col items-start gap-3 rounded-3xl p-5 text-left overflow-hidden"
              style={{background:`linear-gradient(135deg,${app.color}18,${C.l1})`,border:`1px solid ${app.color}30`,
                boxShadow:`0 4px 24px ${app.color}12`}}>
              <div className="absolute top-0 right-0 w-20 h-20 rounded-full pointer-events-none"
                style={{background:`radial-gradient(circle,${app.color}15,transparent)`,transform:'translate(30%,-30%)'}}/>
              <div className="grid h-12 w-12 place-items-center rounded-2xl text-2xl relative z-10"
                style={{background:`${app.color}20`}}>{app.icon}</div>
              <div className="relative z-10">
                <p className="text-sm font-black text-white">{app.label}</p>
                <p className="text-[10px] mt-0.5" style={{color:`${app.color}cc`}}>{app.desc}</p>
              </div>
              {app.badge>0&&(
                <div className="absolute top-3 right-3 grid h-5 w-5 place-items-center rounded-full text-[10px] font-black text-white"
                  style={{background:app.color}}>{app.badge}</div>
              )}
            </motion.button>
          ))}
        </div>
        {/* Quick stats */}
        <div className="mt-4 rounded-2xl p-4" style={{background:C.l1,border:`1px solid ${C.border}`}}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{color:C.t3}}>Быстрая сводка</p>
          <div className="flex gap-4">
            {[{v:unreadMail,l:'Новых писем',c:C.accent},{v:'2.4 ГБ',l:'Занято в Drive',c:'#06b6d4'},{v:3,l:'Задачи сегодня',c:C.green}].map(({v,l,c})=>(
              <div key={l} className="flex-1 text-center">
                <p className="text-lg font-black" style={{color:c}}>{v}</p>
                <p className="text-[9px] leading-tight mt-0.5" style={{color:C.t3}}>{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
