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
  'blox',            // Sky Blox: игры, серверы, разработчики, ограничения, мониторинг
  'blox_moderation', // Sky Blox: очередь проверки, жалобы, апелляции
  'blox_finance',    // Sky Blox: вознаграждения, возвраты, заявки на выплату
  'analytics',       // мониторинг и аналитика платформы: онлайн, сделки, покупки, здоровье сервера
  'go',              // Sky GO: заявки исполнителей, подписки, заказы, споры, интеграции
  'go_finance',      // Sky GO: тарифы активации и параметры стоимости
];

/**
 * Роли — это наборы прав, а не отдельная сущность.
 *
 * `owner` в этот список не входит: владелец не роль в базе, он выводится
 * из ника в окружении и имеет всё. Роль, которую можно выдать, не должна
 * быть способна дорасти до владельца.
 */
export const ROLES = {
  super_admin:     PERMISSIONS,
  security_admin:  ['security', 'moderation', 'support'],
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
  blox_admin:      ['blox', 'blox_moderation'],
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
  garant_admin:    ['garant', 'support'],
  notifications_admin: ['notifications'],
  // Подтверждение оплаты (создание денег без реального платежа, пока
  // не подключена касса) остаётся за 'finance' и двумя ключами — эта
  // роль только смотрит пользователей и заказы.
  kutrent_market_admin: ['kutrent_market'],
  go_admin:        ['go', 'support'],
  go_finance_staff:['go_finance'],
  read_only_admin: [],
};

export const ROLE_NAMES = Object.keys(ROLES);

export const ROLE_LABEL = {
  super_admin: 'Полные права',
  security_admin: 'Безопасность',
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
  garant_admin: 'Sky Garant',
  notifications_admin: 'Рассылки',
  kutrent_market_admin: 'KutRent Market',
  go_admin: 'Sky GO: администратор',
  go_finance_staff: 'Sky GO: тарифы',
  read_only_admin: 'Только чтение',
};
