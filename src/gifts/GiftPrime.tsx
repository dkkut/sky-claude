/* ===============================================================
   GIFT PRIME  -  Подарить подписку Sky Prime с праздничным фоном
=============================================================== */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Crown, Check, X, Star, Heart, Gift } from 'lucide-react';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { useAuthStore } from '@/core/auth/store';
import { useMessengerStore } from '@/messenger/store';
import { broadcast } from '@/messenger/socket';
import { useMoney } from '@/wallet/store';

export interface PrimeGiftTheme {
  id:       string;
  label:    string;
  emoji:    string;
  bg:       string;          // CSS gradient
  particles:string[];        // emoji particles
  textColor:string;
}

export const PRIME_GIFT_THEMES: PrimeGiftTheme[] = [
  {
    id:'classic', label:'Классика', emoji:'⭐',
    bg:'linear-gradient(135deg,#1a0040,#4a0080,#7c3aed)',
    particles:['⭐','✨','💜','🌟'],
    textColor:'#e9d5ff',
  },
  {
    id:'feb23', label:'23 февраля', emoji:'🎖️',
    bg:'linear-gradient(135deg,#0f2027,#203a43,#2c5364)',
    particles:['🎖️','⭐','🇷🇺','🌟','💫'],
    textColor:'#bae6fd',
  },
  {
    id:'mar8', label:'8 марта', emoji:'🌸',
    bg:'linear-gradient(135deg,#2d0036,#7b2d8b,#e91e8c)',
    particles:['🌸','💐','🌷','💕','✨'],
    textColor:'#fce7f3',
  },
  {
    id:'ny', label:'Новый год', emoji:'🎄',
    bg:'linear-gradient(135deg,#0a1628,#0f3460,#16213e)',
    particles:['🎄','🎁','❄️','⛄','🎆','✨'],
    textColor:'#d1fae5',
  },
  {
    id:'birthday', label:'День рождения', emoji:'🎂',
    bg:'linear-gradient(135deg,#1a0a00,#7c2d12,#ea580c)',
    particles:['🎂','🎁','🎉','🎈','🎊','⭐'],
    textColor:'#fef3c7',
  },
  {
    id:'love', label:'Любовь', emoji:'💖',
    bg:'linear-gradient(135deg,#1a0010,#831843,#db2777)',
    particles:['💖','💝','💗','🌹','✨','💫'],
    textColor:'#fce7f3',
  },
  {
    id:'victory', label:'9 мая', emoji:'🎗️',
    bg:'linear-gradient(135deg,#1a1200,#713f12,#ca8a04)',
    particles:['🎗️','⭐','🌟','🕊️','💫'],
    textColor:'#fef9c3',
  },
  {
    id:'gaming', label:'Для геймера', emoji:'🎮',
    bg:'linear-gradient(135deg,#001a0a,#064e3b,#059669)',
    particles:['🎮','⚡','🏆','🌟','💎'],
    textColor:'#d1fae5',
  },
];

const PRIME_DURATIONS = [
  { months:1,  price:299,  label:'1 месяц',   popular:false },
  { months:3,  price:799,  label:'3 месяца',  popular:true  },
  { months:6,  price:1499, label:'6 месяцев', popular:false },
  { months:12, price:2499, label:'1 год',      popular:false },
];

/* -- Confetti particle -------------------------------------- */
const Confetti = ({ theme }: { theme: PrimeGiftTheme }) => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden">
    {[...Array(18)].map((_,i) => (
      <motion.div key={i}
        className="absolute text-base select-none"
        style={{ left:`${(i*17+Math.sin(i)*20+100)%95}%`, top:-30 }}
        animate={{ y:['0vh','110vh'], x:[0,(i%2?1:-1)*30,0], rotate:[0,360*((i%2?1:-1))] }}
        transition={{ duration:2.5+i%3*0.5, delay:i*0.12, repeat:Infinity, ease:'linear' }}>
        {theme.particles[i % theme.particles.length]}
      </motion.div>
    ))}
  </div>
);

