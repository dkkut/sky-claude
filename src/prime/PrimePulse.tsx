/* ===============================================================
   PRIME PULSE  -  эксклюзивные плюшки и промокоды для Prime
=============================================================== */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Zap, Gift, Star, Copy, Check, Clock, ChevronRight, Sparkles,
  PawPrint, Palette, Music2, Gamepad2, Film, Package, BookOpen, Trophy, Crown, Globe, ShoppingBag,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';

interface PulseOffer {
  id:       string;
  category: 'game' | 'service' | 'promo' | 'fun';
  Icon:     typeof Star;
  title:    string;
  desc:     string;
  brand:    string;
  code?:    string;
  value:    string;        // "30 дней", "−50%", "+500₽"
  expiresIn:string;        // "3 дня", "до 31 марта"
  isPremium:boolean;       // только highest Prime
  color:   [string,string]; // gradient
}

const OFFERS: PulseOffer[] = [
  { id:'p1', category:'promo', Icon:Star, title:'Sky Points ×2 — весь месяц',
    desc:'Удвоенное начисление Sky Points за все покупки, подписки и активность в приложении.',
    brand:'Sky', value:'×2 Points', expiresIn:'до конца месяца', isPremium:false,
    color:['var(--amber)','#d97706'] },
  { id:'p2', category:'game', Icon:PawPrint, title:'Скин питомца — Ночной Лис',
    desc:'Эксклюзивный Prime-скин для питомца Sky. Доступен только подписчикам этого месяца.',
    brand:'Sky', code:'PULSE-NFOX25', value:'Бесплатно', expiresIn:'7 дней', isPremium:false,
    color:['#a855f7','#7c3aed'] },
  { id:'p3', category:'promo', Icon:Palette, title:'−30% на Sky Реклама',
    desc:'Скидка на запуск рекламной кампании в Sky Video и Bloom-ленте для Prime-участников.',
    brand:'Sky Ads', code:'PRIME-ADS30', value:'−30%', expiresIn:'до конца месяца', isPremium:false,
    color:['var(--accent)','#3b55c9'] },
  { id:'p4', category:'service', Icon:Music2, title:'Sky Music — Premium на месяц',
    desc:'Бесплатный месяц Sky Music Premium с высоким качеством звука и офлайн-прослушиванием.',
    brand:'Sky Music', code:'PRIME-MUS30', value:'30 дней', expiresIn:'14 дней', isPremium:false,
    color:['#f43f5e','#e11d48'] },
  { id:'p5', category:'game', Icon:Gamepad2, title:'Sky Gaming — турнирные очки',
    desc:'+500 ELO-очков для участия в закрытых Prime-турнирах Sky Gaming.',
    brand:'Sky Gaming', code:'PRIME-GAME500', value:'+500 ELO', expiresIn:'10 дней', isPremium:false,
    color:['#f97316','#ea580c'] },
  { id:'p6', category:'service', Icon:Film, title:'Sky Video — Creator Pro',
    desc:'Доступ к Sky Video Creator Pro: 4K-загрузка, продвинутая аналитика и монетизация.',
    brand:'Sky Video', code:'PRIME-VID-PRO', value:'Creator Pro', expiresIn:'21 день', isPremium:false,
    color:['#ef4444','#dc2626'] },
  { id:'p7', category:'fun', Icon:Package, title:'Sky Market — кэшбэк 10%',
    desc:'Кэшбэк 10% Sky Points на все покупки в Sky Market в течение недели.',
    brand:'Sky Market', code:'PRIME-MKT10', value:'10% кэшбэк', expiresIn:'7 дней', isPremium:false,
    color:['#f23c6e','#c2185b'] },
  { id:'p8', category:'fun', Icon:BookOpen, title:'Sky Books — 5 книг бесплатно',
    desc:'Любые 5 книг или аудиокниг из каталога Sky Books бесплатно в этом месяце.',
    brand:'Sky Books', code:'PRIME-BOOK5', value:'5 книг', expiresIn:'до конца месяца', isPremium:false,
    color:['#059669','#047857'] },
  { id:'p9', category:'service', Icon:Trophy, title:'Sky Prime Ultra — пробный',
    desc:'3 дня бесплатного доступа к Sky Prime Ultra: все функции, питомец, анимации.',
    brand:'Sky Prime', code:'PRIME-ULTRA3', value:'3 дня Ultra', expiresIn:'5 дней', isPremium:false,
    color:['#fbbf24','#d97706'] },
  { id:'p10', category:'promo', Icon:Crown, title:'Prime в подарок — −20%',
    desc:'Скидка 20% на подарок Sky Prime другу. Сэкономьте и порадуйте близких.',
    brand:'Sky', code:'PRIME-GIFT20', value:'−20%', expiresIn:'12 дней', isPremium:false,
    color:['#8b5cf6','#7c3aed'] },
];

const C = {
  bg:'#0a0a10', l1:'#111118', l2:'var(--bg-l2)',
  border:'var(--border)', amber:'var(--amber)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
};

const CAT_LABELS = { game:'Игры', service:'Сервисы', promo:'Sky', fun:'Партнёры' };

