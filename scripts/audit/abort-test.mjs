import net from 'node:net';
import { execSync } from 'node:child_process';
import { mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql ${process.env.TEST_DATABASE_URL || 'postgres://sky:sky@127.0.0.1/sky'} -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let pass = 0, fail = 0; const ok = (c, m, x = '') => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m, x); } };
const A = await mkuser(S, 'abt');
q(`INSERT INTO prime_subscriptions(id,profile_id,status,plan) VALUES ('p${Date.now()}ab','${A.pid}','active','test')`);
const head = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom')]);
const cases = [
  ['film', '/api/film/upload?title=Abort&category=movie', 'select count(*) from film_movies where owner_id', head],
  ['skyvideo', '/api/skyvideo/upload?title=Abort', 'select count(*) from sky_videos where owner_id', head],
  ['music', '/api/music/upload?title=Abort&artist=Z', 'select count(*) from music_tracks where owner_id', Buffer.from('ID3')],
];
for (const [name, path, cnt, h] of cases) {
  let tbl; try { tbl = q(`${cnt}='${A.pid}'`); } catch (e) { console.log('skip', name, 'нет таблицы/колонки', String(e.message).slice(0, 80)); continue; }
  const before = Number(tbl);
  await new Promise((res) => {
    const s = net.connect(8080, '127.0.0.1', () => {
      s.write(`POST ${path} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${A.tok}\r\nContent-Type: application/octet-stream\r\nContent-Length: 5000000\r\n\r\n`);
      s.write(Buffer.concat([h, Buffer.alloc(100_000, 1)]));
      setTimeout(() => { s.destroy(); res(); }, 400);
    });
    s.on('error', () => res());
  });
  await new Promise((r) => setTimeout(r, 1500));
  const after = Number(q(`${cnt}='${A.pid}'`));
  ok(after === before, `${name}: оборванная загрузка не оставляет запись (было ${before}, стало ${after})`);
}
console.log(`\n${pass} ok, ${fail} fail`);
