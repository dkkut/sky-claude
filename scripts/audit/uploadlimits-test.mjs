// Раздельные лимиты загрузки: личная загрузка и публикация (кино/музыка), права админа, параллельность, формат, объём.
// Запуск: . env.sh; ADMIN_GATE=off node server/server.mjs & node scripts/audit/uploadlimits-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const prime = (u) => { q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-ul-${u.pid}','${u.pid}','active','standard', now() + interval '30 days') on conflict do nothing`); q(`update profiles set is_prime=true where id='${u.pid}'`); };
const mp4 = (n = 2048) => { const b = Buffer.alloc(n, 1); b.write('ftyp', 4, 'latin1'); b.write('isom', 8, 'latin1'); return b; };
const webm = (n = 2048) => { const b = Buffer.alloc(n, 1); b[0] = 0x1a; b[1] = 0x45; b[2] = 0xdf; b[3] = 0xa3; return b; };
const mp3 = (n = 2048) => { const b = Buffer.alloc(n, 1); b.write('ID3', 0, 'latin1'); return b; };
const post = async (u, path, body) => {
  let r;
  try { r = await fetch(`${B}${path}`, { method: 'POST', headers: { authorization: `Bearer ${u.tok}`, 'content-type': 'application/octet-stream' }, body }); }
  catch (e) { return { status: 0, data: { error: String(e.cause?.code ?? e.message) } }; }
  const text = await r.text(); let d; try { d = JSON.parse(text); } catch { d = text; } return { status: r.status, data: d };
};
const limits = (u, body) => call('/api/admin/upload-limits', { method: 'PUT', body: JSON.stringify(body) }, u.tok);
const reset = async (A) => {
  q(`delete from upload_limits`);
  await call('/api/upload-limits', {}, A.tok); // прогрев
};

const U = await mkuser(S, 'ulUser'); const A = await mkuser(S, 'ulAdm'); const N = await mkuser(S, 'ulNoRight');
q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
q(`update profiles set is_admin=true, admin_role='read_only_admin' where id='${N.pid}'`);
prime(U); prime(A);
if (q(`select count(*) from upload_limits`) !== '0') { q(`delete from upload_limits`); console.log('(остатки прошлого прогона: ждём сброса кэша сервера, 16 с)'); await new Promise((x) => setTimeout(x, 16000)); }

let r = await call('/api/upload-limits', {}, U.tok);
t('человек видит действующие лимиты', r.status === 200 && r.data.personal.film.maxFileBytes > 0 && r.data.public.music.maxFiles === 0 && r.data.personalQuotaBytes === 10 * 1024 ** 3, JSON.stringify(r.data).slice(0, 200));
r = await call('/api/admin/upload-limits', {}, U.tok);
t('обычный человек не видит админку лимитов', r.status === 403);
r = await limits(N, { scope: 'personal', kind: 'film', maxFiles: 1 });
t('админ без права upload_limits не меняет', r.status === 403, r.status);
r = await call('/api/admin/upload-limits', {}, A.tok);
t('админ видит все строки и умолчания', r.status === 200 && r.data.limits.length === 5 && r.data.limits.every((x) => x.defaults), JSON.stringify(r.data).slice(0, 120));

// --- личная загрузка: формат
r = await limits(A, { scope: 'personal', kind: 'film', formats: ['mp4'] });
t('ограничили личные форматы кино до mp4', r.status === 200 && r.data.limit.formats.join() === 'mp4', JSON.stringify(r.data));
r = await post(U, '/api/film/upload?title=w', webm());
t('webm в личной загрузке отклонён (формат)', r.status === 400 && r.data.error === 'format_not_allowed', JSON.stringify(r));
r = await post(U, '/api/film/upload?title=m', mp4());
t('mp4 проходит', r.status === 201, JSON.stringify(r).slice(0, 200));
const movieId = r.data.movie?.id;

// --- личная загрузка: размер файла и число файлов
r = await limits(A, { scope: 'personal', kind: 'film', maxFileBytes: 1000 });
r = await post(U, '/api/film/upload?title=big', mp4(4096));
t('файл больше личного предела — 413', r.status === 413, JSON.stringify(r).slice(0, 160));
t('запись о несохранённом фильме не осталась', q(`select count(*) from film_movies where title='big'`) === '0');
r = await limits(A, { scope: 'personal', kind: 'film', maxFileBytes: null, maxFiles: 1 });
r = await post(U, '/api/film/upload?title=second', mp4());
t('второй файл при maxFiles=1 — 409', r.status === 409 && r.data.error === 'too_many_files', JSON.stringify(r).slice(0, 160));

// --- длительность
r = await limits(A, { scope: 'personal', kind: 'film', maxFiles: 0, maxDurationSec: 60 });
r = await post(U, '/api/film/upload?title=long&duration=300', mp4());
t('длительность больше предела — 400 too_long', r.status === 400 && r.data.error === 'too_long', JSON.stringify(r).slice(0, 160));
r = await post(U, '/api/film/upload?title=short&duration=30', mp4());
t('в пределах длительности — ок', r.status === 201, JSON.stringify(r).slice(0, 160));

