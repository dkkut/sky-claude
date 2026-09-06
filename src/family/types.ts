/* ===========================================================
   SKY FAMILY  —  общие типы
=========================================================== */

export type FamilyRole = 'owner'|'adult'|'teen'|'child'|'guest';

export interface FamilyMember {
  id: string;            // = accountId для реальных участников, либо синтетический для детей без входа
  accountId?: string;    // привязка к реальному аккаунту Sky, если есть
  name: string;
  avatarColor: string;
  role: FamilyRole;
  joinedAt: string;
  points: number;             // личный вклад в семейный рейтинг баллов
  dailyLimit?: number;        // лимит трат/переводов в день (для child/teen)
  weeklyLimit?: number;
  monthlyLimit?: number;
  maxTransfer?: number;       // максимальная разовая сумма перевода
  canWithdraw: boolean;       // может выводить/переводить с семейного счёта
  canDepositOnly: boolean;    // разрешено только пополнение
  requireApprovalOver?: number; // сумма, свыше которой нужно подтверждение второго взрослого
  permissions?: Partial<Record<PermissionKey, boolean>>;
}

export type FamilyTxKind = 'topup'|'withdraw'|'transfer_in'|'transfer_out'|'goal_contribute'|'spend';

export interface FamilyTx {
  id: string;
  memberId: string;
  memberName: string;
  kind: FamilyTxKind;
  amount: number;      // всегда положительное; знак определяется kind
  desc: string;
  createdAt: string;
  approvedBy?: string; // если требовалось подтверждение
}

export type AutoTopupFreq = 'off'|'daily'|'weekly'|'monthly'|'on_income';

export interface FamilyGoal {
  id: string;
  title: string;
  emoji: string;
  targetAmount: number;
  savedAmount: number;
  deadline?: string;
  createdBy: string;
  createdAt: string;
  contributors: string[]; // memberIds
  achieved?: boolean;
}

export interface ApprovalRequest {
  id: string;
  memberId: string;
  memberName: string;
  kind: 'purchase'|'transfer'|'withdraw';
  itemTitle: string;
  amount: number;
  reason?: string;
  category?: string;
  status: 'pending'|'approved'|'denied'|'auto_approved';
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface FamilyAchievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
  unlocked: boolean;
  unlockedAt?: string;
  reward: string; // текстовое описание награды (тема/рамка/бейдж)
}

export interface ActivityItem {
  id: string;
  memberId: string;
  memberName: string;
  text: string;
  icon: string;
  createdAt: string;
}

export const CASHBACK_TIERS = [
  { min: 0,     pct: 3  },
  { min: 5000,  pct: 5  },
  { min: 15000, pct: 7  },
  { min: 50000, pct: 10 },
];

export const ROLE_LABEL: Record<FamilyRole, string> = {
  owner: 'Владелец семьи', adult: 'Взрослый', teen: 'Подросток', child: 'Ребёнок', guest: 'Гость',
};

export interface FamilyShoppingItem {
  id: string;
  title: string;
  price?: number;
  store?: string;
  assignedTo?: string; // memberId
  addedBy: string;
  bought: boolean;
  createdAt: string;
}

export type CalendarEventKind = 'birthday'|'trip'|'holiday'|'reminder'|'bill'|'event';

export interface FamilyCalendarEvent {
  id: string;
  title: string;
  kind: CalendarEventKind;
  date: string;      // ISO date
  note?: string;
  createdBy: string;
  createdAt: string;
}

export interface SOSAlert {
  id: string;
  memberId: string;
  memberName: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
}

export const CALENDAR_KIND_LABEL: Record<CalendarEventKind, string> = {
  birthday:'День рождения', trip:'Поездка', holiday:'Праздник', reminder:'Напоминание', bill:'Оплата счёта', event:'Событие',
};
export const CALENDAR_KIND_ICON: Record<CalendarEventKind, string> = {
  birthday:'🎂', trip:'✈️', holiday:'🎉', reminder:'⏰', bill:'💳', event:'📅',
};

export interface MemberLocation {
  memberId: string;
  point: { x: number; y: number };
  battery: number;      // 0-100
  updatedAt: string;
  atHome: boolean;
  sharing: boolean;      // согласие на передачу геопозиции
}

export type AllowanceFreq = 'weekly'|'monthly';
export interface Allowance {
  memberId: string;
  amount: number;
  freq: AllowanceFreq;
  nextPayoutAt: string;
  active: boolean;
}

export type SafeItemKind = 'document'|'photo'|'password'|'note';
export type SafeVisibility = 'owner'|'adults'|'everyone';
export interface SafeItem {
  id: string;
  kind: SafeItemKind;
  title: string;
  content: string;   // текст заметки / логин-пароль в виде текста / описание документа
  visibility: SafeVisibility;
  ownerId: string;
  createdAt: string;
}

export interface TimeCapsule {
  id: string;
  title: string;
  message: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  unlockAt: string;
  opened: boolean;
}

export type PermissionKey =
  | 'makePurchases' | 'buyAdultContent' | 'becomeSeller' | 'transferToOthers'
  | 'giftExpensiveNFT' | 'registerNewDevices' | 'loginUnknownDevices'
  | 'changePhoneNumber' | 'deleteAccount' | 'nightMode' | 'disableLocationSharing';

export interface PermissionDef { key: PermissionKey; label: string; defaultChild: boolean; defaultTeen: boolean; }
export const PERMISSIONS: PermissionDef[] = [
  { key:'makePurchases',        label:'Совершать покупки',                  defaultChild:false, defaultTeen:true  },
  { key:'buyAdultContent',      label:'Покупать товары категории 18+',      defaultChild:false, defaultTeen:false },
  { key:'becomeSeller',         label:'Создавать профиль продавца',         defaultChild:false, defaultTeen:false },
  { key:'transferToOthers',     label:'Переводить другим пользователям',    defaultChild:false, defaultTeen:true  },
  { key:'giftExpensiveNFT',     label:'Дарить дорогие NFT-подарки',         defaultChild:false, defaultTeen:false },
  { key:'registerNewDevices',   label:'Регистрировать новые устройства',    defaultChild:false, defaultTeen:true  },
  { key:'loginUnknownDevices',  label:'Вход с неизвестных устройств',       defaultChild:false, defaultTeen:false },
  { key:'changePhoneNumber',    label:'Менять номер телефона',              defaultChild:false, defaultTeen:false },
  { key:'deleteAccount',        label:'Удалять аккаунт',                    defaultChild:false, defaultTeen:false },
  { key:'nightMode',            label:'Пользоваться приложением ночью (23:00–07:00)', defaultChild:false, defaultTeen:true },
  { key:'disableLocationSharing', label:'Отключать передачу геопозиции',    defaultChild:false, defaultTeen:false },
];

export const AVATAR_COLORS = ['#4f6ef7','#8b5cf6','#ec4899','#f59e0b','#22c55e','#06b6d4','#ef4444','#a78bfa'];

export interface ChecklistItem { id: string; text: string; done: boolean; }
export interface TripPlan {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget?: number;
  checklist: ChecklistItem[];
  notes: string;
  createdBy: string;
  createdAt: string;
}

export interface PrimeFamilyPlan { id: string; label: string; price: number; days: number; sub?: string; popular?: boolean; }
export const PRIME_FAMILY_PLANS: PrimeFamilyPlan[] = [
  { id:'month', label:'Месяц', price:599,  days:30 },
  { id:'year',  label:'Год',   price:4990, days:365, sub:'Экономия 2198₽', popular:true },
];
