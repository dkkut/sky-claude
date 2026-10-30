/**
 * Роли и права администраторов — только таблица, без поведения.
 *
 * Отдельным файлом, потому что спрашивать право должны все модули, а
 * adminsec.mjs тянет за собой кошелёк, почту и Prime. Ставить весь этот
 * груз в зависимость музыке ради одного списка строк — значит замкнуть
 * половину сервера друг на друга. Здесь нет ни одного импорта, и это
 * главное свойство файла.
 */

/**
 * Права по направлениям.
 *
 * Список намеренно короткий: право, которое ничего не закрывает, — это
 * запись в таблице, а не защита. Каждое здесь что-то решает.
 */
export const PERMISSIONS = [
  'moderation',      // баны, немота, заметки о людях
  'support',         // очередь обращений
  'content',         // музыка, кино, телевидение, подкасты
  'market',          // магазины, товары, перевозчики, пункты выдачи
  'logistics',       // склады, видеообзоры помещений
  'tickets',         // мероприятия и билеты Sky Tickets
  'bots',            // боты
  'finance',         // начисления денег и Prime
  'security',        // роли, права, журнал, аварийный режим
  'campaigns',       // мероприятия с наградой (не Sky Tickets — другая сущность)
  'gifts',           // каталог Sky Gifts, медиа подарков и карточки Prime, надзор за NFT
  'garant',          // сделки Sky Garant, споры и решения по ним
  'notifications',   // рассылки: создание, планирование, отмена, история
  'kutrent_market',  // KutRent Market: пользователи, заказы, поиск по Authenticator
  'violations',      // нарушения и штрафы Market/Warehouse/PVZ, регламент, апелляции
  'codes',           // Sky Codes: серии, коды, журнал; отзыв. Создаёт серии только владелец
  'seller_docs',     // заявки продавцов: проверка документов, запрос исправлений
  'market_moderation', // карточки товаров и жалобы Market
  'pvz_manage',      // заявки на открытие ПВЗ
  'parking',         // Sky Parking: организации, приостановка, обзор
  'parking_moderation', // Sky Parking: проверка карточек парковок
  'blox',            // Sky Blox: игры, серверы, разработчики, ограничения, мониторинг
  'blox_moderation', // Sky Blox: очередь проверки, жалобы, апелляции
  'launcher',        // Sky Launcher: серверы GTA V/Minecraft, каталог игр, сборки, настройки
  'launcher_moderation', // Sky Launcher: заявки на размещение игр, возвраты, блокировка сборок
  'blox_finance',    // Sky Blox: вознаграждения, возвраты, заявки на выплату
  'analytics',       // мониторинг и аналитика платформы: онлайн, сделки, покупки, здоровье сервера
  'go',              // Sky GO: заявки исполнителей, подписки, заказы, споры, интеграции
  'go_finance',      // Sky GO: тарифы активации и параметры стоимости
  'go_places',       // Sky GO «Организации»: категории, проверка и публикация карточек, блокировка, журнал
  'registration',    // ограничение регистрации новых аккаунтов: вкл/выкл, пределы, сообщение
  'modules',         // закрытие модулей: баннер «Сервис временно недоступен» вместо раздела или сервиса
  'skykassa',        // SkyKassa: проверка заявок на пополнение (зачисляет только владелец)
  'skykassa_settings', // SkyKassa: способы оплаты, реквизиты, партнёры, параметры
  'storage_view',    // Sky Storage: состояние, статистика
  'storage_audit',   // Sky Storage: журнал безопасности и подключений
  'storage_backup',  // Sky Storage: запуск и просмотр резервных копий
  'storage_schedule',// Sky Storage: расписание копирования
  'storage_restore', // Sky Storage: восстановление данных (критично)
  'storage_quota',   // Sky Storage: квоты, пороги и политики
  'storage_access',  // Sky Storage: подтверждение подключений
  'storage_emergency', // Sky Storage: аварийное отключение и ограничения (критично)
  'storage_enable',  // Sky Storage: включение хранилища после отключения (критично)
  'storage_unlock',  // Sky Storage: снятие ограничений безопасности (критично)
  'storage_keys',    // Sky Storage: ключи и безопасная конфигурация (критично)
  'storage_direct',  // Sky Storage: прямой доступ к хранилищу через S3-шлюз после подтверждения владельцем (критично)
  'storage_maintenance', // Sky Storage: режим технических работ
  'oidc',            // Sky ID для сторонних сервисов: клиенты, адреса возврата, ключи подписи (создание/смена секретов — с подтверждением личности)
  'partners',        // Партнёры: черновики, редактирование, отправка на проверку (внутренние контакты видны)
  'global_block',    // Глобальная блокировка: по устройству/адресу/почте/номеру и связанным аккаунтам, апелляции (критично, в «полные права» не входит)
  'kassa_biz',       // SkyKassa Business: список бизнесов, приостановка и возобновление
  'partners_approve',// Партнёры: подтверждение, приостановка, архив — отдельное право, в «полные права» не входит
  'prime',           // Sky Prime: правила кэшбэка, каталог наград, очередь выдачи наград (изменения — с подтверждением личности)
  'logs',            // единые журналы Sky: поиск, фильтры, выгрузка, сроки хранения, DEBUG, проверка целостности (без секретов и содержимого сообщений)
  'verification',    // верификация: очередь заявок, решения, снятие отметок, критерии (отметка «Официальный» — только владелец)
  'upload_limits',   // лимиты загрузки: личная коллекция и публикация (размер, число, объём, форматы, длительность, скорость)
  'sandbox',         // Sky Sandbox: сборки на проверку, отчёты, повторный запуск (публиковать нельзя)
  'sandbox_publish', // Sky Sandbox: одобрение публикации проверенной сборки на боевой сервер (критично, в «полные права» не входит)
  'email_comms',     // Email-коммуникации: рассылки, шаблоны писем, адресная отправка, журнал отправок
  'server_ops',      // Sky Ops: диагностика сервера, «починить всё», деплой, сборка приложений из админки (критично, в «полные права» не входит)
  'site',            // сайт: ссылки, скачивание (файлы приложений), статус сервисов, апелляции и заявки на релиз с сайта
];

