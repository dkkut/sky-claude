// Запросы органов (server/lawrequests.mjs): доступ только владельцу, обязательные поля, код подтверждения, досье без секретов.
// API: OWNER_USERNAME=lawowner ADMIN_GATE=off. (node scripts/audit/globalblock-test.mjs <каталог с api.log>; DATABASE_URL — адрес базы)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call } from './lib.mjs';
const S = process.argv[2];
const DB = process.env.DATABASE_URL ?? 'postgres://sky:sky@127.0.0.1/sky';
const q = (s) => execSync(`psql "${DB}" -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ipn = 0;
const hdr = (dev, ip) => ({ headers: { 'x-real-ip': ip ?? `198.51.100.${(++ipn % 200) + 1}`, ...(dev ? { 'x-sky-device': dev } : {}), 'user-agent': 'gb-test' } });
const post = (p, b, tok, dev, ip) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}), ...hdr(dev, ip) }, tok);
const get = (p, tok) => call(p, {}, tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const login = async (email, dev) => {
  q(`delete from verification_codes where destination='${email}'`);
  await post('/api/auth/email/start', { email }, null, dev); await sleep(1300);
  return post('/api/auth/email/verify', { email, code: codeOf(email) }, null, dev);
};
const mk = async (tag, dev, username) => {
  const email = `${tag}${Date.now()}@example.com`;
  let r = await login(email, dev); let tok = r.data.accessToken;
  const uname = username ?? tag + Date.now().toString(36);
  r = await post('/api/skyid/profiles', { name: tag, username: uname, acceptLegal: true }, tok, dev);
  if (!r.data.profile) { console.log('mk fail', tag, r.status, JSON.stringify(r.data).slice(0, 200)); process.exit(2); }
  const pid = r.data.profile.id;
  r = await post(`/api/skyid/profiles/${pid}/select`, {}, tok, dev); tok = r.data.accessToken ?? tok;
  return { email, tok, pid, uname, sky: q(`select sky_id from profiles where id='${pid}'`) };
};
const step = async (u) => { q(`update admin_step_up set used_at = now() where actor_id='${u.pid}' and used_at is null`); await post('/api/admin/law-requests/step-up', {}, u.tok); await sleep(1300); return codeOf(u.email); };


q("update profiles set username = 'old' || substr(id, 5, 8) where username = 'lawowner'");
const OWN = await mk('lwo', 'device-law-owner-aaaaaaaa'); q(`update profiles set username='lawowner' where id='${OWN.pid}'`); OWN.uname = 'lawowner';
const X = await mk('lwx', 'device-law-x-bbbbbbbbbbb');
const SUBJ = await mk('lws', 'device-law-s-ccccccccccc');
const P = '/api/admin/law-requests';
const good = { caseNo: 'ДЕЛО-123/2026', authority: 'Следственный отдел (тест)', legalBasis: 'Запрос № 45 от 01.11.2026, ст. 1 (тест)', target: '@' + SUBJ.uname };

let r = await get(P, X.tok); t('обычный человек: список закрыт', r.status === 403, r.status);
r = await post(P, good, X.tok); t('обычный человек: создать нельзя', r.status === 403, r.status);
r = await post(P, { ...good, caseNo: '' }, OWN.tok); t('без номера дела — отказ', r.data.error === 'case_no_required', JSON.stringify(r.data));
r = await post(P, { ...good, legalBasis: 'коротко' }, OWN.tok); t('без правового основания — отказ', r.data.error === 'legal_basis_required', JSON.stringify(r.data));
r = await post(P, { ...good, target: '@nobody-here' }, OWN.tok); t('неизвестная цель', r.data.error === 'not_found', JSON.stringify(r.data));
r = await post(P, { ...good, periodFrom: '2026-12-01', periodTo: '2026-01-01' }, OWN.tok); t('период наоборот', r.data.error === 'bad_period', JSON.stringify(r.data));
r = await post(P, good, OWN.tok); t('владелец создаёт запрос', r.status === 200 && r.data.id, JSON.stringify(r.data));
const id = r.data.id;
r = await post(`${P}/${id}/export`, { confirm: true, code: '000000' }, X.tok); t('чужой экспорт закрыт', r.status === 403, r.status);
r = await post(`${P}/${id}/export`, { code: '123456' }, OWN.tok); t('без confirm — отказ', r.data.error === 'confirm_required', JSON.stringify(r.data));
r = await post(`${P}/${id}/export`, { confirm: true }, OWN.tok); t('без кода — step_up_required', r.data.error === 'step_up_required', JSON.stringify(r.data));
const code = await step(OWN);
r = await post(`${P}/${id}/export`, { confirm: true, code: code === '000000' ? '111111' : '000000' }, OWN.tok); t('неверный код', !!r.data.error && !r.data.body, JSON.stringify(r.data).slice(0, 120));
const code2 = await step(OWN);
r = await post(`${P}/${id}/export`, { confirm: true, code: code2 }, OWN.tok); t('экспорт с верным кодом', r.status === 200 && r.data.sha256 && r.data.body, JSON.stringify(r.data).slice(0, 160));
const d = JSON.parse(r.data.body ?? '{}');
t('досье: формат и перечень «не хранится»', d.format === 'sky-law-export/1' && d.notStored?.length >= 4);
t('досье: учётная запись найдена', d.sections?.account?.id === SUBJ.sky, JSON.stringify(d.sections?.account).slice(0, 100));
t('досье: нет секретов', !/two_factor_secret|refresh|password|accessToken/i.test(r.data.body));
t('досье: контрольная сумма совпадает', (await import('node:crypto')).createHash('sha256').update(r.data.body).digest('hex') === r.data.sha256);
r = await post(`${P}/${id}/export`, { confirm: true, code: code2 }, OWN.tok); t('код одноразовый', !!r.data.error, JSON.stringify(r.data).slice(0, 100));
t('журнал: запрос и выгрузка записаны', Number(q(`select count(*) from admin_log where type in ('law_request_create','law_request_export')`) || 0) >= 2);
r = await get(P, OWN.tok); t('список: статус exported, выгрузок 1', r.data.requests?.find((x) => x.id === id)?.status === 'exported' && r.data.requests.find((x) => x.id === id).exports === 1);
r = await post(`${P}/${id}/close`, { reason: 'ok' }, OWN.tok); t('закрыть без причины — отказ', r.data.error === 'reason_required');
r = await post(`${P}/${id}/close`, { reason: 'Ответ направлен, дело закрыто' }, OWN.tok); t('закрытие', r.data.ok === true, JSON.stringify(r.data));
const code3 = await step(OWN);
r = await post(`${P}/${id}/export`, { confirm: true, code: code3 }, OWN.tok); t('после закрытия выгрузка закрыта', r.data.error === 'request_closed', JSON.stringify(r.data));
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
