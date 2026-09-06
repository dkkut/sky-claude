import { motion } from 'framer-motion';
import type { ReactionKey } from '../store';
import { REACTIONS } from '../store';

export const Av = ({ name, size = 8, color }: { name: string; size?: number; color?: string }) => (
  <div
    className={`grid h-${size} w-${size} shrink-0 place-items-center rounded-full text-xs font-bold text-white`}
    style={{ background: color ?? 'linear-gradient(135deg,#4f6ef7,#8b5cf6)' }}>
    {name[0]?.toUpperCase()}
  </div>
);

export const Tagged = ({ text, onTag }: { text: string; onTag?: (t: string) => void }) => (
  <>
    {text.split(/(#\w+)/g).map((p, i) =>
      p.startsWith('#')
        ? <span key={i} className="cursor-pointer font-medium" style={{ color: 'var(--accent)' }}
            onClick={() => onTag?.(p.slice(1))}>{p}</span>
        : <span key={i}>{p}</span>
    )}
  </>
);

export const ReactionPicker = ({ onPick, onClose }: {
  onPick: (e: ReactionKey) => void; onClose: () => void;
}) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.85, y: 6 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.85, y: 6 }}
    className="absolute bottom-full left-0 mb-1.5 z-30 flex gap-1 rounded-2xl px-2 py-1.5 shadow-xl"
    style={{ background: 'var(--bg-l1)', border: '1px solid var(--border-m)' }}>
    {REACTIONS.map(r => (
      <motion.button key={r} type="button" whileHover={{ scale: 1.35 }} whileTap={{ scale: 0.9 }}
        onClick={() => { onPick(r); onClose(); }}
        className="text-xl p-0.5 rounded-lg">
        {r}
      </motion.button>
    ))}
  </motion.div>
);
