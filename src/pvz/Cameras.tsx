/* ======================================================================
   SKY ПВЗ  —  Камеры видеонаблюдения
====================================================================== */
import { useState } from 'react';
import { Video, VideoOff, Users2, AlertOctagon, DoorOpen, CheckCircle2, RadioTower, Bell } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { usePVZStore } from './store';
import { GlassCard, EmptyState, Pill } from './shared';
import type { PVZ, CameraEventType } from './types';

const EVENT_CFG: Record<CameraEventType, { label: string; color: string; icon: any }> = {
  queue:      { label:'Очередь',         color: C.amber, icon: Users2 },
  suspicious: { label:'Подозрительно',   color: C.red,   icon: AlertOctagon },
  empty:      { label:'ПВЗ пустует',     color: C.t3,    icon: DoorOpen },
  normal:     { label:'Штатно',          color: C.green, icon: CheckCircle2 },
};

export const CamerasScreen = ({ pvz }: { pvz: PVZ }) => {
  const { camerasFor, cameraEventsFor, simulateCameraEvent, markCameraEventRead } = usePVZStore();
  const cameras = camerasFor(pvz.id);
  const events = cameraEventsFor(pvz.id);
  const [activeCam, setActiveCam] = useState(cameras[0]?.id ?? '');

  const onlineCount = cameras.filter(c=>c.online).length;

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5 flex items-center justify-between">
        <p className="text-lg font-black" style={{ color: C.t1 }}>Камеры</p>
        <button type="button" onClick={() => simulateCameraEvent(pvz.id)} className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>
          <RadioTower size={13}/> Проверить ИИ-детекцию
        </button>
      </div>
      <p className="px-5 mt-1 text-xs" style={{ color: C.t3 }}>{onlineCount} из {cameras.length} камер онлайн</p>

      <div className="px-5 mt-4 grid grid-cols-2 gap-2.5">
        {cameras.map(cam => (
          <button key={cam.id} type="button" onClick={() => setActiveCam(cam.id)}>
            <GlassCard className="p-0 overflow-hidden" style={{ border: activeCam===cam.id ? `1.5px solid ${C.acc}` : undefined }}>
              <div className="relative aspect-video grid place-items-center" style={{ background:'#05050c' }}>
                {cam.online ? (
                  <>
                    <div className="absolute inset-0 opacity-20" style={{ background:'repeating-linear-gradient(0deg, transparent, transparent 2px, white 2px, white 3px)' }}/>
                    <Video size={20} style={{ color: C.t3 }}/>
                    <span className="absolute top-1.5 left-1.5 flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:'rgba(244,63,94,0.8)', color:'#fff' }}>● LIVE</span>
                  </>
                ) : <VideoOff size={18} style={{ color: C.t3 }}/>}
              </div>
              <div className="p-2 text-left">
                <p className="text-[11px] font-semibold truncate" style={{ color: C.t1 }}>{cam.name}</p>
                <p className="text-[9px]" style={{ color: C.t3 }}>{cam.zone}</p>
              </div>
            </GlassCard>
          </button>
        ))}
      </div>

      <div className="px-5 mt-4 mb-6">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Лента ИИ-событий</p>
        <div className="space-y-2">
          {events.length === 0 ? <EmptyState icon={Bell} title="Событий пока нет"/> : events.map(e => {
            const cfg = EVENT_CFG[e.type];
            const cam = cameras.find(c=>c.id===e.cameraId);
            return (
              <button key={e.id} type="button" onClick={() => markCameraEventRead(e.id)} className="w-full text-left">
                <GlassCard className="p-3 flex items-center gap-3" style={{ opacity: e.read ? 0.65 : 1 }}>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background:`${cfg.color}18` }}><cfg.icon size={15} style={{ color: cfg.color }}/></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{cam?.name ?? 'Камера'}</p>
                    <p className="text-[10px] truncate" style={{ color: C.t3 }}>{e.text}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <Pill label={cfg.label} color={cfg.color}/>
                    <p className="text-[9px] mt-1" style={{ color: C.t3 }}>{new Date(e.createdAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</p>
                  </div>
                  {!e.read && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: C.acc }}/>}
                </GlassCard>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
