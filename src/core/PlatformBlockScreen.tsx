/**
 * «Аварийные работы» / «Технические работы» — полноэкранный блок для
 * всех, кого режим касается (сервер уже выпустил владельца/админку —
 * сюда они не попадают, см. server/server.mjs). Автообновления нет
 * нарочно: пока режим висит, причин опрашивать сервер раз в N секунд
 * больше, чем он того стоит — человек сам нажмёт «Проверить ещё раз»,
 * когда решит заглянуть снова.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertOctagon, Wrench, RefreshCw, LogIn } from 'lucide-react';
import type { PlatformBlock } from './auth/api';
import { LanguagePill, ThemePill } from '@/i18n/LanguageSwitch';

const COPY = {
  shutdown: {
    icon: AlertOctagon,
    tint: 'var(--red)',
    tintBg: 'rgba(239,68,68,0.1)',
    tintBorder: 'rgba(239,68,68,0.25)',
    title: 'Аварийные работы',
    fallback: 'Сайт временно не отвечает — мы уже разбираемся. Попробуйте зайти позже.',
  },
  maintenance: {
    icon: Wrench,
    tint: 'var(--accent)',
    tintBg: 'rgba(79,110,247,0.1)',
    tintBorder: 'rgba(79,110,247,0.25)',
    title: 'Технические работы',
    fallback: 'Проводим плановое обслуживание. Скоро всё заработает — попробуйте зайти позже.',
  },
} as const;

interface Props {
  block: NonNullable<PlatformBlock>;
  onRetry: () => Promise<void> | void;
  /** Только для анонимных: даёт попасть на обычный вход, не дожидаясь снятия режима. */
  onDismiss?: () => void;
}

export const PlatformBlockScreen = ({ block, onRetry, onDismiss }: Props) => {
  const [checking, setChecking] = useState(false);
  const copy = COPY[block.kind];
  const Icon = copy.icon;

  const retry = async () => {
    if (checking) return;
    setChecking(true);
    try { await onRetry(); } finally { setChecking(false); }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-5 px-6 text-center"
      style={{ background: 'var(--bg)', color: 'var(--t1)' }}>
      <LanguagePill />
      <ThemePill />
      <div className="grid h-20 w-20 place-items-center rounded-3xl"
        style={{ background: copy.tintBg, border: `1px solid ${copy.tintBorder}` }}>
        <Icon size={34} style={{ color: copy.tint }} />
      </div>
      <div>
        <p className="text-lg font-bold">{copy.title}</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>
          {block.reason.trim() || copy.fallback}
        </p>
      </div>
      <motion.button type="button" onClick={() => void retry()} whileTap={{ scale: 0.96 }}
        disabled={checking}
        className="flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white"
        style={{ background: 'var(--accent)', opacity: checking ? 0.7 : 1 }}>
        <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
        {checking ? 'Проверяем…' : 'Проверить ещё раз'}
      </motion.button>
      {onDismiss && (
        <button type="button" onClick={onDismiss}
          className="flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: 'var(--t3)' }}>
          <LogIn size={13} /> У меня есть доступ администратора — войти
        </button>
      )}
    </div>
  );
};
