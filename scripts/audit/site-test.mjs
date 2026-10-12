// Сайт из админки (server/sitecms.mjs): ссылки, скачивание с загрузкой файлов, статус, апелляции, заявки на релиз.
//   (. env.sh; SITE_DIR=<каталог> API запущен с тем же SITE_DIR; node scripts/audit/site-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
let n = 0; const ip = () => `192.0.2.${(++n % 250) + 1}`;
const pub = (p, o = {}) => call(p, { ...o, headers: { 'x-real-ip': ip(), ...(o.headers || {}) } });
const post = (p, b, tok, i) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}), headers: { 'x-real-ip': i ?? ip() } }, tok);
const put = (p, b, tok) => call(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }, tok);
const raw = async (p, buf, tok, i) => { const r = await fetch(B + p, { method: 'POST', body: buf, headers: { 'content-type': 'application/octet-stream', 'x-real-ip': i ?? ip(), ...(tok ? { authorization: `Bearer ${tok}` } : {}) } }); const x = await r.text(); let d; try { d = JSON.parse(x); } catch { d = x; } return { status: r.status, data: d }; };
const mailTo = (email) => { const log = readFileSync(S + '/api.log', 'utf8'); const k = log.lastIndexOf(email + ' |'); return k < 0 ? '' : log.slice(k, k + 700); };

q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const own = await mkuser(S, 'siteown'); q(`update profiles set username='ownertest' where id='${own.pid}'`);
const usr = await mkuser(S, 'siteusr');
const png = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), Buffer.alloc(300, 7)]);

// ── Открытый контент
let r = await pub('/api/site/public');
t('открытый контент: ссылки, 6 платформ, статус из 8 сервисов', r.status === 200 && r.data.links.web && r.data.downloads.length === 6 && r.data.status.components.length === 8 && r.data.status.overall === 'operational', JSON.stringify(r.data).slice(0, 150));
t('без входа админские ручки закрыты, обычному человеку — 403', (await call('/api/admin/site/overview')).status === 401 && (await call('/api/admin/site/overview', {}, usr.tok)).status === 403);
r = await call('/api/admin/site/overview', {}, own.tok);
t('владелец видит сводку', r.status === 200 && 'appealsOpen' in r.data);

// ── Ссылки
r = await put('/api/admin/site/links', { links: [{ key: 'web', label: 'Веб', url: 'javascript:alert(1)' }] }, own.tok);
t('javascript: в ссылку не принимается', r.status === 400 && r.data.error === 'bad_url');
r = await put('/api/admin/site/links', { links: [{ key: 'Bad Key', label: 'x', url: 'https://a.example' }] }, own.tok);
t('кривой ключ не принимается', r.data.error === 'bad_key');
const links0 = (await call('/api/admin/site/links', {}, own.tok)).data.links;
r = await put('/api/admin/site/links', { links: [...links0.map((l) => (l.key === 'discord' ? { ...l, url: 'https://discord.gg/NEW123' } : l)), { key: 'support_mail', label: 'Почта', url: 'mailto:help@example.com' }] }, own.tok);
t('ссылки сохранены, добавлена новая (mailto)', r.status === 200);
r = await pub('/api/site/public');
t('на сайте сразу новая ссылка Discord и почта', r.data.links.discord === 'https://discord.gg/NEW123' && r.data.links.support_mail === 'mailto:help@example.com');
await put('/api/admin/site/links', { links: links0 }, own.tok);
t('ссылка, которой нет в списке, удаляется', !(await pub('/api/site/public')).data.links.support_mail);

