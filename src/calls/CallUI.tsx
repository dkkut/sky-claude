/* ===============================================================
   CALL UI  -  редизайн в стиле Telegram/MAX
=============================================================== */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Monitor, MonitorOff,
  Minimize2, Maximize2, Volume2, VolumeX, FlipHorizontal,
} from 'lucide-react';
import { useCallStore } from './store';
import { startRingtone, stopRingtone, playCallConnected, playCallEnded } from '@/audio/sounds';
import { useSettings } from '@/settings/store';

const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
};

const VideoEl = ({ stream, muted=false, mirror=false, className='' }:
  { stream: MediaStream|null; muted?: boolean; mirror?: boolean; className?: string }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current; if (!v || !stream) return;
    v.srcObject = stream; v.play().catch(()=>{});
    return () => { v.srcObject = null; };
  }, [stream]);
  if (!stream) return <div className={`h-full w-full ${className}`} style={{background:'#0a0a0f'}}/>;
  return <video ref={ref} autoPlay playsInline muted={muted} className={`h-full w-full object-cover ${className}`}
    style={mirror?{transform:'scaleX(-1)'}:undefined}/>;
};

const AvatarCircle = ({ letter, size=120, active=false }: { letter:string; size?:number; active?:boolean }) => {
  const hue = letter.charCodeAt(0)*7%360;
  return (
    <div className="relative flex items-center justify-center" style={{width:size+64,height:size+64}}>
      {active && [0,1,2].map(i=>(
        <motion.div key={i} className="absolute rounded-full"
          style={{width:size+i*36,height:size+i*36,border:`1.5px solid hsl(${hue},65%,55%,${0.4-i*0.1})`}}
          animate={{scale:[1,1.22],opacity:[0.5,0]}}
          transition={{duration:2,delay:i*0.55,repeat:Infinity,ease:'easeOut'}}/>
      ))}
      <motion.div animate={active?{scale:[1,1.04,1]}:{}}
        transition={{duration:2.2,repeat:Infinity,ease:'easeInOut'}}
        className="relative z-10 grid place-items-center rounded-full font-black text-white"
        style={{width:size,height:size,fontSize:size*0.4,
          background:`linear-gradient(135deg,hsl(${hue},65%,38%),hsl(${(hue+40)%360},70%,28%))`,
          boxShadow:`0 0 0 4px hsl(${hue},60%,45%,0.2),0 16px 48px hsl(${hue},70%,25%,0.6)`}}>
        {letter}
      </motion.div>
    </div>
  );
};

const Btn = ({ icon:Icon, label, onClick, active=false, danger=false, accept=false, lg=false }:{
  icon:any;label:string;onClick:()=>void;active?:boolean;danger?:boolean;accept?:boolean;lg?:boolean;
}) => {
  const sz=lg?64:52, ic=lg?26:20;
  const bg=danger?'linear-gradient(135deg,#ef4444,#dc2626)':accept?'linear-gradient(135deg,#22c55e,#16a34a)':active?'rgba(255,255,255,0.22)':'var(--border-m)';
  const sh=danger?'0 8px 28px rgba(239,68,68,0.55)':accept?'0 8px 28px rgba(34,197,94,0.55)':'none';
  return (
    <div className="flex flex-col items-center gap-2">
      <motion.button type="button" whileTap={{scale:0.88}} whileHover={{scale:1.05}} onClick={onClick}
        className="grid place-items-center rounded-full"
        style={{width:sz,height:sz,background:bg,boxShadow:sh,border:active?'1.5px solid rgba(255,255,255,0.28)':'1px solid rgba(255,255,255,0.08)'}}>
        <Icon size={ic} className="text-white"/>
      </motion.button>
      <span className="text-[11px] font-medium" style={{color:'rgba(255,255,255,0.45)'}}>{label}</span>
    </div>
  );
};

