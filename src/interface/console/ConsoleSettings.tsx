/* Настройки Sky Console: только то, что относится к консольному режиму. */
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { LogOut, Users, Undo2, Info, Sparkles, Zap } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { usePlayerStore } from '@/player/playerStore';
import { usePlayer as usePodcastPlayer } from '@/podcasts/playerStore';
import { useConsoleStore } from './consoleStore';
import { setConsoleModeSetting } from './consoleMode';
import { consoleNav } from './input/nav';
import pkg from '../../../package.json';

/** Всё, что звучит или играет от имени прошлого профиля, останавливаем до смены. */
const dropPlayback = () => {
  usePlayerStore.getState().clear();
  usePodcastPlayer.getState().close();
};

const Row = ({ icon: Icon, title, sub, onClick, right, autofocus }: { icon: typeof Info; title: string; sub?: string; onClick?: () => void; right?: React.ReactNode; autofocus?: boolean }) => (
  <button type="button" onClick={onClick} data-console-autofocus={autofocus ? '' : undefined} disabled={!onClick}
    className="flex w-full items-center gap-5 rounded-2xl px-5 py-4 text-left outline-none disabled:opacity-100" style={{ background: 'rgba(255,255,255,0.07)' }}>
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10"><Icon size={24} /></span>
    <span className="min-w-0 flex-1"><span className="block text-[22px] font-semibold">{title}</span>{sub && <span className="block text-[16px] text-white/55">{sub}</span>}</span>
    {right}
  </button>
);

const Pill = ({ on }: { on: boolean }) => (
  <span className="rounded-full px-4 py-1 text-[16px] font-bold" style={{ background: on ? '#7c6cff' : 'rgba(255,255,255,0.15)' }}>{on ? 'Вкл' : 'Выкл'}</span>
);

export const ConsoleSettings = () => {
  const prefs = useConsoleStore((s) => s.prefs);
  const setPrefs = useConsoleStore((s) => s.setPrefs);
  const setOpen = useConsoleStore((s) => s.setSettingsOpen);
  const account = useAuthStore((s) => s.accounts.find((a) => a.id === s.currentUserId));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => consoleNav.focusAuto(ref.current ?? document), 120); return () => clearTimeout(t); }, []);

  const switchProfile = () => {
    dropPlayback();
    useConsoleStore.getState().resetForProfileChange();
    useAuthStore.getState().switchProfile();
  };
  const signOut = () => {
    dropPlayback();
    useConsoleStore.getState().resetForProfileChange();
    useAuthStore.getState().logout();
  };

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Настройки Sky Console" style={{ background: 'rgba(3,3,12,0.72)', backdropFilter: 'blur(10px)' }} data-keep-dark>
      <motion.div ref={ref} initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.25 }}
        className="flex w-[min(820px,92vw)] flex-col gap-3 rounded-[32px] p-8 text-white" style={{ background: 'rgba(13,13,30,0.97)', border: '1px solid rgba(160,150,255,0.25)' }}>
        <h2 className="mb-2 text-[32px] font-bold">Настройки Sky Console</h2>
        <Row autofocus icon={Users} title="Сменить профиль" sub={account ? `Сейчас: ${account.name}` : undefined} onClick={switchProfile} />
        <Row icon={LogOut} title="Выйти из Sky ID" sub="Вернуться к входу" onClick={signOut} />
        <Row icon={Sparkles} title="Заставка при запуске" sub="Полная анимация при холодном запуске" onClick={() => setPrefs({ intro: !prefs.intro })} right={<Pill on={prefs.intro} />} />
        <Row icon={Zap} title="Эффекты оформления" sub={prefs.fx === 'full' ? 'Полные: частицы и свечение' : 'Облегчённые — для слабых устройств'} onClick={() => setPrefs({ fx: prefs.fx === 'full' ? 'light' : 'full' })} right={<Pill on={prefs.fx === 'full'} />} />
        <Row icon={Undo2} title="Вернуться в обычную Sky" sub="Выключить режим консоли на этом устройстве" onClick={() => { setConsoleModeSetting('off'); }} />
        <Row icon={Info} title="Версия приложения" sub={`Sky ${pkg.version}`} />
        <button type="button" data-console-back onClick={() => setOpen(false)} aria-label="Закрыть" className="mt-2 self-end rounded-full px-10 py-3 text-[22px] font-semibold outline-none" style={{ background: 'rgba(255,255,255,0.14)' }}>Закрыть</button>
      </motion.div>
    </div>
  );
};