/* -- Gift card preview -------------------------------------- */
const PrimeGiftCard = ({ theme, toName, months, fromName, message }: {
  theme: PrimeGiftTheme; toName: string; months: number; fromName: string; message: string;
}) => (
  <div className="relative overflow-hidden rounded-3xl" style={{ background:theme.bg, minHeight:220 }}>
    <Confetti theme={theme}/>
    {/* Shine */}
    <div className="absolute inset-0 pointer-events-none"
      style={{ background:'linear-gradient(135deg,rgba(255,255,255,0.12) 0%,transparent 50%)' }}/>
    {/* Content */}
    <div className="relative z-10 flex flex-col items-center px-6 py-8 text-center">
      <motion.div className="text-5xl mb-3"
        animate={{ scale:[1,1.15,1], rotate:[0,5,-5,0] }}
        transition={{ duration:2, repeat:Infinity, ease:'easeInOut' }}>
        {theme.emoji}
      </motion.div>
      <div className="flex items-center gap-2 mb-2">
        <Crown size={16} style={{ color:theme.textColor }}/>
        <p className="text-lg font-black" style={{ color:'#fff' }}>Sky Prime</p>
        <Crown size={16} style={{ color:theme.textColor }}/>
      </div>
      <p className="text-sm font-semibold mb-1" style={{ color:'rgba(255,255,255,0.7)' }}>
        {months} {months===1?'месяц':months<5?'месяца':'месяцев'} подписки
      </p>
      <p className="text-xs" style={{ color:'rgba(255,255,255,0.5)' }}>для {toName || 'Получателя'}</p>
      {message && (
        <p className="mt-3 text-xs italic px-4 leading-relaxed"
          style={{ color:'rgba(255,255,255,0.65)' }}>«{message}»</p>
      )}
      <p className="mt-3 text-[10px]" style={{ color:'rgba(255,255,255,0.35)' }}>от {fromName}</p>
    </div>
  </div>
);

/* === GIFT PRIME MODAL ==================================== */
interface GiftPrimeProps {
  toUserId: string;
  toName:   string;
  onClose:  () => void;
}

