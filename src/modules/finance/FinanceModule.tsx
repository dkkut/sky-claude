import { GlassCard } from '@/interface/components/GlassCard';
import { SectionTitle } from '@/interface/components/SectionTitle';

export const FinanceModule = () => (
  <div className="grid gap-4 md:grid-cols-3">
    <GlassCard>
      <SectionTitle title="Balance" subtitle="Monthly overview" />
      <p className="text-3xl font-semibold text-white">$248,900</p>
    </GlassCard>
    <GlassCard className="md:col-span-2">
      <SectionTitle title="Expense Graph" subtitle="Category breakdown" />
      <div className="h-36 rounded-xl border border-white/10 bg-gradient-to-r from-accent/30 to-cyan-300/10" />
    </GlassCard>
    <GlassCard className="md:col-span-3">
      <SectionTitle title="Financial Forecast" subtitle="AI predictions" />
      <p className="text-sm text-muted">Predicted runway extension: +6.2 months with optimized resource allocation.</p>
    </GlassCard>
  </div>
);
