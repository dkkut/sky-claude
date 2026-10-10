import { isEnglish } from '@/i18n/lang';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Sparkles, Send, Lock, Loader } from 'lucide-react';
import { useFamilyStore } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { fmt } from '@/wallet/store';
/*
 * Разговор с моделью идёт через сервер Sky.
 *
 * Здесь была вторая копия функции callAI, которая обращалась к
 * api.anthropic.com прямо из браузера — и без ключа, потому что ключ в
 * странице это ключ, отданный всем. Поставщик отвечал отказом, и
 * семейный помощник показывал «Не удалось связаться с Sky AI» всегда.
 *
 * Правила доступа к самому помощнику не тронуты: он как был за Prime
 * (личным или семейным), так и остался. Изменилось только то, каким
 * путём уходит запрос.
 */
import { apiAiAsk } from '@/ai/aiApi';


const QUICK_PROMPTS = [
  'Сколько мы потратили в этом месяце?',
  'Как быстрее накопить на цель?',
  'Что запланировано на этой неделе?',
  'Дай совет по семейному бюджету',
];

interface ChatMsg { id: string; role: 'user'|'assistant'; text: string; }

export const FamilyAI = ({ onBack }: { onBack: () => void }) => {
  const { family, cashbackPct, familyLevel, upcomingEvents } = useFamilyStore();
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const isPrime = (me?.isPrime ?? false) || useFamilyStore.getState().isPrimeFamilyActive();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  if (!family) return null;

  const buildContext = () => {
    const monthSpend = family.transactions.filter(t => (t.kind === 'withdraw' || t.kind === 'goal_contribute')).reduce((a,t)=>a+t.amount, 0);
    const monthTopup = family.transactions.filter(t => t.kind === 'topup').reduce((a,t)=>a+t.amount, 0);
    const goalsInfo = family.goals.map(g => `«${g.title}»: ${g.savedAmount}/${g.targetAmount} ₽ (${Math.round(g.savedAmount/g.targetAmount*100)}%)${g.deadline ? `, дедлайн ${new Date(g.deadline).toLocaleDateString('ru-RU')}` : ''}`).join('; ') || 'целей пока нет';
    const events = upcomingEvents().filter(e => new Date(e.date) >= new Date()).slice(0,5).map(e => `${e.title} (${new Date(e.date).toLocaleDateString('ru-RU')})`).join('; ') || 'событий не запланировано';
    const { level } = familyLevel();

    return `Ты — семейный финансовый и бытовой ассистент внутри приложения Sky Family. Отвечай кратко, дружелюбно, ${isEnglish() ? 'по-английски' : 'по-русски'}, только на основе данных ниже. Не выдумывай цифры, которых нет в контексте.

Данные семьи «${family.name}»:
- Баланс общего счёта: ${family.balance} ₽
- Пополнено всего: ${monthTopup} ₽, потрачено/вложено в цели: ${monthSpend} ₽
- Уровень семьи: ${level}, кешбэк: ${cashbackPct()}%
- Цели накопления: ${goalsInfo}
- Ближайшие события в календаре: ${events}
- Участников в семье: ${family.members.length}

Вопрос пользователя: `;
  };

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', text: text.trim() };
    setMessages(m => [...m, userMsg]);
    setInput(''); setLoading(true); setError('');
    try {
      const r = await apiAiAsk('advise', buildContext() + text.trim());
      if (!r.ok) { setError(r.reason); return; }
      setMessages(m => [...m, { id: crypto.randomUUID(), role: 'assistant', text: r.text || 'Не удалось получить ответ.' }]);
    } catch {
      setError('Не удалось связаться с Sky AI. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  if (!isPrime) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
          <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
          <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>AI-ассистент семьи</h2>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full" style={{ background: 'rgba(168,85,247,0.14)' }}>
            <Lock size={22} style={{ color: '#a855f7' }}/>
          </div>
          <p className="text-[14px] font-bold" style={{ color: 'var(--t1)' }}>Доступно с Sky Prime</p>
          <p className="text-[12.5px]" style={{ color: 'var(--t3)' }}>Оформите личный Prime или Sky Prime Family, чтобы получить доступ к семейному AI-ассистенту</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
        <div className="flex items-center gap-1.5">
          <Sparkles size={15} style={{ color: '#a855f7' }}/>
          <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>AI-ассистент семьи</h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-[12.5px]" style={{ color: 'var(--t3)' }}>Спросите про бюджет, цели, покупки или ближайшие события семьи:</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map(p => (
                <button key={p} type="button" onClick={() => send(p)} className="rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t2)' }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed"
              style={{ background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-l1)', color: m.role === 'user' ? '#fff' : 'var(--t1)', border: m.role === 'assistant' ? '1px solid var(--border)' : 'none' }}>
              {m.text}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--t3)' }}>
            <Loader size={12} className="animate-spin"/>Sky AI думает…
          </div>
        )}
        {error && <p className="text-[12px]" style={{ color: 'var(--red)' }}>{error}</p>}
        <div ref={endRef}/>
      </div>

      <div className="shrink-0 border-t p-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send(input)}
            placeholder="Спросите что-нибудь..." className="flex-1 bg-transparent text-[13px] outline-none" style={{ color: 'var(--t1)' }}/>
          <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => send(input)} disabled={!input.trim() || loading}
            className="grid h-7 w-7 place-items-center rounded-full disabled:opacity-30" style={{ background: 'var(--accent)' }}>
            <Send size={13} className="text-white"/>
          </motion.button>
        </div>
      </div>
    </div>
  );
};
