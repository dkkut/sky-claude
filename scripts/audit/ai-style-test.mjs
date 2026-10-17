// Форматы обращения к модели (server/ai.mjs): anthropic (/v1/messages), chat, responses; повтор при 400; выбор формата по адресу.
// node scripts/audit/ai-style-test.mjs  (без сервера; поднимает поддельного поставщика)
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const seen = [];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
    const j = b ? JSON.parse(b) : {}; seen.push({ url: req.url, h: req.headers, j });
    const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/v1/messages') return send(200, { content: [{ type: 'text', text: 'Привет от Claude' }], usage: { input_tokens: 5, output_tokens: 3 } });
    if (req.url === '/v1/chat/completions') {
      if (j.max_tokens) return send(400, { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens'." } });
      return send(200, { choices: [{ message: { content: 'chat ok' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } });
    }
    if (req.url === '/v1/responses') {
      if ('temperature' in j) return send(400, { error: { message: 'temperature not supported' } });
      return send(200, { output_text: 'responses ok', usage: { input_tokens: 1, output_tokens: 1 } });
    }
    send(404, {});
  });
}).listen(9966);
const run = (env) => new Promise((resolve) => {
  const code = `const { askModel } = await import('./server/ai.mjs'); const r = await askModel({ system: 'S', user: 'привет' }); console.log(JSON.stringify(r)); process.exit(0)`;
  const p = spawn('node', ['--input-type=module', '-e', code], { env: { ...process.env, AI_API_KEY: 'k-test', AI_BASE_URL: 'http://127.0.0.1:9966', AI_MODEL: 'm', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  const kill = setTimeout(() => p.kill(), 20000);
  p.on('close', () => { clearTimeout(kill); try { resolve(JSON.parse(out.trim().split('\n').filter((l) => l.startsWith('{')).pop())); } catch { resolve({ error: 'parse', out }); } });
});
await new Promise((r) => setTimeout(r, 200));
let r = await run({ AI_API_STYLE: 'anthropic' });
t('anthropic: ответ получен', r.text === 'Привет от Claude', JSON.stringify(r));
const a = seen.find((s) => s.url === '/v1/messages');
t('anthropic: x-api-key и версия, system отдельно', a?.h['x-api-key'] === 'k-test' && a.h['anthropic-version'] && a.j.system.startsWith('S') && a.j.messages[0].role === 'user', JSON.stringify(a?.j));
seen.length = 0; r = await run({ AI_API_STYLE: 'chat' });
t('chat: 400 → повтор с max_completion_tokens', r.text === 'chat ok' && seen.length === 2 && seen[1].j.max_completion_tokens, JSON.stringify(r));
seen.length = 0; r = await run({ AI_API_STYLE: 'responses' });
t('responses: 400 → повтор без temperature', r.text === 'responses ok' && seen.length === 2 && !('temperature' in seen[1].j), JSON.stringify(r));
seen.length = 0; r = await run({ AI_API_STYLE: '', AI_BASE_URL: 'http://127.0.0.1:9966' });
t('пусто и не Anthropic → responses', seen[0]?.url === '/v1/responses', JSON.stringify(seen[0]?.url));
srv.close();
// автоопределение по адресу — без сети, только конфиг
const cfg = (u) => spawnSync('node', ['--input-type=module', '-e', `const {config}=await import('./server/config.mjs');console.log(config.aiApiStyle)`], { env: { ...process.env, AI_API_STYLE: '', AI_BASE_URL: u }, encoding: 'utf8' }).stdout.trim().split('\n').pop();
t('api.anthropic.com → anthropic', cfg('https://api.anthropic.com') === 'anthropic');
t('api.openai.com → responses', cfg('https://api.openai.com') === 'responses');
t('посредник с anthropic в пути не путается', cfg('https://proxy.example.com/anthropic.com') === 'responses');
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