/* -- INCOMING ------------------------------------------- */
export const IncomingCallOverlay = () => {
  const incoming = useCallStore(s=>s.incoming);
  const accept   = useCallStore(s=>s.acceptIncoming);
  const decline  = useCallStore(s=>s.declineIncoming);
  const { settings } = useSettings();

  useEffect(()=>{
    if(incoming&&settings.soundCalls) startRingtone();
    return ()=>stopRingtone();
  },[incoming,settings.soundCalls]);

  if(!incoming) return null;
  const isVideo=incoming.mode==='video';
  const hue=incoming.callerAvatar.charCodeAt(0)*7%360;

  return (
    <AnimatePresence>
      <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
        className="absolute inset-0 z-50 flex flex-col overflow-hidden"
        style={{background:'#08090f'}}>
        <div className="absolute inset-0 pointer-events-none"
          style={{background:`radial-gradient(ellipse at 50% 28%,hsl(${hue},55%,22%,0.55),transparent 65%)`}}/>
        <div className="text-center pt-14 pb-2 relative z-10">
          <motion.span animate={{opacity:[0.4,1,0.4]}} transition={{duration:2,repeat:Infinity}}
            className="text-[11px] font-semibold uppercase tracking-widest"
            style={{color:'rgba(255,255,255,0.45)'}}>
            {isVideo?'📹 Входящий видеозвонок':'📞 Входящий звонок'}
          </motion.span>
        </div>
        <motion.div initial={{scale:0.75,opacity:0}} animate={{scale:1,opacity:1}}
          transition={{type:'spring',stiffness:260,damping:22,delay:0.08}}
          className="flex justify-center relative z-10">
          <AvatarCircle letter={incoming.callerAvatar} size={130} active/>
        </motion.div>
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:0.22}}
          className="text-center mt-5 relative z-10">
          <p className="text-[32px] font-black text-white tracking-tight">{incoming.callerName}</p>
          <motion.p animate={{opacity:[1,0.3,1]}} transition={{duration:1.6,repeat:Infinity}}
            className="mt-2 text-sm" style={{color:'rgba(255,255,255,0.4)'}}>Вызывает вас...</motion.p>
        </motion.div>
        <div className="flex justify-center gap-3 mt-6 px-6 relative z-10">
          {['Позвоню позже','Не могу говорить'].map(msg=>(
            <button key={msg} type="button" onClick={()=>{stopRingtone();decline();}}
              className="rounded-full px-4 py-2 text-[11px] font-medium transition-all hover:bg-white/10"
              style={{background:'var(--border)',border:'1px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.5)'}}>
              {msg}
            </button>
          ))}
        </div>
        <div className="flex-1"/>
        <motion.div initial={{y:60,opacity:0}} animate={{y:0,opacity:1}}
          transition={{type:'spring',stiffness:240,damping:26,delay:0.18}}
          className="relative z-10 pb-16"
          style={{background:'linear-gradient(transparent,rgba(0,0,0,0.55) 40%)'}}>
          <div className="flex items-end justify-between max-w-[260px] mx-auto px-4">
            <div className="flex flex-col items-center gap-2.5">
              <motion.button type="button" whileTap={{scale:0.88}}
                onClick={()=>{stopRingtone();decline();}}
                className="grid h-[72px] w-[72px] place-items-center rounded-full"
                style={{background:'linear-gradient(135deg,#ef4444,#dc2626)',boxShadow:'0 8px 32px rgba(239,68,68,0.5)'}}>
                <PhoneOff size={30} className="text-white"/>
              </motion.button>
              <span className="text-sm font-medium" style={{color:'rgba(255,255,255,0.55)'}}>Отклонить</span>
            </div>
            <div className="flex flex-col items-center gap-2.5">
              <motion.button type="button" whileTap={{scale:0.88}}
                onClick={()=>{stopRingtone();accept();playCallConnected();}}
                className="grid h-[72px] w-[72px] place-items-center rounded-full"
                style={{background:'linear-gradient(135deg,#22c55e,#16a34a)',boxShadow:'0 8px 32px rgba(34,197,94,0.5)'}}>
                {isVideo?<Video size={30} className="text-white"/>:<Phone size={30} className="text-white"/>}
              </motion.button>
              <span className="text-sm font-medium" style={{color:'rgba(255,255,255,0.55)'}}>Принять</span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

