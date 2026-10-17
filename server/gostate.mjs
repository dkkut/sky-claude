/**
 * Sky GO — формальная модель состояний заказа. Единственное место, где записано, КАКОЙ статус за каким может идти.
 * Меняет статус только сервер: `gocore.setStatus` сверяется с этой таблицей и отказывает на недопустимом переходе.
 *
 * Каждый переход описан: кто может его запросить (actors), что должно быть выполнено заранее (needs) и что происходит
 * дополнительно (effects) — это справка для разработки и админки; саму проверку условий делают модули (gotaxi, godelivery, gopay).
 *  actors: customer — заказчик, executor — водитель/курьер, system — уборка/тайм-аут, admin — сотрудник Sky (право go).
 *
 * Соответствие терминам ТЗ: searching = searching_driver/searching_courier, assigned = driver_assigned/courier_assigned,
 * en_route = driver_arriving, arrived = driver_arrived, in_ride = trip_started, awaiting_payment/paid = trip_completed
 * (поездка завершена → оплата напрямую водителю), cancelled = cancelled, dispute = спор у администрации, scheduled = заказ «на потом» (ждёт времени).
 * Состояний draft/estimating/awaiting_confirmation в базе нет: это котировка (go_quotes), а не заказ.
 */
const T = (to, actors, needs = '', effects = '') => ({ to, actors, needs, effects });

const TAXI = {
  scheduled: [T('searching', ['system'], 'наступило время начала поиска (за lead минут до поездки)', 'поиск водителя, уведомление'), T('cancelled', ['customer', 'system', 'admin'], 'до начала поиска и после — по обычным правилам отмены')],
  searching: [T('assigned', ['executor', 'admin', 'system'], 'исполнитель одобрен, подписка, на линии, не занят, предложение действует', 'уведомление пассажиру'),
    T('cancelled', ['customer', 'system', 'admin'], '', 'предложения отзываются')],
  assigned: [T('en_route', ['executor'], 'назначенный исполнитель'), T('cancelled', ['customer', 'admin']), T('searching', ['executor', 'system'], 'отказ до начала поездки', 'поиск заново, водитель исключается')],
  en_route: [T('arrived', ['executor']), T('cancelled', ['customer', 'admin']), T('searching', ['executor', 'system'])],
  arrived: [T('in_ride', ['executor']), T('cancelled', ['customer', 'admin']), T('searching', ['executor', 'system'])],
  in_ride: [T('awaiting_payment', ['executor'], 'открыта оплата с зафиксированной ценой', 'реквизиты показаны пассажиру')],
  awaiting_payment: [T('payment_reported', ['customer'], 'пассажир сообщил об оплате')],
  payment_reported: [T('paid', ['executor'], 'получатель денег подтвердил поступление')],
  dispute: [T('paid', ['admin']), T('cancelled', ['admin'])],
  paid: [], cancelled: [],
};

const DELIVERY = {
  scheduled: [T('searching', ['system'], 'наступило время начала поиска', 'поиск курьера, уведомление'), T('cancelled', ['customer', 'system', 'admin'])],
  searching: [T('assigned', ['executor', 'admin', 'system']), T('cancelled', ['customer', 'system', 'admin'])],
  assigned: [T('heading_pickup', ['executor'], 'назначение принято (для заказов организации)'), T('cancelled', ['customer', 'admin']), T('searching', ['executor', 'admin'])],
  heading_pickup: [T('at_pickup', ['executor']), T('cancelled', ['customer', 'admin']), T('searching', ['executor', 'admin'])],
  at_pickup: [T('picked_up', ['executor'], 'код передачи (кроме еды); при оплате «до» — подтверждённая оплата'), T('cancelled', ['customer', 'admin']), T('searching', ['executor', 'admin'])],
  picked_up: [T('delivering', ['executor'])],
  delivering: [T('at_recipient', ['executor'])],
  at_recipient: [T('awaiting_payment', ['executor'], 'код вручения', 'открыта оплата'), T('paid', ['executor'], 'код вручения; оплата подтверждена заранее или исполнитель — сотрудник организации')],
  awaiting_payment: [T('payment_reported', ['customer'])],
  payment_reported: [T('paid', ['executor'])],
  dispute: [T('paid', ['admin']), T('cancelled', ['admin'])],
  paid: [], cancelled: [],
};

/** Любой незавершённый заказ можно оспорить (дальше решает администрация). */
const withDispute = (table) => {
  const out = {};
  for (const [from, list] of Object.entries(table)) {
    const terminal = ['paid', 'cancelled', 'dispute'].includes(from);
    out[from] = terminal ? list : [...list, T('dispute', ['customer', 'executor'], 'причина не короче 5 знаков', 'решает администрация')];
  }
  return out;
};

export const MACHINES = { taxi: withDispute(TAXI), delivery: withDispute(DELIVERY) };

/** Для видов без таблицы (еда, жильё — свои цепочки) проверка не применяется. */
export const hasMachine = (kind) => Boolean(MACHINES[kind]);
export const nextStates = (kind, from) => (MACHINES[kind]?.[from] ?? []).map((t) => t.to);
export const transitionAllowed = (kind, from, to) => {
  const m = MACHINES[kind];
  if (!m) return true;
  if (from === to) return true;   // повтор того же состояния — не переход (идемпотентность)
  return (m[from] ?? []).some((t) => t.to === to);
};
export const terminal = (kind, status) => Boolean(MACHINES[kind]) && (MACHINES[kind][status] ?? []).length === 0;
export const describe = (kind) => Object.entries(MACHINES[kind] ?? {}).flatMap(([from, list]) => list.map((t) => ({ from, ...t })));