/**
 * Роли — это наборы прав, а не отдельная сущность.
 *
 * `owner` в этот список не входит: владелец не роль в базе, он выводится
 * из ника в окружении и имеет всё. Роль, которую можно выдать, не должна
 * быть способна дорасти до владельца.
 */
/**
 * Критические права Sky Storage не входят в «полные права» роли и в права прежнего администратора без роли:
 * они у владельца и выдаются отдельными ролями осознанно. Сверх того каждое такое действие требует подтверждения
 * личности (одноразовый код), а часть — только владельца.
 */
export const STORAGE_CRITICAL = ['storage_restore', 'storage_emergency', 'storage_enable', 'storage_unlock', 'storage_keys', 'storage_direct'];
/** Подтверждение партнёров — тоже отдельное право: добавлять может менеджер, публиковать — только уполномоченный (или владелец). */
export const DEFAULT_ADMIN_PERMISSIONS = PERMISSIONS.filter((p) => !STORAGE_CRITICAL.includes(p) && p !== 'partners_approve' && p !== 'global_block' && p !== 'sandbox_publish' && p !== 'server_ops');

export const ROLES = {
  super_admin:     DEFAULT_ADMIN_PERMISSIONS,
  security_admin:  ['security', 'moderation', 'support', 'registration', 'logs'],
  moderation_admin:['moderation', 'support'],
  support_admin:   ['support'],
  content_admin:   ['content'],
  market_admin:    ['market', 'logistics', 'violations', 'seller_docs', 'market_moderation', 'pvz_manage'],
  // Сотрудник проверки документов: смотрит заявки и документы, просит
  // исправления; одобрять и отклонять заявки, приостанавливать магазины
  // и менять правила допуска он не может — это право 'market'.
  docs_reviewer:   ['seller_docs'],
  market_moderator:['market_moderation'],
  pvz_manager:     ['pvz_manage'],
  parking_admin:   ['parking', 'parking_moderation'],
  parking_moderator:['parking_moderation'],
  blox_admin:      ['blox', 'blox_moderation'],
  launcher_admin:  ['launcher', 'launcher_moderation'],
  blox_moderator:  ['blox_moderation'],
  blox_finance_staff: ['blox_finance'],
  tickets_admin:   ['tickets'],
  bots_admin:      ['bots'],
  finance_admin:   ['finance', 'codes'],
  // 'support' — вместе с решением по заявке на награду (одобрить,
  // отклонить) в тот же тикет уходит объяснение; без права 'support'
  // ответ в чат поддержки молча не доходит (см. support.mjs, staff-
  // проверка в replyToTicket), а отдельного чата у мероприятий нет.
  campaigns_admin: ['campaigns', 'support'],
  gifts_admin:     ['gifts'],
  site_admin:      ['site'],
  upload_limits_admin: ['upload_limits'],
  verification_admin: ['verification'],
  oidc_admin:      ['oidc'],
  prime_admin:     ['prime'],
  kassa_biz_admin: ['kassa_biz', 'support'],
  partners_manager:['partners'],
  partners_approver:['partners', 'partners_approve'],
  ops_admin:       ['server_ops'],
  email_admin:     ['email_comms'],
  sandbox_admin:   ['sandbox'],
  sandbox_publisher:['sandbox', 'sandbox_publish'],
  global_block_admin:['global_block'],
  storage_viewer:  ['storage_view', 'storage_audit'],
  storage_operator:['storage_view', 'storage_audit', 'storage_backup', 'storage_schedule', 'storage_quota', 'storage_maintenance'],
  storage_security:['storage_view', 'storage_audit', 'storage_access', 'storage_emergency', 'storage_enable'],
  skykassa_staff:  ['skykassa', 'support'],
  skykassa_admin:  ['skykassa', 'skykassa_settings', 'support'],
  modules_admin:   ['modules'],
  garant_admin:    ['garant', 'support'],
  notifications_admin: ['notifications'],
  // Подтверждение оплаты (создание денег без реального платежа, пока
  // не подключена касса) остаётся за 'finance' и двумя ключами — эта
  // роль только смотрит пользователей и заказы.
  kutrent_market_admin: ['kutrent_market'],
  go_admin:        ['go', 'support'],
  go_finance_staff:['go_finance'],
  go_places_admin: ['go_places'],
  go_places_moderator: ['go_places'],
  read_only_admin: [],
};