const OfferCard = ({ offer }: { offer: PulseOffer }) => {
  const [copied, setCopied] = useState(false);
  const [open,   setOpen]   = useState(false);

  const copy = async () => {
    if (!offer.code) return;
    await navigator.clipboard.writeText(offer.code).catch(()=>{});
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  return (
    <motion.div whileTap={{ scale:.98 }}
      className="rounded-2xl overflow-hidden cursor-pointer"
      onClick={() => setOpen(o => !o)}
      style={{ background:`linear-gradient(135deg,${offer.color[0]}22,${C.l1})`,
        border:`1px solid ${offer.color[0]}40` }}>
      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          {/* Icon */}
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl"
            style={{ background:`linear-gradient(135deg,${offer.color[0]},${offer.color[1]})` }}>
            <offer.Icon size={20} style={{ color:'var(--amber)' }}/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1">
              <p className="text-sm font-bold leading-snug" style={{ color:C.t1 }}>{offer.title}</p>
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full shrink-0"
                style={{ background:`${offer.color[0]}30`, color:offer.color[0] }}>
                {offer.value}
              </span>
            </div>
            <p className="text-[10px] mt-0.5" style={{ color:C.t3 }}>{offer.brand}</p>
          </div>
        </div>

        {open && (
          <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }}>
            <p className="text-xs leading-relaxed mb-3" style={{ color:C.t2 }}>{offer.desc}</p>
            {offer.code && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-2"
                style={{ background:'rgba(0,0,0,0.3)', border:`1px solid ${C.border}` }}>
                <span className="font-mono text-sm font-bold flex-1" style={{ color:C.t1 }}>
                  {offer.code}
                </span>
                <motion.button whileTap={{ scale:.9 }} type="button" onClick={e => { e.stopPropagation(); copy(); }}
                  className="grid h-7 w-7 place-items-center rounded-lg transition-all"
                  style={{ background:copied?'rgba(34,197,94,0.2)':'var(--border)' }}>
                  {copied ? <Check size={13} style={{ color:'#22c55e' }}/> : <Copy size={13} style={{ color:C.t2 }}/>}
                </motion.button>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-[10px]" style={{ color:C.t3 }}>
                <Clock size={10}/> Действует: {offer.expiresIn}
              </div>
              {!offer.code && (
                <button type="button" onClick={e=>e.stopPropagation()}
                  className="text-[11px] font-semibold" style={{ color:offer.color[0] }}>
                  Активировать →
                </button>
              )}
            </div>
          </motion.div>
        )}

        {!open && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-[10px]" style={{ color:C.t3 }}>
              <Clock size={9}/> {offer.expiresIn}
            </div>
            <ChevronRight size={13} style={{ color:C.t3 }}/>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export const PrimePulse = () => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const isPrime = me?.isPrime ?? false;
  const [filter, setFilter] = useState<'all'|'game'|'service'|'promo'|'fun'>('all');

  const offers = OFFERS.filter(o => !o.isPremium && (filter === 'all' || o.category === filter));

  if (!isPrime) return (
    <div className="flex flex-col items-center justify-center gap-5 h-full px-6"
      style={{ background:C.bg }}>
      <div className="grid h-20 w-20 place-items-center rounded-3xl text-4xl"
        style={{ background:'linear-gradient(135deg,#f59e0b22,#d97706)' }}>
          <Zap size={18} style={{ color:'var(--amber)' }}/>
      </div>
      <div className="text-center">
        <p className="text-xl font-black" style={{ color:C.t1 }}>Prime Pulse</p>
        <p className="text-sm mt-2 leading-relaxed" style={{ color:C.t2 }}>
          Эксклюзивные предложения, промокоды и привилегии доступны только участникам Sky Prime.
        </p>
      </div>
      <div className="rounded-2xl px-5 py-4 w-full max-w-xs"
        style={{ background:'linear-gradient(135deg,#f59e0b18,#d9770610)', border:'1px solid rgba(245,158,11,0.3)' }}>
        <p className="text-sm font-bold text-center" style={{ color:C.amber }}>
          Оформите Prime в SkyMoney → Кошелёк
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:C.bg }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl text-2xl"
            style={{ background:'linear-gradient(135deg,#f59e0b,#d97706)' }}><Zap size={18} style={{ color:'#fff' }}/></div>
          <div>
            <p className="text-lg font-black" style={{ color:C.t1 }}>Prime Pulse</p>
            <p className="text-xs" style={{ color:C.amber }}>{offers.length} предложений для вас</p>
          </div>
        </div>

        {/* Featured banner */}
        <div className="rounded-2xl px-4 py-3 mb-3 relative overflow-hidden"
          style={{ background:'linear-gradient(135deg,#f59e0b22,#d9770615)' }}>
          <div className="absolute right-3 top-0 bottom-0 flex items-center opacity-30"><Gift size={34} style={{ color:'#fff' }}/></div>
          <p className="text-xs font-bold" style={{ color:C.amber }}>Ограниченное предложение</p>
          <p className="text-sm font-black text-white mt-0.5">Баллы Прайма ×2  -  весь месяц</p>
          <p className="text-[10px] mt-0.5" style={{ color:C.t3 }}>Осталось 7 дней</p>
        </div>

        {/* Category filter */}
        <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
          {(['all','game','service','promo','fun'] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className="rounded-full px-3 py-1.5 text-[11px] font-semibold shrink-0 transition-all"
              style={{ background:filter===f?C.amber:'var(--border)',
                color:filter===f?'#000':C.t3 }}>
              {f==='all' ? 'Все' : CAT_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Offer list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3" style={{ scrollbarWidth:'none' }}>
        {offers.map(o => <OfferCard key={o.id} offer={o}/>)}
      </div>
    </div>
  );
};
