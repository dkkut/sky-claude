import { GlassCard } from '@/interface/components/GlassCard';
import { SectionTitle } from '@/interface/components/SectionTitle';

export const AnalyticsModule = () => (
  <div className="grid gap-4 md:grid-cols-2">
    {['Line Trends', 'Bar Compare', 'Pie Split', 'Heatmap'].map((chart) => (
      <GlassCard key={chart}>
        <SectionTitle title={chart} subtitle="Smart reports" />
        <div className="h-40 rounded-xl border border-white/10 bg-white/5" />
      </GlassCard>
    ))}
  </div>
);
