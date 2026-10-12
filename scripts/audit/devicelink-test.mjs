// Вход на ТВ/консоли/в машине по QR и коду (server/devicelink.mjs).
//   (. env.sh; node scripts/audit/devicelink-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { generateSecret, currentTotp } = await import('../../server/totp.mjs');
const { encryptSecret } = await import('../../server/crypto.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
let n = 0;
const post = (p, b, tok, ua, ip) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}), headers: { 'x-real-ip': ip ?? (p.endsWith('/start') ? `203.0.113.${5 + ++n}` : '203.0.113.5'), ...(ua ? { 'user-agent': ua } : {}) } }, tok);
const PS5 = 'Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15';

const me = await mkuser(S, 'dlA'), other = await mkuser(S, 'dlB');
const sky = (u) => q(`select sky_id from profiles where id='${u.pid}'`);

// ── Устройство просит код
let r = await post('/api/auth/link/start', { kind: 'console', label: 'Гостиная' }, null, PS5);
t('устройство получило код, ключ, проверочное число', r.status === 201 && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.data.code) && r.data.pollKey && /^\d{2}$/.test(r.data.verify), JSON.stringify(r.data));
const d1 = r.data;
t('в QR — ссылка с кодом', r.data.url.includes('/link?code=' + d1.code.replace('-', '')));
t('в базе нет ни кода, ни ключа опроса, ни числа открытым текстом',
  !q(`select code_hash||poll_hash||verify_hash from device_links where id='${d1.id}'`).includes(d1.code.replace('-', '')) &&
  !q(`select poll_hash from device_links where id='${d1.id}'`).includes(d1.pollKey));
r = await post('/api/auth/link/poll', { id: d1.id, pollKey: d1.pollKey });
t('пока не подтверждено — ждём, сессии нет', r.status === 200 && r.data.status === 'pending' && !r.data.session);
r = await post('/api/auth/link/poll', { id: d1.id, pollKey: 'чужой' });
t('чужой ключ опроса не принимается', r.status === 404);

// ── Телефон смотрит
r = await post('/api/skyid/link/lookup', { code: d1.code });
t('без входа телефон код смотреть не может', r.status === 401);
r = await post('/api/skyid/link/lookup', { code: 'AAAA-AAAA' }, me.tok);
t('несуществующий код — not_found', r.status === 404);
r = await post('/api/skyid/link/lookup', { code: d1.code.toLowerCase().replace('-', ' ') }, me.tok);
t('код читается без дефиса и в нижнем регистре', r.status === 200 && r.data.device.id === d1.id, JSON.stringify(r.data));
t('телефон видит всё об устройстве: тип, модель, ОС, адрес, время', r.data.device.kind === 'console' && r.data.device.model === 'PlayStation 5' && r.data.device.label === 'Гостиная' && /^203\.0\.113\./.test(r.data.device.ip) && r.data.device.requestedAt && r.data.device.expiresAt && r.data.device.ua.includes('PlayStation'), JSON.stringify(r.data.device));
t('проверочное число телефону НЕ отдаётся', !JSON.stringify(r.data).includes(`"${d1.verify}"`) && r.data.device.verify === undefined);
r = await post('/api/auth/link/poll', { id: d1.id, pollKey: d1.pollKey });
t('устройство видит, что код отсканирован', r.data.status === 'pending' && r.data.scanned === true);

// ── Подтверждение
r = await post('/api/skyid/link/decide', { id: d1.id, approve: true }, me.tok);
t('без проверочного числа подтвердить нельзя', r.status === 400 && r.data.error === 'bad_verify');
const wrong = d1.verify === '00' ? '01' : '00';
r = await post('/api/skyid/link/decide', { id: d1.id, approve: true, verify: wrong }, me.tok);
t('неверное число — отказ, осталось 2 попытки', r.status === 400 && r.data.error === 'wrong_verify' && r.data.attemptsLeft === 2);
r = await post('/api/skyid/link/decide', { id: d1.id, approve: true, verify: wrong }, me.tok);
r = await post('/api/skyid/link/decide', { id: d1.id, approve: true, verify: wrong }, me.tok);
t('третья ошибка гасит запрос', r.data.error === 'exhausted' && r.status === 410, JSON.stringify(r.data));
r = await post('/api/skyid/link/decide', { id: d1.id, approve: true, verify: d1.verify }, me.tok);
t('погасший запрос уже не подтвердить даже верным числом', r.status === 404);
r = await post('/api/auth/link/poll', { id: d1.id, pollKey: d1.pollKey });
t('устройство видит «exhausted» и сессии не получает', r.data.status === 'exhausted' && !r.data.session);

