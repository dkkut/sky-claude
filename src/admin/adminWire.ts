/**
 * Разговор панели администратора с сервером.
 *
 * Панель живёт на том же сокете, что и остальной обмен: отдельного
 * соединения ей не нужно, а вот отдельный ответ на каждый запрос —
 * нужен, иначе два одновременных действия перепутают свои ответы.
 * Поэтому здесь на каждый запрос ставится ожидание ответа по типу.
 *
 * Ни одна проверка отсюда не заменяет серверную: этот файл живёт в
 * браузере, а браузер переписывается. Панель рисует то, что разрешил
 * сервер, и просит — решает всё равно он.
 *
 * Чего отсюда не отправляется никогда: своей роли, своих прав, признака
 * владельца. Их присылал бы тот, чьи права мы и проверяем.
 */
import { wireSend } from '@/core/wire';
import { onAdminMessage } from '@/messenger/socket';

/** Права по направлениям. Список ведёт сервер — здесь только подписи. */
export type AdminPermission =
  | 'moderation' | 'support' | 'content' | 'market'
  | 'logistics' | 'tickets' | 'bots' | 'finance' | 'security';

export const PERMISSION_LABEL: Record<AdminPermission, string> = {
  moderation: 'Модерация',
  support: 'Поддержка',
  content: 'Содержимое',
  market: 'Маркет',
  logistics: 'Склады',
  tickets: 'Билеты',
  bots: 'Боты',
  finance: 'Начисления',
  security: 'Безопасность',
};

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Владелец',
  super_admin: 'Полные права',
  security_admin: 'Безопасность',
  moderation_admin: 'Модерация',
  support_admin: 'Поддержка',
  content_admin: 'Содержимое',
  market_admin: 'Маркет и склады',
  tickets_admin: 'Билеты',
  finance_admin: 'Начисления',
  read_only_admin: 'Только чтение',
};

export interface MyRights {
  admin: boolean;
  owner: boolean;
  role: string | null;
  roleLabel: string;
  permissions: AdminPermission[];
  /** Прежний администратор без назначенной роли: права шире нужного. */
  legacy: boolean;
  lockdown: { active: boolean; reason: string; since: string | null };
}

export interface AdminRow {
  id: string;
  username: string;
  name: string;
  role: string;
  legacy: boolean;
  owner: boolean;
  roleSetAt: string | null;
  banned: boolean;
  blocked: boolean;
}

export interface PendingAction {
  id: string;
  kind: string;
  title: string;
  actorId: string;
  actorName?: string;
  targetId: string;
  targetName?: string;
  payload: Record<string, number | string>;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired';
  outcome: string;
  decisionNote: string;
  decidedAt: string | null;
  executedAt: string | null;
  expiresAt: string | null;
  createdAt?: string;
}

export interface LogEntry {
  id: string;
  actorId?: string;
  actorRole?: string;
  targetId?: string;
  targetType: string;
  type: string;
  result: string;
  detail: string;
  createdAt: string;
}

/**
 * Человек глазами модератора.
 *
 * Здесь ровно то, что нужно для решения о запрете: кто это и что с ним
 * уже сделано. Ни почты, ни телефона, ни заметок — для запрета они не
 * нужны, а как сведения о человеке ценны.
 */
export interface Person {
  id: string;
  username: string;
  name: string;
  admin: boolean;
  owner: boolean;
  /** Бан профиля: закрыта одна витрина, другие профили работают. */
  banned: boolean;
  bannedUntil: string | null;
  /** Блокировка учётной записи: закрыт человек целиком. */
  blocked: boolean;
  blockedUntil: string | null;
  blockedReason: string;
  /** Сколько профилей в этой учётной записи. */
  profiles: number;
}

export interface SecurityEvent {
  id: string;
  actorId?: string;
  kind: string;
  detail: string;
  createdAt: string;
}

/**
 * Ответ панели.
 *
 * Поля разные у разных действий, поэтому здесь они все необязательные:
 * читает их тот, кто спрашивал, и знает, что именно спросил. Это
 * честнее общего «что угодно» — видно, чем панель вообще отвечает.
 */
