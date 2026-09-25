/**
 * Калитка закрытой беты.
 *
 * Верный ключ обменивается на подписанную куку — вводить его на каждой
 * странице не нужно. Сам ключ в браузере не сохраняется: кука подписана
 * сервером и без его подписи ничего не значит.
 */
import { config } from './../config.mjs';
import { signToken } from './../security.mjs';
import { json, parseBody, appBody } from './../http.mjs';
import { buildBetaCookie } from './../cookies.mjs';
import { betaEnabled, checkBetaKey } from './../beta.mjs';

export const betaRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/beta')) return false;

  if (req.method === 'GET' && url === '/api/beta/status') {
    return json(res, 200, { required: betaEnabled() });
  }

  if (req.method === 'POST' && url === '/api/beta/unlock') {
    if (!betaEnabled()) return json(res, 200, { ok: true, required: false });

    const body = await parseBody(req);
    const found = await checkBetaKey(body.key);
    // Ответ одинаков для любого неверного ключа: по тексту ошибки
    // не понять, насколько близко подобрано.
    if (!found) return json(res, 401, { error: 'invalid_beta_key' });

    // Отпечаток ключа кладём в пропуск: отозвали ключ — вместе с ним
    // перестают действовать и выданные по нему пропуска.
    const token = signToken({ typ: 'beta', k: found.hash }, config.jwtSecret, config.betaTtlSec);
    // Родному приложению кука ни к чему — оно живёт на своём origin и
    // носит пропуск в заголовке X-Sky-Beta (см. betaAllowed в server.mjs),
    // поэтому получает сырой токен в теле, а не только в куке.
    return json(res, 200, appBody(req, { ok: true }, { betaToken: token }), {
      'Set-Cookie': buildBetaCookie(token, config.betaTtlSec),
    });
  }

  return json(res, 404, { error: 'not_found' });
};
