// ТЕСТОВЫЙ шлюз Sky Tax (протокол hmac-v1, см. шапку server/taxproviders.mjs). Только для проверок; в рабочей системе не используется.
// node tax-gateway.mjs [порт=9988]  Секрет: TAX_FAKE_SECRET. Режимы (меняются POST /_mode {mode}): ok | accepted | temp | reject | nonumber.
import http from 'node:http';
import crypto from 'node:crypto';
const SECRET = process.env.TAX_FAKE_SECRET ?? 'tax-fake-secret-0123456789';
let mode = 'ok'; const receipts = new Map(); const calls = [];
const sign = (ts, body) => crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/_mode') { mode = JSON.parse(raw).mode; return send(200, { mode }); }
    if (req.url === '/_calls') return send(200, { calls, receipts: [...receipts.values()] });
    const ts = req.headers['x-timestamp']; const sig = req.headers['x-signature'];
    if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300 || sig !== sign(ts, raw)) return send(401, { error: 'bad signature' });
    if (req.url === '/v1/ping') return send(200, { ok: true });
    if (req.method === 'POST' && req.url === '/v1/receipts') {
      const b = JSON.parse(raw); calls.push({ idem: b.idempotencyKey, mode, operation: b.operation, amount: b.amount, inn: b.inn, buyer: b.buyer, docKind: b.docKind });
      if (mode === 'temp') return send(503, { error: 'temporarily unavailable' });
      if (mode === 'reject') return send(422, { error: 'invalid inn' });
      const old = receipts.get(b.idempotencyKey); if (old) return send(200, old);   // идемпотентность
      const r = { id: `rc-${receipts.size + 1}`, status: mode === 'accepted' ? 'accepted' : 'issued', number: mode === 'nonumber' ? undefined : `${1000 + receipts.size}`, url: 'https://example.test/receipt/' + (receipts.size + 1), fiscalSign: '1234567890' };
      if (mode === 'nonumber') return send(200, r);   // «сломанный» ответ не запоминаем
      receipts.set(b.idempotencyKey, r); if (mode === 'accepted') setTimeout(() => { r.status = 'issued'; r.number = `${1000 + receipts.size}`; }, 200);
      return send(200, r);
    }
    const m = req.url.match(/^\/v1\/receipts\/(.+)$/);
    if (m) { const r = [...receipts.values()].find((x) => x.id === m[1]); return r ? send(200, r) : send(404, { error: 'not found' }); }
    send(404, { error: 'not found' });
  });
}).listen(Number(process.argv[2] ?? 9988), '127.0.0.1', () => console.log('tax-gateway fake ready'));
