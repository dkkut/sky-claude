/* ======================================================================
   SKY ПВЗ  —  Wizard регистрации (9 шагов)
====================================================================== */
import { useState, useRef, useEffect, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, ArrowLeft, Check, Upload, MapPin, Crosshair, FileText,
  Trash2, Plus, Video, PlayCircle, StopCircle, CheckCircle2, Sparkles,
  Award, Send, X, AlertTriangle, Loader2,
} from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { usePVZStore } from './store';
import { GlassCard, EmptyState, ScoreRing } from './shared';
import {
  WIZARD_STEPS, CHECKLIST_LABELS, INSPECTION_TASKS,
} from './types';
import type {
  PVZ, PVZDocument, ChecklistStatus,
  PVZLayout, InspectionCheckpoint, InspectionTaskKey, BrandingCheck,
} from './types';

const DOC_TYPES: { key: PVZDocument['type']; label: string }[] = [
  { key:'contract', label:'Договор' }, { key:'act', label:'Акт' }, { key:'license', label:'Лицензия' },
  { key:'certificate', label:'Сертификат' }, { key:'finance', label:'Финансовый документ' }, { key:'other', label:'Прочее' },
];

const fileToDataUrl = (file: File): Promise<string> => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file);
});

/* ── Индикатор шагов ───────────────────────────────────────────────── */
const StepIndicator = ({ current }: { current: number }) => (
  <div className="flex items-center gap-1 px-5 py-3 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
    {WIZARD_STEPS.map((s, i) => (
      <div key={s.key} className="flex items-center gap-1 shrink-0">
        <div className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold"
          style={{ background: i < current ? C.green : i === current ? C.acc : C.l2, color: i <= current ? '#fff' : C.t3 }}>
          {i < current ? <Check size={12}/> : i+1}
        </div>
        {i < WIZARD_STEPS.length - 1 && <div className="h-[2px] w-5" style={{ background: i < current ? C.green : C.l2 }}/>}
      </div>
    ))}
  </div>
);