// ── Скачивание: загрузка файла
r = await put('/api/admin/site/downloads/android', { status: 'available', version: '4.0.1', url: 'https://example.com/old.apk' }, own.tok);
t('карточка Android: доступно, версия, внешняя ссылка', r.status === 200);
t('внешняя ссылка отдаётся как есть', (await pub('/api/site/public')).data.downloads.find((d) => d.platform === 'android').href === 'https://example.com/old.apk');
r = await raw('/api/admin/site/downloads/android/file?name=notes.txt', Buffer.alloc(1000, 1), own.tok);
t('файл не apk/exe/… не принимается', r.status === 400 && r.data.error === 'bad_extension');
r = await raw('/api/admin/site/downloads/android/file?name=Sky.apk', Buffer.alloc(1000, 1), usr.tok);
t('обычный человек загрузить файл не может', r.status === 403);
const apk = crypto.randomBytes(3 * 1024 * 1024 + 123);
r = await raw('/api/admin/site/downloads/android/file?name=Sky-4.0.1.apk', apk, own.tok);
t('владелец загрузил apk (3 МБ), сервер посчитал хеш', r.status === 200 && r.data.size === apk.length && r.data.sha256 === crypto.createHash('sha256').update(apk).digest('hex'), JSON.stringify(r.data));
let pubD = (await pub('/api/site/public')).data.downloads.find((d) => d.platform === 'android');
t('на сайте ссылка стала нашей, с именем, размером и хешем', pubD.href === '/api/site/download/android' && pubD.file.name === 'Sky-4.0.1.apk' && pubD.file.size === apk.length && pubD.file.sha256.length === 64, JSON.stringify(pubD));
let dl = await fetch(B + '/api/site/download/android', { headers: { 'x-real-ip': ip() } });
const got = Buffer.from(await dl.arrayBuffer());
t('скачивание отдаёт те же байты, как вложение', dl.status === 200 && got.equals(apk) && /attachment; filename\*=UTF-8''Sky-4\.0\.1\.apk/.test(dl.headers.get('content-disposition')) && dl.headers.get('content-type') === 'application/vnd.android.package-archive');
dl = await fetch(B + '/api/site/download/android', { headers: { range: 'bytes=100-199', 'x-real-ip': ip() } });
t('докачка (Range) работает: 206 и ровно 100 байт', dl.status === 206 && (await dl.arrayBuffer()).byteLength === 100 && dl.headers.get('content-range') === `bytes 100-199/${apk.length}`);
t('счётчик скачиваний растёт', Number(q(`select downloads from site_files order by created_at desc limit 1`)) >= 2);
const apk2 = crypto.randomBytes(5000);
r = await raw('/api/admin/site/downloads/android/file?name=Sky-4.0.2.apk', apk2, own.tok);
t('новая версия заменила файл, старый стёрт', r.status === 200 && q(`select count(*) from site_files where name='Sky-4.0.1.apk'`) === '0');
r = await put('/api/admin/site/downloads/android', { status: 'hidden' }, own.tok);
t('скрытая карточка исчезла с сайта и не скачивается', !(await pub('/api/site/public')).data.downloads.some((d) => d.platform === 'android') && (await pub('/api/site/download/android')).status === 404);
await put('/api/admin/site/downloads/android', { status: 'available' }, own.tok);
r = await call('/api/admin/site/downloads/android/file', { method: 'DELETE' }, own.tok);
t('файл удалён — вернулась внешняя ссылка', r.status === 200 && (await pub('/api/site/public')).data.downloads.find((d) => d.platform === 'android').href === 'https://example.com/old.apk');
r = await put('/api/admin/site/downloads/android', { status: 'weird' }, own.tok);
t('неизвестный статус карточки не принимается', r.data.error === 'bad_status');
await put('/api/admin/site/downloads/android', { status: 'soon', url: '', version: '' }, own.tok);

// ── Статус
const st0 = (await call('/api/admin/site/status', {}, own.tok)).data;
r = await put('/api/admin/site/status', { ...st0, components: st0.components.map((c, i) => (i === 1 ? { ...c, state: 'bogus' } : c)) }, own.tok);
t('кривое состояние сервиса не принимается', r.data.error === 'bad_state');
r = await put('/api/admin/site/status', { headline: 'Плановые работы', note: 'Музыка недоступна до 18:00', components: st0.components.map((c) => (c.id === 'music' ? { ...c, state: 'maintenance', note: 'Работы' } : c)) }, own.tok);
r = await pub('/api/site/public');
t('статус на сайте: общий «работы», заголовок и заметка', r.data.status.overall === 'maintenance' && r.data.status.headline === 'Плановые работы' && r.data.status.components.find((c) => c.id === 'music').state === 'maintenance');
await put('/api/admin/site/status', { headline: '', note: '', components: st0.components }, own.tok);

