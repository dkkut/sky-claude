/* ======================================================================
   SKY ПВЗ  —  Types
   Платформа управления пунктами выдачи заказов
====================================================================== */

/* ══════════════════════════════════════════════════════════════════
   ОБЩЕЕ
══════════════════════════════════════════════════════════════════ */
export interface GeoPoint { lat: number; lng: number; }

export type PVZStatus =
  | 'draft'        // мастер регистрации не завершён
  | 'in_review'     // отправлено на модерацию
  | 'needs_fix'     // модератор запросил доработки
  | 'approved'      // одобрено, но ещё не запущено
  | 'active'        // работает
  | 'suspended'     // временно приостановлено
  | 'rejected';     // отклонено

export type PVZTier = 'standard' | 'premium' | 'flagship';

/* ══════════════════════════════════════════════════════════════════
   МАСТЕР РЕГИСТРАЦИИ
══════════════════════════════════════════════════════════════════ */
export type WizardStepKey =
  | 'basic' | 'documents' | 'address' | 'geo' | 'inspection'
  | 'layout' | 'video' | 'branding' | 'submit';

export const WIZARD_STEPS: { key: WizardStepKey; title: string; sub: string }[] = [
  { key:'basic',      title:'Основная информация', sub:'Название, формат, контакты' },
  { key:'documents',  title:'Документы',           sub:'Юр. лицо, договор, лицензии' },
  { key:'address',    title:'Адрес',                sub:'Юридический и фактический адрес' },
  { key:'geo',        title:'Геолокация',           sub:'Точка на карте, подъезд' },
  { key:'inspection', title:'Проверка помещения',   sub:'Чек-лист требований' },
  { key:'layout',     title:'Планировка',           sub:'Зоны, площадь, склад' },
  { key:'video',      title:'Видео-проверка',       sub:'Запись инспекции по маршруту' },
  { key:'branding',   title:'Проверка брендинга',   sub:'Фирменные элементы Sky' },
  { key:'submit',     title:'Финальная отправка',   sub:'Проверка и отправка на модерацию' },
];

export interface PVZDocument {
  id:        string;
  type:      'contract' | 'act' | 'license' | 'certificate' | 'finance' | 'other';
  title:     string;
  fileName:  string;
  fileData:  string;     // data-url
  expiresAt: string | null;
  uploadedAt:string;
}

/* ── Видео-инспекция ──────────────────────────────────────────────── */
export type InspectionTaskKey =
  | 'entrance' | 'facade' | 'open_door' | 'to_counter' | 'fitting_room'
  | 'open_storage' | 'lighting' | 'ceiling' | 'floor' | 'emergency_exit'
  | 'full_walk' | 'return_entrance';

export const INSPECTION_TASKS: Record<InspectionTaskKey, string> = {
  entrance:        'Покажите вход в помещение',
  facade:          'Покажите фасад здания',
  open_door:       'Откройте дверь',
  to_counter:      'Пройдите к стойке выдачи',
  fitting_room:    'Покажите примерочную',
  open_storage:    'Откройте склад',
  lighting:        'Покажите освещение',
  ceiling:         'Покажите потолок',
  floor:           'Покажите пол',
  emergency_exit:  'Покажите аварийный выход',
  full_walk:       'Пройдите по всему помещению',
  return_entrance: 'Вернитесь ко входу',
};

export interface InspectionCheckpoint {
  task:        InspectionTaskKey;
  requestedAt: number;   // секунда видео, когда выдано задание
  confirmedAt: number | null; // секунда видео, когда пользователь подтвердил выполнение
  quality:     number;   // 0-100, симулированная оценка чёткости кадра в момент подтверждения
}

export interface InspectionSession {
  id:            string;
  pvzId:         string;
  durationSec:   number;
  checkpoints:   InspectionCheckpoint[];
  avgQuality:    number;
  videoName:     string;     // имя «записанного» файла (симуляция — реальной камеры нет)
  recordedAt:    string;
}

/* ── ИИ-анализ видео ──────────────────────────────────────────────── */
export interface AIVideoAnalysis {
  id:               string;
  sessionId:        string;
  pvzId:            string;
  editingDetected:  boolean;
  splicesDetected:  boolean;
  videoQuality:     number;   // 0-100
  lightingQuality:  number;
  addressMatch:     number;   // 0-100, уверенность совпадения с адресом
  estimatedAreaSqm: number;
  ceilingHeightM:   number;
  floorCondition:   number;
  wallCondition:    number;
  ceilingCondition: number;
  cleanliness:      number;
  brandingPresence: number;
  fittingRoomsCount:number;
  storageCondition: number;
  freeSpacePct:     number;
  obstaclesFound:   number;
  layoutMatch:      number;
  safetyScore:      number;
  overallScore:     number;   // 0-100 общий балл
  recommendations:  string[];
  analyzedAt:       string;
}

