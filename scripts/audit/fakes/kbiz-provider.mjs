// Тестовый платёжный провайдер для SkyKassa Business (протокол hmac-v1). Реальных провайдеров в Sky нет — это учебная подделка для проверок.
//   import { startProvider } from './fakes/kbiz-provider.mjs'; const p = await startProvider(9977, { secret, merchant });
//   p.payments — Map(payment_id → {order_id, amount, currency, status}); p.setStatus(id, 'paid'); p.webhook(url, event) — подписанный вебхук к Sky.
import http from 'node:http';
import crypto from 'node:crypto';
const sign = (secret, ts, body) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
export const startProvider = (port, { secret, merchant }) => new Promise((resolve) => {
  const payments = new Map(); let seq = 0; let badAnswer = false;
  const srv = http.createServer((req, res) => {
    const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => {
      const body = Buffer.concat(ch).toString(); const ts = req.headers['x-timestamp']; const sig = req.headers['x-signature'];
      const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (!ts || !sig || sig !== sign(secret, ts, body) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return send(401, { error: 'bad_signature' });
      if (req.method === 'GET' && req.url === '/ping') return send(200, { ok: true });
      if (req.method === 'POST' && req.url === '/payments') {
        const d = JSON.parse(body); if (d.merchant !== merchant) return send(403, { error: 'bad_merchant' });
        const id = `fp-${++seq}-${crypto.randomBytes(3).toString('hex')}`; payments.set(id, { order_id: d.order_id, amount: d.amount, currency: d.currency, status: 'pending', webhook_url: d.webhook_url });
        return send(200, badAnswer ? { payment_id: id, pay_url: 'javascript:alert(1)' } : { payment_id: id, pay_url: `http://127.0.0.1:${port}/pay/${id}` });
      }
      const m = /^\/payments\/([^/]+)$/.exec(req.url);
      if (req.method === 'GET' && m) { const p = payments.get(decodeURIComponent(m[1])); return p ? send(200, { status: p.status, amount: p.amount, currency: p.currency }) : send(404, { error: 'unknown' }); }
      return send(404, { error: 'not_found' });
    });
  }).listen(port, '127.0.0.1', () => resolve({
    payments, close: () => srv.close(), setBad: (v) => { badAnswer = v; },
    setStatus: (id, status, amount) => { const p = payments.get(id); p.status = status; if (amount != null) p.amount = amount; },
    last: () => [...payments.entries()].pop(),
    webhook: async (url, event, { secretOverride, ts } = {}) => {
      const body = JSON.stringify(event); const t = String(ts ?? Math.floor(Date.now() / 1000));
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-timestamp': t, 'x-signature': sign(secretOverride ?? secret, t, body) }, body });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    },
  }));
});
