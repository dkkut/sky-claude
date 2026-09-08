/* ===============================================================
   ADVANCED MSG FEATURES
   Однократный просмотр, спойлер, самоудаление, опросы, планировщик
=============================================================== */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Timer, BarChart2, Check, Clock, Send, X, Plus, Trash2 } from 'lucide-react';
import { useMessengerStore } from './store';
import { useAuthStore } from '@/core/auth/store';
import type { MessageItem } from './types';

const C = { accent:'#5b9bd1', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)', border:'var(--border)', l2:'#1e1e24' };

/* === SPOILER TEXT ========================================== */
export const SpoilerText = ({ text, color }: { text: string; color: string }) => {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed(r => !r)}
      className="cursor-pointer select-none inline-block text-[14px] leading-relaxed"
      style={{ color: revealed ? color : 'transparent',
        background: revealed ? 'transparent' : 'rgba(255,255,255,0.25)',
        borderRadius: 4, padding: revealed ? 0 : '0 2px',
        transition: 'all 0.25s' }}>
      {text}
    </span>
  );
};

/* === ONCE VIEW TEXT/PHOTO ================================== */
export const OnceViewText = ({ msg, fromMe, color }: { msg: MessageItem; fromMe: boolean; color: string }) => {
  const { deleteMessage } = useMessengerStore();
  const [viewed, setViewed] = useState(false);

  const open = () => {
    setViewed(true);
    // Auto-delete after 5s for non-sender
    if (!fromMe) setTimeout(() => deleteMessage(msg.id), 5000);
  };

  if (viewed) return (
    <div>
      <p className="text-[14px] leading-relaxed whitespace-pre-wrap" style={{ color }}>
        {msg.text}
      </p>
      {!fromMe && (
        <p className="text-[10px] mt-1" style={{ color:C.t3 }}>
          Исчезнет через 5 секунд...
        </p>
      )}
    </div>
  );

  return (
    <motion.div
      whileTap={{ scale: 0.95 }}
      onClick={open}
      className="flex items-center gap-2.5 cursor-pointer py-1"
      style={{ opacity: 0.9 }}>
      <div className="grid h-9 w-9 place-items-center rounded-full shrink-0"
        style={{ background: `${C.accent}20`, border: `1.5px solid ${C.accent}60` }}>
        <Eye size={16} style={{ color: C.accent }}/>
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: C.accent }}>
          Однократное сообщение
        </p>
        <p className="text-[10px]" style={{ color: C.t3 }}>
          {fromMe ? 'Только один просмотр' : 'Нажмите чтобы прочитать'}
        </p>
      </div>
    </motion.div>
  );
};

/* === SELF-DESTRUCT TIMER ================================== */
export const SelfDestructTimer = ({ msg, fromMe }: { msg: MessageItem; fromMe: boolean }) => {
  const { deleteMessage } = useMessengerStore();
  const [left, setLeft] = useState<number>(() => {
    if (!msg.destroyAt) return msg.selfDestruct ?? 0;
    return Math.max(0, Math.floor((msg.destroyAt - Date.now()) / 1000));
  });

  useEffect(() => {
    if (left <= 0) { deleteMessage(msg.id); return; }
    const t = setInterval(() => setLeft(l => {
      if (l <= 1) { clearInterval(t); deleteMessage(msg.id); return 0; }
      return l - 1;
    }), 1000);
    return () => clearInterval(t);
  }, []);

  if (left <= 0) return null;

  const pct = msg.selfDestruct ? (left / msg.selfDestruct) * 100 : 100;

  return (
    <div className={`flex items-center gap-1.5 mb-0.5 ${fromMe ? 'justify-end' : 'justify-start'}`}>
      <div className="relative h-4 w-4">
        <svg width="16" height="16" viewBox="0 0 16 16" style={{ transform:'rotate(-90deg)' }}>
          <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2"/>
          <motion.circle cx="8" cy="8" r="6" fill="none"
            stroke={left <= 5 ? 'var(--red)' : 'var(--amber)'}
            strokeWidth="2" strokeLinecap="round"
            strokeDasharray={2*Math.PI*6}
            strokeDashoffset={2*Math.PI*6*(1-pct/100)}
            transition={{ duration:1, ease:'linear' }}/>
        </svg>
      </div>
      <span className="text-[10px] font-mono font-bold" style={{ color: left <= 5 ? 'var(--red)' : 'var(--amber)' }}>
        {left}с
      </span>
    </div>
  );
};

