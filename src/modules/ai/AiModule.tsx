import { GlassCard } from '@/interface/components/GlassCard';
import { SectionTitle } from '@/interface/components/SectionTitle';

export const AiModule = () => (
  <div className="grid gap-4 lg:grid-cols-3">
    <GlassCard className="lg:col-span-2">
      <SectionTitle title="AI Chat Panel" subtitle="Contextual assistant" />
      <div className="space-y-3 text-sm text-muted">
        <p>Assistant: Your task queue can be completed 17% faster with batch processing.</p>
        <p>You: Propose an automation flow.</p>
        <p>Assistant: I generated a 4-step flow using priority, due date, and owner load.</p>
      </div>
    </GlassCard>
    <GlassCard>
      <SectionTitle title="Suggestion Cards" subtitle="Optimization" />
      <p className="text-sm text-muted">Enable predictive reminders for critical workflows.</p>
    </GlassCard>
  </div>
);
