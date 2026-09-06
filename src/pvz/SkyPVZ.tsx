/* ======================================================================
   SKY ПВЗ  —  Root shell
====================================================================== */
import { useState } from 'react';
import {
  LayoutDashboard, Wallet, BarChart3, Users, Boxes, MessageSquareWarning,
  FileText, Video, BrainCircuit, History as HistoryIcon, ShieldCheck,
  ArrowLeft, Bell,
} from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { usePVZStore } from './store';
import { MultiHub, ModerationPanel } from './MultiHub';
import { PVZWizard } from './Wizard';
import { PVZDashboard } from './Dashboard';
import { FinanceScreen } from './Finance';
import { AnalyticsScreen } from './Analytics';
import { StaffScreen } from './Staff';
import { WarehouseScreen } from './Warehouse';
import { ComplaintsScreen } from './Complaints';
import { DocumentsScreen } from './Documents';
import { CamerasScreen } from './Cameras';
import { AICenterScreen } from './AICenter';
import { HistoryScreen } from './History';
import { PVZSlide, EmptyState } from './shared';

type InnerTab = 'dashboard'|'finance'|'analytics'|'staff'|'warehouse'|'complaints'|'documents'|'cameras'|'ai'|'history';

const INNER_TABS: { key: InnerTab; label: string; icon: any }[] = [
  { key:'dashboard',  label:'Дашборд',    icon:LayoutDashboard },
  { key:'finance',    label:'Финансы',    icon:Wallet },
  { key:'analytics',  label:'Аналитика',  icon:BarChart3 },
  { key:'staff',      label:'Сотрудники', icon:Users },
  { key:'warehouse',  label:'Склад',      icon:Boxes },
  { key:'complaints', label:'Жалобы',     icon:MessageSquareWarning },
  { key:'documents',  label:'Документы',  icon:FileText },
  { key:'cameras',    label:'Камеры',     icon:Video },
  { key:'ai',         label:'ИИ-центр',   icon:BrainCircuit },
  { key:'history',    label:'История',    icon:HistoryIcon },
];