/* ── Чек-лист помещения ────────────────────────────────────────────── */
export type ChecklistKey =
  | 'fire_safety' | 'internet' | 'electricity' | 'cameras' | 'counter'
  | 'furniture' | 'branding' | 'fitting_rooms' | 'storage' | 'navigation'
  | 'lighting' | 'cleanliness' | 'parking' | 'accessibility' | 'waiting_area';

export const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  fire_safety:    'Пожарная безопасность',
  internet:       'Интернет',
  electricity:    'Электричество',
  cameras:        'Камеры видеонаблюдения',
  counter:        'Стойка выдачи',
  furniture:      'Мебель',
  branding:       'Брендированные элементы',
  fitting_rooms:  'Примерочные',
  storage:        'Склад',
  navigation:     'Навигация',
  lighting:       'Освещение',
  cleanliness:    'Чистота',
  parking:        'Парковка',
  accessibility:  'Доступность (ОВЗ)',
  waiting_area:   'Зона ожидания',
};

export type ChecklistStatus = 'pass' | 'fail' | 'na' | 'pending';

export interface ChecklistItem {
  key:    ChecklistKey;
  status: ChecklistStatus;
  note:   string;
}

/* ── Планировка / помещение ───────────────────────────────────────── */
export interface PVZLayout {
  areaSqm:        number;
  ceilingHeightM: number;
  zones:          { name: string; sqm: number }[];
  storageSqm:     number;
  photos:         string[]; // data-url план/фото
}

/* ── Брендинг ──────────────────────────────────────────────────────── */
export interface BrandingCheck {
  signboard:   boolean;  // вывеска
  interiorKit: boolean;  // фирменные стойки/наклейки
  uniform:     boolean;  // форма сотрудников
  photos:      string[];
  score:       number;   // 0-100
}

/* ══════════════════════════════════════════════════════════════════
   МОДЕРАЦИЯ
══════════════════════════════════════════════════════════════════ */
export type ModerationAction = 'approved' | 'needs_fix' | 'rejected';

export interface ModerationDecision {
  id:         string;
  pvzId:      string;
  action:     ModerationAction;
  comment:    string;
  reasons:    string[];
  reviewerId: string;
  reviewerName: string;
  createdAt:  string;
}

export interface ModerationComment {
  id:        string;
  pvzId:     string;
  authorId:  string;
  authorName:string;
  text:      string;
  createdAt: string;
}

/* ══════════════════════════════════════════════════════════════════
   ОСНОВНАЯ СУЩНОСТЬ ПВЗ
══════════════════════════════════════════════════════════════════ */
export interface PVZ {
  id:           string;
  ownerId:      string;
  status:       PVZStatus;
  tier:         PVZTier;
  currentStep:  WizardStepKey;

  // Основная информация
  name:         string;
  format:       'pickup' | 'postomat_hybrid' | 'showroom';
  phone:        string;
  email:        string;
  workFrom:     string;
  workTo:       string;

  // Адрес / гео
  city:         string;
  address:      string;
  entrance:     string;
  location:     GeoPoint;

  // Документы
  documents:    PVZDocument[];

  // Помещение
  checklist:    ChecklistItem[];
  layout:       PVZLayout | null;
  branding:     BrandingCheck | null;

  // Видео-проверка / ИИ
  inspectionSessionId: string | null;
  aiAnalysisId:        string | null;

  rating:       number;
  capacity:     number;       // вместимость ячеек хранения

  createdAt:    string;
  updatedAt:    string;
  submittedAt:  string | null;
  approvedAt:   string | null;
}

/* ══════════════════════════════════════════════════════════════════
   ФИНАНСЫ
══════════════════════════════════════════════════════════════════ */
export type FinanceOpType = 'income' | 'commission' | 'payout' | 'fine' | 'bonus';

export interface FinanceOp {
  id:        string;
  pvzId:     string;
  type:      FinanceOpType;
  amount:    number;   // всегда положительное, знак определяется типом при суммировании
  comment:   string;
  createdAt: string;
}

/* ══════════════════════════════════════════════════════════════════
   ПЕРСОНАЛ
══════════════════════════════════════════════════════════════════ */
export type StaffPosition = 'manager' | 'operator' | 'storekeeper' | 'security';

export interface Shift {
  id:       string;
  staffId:  string;
  date:     string;      // YYYY-MM-DD
  from:     string;
  to:       string;
  status:   'planned' | 'done' | 'missed';
}

