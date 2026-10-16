// Модерация и снятие контента из админки + лицензии треков (HTTP, API на :8080).
// Запуск: node scripts/audit/contentmod-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };

const adm = await mkuser(S, 'cmAdm'); const au = await mkuser(S, 'cmAuth'); const other = await mkuser(S, 'cmOther');
q(`update profiles set is_admin=true, admin_role='super_admin' where id='${adm.pid}'`);
q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-cm-${Date.now()}','${au.pid}','active','standard', now() + interval '30 days')`);
q(`update profiles set is_prime=true where id='${au.pid}'`);

// минимальный mp3-заголовок: сервер определяет тип по первым байтам
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 0]), Buffer.alloc(2048, 0xff)]);
const up = await call(`/api/music/upload?title=Тест&artist=Автор&license=cc-by&source=${encodeURIComponent('https://example.com/a')}`,
  { method: 'POST', body: mp3, headers: { 'content-type': 'application/octet-stream' } }, au.tok);
t('загрузка с лицензией', up.status < 300 && up.data?.track?.license === 'cc-by' && up.data.track.licenseSource === 'https://example.com/a', JSON.stringify(up.data));
const id = up.data?.track?.id;
let r = await call(`/api/music/track/${id}`, { method: 'PATCH', body: JSON.stringify({ license: 'нечто' }) }, au.tok);
t('неизвестная лицензия сводится к «own»', r.data?.track?.license === 'own', JSON.stringify(r.data));
r = await call(`/api/music/track/${id}`, { method: 'PATCH', body: JSON.stringify({ license: 'cc0', licenseSource: 'javascript:alert(1)' }) }, au.tok);
t('небезопасная ссылка источника отбрасывается', r.data?.track?.license === 'cc0' && !r.data.track.licenseSource, JSON.stringify(r.data));

// заявка → очередь
r = await call(`/api/music/track/${id}/submit`, { method: 'POST' }, au.tok);
t('отправлено на проверку', r.status === 200, JSON.stringify(r.data));
r = await call('/api/admin/content/queue', {}, other.tok);
t('обычному человеку очередь недоступна', r.status === 403);
r = await call('/api/admin/content/queue', {}, adm.tok);
t('в очереди есть трек', r.status === 200 && r.data.items.some((x) => x.id === id && x.kind === 'music'), JSON.stringify(r.data));
r = await call(`/api/admin/content/music/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve: false }) }, adm.tok);
t('отклонение без причины — отказ', r.status === 400 && r.data.error === 'reason_required');
r = await call(`/api/admin/content/music/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve: true }) }, other.tok);
t('решение без права — отказ', r.status === 403);
r = await call(`/api/admin/content/music/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve: true }) }, adm.tok);
t('одобрение', r.status === 200);
t('трек опубликован', q(`select status from music_tracks where id='${id}'`) === 'published');

// поиск
r = await call('/api/admin/content/search?kind=music&q=' + encodeURIComponent('Тест'), {}, adm.tok);
t('поиск находит', r.status === 200 && r.data.items.some((x) => x.id === id), JSON.stringify(r.data).slice(0, 200));
r = await call('/api/admin/content/search?q=%25', {}, adm.tok);
t('символ % в поиске не раскрывает всё', r.status === 200 && r.data.items.every((x) => x.title.includes('%')), String(r.data.items?.length));

// снятие
r = await call(`/api/admin/content/music/${id}`, { method: 'DELETE', body: JSON.stringify({ reason: '' }) }, adm.tok);
t('снятие без причины — отказ', r.status === 400);
r = await call(`/api/admin/content/music/${id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'жалоба правообладателя' }) }, other.tok);
t('снятие без права — отказ', r.status === 403);
r = await call(`/api/admin/content/music/${id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'жалоба правообладателя' }) }, adm.tok);
t('снятие', r.status === 200 && r.data.purgeInDays === 7);
t('запись остаётся, но скрыта (резерв)', q(`select status from music_tracks where id='${id}'`) === 'rejected');
t('автору ушло уведомление', Number(q(`select count(*) from gift_notifications where user_id='${au.pid}' and kind='content_moderation' and title like '%снят%'`)) >= 1);
t('действие записано в журнал', Number(q(`select count(*) from admin_log where target_id='${id}' and type='content_takedown'`)) === 1);
r = await call(`/api/admin/content/music/${id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'ещё раз' }) }, adm.tok);
t('повторное снятие — отказ', r.status === 400 && r.data.error === 'already_trashed');
r = await call('/api/admin/content/trash', {}, other.tok);
t('корзина без права — 403', r.status === 403);
r = await call('/api/admin/content/trash', {}, adm.tok);
const tr = r.data?.items?.find((x) => x.id === id);
t('в корзине виден материал с датой стирания', r.status === 200 && tr && new Date(tr.purgeAt) > Date.now() + 6 * 864e5, JSON.stringify(r.data));
r = await call(`/api/admin/content/trash/${tr.trashId}/restore`, { method: 'POST', body: '{}' }, other.tok);
t('возврат без права — 403', r.status === 403);
r = await call(`/api/admin/content/trash/${tr.trashId}/restore`, { method: 'POST', body: '{}' }, adm.tok);
t('возврат', r.status === 200 && q(`select status from music_tracks where id='${id}'`) === 'published');
r = await call(`/api/admin/content/trash/${tr.trashId}/restore`, { method: 'POST', body: '{}' }, adm.tok);
t('повторный возврат — 404', r.status === 404);
// снова снять и состарить резерв: уборка стирает
r = await call(`/api/admin/content/music/${id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'повторно' }) }, adm.tok);
t('снова снят', r.status === 200);
q(`update content_trash set purge_at = now() - interval '1 minute' where item_id='${id}' and state='held'`);
const { purgeTrashedContent } = await import('../../server/contentmod.mjs');
await purgeTrashedContent();
t('после срока запись стёрта', q(`select count(*) from music_tracks where id='${id}'`) === '0');
t('корзина помечена «стёрто»', q(`select state from content_trash where item_id='${id}' order by id desc limit 1`) === 'purged');
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
