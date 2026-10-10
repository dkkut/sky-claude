import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql ${process.env.TEST_DATABASE_URL || 'postgres://sky:sky@127.0.0.1/sky'} -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let pass = 0, fail = 0; const ok = (c, m, x = '') => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m, x); } };
const prime = (u) => q(`INSERT INTO prime_subscriptions(id,profile_id,status,plan) VALUES ('p${Date.now()}${Math.random().toString(36).slice(2,6)}','${u.pid}','active','test')`);
const A = await mkuser(S, 'msa'), Bx = await mkuser(S, 'msb'); prime(A); prime(Bx);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(300_000, 7)]);
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200_000, 3)]);
const up = (u, path, buf) => fetch(B + path, { method: 'POST', headers: { authorization: `Bearer ${u.tok}`, 'content-type': 'application/octet-stream' }, body: buf }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const ticketHdr = { 'X-Sky-Media-Url': '1' };
const tk = async (u, sec) => (await call(`/api/${sec}/ticket`, { method: 'POST', body: '{}' }, u.tok, ticketHdr)).data.ticket;
const get = (url, h = {}, method = 'GET') => fetch(B + url, { method, headers: h });

for (const [name, sec, upPath, idOf, vpath, publish] of [
  ['film', 'film', '/api/film/upload?title=T1&category=movie&duration=60', (d) => d.movie?.id, (id) => `/api/film/movie/${id}/video`, null],
  ['skyvideo', 'skyvideo', '/api/skyvideo/upload?title=V1&duration=60', (d) => d.video?.id, (id) => `/api/skyvideo/video/${id}/video`, (id) => ({ p: `/api/skyvideo/video/${id}/publish`, b: {} })],
  ['music', 'music', '/api/music/upload?title=M1&artist=Z&duration=60', (d) => d.track?.id, (id) => `/api/music/track/${id}/audio`, null],
]) {
  console.log(`\n── ${name}`);
  const buf = name === 'music' ? mp3 : mp4;
  const r = await up(A, upPath, buf);
  const id = idOf(r.data);
  ok(r.status === 201 && id, `${name}: загрузка владельцем`, `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  if (!id) continue;
  const tA = await tk(A, sec), tB = await tk(Bx, sec);
  const url = vpath(id);
  let x = await get(`${url}?t=${encodeURIComponent(tA)}`, { Range: 'bytes=0-99' });
  ok(x.status === 206 && x.headers.get('content-range')?.startsWith('bytes 0-99/'), `${name}: владелец, Range 0-99 → 206`, `${x.status} ${x.headers.get('content-range')}`);
  ok(/nosniff/.test(x.headers.get('x-content-type-options') ?? ''), `${name}: nosniff`);
  ok(/^(video|audio)\//.test(x.headers.get('content-type') ?? ''), `${name}: Content-Type = ${x.headers.get('content-type')}`);
  x = await get(`${url}?t=${encodeURIComponent(tA)}`);
  const body = Buffer.from(await x.arrayBuffer());
  ok(x.status === 200 && body.length === buf.length && body.equals(buf), `${name}: полный файл побайтно совпадает`, `${x.status} ${body.length}/${buf.length}`);
  for (const rg of ['bytes=999999999-', 'bytes=abc', 'bytes=5-2', 'bytes=-', 'bytes=0-1,5-6', 'bytes=-0', 'items=0-5']) {
    x = await get(`${url}?t=${encodeURIComponent(tA)}`, { Range: rg }); void x.body?.cancel();
    ok(x.status < 500, `${name}: Range "${rg}" → ${x.status} (не 5xx)`);
  }
  x = await get(`${url}?t=${encodeURIComponent(tA)}`, { Range: 'bytes=-10' });
  ok(x.status === 206 && x.headers.get('content-length') === '10', `${name}: suffix-range bytes=-10 → последние 10 байт`, `${x.status} ${x.headers.get('content-length')}`);
  x = await get(`${url}?t=${encodeURIComponent(tA)}`, {}, 'HEAD'); void x.body?.cancel();
  ok(x.status === 200 || x.status === 404 || x.status === 405, `${name}: HEAD → ${x.status}`);
  // чужой
  x = await get(`${url}?t=${encodeURIComponent(tB)}`, { Range: 'bytes=0-9' }); void x.body?.cancel();
  ok(x.status === 404 || x.status === 403, `${name}: ЧУЖОЙ пользователь не получает приватный файл (${x.status})`);
  x = await get(`${url}`, { Range: 'bytes=0-9' }); void x.body?.cancel();
  ok(x.status === 401 || x.status === 403 || x.status === 404, `${name}: без пропуска → ${x.status}`);
  x = await get(`${url}?t=${encodeURIComponent(tA.slice(0, -3) + 'AAA')}`, { Range: 'bytes=0-9' }); void x.body?.cancel();
  ok(x.status === 401 || x.status === 403 || x.status === 404, `${name}: подделанный пропуск → ${x.status}`);
  // чужой не может менять/удалять
  const base = url.replace(/\/(video|audio)$/, '');
  let m = await call(base, { method: 'PATCH', body: JSON.stringify({ title: 'hack' }) }, Bx.tok);
  ok(m.status === 403 || m.status === 404, `${name}: чужой PATCH → ${m.status}`);
  m = await call(base, { method: 'DELETE', body: '{}' }, Bx.tok);
  ok(m.status === 403 || m.status === 404, `${name}: чужой DELETE → ${m.status}`);
  m = await call(base, {}, Bx.tok);
  ok(m.status === 404 || m.status === 403, `${name}: чужой GET метаданных приватного → ${m.status}`);
  // публикация (где есть) → другой видит
  if (publish) {
    const { p, b } = publish(id);
    const pr = await call(p, { method: 'POST', body: JSON.stringify(b) }, A.tok);
    x = await get(`${url}?t=${encodeURIComponent(tB)}`, { Range: 'bytes=0-9' }); void x.body?.cancel();
    ok(pr.status === 200 ? (x.status === 206 || x.status === 404) : true, `${name}: после публикации (publish=${pr.status}) другой → ${x.status}`);
  }
  // обложка/постер без файла
  x = await get(url.replace(/(video|audio)$/, name === 'film' ? 'poster' : name === 'music' ? 'cover' : 'thumbnail') + `?t=${encodeURIComponent(tA)}`); void x.body?.cancel();
  ok(x.status === 404, `${name}: обложки нет → 404 (${x.status})`);
  // удаление владельцем → файл исчезает
  m = await call(base, { method: 'DELETE', body: '{}' }, A.tok);
  ok(m.status === 200, `${name}: владелец удаляет → ${m.status}`);
  x = await get(`${url}?t=${encodeURIComponent(tA)}`, { Range: 'bytes=0-9' }); void x.body?.cancel();
  ok(x.status === 404, `${name}: после удаления файл не отдаётся (${x.status})`);
  // подмена: неподдерживаемый тип / пустой / текст под видом
  let bad = await up(A, upPath, Buffer.from('<html><script>alert(1)</script></html>'));
  ok(bad.status === 400, `${name}: HTML вместо медиа отклонён (${bad.status})`);
  bad = await up(A, upPath, Buffer.alloc(0));
  ok(bad.status >= 400 && bad.status < 500, `${name}: пустое тело отклонено (${bad.status})`);
}
console.log(`\n${pass} ok, ${fail} fail`);
