/* ======================================================================
   SKY ПВЗ  —  Сотрудники
====================================================================== */
import { useState } from 'react';
import {
  UserPlus, AlertTriangle, Trash2, Briefcase,
} from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { usePVZStore } from './store';
import { GlassCard, EmptyState, PVZSlide, Pill } from './shared';
import type { PVZ, StaffMember, StaffPosition } from './types';

const POSITION_LABELS: Record<StaffPosition, string> = {
  manager:'Менеджер', operator:'Оператор', storekeeper:'Кладовщик', security:'Охрана',
};

const StaffDetail = ({ staff, onClose }: { staff: StaffMember; onClose: () => void }) => {
  const { shiftsFor, addShift, staffLogFor, toggleStaffOnline } = usePVZStore();
  const shifts = shiftsFor(staff.id);
  const logs = staffLogFor(staff.id);
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('18:00');

  return (
    <PVZSlide open onClose={onClose} title={staff.name}>
      <div className="px-5 pt-4 flex items-center gap-3">
        <div className="grid h-14 w-14 place-items-center rounded-2xl text-lg font-bold" style={{ background: C.l2, color: C.t1 }}>{staff.name[0]}</div>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: C.t1 }}>{staff.name}</p>
          <p className="text-xs" style={{ color: C.t3 }}>@{staff.username} · {POSITION_LABELS[staff.position]}</p>
        </div>
        <button type="button" onClick={() => toggleStaffOnline(staff.id)}
          className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: staff.online?'rgba(0,220,90,0.1)':C.l2, color: staff.online?C.green:C.t3 }}>
          {staff.online ? 'Онлайн' : 'Оффлайн'}
        </button>
      </div>

      <div className="px-5 mt-4 grid grid-cols-3 gap-2">
        <GlassCard className="p-3 text-center"><p className="text-base font-black" style={{ color: C.amber }}>★{staff.rating.toFixed(1)}</p><p className="text-[9px]" style={{ color: C.t3 }}>Рейтинг</p></GlassCard>
        <GlassCard className="p-3 text-center"><p className="text-base font-black" style={{ color: C.t1 }}>{staff.servedCount}</p><p className="text-[9px]" style={{ color: C.t3 }}>Обслужено</p></GlassCard>
        <GlassCard className="p-3 text-center"><p className="text-base font-black" style={{ color: C.t1 }}>{staff.avgIssueTimeSec}с</p><p className="text-[9px]" style={{ color: C.t3 }}>Скорость</p></GlassCard>
      </div>

      <div className="px-5 mt-3">
        <GlassCard className="p-3 flex items-center gap-2">
          <AlertTriangle size={14} style={{ color: staff.errorsCount>0?C.amber:C.green }}/>
          <p className="text-xs" style={{ color: C.t2 }}>{staff.errorsCount} ошибок зафиксировано</p>
        </GlassCard>
      </div>

      <div className="px-5 mt-4">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Добавить смену</p>
        <GlassCard className="p-3 space-y-2">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full rounded-lg px-2.5 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
          <div className="flex gap-2">
            <input type="time" value={from} onChange={e => setFrom(e.target.value)} className="flex-1 rounded-lg px-2.5 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
            <input type="time" value={to} onChange={e => setTo(e.target.value)} className="flex-1 rounded-lg px-2.5 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
          </div>
          <button type="button" onClick={() => addShift(staff.id, date, from, to)} className="w-full rounded-lg py-2 text-xs font-bold text-white" style={{ background: C.acc }}>Добавить смену</button>
        </GlassCard>
      </div>

      <div className="px-5 mt-4 mb-6">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>График смен</p>
        <div className="space-y-1.5">
          {shifts.length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Смены не запланированы</p> : shifts.map(s => (
            <div key={s.id} className="flex items-center justify-between rounded-xl p-2.5" style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
              <span className="text-xs" style={{ color: C.t1 }}>{new Date(s.date).toLocaleDateString('ru-RU',{weekday:'short',day:'2-digit',month:'2-digit'})}</span>
              <span className="text-xs" style={{ color: C.t3 }}>{s.from} – {s.to}</span>
              <Pill label={s.status==='planned'?'Запланирована':s.status==='done'?'Выполнена':'Пропущена'} color={s.status==='done'?C.green:s.status==='missed'?C.red:C.acc}/>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 mb-6">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Журнал действий</p>
        <div className="space-y-1.5">
          {logs.length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Действий пока не зафиксировано</p> : logs.map(l => (
            <p key={l.id} className="text-[11px] px-1" style={{ color: C.t2 }}>{l.text} <span style={{ color: C.t3 }}>· {new Date(l.createdAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span></p>
          ))}
        </div>
      </div>
    </PVZSlide>
  );
};

export const StaffScreen = ({ pvz }: { pvz: PVZ }) => {
  const { staffFor, addStaffMember, removeStaffMember } = usePVZStore();
  const { findUsersByUsername } = useAuthStore();
  const staff = staffFor(pvz.id);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const results = q.trim() ? findUsersByUsername(q.trim()).filter(a => !staff.some(s=>s.accountId===a.id)).slice(0,6) : [];
  const open = staff.find(s => s.id === openId);

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5 flex items-center justify-between">
        <p className="text-lg font-black" style={{ color: C.t1 }}>Сотрудники</p>
        <button type="button" onClick={() => setAdding(s=>!s)} className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>
          <UserPlus size={14}/> Добавить
        </button>
      </div>

      {adding && (
        <div className="px-5 mt-3">
          <GlassCard className="p-3 space-y-2">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по @username..." className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
            {results.map(a => (
              <div key={a.id} className="flex items-center gap-2 rounded-xl p-2" style={{ background: C.l2 }}>
                <span className="grid h-7 w-7 place-items-center rounded-lg text-xs font-bold" style={{ background: C.l3, color: C.t1 }}>{a.name[0]}</span>
                <div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{a.name}</p><p className="text-[10px]" style={{ color: C.t3 }}>@{a.username}</p></div>
                {(['manager','operator','storekeeper','security'] as StaffPosition[]).map(p => (
                  <button key={p} type="button" onClick={() => { addStaffMember(pvz.id, a.id, a.name, a.username, p); setQ(''); }}
                    className="rounded-lg px-1.5 py-1 text-[9px] font-bold" style={{ background: C.l3, color: C.t2 }}>{POSITION_LABELS[p]}</button>
                ))}
              </div>
            ))}
          </GlassCard>
        </div>
      )}

      <div className="px-5 mt-4 space-y-2">
        {staff.length === 0 ? <EmptyState icon={Briefcase} title="Сотрудники не назначены"/> : staff.map(s => (
          <GlassCard key={s.id} className="p-3 flex items-center gap-3">
            <button type="button" onClick={() => setOpenId(s.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
              <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-sm font-bold" style={{ background: C.l2, color: C.t1 }}>
                {s.name[0]}
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full" style={{ background: s.online?C.green:C.t3, border:`2px solid ${C.bg}` }}/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{s.name}</p>
                <p className="text-[10px]" style={{ color: C.t3 }}>{POSITION_LABELS[s.position]} · ★{s.rating.toFixed(1)} · {s.servedCount} клиентов</p>
              </div>
            </button>
            <button type="button" onClick={() => removeStaffMember(s.id)} className="grid h-7 w-7 place-items-center rounded-lg shrink-0" style={{ background: C.l2 }}>
              <Trash2 size={13} style={{ color: C.red }}/>
            </button>
          </GlassCard>
        ))}
      </div>

      {open && <StaffDetail staff={open} onClose={() => setOpenId(null)}/>}
    </div>
  );
};
