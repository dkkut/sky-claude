import { motion } from 'framer-motion';
import { ArrowLeft, Check, X, Bell } from 'lucide-react';
import { FamilyIcon } from '../familyIcons';
import { useFamilyStore } from '../store';
import { fmtAgo } from '@/bloom/store';

export const ApprovalsScreen = ({ onBack }: { onBack: () => void }) => {
  const { family, resolveApproval } = useFamilyStore();
  if (!family) return null;
  const pending = family.approvalRequests.filter(r => r.status === 'pending');
  const resolved = family.approvalRequests.filter(r => r.status !== 'pending').slice(0, 10);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Запросы на разрешение</h2>
      </div>

      <div className="flex-1 px-4 py-3 space-y-3">
        {pending.length === 0 && resolved.length === 0 && (
          <div className="sky-empty py-10">
            <div className="sky-empty-icon"><Bell size={26}/></div>
            <p style={{ color: 'var(--t2)' }}>Пока нет запросов от детей</p>
          </div>
        )}

        {pending.map(r => (
          <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl p-4" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <div className="flex items-center justify-between">
              <p className="text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>{r.memberName}</p>
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{fmtAgo(r.createdAt)}</p>
            </div>
            <p className="mt-1.5 text-[14px] font-semibold" style={{ color: 'var(--t1)' }}>{r.itemTitle}</p>
            <p className="text-[18px] font-black" style={{ color: 'var(--amber)' }}>{r.amount.toLocaleString('ru')} ₽</p>
            {r.reason && <p className="mt-1 text-[12px] italic" style={{ color: 'var(--t3)' }}>«{r.reason}»</p>}

            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => resolveApproval(r.id, false)}
                className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-[13px] font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
                <X size={14}/>Отклонить
              </motion.button>
              <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => resolveApproval(r.id, true)}
                className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-[13px] font-bold text-white" style={{ background: 'var(--green)' }}>
                <Check size={14}/>Одобрить
              </motion.button>
            </div>
          </motion.div>
        ))}

        {resolved.length > 0 && (
          <div>
            <p className="mb-2 mt-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>История решений</p>
            <div className="space-y-2">
              {resolved.map(r => (
                <div key={r.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                  <FamilyIcon kind={r.status === 'approved' ? 'approve' : 'reject'} size={15}
              color={r.status === 'approved' ? 'var(--green)' : 'var(--red)'}/>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--t1)' }}>{r.itemTitle}</p>
                    <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{r.memberName} · {r.amount.toLocaleString('ru')} ₽</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
