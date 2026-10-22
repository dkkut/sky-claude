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
  | 'logistics' | 'tickets' | 'bots' | 'finance' | 'security' | 'campaigns' | 'gifts' | 'garant'
  | 'notifications' | 'kutrent_market' | 'violations' | 'codes' | 'seller_docs' | 'market_moderation' | 'pvz_manage' | 'blox' | 'blox_moderation' | 'blox_finance' | 'analytics' | 'go' | 'go_finance' | 'registration' | 'global_block' | 'site' | 'modules' | 'skykassa' | 'skykassa_settings' | 'storage_view' | 'storage_audit' | 'storage_backup' | 'storage_schedule' | 'storage_restore' | 'storage_quota' | 'storage_access' | 'storage_emergency' | 'storage_enable' | 'storage_unlock' | 'storage_keys' | 'storage_maintenance' | 'oidc' | 'prime' | 'partners' | 'partners_approve' | 'kassa_biz' | 'upload_limits' | 'verification' | 'logs' | 'parking' | 'parking_moderation' | 'go_places';

export const PERMISSION_LABEL: Record<AdminPermission, string> = {
  moderation: 'Модерация',
  support: 'Поддержка',
  content: 'Содержимое',
  market: 'Маркет',
  logistics: 'Склады и курьеры',
  tickets: 'Билеты',
  bots: 'Боты',
  finance: 'Начисления',
  security: 'Безопасность',
  campaigns: 'Мероприятия',
  gifts: 'Подарки',
  garant: 'Sky Garant',
  notifications: 'Рассылки',
  kutrent_market: 'KutRent Market',
  violations: 'Нарушения и штрафы',
  codes: 'Sky Codes',
  seller_docs: 'Проверка продавцов',
  market_moderation: 'Модерация Market',
  pvz_manage: 'Заявки ПВЗ',
  blox: 'Sky Blox',
  blox_moderation: 'Модерация Sky Blox',
  blox_finance: 'Финансы Sky Blox',
  analytics: 'Мониторинг и аналитика',
  go: 'Sky GO',
  go_finance: 'Тарифы Sky GO',
  registration: 'Регистрация аккаунтов',
  global_block: 'Глобальная блокировка',
  parking: 'Sky Parking: организации и сбои',
  parking_moderation: 'Sky Parking: проверка заявок',
  go_places: 'Sky GO: организации',
  site: 'Сайт (скачивание, статус, апелляции)',
  modules: 'Закрытие модулей',
  skykassa: 'SkyKassa: проверка платежей',
  skykassa_settings: 'SkyKassa: способы, реквизиты, партнёры',
  oidc: 'Sky ID для сервисов (клиенты и ключи)',
  prime: 'Sky Prime (кэшбэк и награды)',
  partners: 'Партнёры (добавление и правка)',
  partners_approve: 'Партнёры (подтверждение и публикация)',
  kassa_biz: 'SkyKassa Business (бизнесы, приостановка)',
  upload_limits: 'Лимиты загрузки (личные и публичные)',
  verification: 'Верификация (заявки, отметки, критерии)',
  logs: 'Журналы (события Sky, выгрузка, хранение)',
  storage_view: 'Sky Storage: состояние и статистика',
  storage_audit: 'Sky Storage: журнал безопасности',
  storage_backup: 'Sky Storage: резервные копии',
  storage_schedule: 'Sky Storage: расписание копирования',
  storage_restore: 'Sky Storage: восстановление (критично)',
  storage_quota: 'Sky Storage: квоты и политики',
  storage_access: 'Sky Storage: подтверждение подключений',
  storage_emergency: 'Sky Storage: аварийное отключение (критично)',
  storage_enable: 'Sky Storage: включение (критично)',
  storage_unlock: 'Sky Storage: снятие ограничений (критично)',
  storage_keys: 'Sky Storage: ключи (критично)',
  storage_maintenance: 'Sky Storage: технические работы',
};

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Владелец',
  super_admin: 'Полные права',
  security_admin: 'Безопасность',
  parking_admin: 'Sky Parking: администратор',
  parking_moderator: 'Sky Parking: модератор',
  go_places_admin: 'Sky GO: организации (управление)',
  go_places_moderator: 'Sky GO: организации (модерация)',
  moderation_admin: 'Модерация',
  support_admin: 'Поддержка',
  content_admin: 'Содержимое',
  market_admin: 'Маркет и склады',
  docs_reviewer: 'Проверка документов продавцов',
  market_moderator: 'Модерация Market',
  pvz_manager: 'Управление ПВЗ',
  blox_admin: 'Sky Blox: администратор',
  blox_moderator: 'Sky Blox: модератор',
  blox_finance_staff: 'Sky Blox: финансы',
  tickets_admin: 'Билеты',
  bots_admin: 'Боты',
  finance_admin: 'Начисления',
  campaigns_admin: 'Мероприятия',
  gifts_admin: 'Подарки',
  site_admin: 'Сайт',
  upload_limits_admin: 'Лимиты загрузки',
  verification_admin: 'Верификация',
  modules_admin: 'Закрытие модулей',
  skykassa_staff: 'SkyKassa: проверка платежей',
  skykassa_admin: 'SkyKassa: платежи и настройки',
  storage_viewer: 'Sky Storage: просмотр',
  storage_operator: 'Sky Storage: оператор (копии, квоты)',
  storage_security: 'Sky Storage: безопасность и доступ',
  garant_admin: 'Sky Garant',
  notifications_admin: 'Рассылки',
  kutrent_market_admin: 'KutRent Market',
  go_admin: 'Sky GO: администратор',
  go_finance_staff: 'Sky GO: тарифы',
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
  /** Включён ли второй фактор у этой учётной записи прямо сейчас. */
  twoFactor: boolean;
  /** Срок, после которого без второго фактора прав не остаётся. */
  twoFactorDue: string | null;
  /** Срок наступил, а второго фактора нет — permissions уже пуст, это
      только объяснение почему. */
  twoFactorRequired: boolean;
  /** Вход в панель ещё не подтверждён ссылкой с почты и кодом аутентификатора — прав пока нет. */
  gateRequired?: boolean;
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
    twoFactor?: boolean;
    twoFactorDue?: string | null;
    twoFactorRequired?: boolean;
    gateRequired?: boolean;
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
  'admin-pending-list', 'admin-user-money', 'admin-list', 'admin-step-up', 'admin-lockdown',
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
  bad_video: 'Неизвестный ролик',
  video_owner_mismatch: 'Ролик принадлежит не тому человеку, кто указан в заявке',
  grant_target_mismatch: 'Заявка на награду принадлежит другому человеку',
  not_found: 'Не найдено',
  reason_required: 'Укажите основание (не короче 5 знаков)',
  bad_tx: 'Неверный номер операции',
  bad_gift: 'Неверный номер подарка',
  not_reversible: 'Эту операцию откатить нельзя',
  already_reversed: 'Операция уже отменена',
  reverse_insufficient_funds: 'Откатить нельзя: у человека уже нет этих денег на счёте',
  reverse_insufficient_points: 'Откатить нельзя: у человека уже нет этих баллов',
  insufficient_funds: 'На счёте человека не хватает денег для списания',
  insufficient_points: 'У человека не хватает баллов для списания',
  no_active_prime: 'У человека нет действующего Prime',
  no_family: 'У человека нет активной семьи',
  already_cancelled: 'Подарок уже отозван',
  gift_target_mismatch: 'Подарок отправил другой человек',
  account_blocked: 'Учётная запись заблокирована',
  banned: 'Профиль забанен',
  too_many_requests: 'Слишком часто, подождите',
  timeout: 'Сервер не ответил',
};

export const errorText = (code?: string) =>
  ADMIN_ERROR[String(code ?? '')] ?? 'Не получилось';
