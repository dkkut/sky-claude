// Статика dist/ + прокси /api на API (:8080) на одном origin — для браузерных тестов без nginx. node static-proxy.mjs [порт]
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const PORT = Number(process.argv[2]) || 4173; const DIST = join(process.cwd(), 'dist'); const API = { host: '127.0.0.1', port: 8080 };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url === '/healthz') {
    const p = http.request({ ...API, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${PORT}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.statusCode = 502; res.end(); }); req.pipe(p); return;
  }
  let f = join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) f = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1');