export const GiftPrimeModal = ({ toUserId, toName, onClose }: GiftPrimeProps) => {
  const { accounts, currentUserId, grantPrime } = useAuthStore();
  const { spend, getBalance }  = useMoney();
  const me = accounts.find(a => a.id === currentUserId);

  const [step,     setStep]     = useState<'theme'|'duration'|'message'|'confirm'|'done'>('theme');
  const [theme,    setTheme]    = useState(PRIME_GIFT_THEMES[0]);
  const [duration, setDuration] = useState(PRIME_DURATIONS[1]);
  const [message,  setMessage]  = useState('');
  const [err,      setErr]      = useState('');

  const balance = getBalance(currentUserId ?? '');

  const handleSend = () => {
    setErr('');
    if (balance < duration.price) { setErr(`Недостаточно средств. Нужно ${duration.price} ₽`); return; }
    const ok = spend(currentUserId!, duration.price, 'market', `Подарок Prime → ${toName}`);
    if (!ok) { setErr('Ошибка оплаты'); return; }
    grantPrime(toUserId, duration.months * 30);
    // Send to chat — setActiveChat first so sendMessage uses correct chatId
    try {
      const msStore = useMessengerStore.getState();
      const chat = msStore.chats.find((ch: any) =>
        ch.type === 'direct' &&
        Array.isArray(ch.members) &&
        ch.members.includes(currentUserId!) &&
        ch.members.includes(toUserId)
      );
      if (chat) {
        const months = duration.months;
        const label = months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев';
        const text = `${theme.emoji} Я подарил(а) тебе Sky Prime на ${months} ${label}!${message ? ' «' + message + '»' : ''}`;
        // Must set active chat before calling sendMessage
        msStore.setActiveChat(chat.id);
          // Send as prime_gift card (renders as animated gift card in chat)
        const primeGiftPayload = JSON.stringify({
          type:      'prime_gift',
          themeId:   theme.id,
          themeBg:   theme.bg,
          themeEmoji:theme.emoji,
          themeTextColor: theme.textColor,
          months:    duration.months,
          durationLabel: duration.label,
          price:     duration.price,
          message,
          fromName:  me?.name ?? '',
          toName,
        });
        const msg = msStore.sendMessage({ kind: 'prime_gift', text: primeGiftPayload });
        if (msg) {
          try { broadcast.message(msg); } catch {}
        }
      }
    } catch (e) { console.error('[GiftPrime] sendMessage failed', e); }
    setStep('done');
  };

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        className="fixed inset-0 z-[400] flex items-end justify-center"
        style={{ background:'rgba(0,0,0,0.8)', backdropFilter:'blur(12px)' }}
        onClick={onClose}>
        <motion.div initial={{ y:80, opacity:0 }} animate={{ y:0, opacity:1 }}
          exit={{ y:80 }} transition={{ type:'spring', damping:28, stiffness:300 }}
          className="w-full max-w-md overflow-hidden"
          style={{ background:'#0f0f16', borderRadius:'28px 28px 0 0', maxHeight:'90vh' }}
          onClick={e => e.stopPropagation()}>

          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full" style={{ background:'rgba(255,255,255,0.2)' }}/>
          </div>

          {/* Done state */}
          {step === 'done' && (
            <div className="relative flex flex-col items-center gap-5 px-6 py-8 overflow-hidden">
              <Confetti theme={theme}/>

              {/* ── Animated Gift Card ─────────────────────── */}
              <motion.div
                initial={{ scale: 0.35, rotateX: 55, rotateY: -20, opacity: 0, y: 50 }}
                animate={{ scale: 1,    rotateX: 0,  rotateY: 0,   opacity: 1, y: 0  }}
                transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.05 }}
                style={{ perspective: 1100, width: '100%', maxWidth: 292, position: 'relative', zIndex: 10 }}>

                {/* Card body */}
                <div className="relative rounded-3xl overflow-hidden"
                  style={{
                    background: theme.bg,
                    border: '1.5px solid rgba(255,255,255,0.2)',
                    boxShadow: `0 28px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05), 0 0 50px ${theme.textColor}28`,
                    minHeight: 240,
                  }}>

                  {/* Animated shimmer sweep */}
                  <motion.div className="absolute inset-0 pointer-events-none"
                    style={{ background: 'linear-gradient(108deg, transparent 20%, rgba(255,255,255,0.16) 50%, transparent 80%)', backgroundSize: '250% 100%' }}
                    animate={{ backgroundPosition: ['250% 0', '-250% 0'] }}
                    transition={{ duration: 2.0, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.8 }}
                  />

                  {/* Top-left gloss */}
                  <div className="absolute top-0 left-0 right-0 pointer-events-none rounded-t-3xl"
                    style={{ height: '42%', background: 'linear-gradient(180deg,rgba(255,255,255,0.11) 0%,transparent 100%)' }}/>

                  {/* Bottom gradient darkener */}
                  <div className="absolute bottom-0 left-0 right-0 pointer-events-none"
                    style={{ height: '35%', background: 'linear-gradient(0deg,rgba(0,0,0,0.35) 0%,transparent 100%)' }}/>

                  {/* Floating sparkles */}
                  {['✦','✧','✦','✧','✦','✧'].map((s, i) => (
                    <motion.span key={i}
                      className="absolute pointer-events-none select-none"
                      style={{ fontSize: 10 + (i % 3) * 3, top: `${8 + i * 15}%`, left: `${3 + i * 18}%`, color: theme.textColor }}
                      animate={{ opacity: [0.15, 0.75, 0.15], scale: [0.7, 1.4, 0.7] }}
                      transition={{ duration: 1.5 + i * 0.22, repeat: Infinity, ease: 'easeInOut', delay: i * 0.28 }}>
                      {s}
                    </motion.span>
                  ))}

                  {/* Card content */}
                  <div className="relative z-10 flex flex-col items-center px-6 py-7 text-center">

                    {/* Bouncing crown */}
                    <motion.div
                      initial={{ y: -30, opacity: 0, scale: 0.5 }}
                      animate={{ y: 0,   opacity: 1, scale: 1   }}
                      transition={{ type: 'spring', stiffness: 380, damping: 14, delay: 0.25 }}>
                      <motion.div
                        animate={{ y: [0, -9, 0], rotate: [-4, 4, -4], scale: [1, 1.07, 1] }}
                        transition={{ duration: 2.3, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ fontSize: 52, lineHeight: 1 }}>
                        👑
                      </motion.div>
                    </motion.div>

                    {/* Title */}
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.38 }}
                      className="flex items-center gap-2 mt-3 mb-1">
                      <Crown size={13} style={{ color: theme.textColor }}/>
                      <p className="text-xl font-black tracking-wide"
                        style={{ color: '#fff', textShadow: `0 0 24px ${theme.textColor}99` }}>
                        Sky Prime
                      </p>
                      <Crown size={13} style={{ color: theme.textColor }}/>
                    </motion.div>

                    {/* Duration pill */}
                    <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.46, type: 'spring', stiffness: 420, damping: 24 }}
                      className="rounded-full px-4 py-1 mb-3"
                      style={{ background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.22)', backdropFilter: 'blur(8px)' }}>
                      <p className="text-[13px] font-bold" style={{ color: theme.textColor }}>
                        {duration.label} · {duration.price} ₽
                      </p>
                    </motion.div>

                    {/* Recipient block */}
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.55 }}
                      className="w-full rounded-2xl px-4 py-3 mb-2"
                      style={{ background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.09)' }}>
                      <p className="text-[9px] uppercase tracking-[0.18em] font-bold mb-0.5"
                        style={{ color: 'rgba(255,255,255,0.38)' }}>Получатель</p>
                      <p className="text-base font-black" style={{ color: '#fff' }}>{toName}</p>
                    </motion.div>

                    {/* Message */}
                    {message && (
                      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.63 }}
                        className="text-xs italic leading-relaxed mb-1.5 px-1"
                        style={{ color: 'rgba(255,255,255,0.58)' }}>
                        «{message}»
                      </motion.p>
                    )}

                    {/* From */}
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.68 }}
                      className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      от {me?.name}
                    </motion.p>

                    {/* Feature pills */}
                    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.74 }}
                      className="mt-3 flex flex-wrap justify-center gap-1.5">
                      {['🚀 Без рекламы','⭐ Badge','🎬 HD','🎙 Подкасты'].map(f => (
                        <span key={f} className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(255,255,255,0.09)', color: theme.textColor, border: '1px solid rgba(255,255,255,0.1)' }}>
                          {f}
                        </span>
                      ))}
                    </motion.div>
                  </div>
                </div>
              </motion.div>

              {/* Success label */}
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 }}
                className="text-center relative z-10">
                <motion.p
                  animate={{ scale: [1, 1.04, 1] }}
                  transition={{ duration: 1.9, repeat: Infinity }}
                  className="text-lg font-black text-white">
                  Подарок отправлен! 🎉
                </motion.p>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.42)' }}>
                  {toName} получил Sky Prime · {duration.label}
                </p>
              </motion.div>

              {/* Close */}
              <motion.button
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.75 }}
                whileTap={{ scale: 0.95 }}
                type="button" onClick={onClose}
                className="relative z-10 w-full rounded-2xl py-3.5 text-sm font-black"
                style={{ background: 'rgba(255,255,255,0.11)', color: '#fff', border: '1px solid rgba(255,255,255,0.16)', cursor: 'pointer' }}>
                Отлично! ✓
              </motion.button>

              <style>{`
                @keyframes primeCardShimmer {
                  0%  { background-position: 250% 0 }
                  100%{ background-position: -250% 0 }
                }
                @keyframes primeStarPulse {
                  0%,100%{ opacity:.2; transform:scale(.8)  }
                  50%    { opacity:.85;transform:scale(1.35) }
                }
              `}</style>
            </div>
          )}
          {step !== 'done' && (
            <div className="overflow-y-auto" style={{ maxHeight:'85vh', scrollbarWidth:'none' }}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 pb-3">
                <div>
                  <p className="text-base font-black text-white">⭐ Подарить Prime</p>
                  <p className="text-xs" style={{ color:'rgba(255,255,255,0.45)' }}>для {toName}</p>
                </div>
                <button type="button" onClick={onClose}
                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10">
                  <X size={16} style={{ color:'rgba(255,255,255,0.5)' }}/>
                </button>
              </div>

              {/* Step progress */}
              <div className="flex gap-1 px-5 mb-4">
                {(['theme','duration','message','confirm'] as const).map((s,i) => (
                  <div key={s} className="flex-1 h-1 rounded-full transition-all"
                    style={{ background: ['theme','duration','message','confirm'].indexOf(step) >= i
                      ? 'var(--amber)' : 'rgba(255,255,255,0.1)' }}/>
                ))}
              </div>

              <div className="px-5 pb-8 space-y-4">

                {/* STEP 1: Theme */}
                {step === 'theme' && (
                  <>
                    <p className="text-sm font-bold text-white">Выберите оформление</p>
                    <div className="grid grid-cols-2 gap-3">
                      {PRIME_GIFT_THEMES.map(t => (
                        <motion.button key={t.id} type="button" whileTap={{ scale:.95 }}
                          onClick={() => setTheme(t)}
                          className="relative overflow-hidden rounded-2xl h-20 flex flex-col items-center justify-center gap-1.5"
                          style={{ background:t.bg,
                            border:`2px solid ${theme.id===t.id?'rgba(255,255,255,0.8)':'rgba(255,255,255,0.1)'}`,
                            boxShadow:theme.id===t.id?'0 0 0 3px rgba(245,158,11,0.4)':'none' }}>
                          <span className="text-2xl">{t.emoji}</span>
                          <span className="text-[11px] font-bold" style={{ color:t.textColor }}>{t.label}</span>
                          {theme.id===t.id && (
                            <div className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-yellow-400">
                              <Check size={10} className="text-black"/>
                            </div>
                          )}
                        </motion.button>
                      ))}
                    </div>
                    <PrimeGiftCard theme={theme} toName={toName} months={duration.months} fromName={me?.name??''} message=""/>
                    <motion.button whileTap={{ scale:.97 }} type="button" onClick={() => setStep('duration')}
                      className="w-full rounded-2xl py-4 text-sm font-bold text-white"
                      style={{ background:'linear-gradient(135deg,#f59e0b,#d97706)' }}>
                      Далее →
                    </motion.button>
                  </>
                )}

                {/* STEP 2: Duration */}
                {step === 'duration' && (
                  <>
                    <p className="text-sm font-bold text-white">Длительность подписки</p>
                    <div className="space-y-2">
                      {PRIME_DURATIONS.map(d => (
                        <motion.button key={d.months} type="button" whileTap={{ scale:.98 }}
                          onClick={() => setDuration(d)}
                          className="flex items-center gap-3 w-full rounded-2xl p-4 transition-all"
                          style={{ background: duration.months===d.months ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.04)',
                            border:`1.5px solid ${duration.months===d.months?'var(--amber)':'var(--border)'}` }}>
                          <div className="grid h-10 w-10 place-items-center rounded-xl shrink-0 text-xl"
                            style={{ background:'rgba(245,158,11,0.15)' }}>
                            {d.months===12?'👑':d.months===6?'⭐':d.months===3?'✨':'🌟'}
                          </div>
                          <div className="flex-1 text-left">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold text-white">{d.label}</p>
                              {d.popular && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ background:'var(--amber)', color:'#000' }}>Популярно</span>}
                            </div>
                          </div>
                          <p className="text-base font-black" style={{ color:'var(--amber)' }}>{d.price} ₽</p>
                          {duration.months===d.months && <Check size={16} style={{ color:'var(--amber)' }}/>}
                        </motion.button>
                      ))}
                    </div>
                    <p className="text-[10px] text-center" style={{ color:'rgba(255,255,255,0.3)' }}>
                      Баланс: {balance.toLocaleString('ru')} ₽ · {balance < duration.price ? '⚠️ Недостаточно средств' : '✓ Достаточно'}
                    </p>
                    <motion.button whileTap={{ scale:.97 }} type="button" onClick={() => setStep('message')}
                      className="w-full rounded-2xl py-4 text-sm font-bold text-white"
                      style={{ background:'linear-gradient(135deg,#f59e0b,#d97706)', opacity:balance<duration.price?0.5:1 }}
                      disabled={balance < duration.price}>
                      Далее →
                    </motion.button>
                  </>
                )}

                {/* STEP 3: Message */}
                {step === 'message' && (
                  <>
                    <p className="text-sm font-bold text-white">Личное сообщение</p>
                    <textarea value={message} onChange={e=>setMessage(e.target.value)}
                      placeholder="Поздравляю! Пусть Prime добавит радости 🎉" maxLength={150} rows={3}
                      className="w-full rounded-2xl px-4 py-3 text-sm outline-none resize-none"
                      style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'var(--t1)' }}/>
                    <p className="text-[10px] text-right" style={{ color:'rgba(255,255,255,0.3)' }}>{message.length}/150</p>
                    <PrimeGiftCard theme={theme} toName={toName} months={duration.months} fromName={me?.name??''} message={message}/>
                    <motion.button whileTap={{ scale:.97 }} type="button" onClick={() => setStep('confirm')}
                      className="w-full rounded-2xl py-4 text-sm font-bold text-white"
                      style={{ background:'linear-gradient(135deg,#f59e0b,#d97706)' }}>
                      Предпросмотр →
                    </motion.button>
                  </>
                )}

                {/* STEP 4: Confirm */}
                {step === 'confirm' && (
                  <>
                    <PrimeGiftCard theme={theme} toName={toName} months={duration.months} fromName={me?.name??''} message={message}/>
                    <div className="rounded-2xl p-4 space-y-2"
                      style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)' }}>
                      {[
                        { l:'Получатель', v:toName },
                        { l:'Подписка',  v:`Sky Prime ${duration.label}` },
                        { l:'Стоимость', v:`${duration.price} ₽` },
                        { l:'Оформление',v:`${theme.emoji} ${theme.label}` },
                      ].map(({l,v}) => (
                        <div key={l} className="flex justify-between text-sm">
                          <span style={{ color:'rgba(255,255,255,0.5)' }}>{l}</span>
                          <span className="font-semibold text-white">{v}</span>
                        </div>
                      ))}
                    </div>
                    {err && <p className="text-xs text-center" style={{ color:'var(--red)' }}>{err}</p>}
                    <motion.button whileTap={{ scale:.97 }} type="button" onClick={handleSend}
                      className="flex items-center justify-center gap-2 w-full rounded-2xl py-4 text-base font-black text-black"
                      style={{ background:'linear-gradient(135deg,#fbbf24,#f59e0b,#d97706)',
                        boxShadow:'0 8px 32px rgba(245,158,11,0.5)' }}>
                      <Crown size={18}/> Подарить Prime · {duration.price} ₽
                    </motion.button>
                  </>
                )}

              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

