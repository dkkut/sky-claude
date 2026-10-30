/** Ручки замка SkyMoney: /api/skyid/money/{status,code,unlock,lock}. Логика — moneyguard.mjs. */
import { json, parseBody, readSession } from './../http.mjs';
import { moneyState, unlockMoney, lockMoney, sendDeviceCode } from './../moneyguard.mjs';
import { recoveryInfo, createPhrase, setExtra } from './../moneyrecovery.mjs';
import { isDeviceTrusted } from './../trusteddevices.mjs';
import { rateLimit } from './../security.mjs';

const CODES = { invalid_phrase: 401, phrase_required: 400, use_phrase: 400, no_phrase: 400, bad_extra: 400, forbidden: 403,  invalid_credentials: 401, password_required: 400, device_code_required: 400, invalid_code: 400, code_expired: 400, too_many_attempts: 429, too_many_requests: 429, too_soon: 429, use_authenticator: 400, no_contact: 400, not_found: 404 };

export const moneyGuardRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/skyid/money/')) return false;
  const s = await readSession(req);
  if (!s) return json(res, 401, { error: 'unauthorized' });
  // Статус — дешёвое чтение, его дёргают экраны кошелька пачками; ввод пароля и кодов ограничен строже.
  if (!rateLimit(`moneyguard:${s.skyId}`, req.method === 'GET' ? 300 : 60)) return json(res, 429, { error: 'rate_limited' });
  // Служебный признак режима «пустой кошелёк» клиенту не отдаётся.
  const pub = ({ decoy: _d, ...rest }) => rest;
  if (req.method === 'GET' && path === '/api/skyid/money/status') return json(res, 200, pub(await moneyState(s.skyId, s.sessionId, req)));
  if (path.startsWith('/api/skyid/money/recovery')) {
    const st = await moneyState(s.skyId, s.sessionId, req);
    if (!st.unlocked) return json(res, 403, { error: 'money_locked' });
    // Видимость для режима «пустой кошелёк» выглядит как у обычной сессии, но менять ничего нельзя.
    const info = st.decoy ? { hasPhrase: true, hasExtra: false } : await recoveryInfo(s.skyId);
    if (req.method === 'GET' && path === '/api/skyid/money/recovery') return json(res, 200, info);
    const real = !st.decoy && await isDeviceTrusted(s.skyId, req).catch(() => false);
    if (!real) return json(res, 403, { error: 'forbidden' });
    if (req.method === 'POST' && path === '/api/skyid/money/recovery/create') return json(res, 200, await createPhrase(s.skyId));
    if (req.method === 'POST' && path === '/api/skyid/money/recovery/extra') {
      const b = (await parseBody(req).catch(() => ({}))) ?? {};
      const r = await setExtra(s.skyId, b.word ?? null); return json(res, r.ok ? 200 : (CODES[r.error] ?? 400), r);
    }
    return json(res, 404, { error: 'not_found' });
  }
  if (req.method === 'POST' && path === '/api/skyid/money/code') { const r = await sendDeviceCode(s.skyId); return json(res, r.ok ? 200 : (CODES[r.error] ?? 400), r); }
  if (req.method === 'POST' && path === '/api/skyid/money/unlock') {
    const b = (await parseBody(req).catch(() => ({}))) ?? {};
    const r = await unlockMoney(s.skyId, s.sessionId, req, { password: b.password, code: b.code, words: b.words, extra: b.extra });
    return json(res, r.ok ? 200 : (CODES[r.error] ?? 400), r.ok ? pub(r) : r);
  }
  if (req.method === 'POST' && path === '/api/skyid/money/lock') return json(res, 200, await lockMoney(s.sessionId));
  return json(res, 404, { error: 'not_found' });
};
