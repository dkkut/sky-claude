/**
 * Sky Tax: классификация операций — чистая функция (ни базы, ни сети), чтобы правила можно было читать и тестировать отдельно.
 *
 * Принцип: доход — только то, что человек заплатил ЗА УСЛУГУ или ТОВАР тому, кто её оказал. Не доход: пополнение внутреннего баланса (деньги человека, услуга ещё не оказана),
 * переводы между своими счетами и обмен, транзитные суммы (эскроу Гаранта), чужие деньги (платформа не получатель), возвраты. Всё, что нельзя определить однозначно, — `review`:
 * решение принимает человек (владелец), и оно записывается в журнал. Это продуктовая политика Sky, а не юридическое заключение; юридическую схему подтверждает бухгалтер/юрист владельца.
 *
 * Кто получатель дохода (поставщик): для услуг Sky, оплаченных с кошелька, — Sky; для платежей людям и организациям напрямую (SkyKassa Business, Sky Market, Sky GO, парковки) — сам продавец:
 * Sky деньги не принимает и поставщиком не является, а только предоставляет инфраструктуру.
 */

/** Услуги Sky, оплачиваемые с кошелька (тип записи кошелька → описание). Списание = оказание услуги = момент дохода Sky. */
export const SKY_INCOME_TYPES = {
  prime: 'Подписка Sky Prime',
  prime_gift: 'Подарок Sky Prime',
  family_prime: 'Sky Prime Family',
  go_sub: 'Подписка исполнителя Sky GO',
  kbiz_sub: 'Подписка Sky для бизнеса',
  launcher_placement: 'Размещение игры в Sky Launcher',
  ads: 'Реклама в Sky Ads',
};
/** Не доход: движение собственных денег человека или транзит. */
export const NOT_INCOME_TYPES = {
  fx_out: ['not_income', 'Обмен валюты внутри SkyMoney: перевод между собственными счетами'],
  fx_in: ['not_income', 'Обмен валюты внутри SkyMoney: перевод между собственными счетами'],
  family_topup: ['not_income', 'Перевод между счетами семьи: движение собственных денег'],
  garant_escrow: ['transit', 'Средства в эскроу Sky Garant: транзит, Sky не получатель'],
  withdrawal: ['not_income', 'Вывод остатка человеку: возврат его собственных денег'],
  skykassa_refund: ['not_income', 'Возврат пополнения человеку'],
};
/** Спорные: поставщика/природу платежа должен подтвердить владелец. */
export const REVIEW_TYPES = {
  nft_purchase: 'Покупка подарка (NFT): продажа платформой или перепродажа между людьми — нужно решение',
  skin_purchase: 'Покупка скина: продавец (Sky или автор) — нужно решение',
};

/**
 * @param {{source: string, kind?: 'sale'|'refund', walletType?: string, direction?: 'in'|'out', fee?: number, isTip?: boolean, internal?: boolean}} op
 * @returns {{classification: 'income'|'not_income'|'transit'|'review', reason: string, docKind: string}}
 */
export const classify = (op, subject) => {
  const status = subject?.tax_status ?? null;
  const docFor = (st) => (st === 'npd' ? 'npd_receipt' : st === 'ip' || st === 'ooo' ? 'fiscal_receipt' : 'none');
  if (op.kind === 'refund') return { classification: 'income', reason: 'Возврат ранее оплаченного: оформляется чек возврата', docKind: docFor(status) };
  if (op.source === 'skykassa_topup') return { classification: 'not_income', reason: 'Пополнение SkyMoney: деньги человека на внутреннем балансе, услуга ещё не оказана — это не доход Sky', docKind: 'confirmation' };
  if (op.source === 'skykassa_fee') return { classification: 'income', reason: 'Комиссия за обработку пополнения — плата за услугу Sky', docKind: docFor(status) };
  if (op.source.startsWith('wallet:')) {
    const t = op.source.slice(7);
    if (Object.hasOwn(SKY_INCOME_TYPES, t)) return { classification: 'income', reason: `${SKY_INCOME_TYPES[t]}: услуга оказана Sky, оплата с кошелька`, docKind: docFor(status) };
    if (Object.hasOwn(NOT_INCOME_TYPES, t)) return { classification: NOT_INCOME_TYPES[t][0], reason: NOT_INCOME_TYPES[t][1], docKind: 'none' };
    if (Object.hasOwn(REVIEW_TYPES, t)) return { classification: 'review', reason: REVIEW_TYPES[t], docKind: docFor(status) };
    return { classification: 'review', reason: `Тип операции «${t}» не описан в правилах — нужно решение`, docKind: docFor(status) };
  }
  if (op.internal) return { classification: 'not_income', reason: 'Операция внутри организации (заказ своего сотрудника): оплаты через Sky нет', docKind: 'none' };
  if (op.source === 'kb_payment') {
    if (op.isTip) return { classification: 'review', reason: 'Чаевые: нужно решение, считать ли их доходом и чьим', docKind: docFor(status) };
    return { classification: 'income', reason: 'Оплата покупателем напрямую продавцу: доход самого продавца (Sky деньги не принимает)', docKind: docFor(status) };
  }
  if (op.source === 'market_order') return { classification: 'income', reason: 'Продажа через Sky Market: продавец — владелец магазина, оплата напрямую ему; Sky — площадка', docKind: docFor(status) };
  if (op.source === 'go_order') return { classification: 'income', reason: 'Оплата исполнителю Sky GO напрямую: доход самого исполнителя', docKind: docFor(status) };
  return { classification: 'review', reason: 'Источник не описан в правилах — нужно решение', docKind: docFor(status) };
};

export const DOC_KIND_LABEL = {
  fiscal_receipt: 'Фискальный кассовый чек (54-ФЗ)', npd_receipt: 'Чек самозанятого (НПД, «Мой налог»)',
  confirmation: 'Подтверждение операции Sky (не фискальный документ)', internal_receipt: 'Внутренняя квитанция Sky (не фискальный документ)', none: 'Документ не требуется',
};
export const STATUS_LABEL = {
  pending_confirm: 'Ожидает подтверждения', queued: 'В очереди на отправку', sending: 'Отправляется', awaiting_provider: 'Ожидает подтверждения от интеграции', awaiting_manual: 'Нужно выдать чек и внести номер',
  issued: 'Документ сформирован', failed: 'Ошибка', rejected: 'Отклонено', not_required: 'Чек не требуется',
};