/* ── Шаг 1: основная информация ──────────────────────────────────── */
const StepBasic = ({ pvz }: { pvz: PVZ }) => {
  const { updatePVZ } = usePVZStore();
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>НАЗВАНИЕ ПВЗ</p>
        <input value={pvz.name} onChange={e => updatePVZ(pvz.id, { name: e.target.value })} placeholder="Например: Sky ПВЗ — Арбат"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
      </div>
      <div>
        <p className="text-[10px] font-bold mb-2" style={{ color: C.t3 }}>ФОРМАТ</p>
        <div className="grid grid-cols-3 gap-2">
          {([{k:'pickup',l:'Пункт выдачи'},{k:'postomat_hybrid',l:'Гибрид с постаматом'},{k:'showroom',l:'Шоурум'}] as const).map(o => (
            <button key={o.k} type="button" onClick={() => updatePVZ(pvz.id, { format: o.k })}
              className="rounded-xl py-2.5 text-[11px] font-semibold" style={{ background: pvz.format===o.k ? C.accBg : C.l2, color: pvz.format===o.k ? C.acc : C.t3, border:`1px solid ${pvz.format===o.k?'rgba(79,110,247,0.3)':'transparent'}` }}>
              {o.l}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ТЕЛЕФОН</p>
          <input value={pvz.phone} onChange={e => updatePVZ(pvz.id, { phone: e.target.value })} placeholder="+7 999 000-00-00"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        </div>
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>EMAIL</p>
          <input value={pvz.email} onChange={e => updatePVZ(pvz.id, { email: e.target.value })} placeholder="pvz@sky.ru"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ОТКРЫТИЕ</p>
          <input type="time" value={pvz.workFrom} onChange={e => updatePVZ(pvz.id, { workFrom: e.target.value })}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        </div>
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ЗАКРЫТИЕ</p>
          <input type="time" value={pvz.workTo} onChange={e => updatePVZ(pvz.id, { workTo: e.target.value })}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        </div>
      </div>
    </div>
  );
};

/* ── Шаг 2: документы ─────────────────────────────────────────────── */
const StepDocuments = ({ pvz }: { pvz: PVZ }) => {
  const { addDocument, removeDocument } = usePVZStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<PVZDocument['type']>('contract');
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !title.trim()) return;
    setPending(true);
    const data = await fileToDataUrl(file);
    addDocument(pvz.id, { type, title: title.trim(), fileName: file.name, fileData: data, expiresAt: null });
    setTitle(''); setPending(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      <GlassCard className="p-3 space-y-2">
        <p className="text-xs font-bold" style={{ color: C.t1 }}>Загрузить документ</p>
        <select value={type} onChange={e => setType(e.target.value as PVZDocument['type'])}
          className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}>
          {DOC_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название документа"
          className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        <button type="button" disabled={!title.trim() || pending} onClick={() => fileRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
          {pending ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14}/>} Выбрать файл
        </button>
        <input ref={fileRef} type="file" hidden onChange={onFile}/>
      </GlassCard>

      <div className="space-y-2">
        {pvz.documents.length === 0 ? (
          <EmptyState icon={FileText} title="Документы не загружены" sub="Загрузите договор, лицензии и сертификаты для прохождения модерации"/>
        ) : pvz.documents.map(d => (
          <div key={d.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
            <div className="grid h-9 w-9 place-items-center rounded-xl shrink-0" style={{ background: C.accBg }}>
              <FileText size={15} style={{ color: C.acc }}/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{d.title}</p>
              <p className="text-[10px]" style={{ color: C.t3 }}>{DOC_TYPES.find(t=>t.key===d.type)?.label} · {d.fileName}</p>
            </div>
            <button type="button" onClick={() => removeDocument(pvz.id, d.id)} className="grid h-7 w-7 place-items-center rounded-lg shrink-0" style={{ background: C.l2 }}>
              <Trash2 size={13} style={{ color: C.red }}/>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Шаг 3: адрес ──────────────────────────────────────────────────── */
const StepAddress = ({ pvz }: { pvz: PVZ }) => {
  const { updatePVZ } = usePVZStore();
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ГОРОД</p>
        <input value={pvz.city} onChange={e => updatePVZ(pvz.id, { city: e.target.value })} placeholder="Москва"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
      </div>
      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>АДРЕС</p>
        <input value={pvz.address} onChange={e => updatePVZ(pvz.id, { address: e.target.value })} placeholder="Улица, дом"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
      </div>
      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ВХОД / ПОДЪЕЗД</p>
        <input value={pvz.entrance} onChange={e => updatePVZ(pvz.id, { entrance: e.target.value })} placeholder="Например: со двора, вход №2"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
      </div>
    </div>
  );
};

/* ── Шаг 4: геолокация ────────────────────────────────────────────── */
const StepGeo = ({ pvz }: { pvz: PVZ }) => {
  const { updatePVZ } = usePVZStore();
  const [status, setStatus] = useState<'idle'|'loading'|'done'|'error'>('idle');

  const useGeo = () => {
    if (!navigator.geolocation) { setStatus('error'); return; }
    setStatus('loading');
    navigator.geolocation.getCurrentPosition(
      pos => { updatePVZ(pvz.id, { location: { lat: pos.coords.latitude, lng: pos.coords.longitude } }); setStatus('done'); },
      () => setStatus('error'), { timeout: 6000 },
    );
  };

  return (
    <div className="space-y-4">
      <GlassCard className="relative overflow-hidden p-0" style={{ height: 220 }}>
        <svg className="absolute inset-0 h-full w-full opacity-25" viewBox="0 0 100 100" preserveAspectRatio="none">
          {[15,32,50,68,85].map(v => <line key={'v'+v} x1={v} y1={0} x2={v} y2={100} stroke="white" strokeWidth="0.3"/>)}
          {[18,38,58,78].map(h => <line key={'h'+h} x1={0} y1={h} x2={100} y2={h} stroke="white" strokeWidth="0.3"/>)}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <motion.div animate={{ y: [0,-4,0] }} transition={{ duration: 2, repeat: Infinity }} className="flex flex-col items-center">
            <MapPin size={28} style={{ color: C.acc }} fill={C.accBg}/>
          </motion.div>
        </div>
        <div className="absolute bottom-3 left-3 right-3 rounded-xl px-3 py-2" style={{ background:'rgba(0,0,0,0.5)' }}>
          <p className="text-[11px] font-mono" style={{ color: C.t1 }}>{pvz.location.lat.toFixed(5)}, {pvz.location.lng.toFixed(5)}</p>
        </div>
      </GlassCard>
      <button type="button" onClick={useGeo}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white" style={{ background: C.acc }}>
        <Crosshair size={15}/> Определить геолокацию автоматически
      </button>
      {status === 'loading' && <p className="text-xs text-center" style={{ color: C.t3 }}>Определяем местоположение...</p>}
      {status === 'done' && <p className="text-xs text-center" style={{ color: C.green }}>Геолокация определена и сохранена</p>}
      {status === 'error' && <p className="text-xs text-center" style={{ color: C.red }}>Не удалось получить геолокацию устройства</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ШИРОТА</p>
          <input type="number" step="0.00001" value={pvz.location.lat} onChange={e => updatePVZ(pvz.id, { location:{ ...pvz.location, lat: Number(e.target.value) } })}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        </div>
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ДОЛГОТА</p>
          <input type="number" step="0.00001" value={pvz.location.lng} onChange={e => updatePVZ(pvz.id, { location:{ ...pvz.location, lng: Number(e.target.value) } })}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        </div>
      </div>
    </div>
  );
};

/* ── Шаг 5: проверка помещения (чек-лист) ─────────────────────────── */
const StepChecklist = ({ pvz }: { pvz: PVZ }) => {
  const { setChecklistItem } = usePVZStore();
  const STATUS_CFG: Record<ChecklistStatus,{label:string;color:string}> = {
    pass:{label:'Соответствует',color:C.green}, fail:{label:'Не соответствует',color:C.red},
    na:{label:'Неприменимо',color:C.t3}, pending:{label:'Не проверено',color:C.amber},
  };
  const done = pvz.checklist.filter(c=>c.status!=='pending').length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: C.t3 }}>Проверено пунктов</span>
        <span className="font-bold" style={{ color: C.acc }}>{done} / {pvz.checklist.length}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.l2 }}>
        <div className="h-full rounded-full" style={{ width:`${(done/pvz.checklist.length)*100}%`, background: C.acc }}/>
      </div>
      {pvz.checklist.map(item => (
        <GlassCard key={item.key} className="p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold" style={{ color: C.t1 }}>{CHECKLIST_LABELS[item.key]}</p>
          </div>
          <div className="flex gap-1.5">
            {(['pass','fail','na'] as ChecklistStatus[]).map(st => (
              <button key={st} type="button" onClick={() => setChecklistItem(pvz.id, item.key, st, item.note)}
                className="flex-1 rounded-lg py-1.5 text-[10px] font-bold"
                style={{ background: item.status===st ? `${STATUS_CFG[st].color}20` : C.l2, color: item.status===st ? STATUS_CFG[st].color : C.t3 }}>
                {STATUS_CFG[st].label}
              </button>
            ))}
          </div>
          {item.status === 'fail' && (
            <input value={item.note} onChange={e => setChecklistItem(pvz.id, item.key, item.status, e.target.value)} placeholder="Что не так?"
              className="w-full mt-2 rounded-lg px-2.5 py-1.5 text-[11px] outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
          )}
        </GlassCard>
      ))}
    </div>
  );
};

/* ── Шаг 6: планировка ─────────────────────────────────────────────── */
const StepLayout = ({ pvz }: { pvz: PVZ }) => {
  const { setLayout } = usePVZStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [layout, setLocalLayout] = useState<PVZLayout>(pvz.layout ?? { areaSqm: 60, ceilingHeightM: 3.0, zones: [{ name:'Зона выдачи', sqm: 20 }], storageSqm: 20, photos: [] });

  useEffect(() => { setLayout(pvz.id, layout); }, [layout]);

  const addZone = () => setLocalLayout(l => ({ ...l, zones: [...l.zones, { name:'Новая зона', sqm: 5 }] }));
  const updZone = (i: number, patch: Partial<{name:string;sqm:number}>) => setLocalLayout(l => ({ ...l, zones: l.zones.map((z,idx) => idx===i ? { ...z, ...patch } : z) }));
  const delZone = (i: number) => setLocalLayout(l => ({ ...l, zones: l.zones.filter((_,idx) => idx!==i) }));

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const data = await fileToDataUrl(file);
    setLocalLayout(l => ({ ...l, photos: [...l.photos, data] }));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ПЛОЩАДЬ (м²)</p>
          <input type="number" value={layout.areaSqm} onChange={e => setLocalLayout(l => ({ ...l, areaSqm: Number(e.target.value) }))}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        </div>
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ВЫСОТА ПОТОЛКОВ (м)</p>
          <input type="number" step="0.1" value={layout.ceilingHeightM} onChange={e => setLocalLayout(l => ({ ...l, ceilingHeightM: Number(e.target.value) }))}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold" style={{ color: C.t3 }}>ЗОНЫ ПОМЕЩЕНИЯ</p>
          <button type="button" onClick={addZone} className="flex items-center gap-1 text-[11px] font-bold" style={{ color: C.acc }}><Plus size={12}/> Добавить зону</button>
        </div>
        <div className="space-y-2">
          {layout.zones.map((z, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={z.name} onChange={e => updZone(i, { name: e.target.value })} className="flex-1 rounded-lg px-2.5 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
              <input type="number" value={z.sqm} onChange={e => updZone(i, { sqm: Number(e.target.value) })} className="w-20 rounded-lg px-2.5 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
              <button type="button" onClick={() => delZone(i)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: C.l2 }}><X size={13} style={{ color: C.red }}/></button>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ПЛОЩАДЬ СКЛАДА (м²)</p>
        <input type="number" value={layout.storageSqm} onChange={e => setLocalLayout(l => ({ ...l, storageSqm: Number(e.target.value) }))}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
      </div>
      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ФОТО / ПЛАН ПОМЕЩЕНИЯ</p>
        <div className="flex gap-2 flex-wrap">
          {layout.photos.map((p,i) => <img key={i} src={p} className="h-16 w-16 rounded-xl object-cover"/>)}
          <button type="button" onClick={() => fileRef.current?.click()} className="h-16 w-16 rounded-xl grid place-items-center" style={{ background: C.l2, border:`1px dashed ${C.brd}` }}>
            <Upload size={16} style={{ color: C.t3 }}/>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto}/>
        </div>
      </div>
    </div>
  );
};

/* ── Шаг 7: видео-проверка ─────────────────────────────────────────── */
const ALL_TASKS = Object.keys(INSPECTION_TASKS) as InspectionTaskKey[];
const shuffle = <T,>(arr: T[]): T[] => { const a = [...arr]; for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };

const StepVideo = ({ pvz }: { pvz: PVZ }) => {
  const { saveInspectionSession, runAIAnalysis, sessionFor, analysisFor } = usePVZStore();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [order, setOrder] = useState<InspectionTaskKey[]>([]);
  const [checkpoints, setCheckpoints] = useState<InspectionCheckpoint[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const session = sessionFor(pvz.id);
  const analysis = analysisFor(pvz.id);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const start = () => {
    const seq = shuffle(ALL_TASKS);
    setOrder(seq);
    setCheckpoints(seq.map(task => ({ task, requestedAt: 0, confirmedAt: null, quality: 0 })));
    setCurrentIdx(0);
    setSeconds(0);
    setRecording(true);
    timerRef.current = setInterval(() => setSeconds(s => s+1), 1000);
  };

  const confirmTask = () => {
    setCheckpoints(cps => cps.map((c,i) => i===currentIdx ? { ...c, confirmedAt: seconds, quality: Math.round(72 + Math.random()*26) } : c));
    if (currentIdx < order.length - 1) setCurrentIdx(i => i+1);
  };

  const finish = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    const sess = saveInspectionSession(pvz.id, checkpoints, seconds);
    setAnalyzing(true);
    setTimeout(() => { runAIAnalysis(pvz.id, sess.id); setAnalyzing(false); }, 1400);
  };

  const fmtTime = (s: number) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  const confirmedCount = checkpoints.filter(c=>c.confirmedAt!==null).length;

  if (analysis && session) {
    return (
      <div className="space-y-4">
        <GlassCard className="p-4 flex items-center gap-4">
          <ScoreRing score={analysis.overallScore} size={84}/>
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: C.t1 }}>ИИ-анализ завершён</p>
            <p className="text-xs mt-1" style={{ color: C.t3 }}>Видео {session.videoName} проанализировано автоматически</p>
          </div>
        </GlassCard>
        <div className="grid grid-cols-2 gap-2.5">
          {[
            ['Качество видео', analysis.videoQuality, '%'], ['Освещение', analysis.lightingQuality, '%'],
            ['Совпадение адреса', analysis.addressMatch, '%'], ['Площадь', analysis.estimatedAreaSqm, ' м²'],
            ['Высота потолков', analysis.ceilingHeightM, ' м'], ['Состояние пола', analysis.floorCondition, '%'],
            ['Состояние стен', analysis.wallCondition, '%'], ['Чистота', analysis.cleanliness, '%'],
            ['Брендинг', analysis.brandingPresence, '%'], ['Свободное место', analysis.freeSpacePct, '%'],
            ['Препятствия', analysis.obstaclesFound, ''], ['Безопасность', analysis.safetyScore, '%'],
          ].map(([label, val, suf]) => (
            <GlassCard key={label as string} className="p-3">
              <p className="text-[10px]" style={{ color: C.t3 }}>{label}</p>
              <p className="text-base font-black mt-0.5" style={{ color: C.t1 }}>{val}{suf}</p>
            </GlassCard>
          ))}
        </div>
        {(analysis.editingDetected || analysis.splicesDetected) && (
          <div className="rounded-xl p-3 flex items-start gap-2" style={{ background:'rgba(244,63,94,0.08)', border:'1px solid rgba(244,63,94,0.25)' }}>
            <AlertTriangle size={14} style={{ color: C.red }} className="mt-0.5 shrink-0"/>
            <p className="text-xs" style={{ color: C.t2 }}>Обнаружены признаки {analysis.editingDetected ? 'монтажа' : ''}{analysis.editingDetected && analysis.splicesDetected ? ' и ' : ''}{analysis.splicesDetected ? 'склеек' : ''} в видео.</p>
          </div>
        )}
        <GlassCard className="p-3">
          <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: C.t1 }}><Sparkles size={13} style={{ color: C.acc }}/> Рекомендации ИИ</p>
          <div className="space-y-1.5">
            {analysis.recommendations.map((r,i) => <p key={i} className="text-xs" style={{ color: C.t2 }}>• {r}</p>)}
          </div>
        </GlassCard>
        <button type="button" onClick={() => { setOrder([]); setCheckpoints([]); }} className="w-full rounded-xl py-2.5 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
          Записать видео повторно
        </button>
      </div>
    );
  }

  if (analyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 size={28} className="animate-spin" style={{ color: C.acc }}/>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>ИИ анализирует видео...</p>
        <p className="text-xs" style={{ color: C.t3 }}>Проверка монтажа, качества, соответствия адресу и планировке</p>
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="space-y-4">
        <GlassCard className="p-5 text-center">
          <Video size={28} style={{ color: C.acc }} className="mx-auto mb-2"/>
          <p className="text-sm font-bold" style={{ color: C.t1 }}>Видео-проверка помещения</p>
          <p className="text-xs mt-1.5" style={{ color: C.t3 }}>
            Запишите одно длинное видео, проходя по маршруту. Система будет выдавать задания в случайном порядке: показать вход, фасад, открыть дверь, дойти до стойки, примерочную, склад, освещение, потолок, пол, аварийный выход, обойти всё помещение и вернуться ко входу.
          </p>
        </GlassCard>
        <button type="button" onClick={start} className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white" style={{ background: C.acc }}>
          <PlayCircle size={17}/> Начать запись
        </button>
      </div>
    );
  }

  const current = order[currentIdx];

  return (
    <div className="space-y-3">
      <GlassCard className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <motion.span className="h-2.5 w-2.5 rounded-full" style={{ background: C.red }} animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.2, repeat:Infinity }}/>
          <span className="text-xs font-bold" style={{ color: C.t1 }}>Запись · {fmtTime(seconds)}</span>
        </div>
        <span className="text-[10px]" style={{ color: C.t3 }}>{confirmedCount}/{order.length} точек</span>
      </GlassCard>

      <GlassCard className="p-4 text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: C.t3 }}>Текущее задание</p>
        <AnimatePresence mode="wait">
          <motion.p key={current} initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-6 }}
            className="text-base font-bold" style={{ color: C.t1 }}>{INSPECTION_TASKS[current]}</motion.p>
        </AnimatePresence>
        <button type="button" onClick={confirmTask}
          className="w-full mt-4 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white" style={{ background: C.green }}>
          <CheckCircle2 size={16}/> Подтвердить выполнение
        </button>
      </GlassCard>

      <GlassCard className="p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Маршрут проверки</p>
        <div className="space-y-1">
          {order.map((task, i) => {
            const cp = checkpoints[i];
            const st = cp?.confirmedAt !== null ? 'done' : i===currentIdx ? 'current' : 'pending';
            return (
              <div key={task} className="flex items-center gap-2 text-xs">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full" style={{ background: st==='done'?C.green:st==='current'?C.acc:C.l2 }}>
                  {st==='done' && <Check size={9} color="#fff"/>}
                </span>
                <span style={{ color: st==='pending' ? C.t3 : C.t1 }}>{INSPECTION_TASKS[task]}</span>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <button type="button" onClick={finish} disabled={confirmedCount===0}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-40" style={{ background: C.l2, color: C.red }}>
        <StopCircle size={16}/> Завершить запись и отправить на анализ
      </button>
    </div>
  );
};

/* ── Шаг 8: проверка брендинга ─────────────────────────────────────── */
const StepBranding = ({ pvz }: { pvz: PVZ }) => {
  const { setBranding } = usePVZStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const b = pvz.branding ?? { signboard:false, interiorKit:false, uniform:false, photos:[], score:0 };

  const toggle = (key: 'signboard'|'interiorKit'|'uniform') => {
    const next: BrandingCheck = { ...b, [key]: !b[key] };
    next.score = Math.round(((next.signboard?1:0)+(next.interiorKit?1:0)+(next.uniform?1:0))/3*100);
    setBranding(pvz.id, next);
  };

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const data = await fileToDataUrl(file);
    setBranding(pvz.id, { ...b, photos: [...b.photos, data] });
  };

  const ITEMS: { key:'signboard'|'interiorKit'|'uniform'; label:string; sub:string }[] = [
    { key:'signboard', label:'Вывеска Sky', sub:'Фирменная вывеска у входа' },
    { key:'interiorKit', label:'Интерьерный набор', sub:'Стойки, наклейки, навигация Sky' },
    { key:'uniform', label:'Форма сотрудников', sub:'Фирменная одежда персонала' },
  ];

  return (
    <div className="space-y-4">
      <GlassCard className="p-4 flex items-center gap-4">
        <ScoreRing score={b.score} size={76}/>
        <div>
          <p className="text-sm font-bold" style={{ color: C.t1 }}>Балл брендинга</p>
          <p className="text-xs mt-1" style={{ color: C.t3 }}>Отметьте все фирменные элементы Sky в помещении</p>
        </div>
      </GlassCard>
      <div className="space-y-2">
        {ITEMS.map(it => (
          <button key={it.key} type="button" onClick={() => toggle(it.key)}
            className="w-full flex items-center gap-3 rounded-xl p-3 text-left" style={{ background: C.l1, border:`1px solid ${b[it.key]?C.green:C.brd}` }}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: b[it.key] ? 'rgba(0,220,90,0.12)' : C.l2 }}>
              {b[it.key] ? <Check size={14} style={{ color: C.green }}/> : <Award size={14} style={{ color: C.t3 }}/>}
            </span>
            <div className="flex-1">
              <p className="text-xs font-semibold" style={{ color: C.t1 }}>{it.label}</p>
              <p className="text-[10px]" style={{ color: C.t3 }}>{it.sub}</p>
            </div>
          </button>
        ))}
      </div>
      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ФОТО БРЕНДИРОВАНИЯ</p>
        <div className="flex gap-2 flex-wrap">
          {b.photos.map((p,i) => <img key={i} src={p} className="h-16 w-16 rounded-xl object-cover"/>)}
          <button type="button" onClick={() => fileRef.current?.click()} className="h-16 w-16 rounded-xl grid place-items-center" style={{ background: C.l2, border:`1px dashed ${C.brd}` }}>
            <Upload size={16} style={{ color: C.t3 }}/>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto}/>
        </div>
      </div>
    </div>
  );
};