export const SkyPVZ = () => {
  const account = useAuthStore(s => s.accounts.find(a => a.id === s.currentUserId));
  const isAdmin = account?.isAdmin ?? false;
  const { myPVZs, createDraft, getPVZ, notificationsFor, markNotificationRead } = usePVZStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [innerTab, setInnerTab] = useState<InnerTab>('dashboard');
  const [wizardId, setWizardId] = useState<string | null>(null);
  const [showModeration, setShowModeration] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);

  const pvzList = myPVZs();
  const selected = selectedId ? getPVZ(selectedId) : null;
  const notifs = notificationsFor(selectedId).sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  const unread = notifs.filter(n=>!n.read).length;

  const onCreate = () => { const id = createDraft(); setWizardId(id); };
  const onContinueWizard = (id: string) => setWizardId(id);

  if (selected) {
    return (
      <div className="h-full flex flex-col overflow-hidden relative">
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ background: C.l1, borderBottom:`1px solid ${C.brd}` }}>
          <button type="button" onClick={() => setSelectedId(null)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.t3 }}><ArrowLeft size={16}/></button>
          <p className="flex-1 text-sm font-bold truncate" style={{ color: C.t1 }}>{selected.name}</p>
          {isAdmin && (
            <button type="button" onClick={() => setShowModeration(true)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: C.accBg, color: C.acc }}><ShieldCheck size={15}/></button>
          )}
          <button type="button" onClick={() => setShowNotifs(true)} className="relative grid h-8 w-8 place-items-center rounded-lg" style={{ background: C.l2, color: C.t3 }}>
            <Bell size={15}/>
            {unread>0 && <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-[16px] place-items-center rounded-full text-[8px] font-black text-white px-1" style={{ background: C.red }}>{unread}</span>}
          </button>
        </div>

        <div className="flex gap-1 px-4 py-2 overflow-x-auto shrink-0" style={{ background: C.l1, borderBottom:`1px solid ${C.brd}`, scrollbarWidth:'none' }}>
          {INNER_TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setInnerTab(t.key)}
              className="shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
              style={{ background: innerTab===t.key ? C.accBg : 'transparent', color: innerTab===t.key ? C.acc : C.t3 }}>
              <t.icon size={12}/> {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0">
          {innerTab==='dashboard'  && <PVZDashboard pvz={selected}/>}
          {innerTab==='finance'    && <FinanceScreen pvz={selected}/>}
          {innerTab==='analytics'  && <AnalyticsScreen pvz={selected}/>}
          {innerTab==='staff'      && <StaffScreen pvz={selected}/>}
          {innerTab==='warehouse'  && <WarehouseScreen pvz={selected}/>}
          {innerTab==='complaints' && <ComplaintsScreen pvz={selected}/>}
          {innerTab==='documents'  && <DocumentsScreen pvz={selected}/>}
          {innerTab==='cameras'    && <CamerasScreen pvz={selected}/>}
          {innerTab==='ai'         && <AICenterScreen pvz={selected}/>}
          {innerTab==='history'    && <HistoryScreen pvz={selected}/>}
        </div>

        <PVZSlide open={showNotifs} onClose={() => setShowNotifs(false)} title="Уведомления">
          <div className="p-4 space-y-2">
            {notifs.length === 0 ? <EmptyState icon={Bell} title="Уведомлений пока нет"/> : notifs.map(n => (
              <button key={n.id} type="button" onClick={() => markNotificationRead(n.id)} className="w-full text-left rounded-xl p-3"
                style={{ background: n.read ? C.l1 : C.accBg, border:`1px solid ${n.read?C.brd:'rgba(79,110,247,0.25)'}` }}>
                <p className="text-xs font-semibold" style={{ color: C.t1 }}>{n.title}</p>
                <p className="text-xs mt-0.5" style={{ color: C.t2 }}>{n.text}</p>
                <p className="text-[10px] mt-1" style={{ color: C.t3 }}>{new Date(n.createdAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</p>
              </button>
            ))}
          </div>
        </PVZSlide>

        {isAdmin && showModeration && (
          <div className="absolute inset-0 z-40" style={{ background: C.bg }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom:`1px solid ${C.brd}` }}>
              <button type="button" onClick={() => setShowModeration(false)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.t3 }}><ArrowLeft size={16}/></button>
              <p className="text-sm font-bold" style={{ color: C.t1 }}>Модерация</p>
            </div>
            <div style={{ height: 'calc(100% - 49px)' }}><ModerationPanel/></div>
          </div>
        )}

        {wizardId && <PVZWizard pvzId={wizardId} onClose={() => setWizardId(null)}/>}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {isAdmin && (
        <div className="flex items-center justify-end px-4 pt-3 shrink-0">
          <button type="button" onClick={() => setShowModeration(true)} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: C.accBg, color: C.acc }}>
            <ShieldCheck size={13}/> Модерация
          </button>
        </div>
      )}
      <MultiHub pvzList={pvzList} onSelect={setSelectedId} onCreate={onCreate} onContinueWizard={onContinueWizard}/>
      {wizardId && <PVZWizard pvzId={wizardId} onClose={() => setWizardId(null)}/>}
      {isAdmin && showModeration && (
        <div className="absolute inset-0 z-40" style={{ background: C.bg }}>
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom:`1px solid ${C.brd}` }}>
            <button type="button" onClick={() => setShowModeration(false)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.t3 }}><ArrowLeft size={16}/></button>
            <p className="text-sm font-bold" style={{ color: C.t1 }}>Модерация</p>
          </div>
          <div style={{ height: 'calc(100% - 49px)' }}><ModerationPanel/></div>
        </div>
      )}
    </div>
  );
};
