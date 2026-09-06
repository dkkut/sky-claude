/* ======================================================================
   SKY ПВЗ  —  Store
====================================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import type {
  PVZ, PVZStatus, WizardStepKey, PVZDocument,
  InspectionSession, InspectionCheckpoint,
  AIVideoAnalysis, ChecklistKey, ChecklistStatus,
  PVZLayout, BrandingCheck,
  ModerationDecision, ModerationComment, ModerationAction,
  FinanceOp, FinanceOpType,
  StaffMember, StaffPosition, Shift, StaffLogEntry,
  Parcel, WarehouseCell,
  Complaint,
  CameraDevice, CameraEvent, CameraEventType,
  AIRecommendation, AIReport, AIReportPeriod,
  HistoryEntry, PVZNotification, PVZNotificationType,
  DaySnapshot,
} from './types';
import { WIZARD_STEPS, CHECKLIST_LABELS } from './types';

const KEY = 'sky:pvz:v1';
const W   = typeof window !== 'undefined';
const me  = () => useAuthStore.getState().currentUserId ?? '';
const myName = () => useAuthStore.getState().accounts.find(a => a.id === me())?.name ?? 'Пользователь';

const load = () => { if (!W) return null; try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const save = (d: object) => { if (!W) return; try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
const genId = (p: string) => `${p}-${crypto.randomUUID().slice(0,8)}`;
const nowISO = () => new Date().toISOString();

/* ── Детерминированный «ИИ» псевдослучайный генератор от seed-строки ── */
const seedNum = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};
const seeded = (seed: string, min: number, max: number): number => {
  const h = seedNum(seed);
  return min + (h % 10000) / 10000 * (max - min);
};