/* === POLL BUBBLE ========================================== */
interface PollBubbleProps {
  poll: NonNullable<MessageItem['poll']>;
  msgId: string;
  fromMe: boolean;
}

export const PollBubble = ({ poll, msgId, fromMe }: PollBubbleProps) => {
  const voteInPoll = useMessengerStore(s => s.voteInPoll);
  // Кто я — из хранилища входа. Раньше здесь читалась переменная окна,
  // которую никто никогда не выставлял: свой голос не находился, и
  // опрос всегда выглядел так, будто человек не голосовал.
  const myId = useAuthStore(s => s.currentUserId) ?? '';

  const total = poll.options.reduce((s,o) => s + o.votes.length, 0);

  // Свой голос виден в самих данных опроса — их присылает сервер.
  // Прежняя память вкладки терялась при первой же перерисовке.
  const myVotes = poll.options.filter(o => o.votes.includes(myId)).map(o => o.id);

  const vote = (optId: string) => {
    if (poll.closed) return;
    voteInPoll(msgId, optId);
  };

  const hasVoted = myVotes.length > 0;

  return (
    <div className="min-w-[200px] max-w-[260px]">
      <div className="flex items-center gap-1.5 mb-2.5">
        <BarChart2 size={13} style={{ color: fromMe ? 'rgba(255,255,255,0.7)' : C.accent }}/>
        <span className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: fromMe ? 'rgba(255,255,255,0.5)' : C.t3 }}>
          {poll.anonymous ? 'Анонимный опрос' : 'Опрос'}
          {poll.multiple ? ' · Несколько ответов' : ''}
        </span>
      </div>
      <p className="text-[14px] font-semibold mb-3"
        style={{ color: fromMe ? '#fff' : C.t1 }}>
        {poll.question}
      </p>
      <div className="space-y-2">
        {poll.options.map(opt => {
          const pct = total > 0 ? Math.round(opt.votes.length / total * 100) : 0;
          const voted = myVotes.includes(opt.id) || opt.votes.includes(myId);
          return (
            <motion.button key={opt.id} type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => vote(opt.id)}
              disabled={poll.closed}
              className="relative w-full rounded-xl px-3 py-2.5 overflow-hidden text-left transition-all"
              style={{
                background: voted ? `${C.accent}20` : 'var(--border)',
                border: `1.5px solid ${voted ? C.accent + '60' : 'rgba(255,255,255,0.1)'}`,
              }}>
              {/* Progress bar */}
              {(hasVoted || poll.closed) && (
                <motion.div className="absolute inset-y-0 left-0 rounded-xl"
                  initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  style={{ background: voted ? `${C.accent}25` : 'rgba(255,255,255,0.05)' }}/>
              )}
              <div className="relative flex items-center justify-between gap-2">
                <span className="text-sm" style={{ color: voted ? C.accent : C.t1 }}>
                  {opt.text}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {voted && <Check size={12} style={{ color: C.accent }}/>}
                  {(hasVoted || poll.closed) && (
                    <span className="text-[11px] font-bold" style={{ color: voted ? C.accent : C.t3 }}>
                      {pct}%
                    </span>
                  )}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
      {total > 0 && (
        <p className="text-[10px] mt-2" style={{ color: C.t3 }}>
          {total} {total === 1 ? 'голос' : total < 5 ? 'голоса' : 'голосов'}
          {poll.closed ? ' · Закрыт' : ''}
        </p>
      )}
    </div>
  );
};

/* === MESSAGE OPTIONS PANEL ================================
   Расширенные опции при отправке: однократно, спойлер, таймер, тихо
=========================================================== */
interface MsgOptionsProps {
  options: {
    once:        boolean;
    spoiler:     boolean;
    silent:      boolean;
    selfDestruct:number;  // 0 = off
    scheduled:   boolean;
    scheduledAt: string;  // datetime-local value
  };
  onChange: (o: MsgOptionsProps['options']) => void;
  onClose:  () => void;
}

export const MsgOptionsPanel = ({ options, onChange, onClose }: MsgOptionsProps) => {
  const set = (patch: Partial<MsgOptionsProps['options']>) =>
    onChange({ ...options, ...patch });

  const TIMERS = [
    { v:0,    l:'Без таймера' },
    { v:10,   l:'10 секунд' },
    { v:30,   l:'30 секунд' },
    { v:60,   l:'1 минута' },
    { v:300,  l:'5 минут' },
    { v:3600, l:'1 час' },
  ];

  return (
    <motion.div initial={{ opacity:0, y:10, scale:0.96 }} animate={{ opacity:1, y:0, scale:1 }}
      exit={{ opacity:0, y:10 }}
      className="absolute bottom-full left-0 mb-2 z-[200] rounded-2xl p-3 w-[85vw] max-w-72"
      style={{ background:'var(--bg-l2)', border:'1px solid rgba(255,255,255,0.1)', boxShadow:'0 16px 48px rgba(0,0,0,0.7)' }}
      onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold" style={{ color:C.t1 }}>Параметры сообщения</span>
        <button type="button" onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-full hover:bg-white/5">
          <X size={12} style={{ color:C.t3 }}/>
        </button>
      </div>

      {/* Toggle rows */}
      {([
        { key:'once',    icon:'👁',  label:'Однократный просмотр', sub:'Удалится после прочтения' },
        { key:'spoiler', icon:'🙈',  label:'Спойлер',              sub:'Текст скрыт до нажатия'  },
        { key:'silent',  icon:'🔕',  label:'Без звука',            sub:'Получатель не услышит'   },
      ] as const).map(({ key, icon, label, sub }) => (
        <button key={key} type="button"
          onClick={() => set({ [key]: !options[key] } as any)}
          className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 mb-1.5 transition-all"
          style={{
            background: options[key] ? `${C.accent}15` : 'rgba(255,255,255,0.04)',
            border: `1px solid ${options[key] ? C.accent+'40' : 'transparent'}`,
          }}>
          <span className="text-base">{icon}</span>
          <div className="flex-1 text-left">
            <p className="text-xs font-semibold" style={{ color: options[key] ? C.accent : C.t1 }}>{label}</p>
            <p className="text-[10px]" style={{ color: C.t3 }}>{sub}</p>
          </div>
          <div className="h-5 w-9 rounded-full relative transition-colors"
            style={{ background: options[key] ? C.accent : 'rgba(255,255,255,0.1)' }}>
            <motion.div className="absolute top-0.5 h-4 w-4 rounded-full bg-white"
              animate={{ left: options[key] ? 20 : 2 }} transition={{ type:'spring', stiffness:500, damping:30 }}/>
          </div>
        </button>
      ))}

      {/* Self-destruct timer */}
      <div className="mt-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 px-1"
          style={{ color:C.t3 }}>
          ⏱ Самоудаление
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TIMERS.map(t => (
            <button key={t.v} type="button"
              onClick={() => set({ selfDestruct: t.v })}
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all"
              style={{
                background: options.selfDestruct===t.v ? `${C.accent}20` : 'var(--border)',
                border: `1px solid ${options.selfDestruct===t.v ? C.accent+'55' : 'var(--border)'}`,
                color: options.selfDestruct===t.v ? C.accent : C.t3,
              }}>
              {t.l}
            </button>
          ))}
        </div>
      </div>

      {/* Scheduled send */}
      <div className="mt-3 pt-3" style={{ borderTop:'1px solid rgba(255,255,255,0.06)' }}>
        <button type="button"
          onClick={() => set({ scheduled: !options.scheduled })}
          className="flex items-center gap-2 w-full rounded-xl px-3 py-2.5 mb-2 transition-all"
          style={{
            background: options.scheduled ? `${C.accent}15` : 'rgba(255,255,255,0.04)',
            border: `1px solid ${options.scheduled ? C.accent+'40' : 'transparent'}`,
          }}>
          <Clock size={14} style={{ color: options.scheduled ? C.accent : C.t3 }}/>
          <div className="flex-1 text-left">
            <p className="text-xs font-semibold" style={{ color: options.scheduled ? C.accent : C.t1 }}>
              Запланировать отправку
            </p>
          </div>
          <div className="h-5 w-9 rounded-full relative"
            style={{ background: options.scheduled ? C.accent : 'rgba(255,255,255,0.1)' }}>
            <motion.div className="absolute top-0.5 h-4 w-4 rounded-full bg-white"
              animate={{ left: options.scheduled ? 20 : 2 }} transition={{ type:'spring', stiffness:500, damping:30 }}/>
          </div>
        </button>
        {options.scheduled && (
          <input type="datetime-local" value={options.scheduledAt}
            onChange={e => set({ scheduledAt: e.target.value })}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none"
            style={{ background:'var(--border)', border:'1px solid rgba(255,255,255,0.1)', color:C.t1 }}/>
        )}
      </div>
    </motion.div>
  );
};