/* ── Шаг 9: финальная отправка ────────────────────────────────────── */
const StepSubmit = ({ pvz, onSubmitted }: { pvz: PVZ; onSubmitted: () => void }) => {
  const { submitForReview, analysisFor } = usePVZStore();
  const analysis = analysisFor(pvz.id);
  const checks = [
    { label:'Основная информация', ok: !!pvz.name && !!pvz.phone },
    { label:'Документы загружены', ok: pvz.documents.length > 0 },
    { label:'Адрес указан', ok: !!pvz.address && !!pvz.city },
    { label:'Геолокация определена', ok: !!pvz.location },
    { label:'Чек-лист помещения заполнен', ok: pvz.checklist.every(c=>c.status!=='pending') },
    { label:'Планировка указана', ok: !!pvz.layout },
    { label:'Видео-проверка пройдена', ok: !!analysis },
    { label:'Брендинг проверен', ok: !!pvz.branding },
  ];
  const allOk = checks.every(c=>c.ok);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-2.5 rounded-xl p-3" style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: c.ok ? 'rgba(0,220,90,0.12)' : 'rgba(244,63,94,0.1)' }}>
              {c.ok ? <Check size={13} style={{ color: C.green }}/> : <X size={13} style={{ color: C.red }}/>}
            </span>
            <p className="text-xs font-semibold" style={{ color: C.t1 }}>{c.label}</p>
          </div>
        ))}
      </div>
      {analysis && (
        <GlassCard className="p-4 flex items-center gap-4">
          <ScoreRing score={analysis.overallScore} size={70}/>
          <p className="text-xs flex-1" style={{ color: C.t3 }}>Общий балл по итогам ИИ-анализа видео-проверки помещения</p>
        </GlassCard>
      )}
      <button type="button" disabled={!allOk} onClick={() => { submitForReview(pvz.id); onSubmitted(); }}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
        <Send size={16}/> Отправить на модерацию
      </button>
      {!allOk && <p className="text-[11px] text-center" style={{ color: C.amber }}>Заполните все пункты выше, чтобы отправить заявку</p>}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   ROOT WIZARD
