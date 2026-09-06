/* ===============================================================
   SKY — Модалка «Перерыв от просмотра»
   Монтируется один раз в корне приложения.
=============================================================== */
import { AnimatePresence, motion } from 'framer-motion';
import { Coffee, Play, Clock } from 'lucide-react';
import { useBreakReminderStore } from './breakReminderStore';

export const BreakReminderModal = () => {
  const promptOpen      = useBreakReminderStore(s => s.promptOpen);
  const watchedSeconds  = useBreakReminderStore(s => s.watchedSeconds);
  const resolvePrompt   = useBreakReminderStore(s => s.resolvePrompt);

  const minutes = Math.round(watchedSeconds / 60);

  return (
    <AnimatePresence>
      {promptOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10050] flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <motion.div initial={{ scale: 0.92, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.94, opacity: 0 }}
            className="w-full max-w-[340px] rounded-3xl p-5 text-center" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full" style={{ background: 'var(--accent-bg)' }}>
              <Coffee size={24} style={{ color: 'var(--accent)' }}/>
            </div>
            <p className="text-base font-bold text-white mb-1.5">Пора сделать перерыв?</p>
            <p className="text-sm mb-5" style={{ color: 'var(--t3)' }}>
              Вы смотрите уже {minutes} {pluralMinutes(minutes)}. Может, дадим глазам отдохнуть?
            </p>
            <div className="space-y-2">
              <button type="button" onClick={() => resolvePrompt('break')}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white" style={{ background: 'var(--accent)' }}>
                <Coffee size={15}/> Сделать перерыв
              </button>
              <button type="button" onClick={() => resolvePrompt('continue')}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}>
                <Play size={15}/> Продолжить просмотр
              </button>
              <button type="button" onClick={() => resolvePrompt('snooze')}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold" style={{ color: 'var(--t3)' }}>
                <Clock size={13}/> Напомнить позже
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const pluralMinutes = (n: number) => {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'минуту';
  if ([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return 'минуты';
  return 'минут';
};
