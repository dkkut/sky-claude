/**
 * Калитка закрытой беты.
 *
 * Пока приложение не готово, внутрь пускают по ключу. Экран только
 * спрашивает и показывает ответ: проверяет ключ сервер, и он же
 * отказывает всему API, пока пропуска нет. Поэтому обойти калитку,
 * пропустив этот экран, не получится.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound } from 'lucide-react';
import { apiBetaUnlock } from '@/core/auth/api';

export const BetaGate = ({ onUnlocked }: { onUnlocked: () => void }) => {
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (busy || !key.trim()) return;
    setErr(undefined); setBusy(true);
    const res = await apiBetaUnlock(key.trim());
    setBusy(false);
    if (!res.ok) { setErr(res.reason ?? 'Такой ключ не подходит'); return; }
    onUnlocked();
  };

  return (
    <div
      className="flex items-center justify-center px-4 py-8"
      style={{
        minHeight: '100dvh', overflowX: 'hidden',
        background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(79,110,247,0.10) 0%, var(--bg) 70%)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="w-full" style={{ maxWidth: 400 }}
      >
        <div className="mb-7 text-center">
          <div
            className="mx-auto mb-4 grid place-items-center"
            style={{ width: 64, height: 64, filter: 'drop-shadow(0 0 14px rgba(79,110,247,0.55))' }}
          >
            <img src="/logo.png" alt="Sky" style={{ width: 64, height: 64, objectFit: 'contain' }} />
          </div>
          <p
            className="mb-2 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em]"
            style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}
          >
            закрытая бета
          </p>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--t1)' }}>Sky</h1>
          <p className="mt-1.5 text-sm leading-snug" style={{ color: 'var(--t2)' }}>
            Приложение ещё в работе. Чтобы войти, нужен ключ доступа.
          </p>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <KeyRound
              size={17}
              style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--t3)' }}
            />
            <input
              className="sky-input"
              style={{ paddingLeft: 38, height: 46, fontSize: 16 }}
              placeholder="Ключ доступа"
              autoFocus
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={key}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && go()}
            />
          </div>

          {err && (
            <motion.p
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
              className="text-center text-xs" style={{ color: 'var(--red)' }} role="alert"
            >
              {err}
            </motion.p>
          )}

          <button
            className="sky-btn-primary w-full" style={{ height: 46 }}
            onClick={go} disabled={busy || !key.trim()}
          >
            {busy ? 'Проверяем…' : 'Войти в бету'}
          </button>

          <p className="text-center text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
            Ключ выдаёт владелец проекта. Он запоминается в этом браузере,
            вводить его каждый раз не нужно.
          </p>
        </div>
      </motion.div>
    </div>
  );
};
