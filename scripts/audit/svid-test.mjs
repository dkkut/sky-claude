import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const q = (s) => execSync(`psql ${process.env.TEST_DATABASE_URL || 'postgres://sky:sky@127.0.0.1/sky'} -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let pass = 0, fail = 0; const ok = (c, m, x = '') => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m, x); } };
const S = process.argv[2];
const A = await mkuser(S, 'sva'), Bu = await mkuser(S, 'svb'), C = await mkuser(S, 'svc');
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(3000, 7)]);
const id = (await (await fetch(B + '/api/skyvideo/upload?title=SV&duration=5', { method: 'POST', headers: { authorization: `Bearer ${A.tok}`, 'content-type': 'application/octet-stream' }, body: mp4 })).json()).video.id;
let r = await call(`/api/skyvideo/video/${id}/publish`, { method: 'POST', body: '{}' }, A.tok); ok(r.status === 200, 'публикация владельцем', r.text.slice(0, 120));
const views = () => Number(q(`select views from sky_videos where id='${id}'`));
const v0 = views();
await Promise.all(Array.from({ length: 30 }, () => call(`/api/skyvideo/video/${id}/view`, { method: 'POST', body: '{}' }, Bu.tok)));
ok(views() - v0 <= 1, `30 просмотров подряд одним человеком засчитаны как ${views() - v0} (ждём ≤1)`);
// владелец сам себе
const v1 = views(); await call(`/api/skyvideo/video/${id}/view`, { method: 'POST', body: '{}' }, A.tok); 
// лайки
await Promise.all(Array.from({ length: 20 }, () => call(`/api/skyvideo/video/${id}/like`, { method: 'POST', body: '{"on":true}' }, Bu.tok)));
ok(q(`select count(*) from sky_video_likes where video_id='${id}'`) === '1' && Number(q(`select likes from sky_videos where id='${id}'`)) === 1, 'лайки: 20 параллельных = 1', q(`select likes from sky_videos where id='${id}'`));
// комментарии: чужой не удаляет
r = await call(`/api/skyvideo/video/${id}/comments`, { method: 'POST', body: JSON.stringify({ body: 'коммент B' }) }, Bu.tok); const cid = r.data.comment?.id ?? r.data.id; ok(r.status === 201 && cid, 'комментарий создан', r.text.slice(0, 120));
r = await call(`/api/skyvideo/comment/${cid}`, { method: 'DELETE', body: '{}' }, C.tok); ok(r.status >= 400, `посторонний не удаляет чужой комментарий (${r.status})`);
r = await call(`/api/skyvideo/comment/${cid}`, { method: 'DELETE', body: '{}' }, A.tok); ok(r.status === 200, `владелец ролика удаляет комментарий (${r.status})`);
// XSS в комментарии хранится как текст, отдаётся JSON-ом
r = await call(`/api/skyvideo/video/${id}/comments`, { method: 'POST', body: JSON.stringify({ body: '<img src=x onerror=alert(1)>' }) }, Bu.tok);
r = await call(`/api/skyvideo/video/${id}/comments`, {}, C.tok); ok(/json/.test(r.headers.get('content-type')) && r.headers.get('x-content-type-options') === 'nosniff', 'комментарии отдаются как JSON + nosniff');
// монетизация: чужой не запрашивает
r = await call(`/api/skyvideo/video/${id}/monetize`, { method: 'POST', body: '{}' }, C.tok); ok(r.status >= 400, `чужой не запрашивает монетизацию (${r.status})`);
r = await call(`/api/skyvideo/video/${id}/revenue`, {}, C.tok); ok(r.status === 404 || r.status === 403, `чужой не видит доход (${r.status})`);
// приватность
r = await call(`/api/skyvideo/video/${id}`, { method: 'PATCH', body: JSON.stringify({ privacy: 'private' }) }, A.tok);
r = await fetch(B + `/api/skyvideo/feed`, { headers: { authorization: `Bearer ${C.tok}` } }).then((x) => x.json());
ok(!JSON.stringify(r).includes(id), 'после закрытия ролик пропал из ленты у других');
console.log(`\nИТОГО: ${pass} ok, ${fail} fail`);
