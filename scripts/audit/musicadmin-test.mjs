// Роялти-переключатели и передача владельца карточки. API с ADMIN_GATE=off OWNER_USERNAME=ownertest STUDIO_RATE_MULT=50
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const J = (b, method = 'POST') => ({ method, body: JSON.stringify(b) });
const ST = (p, o, tok) => call('/api/music/studio' + p, o ?? {}, tok);
const RY = (o, tok) => call('/api/admin/music/royalty', o ?? {}, tok);
const AC = (p, o, tok) => call('/api/admin/artist-cards' + p, o ?? {}, tok);
const uname = (u) => q(`select username from profiles where id='${u.pid}'`);

q(`update profiles set username='old'||substr(id,1,8) where lower(username)='ownertest'`);
const OWN = await mkuser(S, 'maOwn'); q(`update profiles set username='ownertest' where id='${OWN.pid}'`);
const mod = await mkuser(S, 'maMod'); q(`update profiles set is_admin=true, admin_role='content_admin' where id='${mod.pid}'`);
const a = await mkuser(S, 'maA'), b = await mkuser(S, 'maB'), x = await mkuser(S, 'maX');
const tag = Date.now().toString(16);
const card = `acd-ma${tag}`;
q(`insert into music_artist_cards(id,name,name_norm,owner_id) values ('${card}','Арт${tag}','арт${tag}','${a.pid}')`);
q(`insert into music_artist_claims(id,card_id,claimant_id,status) values ('clm-ma${tag}','${card}','${a.pid}','approved')`);
q(`insert into music_tracks(id, owner_id, title, artist, mime, bytes, status, artist_card_id) values ('trk-dddddddd-0000-0000-0000-${tag.padStart(12, '0')}','${a.pid}','Т','Арт','audio/mpeg',10,'published','${card}')`);
q(`update music_royalty_settings set mode='per_artist'`);

// переключатель артиста
let r = await ST(`/cards/${card}/royalty`, null, a.tok); t('по умолчанию выключено', r.data.setting === false && r.data.effective === false && r.data.source === 'artist', r.data);
r = await ST(`/cards/${card}/royalty`, null, x.tok); t('чужая карточка — 404', r.status === 404, r.data);
r = await ST(`/cards/${card}/royalty`, J({ enabled: true }, 'PUT'), x.tok); t('посторонний не включает', r.status === 404, r.data);
r = await ST(`/cards/${card}/royalty`, J({ enabled: 'yes' }, 'PUT'), a.tok); t('не булево значение', r.status === 400, r.data);
r = await ST(`/cards/${card}/royalty`, J({ enabled: true }, 'PUT'), a.tok); t('владелец включил', r.data.setting === true && r.data.effective === true, r.data);
await ST(`/cards/${card}/royalty`, J({ enabled: true }, 'PUT'), a.tok);
t('повтор значения журнал не засоряет', q(`select count(*) from music_royalty_log where card_id='${card}'`) === '1');

// глобальный
r = await RY(null, mod.tok); t('админ без владельца — нет доступа', r.status === 403, r.data);
r = await RY(null, OWN.tok); t('владелец видит режим', r.data.mode === 'per_artist' && r.data.artistsOn >= 1, r.data);
r = await RY(J({ mode: 'all_off', reason: '' }, 'PUT'), OWN.tok); t('без причины нельзя', r.data.error === 'reason_required', r.data);
r = await RY(J({ mode: 'nonsense', reason: 'Проверка режима' }, 'PUT'), OWN.tok); t('неизвестный режим', r.status === 400, r.data);
r = await RY(J({ mode: 'all_off', reason: 'Пауза роялти на проверку' }, 'PUT'), mod.tok); t('сотрудник не меняет глобальный', r.status === 403, r.data);
r = await RY(J({ mode: 'all_off', reason: 'Пауза роялти на проверку' }, 'PUT'), OWN.tok); t('глобально выключено', r.data.ok && r.data.changed, r.data);
r = await ST(`/cards/${card}/royalty`, null, a.tok); t('глобальный приоритетнее: настройка артиста сохранена, эффект выключен', r.data.setting === true && r.data.effective === false && r.data.source === 'global', r.data);
r = await RY(J({ mode: 'all_off', reason: 'Пауза роялти на проверку' }, 'PUT'), OWN.tok); t('повтор режима без изменений', r.data.ok && !r.data.changed, r.data);
r = await RY(J({ mode: 'all_on', reason: 'Включаем всем по решению' }, 'PUT'), OWN.tok);
await ST(`/cards/${card}/royalty`, J({ enabled: false }, 'PUT'), a.tok);
r = await ST(`/cards/${card}/royalty`, null, a.tok); t('all_on включает всем, даже при выключенной настройке', r.data.setting === false && r.data.effective === true, r.data);
r = await RY(J({ mode: 'per_artist', reason: 'Возврат к настройкам артистов' }, 'PUT'), OWN.tok);
r = await RY(null, OWN.tok); t('журнал: 3 глобальных изменения + карточные', r.data.log.filter((l) => l.scope === 'global').length >= 3 && r.data.log.every((l) => 'reason' in l), r.data);
t('начислений нет: таблиц выплат не создано', q("select count(*) from information_schema.tables where table_name like 'music_royalt%_pay%'") === '0');

