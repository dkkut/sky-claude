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
  market_admin:    ['market', 'logistics'],
  tickets_admin:   ['tickets'],
  finance_admin:   ['finance'],
  // 'support' — вместе с решением по заявке на награду (одобрить,
  // отклонить) в тот же тикет уходит объяснение; без права 'support'
  // ответ в чат поддержки молча не доходит (см. support.mjs, staff-
  // проверка в replyToTicket), а отдельного чата у мероприятий нет.
  campaigns_admin: ['campaigns', 'support'],
  gifts_admin:     ['gifts'],
  garant_admin:    ['garant', 'support'],
  notifications_admin: ['notifications'],
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
  tickets_admin: 'Билеты',
  finance_admin: 'Начисления',
  campaigns_admin: 'Мероприятия',
  gifts_admin: 'Подарки',
  garant_admin: 'Sky Garant',
  notifications_admin: 'Рассылки',
  read_only_admin: 'Только чтение',
};