// --- параллельность
await limits(A, { scope: 'personal', kind: 'film', maxDurationSec: 0, maxConcurrent: 1 });
const slow = (async () => {
  const body = mp4(30_000);
  const r2 = await fetch(`${B}/api/film/upload?title=slow`, { method: 'POST', headers: { authorization: `Bearer ${U.tok}`, 'content-type': 'application/octet-stream' },
    body: new ReadableStream({ async start(c) { c.enqueue(body.subarray(0, 5000)); await new Promise((x) => setTimeout(x, 1500)); c.enqueue(body.subarray(5000)); c.close(); } }), duplex: 'half' });
  return r2.status;
})();
await new Promise((x) => setTimeout(x, 500));
r = await post(U, '/api/film/upload?title=parallel', mp4());
t('вторая одновременная загрузка при maxConcurrent=1 — 429', r.status === 429 && r.data.error === 'too_many_uploads', JSON.stringify(r).slice(0, 160));
const st = await slow;
t('первая загрузка завершилась', st === 201, st);
r = await post(U, '/api/film/upload?title=after', mp4());
t('после неё лимит параллельности освобождён', r.status === 201, JSON.stringify(r).slice(0, 160));

// --- скорость: 80 кбит/с = 10 КБ/с, 40 КБ ≈ 4 с
await limits(A, { scope: 'personal', kind: 'music', speedKbps: 80 });
const t0 = Date.now();
r = await post(U, '/api/music/upload?title=thr&artist=a', mp3(30_000));
const dt = Date.now() - t0;
t('скорость ограничена (30 КБ при 10 КБ/с ≥ 2 с)', r.status === 201 && dt >= 2000, `${r.status} ${dt}мс`);
await limits(A, { scope: 'personal', kind: 'music', speedKbps: null });

// --- общий объём
await limits(A, { scope: 'personal', kind: 'all', totalBytesPrime: 3000, totalBytes: 3000 });
r = await post(U, '/api/music/upload?title=quota&artist=a', mp3(8000));
t('превышение общего объёма личного хранилища — 507', r.status === 507 && r.data.error === 'quota_exceeded', JSON.stringify(r).slice(0, 200));
r = await call('/api/upload-limits', {}, U.tok);
t('клиент видит новую квоту', r.data.personalQuotaBytes === 3000);
await limits(A, { scope: 'personal', kind: 'all', totalBytesPrime: null, totalBytes: null });

// --- публикация: лимиты отдельно от личных
q(`update film_movies set bytes = 5000, duration_sec = 100 where id = '${movieId}'`);
await limits(A, { scope: 'public', kind: 'film', maxFileBytes: 1000 });
r = await call(`/api/film/movie/${movieId}/submit`, { method: 'POST', body: JSON.stringify({ license: 'open' }) }, U.tok);
t('публикация: файл больше публичного предела — 422', r.status === 422 && r.data.error === 'file_too_large_public', JSON.stringify(r).slice(0, 200));
r = await limits(A, { scope: 'public', kind: 'film', maxFileBytes: null, formats: ['webm'] });
r = await call(`/api/film/movie/${movieId}/submit`, { method: 'POST', body: JSON.stringify({}) }, U.tok);
t('публикация: формат mp4 не в публичном списке — 422', r.status === 422 && r.data.error === 'format_not_allowed_public', JSON.stringify(r).slice(0, 200));
await limits(A, { scope: 'public', kind: 'film', formats: null, maxDurationSec: 50 });
r = await call(`/api/film/movie/${movieId}/submit`, { method: 'POST', body: JSON.stringify({}) }, U.tok);
t('публикация: длиннее публичного предела — 422', r.status === 422 && r.data.error === 'too_long_public', JSON.stringify(r).slice(0, 200));
t('личные лимиты не затронуты публичными (личная загрузка работает)', (await post(U, '/api/film/upload?title=still', mp4())).status === 201);
await limits(A, { scope: 'public', kind: 'film', maxDurationSec: null });
r = await call(`/api/film/movie/${movieId}/submit`, { method: 'POST', body: JSON.stringify({ license: 'open' }) }, U.tok);
t('после снятия ограничений публикация проходит', r.status === 200, JSON.stringify(r).slice(0, 200));

// --- публичное число
const m2 = (await post(U, '/api/film/upload?title=pub2', mp4())).data.movie?.id;
await limits(A, { scope: 'public', kind: 'film', maxFiles: 1 });
r = await call(`/api/film/movie/${m2}/submit`, { method: 'POST', body: JSON.stringify({}) }, U.tok);
t('публикация: больше maxFiles — 422', r.status === 422 && r.data.error === 'too_many_public', JSON.stringify(r).slice(0, 200));

// --- проверка ввода
r = await limits(A, { scope: 'public', kind: 'all', maxFiles: 1 });
t('kind=all только для личного', r.status === 400);
r = await limits(A, { scope: 'personal', kind: 'film', maxConcurrent: 0 });
t('maxConcurrent=0 недопустимо', r.status === 400);
r = await limits(A, { scope: 'personal', kind: 'film', formats: ['exe'] });
t('неизвестный формат отклонён', r.status === 400);
r = await limits(A, { scope: 'personal', kind: 'film' });
t('пустое изменение — 400', r.status === 400);
t('изменения попали в журнал администрации', Number(q(`select count(*) from admin_log where type='upload_limits'`)) >= 10);
q(`delete from upload_limits`);
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
