import { motion } from 'framer-motion';
import { ArrowLeft, Lock } from 'lucide-react';
import { FamilyIcon } from '../familyIcons';
import { useFamilyStore } from '../store';

export const FamilyAchievements = ({ onBack }: { onBack: () => void }) => {
  const { family, totalPoints } = useFamilyStore();
  if (!family) return null;
  const unlockedCount = family.achievements.filter(a => a.unlocked).length;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Достижения семьи</h2>
      </div>

      <div className="px-4 py-3">
        <div className="mb-4 rounded-3xl p-4 text-center" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.14), var(--bg-l1))', border: '1px solid rgba(245,158,11,0.22)' }}>
          <p className="text-2xl font-black" style={{ color: 'var(--t1)' }}>{totalPoints().toLocaleString('ru')}</p>
          <p className="text-[12px]" style={{ color: 'var(--t3)' }}>семейных Sky Points · {unlockedCount}/{family.achievements.length} наград открыто</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {family.achievements.map(a => (
            <motion.div key={a.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-2 rounded-2xl p-4 text-center"
              style={{ background: a.unlocked ? 'var(--bg-l1)' : 'var(--bg-l2)', border: `1px solid ${a.unlocked ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`, opacity: a.unlocked ? 1 : 0.55 }}>
              <div className="grid h-14 w-14 place-items-center rounded-2xl text-2xl" style={{ background: a.unlocked ? 'rgba(245,158,11,0.15)' : 'var(--bg-l1)' }}>
                {a.unlocked
                  ? <FamilyIcon kind={a.kind} size={22} color="var(--amber)"/>
                  : <Lock size={20} style={{ color: 'var(--t3)' }}/>}
              </div>
              <p className="text-[12.5px] font-bold" style={{ color: 'var(--t1)' }}>{a.title}</p>
              <p className="text-[10.5px] leading-tight" style={{ color: 'var(--t3)' }}>{a.desc}</p>
              <p className="text-[10px] font-semibold" style={{ color: a.unlocked ? 'var(--amber)' : 'var(--t3)' }}>{a.reward}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};
