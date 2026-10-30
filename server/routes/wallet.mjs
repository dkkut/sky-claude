/**
 * Кошелёк.
 *
 * Владелец операции — активный профиль сессии. Идентификатор из тела
 * запроса не используется: списать с чужого счёта, подменив его,
 * невозможно.
 *
 * Кошелёк принадлежит профилю, а не Sky ID: у второго профиля свой
 * баланс, как и свой Prime.
 */
import { config } from './../config.mjs';
import { sanitizeInput } from './../security.mjs';
import { json, parseBody, requireProfile } from './../http.mjs';
import { wallet } from './../wallet.mjs';

const CLIENT_SPEND_TYPES = new Set(['market', 'music', 'family']);

export const walletRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/wallet')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const uid = session.profileId;

  if (req.method === 'GET' && url === '/api/wallet') {
    return json(res, 200, await wallet.getState(uid));
  }

  // Только два числа — для экранов покупки в других сервисах, пока SkyMoney закрыт замком (moneyguard.mjs). Истории здесь нет.
  if (req.method === 'GET' && url === '/api/wallet/balance') {
    const { balance, points } = await wallet.getState(uid, 0);
    return json(res, 200, { balance, points });
  }

  // Пополнение создаёт деньги, поэтому в обычном режиме закрыто:
  // включать его можно только вместе с настоящим приёмом платежей.
  if (req.method === 'POST' && url === '/api/wallet/topup') {
    if (config.paymentsMode !== 'demo') return json(res, 501, { error: 'payments_not_configured' });
    const body = await parseBody(req);
    const result = await wallet.topUp(uid, body.amount, sanitizeInput(body.method || 'card'));
    return result.error ? json(res, 400, result) : json(res, 200, result);
  }

  // refund и earn-points тоже увеличивают баланс или баллы — тот же гейт:
  // их источники (семейный счёт, активность) пока считаются в браузере.
  if (req.method === 'POST' && url === '/api/wallet/refund') {
    if (config.paymentsMode !== 'demo') return json(res, 501, { error: 'payments_not_configured' });
    const body = await parseBody(req);
    const result = await wallet.refund(uid, body.amount, sanitizeInput(body.desc || 'Возврат'),
                                       body.ref ? sanitizeInput(body.ref) : null);
    return result.error ? json(res, 400, result) : json(res, 200, result);
  }

  if (req.method === 'POST' && url === '/api/wallet/earn-points') {
    if (config.paymentsMode !== 'demo') return json(res, 501, { error: 'payments_not_configured' });
    const body = await parseBody(req);
    const result = await wallet.earnPoints(uid, body.amount, sanitizeInput(body.desc || 'Начисление'));
    return result.error ? json(res, 400, result) : json(res, 200, result);
  }

  if (req.method === 'POST' && url === '/api/wallet/spend') {
    const body = await parseBody(req);
    // Тип операции попадает в историю и в аналитику (покупки Prime, подарков,
    // NFT…). Служебные типы выставляет только сервер своими ручками —
    // клиентскому списанию доступны лишь типы самого интерфейса кошелька.
    const type = String(body.type || 'market');
    if (!CLIENT_SPEND_TYPES.has(type)) return json(res, 400, { error: 'invalid_type' });
    const result = await wallet.spend(
      uid, body.amount, type,
      sanitizeInput(body.desc || ''), body.ref ? sanitizeInput(body.ref) : null,
    );
    return result.error ? json(res, 400, result) : json(res, 200, result);
  }

  if (req.method === 'POST' && url === '/api/wallet/exchange') {
    const body = await parseBody(req);
    const result = await wallet.exchangeToPoints(uid, body.rubles);
    return result.error ? json(res, 400, result) : json(res, 200, result);
  }

  if (req.method === 'POST' && url === '/api/wallet/spend-points') {
    const body = await parseBody(req);
    const result = await wallet.spendPoints(
      uid, body.amount, sanitizeInput(body.desc || ''),
      body.ref ? sanitizeInput(body.ref) : null,
    );
    return result.error ? json(res, 400, result) : json(res, 200, result);
  }

  return json(res, 404, { error: 'not_found' });
};