export const ROLE_NAMES = Object.keys(ROLES);

export const ROLE_LABEL = {
  super_admin: 'Полные права',
  modules_admin: 'Закрытие модулей',
  site_admin: 'Сайт',
  upload_limits_admin: 'Лимиты загрузки',
  verification_admin: 'Верификация',
  oidc_admin: 'Sky ID для сервисов',
  prime_admin: 'Sky Prime: кэшбэк и награды',
  kassa_biz_admin: 'SkyKassa Business: бизнесы',
  partners_manager: 'Партнёры: добавление и правка',
  partners_approver: 'Партнёры: подтверждение и публикация',
  sandbox_admin: 'Sky Sandbox: проверка сборок',
  sandbox_publisher: 'Sky Sandbox: проверка и одобрение публикации',
  ops_admin: 'Sky Ops: сервер, деплой и сборка приложений',
  email_admin: 'Email-коммуникации',
  global_block_admin: 'Глобальная блокировка',
  storage_viewer: 'Sky Storage: просмотр',
  storage_operator: 'Sky Storage: оператор (копии, квоты)',
  storage_security: 'Sky Storage: безопасность и доступ',
  skykassa_staff: 'SkyKassa: проверка платежей',
  skykassa_admin: 'SkyKassa: платежи и настройки',
  security_admin: 'Безопасность',
  moderation_admin: 'Модерация',
  support_admin: 'Поддержка',
  content_admin: 'Содержимое',
  market_admin: 'Маркет и склады',
  docs_reviewer: 'Проверка документов продавцов',
  market_moderator: 'Модерация Market',
  pvz_manager: 'Управление ПВЗ',
  parking_admin: 'Sky Parking: администратор',
  parking_moderator: 'Sky Parking: модератор',
  blox_admin: 'Sky Blox: администратор',
  launcher_admin: 'Sky Launcher: администратор',
  blox_moderator: 'Sky Blox: модератор',
  blox_finance_staff: 'Sky Blox: финансы',
  tickets_admin: 'Билеты',
  bots_admin: 'Боты',
  finance_admin: 'Начисления',
  campaigns_admin: 'Мероприятия',
  gifts_admin: 'Подарки',
  garant_admin: 'Sky Garant',
  notifications_admin: 'Рассылки',
  kutrent_market_admin: 'KutRent Market',
  go_admin: 'Sky GO: администратор',
  go_finance_staff: 'Sky GO: тарифы',
  go_places_admin: 'Sky GO: организации (управление)',
  go_places_moderator: 'Sky GO: организации (модерация)',
  read_only_admin: 'Только чтение',
};