/* === CREATE POLL MODAL ==================================== */
interface CreatePollProps {
  onSend: (poll: NonNullable<MessageItem['poll']>) => void;
  onClose: () => void;
}

export const CreatePollModal = ({ onSend, onClose }: CreatePollProps) => {
  const [question, setQuestion] = useState('');
  const [options,  setOptions]  = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [anon,     setAnon]     = useState(true);

  const addOpt   = () => options.length < 10 && setOptions(o => [...o, '']);
  const removeOpt = (i: number) => options.length > 2 && setOptions(o => o.filter((_,j) => j!==i));
  const setOpt   = (i: number, v: string) => setOptions(o => o.map((x,j) => j===i ? v : x));

  const send = () => {
    if (!question.trim() || options.filter(o => o.trim()).length < 2) return;
    onSend({
      question: question.trim(),
      options:  options.filter(o => o.trim()).map((text, i) => ({ id:`opt-${i}`, text, votes:[] })),
      multiple, anonymous: anon, closed: false,
    });
    onClose();
  };

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background:'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <motion.div initial={{ y:50 }} animate={{ y:0 }} exit={{ y:50 }}
        transition={{ type:'spring', damping:28, stiffness:300 }}
        className="w-full max-w-md rounded-t-3xl overflow-hidden"
        style={{ background:'#121215', maxHeight:'80vh' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-base font-bold" style={{ color:C.t1 }}>Создать опрос</p>
          <button type="button" onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
            <X size={16} style={{ color:C.t3 }}/>
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4" style={{ maxHeight:'60vh', scrollbarWidth:'none' }}>
          <input value={question} onChange={e => setQuestion(e.target.value)}
            placeholder="Вопрос..." maxLength={255}
            className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
            style={{ background:C.l2, border:'1px solid rgba(255,255,255,0.07)', color:C.t1 }}/>

          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={opt} onChange={e => setOpt(i, e.target.value)}
                  placeholder={`Вариант ${i+1}`} maxLength={100}
                  className="flex-1 rounded-2xl px-4 py-2.5 text-sm outline-none"
                  style={{ background:C.l2, border:'1px solid rgba(255,255,255,0.07)', color:C.t1 }}/>
                {options.length > 2 && (
                  <button type="button" onClick={() => removeOpt(i)}
                    className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5 shrink-0">
                    <Trash2 size={14} style={{ color:C.t3 }}/>
                  </button>
                )}
              </div>
            ))}
            {options.length < 10 && (
              <button type="button" onClick={addOpt}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-2xl w-full"
                style={{ color:C.accent }}>
                <Plus size={14}/> Добавить вариант
              </button>
            )}
          </div>

          {/* Options */}
          <div className="space-y-2">
            {([
              { key:'multiple', label:'Несколько ответов', val:multiple, set:setMultiple },
              { key:'anon',     label:'Анонимное голосование', val:anon, set:setAnon },
            ]).map(({ key, label, val, set }) => (
              <button key={key} type="button" onClick={() => set(!val)}
                className="flex items-center gap-3 w-full py-2">
                <div className="h-5 w-9 rounded-full relative"
                  style={{ background: val ? C.accent : 'rgba(255,255,255,0.1)' }}>
                  <motion.div className="absolute top-0.5 h-4 w-4 rounded-full bg-white"
                    animate={{ left: val ? 20 : 2 }} transition={{ type:'spring', stiffness:500, damping:30 }}/>
                </div>
                <span className="text-sm" style={{ color:C.t1 }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="px-5 pb-6 pt-2">
          <motion.button whileTap={{ scale:.97 }} type="button" onClick={send}
            disabled={!question.trim() || options.filter(o=>o.trim()).length < 2}
            className="w-full rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-35"
            style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)` }}>
            <span className="flex items-center justify-center gap-2">
              <Send size={15}/> Отправить опрос
            </span>
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};
