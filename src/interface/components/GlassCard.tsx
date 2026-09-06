import { PropsWithChildren } from 'react';
import { motion } from 'framer-motion';

interface GlassCardProps extends PropsWithChildren {
  className?: string;
  onClick?: () => void;
  glow?: boolean;
  noPadding?: boolean;
}

export const GlassCard = ({ children, className = '', onClick, noPadding = false }: GlassCardProps) => (
  <motion.section
    whileHover={onClick ? { scale: 1.01, y: -1 } : undefined}
    whileTap={onClick ? { scale: 0.99 } : undefined}
    onClick={onClick}
    className={`rounded-xl transition-all duration-200 ${noPadding ? '' : 'p-5'} ${onClick ? 'cursor-pointer' : ''} ${className}`}
    style={{
      background: 'var(--bg-l2)',
      border: '1px solid var(--border)',
    }}
  >
    {children}
  </motion.section>
);
