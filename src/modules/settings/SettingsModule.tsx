import { GlassCard } from '@/interface/components/GlassCard';
import { SectionTitle } from '@/interface/components/SectionTitle';

export const SettingsModule = () => (
  <div className="grid gap-4 md:grid-cols-2">
    {['Profile', 'Theme', 'Security', 'API Access'].map((setting) => (
      <GlassCard key={setting}>
        <SectionTitle title={`${setting} Settings`} subtitle="System configuration" />
        <p className="text-sm text-muted">Fine-grained controls tailored for private platform operations.</p>
      </GlassCard>
    ))}
  </div>
);
