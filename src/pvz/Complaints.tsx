/* ======================================================================
   SKY ПВЗ  —  Жалобы
====================================================================== */
import { useState } from 'react';
import { MessageSquareWarning, Clock, Plus, CheckCircle2, XCircle, Image as ImageIcon, Video } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { usePVZStore } from './store';
import { GlassCard, EmptyState, Pill, PVZSlide } from './shared';
import type { PVZ, Complaint, ComplaintStatus } from './types';

const STATUS_CFG: Record<ComplaintStatus, { label: string; color: string }> = {
  new:{label:'Новая',color:C.amber}, in_progress:{label:'В работе',color:C.acc},
  resolved:{label:'Решена',color:C.green}, rejected:{label:'Отклонена',color:C.red},
};

const isOverdue = (c: Complaint) => c.status!=='resolved' && c.status!=='rejected' && new Date(c.deadlineAt).getTime() < Date.now();

const ComplaintDetail = ({ c, staffNames, onClose }: { c: Complaint; staffNames: Record<string,string>; onClose: () => void }) => {
  const { updateComplaint } = usePVZStore();
  const [resolution, setResolution] = useState(c.resolution);
  return (
    <PVZSlide open onClose={onClose} title={`Жалоба · ${c.orderCode}`}>
      <div className="px-5 py-4 space-y-3">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>{c.clientName}</p>
            <Pill label={STATUS_CFG[c.status].label} color={STATUS_CFG[c.status].color}/>
          </div>
          <p className="text-xs" style={{ color: C.t2 }}>{c.text}</p>
          <p className="text-[10px] mt-2" style={{ color: C.t3 }}>Заказ: {c.orderCode} {c.employeeId && `· Сотрудник: ${staffNames[c.employeeId] ?? '—'}`}</p>
          <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: isOverdue(c)?C.red:C.t3 }}><Clock size={10}/> Срок рассмотрения: {new Date(c.deadlineAt).toLocaleDateString('ru-RU')}{isOverdue(c) ? ' — просрочено' : ''}</p>
        </GlassCard>

        {(c.photos.length>0 || c.videos.length>0) && (
          <GlassCard className="p-3">
            <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: C.t1 }}><ImageIcon size={13}/> Материалы</p>
            <div className="flex gap-2 flex-wrap">
              {c.photos.map((p,i) => <img key={i} src={p} className="h-16 w-16 rounded-xl object-cover"/>)}
              {c.videos.map((v,i) => <div key={i} className="h-16 w-16 rounded-xl grid place-items-center" style={{ background: C.l2 }}><Video size={16} style={{ color: C.t3 }}/></div>)}
            </div>
          </GlassCard>
        )}

        <GlassCard className="p-3 space-y-2">
          <p className="text-xs font-bold" style={{ color: C.t1 }}>Решение</p>
          <textarea value={resolution} onChange={e => setResolution(e.target.value)} rows={3} placeholder="Опишите принятое решение..."
            className="w-full resize-none rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
          <div className="flex gap-2">
            <button type="button" onClick={() => updateComplaint(c.id, { status:'in_progress', resolution })} className="flex-1 rounded-lg py-2 text-[11px] font-bold" style={{ background: C.l2, color: C.acc }}>В работу</button>
            <button type="button" onClick={() => updateComplaint(c.id, { status:'resolved', resolution })} className="flex-1 rounded-lg py-2 text-[11px] font-bold text-white" style={{ background: C.green }}>Решена</button>
            <button type="button" onClick={() => updateComplaint(c.id, { status:'rejected', resolution })} className="flex-1 rounded-lg py-2 text-[11px] font-bold" style={{ background: C.l2, color: C.red }}>Отклонить</button>
          </div>
        </GlassCard>
      </div>
    </PVZSlide>
  );
};

export const ComplaintsScreen = ({ pvz }: { pvz: PVZ }) => {
  const { complaintsFor, staffFor, addComplaint } = usePVZStore();
  const complaints = complaintsFor(pvz.id);
  const staff = staffFor(pvz.id);
  const staffNames = Object.fromEntries(staff.map(s => [s.id, s.name]));
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [clientName, setClientName] = useState('');
  const [orderCode, setOrderCode] = useState('');
  const [text, setText] = useState('');

  const open = complaints.find(c => c.id === openId);
  const submit = () => {
    if (!clientName.trim() || !text.trim()) return;
    addComplaint(pvz.id, { clientName: clientName.trim(), orderCode: orderCode.trim() || '—', employeeId: null, text: text.trim(), photos: [], videos: [], deadlineAt: new Date(Date.now()+86400000*3).toISOString() });
    setClientName(''); setOrderCode(''); setText(''); setCreating(false);
  };

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5 flex items-center justify-between">
        <p className="text-lg font-black" style={{ color: C.t1 }}>Жалобы</p>
        <button type="button" onClick={() => setCreating(s=>!s)} className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>
          <Plus size={14}/> Новая
        </button>
      </div>

      {creating && (
        <div className="px-5 mt-3">
          <GlassCard className="p-3 space-y-2">
            <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Имя клиента" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
            <input value={orderCode} onChange={e => setOrderCode(e.target.value)} placeholder="Код заказа" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Суть обращения..." className="w-full resize-none rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
            <button type="button" onClick={submit} className="w-full rounded-xl py-2.5 text-xs font-bold text-white" style={{ background: C.acc }}>Создать жалобу</button>
          </GlassCard>
        </div>
      )}

      <div className="px-5 mt-4 space-y-2">
        {complaints.length === 0 ? <EmptyState icon={MessageSquareWarning} title="Жалоб пока нет"/> : complaints.map(c => (
          <button key={c.id} type="button" onClick={() => setOpenId(c.id)} className="w-full text-left">
            <GlassCard className="p-3 flex items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${STATUS_CFG[c.status].color}18` }}>
                {c.status==='resolved' ? <CheckCircle2 size={15} style={{ color: C.green }}/> : c.status==='rejected' ? <XCircle size={15} style={{ color: C.red }}/> : <MessageSquareWarning size={15} style={{ color: STATUS_CFG[c.status].color }}/>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{c.clientName} · {c.orderCode}</p>
                <p className="text-[10px] truncate" style={{ color: C.t3 }}>{c.text}</p>
              </div>
              <div className="text-right shrink-0">
                <Pill label={STATUS_CFG[c.status].label} color={STATUS_CFG[c.status].color}/>
                {isOverdue(c) && <p className="text-[9px] font-bold mt-1" style={{ color: C.red }}>Срок истёк</p>}
              </div>
            </GlassCard>
          </button>
        ))}
      </div>

      {open && <ComplaintDetail c={open} staffNames={staffNames} onClose={() => setOpenId(null)}/>}
    </div>
  );
};
