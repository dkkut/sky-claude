// Sky Transfer (server/transfer.mjs). API: с TRANSFER_DIR (см. env.sh). node scripts/audit/transfer-test.mjs <каталог с api.log>
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const dev = () => 'dv' + crypto.randomBytes(14).toString('hex');
const api = (path, o = {}, tok, d) => call('/api/transfer' + path, o, tok, d ? { 'x-sky-device': d } : {});
const post = (p, b, tok, d) => api(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, tok, d);
const put = (p, buf, tok, d) => fetch(B + '/api/transfer' + p, { method: 'PUT', headers: { authorization: `Bearer ${tok}`, 'x-sky-device': d, 'content-type': 'application/octet-stream' }, body: buf }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const getBin = async (p, tok, d) => { const r = await fetch(B + '/api/transfer' + p, { headers: { authorization: `Bearer ${tok}`, 'x-sky-device': d } }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), hash: r.headers.get('x-chunk-sha256') }; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const CS = 262144;
const mkFile = (n) => crypto.randomBytes(n);
const plan = (file) => { const hs = []; for (let i = 0; i * CS < file.length; i++) hs.push(sha(file.subarray(i * CS, (i + 1) * CS))); return hs; };

const u = await mkuser(S, 'tfa'), v = await mkuser(S, 'tfb');
const sky = q(`select sky_id from profiles where id='${u.pid}'`);
const D1 = dev(), D2 = dev(), D3 = dev(), TV = dev();

let r = await api('', {}, u.tok); t('обзор без устройства: device=null', r.status === 200 && r.data.device === null, r.data);
r = await api('', {}); t('без входа — 401', r.status === 401, r.status);
r = await post('/devices/register', { name: 'Телефон', kind: 'phone' }, u.tok); t('нет заголовка устройства — отказ', r.status === 400, r);
r = await post('/devices/register', { name: 'Телефон', kind: 'phone' }, u.tok, D1); t('первое устройство подтверждено сразу', r.status === 200 && r.data.status === 'approved', r);
const id1 = r.data.id;
r = await post('/devices/register', { name: 'Ноутбук', kind: 'desktop' }, u.tok, D2); t('второе устройство ждёт подтверждения', r.data.status === 'pending', r);
const id2 = r.data.id;
r = await post('/devices/register', { name: 'ТВ', kind: 'tv' }, u.tok, TV); const idTv = r.data.id;

// незнакомое (pending) устройство не может ни отправлять, ни получать, ни подтверждать себя
const f = mkFile(CS * 2 + 1000);
r = await post('/send', { toDevice: id1, name: 'a.bin', size: f.length, chunkSize: CS, hashes: plan(f) }, u.tok, D2); t('pending-устройство не может отправлять', r.status === 403, r);
r = await post(`/devices/${id2}/approve`, {}, u.tok, D2); t('устройство не подтверждает само себя', r.status === 403, r);
r = await post('/send', { toDevice: id2, name: 'a.bin', size: f.length, chunkSize: CS, hashes: plan(f) }, u.tok, D1); t('получатель pending — отказ', r.status === 409, r);
r = await post(`/devices/${id2}/approve`, {}, v.tok, D1); t('чужой Sky ID не подтверждает моё устройство', r.status === 403 || r.status === 404, r);
r = await post(`/devices/${id2}/approve`, {}, u.tok, D1); t('подтверждение с подтверждённого устройства', r.status === 200, r);
await post(`/devices/${idTv}/approve`, {}, u.tok, D1);
r = await post('/send', { toDevice: idTv, name: 'a.bin', size: f.length, chunkSize: CS, hashes: plan(f) }, u.tok, D1); t('ТВ не принимает файлы', r.status === 409 && r.data.error === 'recipient_cannot_receive', r);

// проверки при создании
const send = (over = {}) => post('/send', { toDevice: id2, name: 'doc.bin', size: f.length, chunkSize: CS, hashes: plan(f), ...over }, u.tok, D1);
r = await send({ name: 'virus.exe' }); t('исполняемый тип запрещён', r.status === 415, r);
r = await send({ size: 10 * 1024 * 1024 * 1024, hashes: plan(f) }); t('слишком большой файл', r.status === 413 || r.status === 400, r);
r = await send({ hashes: ['zz'] }); t('неверные хеши', r.status === 400, r);
r = await send({ chunkSize: 10 }); t('неверный размер куска', r.status === 400, r);
r = await send({ toDevice: id1 }); t('самому себе нельзя', r.status === 400, r);
r = await send({ toDevice: 'dev-00000000-0000-0000-0000-000000000000' }); t('чужое/несуществующее устройство', r.status === 409, r);
r = await send({ name: '../../etc/passwd' }); t('имя файла очищается от путей', r.status === 200 && !/[\/\\]/.test(r.data.transfer.name) && !r.data.transfer.name.startsWith('.'), r);
if (r.data?.transfer?.id) await post(`/t/${r.data.transfer.id}/cancel`, {}, u.tok, D1);

// передача
r = await send(); t('создание передачи', r.status === 200 && r.data.transfer.status === 'uploading' && r.data.transfer.chunks === 3, r);
const X = r.data.transfer.id;
const ch = (i) => f.subarray(i * CS, (i + 1) * CS);
r = await put(`/t/${X}/chunk/0`, ch(1), u.tok, D1); t('кусок с чужим хешем отклонён', r.status === 422 && r.data.error === 'hash_mismatch', r);
r = await put(`/t/${X}/chunk/0`, ch(0), u.tok, D2); t('получатель не может загружать куски', r.status === 404, r);
r = await put(`/t/${X}/chunk/0`, ch(0), v.tok, D1); t('чужой Sky ID не видит передачу', r.status === 404 || r.status === 403, r);
r = await put(`/t/${X}/chunk/0`, ch(0), u.tok, D1); t('кусок 0', r.status === 200 && r.data.received === 1, r);
r = await put(`/t/${X}/chunk/0`, ch(0), u.tok, D1); t('повтор куска безвреден', r.status === 200 && r.data.received === 1, r);
r = await put(`/t/${X}/chunk/9`, ch(0), u.tok, D1); t('номер вне диапазона', r.status === 400, r);
// «обрыв»: проверяем возобновление — спрашиваем статус и дозагружаем недостающее
r = await api(`/t/${X}/status`, {}, u.tok, D1); t('статус показывает принятые куски (возобновление)', JSON.stringify(r.data.received) === '[0]', r.data);
r = await getBin(`/t/${X}/chunk/0`, u.tok, D2); t('скачать до готовности нельзя', r.status === 409, r.status);
r = await put(`/t/${X}/chunk/2`, ch(2), u.tok, D1); t('кусок 2 (последний, короче)', r.status === 200, r);
r = await put(`/t/${X}/chunk/1`, ch(1), u.tok, D1); t('кусок 1 — передача готова', r.status === 200 && r.data.received === 3, r);
r = await api('', {}, u.tok, D2); t('получатель видит входящую', r.data.active.some((x) => x.id === X && x.status === 'ready' && x.direction === 'in'), r.data.active);
// чужие не скачивают
r = await getBin(`/t/${X}/chunk/0`, v.tok, D2); t('другой Sky ID не скачает', r.status === 404 || r.status === 403, r.status);
r = await getBin(`/t/${X}/chunk/0`, u.tok, D1); t('отправитель как получатель не скачает', r.status === 404, r.status);
// скачивание и проверка
const got = []; let okAll = true;
for (let i = 0; i < 3; i++) { r = await getBin(`/t/${X}/chunk/${i}`, u.tok, D2); got.push(r.buf); if (r.status !== 200 || sha(r.buf) !== r.hash || !r.buf.equals(ch(i))) okAll = false; }
t('куски скачаны, хеши и байты совпадают', okAll && Buffer.concat(got).equals(f), r.status);
r = await post(`/t/${X}/complete`, { digest: 'f'.repeat(64) }, u.tok, D2); t('неверный digest — передача не доставлена', r.status === 422, r);
r = await api(`/t/${X}/status`, {}, u.tok, D2); t('после ошибки целостности статус failed, файлы удалены', r.data.transfer.status === 'failed' && r.data.transfer.filesGone === true, r.data.transfer);

// вторая передача — успех и удаление файлов
const f2 = mkFile(CS + 5); const p2 = plan(f2);
r = await post('/send', { toDevice: id2, name: 'ok.bin', size: f2.length, chunkSize: CS, hashes: p2 }, u.tok, D1); const Y = r.data.transfer.id;
await put(`/t/${Y}/chunk/0`, f2.subarray(0, CS), u.tok, D1); await put(`/t/${Y}/chunk/1`, f2.subarray(CS), u.tok, D1);
const digestY = crypto.createHash('sha256').update(p2.join('')).digest('hex');
t('файлы куска на диске есть', Number(q(`select count(*) from transfer_chunks where transfer_id='${Y}'`)) === 2);
r = await post(`/t/${Y}/complete`, { digest: digestY }, u.tok, D2); t('доставка подтверждена', r.status === 200, r);
r = await post(`/t/${Y}/complete`, { digest: digestY }, u.tok, D2); t('повторное подтверждение идемпотентно', r.status === 200 && r.data.duplicate, r);
t('файлы удалены сразу после получения', Number(q(`select count(*) from transfer_chunks where transfer_id='${Y}'`)) === 0 && q(`select files_gone from transfers where id='${Y}'`) === 't');
r = await getBin(`/t/${Y}/chunk/0`, u.tok, D2); t('после получения скачать повторно нельзя', r.status === 409, r.status);

// отмена
r = await post('/send', { toDevice: id2, name: 'c.bin', size: f2.length, chunkSize: CS, hashes: p2 }, u.tok, D1); const Z = r.data.transfer.id;
await put(`/t/${Z}/chunk/0`, f2.subarray(0, CS), u.tok, D1);
r = await post(`/t/${Z}/cancel`, {}, u.tok, D2); t('получатель может отменить', r.status === 200, r);
t('отмена удаляет файлы', Number(q(`select count(*) from transfer_chunks where transfer_id='${Z}'`)) === 0);
r = await put(`/t/${Z}/chunk/1`, f2.subarray(CS), u.tok, D1); t('в отменённую загружать нельзя', r.status === 409, r);

// настройки: подтверждение перед получением, запрет приёма
r = await api('/prefs', { method: 'PUT', body: JSON.stringify({ confirm: true, keepHours: 1, historyDays: 7 }) }, u.tok, D1); t('настройки сохранены', r.data.confirm === true && r.data.keepHours === 1 && r.data.historyDays === 7, r.data);
r = await api('/prefs', { method: 'PUT', body: JSON.stringify({ accept: 'evil', keepHours: 9999 }) }, u.tok, D1); t('мусор в настройках игнорируется', r.data.accept === 'own' && r.data.keepHours === 1, r.data);
r = await post('/send', { toDevice: id2, name: 'w.bin', size: f2.length, chunkSize: CS, hashes: p2 }, u.tok, D1); const W = r.data.transfer.id;
await put(`/t/${W}/chunk/0`, f2.subarray(0, CS), u.tok, D1); await put(`/t/${W}/chunk/1`, f2.subarray(CS), u.tok, D1);
r = await api(`/t/${W}/status`, {}, u.tok, D2); t('с подтверждением: статус awaiting_accept', r.data.transfer.status === 'awaiting_accept', r.data.transfer);
r = await getBin(`/t/${W}/chunk/0`, u.tok, D2); t('без согласия скачать нельзя', r.status === 409, r.status);
r = await post(`/t/${W}/accept`, {}, u.tok, D1); t('отправитель не может принять за получателя', r.status === 404, r);
r = await post(`/t/${W}/accept`, {}, u.tok, D2); t('получатель принимает', r.status === 200, r);
r = await getBin(`/t/${W}/chunk/0`, u.tok, D2); t('после согласия скачивание идёт', r.status === 200, r.status);
const digestW = crypto.createHash('sha256').update(p2.join('')).digest('hex');
r = await post(`/t/${W}/complete`, { digest: digestW }, u.tok, D2); t('доставлено', r.status === 200, r);
t('keepHours=1: файлы пока хранятся', Number(q(`select count(*) from transfer_chunks where transfer_id='${W}'`)) === 2);
q(`update transfers set expires_at = now() - interval '1 minute' where id='${W}'`);
const { sweepTransfers } = await import('../../server/transfer.mjs');
// sweep из этого процесса: те же БД и каталог
const sw = await sweepTransfers().catch((e) => ({ err: e.message })); t('уборка удалила файлы после срока хранения', sw.dropped >= 1 && Number(q(`select count(*) from transfer_chunks where transfer_id='${W}'`)) === 0, sw);
r = await post('/send', { toDevice: id2, name: 'x.bin', size: f2.length, chunkSize: CS, hashes: p2 }, u.tok, D1); const E = r.data.transfer.id;
q(`update transfers set expires_at = now() - interval '1 minute' where id='${E}'`);
await sweepTransfers(); r = await api(`/t/${E}/status`, {}, u.tok, D1); t('просроченная незавершённая передача: expired', r.data.transfer.status === 'expired', r.data.transfer);
r = await api('/prefs', { method: 'PUT', body: JSON.stringify({ accept: 'off' }) }, u.tok, D1);
r = await post('/send', { toDevice: id2, name: 'z.bin', size: f2.length, chunkSize: CS, hashes: p2 }, u.tok, D1); t('приём выключен — новые передачи запрещены', r.status === 403, r);
await api('/prefs', { method: 'PUT', body: JSON.stringify({ accept: 'own', confirm: false }) }, u.tok, D1);

// лимит активных
const ids = []; let capped = false;
for (let i = 0; i < 12; i++) { r = await post('/send', { toDevice: id2, name: `l${i}.bin`, size: f2.length, chunkSize: CS, hashes: p2 }, u.tok, D1); if (r.status === 429) { capped = true; break; } ids.push(r.data.transfer?.id); }
t('предел активных передач', capped && ids.length === 10, ids.length);
for (const x of ids) await post(`/t/${x}/cancel`, {}, u.tok, D1);

// удаление устройства отменяет его передачи
r = await post('/send', { toDevice: id2, name: 'd.bin', size: f2.length, chunkSize: CS, hashes: p2 }, u.tok, D1); const R = r.data.transfer.id;
r = await api(`/devices/${id2}`, { method: 'DELETE' }, u.tok, D2); t('устройство не удаляет само себя', r.status === 400 || r.status === 403, r);
r = await api(`/devices/${id2}`, { method: 'DELETE' }, u.tok, D1); t('удаление устройства', r.status === 200, r);
r = await api(`/t/${R}/status`, {}, u.tok, D1); t('передачи удалённого устройства отменены', r.data.transfer.status === 'cancelled', r.data.transfer);
r = await post('/devices/heartbeat', {}, u.tok, D2); t('удалённое устройство больше не принимается', r.status === 403, r);

// история
r = await api('', {}, u.tok, D1); t('история содержит завершённые', r.data.history.length >= 4, r.data.history.length);
r = await api(`/t/${Y}`, { method: 'DELETE' }, u.tok, D1); t('удаление записи истории', r.status === 200, r);
r = await api('/history', { method: 'DELETE' }, u.tok, D1); t('очистка истории', r.status === 200, r);
r = await api('', {}, u.tok, D1); t('история пуста', r.data.history.length === 0, r.data.history.length);
console.log(`Итого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