// ── Апелляции
r = await post('/api/site/appeals', { kind: 'zzz', email: 'a@b.ru', body: 'достаточно длинный текст' });
t('неизвестный тип апелляции — отказ', r.status === 400 && r.data.error === 'bad_kind');
r = await post('/api/site/appeals', { kind: 'other', email: 'не-почта', body: 'достаточно длинный текст' });
t('плохая почта — отказ', r.data.error === 'bad_email');
r = await post('/api/site/appeals', { kind: 'other', email: 'a@b.ru', body: 'мало' });
t('слишком короткий текст — отказ', r.data.error === 'text_too_short');
const email = `ap${Date.now()}@example.com`;
r = await post('/api/site/appeals', { kind: 'account_block', username: '@tester', email, ref: 'SKY-1111-2222', body: 'Меня заблокировали по ошибке, прошу пересмотреть решение.', lang: 'ru' });
const ap = r.data;
t('апелляция принята: код SKY-XXXX-XXXX и секрет подачи', r.status === 200 && /^SKY-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(ap.code) && ap.token, JSON.stringify(r.data));
await new Promise((x) => setTimeout(x, 700));
t('человеку ушло письмо с номером', mailTo(email).includes(ap.code));
t('в базе секрет подачи только хешем', !q(`select token_hash from site_appeals where code='${ap.code}'`).includes(ap.token));
const up = (owner, code, token, role, name, buf) => raw(`/api/site/upload?owner=${owner}&code=${code}&token=${token}&role=${role}&name=${encodeURIComponent(name)}`, buf);
r = await up('appeal', ap.code, 'чужой', 'file', 's.png', png);
t('вложение с чужим секретом — отказ', r.status === 404);
r = await up('appeal', ap.code, ap.token, 'file', 'fake.png', Buffer.from('MZ' + 'x'.repeat(500)));
t('exe под видом картинки не принимается (тип по байтам)', r.status === 415);
r = await up('appeal', ap.code, ap.token, 'file', 'screen.png', png);
t('скриншот приложен', r.status === 200 && r.data.mime === 'image/png');
await up('appeal', ap.code, ap.token, 'file', 's2.png', png); await up('appeal', ap.code, ap.token, 'file', 's3.png', png);
r = await up('appeal', ap.code, ap.token, 'file', 's4.png', png);
t('четвёртый файл — отказ (не больше трёх)', r.status === 409 && r.data.error === 'too_many_files');
r = await pub('/api/site/check', { method: 'POST', body: JSON.stringify({ code: ap.code, email }) });
t('статус по коду и почте: «new»', r.status === 200 && r.data.status === 'new' && r.data.kind === 'appeal');
r = await post('/api/site/check', { code: ap.code, email: 'other@example.com' });
t('чужая почта к этому коду — не найдено', r.status === 404);
r = await post('/api/site/appeals', { kind: 'other', email: 'bot@b.ru', body: 'спам спам спам спам', website: 'http://spam' });
t('ловушка для ботов: вид «принято», в базу не попало', r.status === 200 && q(`select count(*) from site_appeals where email='bot@b.ru'`) === '0');
// Админ
r = await call('/api/admin/site/appeals', {}, own.tok);
const item = r.data.items.find((x) => x.code === ap.code);
t('в очереди админки: тип, ник, почта, номер решения, текст', item && item.kind === 'account_block' && item.username === 'tester' && item.email === email && item.ref === 'SKY-1111-2222' && /по ошибке/.test(item.body), JSON.stringify(item));
r = await call(`/api/admin/site/appeals/${item.id}`, {}, own.tok);
t('карточка: 3 вложения', r.status === 200 && r.data.attachments.length === 3);
const dla = await fetch(`${B}/api/admin/site/attachments/${r.data.attachments[0].id}`, { headers: { authorization: `Bearer ${own.tok}` } });
t('вложение скачивается теми же байтами', dla.status === 200 && Buffer.from(await dla.arrayBuffer()).equals(png));
t('обычному человеку вложение не отдаётся', (await call(`/api/admin/site/attachments/${r.data.attachments[0].id}`, {}, usr.tok)).status === 403);
r = await post(`/api/admin/site/appeals/${item.id}/decide`, { status: 'accepted' }, own.tok);
t('итоговое решение без ответа человеку — отказ', r.data.error === 'answer_required');
r = await post(`/api/admin/site/appeals/${item.id}/decide`, { status: 'review' }, own.tok);
t('«на рассмотрении» без ответа можно', r.status === 200 && r.data.item.status === 'review');
r = await post(`/api/admin/site/appeals/${item.id}/decide`, { status: 'accepted', answer: 'Блокировка снята, приносим извинения.' }, own.tok);
t('решение с ответом сохранено', r.status === 200 && r.data.item.status === 'accepted');
await new Promise((x) => setTimeout(x, 700));
t('человеку ушло письмо с решением и ответом', /Блокировка снята/.test(mailTo(email)));
r = await post('/api/site/check', { code: ap.code, email });
t('на сайте по коду видно «удовлетворена» и ответ', r.data.status === 'accepted' && /Блокировка снята/.test(r.data.answer) && r.data.answeredAt);
r = await post(`/api/admin/site/appeals/${item.id}/decide`, { status: 'accepted', answer: 'x' }, usr.tok);
t('обычный человек решение принять не может', r.status === 403);