/* ══════════════════════════════════════════════════════════════
   PRIME GIFT BUBBLE  —  рендерится в чате как карточка-сообщение
   Точь-в-точь как физическая gift card
══════════════════════════════════════════════════════════════ */
export interface PrimeGiftData {
  type:           string;
  themeId:        string;
  themeBg:        string;
  themeEmoji:     string;
  themeTextColor: string;
  months:         number;
  durationLabel:  string;
  price:          number;
  message?:       string;
  fromName:       string;
  toName:         string;
}

export const PrimeGiftBubble = ({ data, fromMe }: { data: PrimeGiftData; fromMe: boolean }) => {
  const [hovered, setHovered] = useState(false);
  const isMobile = useIsMobile();
  const [opened,  setOpened]  = useState(false);
  const tc = data.themeTextColor;

  return (
    <motion.div
      initial={{ scale: 0.72, opacity: 0, y: 20 }}
      animate={{ scale: 1,    opacity: 1, y: 0  }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>

      <div style={{ perspective: 700 }}
        onMouseEnter={() => { if (!isMobile) setHovered(true); }}
        onMouseLeave={() => { if (!isMobile) setHovered(false); }}>

        <motion.div
          animate={{
            rotateY: hovered ? (fromMe ? -12 : 12) : 0,
            rotateX: hovered ? -6 : 0,
            scale:   hovered ? 1.04 : 1,
            y:       hovered ? -5 : 0,
          }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          style={{ transformStyle: 'preserve-3d' }}>

          {/* ── Card ─────────────────────────────────────── */}
          <div className="relative overflow-hidden"
            style={{
              width: 220,
              borderRadius: 24,
              background: data.themeBg,
              border: '1.5px solid rgba(255,255,255,0.18)',
              boxShadow: hovered
                ? `0 28px 70px rgba(0,0,0,0.65), 0 0 48px ${tc}38, inset 0 1px 0 rgba(255,255,255,0.18)`
                : `0 12px 40px rgba(0,0,0,0.5), 0 0 28px ${tc}20, inset 0 1px 0 rgba(255,255,255,0.1)`,
              cursor: 'pointer',
            }}
            onClick={() => setOpened(o => !o)}>

            {/* Shimmer sweep */}
            <motion.div className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(108deg,transparent 20%,rgba(255,255,255,0.15) 50%,transparent 80%)',
                backgroundSize: '240% 100%',
              }}
              animate={{ backgroundPosition: ['240% 0','-240% 0'] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1 }}
            />

            {/* Top gloss */}
            <div className="absolute top-0 left-0 right-0 pointer-events-none"
              style={{ height: '45%', background: 'linear-gradient(180deg,rgba(255,255,255,0.12),transparent)', borderRadius: '24px 24px 0 0' }}/>

            {/* Floating sparkles */}
            {['✦','✧','✦','✧'].map((s, i) => (
              <motion.span key={i}
                className="absolute pointer-events-none select-none"
                style={{ fontSize: 9 + (i % 2) * 3, top: `${10 + i * 20}%`, left: `${3 + i * 24}%`, color: tc }}
                animate={{ opacity: [0.1, 0.65, 0.1], scale: [0.7, 1.3, 0.7] }}
                transition={{ duration: 1.6 + i * 0.25, repeat: Infinity, delay: i * 0.3 }}>
                {s}
              </motion.span>
            ))}

            {/* Content */}
            <div className="relative z-10 px-5 pt-5 pb-4 text-center">

              {/* Crown emoji */}
              <motion.div
                animate={{ y: [0, -7, 0], rotate: [-3, 3, -3], scale: [1, 1.06, 1] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                style={{ fontSize: 40, lineHeight: 1, marginBottom: 8, filter: `drop-shadow(0 6px 14px ${tc}60)` }}>
                👑
              </motion.div>

              {/* SKY PRIME */}
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Crown size={11} style={{ color: tc }}/>
                <p className="text-base font-black tracking-wide"
                  style={{ color: '#fff', textShadow: `0 0 18px ${tc}88` }}>
                  Sky Prime
                </p>
                <Crown size={11} style={{ color: tc }}/>
              </div>

              {/* Duration pill */}
              <div className="inline-flex items-center rounded-full px-3 py-0.5 mb-3"
                style={{ background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.2)' }}>
                <p className="text-[11px] font-bold" style={{ color: tc }}>
                  {data.durationLabel}
                </p>
              </div>

              {/* Divider */}
              <div className="h-px mx-2 mb-3" style={{ background: 'rgba(255,255,255,0.1)' }}/>

              {/* To / from */}
              <div className="rounded-xl px-3 py-2.5 mb-2"
                style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-[9px] uppercase tracking-[0.15em] font-bold mb-0.5"
                  style={{ color: 'rgba(255,255,255,0.38)' }}>
                  {fromMe ? 'Получатель' : 'Отправитель'}
                </p>
                <p className="text-sm font-black" style={{ color: '#fff' }}>
                  {fromMe ? data.toName : data.fromName}
                </p>
              </div>

              {/* Message — revealed on tap */}
              <motion.div
                initial={false}
                animate={{ height: opened && data.message ? 'auto' : 0, opacity: opened && data.message ? 1 : 0 }}
                transition={{ duration: 0.22 }}
                style={{ overflow: 'hidden' }}>
                {data.message && (
                  <p className="text-[11px] italic leading-relaxed mt-1 mb-2 px-1"
                    style={{ color: 'rgba(255,255,255,0.6)' }}>
                    «{data.message}»
                  </p>
                )}
              </motion.div>

              {/* Tap hint */}
              {data.message && !opened && (
                <p className="text-[9px] mt-1" style={{ color: 'rgba(255,255,255,0.28)' }}>
                  нажми, чтобы читать
                </p>
              )}

              {/* Feature pills */}
              <div className="flex flex-wrap justify-center gap-1 mt-2">
                {['🚀 Без рекламы','⭐ Badge','🎬 HD'].map(f => (
                  <span key={f} className="text-[8px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: 'rgba(255,255,255,0.09)', color: tc, border: '1px solid rgba(255,255,255,0.09)' }}>
                    {f}
                  </span>
                ))}
              </div>

              {/* From line */}
              <p className="text-[9px] mt-2.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
                {fromMe ? `от ${data.fromName}` : `для ${data.toName}`}
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};