// ── Успешный вход
r = await post('/api/auth/link/start', { kind: 'tv' }, null, 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 Chrome/76 TV Safari/537.36');
const d2 = r.data;
r = await post('/api/skyid/link/lookup', { code: d2.code }, me.tok);
t('ТВ определён как Samsung Tizen', r.data.device.model.includes('Tizen'), r.data.device.model);
r = await post('/api/skyid/link/decide', { id: d2.id, approve: true, verify: d2.verify }, other.tok);
t('другой человек, не смотревший запрос, тоже может подтвердить СВОИМ телефоном — вход будет в ЕГО аккаунт, не в мой', r.status === 200);
// Первый подтвердивший выиграл; вход идёт в аккаунт подтвердившего.
r = await post('/api/auth/link/poll', { id: d2.id, pollKey: d2.pollKey }, null, 'Mozilla/5.0 (SMART-TV; Tizen 6.0)');
t('устройство получило сессию того, кто подтвердил', r.status === 200 && r.data.status === 'approved' && r.data.session?.accessToken && r.data.session.skyId.id === sky(other), JSON.stringify(r.data).slice(0, 200));
t('в ответе есть куки/токены обычного входа', Boolean(r.headers.get('set-cookie')));
const tvTok = r.data.session.accessToken;
let me2 = await call('/api/auth/devices', {}, tvTok);
t('новая сессия работает и видна в «Устройствах» с пометкой привязки', me2.status === 200 && me2.data.devices.some((d) => d.via?.kind === 'tv'), JSON.stringify(me2.data).slice(0, 300));
r = await post('/api/auth/link/poll', { id: d2.id, pollKey: d2.pollKey });
t('повторный опрос сессию второй раз НЕ выдаёт', r.data.status === 'consumed' && !r.data.session);
r = await post('/api/skyid/link/decide', { id: d2.id, approve: true, verify: d2.verify }, me.tok);
t('использованный запрос не подтвердить заново', r.status === 404);

// ── Гонка: два опроса одновременно — сессия одна
r = await post('/api/auth/link/start', { kind: 'car' }); const d3 = r.data;
await post('/api/skyid/link/decide', { id: d3.id, approve: true, verify: d3.verify }, me.tok);
const both = await Promise.all([1, 2, 3, 4, 5].map(() => post('/api/auth/link/poll', { id: d3.id, pollKey: d3.pollKey })));
t('при 5 одновременных опросах сессию получает ровно один', both.filter((x) => x.data.session).length === 1, both.map((x) => x.data.status).join());

// ── Отклонение, отмена, истечение
r = await post('/api/auth/link/start', { kind: 'tv' }); const d4 = r.data;
r = await post('/api/skyid/link/decide', { id: d4.id, approve: false }, me.tok);
t('«Это не я» без числа отклоняет', r.status === 200 && r.data.status === 'denied');
r = await post('/api/auth/link/poll', { id: d4.id, pollKey: d4.pollKey });
t('устройство видит отказ', r.data.status === 'denied' && !r.data.session);
r = await post('/api/auth/link/start', { kind: 'tv' }); const d5 = r.data;
await post('/api/auth/link/cancel', { id: d5.id, pollKey: d5.pollKey });
r = await post('/api/skyid/link/lookup', { code: d5.code }, me.tok);
t('отменённый запрос не находится', r.status === 404);
r = await post('/api/auth/link/start', { kind: 'tv' }); const d6 = r.data;
q(`update device_links set expires_at = now() - interval '1 minute' where id='${d6.id}'`);
r = await post('/api/skyid/link/lookup', { code: d6.code }, me.tok);
t('просроченный код не находится', r.status === 404);
r = await post('/api/auth/link/poll', { id: d6.id, pollKey: d6.pollKey });
t('устройство видит «expired»', r.data.status === 'expired');
r = await post('/api/auth/link/start', { kind: 'toaster', label: 'x'.repeat(500) }); 
t('странный тип сводится к other, подпись обрезается', q(`select kind||length(label) from device_links where id='${r.data.id}'`) === 'other60');

// ── Аутентификатор
const secret = generateSecret();
q(`update sky_ids set two_factor_enabled=true, two_factor_method='app', two_factor_secret='${encryptSecret(secret)}' where id='${sky(me)}'`);
r = await post('/api/auth/link/start', { kind: 'console' }); const d7 = r.data;
r = await post('/api/skyid/link/lookup', { code: d7.code }, me.tok);
t('телефон узнаёт, что нужен код аутентификатора', r.data.needsTotp === true);
r = await post('/api/skyid/link/decide', { id: d7.id, approve: true, verify: d7.verify }, me.tok);
t('без кода аутентификатора не подтвердить', r.data.error === 'totp_required');
r = await post('/api/skyid/link/decide', { id: d7.id, approve: true, verify: d7.verify, totp: '000000' }, me.tok);
t('с неверным кодом не подтвердить', r.data.error === 'bad_code');
r = await post('/api/skyid/link/decide', { id: d7.id, approve: true, verify: d7.verify, totp: currentTotp(secret) }, me.tok);
t('с верным кодом и числом — подтверждено', r.status === 200 && r.data.status === 'approved', JSON.stringify(r.data));

// ── История и пределы
r = await call('/api/skyid/link/history', {}, me.tok);
t('история показывает устройства с адресом и результатом', r.status === 200 && r.data.items.length >= 2 && r.data.items.every((x) => x.ip && x.status), JSON.stringify(r.data).slice(0, 200));
let lim = 0; for (let i = 0; i < 15; i++) { const x = await post('/api/auth/link/start', { kind: 'tv' }, null, null, '198.51.100.99'); if (x.status === 429) lim++; }
t('запросов кода с одного адреса — не больше нескольких в минуту', lim >= 8, String(lim));
let lk = 0; for (let i = 0; i < 14; i++) { const x = await post('/api/skyid/link/lookup', { code: 'ZZZZ-ZZZZ' }, other.tok); if (x.status === 429) lk++; }
t('подбор кода с телефона упирается в предел', lk >= 3, String(lk));

console.log(`\nИтого: ${ok} ok, ${bad} fail`);
process.exit(bad ? 1 : 0);