export interface Answer {
  type: string;
  payload: {
    error?: string;
    /** whoami */
    admin?: boolean;
    owner?: boolean;
    role?: string | null;
    roleLabel?: string;
    permissions?: AdminPermission[];
    legacy?: boolean;
    lockdown?: MyRights['lockdown'];
    /** step-up */
    method?: 'app' | 'email';
    expiresIn?: number;
    /** списки */
    admins?: AdminRow[];
    roles?: string[];
    actions?: PendingAction[];
    entries?: LogEntry[];
    events?: SecurityEvent[];
    people?: Person[];
    /** заявка */
    id?: string;
    kind?: string;
    status?: string;
    action?: PendingAction;
    /** аварийный режим */
    active?: boolean;
    since?: string | null;
    /** проверка журнала */
    intact?: boolean;
    checked?: number;
  };
}

/**
 * Один запрос — один ответ.
 *
 * Сокет отвечает сообщением своего типа, а не на конкретный запрос,
 * поэтому ждём первый ответ из числа тех, которыми панель вообще
 * отвечает. Два действия подряд ждать одновременно не нужно: панель
 * этого и не делает.
 */
const ANSWERS = new Set([
  'admin-me', 'admin-done', 'admin-error', 'admin-log', 'admin-pending',
  'admin-pending-list', 'admin-list', 'admin-step-up', 'admin-lockdown',
  'admin-security-events', 'admin-log-verified', 'admin-people',
]);

const waiting: ((a: Answer) => void)[] = [];

onAdminMessage((msg: Answer) => {
  if (!ANSWERS.has(msg.type)) return;
  const next = waiting.shift();
  next?.(msg as Answer);
});

export const adminCall = (payload: Record<string, unknown>, ms = 12_000) =>
  new Promise<Answer>((resolve) => {
    let done = false;
    const finish = (a: Answer) => { if (!done) { done = true; resolve(a); } };
    waiting.push(finish);
    const timer = setTimeout(() => {
      const i = waiting.indexOf(finish);
      if (i >= 0) waiting.splice(i, 1);
      finish({ type: 'admin-error', payload: { error: 'timeout' } });
    }, ms);
    const wrapped = (a: Answer) => { clearTimeout(timer); finish(a); };
    waiting[waiting.indexOf(finish)] = wrapped;
    wireSend({ type: 'admin', payload });
  });

/** Почему сервер отказал — человеческими словами. */
export const ADMIN_ERROR: Record<string, string> = {
  not_allowed: 'Недостаточно прав',
  owner_only: 'Подтвердить может только владелец',
  owner_protected: 'Владелец защищён: это действие к нему неприменимо',
  admin_protected: 'Ограничить администратора вправе только безопасность',
  self_target: 'На самого себя такое действие не оформляется',
  step_up_required: 'Нужно подтвердить личность',
  step_up_invalid: 'Код не подошёл',
  step_up_exhausted: 'Попытки кончились, начните подтверждение заново',
  no_second_factor: 'Нет способа подтвердить личность: включите двухэтапную защиту',
  lockdown: 'Включён аварийный режим: панель закрыта',
  already_decided: 'По этой заявке уже решили',
  payload_tampered: 'Слепок заявки не сходится — выполнять нельзя',
  expired: 'Заявка просрочена',
  bad_amount: 'Сумма должна быть целым числом в допустимых пределах',
  bad_days: 'Срок должен быть целым числом дней',
  bad_role: 'Неизвестная роль',
  bad_kind: 'Неизвестное действие',
  not_found: 'Не найдено',
  account_blocked: 'Учётная запись заблокирована',
  banned: 'Профиль забанен',
  too_many_requests: 'Слишком часто, подождите',
  timeout: 'Сервер не ответил',
};

export const errorText = (code?: string) =>
  ADMIN_ERROR[String(code ?? '')] ?? 'Не получилось';
