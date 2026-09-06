import { GlassCard } from '@/interface/components/GlassCard';
import { SectionTitle } from '@/interface/components/SectionTitle';

const groups = [
  {
    title: 'Calls',
    items: [
      'Missed voice call from Luna • 2m ago',
      'Group video invite in Core Raiders • 14m ago',
    ],
  },
  {
    title: 'Messages & Mentions',
    items: [
      'Neo mentioned you in #arena-strategy',
      '3 new messages in Arena Squad',
    ],
  },
  {
    title: 'Bloom & Gaming',
    items: [
      'New follower in Bloom: @arc_light',
      'Game invite: Valor Grid (Join in one tap)',
    ],
  },
];

export const NotificationsModule = () => (
  <GlassCard>
    <SectionTitle title="Smart Notifications" subtitle="Messages, calls, mentions, bloom and game invites" />
    <div className="mt-3 space-y-4">
      {groups.map((group) => (
        <section key={group.title}>
          <h4 className="mb-2 text-xs uppercase tracking-wide text-muted">{group.title}</h4>
          <ul className="space-y-2 text-sm">
            {group.items.map((item) => (
              <li key={item} className="rounded-lg border border-white/10 bg-black/20 p-3 text-muted">
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  </GlassCard>
);
