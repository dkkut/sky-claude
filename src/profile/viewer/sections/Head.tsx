import type { ComponentType } from 'react';
import type { IconProps } from '../types';

export const SectionHead = ({ icon: Icon, title, right }: {
  icon: ComponentType<IconProps>; title: string; right?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2">
      <Icon size={17} style={{ color: 'var(--accent)' }} />
      <h3 className="font-bold text-base" style={{ color: 'var(--t1)' }}>{title}</h3>
    </div>
    {right}
  </div>
);
