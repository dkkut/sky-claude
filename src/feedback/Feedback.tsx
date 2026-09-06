/* ===============================================================
   FEEDBACK  -  обратная связь → в админку
=============================================================== */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Bug, Lightbulb, Flag, Send, Check, X, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useMessengerStore } from '@/messenger/store';
import { useAdsStore, AD_PLACEMENTS } from '@/ads/store';
import type { AdCampaign } from '@/ads/store';

const C = {
  bg:'var(--bg)', l1:'var(--bg-l1)', l2:'var(--bg-l2)',
  border:'var(--border)', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)',
};

type FeedbackType = 'report' | 'suggestion' | 'bug';

const FEEDBACK_TYPES = [
  { key:'report' as FeedbackType,     icon:Flag,        label:'Жалоба',     color:'var(--red)',
    desc:'Нарушение правил, неприемлемый контент', placeholder:'Опишите нарушение подробно...' },
  { key:'suggestion' as FeedbackType, icon:Lightbulb,   label:'Предложение', color:'var(--amber)',
    desc:'Идея для улучшения Sky', placeholder:'Ваша идея для Sky...' },
  { key:'bug' as FeedbackType,        icon:Bug,         label:'Баг',         color:'#f97316',
    desc:'Ошибка или неработающая функция', placeholder:'Опишите баг и шаги для воспроизведения...' },
];

const PRIORITIES = [
  { key:'low',    label:'Низкий',  color:'var(--t2)' },
  { key:'normal', label:'Обычный', color:'var(--amber)' },
  { key:'high',   label:'Высокий', color:'var(--red)' },
] as const;

