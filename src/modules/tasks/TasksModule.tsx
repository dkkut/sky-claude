import { GlassCard } from '@/interface/components/GlassCard';
import { SectionTitle } from '@/interface/components/SectionTitle';

const columns = ['Backlog', 'In Progress', 'Review', 'Done'];

export const TasksModule = () => (
  <div className="grid gap-4 xl:grid-cols-4">
    {columns.map((column) => (
      <GlassCard key={column}>
        <SectionTitle title={column} subtitle="Kanban view" />
        <div className="space-y-3">
          {[1, 2].map((task) => (
            <article key={`${column}-${task}`} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-sm font-medium text-white">{column} task #{task}</p>
              <p className="mt-1 text-xs text-muted">Priority: {task === 1 ? 'High' : 'Medium'}</p>
            </article>
          ))}
        </div>
      </GlassCard>
    ))}
  </div>
);
