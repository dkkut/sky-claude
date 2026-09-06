import { ArrowLeft, TrendingUp, TrendingDown, PiggyBank, Star, Trophy } from 'lucide-react';
import { useFamilyStore } from '../store';
import { fmt } from '@/wallet/store';

const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

export const FamilyStatistics = ({ onBack }: { onBack: () => void }) => {
  const { family } = useFamilyStore();
  if (!family) return null;

  const topUps = family.transactions.filter(t => t.kind === 'topup').reduce((a,t)=>a+t.amount,0);
  const spent  = family.transactions.filter(t => t.kind === 'withdraw' || t.kind === 'goal_contribute').reduce((a,t)=>a+t.amount,0);
  const saved  = family.goals.reduce((a,g)=>a+g.savedAmount,0);

  const memberStats = family.members.map(m => ({
    member: m,
    count: family.transactions.filter(t => t.memberId === m.accountId || t.memberId === m.id).length,
    total: family.transactions.filter(t => t.memberId === m.accountId || t.memberId === m.id).reduce((a,t)=>a+t.amount,0),
  })).sort((a,b) => b.total - a.total);

  const biggest = [...family.transactions].sort((a,b) => b.amount - a.amount)[0];

  // помесячная разбивка пополнений за последние 6 месяцев
  const now = new Date();
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
    const sum = family.transactions.filter(t => {
      const td = new Date(t.createdAt);
      return t.kind === 'topup' && td.getFullYear() === d.getFullYear() && td.getMonth() === d.getMonth();
    }).reduce((a,t)=>a+t.amount,0);
    return { label: MONTHS[d.getMonth()], sum };
  });
  const maxMonthly = Math.max(1, ...monthly.map(m => m.sum));

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Статистика семьи</h2>
      </div>

      <div className="px-4 py-3 space-y-4">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <TrendingUp size={16} style={{ color: 'var(--green)' }}/>
            <p className="mt-2 text-lg font-black" style={{ color: 'var(--t1)' }}>{fmt(topUps)}</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Всего пополнено</p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <TrendingDown size={16} style={{ color: 'var(--red)' }}/>
            <p className="mt-2 text-lg font-black" style={{ color: 'var(--t1)' }}>{fmt(spent)}</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Потрачено и вложено в цели</p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <PiggyBank size={16} style={{ color: 'var(--accent)' }}/>
            <p className="mt-2 text-lg font-black" style={{ color: 'var(--t1)' }}>{fmt(saved)}</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Накоплено в целях</p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <Star size={16} style={{ color: 'var(--amber)' }}/>
            <p className="mt-2 text-lg font-black" style={{ color: 'var(--t1)' }}>{family.members.reduce((a,m)=>a+m.points,0).toLocaleString('ru')}</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Семейных Sky Points</p>
          </div>
        </div>

        <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <p className="mb-3 text-[12px] font-bold" style={{ color: 'var(--t2)' }}>Пополнения за 6 месяцев</p>
          <div className="flex items-end justify-between gap-2" style={{ height: 100 }}>
            {monthly.map(m => (
              <div key={m.label} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="w-full rounded-t-md" style={{ height: `${Math.max(4,(m.sum/maxMonthly)*80)}px`, background: m.sum > 0 ? 'var(--accent)' : 'var(--bg-l2)' }}/>
                <span className="text-[9.5px]" style={{ color: 'var(--t3)' }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <p className="mb-3 flex items-center gap-1.5 text-[12px] font-bold" style={{ color: 'var(--t2)' }}><Trophy size={13} style={{ color: 'var(--amber)' }}/>Самые активные</p>
          <div className="space-y-2.5">
            {memberStats.map(({ member, count, total }, i) => (
              <div key={member.id} className="flex items-center gap-3">
                <span className="w-4 text-[12px] font-black" style={{ color: 'var(--t3)' }}>{i+1}</span>
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ background: member.avatarColor }}>{member.name[0]}</div>
                <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" style={{ color: 'var(--t1)' }}>{member.name}</p>
                <p className="text-[11.5px]" style={{ color: 'var(--t3)' }}>{count} операций</p>
                <p className="w-20 shrink-0 text-right text-[12.5px] font-bold" style={{ color: 'var(--t1)' }}>{total.toLocaleString('ru')} ₽</p>
              </div>
            ))}
          </div>
        </div>

        {biggest && (
          <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <p className="mb-1 text-[12px] font-bold" style={{ color: 'var(--t2)' }}>Самая крупная операция</p>
            <p className="text-[13px]" style={{ color: 'var(--t1)' }}>{biggest.memberName} · {biggest.desc}</p>
            <p className="text-lg font-black" style={{ color: 'var(--accent)' }}>{biggest.amount.toLocaleString('ru')} ₽</p>
          </div>
        )}
      </div>
    </div>
  );
};
