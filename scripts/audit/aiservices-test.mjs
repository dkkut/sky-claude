/** Помощники по сервисам: настройки, лимит, отключение, учёт. Модуль напрямую на Postgres `skytest`. */
import { loadServiceCfg, serviceGate, recordService, servicesOverview, saveService } from '../../server/aiservices.mjs';
import { query } from '../../server/db.mjs';
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : (bad++, console.log('FAIL', n)); };
await query('DELETE FROM ai_service_settings'); await query('DELETE FROM ai_service_usage_daily');
const actor = 'acc-aisvc-test';
await query(`INSERT INTO sky_ids (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, ['sky-' + actor, actor + '@t.test']);
await query(`INSERT INTO profiles (id, username, name, sky_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [actor, 'aisvc', 'AI', 'sky-' + actor]);
t('default on', (await serviceGate('music')).cfg.enabled === true);
t('unknown id', (await saveService(actor, 'nope', {})).error === 'unknown_service');
t('bad model', (await saveService(actor, 'music', { model: 'a b;c' })).error === 'bad_field');
t('bad max', (await saveService(actor, 'music', { maxTokens: 10 })).error === 'bad_field');
t('long instr', (await saveService(actor, 'music', { instructions: 'x'.repeat(601) })).error === 'bad_field');
let r = await saveService(actor, 'music', { enabled: true, model: 'claude-haiku-5-5', maxTokens: 800, dailyTokens: 1000, instructions: 'Отвечай коротко.' });
t('saved', r.ok && r.service.model === 'claude-haiku-5-5');
let g = await serviceGate('music'); t('gate cfg', g.cfg.model === 'claude-haiku-5-5' && g.cfg.instructions === 'Отвечай коротко.' && g.cfg.maxTokens === 800);
t('other untouched', (await serviceGate('chat')).cfg.model === '');
await recordService({ service: 'music', model: 'claude-haiku-5-5', ok: true, usage: { input: 600, output: 300 } });
t('under limit', !(await serviceGate('music')).error);
await recordService({ service: 'music', model: 'claude-haiku-5-5', ok: true, usage: null, chars: { input: 800, output: 400 } });   // оценка 300
t('limit reached', (await serviceGate('music')).error === 'ai_service_limit');
await recordService({ service: 'music', model: 'claude-haiku-5-5', ok: false });
const ov = await servicesOverview(30); const m = ov.services.find((x) => x.id === 'music');
t('overview', m.requests === 3 && m.errors === 1 && m.inputTokens === 600 && m.outputTokens === 300 && m.estimatedTokens === 300 && m.todayTokens === 1200);
await saveService(actor, 'music', { enabled: false });
t('off', (await serviceGate('music')).error === 'ai_service_off');
t('chat still on', !(await serviceGate('chat')).error);
await query('DELETE FROM ai_service_settings'); await query('DELETE FROM ai_service_usage_daily');
console.log(ok, 'ok', bad, 'bad'); process.exit(bad ? 1 : 0);