// список и передача владельца
r = await AC('?q=Арт ' + tag, null, x.tok); t('список карточек — только сотрудникам', r.status === 403, r.data);
r = await AC('?q=' + encodeURIComponent('Арт' + tag), null, mod.tok); t('список по названию', r.data.cards.length === 1 && r.data.cards[0].ownerId === a.pid && r.data.cards[0].ownerUsername, r.data);
r = await AC('?q=' + card, null, mod.tok); t('поиск по id карточки', r.data.cards.some((c) => c.id === card), r.data);
r = await AC('?owner=none&limit=5', null, mod.tok); t('фильтр «без владельца»', r.status === 200 && r.data.cards.every((c) => c.ownerId === null), r.data);
r = await AC(`/${card}/transfer`, J({ username: await uname(b), reason: 'x' }), mod.tok); t('передача без причины', r.data.error === 'reason_required', r.data);
r = await AC(`/${card}/transfer`, J({ username: await uname(b), reason: 'Сменился менеджер артиста' }), x.tok); t('посторонний не передаёт', r.status === 403, r.data);
r = await AC(`/${card}/transfer`, J({ username: 'no_such_user_qq', reason: 'Сменился менеджер артиста' }), mod.tok); t('получатель не найден', r.status === 404, r.data);
r = await AC(`/${card}/transfer`, J({ username: await uname(a), reason: 'Сменился менеджер артиста' }), mod.tok); t('уже владелец', r.data.error === 'already_owner', r.data);
r = await AC(`/${card}/transfer`, J({ username: await uname(mod), reason: 'Сменился менеджер артиста' }), mod.tok); t('себе передать нельзя', r.data.error === 'self_review', r.data);
const trk = q(`select count(*) from music_tracks where artist_card_id='${card}'`);
const bName = await uname(b);
const par = await Promise.all([1, 2].map(() => AC(`/${card}/transfer`, J({ username: bName, reason: 'Сменился менеджер артиста' }), mod.tok)));
t('передача: один успех, второй «уже владелец»', par.filter((p) => p.data.ok).length === 1 && par.filter((p) => p.data.error === 'already_owner').length === 1, par.map((p) => p.data));
t('владелец теперь B', q(`select owner_id from music_artist_cards where id='${card}'`) === b.pid);
t('идентификатор карточки и треки на месте', q(`select count(*) from music_tracks where artist_card_id='${card}'`) === trk);
t('ровно одно действующее владение', q(`select count(*) from music_artist_claims where card_id='${card}' and status='approved'`) === '1');
r = await ST('/cards', null, a.tok); t('прежний владелец потерял доступ', r.data.cards.length === 0, r.data);
r = await ST('/cards', null, b.tok); t('новый видит карточку в студии', r.data.cards.length === 1, r.data);
r = await ST(`/cards/${card}/tracks`, null, b.tok); t('чужие (загруженные A) треки новый владелец не правит', r.data.tracks.length === 0, r.data);
t('перенос в журнале карточки', q(`select count(*) from music_artist_card_log where card_id='${card}' and event='owner_transferred'`) === '1');
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
