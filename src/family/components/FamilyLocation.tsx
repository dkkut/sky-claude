import { motion } from 'framer-motion';
import { ArrowLeft, Home, BatteryMedium, Clock, MapPin } from 'lucide-react';
import { useFamilyStore } from '../store';
import { fmtAgo } from '@/bloom/store';

export const FamilyLocation = ({ onBack }: { onBack: () => void }) => {
  const { family, myMember, toggleShareLocation, markImHome, locationFor } = useFamilyStore();
  if (!family) return null;
  const me = myMember();
  const myLoc = me ? locationFor(me.id) : null;
  const sharingMembers = family.members.filter(m => locationFor(m.id)?.sharing);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Геопозиция семьи</h2>
      </div>

      <div className="px-4 py-3">
        <div className="relative overflow-hidden rounded-3xl" style={{ height: 260, background: 'linear-gradient(160deg, #0d1526, #131b30 55%, #0d1526)' }}>
          <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 30% 20%, rgba(79,110,247,0.16), transparent 55%)' }}/>
          {/* дом */}
          <div className="absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center" style={{ left: '50%', top: '50%' }}>
            <div className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(34,197,94,0.2)', border: '1.5px solid var(--green)' }}>
              <Home size={15} style={{ color: 'var(--green)' }}/>
            </div>
            <span className="mt-1 rounded-lg px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'rgba(0,0,0,0.4)', color: '#fff' }}>Дом</span>
          </div>
          {sharingMembers.map(m => {
            const loc = locationFor(m.id)!;
            return (
              <motion.div key={m.id} initial={{ scale: 0 }} animate={{ scale: 1 }}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${loc.point.x}%`, top: `${loc.point.y}%` }}>
                <div className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-black text-white" style={{ background: m.avatarColor, boxShadow: `0 0 0 3px rgba(255,255,255,0.15)` }}>{m.name[0]}</div>
                <span className="mt-1 rounded-lg px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}>{m.name.split(' ')[0]}</span>
              </motion.div>
            );
          })}
        </div>

        <div className="mt-3 flex gap-2.5">
          <button type="button" onClick={() => toggleShareLocation(!myLoc?.sharing)}
            className="flex-1 rounded-2xl py-3 text-[13px] font-bold"
            style={{ background: myLoc?.sharing ? 'rgba(34,197,94,0.12)' : 'var(--bg-l1)', color: myLoc?.sharing ? 'var(--green)' : 'var(--t2)', border: '1px solid var(--border)' }}>
            {myLoc?.sharing ? '✓ Геопозиция включена' : 'Поделиться геопозицией'}
          </button>
          {myLoc?.sharing && (
            <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={markImHome}
              className="rounded-2xl px-4 py-3 text-[13px] font-bold text-white" style={{ background: 'var(--accent)' }}>
              Я дома
            </motion.button>
          )}
        </div>

        <div className="mt-4 space-y-2">
          {family.members.map(m => {
            const loc = locationFor(m.id);
            return (
              <div key={m.id} className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: m.avatarColor }}>{m.name[0]}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--t1)' }}>{m.name}</p>
                  {loc?.sharing ? (
                    <p className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--t3)' }}>
                      <span className="flex items-center gap-0.5"><MapPin size={9}/>{loc.atHome ? 'Дома' : 'В пути'}</span>
                      <span className="flex items-center gap-0.5"><BatteryMedium size={9}/>{loc.battery}%</span>
                      <span className="flex items-center gap-0.5"><Clock size={9}/>{fmtAgo(loc.updatedAt)}</span>
                    </p>
                  ) : (
                    <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Геопозиция не передаётся</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
