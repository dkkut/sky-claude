// Модуль 6: учёт расхода AI, бюджет, предупреждения, ключ без раскрытия (server/aiusage.mjs, routes/aiusage.mjs).
// API: AI_API_KEY=test-key-0123456789abcdefWXYZ AI_BASE_URL=http://127.0.0.1:9955 AI_MODEL=fake-model OWNER_USERNAME=aiowner ADMIN_GATE=off
//   (. env.sh; node scripts/audit/aiusage-test.mjs <каталог с api.log>)   Поддельный поставщик поднимается тут же на :9955.
import http from 'node:http';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const put = (p, b, u) => call(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }, u?.tok);
const get = (p, u) => call(p, {}, u?.tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };

// поддельный поставщик
let mode = 'ok';
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
    if (mode === '429') { res.writeHead(429); return res.end('{}'); }
    if (mode === '500') { res.writeHead(500); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    // Отвечаем в формате, который запрошен (AI_API_STYLE окружения может быть и chat, и responses)
    const chat = req.url.includes('/chat/completions');
    const body = chat ? { choices: [{ message: { content: 'Короткий ответ модели.' } }] } : { output_text: 'Короткий ответ модели.', status: 'completed' };
    if (mode === 'ok') body.usage = chat ? { prompt_tokens: 100, completion_tokens: 50 } : { input_tokens: 100, output_tokens: 50 };
    res.end(JSON.stringify(body));
  });
}).listen(9955);
await sleep(300);

q(`update profiles set username='old'||substr(id,1,8) where lower(username)='aiowner'`);
const OWN = await mkuser(S, 'aiOwn'); q(`update profiles set username='aiowner' where id='${OWN.pid}'`);
q(`update sky_ids set email_verified=true where id=(select sky_id from profiles where id='${OWN.pid}')`);
const USR = await mkuser(S, 'aiUsr'); const ADM = await mkuser(S, 'aiAdm');
q(`update profiles set is_admin=true, admin_role='super_admin' where id='${ADM.pid}'`);
q(`delete from ai_usage_daily; delete from ai_events; delete from ai_alerts_sent; update ai_settings set settings='{}'::jsonb`);
const POOL = [USR]; for (let i = 0; i < 6; i++) POOL.push(await mkuser(S, 'aiPool' + i));
let rot = 0;   // у каждого человека свой предел частоты запросов к AI — ротируем, чтобы упираться в бюджет, а не в него
const ask = (u, text = 'Привет, как дела у проекта сегодня?') => post('/api/ai/ask', { task: 'gist', text }, POOL[rot++ % POOL.length]);
const ov = async (u = OWN) => (await get('/api/admin/ai-usage', u)).data;

let r = await get('/api/admin/ai-usage', USR);
t('обычному человеку раздел закрыт', r.status === 403);
r = await get('/api/admin/ai-usage', OWN);
t('владелец видит раздел', r.status === 200 && r.data.chat.configured === true && r.data.chat.model === 'fake-model', JSON.stringify(r.data).slice(0, 160));
t('ключ целиком нигде не показывается', !JSON.stringify(r.data).includes('test-key-0123456789abcdefWXYZ') && r.data.chat.key.masked === '••••WXYZ' && /^[0-9a-f]{8}$/.test(r.data.chat.key.fingerprint), JSON.stringify(r.data.chat.key));
t('остаток квоты у поставщика — «неизвестно», не выдуман', r.data.providerQuota.known === false);
t('цены не заданы — стоимость не рассчитана', r.data.models.every((m) => m.cost === null));

// расход по данным поставщика
for (let i = 0; i < 3; i++) await ask(USR);
let o = await ov(); let m = o.models.find((x) => x.kind === 'chat');
t('3 запроса: токены берутся из ответа поставщика', m && m.requests === 3 && m.inputTokens === 300 && m.outputTokens === 150 && m.estRequests === 0, JSON.stringify(m));
t('расход за день = 450', o.spend.today === 450 && o.spend.month === 450, JSON.stringify(o.spend));

// без usage — отдельная оценка
mode = 'nousage'; await ask(USR, 'А' .repeat(400));
o = await ov(); m = o.models.find((x) => x.kind === 'chat');
t('нет usage: запрос считается оценкой, реальные токены не меняются', m.requests === 4 && m.estRequests === 1 && m.inputTokens === 300 && m.estInputTokens > 100, JSON.stringify(m));

