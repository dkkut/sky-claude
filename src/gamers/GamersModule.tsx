import { Trophy, Users, Radio, PlayCircle } from 'lucide-react';
import { GlassCard } from '@/interface/components/GlassCard';

const games = [
  { title: 'Sky Arena', size: '42 GB', status: 'Installed' },
  { title: 'Neon Drift', size: '18 GB', status: 'Update' },
  { title: 'Bloom Tactics', size: '64 GB', status: 'Cloud' },
];

export const GamersModule = () => (
  <div className="grid h-full gap-4 overflow-y-auto p-6 xl:grid-cols-12">
    <GlassCard className="xl:col-span-5">
      <p className="text-xs uppercase tracking-[0.25em] text-muted">Gamer Profile</p>
      <div className="mt-4 rounded-2xl border border-white/10 bg-gradient-to-br from-accent/25 to-cyan-300/10 p-4">
        <p className="text-xl font-semibold text-white">@neon_driver</p>
        <p className="text-sm text-muted">Level 37 • In Game</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-black/25 p-2"><p className="text-xs text-muted">XP</p><p className="text-sm text-white">12 940</p></div>
          <div className="rounded-xl bg-black/25 p-2"><p className="text-xs text-muted">Wins</p><p className="text-sm text-white">418</p></div>
          <div className="rounded-xl bg-black/25 p-2"><p className="text-xs text-muted">Rank</p><p className="text-sm text-white">Diamond</p></div>
        </div>
      </div>
      <div className="mt-4 space-y-2 text-sm text-muted">
        <p className="flex items-center gap-2"><Users size={14} /> Squad invitations and quick join</p>
        <p className="flex items-center gap-2"><Radio size={14} /> Voice party auto-connect</p>
        <p className="flex items-center gap-2"><Trophy size={14} /> Achievement progress with XP rewards</p>
      </div>
    </GlassCard>

    <GlassCard className="xl:col-span-7">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.25em] text-muted">Game Library</p>
        <button type="button" className="rounded-xl bg-white/5 px-3 py-1 text-xs text-muted">Launcher Mode</button>
      </div>
      <div className="space-y-2">
        {games.map((game) => (
          <article key={game.title} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
            <div>
              <p className="text-sm font-medium text-white">{game.title}</p>
              <p className="text-xs text-muted">{game.size} • {game.status}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="rounded-lg border border-white/15 px-2 py-1 text-xs text-muted">Verify</button>
              <button type="button" className="rounded-lg bg-accent px-2 py-1 text-xs text-base"><PlayCircle size={14} /></button>
            </div>
          </article>
        ))}
      </div>
    </GlassCard>
  </div>
);
