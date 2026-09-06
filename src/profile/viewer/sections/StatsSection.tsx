import { BarChart3 } from 'lucide-react';
import { SectionHead } from './Head';
import type { ProfileData } from '../useProfileData';

const Cell = ({ value, label }: { value: number | string; label: string }) => (
  <div className="rounded-xl px-3 py-2.5 text-center" style={{ background: 'var(--bg-l2)' }}>
    <div className="text-base font-extrabold" style={{ color: 'var(--t1)' }}>{value}</div>
    <div className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>{label}</div>
  </div>
);

export const StatsSection = ({ data }: { data: ProfileData }) => {
  const { level } = data.progression;
  const tenureLabel = data.progression.tenure >= 365
    ? `${Math.floor(data.progression.tenure / 365)} г`
    : `${data.progression.tenure} дн`;

  return (
    <div className="sky-card p-3.5 sm:p-5" style={{ background: 'var(--profile-card-bg, var(--bg-l1))', border: '1px solid var(--profile-card-border, transparent)' }}>
      <SectionHead icon={BarChart3} title="Статистика" />

      <div className="flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-full flex items-center justify-center font-extrabold text-sm shrink-0"
          style={{ background: 'linear-gradient(135deg,#6e8eff,#a78bfa)', color: '#fff' }}>
          {level.level}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-xs mb-1">
            <span style={{ color: 'var(--t2)' }}>Уровень {level.level}</span>
            <span style={{ color: 'var(--t3)' }}>{level.xpIntoLvl}/{level.xpForNext} XP</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-l3)' }}>
            <div className="h-full rounded-full" style={{ width: `${level.progress * 100}%`, background: 'linear-gradient(90deg,#6e8eff,#a78bfa)' }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Cell value={data.stats.postsCount} label="Публикаций" />
        <Cell value={data.stats.reactionsReceived} label="Реакций получено" />
        <Cell value={data.stats.giftsReceived} label="Подарков получено" />
        <Cell value={data.stats.giftsSent} label="Подарков отправлено" />
        <Cell value={data.progression.friendsCount} label="Друзей" />
        <Cell value={tenureLabel} label="На платформе" />
        {!data.isOwn && data.stats.messagesWithMe > 0 && (
          <Cell value={data.stats.messagesWithMe} label="Сообщений с вами" />
        )}
      </div>
    </div>
  );
};
