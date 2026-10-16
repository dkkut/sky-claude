// Модули 15–16: резервные коды, сброс второго фактора с ожиданием, защита смены почты/номера (server/accountrecovery.mjs).
// API: RECOVERY_WAIT_SEC=4 (ожидание сброса для теста). (. env.sh; node scripts/audit/recovery-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { generateSecret, currentTotp } = await import('../../server/totp.mjs');
const { encryptSecret } = await import('../../server/crypto.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const log = () => readFileSync(S + '/api.log', 'utf8');
const lastMatch = (re) => { const m = [...log().matchAll(re)]; return m.length ? m[m.length - 1][1] : null; };
const codeOf = (email) => lastMatch(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'));
const withTotp = (u) => { const secret = generateSecret(); q(`update sky_ids set two_factor_enabled=true, two_factor_method='app', two_factor_secret='${encryptSecret(secret)}' where id=(select sky_id from profiles where id='${u.pid}')`); return secret; };
const skyOf = (u) => q(`select sky_id from profiles where id='${u.pid}'`);
// вход по почте → challenge второго фактора
const challengeFor = async (u) => {
  q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${u.email}'`);
  await post('/api/auth/email/start', { email: u.email }); await sleep(1300);
  const r = await post('/api/auth/email/verify', { email: u.email, code: codeOf(u.email) });
  return r.data.challenge;
};

const A = await mkuser(S, 'rcvA'); const secA = withTotp(A);
const skyA = skyOf(A);
t('резервные коды без второго фактора не выдаются', (await post('/api/skyid/two-factor/backup-codes', { code: '123456' }, await mkuser(S, 'rcvNo'))).status === 409);
let r = await post('/api/skyid/two-factor/backup-codes', { code: '000000' }, A);
t('резервные коды: неверный код приложения — отказ', r.status === 401, JSON.stringify(r.data));
r = await post('/api/skyid/two-factor/backup-codes', { code: currentTotp(secA) }, A);
const codes = r.data.codes;
t('резервные коды: выдано 10 одноразовых', r.status === 200 && codes?.length === 10 && codes.every((c) => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c)), JSON.stringify(r.data));
t('в базе только хеши', q(`select count(*) from sky_backup_codes where sky_id='${skyA}' and code_hash like '%${codes[0].replace('-', '')}%'`) === '0');
t('осталось 10', (await call('/api/skyid/two-factor/backup-codes', {}, A.tok)).data.left === 10);

let ch = await challengeFor(A);
t('вход по почте приводит к запросу второго фактора', Boolean(ch));
r = await post('/api/auth/two-factor/verify', { challenge: ch, code: 'ZZZZZ-ZZZZZ' });
t('чужой резервный код не подходит', r.status === 401);
r = await post('/api/auth/two-factor/verify', { challenge: ch, code: codes[0] });
t('вход по резервному коду', r.status === 200 && r.data.accessToken, JSON.stringify(r.data).slice(0, 100));
ch = await challengeFor(A);
r = await post('/api/auth/two-factor/verify', { challenge: ch, code: codes[0] });
t('резервный код одноразовый', r.status === 401);
r = await post('/api/auth/two-factor/verify', { challenge: ch, code: codes[1].toLowerCase() });
t('регистр и дефис не важны', r.status === 200);
t('осталось 8', q(`select count(*) from sky_backup_codes where sky_id='${skyA}' and used_at is null`) === '8');
await sleep(800);
t('письмо об использовании резервного кода', /A Sky ID backup code was used|Использован резервный код/.test(log()));

// ── сброс потерянного аутентификатора ──
ch = await challengeFor(A);
r = await post('/api/auth/two-factor/reset/start', { challenge: ch });
t('сброс: запрос принят, указано время готовности', r.status === 200 && r.data.readyAt, JSON.stringify(r.data));
await sleep(1200);
const cancelTok = lastMatch(/2fa-reset\?c=([A-Za-z0-9_-]+)/g); const finishTok = lastMatch(/2fa-reset\?f=([A-Za-z0-9_-]+)/g);
t('письмо содержит обе ссылки', Boolean(cancelTok && finishTok));
r = await post('/api/auth/two-factor/reset/start', { challenge: ch });
t('повторный запрос не создаёт второй', r.status === 200 && r.data.already === true);
t('в базе один открытый запрос', q(`select count(*) from two_factor_resets where sky_id='${skyA}' and status='pending'`) === '1');
r = await post('/api/auth/two-factor/reset/finish', { challenge: ch, token: finishTok });
t('до окончания ожидания завершить нельзя', r.status === 409 && r.data.error === 'too_early', JSON.stringify(r.data));
r = await call(`/api/auth/two-factor/reset/info?kind=cancel&token=${cancelTok}`);
t('страница отмены видит запрос', r.status === 200);
r = await post('/api/auth/two-factor/reset/cancel', { token: 'x'.repeat(43) });
t('отмена с чужим токеном ничего не делает', r.status === 404 && q(`select count(*) from two_factor_resets where sky_id='${skyA}' and status='pending'`) === '1');
r = await post('/api/auth/two-factor/reset/cancel', { token: cancelTok });
t('ссылка «это не я» отменяет запрос', r.status === 200 && q(`select count(*) from two_factor_resets where sky_id='${skyA}' and status='pending'`) === '0');
await sleep(4500);
r = await post('/api/auth/two-factor/reset/finish', { challenge: ch, token: finishTok });
t('после отмены завершить нельзя', r.status === 404, JSON.stringify(r.data));

// новый запрос и завершение
q(`update two_factor_resets set status='expired' where sky_id='${skyA}'`);
ch = await challengeFor(A);
await post('/api/auth/two-factor/reset/start', { challenge: ch }); await sleep(1200);
const fin2 = lastMatch(/2fa-reset\?f=([A-Za-z0-9_-]+)/g);
await sleep(4500);
const B = await mkuser(S, 'rcvB');
r = await post('/api/auth/two-factor/reset/finish', { challenge: ch, token: 'y'.repeat(43) });
t('завершение с чужой ссылкой невозможно', r.status === 404);
const chB = await (async () => { withTotp(B); return challengeFor(B); })();
r = await post('/api/auth/two-factor/reset/finish', { challenge: chB, token: fin2 });
t('ссылка работает только для своего аккаунта', r.status === 404, JSON.stringify(r.data));
r = await post('/api/auth/two-factor/reset/finish', { challenge: ch, token: fin2 });
t('после ожидания сброс завершается (ссылка + первый фактор)', r.status === 200, JSON.stringify(r.data));
t('второй фактор снят, коды удалены', q(`select two_factor_enabled from sky_ids where id='${skyA}'`) === 'f' && q(`select count(*) from sky_backup_codes where sky_id='${skyA}'`) === '0');
t('прежние сессии завершены', (await call('/api/skyid/profiles', {}, A.tok)).status === 401);
r = await post('/api/auth/two-factor/reset/finish', { challenge: ch, token: fin2 });
t('ссылка одноразовая', r.status === 404);

// успешный вход отменяет висящий запрос
const C = await mkuser(S, 'rcvC'); const secC = withTotp(C); const skyC = skyOf(C);
ch = await challengeFor(C); await post('/api/auth/two-factor/reset/start', { challenge: ch });
t('запрос открыт', q(`select count(*) from two_factor_resets where sky_id='${skyC}' and status='pending'`) === '1');
r = await post('/api/auth/two-factor/verify', { challenge: ch, code: currentTotp(secC) });
t('вход с настоящим кодом отменяет запрос сброса', r.status === 200 && q(`select count(*) from two_factor_resets where sky_id='${skyC}' and status='pending'`) === '0', JSON.stringify(r.data).slice(0, 80));

// администраторы не сбрасывают сами
const D = await mkuser(S, 'rcvD'); withTotp(D); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${D.pid}'`);
ch = await challengeFor(D);
r = await post('/api/auth/two-factor/reset/start', { challenge: ch });
t('аккаунт администратора: самостоятельный сброс закрыт', r.status === 403 && r.data.error === 'admin_manual', JSON.stringify(r.data));
r = await post('/api/auth/two-factor/reset/start', { challenge: 'bogus' });
t('без действующего входа сброс не запросить', r.status === 401);

// ── смена почты/номера ──
const E = await mkuser(S, 'rcvE'); const secE = withTotp(E);
const newMail = (tag) => `${tag}${Date.now()}@example.com`;
let nm = newMail('chg'); await post('/api/skyid/email/start', { email: nm }, E); await sleep(1300);
r = await post('/api/skyid/email/verify', { email: nm, code: codeOf(nm) }, E);
t('замена подтверждённой почты без второго фактора отклонена', r.status === 401 && r.data.error === 'two_factor_required', JSON.stringify(r.data));
r = await post('/api/skyid/email/verify', { email: nm, code: codeOf(nm), twoFactorCode: '000000' }, E);
t('и с неверным кодом приложения', r.status === 401);
t('почта осталась прежней', q(`select email from sky_ids where id='${skyOf(E)}'`) === E.email);
r = await post('/api/skyid/email/verify', { email: nm, code: codeOf(nm), twoFactorCode: currentTotp(secE) }, E);
t('с кодом приложения почта меняется', r.status === 200 && q(`select email from sky_ids where id='${skyOf(E)}'`) === nm, JSON.stringify(r.data));
await sleep(900);
t('на прежнюю почту ушло письмо об изменении', new RegExp(`${E.email.replace('.', '\\.')} \\| [^|]*\\| `).test(log()) && /contact.*changed|изменён контакт|изменён адрес/i.test(log()));
t('смена записана в журнал (маски)', Number(q(`select count(*) from contact_change_log where sky_id='${skyOf(E)}' and kind='email'`)) === 1);

// без аутентификатора — код на текущую почту
const F = await mkuser(S, 'rcvF');
nm = newMail('chf'); await post('/api/skyid/email/start', { email: nm }, F); await sleep(1300);
r = await post('/api/skyid/email/verify', { email: nm, code: codeOf(nm) }, F);
t('без аутентификатора нужен код с текущей почты', r.status === 401 && r.data.error === 'current_email_code_required', JSON.stringify(r.data));
q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${F.email}'`);
r = await post('/api/skyid/contact/guard-code', {}, F); await sleep(1300);
t('код на текущую почту отправлен', r.status === 200, JSON.stringify(r.data));
r = await post('/api/skyid/email/verify', { email: nm, code: codeOf(nm), currentEmailCode: '000000' }, F);
t('неверный код с текущей почты — отказ', r.status === 401);
r = await post('/api/skyid/email/verify', { email: nm, code: codeOf(nm), currentEmailCode: codeOf(F.email) }, F);
t('с верным кодом с текущей почты почта меняется', r.status === 200, JSON.stringify(r.data));

// телефон: первая привязка свободна, замена подтверждённого — под защитой
const G = await mkuser(S, 'rcvG'); const secG = withTotp(G);
q(`update sky_ids set phone='+79001112233', phone_verified=true where id='${skyOf(G)}'`);
r = await post('/api/skyid/phone/verify', { phone: '+79004445566', code: '123456' }, G);
t('замена подтверждённого номера без второго фактора отклонена', r.status === 401 && r.data.error === 'two_factor_required', JSON.stringify(r.data));
const H = await mkuser(S, 'rcvH');
r = await post('/api/skyid/phone/verify', { phone: '+79007778899', code: '123456' }, H);
t('первая привязка номера защитой не затрагивается (отказ только по коду)', r.status === 401 && r.data.error !== 'two_factor_required' && r.data.error !== 'current_email_code_required', JSON.stringify(r.data));

console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
