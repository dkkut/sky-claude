import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { FamilyIcon } from '../familyIcons';
import { useFamilyStore } from '../store';
import { PERMISSIONS } from '../types';

export const FamilyPermissions = ({ onBack }: { onBack: () => void }) => {
  const { family, hasPermission, updateMemberPermission } = useFamilyStore();
  const managed = family?.members.filter(m => m.role === 'child' || m.role === 'teen') ?? [];
  const [selected, setSelected] = useState(managed[0]?.id ?? '');
  const member = managed.find(m => m.id === selected);

  if (!family) return null;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Разрешения</h2>
      </div>

      {managed.length === 0 ? (
        <div className="sky-empty py-12"><div className="sky-empty-icon"><FamilyIcon kind="safe" size={30} color="var(--t3)"/></div><p style={{ color: 'var(--t2)' }}>В семье нет детей или подростков</p></div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto px-4 pb-2" style={{ scrollbarWidth: 'none' }}>
            {managed.map(m => (
              <button key={m.id} type="button" onClick={() => setSelected(m.id)}
                className="flex shrink-0 items-center gap-2 rounded-2xl px-3.5 py-2"
                style={{ background: selected === m.id ? 'var(--accent-bg)' : 'var(--bg-l1)', border: `1.5px solid ${selected === m.id ? 'var(--accent)' : 'var(--border)'}` }}>
                <div className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-black text-white" style={{ background: m.avatarColor }}>{m.name[0]}</div>
                <span className="text-[12.5px] font-semibold" style={{ color: selected === m.id ? 'var(--accent)' : 'var(--t2)' }}>{m.name}</span>
              </button>
            ))}
          </div>

          {member && (
            <div className="flex-1 px-4 py-2 space-y-2">
              {PERMISSIONS.map(p => {
                const enabled = hasPermission(member.id, p.key);
                return (
                  <button key={p.key} type="button" onClick={() => updateMemberPermission(member.id, p.key, !enabled)}
                    className="flex w-full items-center justify-between rounded-2xl p-3.5 text-left" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                    <span className="pr-3 text-[13px]" style={{ color: 'var(--t1)' }}>{p.label}</span>
                    <span className="h-5 w-9 shrink-0 rounded-full p-0.5" style={{ background: enabled ? 'var(--accent)' : 'var(--border)' }}>
                      <motion.span className="block h-4 w-4 rounded-full bg-white" animate={{ x: enabled ? 16 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}/>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};