export interface StaffMember {
  id:           string;
  pvzId:        string;
  accountId:    string;
  name:         string;
  username:     string;
  position:     StaffPosition;
  online:       boolean;
  rating:       number;
  servedCount:  number;
  avgIssueTimeSec: number;
  errorsCount:  number;
  createdAt:    string;
}

export interface StaffLogEntry {
  id:        string;
  staffId:   string;
  text:      string;
  createdAt: string;
}

/* ══════════════════════════════════════════════════════════════════
   СКЛАД ПВЗ (ячейки хранения посылок)
══════════════════════════════════════════════════════════════════ */
export type ParcelStatus = 'expected' | 'stored' | 'issued' | 'returned' | 'overdue';

export interface Parcel {
  id:           string;
  pvzId:        string;
  orderCode:    string;
  clientName:   string;
  clientPhone:  string;
  cellId:       string | null;
  status:       ParcelStatus;
  receivedAt:   string | null;
  issuedAt:     string | null;
  dueAt:        string;
  size:         'S' | 'M' | 'L' | 'XL';
}

export interface WarehouseCell {
  id:        string;
  pvzId:     string;
  row:       number;
  col:       number;
  size:      'S' | 'M' | 'L' | 'XL';
  parcelId:  string | null;
}

/* ══════════════════════════════════════════════════════════════════
   ЖАЛОБЫ
══════════════════════════════════════════════════════════════════ */
export type ComplaintStatus = 'new' | 'in_progress' | 'resolved' | 'rejected';

export interface Complaint {
  id:          string;
  pvzId:       string;
  clientName:  string;
  orderCode:   string;
  employeeId:  string | null;
  text:        string;
  photos:      string[];
  videos:      string[];
  status:      ComplaintStatus;
  resolution:  string;
  deadlineAt:  string;
  createdAt:   string;
  resolvedAt:  string | null;
}

/* ══════════════════════════════════════════════════════════════════
   КАМЕРЫ
══════════════════════════════════════════════════════════════════ */
export type CameraEventType = 'queue' | 'suspicious' | 'empty' | 'normal';

export interface CameraDevice {
  id:       string;
  pvzId:    string;
  name:     string;
  zone:     string;
  online:   boolean;
}

export interface CameraEvent {
  id:        string;
  cameraId:  string;
  pvzId:     string;
  type:      CameraEventType;
  text:      string;
  createdAt: string;
  read:      boolean;
}

/* ══════════════════════════════════════════════════════════════════
   ИИ-ЦЕНТР
══════════════════════════════════════════════════════════════════ */
export type AIReportPeriod = 'daily' | 'weekly' | 'monthly';

export interface AIRecommendation {
  id:        string;
  pvzId:     string;
  text:      string;
  priority:  'low' | 'medium' | 'high';
  category:  'staffing' | 'warehouse' | 'service_speed' | 'quality' | 'finance';
  createdAt: string;
  done:      boolean;
}

export interface AIReport {
  id:        string;
  pvzId:     string;
  period:    AIReportPeriod;
  scoreOverall: number;
  summary:   string;
  highlights:string[];
  createdAt: string;
}

/* ══════════════════════════════════════════════════════════════════
   ИСТОРИЯ / АУДИТ
══════════════════════════════════════════════════════════════════ */
export interface HistoryEntry {
  id:         string;
  pvzId:      string | null;  // null = глобальное событие (несколько ПВЗ)
  userId:     string;
  userName:   string;
  ip:         string;
  device:     string;
  action:     string;
  description:string;
  createdAt:  string;
}

/* ══════════════════════════════════════════════════════════════════
   УВЕДОМЛЕНИЯ
══════════════════════════════════════════════════════════════════ */
export type PVZNotificationType = 'moderation' | 'finance' | 'complaint' | 'ai' | 'camera' | 'staff' | 'system';

export interface PVZNotification {
  id:        string;
  pvzId:     string | null;
  type:      PVZNotificationType;
  title:     string;
  text:      string;
  read:      boolean;
  createdAt: string;
}

/* ══════════════════════════════════════════════════════════════════
   АНАЛИТИКА (дневные срезы для графиков)
══════════════════════════════════════════════════════════════════ */
export interface DaySnapshot {
  date:            string;  // YYYY-MM-DD
  revenue:         number;
  profit:          number;
  commission:      number;
  ordersReceived:  number;
  ordersIssued:    number;
  returns:         number;
  overdue:         number;
  visitors:        number;
  avgIssueTimeSec: number;
  avgWaitTimeSec:  number;
  cancelRate:      number;
  returnRate:      number;
}