// ошибки поставщика
mode = '500'; r = await ask(USR);
t('ошибка поставщика видна человеку как 502', r.status === 502, r.status);
mode = '429'; r = await ask(USR);
t('429 поставщика → «много запросов» (503)', r.status === 503);
o = await ov(); m = o.models.find((x) => x.kind === 'chat');
t('ошибки посчитаны', m.errors === 2, JSON.stringify(m));
t('в журнале события error и rate_limit', o.events.some((e) => e.kind === 'error') && o.events.some((e) => e.kind === 'rate_limit'));
t('график по дням есть', o.series.length === 1 && o.series[0].requests >= 4);

// стоимость по ставкам администратора
r = await put('/api/admin/ai-usage/settings', { settings: { priceInPerMTok: 1 }, stepUpCode: '000000' }, ADM);
t('настройки: не владелец не меняет (403)', r.status === 403);
r = await put('/api/admin/ai-usage/settings', { settings: { priceInPerMTok: 1 } }, OWN);
t('настройки без подтверждения личности отклонены', r.status === 401);
const step = async () => { q(`update admin_step_up set used_at = now() where actor_id='${OWN.pid}' and used_at is null`); await post('/api/admin/ai-usage/step-up', {}, OWN); await sleep(1300); return codeOf(OWN.email); };
r = await put('/api/admin/ai-usage/settings', { settings: { priceInPerMTok: 2, priceOutPerMTok: 10, currency: 'usd' }, stepUpCode: await step() }, OWN);
t('владелец задаёт ставки', r.status === 200 && r.data.settings.priceInPerMTok === 2, JSON.stringify(r.data));
o = await ov(); m = o.models.find((x) => x.kind === 'chat');
const expected = Math.round(((300 + m.estInputTokens) * 2 + (150 + m.estOutputTokens) * 10) / 1e6 * 10000) / 10000;
t('стоимость = токены × ставки (оценка)', m.cost === expected, `${m.cost} ${expected}`);
r = await put('/api/admin/ai-usage/settings', { settings: { warnPercent: 99, criticalPercent: 90 }, stepUpCode: await step() }, OWN);
t('порог предупреждения не может быть выше критического', r.status === 400);

// бюджет: предупреждения и блокировка
mode = 'ok';
const used = (await ov()).spend.today;
r = await put('/api/admin/ai-usage/settings', { settings: { dailyTokenLimit: used + 400, blockWhenExhausted: true, warnPercent: 50, criticalPercent: 90 }, stepUpCode: await step() }, OWN);
t('лимит дня и блокировка заданы', r.status === 200 && r.data.settings.blockWhenExhausted === true, JSON.stringify(r.data));
q(`delete from gift_notifications where user_id='${OWN.pid}'`);
for (let i = 0; i < 4; i++) await ask(USR);                 // +150 токенов за запрос → пересекаем пороги
await sleep(500);
t('владелец получил предупреждения (по разу на уровень)', Number(q(`select count(*) from gift_notifications where user_id='${OWN.pid}' and kind='ai_budget'`)) >= 2 && Number(q(`select count(*) from ai_alerts_sent where period like 'd:%'`)) >= 2);
for (let i = 0; i < 3; i++) await ask(USR);
r = await ask(USR);
t('лимит исчерпан и блокировка включена — запросы отклоняются (503)', r.status === 503 && /лимит расхода/.test(JSON.stringify(r.data)) === false, `${r.status} ${JSON.stringify(r.data)}`);
o = await ov();
t('в журнале событие budget', o.events.some((e) => e.kind === 'budget'));
t('остаток по нашему лимиту = 0, а у поставщика неизвестен', o.spend.dailyLeft === 0 && o.providerQuota.known === false);
const alertsBefore = Number(q(`select count(*) from gift_notifications where user_id='${OWN.pid}' and kind='ai_budget'`));
await ask(USR); await ask(USR);
t('уведомления не повторяются на каждый запрос', Number(q(`select count(*) from gift_notifications where user_id='${OWN.pid}' and kind='ai_budget'`)) === alertsBefore);
r = await put('/api/admin/ai-usage/settings', { settings: { blockWhenExhausted: false }, stepUpCode: await step() }, OWN);
r = await ask(USR);
t('блокировка выключена — запросы снова идут', r.status === 200, r.status);
t('stt без ключа: раздел не выдумывает его', (await ov()).stt.configured === false);

fake.close();
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