// ── Заявка на релиз
const em2 = `rel${Date.now()}@example.com`;
r = await post('/api/site/releases', { kind: 'music', email: em2, title: 'Мой трек', fields: { artist: 'Артист', genre: 'Pop' } });
const rel = r.data;
t('заявка на релиз принята: REL-XXXX-XXXX', r.status === 200 && /^REL-/.test(rel.code));
r = await up('release', rel.code, rel.token, 'audio', 'track.mp3', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2000, 3)]));
t('аудио (mp3) приложено', r.status === 200 && r.data.mime === 'audio/mpeg', JSON.stringify(r.data));
r = await up('release', rel.code, rel.token, 'audio', 'cover.png', png);
t('картинка в роли «аудио» не принимается', r.status === 415);
r = await up('release', rel.code, rel.token, 'cover', 'cover.png', png);
t('обложка приложена', r.status === 200);
r = await call('/api/admin/site/releases', {}, own.tok);
const ri = r.data.items.find((x) => x.code === rel.code);
t('в очереди релизов: название, почта, поля анкеты', ri && ri.title === 'Мой трек' && ri.data.artist === 'Артист');
r = await post(`/api/admin/site/releases/${ri.id}/decide`, { status: 'approved', answer: 'Одобрено, загрузим в каталог.' }, own.tok);
t('релиз одобрен, человеку ушло письмо', r.status === 200 && (await new Promise((x) => setTimeout(x, 700)), /Одобрено/.test(mailTo(em2))));
r = await post('/api/site/check', { code: rel.code, email: em2 });
t('статус релиза виден на сайте', r.data.status === 'approved' && r.data.kind === 'release');

// ── Пределы и режимы
let lim = 0; for (let i = 0; i < 6; i++) { const x = await post('/api/site/appeals', { kind: 'other', email: 'x@b.ru', body: 'достаточно длинный текст' }, null, '198.18.0.9'); if (x.status === 429) lim++; }
t('подача заявок с одного адреса ограничена', lim >= 3, String(lim));
q(`update platform_maintenance set active=true, reason='t', set_at=now()`);
t('в «Технических работах» сайт (статус, скачивание) продолжает отвечать', (await pub('/api/site/public')).status === 200);
q(`update platform_maintenance set active=false, reason='', set_at=NULL`);
t('действия записаны в журнал администрации', Number(q(`select count(*) from admin_log where type like 'site_%'`)) >= 8);
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