/* -- ACTIVE CALL ---------------------------------------- */
export const ActiveCallPanel = () => {
  const active=useCallStore(s=>s.active);
  const mini=useCallStore(s=>s.miniMode);
  const muted=useCallStore(s=>s.muted);
  const camOff=useCallStore(s=>s.cameraOff);
  const spkOff=useCallStore(s=>s.speakerOff);
  const end=useCallStore(s=>s.endCall);
  const toggleMute=useCallStore(s=>s.toggleMute);
  const toggleCam=useCallStore(s=>s.toggleCamera);
  const toggleSpk=useCallStore(s=>s.toggleSpeaker);
  const toggleScr=useCallStore(s=>s.toggleScreen);
  const toggleMini=useCallStore(s=>s.toggleMini);
  const [timer,setTimer]=useState('00:00');
  const [mirror,setMirror]=useState(true);
  const [showBtns,setShowBtns]=useState(true);
  const btnsTimer=useRef<ReturnType<typeof setTimeout>>();

  useEffect(()=>{if(!active)return;const t=setInterval(()=>setTimer(fmtDur(active.startedAt)),500);return()=>clearInterval(t);},[active]);

  const resetBtnTimer=()=>{
    setShowBtns(true);
    if(btnsTimer.current)clearTimeout(btnsTimer.current);
    if(active?.mode==='video'&&active.connected)
      btnsTimer.current=setTimeout(()=>setShowBtns(false),4000);
  };
  useEffect(()=>{resetBtnTimer();return()=>{if(btnsTimer.current)clearTimeout(btnsTimer.current);};},[active?.connected]);

  if(!active||mini)return null;
  const isVideo=active.mode==='video';
  const conn=active.connected||!!active.remoteStream;
  const hue=active.peerAvatar.charCodeAt(0)*7%360;
  const handleEnd=()=>{playCallEnded();end();};

  return (
    <AnimatePresence>
      <motion.div key="active-call" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
        className="absolute inset-0 z-50 flex flex-col overflow-hidden"
        style={{background:isVideo?'#000':'#08090f'}}
        onClick={isVideo?resetBtnTimer:undefined}>
        {!isVideo&&<div className="absolute inset-0 pointer-events-none"
          style={{background:`radial-gradient(ellipse at 50% 30%,hsl(${hue},55%,22%,0.45),transparent 65%)`}}/>}
        {isVideo&&(
          <div className="absolute inset-0">
            {conn?<VideoEl stream={active.remoteStream} className=""/>
              :<div className="flex h-full flex-col items-center justify-center"
                style={{background:`radial-gradient(ellipse at 50% 40%,hsl(${hue},55%,18%,0.6),#000 70%)`}}>
                <AvatarCircle letter={active.peerAvatar} size={110} active/>
              </div>}
            <div className="absolute top-20 right-4 overflow-hidden rounded-2xl"
              style={{width:100,height:140,border:'2px solid rgba(255,255,255,0.2)',boxShadow:'0 8px 24px rgba(0,0,0,0.6)'}}>
              {active.localStream&&!camOff
                ?<VideoEl stream={active.localStream} muted mirror={mirror}/>
                :<div className="flex h-full w-full items-center justify-center" style={{background:'#111'}}>
                  <VideoOff size={20} style={{color:'rgba(255,255,255,0.3)'}}/></div>}
              <button type="button" onClick={()=>setMirror(m=>!m)}
                className="absolute bottom-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full"
                style={{background:'rgba(0,0,0,0.7)'}}>
                <FlipHorizontal size={11} className="text-white/70"/>
              </button>
            </div>
          </div>
        )}
        {!isVideo&&(
          <div className="flex flex-1 flex-col items-center justify-center gap-5 relative z-10">
            <AvatarCircle letter={active.peerAvatar} size={130} active={!muted}/>
            <div className="text-center">
              <p className="text-[30px] font-black text-white tracking-tight">{active.peerName}</p>
              {conn?<p className="mt-2 font-mono text-base font-semibold" style={{color:'rgba(255,255,255,0.65)'}}>{timer}</p>
                :<motion.p animate={{opacity:[1,0.3,1]}} transition={{duration:1.4,repeat:Infinity}}
                  className="mt-2 text-sm" style={{color:'rgba(255,255,255,0.45)'}}>Соединение...</motion.p>}
            </div>
            {conn&&!muted&&(
              <div className="flex items-end gap-[3px] h-10">
                {[...Array(14)].map((_,i)=>(
                  <motion.div key={i} className="w-[3px] rounded-full"
                    style={{background:`hsl(${hue},70%,65%)`,minHeight:3}}
                    animate={{height:[3,6+Math.sin(i*0.8)*16+10,3]}}
                    transition={{duration:0.5+(i%4)*0.1,delay:i*0.04,repeat:Infinity,repeatType:'reverse'}}/>
                ))}
              </div>
            )}
          </div>
        )}
        <AnimatePresence>
          {(!isVideo||showBtns)&&(
            <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}}
              className="absolute top-0 left-0 right-0 z-20 flex items-start justify-between px-5 pt-5 pb-10"
              style={isVideo?{background:'linear-gradient(rgba(0,0,0,0.75),transparent)'}:undefined}>
              <div>
                {isVideo&&<p className="text-xl font-black text-white">{active.peerName}</p>}
                <div className="flex items-center gap-2 mt-1">
                  <motion.div className="h-2 w-2 rounded-full"
                    style={{background:conn?'#22c55e':'var(--amber)'}}
                    animate={{opacity:[1,0.3,1]}} transition={{duration:1.2,repeat:Infinity}}/>
                  <span className="font-mono text-xs font-semibold" style={{color:'rgba(255,255,255,0.6)'}}>
                    {conn?timer:'Соединение...'}
                  </span>
                  {muted&&<span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{background:'rgba(239,68,68,0.25)',color:'var(--red)'}}>🔇 Без звука</span>}
                </div>
              </div>
              <motion.button type="button" whileTap={{scale:0.9}} onClick={toggleMini}
                className="grid h-10 w-10 place-items-center rounded-full"
                style={{background:'rgba(0,0,0,0.45)',backdropFilter:'blur(8px)',border:'1px solid rgba(255,255,255,0.12)'}}>
                <Minimize2 size={16} className="text-white"/>
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {(!isVideo||showBtns)&&(
            <motion.div initial={{opacity:0,y:30}} animate={{opacity:1,y:0}} exit={{opacity:0,y:30}}
              className="absolute bottom-0 left-0 right-0 z-20 pb-12 pt-8 px-6"
              style={isVideo?{background:'linear-gradient(transparent,rgba(0,0,0,0.85))'}:undefined}>
              <div className="flex items-center justify-center gap-5 flex-wrap max-w-xs mx-auto">
                <Btn icon={muted?MicOff:Mic} label={muted?'Микрофон':'Выкл.mic'} onClick={toggleMute} active={muted}/>
                {isVideo&&<Btn icon={camOff?VideoOff:Video} label={camOff?'Камера':'Выкл.кам.'} onClick={toggleCam} active={camOff}/>}
                {isVideo&&<Btn icon={active.screenShareOn?MonitorOff:Monitor} label={active.screenShareOn?'Стоп экран':'Экран'} onClick={()=>toggleScr()} active={!!active.screenShareOn}/>}
                <Btn icon={spkOff?VolumeX:Volume2} label={spkOff?'Динамик':'Без звука'} onClick={toggleSpk} active={spkOff}/>
                <div className="flex flex-col items-center gap-2">
                  <motion.button type="button" whileTap={{scale:0.88}} whileHover={{scale:1.05}} onClick={handleEnd}
                    className="grid place-items-center rounded-full"
                    style={{width:64,height:64,background:'linear-gradient(135deg,#ef4444,#dc2626)',boxShadow:'0 8px 32px rgba(239,68,68,0.55)'}}>
                    <PhoneOff size={26} className="text-white"/>
                  </motion.button>
                  <span className="text-[11px] font-medium" style={{color:'rgba(255,255,255,0.45)'}}>Завершить</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
};

/* -- MINI ----------------------------------------------- */
export const MiniCallOverlay = () => {
  const active=useCallStore(s=>s.active);
  const mini=useCallStore(s=>s.miniMode);
  const muted=useCallStore(s=>s.muted);
  const end=useCallStore(s=>s.endCall);
  const toggleMute=useCallStore(s=>s.toggleMute);
  const toggleMini=useCallStore(s=>s.toggleMini);
  const [timer,setTimer]=useState('00:00');
  useEffect(()=>{if(!active)return;const t=setInterval(()=>setTimer(fmtDur(active.startedAt)),500);return()=>clearInterval(t);},[active]);
  if(!active||!mini)return null;
  const hue=active.peerAvatar.charCodeAt(0)*7%360;
  return (
    <AnimatePresence>
      <motion.div key="mini" initial={{opacity:0,y:16,scale:0.9}} animate={{opacity:1,y:0,scale:1}}
        exit={{opacity:0,y:16,scale:0.9}} transition={{type:'spring',stiffness:360,damping:28}}
        className="absolute bottom-6 right-5 z-50 overflow-hidden"
        style={{borderRadius:20,boxShadow:'0 12px 48px rgba(0,0,0,0.7)',
          border:'1px solid rgba(255,255,255,0.08)',
          background:'linear-gradient(135deg,#14141e,#0f0f18)',width:220}}>
        {active.mode==='video'&&active.localStream&&(
          <div className="relative h-20 overflow-hidden" style={{borderRadius:'20px 20px 0 0'}}>
            <VideoEl stream={active.localStream} muted mirror className="opacity-85"/>
            <div className="absolute inset-0" style={{background:'linear-gradient(transparent,rgba(0,0,0,0.55))'}}/>
          </div>
        )}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-bold text-xs text-white"
            style={{background:`linear-gradient(135deg,hsl(${hue},65%,38%),hsl(${(hue+40)%360},70%,28%))`}}>
            {active.peerAvatar}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-semibold text-white leading-tight">{active.peerName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <motion.div className="h-1.5 w-1.5 rounded-full"
                style={{background:active.connected?'#22c55e':'var(--amber)'}}
                animate={{opacity:[1,0.3,1]}} transition={{duration:1,repeat:Infinity}}/>
              <span className="font-mono text-[11px]" style={{color:'rgba(255,255,255,0.5)'}}>
                {active.connected?timer:'...'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <motion.button type="button" whileTap={{scale:0.88}} onClick={toggleMute}
              className="grid h-8 w-8 place-items-center rounded-full"
              style={{background:muted?'rgba(239,68,68,0.25)':'var(--border)'}}>
              {muted?<MicOff size={14} style={{color:'var(--red)'}}/>:<Mic size={14} style={{color:'rgba(255,255,255,0.6)'}}/>}
            </motion.button>
            <motion.button type="button" whileTap={{scale:0.88}} onClick={toggleMini}
              className="grid h-8 w-8 place-items-center rounded-full"
              style={{background:'var(--border)'}}>
              <Maximize2 size={14} style={{color:'rgba(255,255,255,0.6)'}}/>
            </motion.button>
            <motion.button type="button" whileTap={{scale:0.88}} onClick={()=>{playCallEnded();end();}}
              className="grid h-8 w-8 place-items-center rounded-full"
              style={{background:'rgba(239,68,68,0.85)',boxShadow:'0 2px 12px rgba(239,68,68,0.4)'}}>
              <PhoneOff size={14} className="text-white"/>
            </motion.button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
