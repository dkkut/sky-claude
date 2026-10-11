import { Mic } from 'lucide-react';
import { useSettings } from '@/settings/store';
import { useAiSession } from './aiSession';

/** Ручной вызов Sky AI на острове — работает всегда, без фразы-активатора. */
export const AiCallButton = ({ className = '', compact = false }: { className?: string; compact?: boolean }) => {
  const enabled = useSettings((s) => s.settings.aiManualCall && s.settings.islandMode !== 'side');
  const phase = useAiSession((s) => s.phase);
  if (!enabled) return null;
  const busy = phase !== 'off';
  return (
    <button type="button" aria-label="Позвать Sky AI" title="Позвать Sky AI" aria-pressed={busy}
      onClick={() => (busy ? useAiSession.getState().stop() : useAiSession.getState().start('manual'))}
      className={`flex items-center justify-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${className}`}
      style={{ color: busy ? '#8b7cff' : 'var(--t2)' }}>
      <Mic size={compact ? 16 : 18} />
      {!compact && <span className="text-[13px] font-bold">Позвать Sky AI</span>}
    </button>
  );
};
