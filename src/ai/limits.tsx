/**
 * Лимиты Sky AI: окно «Мои лимиты» и карточка в чате, когда лимит закончился («обновится в …, через …»).
 * Данные — только от сервера: сколько израсходовано, какие пределы у бесплатного и у Prime, когда счётчики обнулятся (полночь UTC).
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gauge, Clock, Crown, X } from 'lucide-react';
import { useAiState } from './aiState';
import type { AiTool } from './aiApi';

const NAMES: Record<string, string> = { chat: 'Сообщения в чате', summary: 'Пересказы', file: 'Документы', image: 'Изображения', transcribe: 'Расшифровка записей', voice: 'Голосовой режим' };

/** «через 5 ч 12 мин» / «через 14 мин» / «через минуту». */
export const untilText = (iso?: string | null, now = Date.now()) => {
  if (!iso) return '';
  const ms = Date.parse(iso) - now; if (!(ms > 0)) return 'уже скоро';
  const m = Math.ceil(ms / 60000);
  if (m < 2) return 'через минуту';
  const h = Math.floor(m / 60); const mm = m % 60;
  return h > 0 ? `через ${h} ч${mm ? ` ${mm} мин` : ''}` : `через ${mm} мин`;
};
/** Местное время обновления, например «сегодня в 03:00» или «завтра в 03:00». */
export const resetClock = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const today = new Date(); const tomorrow = new Date(today.getTime() + 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  return `${same(d, today) ? 'сегодня' : same(d, tomorrow) ? 'завтра' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} в ${t}`;
};
export const useNow = (every = 30_000) => { const [n, setN] = useState(() => Date.now()); useEffect(() => { const t = setInterval(() => setN(Date.now()), every); return () => clearInterval(t); }, [every]); return n; };

/** Карточка в диалоге: лимит исчерпан и когда он обновится. */
export const LimitNotice = ({ resetsAt, limit, onOpen, onPrime, prime }: { resetsAt?: string | null; limit?: number; onOpen: () => void; onPrime?: () => void; prime?: boolean }) => {
  const now = useNow();
  return (
    <div role="status" className="mx-auto w-full max-w-[760px] rounded-2xl px-4 py-3" style={{ background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.28)' }}>
      <p className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--t1)' }}><Clock size={15} style={{ color: '#f59e0b' }} />{limit ? `Лимит на сегодня исчерпан: ${limit} из ${limit}` : 'Лимит на сегодня исчерпан'}</p>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--t2)' }}>
        {resetsAt ? `Счётчик обновится ${resetClock(resetsAt)} (${untilText(resetsAt, now)}). После этого можно продолжить.` : 'Счётчик обновляется раз в сутки. Попробуйте завтра.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={onOpen} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}>Мои лимиты</button>
        {!prime && onPrime && <button type="button" onClick={onPrime} className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: 'linear-gradient(135deg,#a855f7,#6366f1)', color: '#fff' }}><Crown size={12} />Больше с Sky Prime</button>}
      </div>
    </div>
  );
};

const Bar = ({ used, limit }: { used: number; limit: number }) => {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-l3, rgba(255,255,255,0.08))' }} aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : 'linear-gradient(90deg,#a855f7,#6366f1)' }} />
    </div>
  );
};

/** Окно «Мои лимиты Sky AI». */
export const AiLimitsDialog = ({ open, onClose, onPrime }: { open: boolean; onClose: () => void; onPrime?: () => void }) => {
  const state = useAiState(); const now = useNow(); const prime = state?.prime === true;
  const rows = state ? (Object.keys(state.usage) as AiTool[]).map((k) => ({ k, ...state.usage[k], free: state.freeLimits?.[k] ?? 0, pro: state.primeLimits?.[k] ?? 0 })) : [];
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[9000] grid place-items-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
          <motion.div role="dialog" aria-label="Лимиты Sky AI" initial={{ y: 20, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: 0.97 }} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl p-5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold"><Gauge size={18} style={{ color: '#a855f7' }} />Лимиты Sky AI</h3>
              <button type="button" onClick={onClose} aria-label="Закрыть" style={{ color: 'var(--t3)' }}><X size={18} /></button>
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--t3)' }}>{prime ? 'У вас Sky Prime: действуют расширенные лимиты.' : 'Сейчас действуют лимиты бесплатного тарифа.'}</p>
            <div className="mt-3 space-y-3">
              {rows.filter((r) => r.limit > 0 || prime).map((r) => (
                <div key={r.k}>
                  <div className="flex items-baseline justify-between text-[13px]"><span>{NAMES[r.k] ?? r.k}</span><b style={{ color: r.used >= r.limit && r.limit > 0 ? '#ef4444' : 'var(--t1)' }}>{`${r.used} из ${r.limit}`}</b></div>
                  <Bar used={r.used} limit={r.limit} />
                </div>))}
              {!prime && rows.filter((r) => r.limit === 0).length > 0 && (
                <p className="text-[12px]" style={{ color: 'var(--t3)' }}>{`Только с Sky Prime: ${rows.filter((r) => r.limit === 0).map((r) => (NAMES[r.k] ?? r.k).toLowerCase()).join(', ')}.`}</p>)}
            </div>
            <div className="mt-4 rounded-2xl p-3 text-[13px]" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <p className="flex items-center gap-2 font-semibold"><Clock size={14} style={{ color: '#a855f7' }} />Обновление счётчиков</p>
              <p className="mt-1" style={{ color: 'var(--t2)' }}>{state?.resetsAt ? `${resetClock(state.resetsAt)} (${untilText(state.resetsAt, now)}). Лимиты обнуляются раз в сутки.` : 'Раз в сутки.'}</p>
            </div>
            {!prime && onPrime && <button type="button" onClick={onPrime} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl py-2.5 text-sm font-bold" style={{ background: 'linear-gradient(135deg,#a855f7,#6366f1)', color: '#fff' }}><Crown size={14} />{`Больше лимитов — Sky Prime`}</button>}
          </motion.div>
        </motion.div>)}
    </AnimatePresence>
  );
};