export const FeedbackForm = ({ onClose }: { onClose?: () => void }) => {
  const { currentUserId, accounts } = useAuthStore();
  const { addReport } = useMessengerStore();
  const me = accounts.find(a=>a.id===currentUserId);

  const [type,     setType]     = useState<FeedbackType>('suggestion');
  const [title,    setTitle]    = useState('');
  const [body,     setBody]     = useState('');
  const [priority, setPriority] = useState<'low'|'normal'|'high'>('normal');
  const [sent,     setSent]     = useState(false);

  const ft = FEEDBACK_TYPES.find(f=>f.key===type)!;

  const submit = () => {
    if (!title.trim() || !body.trim()) return;
    // Primary: localStorage — always works
    try {
      const key = 'sky:feedback:v1';
      const feedbacks = JSON.parse(localStorage.getItem(key) || '[]');
      feedbacks.unshift({
        id: `fb-${Date.now()}`,
        type, title: title.trim(), body: body.trim(),
        priority, userId: currentUserId,
        userName: me?.name ?? 'Unknown',
        username: me?.username ?? '',
        createdAt: new Date().toISOString(),
        status: 'pending',
      });
      localStorage.setItem(key, JSON.stringify(feedbacks.slice(0, 200)));
    } catch (e) { console.error('[Feedback] localStorage failed', e); }
    // Secondary: try addReport with a real chatId (admin chat)
    try {
      const msStore = useMessengerStore.getState();
      const adminChat = msStore.chats.find((ch: any) =>
        ch.id === 'feedback' || ch.name?.toLowerCase().includes('admin') || ch.members?.includes('kutuzov')
      );
      if (adminChat) {
        msStore.setActiveChat(adminChat.id);
        const typeLabel = FEEDBACK_TYPES.find(f=>f.key===type)?.label ?? type;
        msStore.sendMessage({
          kind: 'text',
          text: `📋 [${typeLabel.toUpperCase()}] ${title.trim()}\n${body.trim()}`,
        });
      }
    } catch {}
    setSent(true);
  };

  if (sent) return (
    <div className="flex flex-col items-center gap-4 py-8 px-6">
      <motion.div initial={{scale:0}} animate={{scale:1}} transition={{type:'spring',stiffness:400,damping:18}}
        className="grid h-16 w-16 place-items-center rounded-full"
        style={{background:'rgba(79,110,247,0.15)',border:'2px solid rgba(79,110,247,0.4)'}}>
        <Check size={28} style={{color:C.accent}}/>
      </motion.div>
      <div className="text-center">
        <p className="text-base font-bold text-white">Спасибо!</p>
        <p className="text-sm mt-1" style={{color:C.t2}}>Ваше обращение передано администраторам Sky.</p>
      </div>
      {onClose&&<button type="button" onClick={onClose}
        className="rounded-2xl px-6 py-2.5 text-sm font-bold text-white"
        style={{background:C.accent}}>Закрыть</button>}
    </div>
  );

  return (
    <div className="space-y-4 px-4 py-4">
      {/* Type selector */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{color:C.t3}}>Тип обращения</p>
        <div className="grid grid-cols-3 gap-2">
          {FEEDBACK_TYPES.map(({key,icon:Icon,label,color})=>(
            <button key={key} type="button" onClick={()=>setType(key)}
              className="flex flex-col items-center gap-1.5 rounded-2xl py-3 px-2 transition-all"
              style={{background:type===key?`${color}15`:'rgba(255,255,255,0.04)',
                border:`1.5px solid ${type===key?color:'var(--border)'}`,
                boxShadow:type===key?`0 0 0 2px ${color}20`:'none'}}>
              <Icon size={18} style={{color:type===key?color:C.t3}}/>
              <span className="text-[11px] font-semibold" style={{color:type===key?color:C.t3}}>{label}</span>
            </button>
          ))}
        </div>
        <p className="text-[10px] mt-1.5" style={{color:C.t3}}>{ft.desc}</p>
      </div>

      {/* Title */}
      <div>
        <p className="text-xs font-bold mb-1.5" style={{color:C.t3}}>Заголовок *</p>
        <input value={title} onChange={e=>setTitle(e.target.value)} maxLength={100}
          placeholder="Краткое описание..."
          className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
          style={{background:C.l2,border:`1px solid ${C.border}`,color:C.t1}}/>
      </div>

      {/* Body */}
      <div>
        <p className="text-xs font-bold mb-1.5" style={{color:C.t3}}>Подробное описание *</p>
        <textarea value={body} onChange={e=>setBody(e.target.value)} rows={5} maxLength={1000}
          placeholder={ft.placeholder}
          className="w-full rounded-2xl px-4 py-3 text-sm outline-none resize-none"
          style={{background:C.l2,border:`1px solid ${C.border}`,color:C.t1}}/>
        <p className="text-[10px] text-right mt-0.5" style={{color:C.t3}}>{body.length}/1000</p>
      </div>

      {/* Priority */}
      <div>
        <p className="text-xs font-bold mb-1.5" style={{color:C.t3}}>Приоритет</p>
        <div className="flex gap-2">
          {PRIORITIES.map(p=>(
            <button key={p.key} type="button" onClick={()=>setPriority(p.key)}
              className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all"
              style={{background:priority===p.key?`${p.color}18`:'rgba(255,255,255,0.04)',
                border:`1px solid ${priority===p.key?p.color:'var(--border)'}`,
                color:priority===p.key?p.color:C.t3}}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* From */}
      <div className="rounded-xl px-3 py-2.5 text-xs" style={{background:'rgba(79,110,247,0.06)',border:'1px solid rgba(79,110,247,0.2)',color:C.t2}}>
        От: <span style={{color:C.t1}}>{me?.name} (@{me?.username})</span>
      </div>

      <motion.button whileTap={{scale:.97}} type="button" onClick={submit}
        disabled={!title.trim()||!body.trim()}
        className="flex items-center justify-center gap-2 w-full rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-35"
        style={{background:`linear-gradient(135deg,${C.accent},#818cf8)`,boxShadow:`0 6px 24px ${C.accent}30`}}>
        <Send size={15}/> Отправить обращение
      </motion.button>
    </div>
  );
};

/* ===============================================================
   AD BLOCKS  -  рекламные блоки (реальные из AdsStore)
=============================================================== */
interface AdBlockProps {
  placement: 'bloom_feed' | 'video_banner' | 'channel_post';
  style?:    React.CSSProperties;
}

export const AdBlock = ({ placement, style }: AdBlockProps) => {
  const { campaigns } = useAdsStore();
  const active = campaigns.filter(c => c.status === 'active' && c.placement === placement);
  if (active.length === 0) return null;

  // Pick random active campaign
  const ad = active[Math.floor(Date.now() / 30000) % active.length];
  const p   = AD_PLACEMENTS.find(x => x.placement === ad.placement);

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}}
      className="overflow-hidden rounded-2xl relative"
      style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.07)',...style}}>
      {/* Ad label */}
      <div className="absolute top-2 right-2 z-10">
        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full"
          style={{background:'rgba(245,158,11,0.15)',color:'var(--amber)',border:'1px solid rgba(245,158,11,0.2)'}}>
          Реклама
        </span>
      </div>
      {/* Content */}
      {ad.imageUrl && (
        <img src={ad.imageUrl} alt={ad.title} className="w-full max-h-28 object-cover"/>
      )}
      <div className="px-4 py-3">
        <p className="text-sm font-bold text-white pr-12">{ad.title}</p>
        {ad.description && (
          <p className="text-[11px] mt-0.5 line-clamp-2" style={{color:C.t2}}>{ad.description}</p>
        )}
        {ad.linkUrl && (
          <a href={ad.linkUrl} target="_blank" rel="noopener noreferrer"
            className="inline-block mt-2 text-[11px] font-semibold"
            style={{color:C.accent}}>Перейти →</a>
        )}
      </div>
    </motion.div>
  );
};

/* -- Ad Banner (horizontal strip) ---------------------------- */
export const AdBanner = ({ placement }: { placement: AdCampaign['placement'] }) => {
  const { campaigns } = useAdsStore();
  const active = campaigns.filter(c => c.status === 'active' && c.placement === placement);
  if (active.length === 0) return null;

  const ad = active[Math.floor(Date.now() / 60000) % active.length];

  return (
    <div className="mx-4 my-2 overflow-hidden rounded-xl flex items-center gap-3 px-3 py-2.5"
      style={{background:'rgba(79,110,247,0.06)',border:'1px solid rgba(79,110,247,0.15)'}}>
      <Sparkles size={14} style={{color:C.accent,shrink:0}}/>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold truncate text-white">{ad.title}</p>
        {ad.description&&<p className="text-[10px] truncate" style={{color:C.t3}}>{ad.description}</p>}
      </div>
      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
        style={{background:'rgba(245,158,11,0.15)',color:'var(--amber)'}}>Реклама</span>
    </div>
  );
};