══════════════════════════════════════════════════════════════════ */
export const PVZWizard = ({ pvzId, onClose }: { pvzId: string; onClose: () => void }) => {
  const { getPVZ, setStep } = usePVZStore();
  const pvz = getPVZ(pvzId);
  if (!pvz) return null;

  const stepIdx = WIZARD_STEPS.findIndex(s => s.key === pvz.currentStep);
  const idx = stepIdx === -1 ? 0 : stepIdx;
  const stepDef = WIZARD_STEPS[idx];

  const go = (delta: number) => {
    const next = Math.max(0, Math.min(WIZARD_STEPS.length-1, idx+delta));
    setStep(pvz.id, WIZARD_STEPS[next].key);
  };

  const renderStep = () => {
    switch (stepDef.key) {
      case 'basic':      return <StepBasic pvz={pvz}/>;
      case 'documents':   return <StepDocuments pvz={pvz}/>;
      case 'address':     return <StepAddress pvz={pvz}/>;
      case 'geo':         return <StepGeo pvz={pvz}/>;
      case 'inspection':  return <StepChecklist pvz={pvz}/>;
      case 'layout':      return <StepLayout pvz={pvz}/>;
      case 'video':       return <StepVideo pvz={pvz}/>;
      case 'branding':    return <StepBranding pvz={pvz}/>;
      case 'submit':      return <StepSubmit pvz={pvz} onSubmitted={onClose}/>;
      default: return null;
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: C.bg }}>
      <div className="flex items-center gap-3 px-5 py-4 shrink-0" style={{ borderBottom:`1px solid ${C.brd}` }}>
        <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl" style={{ color: C.t3 }}><X size={18}/></button>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: C.t1 }}>{stepDef.title}</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>{stepDef.sub}</p>
        </div>
        <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: C.l2, color: C.t3 }}>{idx+1}/{WIZARD_STEPS.length}</span>
      </div>
      <StepIndicator current={idx}/>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4" style={{ scrollbarWidth:'none' }}>
        <AnimatePresence mode="wait">
          <motion.div key={stepDef.key} initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-12 }} transition={{ duration:0.2 }}>
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>
      {stepDef.key !== 'submit' && (
        <div className="flex gap-2 p-4 shrink-0" style={{ borderTop:`1px solid ${C.brd}` }}>
          <button type="button" disabled={idx===0} onClick={() => go(-1)}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-30" style={{ background: C.l2, color: C.t2 }}>
            <ArrowLeft size={14}/> Назад
          </button>
          <button type="button" onClick={() => go(1)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold text-white" style={{ background: C.acc }}>
            Далее <ArrowRight size={14}/>
          </button>
        </div>
      )}
    </div>
  );
};