/* ── Сид-данные ────────────────────────────────────────────────────── */
const todayStr = (offsetDays = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const SEED_PVZ_ID = 'pvz-seed-1';
const SEED_PVZ: PVZ = {
  id: SEED_PVZ_ID, ownerId: 'acc-luna', status: 'active', tier: 'premium', currentStep: 'submit',
  name: 'Sky ПВЗ — Тверская', format: 'pickup', phone: '+7 999 000-11-22', email: 'tverskaya@sky-pvz.ru',
  workFrom: '09:00', workTo: '21:00',
  city: 'Москва', address: 'ул. Тверская, 12', entrance: 'Со двора, вход №2',
  location: { lat: 55.7615, lng: 37.6089 },
  documents: [],
  checklist: (Object.keys(CHECKLIST_LABELS) as ChecklistKey[]).map(key => ({ key, status: 'pass' as ChecklistStatus, note: '' })),
  layout: { areaSqm: 64, ceilingHeightM: 3.1, zones: [{ name:'Зона выдачи', sqm:24 },{ name:'Склад', sqm:28 },{ name:'Примерочные', sqm:8 },{ name:'Зона ожидания', sqm:4 }], storageSqm: 28, photos: [] },
  branding: { signboard:true, interiorKit:true, uniform:true, photos: [], score: 92 },
  inspectionSessionId: null, aiAnalysisId: null,
  rating: 4.8, capacity: 240,
  createdAt: new Date(Date.now() - 86400000*90).toISOString(),
  updatedAt: new Date(Date.now() - 86400000*2).toISOString(),
  submittedAt: new Date(Date.now() - 86400000*88).toISOString(),
  approvedAt: new Date(Date.now() - 86400000*85).toISOString(),
};

const STAFF_NAMES = [
  { name:'Анна Кузнецова',   username:'anna_k',   position:'manager' as StaffPosition },
  { name:'Игорь Соколов',    username:'igor_s',   position:'operator' as StaffPosition },
  { name:'Полина Орлова',    username:'polina_o', position:'operator' as StaffPosition },
  { name:'Тимур Власов',     username:'timur_v',  position:'storekeeper' as StaffPosition },
];

const seedStaff = (): StaffMember[] => STAFF_NAMES.map((s, i) => ({
  id: `staff-seed-${i}`, pvzId: SEED_PVZ_ID, accountId: `acc-staff-${i}`,
  name: s.name, username: s.username, position: s.position,
  online: i < 2, rating: Math.round(seeded(s.username+'r', 4.2, 5.0)*10)/10,
  servedCount: Math.round(seeded(s.username+'c', 80, 600)),
  avgIssueTimeSec: Math.round(seeded(s.username+'t', 45, 180)),
  errorsCount: Math.round(seeded(s.username+'e', 0, 6)),
  createdAt: new Date(Date.now() - 86400000*60).toISOString(),
}));

const seedCells = (): WarehouseCell[] => {
  const cells: WarehouseCell[] = [];
  const sizes: WarehouseCell['size'][] = ['S','S','S','M','M','L','XL'];
  let n = 0;
  for (let row = 0; row < 8; row++) for (let col = 0; col < 10; col++) {
    n++;
    cells.push({ id:`cell-${row}-${col}`, pvzId: SEED_PVZ_ID, row, col, size: sizes[n % sizes.length], parcelId: null });
  }
  return cells;
};

const seedParcels = (cells: WarehouseCell[]): Parcel[] => {
  const filled = cells.slice(0, 54);
  return filled.map((c, i) => ({
    id: `parcel-seed-${i}`, pvzId: SEED_PVZ_ID, orderCode: `SKY-${100000+i}`,
    clientName: ['Иван Петров','Мария Соколова','Дмитрий Орлов','Алина Захарова','Сергей Кузьмин'][i % 5],
    clientPhone: '+7 999 ' + String(100+i).padStart(3,'0') + '-00-00',
    cellId: c.id, status: i % 11 === 0 ? 'overdue' : 'stored',
    receivedAt: new Date(Date.now() - 86400000 * (i % 5 + 1)).toISOString(),
    issuedAt: null,
    dueAt: new Date(Date.now() + 86400000 * (i % 11 === 0 ? -1 : 3)).toISOString(),
    size: c.size,
  }));
};

const seedSnapshots = (): DaySnapshot[] => Array.from({ length: 30 }, (_, i) => {
  const offset = -(29 - i);
  const date = todayStr(offset);
  const weekday = new Date(date).getDay();
  const weekendDip = (weekday === 0 || weekday === 6) ? 0.7 : 1;
  const base = seeded(date+'base', 18000, 42000) * weekendDip;
  return {
    date,
    revenue: Math.round(base),
    profit: Math.round(base * seeded(date+'p',0.22,0.34)),
    commission: Math.round(base * seeded(date+'c',0.08,0.14)),
    ordersReceived: Math.round(seeded(date+'or', 40, 140) * weekendDip),
    ordersIssued:   Math.round(seeded(date+'oi', 35, 130) * weekendDip),
    returns:        Math.round(seeded(date+'ret', 0, 9)),
    overdue:        Math.round(seeded(date+'ov', 0, 6)),
    visitors:       Math.round(seeded(date+'vis', 60, 220) * weekendDip),
    avgIssueTimeSec:Math.round(seeded(date+'ait', 50, 160)),
    avgWaitTimeSec: Math.round(seeded(date+'awt', 30, 240)),
    cancelRate:     Math.round(seeded(date+'cr', 1, 8)*10)/10,
    returnRate:     Math.round(seeded(date+'rr', 1, 6)*10)/10,
  };
});

const seedComplaints = (): Complaint[] => [
  { id:'cmp-seed-1', pvzId: SEED_PVZ_ID, clientName:'Ольга Миронова', orderCode:'SKY-100012', employeeId:'staff-seed-1',
    text:'Долго ждала в очереди, более 20 минут.', photos:[], videos:[], status:'in_progress', resolution:'',
    deadlineAt: new Date(Date.now()+86400000*2).toISOString(), createdAt: new Date(Date.now()-86400000).toISOString(), resolvedAt:null },
  { id:'cmp-seed-2', pvzId: SEED_PVZ_ID, clientName:'Артём Беляев', orderCode:'SKY-100034', employeeId:null,
    text:'Повреждена упаковка посылки при выдаче.', photos:[], videos:[], status:'resolved', resolution:'Оформлен возврат, клиенту начислен бонус.',
    deadlineAt: new Date(Date.now()-86400000*1).toISOString(), createdAt: new Date(Date.now()-86400000*4).toISOString(), resolvedAt: new Date(Date.now()-86400000*3).toISOString() },
];

const seedCameras = (): CameraDevice[] => [
  { id:'cam-1', pvzId: SEED_PVZ_ID, name:'Камера у входа', zone:'Вход', online:true },
  { id:'cam-2', pvzId: SEED_PVZ_ID, name:'Камера зоны выдачи', zone:'Стойка', online:true },
  { id:'cam-3', pvzId: SEED_PVZ_ID, name:'Камера склада', zone:'Склад', online:true },
  { id:'cam-4', pvzId: SEED_PVZ_ID, name:'Камера зоны ожидания', zone:'Зона ожидания', online:false },
];

const seedCameraEvents = (): CameraEvent[] => [
  { id:'cev-1', cameraId:'cam-2', pvzId: SEED_PVZ_ID, type:'queue', text:'Обнаружена очередь из 5+ человек', createdAt: new Date(Date.now()-3600000*2).toISOString(), read:false },
  { id:'cev-2', cameraId:'cam-1', pvzId: SEED_PVZ_ID, type:'normal', text:'Штатная активность у входа', createdAt: new Date(Date.now()-3600000*5).toISOString(), read:true },
  { id:'cev-3', cameraId:'cam-3', pvzId: SEED_PVZ_ID, type:'suspicious', text:'Подозрительная активность на складе в нерабочее время', createdAt: new Date(Date.now()-3600000*20).toISOString(), read:true },
];

/* ══════════════════════════════════════════════════════════════════
   ИИ-ГЕНЕРАТОРЫ (детерминированная симуляция — без внешних ML API)
══════════════════════════════════════════════════════════════════ */
const buildAIAnalysis = (session: InspectionSession, pvzId: string): AIVideoAnalysis => {
  const seed = session.id;
  const avgQ = session.avgQuality;
  const videoQuality = Math.round(Math.min(100, avgQ + seeded(seed+'vq', -5, 5)));
  const lightingQuality = Math.round(seeded(seed+'lq', 60, 96));
  const addressMatch = Math.round(seeded(seed+'am', 82, 99));
  const editingDetected = seeded(seed+'ed', 0, 1) > 0.93;
  const splicesDetected = seeded(seed+'sp', 0, 1) > 0.95;
  const estimatedAreaSqm = Math.round(seeded(seed+'area', 38, 95));
  const ceilingHeightM = Math.round(seeded(seed+'ch', 2.6, 3.6)*10)/10;
  const floorCondition = Math.round(seeded(seed+'fc', 65, 98));
  const wallCondition = Math.round(seeded(seed+'wc', 65, 98));
  const ceilingCondition = Math.round(seeded(seed+'cc', 65, 98));
  const cleanliness = Math.round(seeded(seed+'cl', 70, 99));
  const brandingPresence = Math.round(seeded(seed+'bp', 50, 100));
  const fittingRoomsCount = Math.round(seeded(seed+'frc', 0, 3));
  const storageCondition = Math.round(seeded(seed+'sc', 60, 97));
  const freeSpacePct = Math.round(seeded(seed+'fs', 15, 55));
  const obstaclesFound = Math.round(seeded(seed+'of', 0, 3));
  const layoutMatch = Math.round(seeded(seed+'lm', 75, 100));
  const safetyScore = Math.round(seeded(seed+'ss', 70, 99));

  const checkpointCoverage = session.checkpoints.filter(c => c.confirmedAt !== null).length / session.checkpoints.length;

  const weighted = [
    videoQuality*0.10, lightingQuality*0.08, addressMatch*0.10, floorCondition*0.07,
    wallCondition*0.07, ceilingCondition*0.05, cleanliness*0.12, brandingPresence*0.08,
    storageCondition*0.08, layoutMatch*0.10, safetyScore*0.10, checkpointCoverage*100*0.05,
  ].reduce((a,b) => a+b, 0);
  const penalty = (editingDetected ? 15 : 0) + (splicesDetected ? 10 : 0) + obstaclesFound*2;
  const overallScore = Math.max(0, Math.min(100, Math.round(weighted - penalty)));

  const recommendations: string[] = [];
  if (lightingQuality < 75) recommendations.push('Усилить освещение в зоне выдачи и складе');
  if (cleanliness < 80) recommendations.push('Провести генеральную уборку перед повторной проверкой');
  if (brandingPresence < 70) recommendations.push('Дополнить фирменное оформление Sky (вывеска, стойка, наклейки)');
  if (storageCondition < 75) recommendations.push('Привести в порядок складскую зону, освободить проходы');
  if (freeSpacePct < 20) recommendations.push('Высвободить пространство — заполненность близка к критической');
  if (obstaclesFound > 0) recommendations.push('Устранить препятствия в проходах (найдено: ' + obstaclesFound + ')');
  if (safetyScore < 80) recommendations.push('Проверить пожарную безопасность и эвакуационные пути');
  if (editingDetected || splicesDetected) recommendations.push('Видео содержит признаки монтажа — требуется повторная запись');
  if (checkpointCoverage < 0.9) recommendations.push('Не все контрольные точки маршрута были пройдены — повторите проверку');
  if (recommendations.length === 0) recommendations.push('Помещение полностью соответствует требованиям Sky');

  return {
    id: genId('aia'), sessionId: session.id, pvzId,
    editingDetected, splicesDetected, videoQuality, lightingQuality, addressMatch,
    estimatedAreaSqm, ceilingHeightM, floorCondition, wallCondition, ceilingCondition,
    cleanliness, brandingPresence, fittingRoomsCount, storageCondition, freeSpacePct,
    obstaclesFound, layoutMatch, safetyScore, overallScore, recommendations,
    analyzedAt: nowISO(),
  };
};

const buildAIReport = (pvzId: string, period: AIReportPeriod, snapshots: DaySnapshot[]): AIReport => {
  const n = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
  const slice = snapshots.slice(-n);
  const avg = (f: (s: DaySnapshot) => number) => slice.length ? slice.reduce((a,s)=>a+f(s),0)/slice.length : 0;
  const scoreOverall = Math.round(Math.min(100, Math.max(0,
    100 - avg(s=>s.cancelRate)*2 - avg(s=>s.returnRate)*1.5 - avg(s=>s.overdue) + avg(s=>s.ordersIssued)/avg(s=>Math.max(1,s.ordersReceived))*15
  )));
  const highlights = [
    `Выручка: ${Math.round(slice.reduce((a,s)=>a+s.revenue,0)).toLocaleString('ru-RU')} ₽`,
    `Среднее время выдачи: ${Math.round(avg(s=>s.avgIssueTimeSec))} сек`,
    `Процент отмен: ${avg(s=>s.cancelRate).toFixed(1)}%`,
    `Просрочек: ${Math.round(slice.reduce((a,s)=>a+s.overdue,0))}`,
  ];
  return {
    id: genId('rep'), pvzId, period, scoreOverall,
    summary: scoreOverall >= 85 ? 'Отличные показатели, ПВЗ работает стабильно.' :
             scoreOverall >= 65 ? 'Хорошие показатели, есть точки роста.' :
             'Обнаружены проблемы, требуется внимание.',
    highlights, createdAt: nowISO(),
  };
};

const buildAIRecommendations = (pvzId: string, snapshots: DaySnapshot[], staff: StaffMember[]): AIRecommendation[] => {
  const recent = snapshots.slice(-7);
  if (recent.length === 0) return [];
  const avgWait = recent.reduce((a,s)=>a+s.avgWaitTimeSec,0)/recent.length;
  const avgIssue = recent.reduce((a,s)=>a+s.avgIssueTimeSec,0)/recent.length;
  const peakDay = recent.reduce((max,s) => s.visitors > max.visitors ? s : max, recent[0]);
  const totalOverdue = recent.reduce((a,s)=>a+s.overdue,0);
  const onlineStaff = staff.filter(s=>s.online).length;

  const list: AIRecommendation[] = [];
  if (avgWait > 150) list.push({ id: genId('ai'), pvzId, text:'Увеличьте количество сотрудников в часы пик — среднее время ожидания превышает 2.5 минуты', priority:'high', category:'staffing', createdAt: nowISO(), done:false });
  if (onlineStaff < 2) list.push({ id: genId('ai'), pvzId, text:'Сейчас на смене менее 2 сотрудников — риск роста очередей', priority:'medium', category:'staffing', createdAt: nowISO(), done:false });
  if (avgIssue > 100) list.push({ id: genId('ai'), pvzId, text:'Ускорьте процесс выдачи — среднее время превышает целевой показатель в 100 сек', priority:'medium', category:'service_speed', createdAt: nowISO(), done:false });
  if (totalOverdue > 10) list.push({ id: genId('ai'), pvzId, text:'Накопилось много просроченных посылок — перераспределите товары на складе', priority:'high', category:'warehouse', createdAt: nowISO(), done:false });
  list.push({ id: genId('ai'), pvzId, text:`Пик посещаемости — ${new Date(peakDay.date).toLocaleDateString('ru-RU',{weekday:'long'})}, подготовьте дополнительную смену`, priority:'low', category:'staffing', createdAt: nowISO(), done:false });
  list.push({ id: genId('ai'), pvzId, text:'Прогноз: нагрузка на следующей неделе вырастет на 8-12% — подготовьте склад заранее', priority:'medium', category:'warehouse', createdAt: nowISO(), done:false });
  return list;
};

/* ══════════════════════════════════════════════════════════════════
   STORE STATE
══════════════════════════════════════════════════════════════════ */
interface PVZState {
  pvzList:        PVZ[];
  inspectionSessions: InspectionSession[];
  aiAnalyses:      AIVideoAnalysis[];
  moderationDecisions: ModerationDecision[];
  moderationComments:  ModerationComment[];
  financeOps:      FinanceOp[];
  staff:           StaffMember[];
  shifts:          Shift[];
  staffLogs:       StaffLogEntry[];
  cells:           WarehouseCell[];
  parcels:         Parcel[];
  complaints:      Complaint[];
  cameras:         CameraDevice[];
  cameraEvents:    CameraEvent[];
  aiRecommendations: AIRecommendation[];
  aiReports:       AIReport[];
  history:         HistoryEntry[];
  notifications:   PVZNotification[];
  snapshots:       Record<string, DaySnapshot[]>; // pvzId -> 30-day snapshots

  /* PVZ / wizard */
  myPVZs: () => PVZ[];
  pendingModeration: () => PVZ[];
  getPVZ: (id: string) => PVZ | null;
  createDraft: () => string;
  updatePVZ: (id: string, patch: Partial<PVZ>) => void;
  setStep: (id: string, step: WizardStepKey) => void;
  addDocument: (id: string, doc: Omit<PVZDocument,'id'|'uploadedAt'>) => void;
  removeDocument: (id: string, docId: string) => void;
  setChecklistItem: (id: string, key: ChecklistKey, status: ChecklistStatus, note: string) => void;
  setLayout: (id: string, layout: PVZLayout) => void;
  setBranding: (id: string, branding: BrandingCheck) => void;
  submitForReview: (id: string) => void;

  /* Видео-инспекция / ИИ */
  saveInspectionSession: (pvzId: string, checkpoints: InspectionCheckpoint[], durationSec: number) => InspectionSession;
  runAIAnalysis: (pvzId: string, sessionId: string) => AIVideoAnalysis;
  analysisFor: (pvzId: string) => AIVideoAnalysis | null;
  sessionFor: (pvzId: string) => InspectionSession | null;

  /* Модерация */
  decide: (pvzId: string, action: ModerationAction, comment: string, reasons: string[]) => void;
  addComment: (pvzId: string, text: string) => void;
  commentsFor: (pvzId: string) => ModerationComment[];
  decisionsFor: (pvzId: string) => ModerationDecision[];

  /* Финансы */
  addFinanceOp: (pvzId: string, type: FinanceOpType, amount: number, comment: string) => void;
  financeFor: (pvzId: string) => FinanceOp[];
  balanceFor: (pvzId: string) => number;

  /* Персонал */
  staffFor: (pvzId: string) => StaffMember[];
  addStaffMember: (pvzId: string, accountId: string, name: string, username: string, position: StaffPosition) => void;
  removeStaffMember: (id: string) => void;
  toggleStaffOnline: (id: string) => void;
  addShift: (staffId: string, date: string, from: string, to: string) => void;
  shiftsFor: (staffId: string) => Shift[];
  staffLogFor: (staffId: string) => StaffLogEntry[];

  /* Склад / посылки */
  cellsFor: (pvzId: string) => WarehouseCell[];
  parcelsFor: (pvzId: string) => Parcel[];
  issueParcel: (parcelId: string) => void;
  returnParcel: (parcelId: string) => void;
  findParcel: (pvzId: string, query: string) => Parcel[];

  /* Жалобы */
  complaintsFor: (pvzId: string) => Complaint[];
  addComplaint: (pvzId: string, p: Omit<Complaint,'id'|'pvzId'|'createdAt'|'resolvedAt'|'status'|'resolution'>) => void;
  updateComplaint: (id: string, patch: Partial<Complaint>) => void;

  /* Камеры */
  camerasFor: (pvzId: string) => CameraDevice[];
  cameraEventsFor: (pvzId: string) => CameraEvent[];
  simulateCameraEvent: (pvzId: string) => void;
  markCameraEventRead: (id: string) => void;

  /* ИИ-центр */
  recommendationsFor: (pvzId: string) => AIRecommendation[];
  generateRecommendations: (pvzId: string) => void;
  toggleRecommendationDone: (id: string) => void;
  reportsFor: (pvzId: string) => AIReport[];
  generateReport: (pvzId: string, period: AIReportPeriod) => AIReport;

  /* Аналитика */
  snapshotsFor: (pvzId: string) => DaySnapshot[];

  /* История / уведомления */
  log: (pvzId: string | null, action: string, description: string) => void;
  historyFor: (pvzId: string | null) => HistoryEntry[];
  notify: (pvzId: string | null, type: PVZNotificationType, title: string, text: string) => void;
  notificationsFor: (pvzId: string | null) => PVZNotification[];
  markNotificationRead: (id: string) => void;
}

const stored = load();

export const usePVZStore = create<PVZState>((set, get) => {
  const flush = () => {
    const s = get();
    save({
      pvzList: s.pvzList, inspectionSessions: s.inspectionSessions, aiAnalyses: s.aiAnalyses,
      moderationDecisions: s.moderationDecisions, moderationComments: s.moderationComments,
      financeOps: s.financeOps, staff: s.staff, shifts: s.shifts, staffLogs: s.staffLogs,
      cells: s.cells, parcels: s.parcels, complaints: s.complaints,
      cameras: s.cameras, cameraEvents: s.cameraEvents,
      aiRecommendations: s.aiRecommendations, aiReports: s.aiReports,
      history: s.history, notifications: s.notifications, snapshots: s.snapshots,
    });
  };
  const mut = (fn: (s: PVZState) => Partial<PVZState>) => { set(s => ({ ...s, ...fn(s) })); flush(); };

  const writeLog = (pvzId: string | null, action: string, description: string) => {
    const entry: HistoryEntry = {
      id: genId('hist'), pvzId, userId: me(), userName: myName(),
      ip: `10.${seedNum(me()+action)%255}.${seedNum(description)%255}.${seedNum(action)%255}`,
      device: 'Sky PC App / Chromium', action, description, createdAt: nowISO(),
    };
    set(s => ({ history: [entry, ...s.history].slice(0, 500) }));
  };

  const cells0 = stored?.cells ?? seedCells();

  return {
    pvzList: stored?.pvzList ?? [SEED_PVZ],
    inspectionSessions: stored?.inspectionSessions ?? [],
    aiAnalyses: stored?.aiAnalyses ?? [],
    moderationDecisions: stored?.moderationDecisions ?? [],
    moderationComments: stored?.moderationComments ?? [],
    financeOps: stored?.financeOps ?? [],
    staff: stored?.staff ?? seedStaff(),
    shifts: stored?.shifts ?? [],
    staffLogs: stored?.staffLogs ?? [],
    cells: cells0,
    parcels: stored?.parcels ?? seedParcels(cells0),
    complaints: stored?.complaints ?? seedComplaints(),
    cameras: stored?.cameras ?? seedCameras(),
    cameraEvents: stored?.cameraEvents ?? seedCameraEvents(),
    aiRecommendations: stored?.aiRecommendations ?? [],
    aiReports: stored?.aiReports ?? [],
    history: stored?.history ?? [],
    notifications: stored?.notifications ?? [],
    snapshots: stored?.snapshots ?? { [SEED_PVZ_ID]: seedSnapshots() },

    /* ── PVZ / wizard ──────────────────────────────────────────── */
    myPVZs: () => { const oid = me(); return get().pvzList.filter(p => p.ownerId === oid).sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime()); },
    pendingModeration: () => get().pvzList.filter(p => p.status === 'in_review'),
    getPVZ: (id) => get().pvzList.find(p => p.id === id) ?? null,

    createDraft: () => {
      const id = genId('pvz');
      const ownerId = me();
      const pvz: PVZ = {
        id, ownerId, status:'draft', tier:'standard', currentStep:'basic',
        name:'', format:'pickup', phone:'', email:'', workFrom:'09:00', workTo:'21:00',
        city:'', address:'', entrance:'', location:{lat:55.7558,lng:37.6173},
        documents: [], checklist:(Object.keys(CHECKLIST_LABELS) as ChecklistKey[]).map(key=>({key,status:'pending' as ChecklistStatus,note:''})),
        layout:null, branding:null, inspectionSessionId:null, aiAnalysisId:null,
        rating:0, capacity:200, createdAt:nowISO(), updatedAt:nowISO(), submittedAt:null, approvedAt:null,
      };
      mut(s => ({ pvzList: [...s.pvzList, pvz] }));
      writeLog(id, 'pvz_created', 'Создан черновик нового ПВЗ'); flush();
      return id;
    },

    updatePVZ: (id, patch) => {
      mut(s => ({ pvzList: s.pvzList.map(p => p.id===id ? { ...p, ...patch, updatedAt: nowISO() } : p) }));
    },

    setStep: (id, step) => get().updatePVZ(id, { currentStep: step }),

    addDocument: (id, doc) => {
      const pvz = get().getPVZ(id); if (!pvz) return;
      const full: PVZDocument = { id: genId('doc'), uploadedAt: nowISO(), ...doc };
      get().updatePVZ(id, { documents: [...pvz.documents, full] });
      writeLog(id, 'document_added', `Загружен документ «${doc.title}»`); flush();
    },
    removeDocument: (id, docId) => {
      const pvz = get().getPVZ(id); if (!pvz) return;
      get().updatePVZ(id, { documents: pvz.documents.filter(d => d.id !== docId) });
    },

    setChecklistItem: (id, key, status, note) => {
      const pvz = get().getPVZ(id); if (!pvz) return;
      get().updatePVZ(id, { checklist: pvz.checklist.map(c => c.key===key ? { ...c, status, note } : c) });
    },

    setLayout: (id, layout) => { get().updatePVZ(id, { layout }); writeLog(id,'layout_saved','Сохранена планировка помещения'); flush(); },
    setBranding: (id, branding) => { get().updatePVZ(id, { branding }); writeLog(id,'branding_checked','Проведена проверка брендинга'); flush(); },

    submitForReview: (id) => {
      get().updatePVZ(id, { status:'in_review', submittedAt: nowISO() });
      writeLog(id, 'submitted', 'Заявка отправлена на модерацию');
      get().notify(id, 'moderation', 'Заявка отправлена', 'Ваша заявка на регистрацию ПВЗ отправлена на проверку модератору');
      flush();
    },

    /* ── Видео-инспекция / ИИ ──────────────────────────────────── */
    saveInspectionSession: (pvzId, checkpoints, durationSec) => {
      const confirmed = checkpoints.filter(c => c.confirmedAt !== null);
      const avgQuality = confirmed.length ? Math.round(confirmed.reduce((a,c)=>a+c.quality,0)/confirmed.length) : 0;
      const session: InspectionSession = {
        id: genId('insp'), pvzId, durationSec, checkpoints, avgQuality,
        videoName: `inspection_${pvzId}_${Date.now()}.mp4`, recordedAt: nowISO(),
      };
      mut(s => ({ inspectionSessions: [...s.inspectionSessions, session] }));
      get().updatePVZ(pvzId, { inspectionSessionId: session.id });
      writeLog(pvzId, 'video_recorded', `Записана видео-инспекция (${Math.round(durationSec)}с, ${confirmed.length}/${checkpoints.length} точек)`); flush();
      return session;
    },

    runAIAnalysis: (pvzId, sessionId) => {
      const session = get().inspectionSessions.find(s => s.id === sessionId);
      if (!session) throw new Error('session not found');
      const analysis = buildAIAnalysis(session, pvzId);
      mut(s => ({ aiAnalyses: [...s.aiAnalyses, analysis] }));
      get().updatePVZ(pvzId, { aiAnalysisId: analysis.id });
      writeLog(pvzId, 'ai_analysis', `ИИ-анализ видео завершён, общий балл: ${analysis.overallScore}`);
      get().notify(pvzId, 'ai', 'ИИ-анализ завершён', `Общий балл помещения: ${analysis.overallScore}/100`);
      flush();
      return analysis;
    },

    analysisFor: (pvzId) => { const pvz = get().getPVZ(pvzId); if (!pvz?.aiAnalysisId) return null; return get().aiAnalyses.find(a=>a.id===pvz.aiAnalysisId) ?? null; },
    sessionFor: (pvzId) => { const pvz = get().getPVZ(pvzId); if (!pvz?.inspectionSessionId) return null; return get().inspectionSessions.find(s=>s.id===pvz.inspectionSessionId) ?? null; },

    /* ── Модерация ─────────────────────────────────────────────── */
    decide: (pvzId, action, comment, reasons) => {
      const decision: ModerationDecision = {
        id: genId('mod'), pvzId, action, comment, reasons,
        reviewerId: me(), reviewerName: myName(), createdAt: nowISO(),
      };
      mut(s => ({ moderationDecisions: [decision, ...s.moderationDecisions] }));
      const statusMap: Record<ModerationAction, PVZStatus> = { approved:'approved', needs_fix:'needs_fix', rejected:'rejected' };
      get().updatePVZ(pvzId, { status: statusMap[action], approvedAt: action==='approved' ? nowISO() : null });
      writeLog(pvzId, 'moderation_decision', `Решение модератора: ${action} — ${comment || 'без комментария'}`);
      const titleMap: Record<ModerationAction,string> = { approved:'ПВЗ одобрен', needs_fix:'Требуются доработки', rejected:'Заявка отклонена' };
      get().notify(pvzId, 'moderation', titleMap[action], comment || 'Подробности в разделе модерации');
      if (action === 'approved') {
        get().updatePVZ(pvzId, { status:'active' });
        if (!get().snapshots[pvzId]) mut(s => ({ snapshots: { ...s.snapshots, [pvzId]: seedSnapshots() } }));
      }
      flush();
    },
    addComment: (pvzId, text) => {
      const c: ModerationComment = { id: genId('cmt'), pvzId, authorId: me(), authorName: myName(), text: text.trim(), createdAt: nowISO() };
      mut(s => ({ moderationComments: [...s.moderationComments, c] }));
    },
    commentsFor: (pvzId) => get().moderationComments.filter(c => c.pvzId === pvzId),
    decisionsFor: (pvzId) => get().moderationDecisions.filter(d => d.pvzId === pvzId).sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()),

    /* ── Финансы ───────────────────────────────────────────────── */
    addFinanceOp: (pvzId, type, amount, comment) => {
      const op: FinanceOp = { id: genId('fin'), pvzId, type, amount: Math.abs(amount), comment, createdAt: nowISO() };
      mut(s => ({ financeOps: [op, ...s.financeOps] }));
      writeLog(pvzId, 'finance_op', `${type}: ${amount.toLocaleString('ru-RU')} ₽ — ${comment}`);
      flush();
    },
    financeFor: (pvzId) => get().financeOps.filter(f => f.pvzId === pvzId).sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()),
    balanceFor: (pvzId) => get().financeOps.filter(f=>f.pvzId===pvzId).reduce((a,f) => {
      const sign = f.type==='income' || f.type==='bonus' ? 1 : -1;
      return a + sign*f.amount;
    }, 0),

    /* ── Персонал ──────────────────────────────────────────────── */
    staffFor: (pvzId) => get().staff.filter(s => s.pvzId === pvzId),
    addStaffMember: (pvzId, accountId, name, username, position) => {
      if (get().staff.some(s=>s.pvzId===pvzId && s.accountId===accountId)) return;
      const member: StaffMember = { id: genId('stf'), pvzId, accountId, name, username, position, online:false, rating:5, servedCount:0, avgIssueTimeSec:90, errorsCount:0, createdAt: nowISO() };
      mut(s => ({ staff: [...s.staff, member] }));
      writeLog(pvzId, 'staff_added', `${name} назначен на должность: ${position}`); flush();
    },
    removeStaffMember: (id) => {
      const member = get().staff.find(s=>s.id===id);
      mut(s => ({ staff: s.staff.filter(x => x.id !== id) }));
      if (member) { writeLog(member.pvzId, 'staff_removed', `${member.name} удалён из команды`); flush(); }
    },
    toggleStaffOnline: (id) => mut(s => ({ staff: s.staff.map(x => x.id===id ? { ...x, online: !x.online } : x) })),
    addShift: (staffId, date, from, to) => mut(s => ({ shifts: [...s.shifts, { id: genId('sh'), staffId, date, from, to, status:'planned' as const }] })),
    shiftsFor: (staffId) => get().shifts.filter(s => s.staffId === staffId).sort((a,b)=>a.date.localeCompare(b.date)),
    staffLogFor: (staffId) => get().staffLogs.filter(l => l.staffId === staffId),

    /* ── Склад / посылки ───────────────────────────────────────── */
    cellsFor: (pvzId) => get().cells.filter(c => c.pvzId === pvzId),
    parcelsFor: (pvzId) => get().parcels.filter(p => p.pvzId === pvzId).sort((a,b)=>new Date(b.dueAt).getTime()-new Date(a.dueAt).getTime()),
    issueParcel: (parcelId) => {
      const p = get().parcels.find(x=>x.id===parcelId); if (!p) return;
      mut(s => ({
        parcels: s.parcels.map(x => x.id===parcelId ? { ...x, status:'issued' as const, issuedAt: nowISO() } : x),
        cells: s.cells.map(c => c.id===p.cellId ? { ...c, parcelId:null } : c),
      }));
      writeLog(p.pvzId, 'parcel_issued', `Посылка ${p.orderCode} выдана клиенту ${p.clientName}`); flush();
    },
    returnParcel: (parcelId) => {
      const p = get().parcels.find(x=>x.id===parcelId); if (!p) return;
      mut(s => ({ parcels: s.parcels.map(x => x.id===parcelId ? { ...x, status:'returned' as const } : x) }));
      writeLog(p.pvzId, 'parcel_returned', `Посылка ${p.orderCode} оформлена как возврат`); flush();
    },
    findParcel: (pvzId, query) => {
      const q = query.trim().toLowerCase();
      if (!q) return get().parcelsFor(pvzId);
      return get().parcelsFor(pvzId).filter(p => p.orderCode.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q) || p.clientPhone.includes(q));
    },

    /* ── Жалобы ────────────────────────────────────────────────── */
    complaintsFor: (pvzId) => get().complaints.filter(c => c.pvzId === pvzId).sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()),
    addComplaint: (pvzId, p) => {
      const complaint: Complaint = { id: genId('cmp'), pvzId, status:'new', resolution:'', createdAt: nowISO(), resolvedAt:null, ...p };
      mut(s => ({ complaints: [complaint, ...s.complaints] }));
      writeLog(pvzId, 'complaint_created', `Новая жалоба от ${p.clientName} по заказу ${p.orderCode}`);
      get().notify(pvzId, 'complaint', 'Новая жалоба', `${p.clientName}: ${p.text.slice(0,80)}`);
      flush();
    },
    updateComplaint: (id, patch) => {
      const c = get().complaints.find(x=>x.id===id); if (!c) return;
      const resolved = patch.status === 'resolved' || patch.status === 'rejected';
      mut(s => ({ complaints: s.complaints.map(x => x.id===id ? { ...x, ...patch, resolvedAt: resolved ? nowISO() : x.resolvedAt } : x) }));
      writeLog(c.pvzId, 'complaint_updated', `Статус жалобы изменён: ${patch.status ?? c.status}`); flush();
    },

    /* ── Камеры ────────────────────────────────────────────────── */
    camerasFor: (pvzId) => get().cameras.filter(c => c.pvzId === pvzId),
    cameraEventsFor: (pvzId) => get().cameraEvents.filter(e => e.pvzId === pvzId).sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()),
    simulateCameraEvent: (pvzId) => {
      const cams = get().camerasFor(pvzId).filter(c=>c.online);
      if (cams.length === 0) return;
      const types: CameraEventType[] = ['queue','suspicious','empty','normal'];
      const texts: Record<CameraEventType,string> = {
        queue:'Обнаружена очередь из 5+ человек', suspicious:'Зафиксирована подозрительная активность',
        empty:'Помещение пустует более 30 минут в рабочее время', normal:'Штатная активность зафиксирована',
      };
      const type = types[Math.floor(Math.random()*types.length)];
      const cam = cams[Math.floor(Math.random()*cams.length)];
      const ev: CameraEvent = { id: genId('cev'), cameraId: cam.id, pvzId, type, text: texts[type], createdAt: nowISO(), read:false };
      mut(s => ({ cameraEvents: [ev, ...s.cameraEvents] }));
      if (type !== 'normal') get().notify(pvzId, 'camera', 'Событие на камере', `${cam.name}: ${texts[type]}`);
      flush();
    },
    markCameraEventRead: (id) => mut(s => ({ cameraEvents: s.cameraEvents.map(e => e.id===id ? { ...e, read:true } : e) })),

    /* ── ИИ-центр ──────────────────────────────────────────────── */
    recommendationsFor: (pvzId) => get().aiRecommendations.filter(r => r.pvzId === pvzId).sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()),
    generateRecommendations: (pvzId) => {
      const list = buildAIRecommendations(pvzId, get().snapshotsFor(pvzId), get().staffFor(pvzId));
      mut(s => ({ aiRecommendations: [...list, ...s.aiRecommendations] }));
      writeLog(pvzId, 'ai_recommendations', `ИИ сформировал ${list.length} новых рекомендаций`); flush();
    },
    toggleRecommendationDone: (id) => mut(s => ({ aiRecommendations: s.aiRecommendations.map(r => r.id===id ? { ...r, done: !r.done } : r) })),
    reportsFor: (pvzId) => get().aiReports.filter(r => r.pvzId === pvzId).sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()),
    generateReport: (pvzId, period) => {
      const report = buildAIReport(pvzId, period, get().snapshotsFor(pvzId));
      mut(s => ({ aiReports: [report, ...s.aiReports] }));
      writeLog(pvzId, 'ai_report', `Сформирован ${period}-отчёт, балл: ${report.scoreOverall}`); flush();
      return report;
    },

    /* ── Аналитика ─────────────────────────────────────────────── */
    snapshotsFor: (pvzId) => get().snapshots[pvzId] ?? [],

    /* ── История / уведомления ────────────────────────────────── */
    log: (pvzId, action, description) => { writeLog(pvzId, action, description); flush(); },
    historyFor: (pvzId) => pvzId === null ? get().history : get().history.filter(h => h.pvzId === pvzId || h.pvzId === null),
    notify: (pvzId, type, title, text) => {
      const n: PVZNotification = { id: genId('ntf'), pvzId, type, title, text, read:false, createdAt: nowISO() };
      mut(s => ({ notifications: [n, ...s.notifications].slice(0,200) }));
    },
    notificationsFor: (pvzId) => pvzId === null ? get().notifications : get().notifications.filter(n => n.pvzId === pvzId || n.pvzId === null),
    markNotificationRead: (id) => mut(s => ({ notifications: s.notifications.map(n => n.id===id ? { ...n, read:true } : n) })),
  };
});

export { WIZARD_STEPS, CHECKLIST_LABELS };
