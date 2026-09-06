import { GlassCard } from '@/interface/components/GlassCard';
import { SectionTitle } from '@/interface/components/SectionTitle';

export const DashboardModule = () => (
  <div className="grid gap-4 md:grid-cols-3">
    <GlassCard className="md:col-span-3">
      <SectionTitle title="Performance Overview" subtitle="KPI display and live activity timeline." />
      <div className="grid gap-3 md:grid-cols-4">
        {['Revenue', 'Velocity', 'Focus', 'Satisfaction'].map((kpi, index) => (
          <div key={kpi} className="rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-muted">{kpi}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{88 + index * 3}%</p>
          </div>
        ))}
      </div>
    </GlassCard>
    <GlassCard className="md:col-span-2">
      <SectionTitle title="Activity Timeline" subtitle="Smart suggestions generated from system behavior." />
      <ul className="space-y-3 text-sm text-muted">
        <li>09:12  -  AI flagged high-priority financial drift.</li>
        <li>10:44  -  Task throughput increased by 12% week-over-week.</li>
        <li>12:03  -  Security layer completed proactive refresh.</li>
      </ul>
    </GlassCard>
    <GlassCard>
      <SectionTitle title="AI Suggestion" subtitle="Optimization proposal." />
      <p className="text-sm text-muted">Reallocate 14% of weekly effort from low-impact tasks to finance forecast review.</p>
    </GlassCard>
  </div>
);
