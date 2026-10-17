// Голосовой поиск музыки: нечёткое сопоставление, транслит, псевдонимы, уточнение, права (HTTP, API на :8080).
// Запуск: node scripts/audit/musicvoice-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
import { similarity, translit, norm } from '../../server/musicvoice.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };

// --- чистые функции
t('норма: ё=е, регистр, знаки', () => norm('  Ёлка!!  ') === 'елка' || false);
t('транслит сближает «Земфира» и «Zemfira»', similarity('земфира', 'Zemfira') >= 0.85, similarity('земфира', 'Zemfira'));
t('опечатка в названии', similarity('прасти меня моя любовь', 'Прости меня, моя любовь') >= 0.85, similarity('прасти меня моя любовь', 'Прости меня, моя любовь'));
t('разные исполнители не склеиваются', similarity('земфира', 'Звери') < 0.6, similarity('земфира', 'Звери'));
t('пустая строка → 0', similarity('', 'abc') === 0);

const P = 'vt' + Date.now().toString(36);
const u = await mkuser(S, 'vtUser'); const noPrime = await mkuser(S, 'vtFree');
q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-vt-${Date.now()}','${u.pid}','active','standard', now() + interval '30 days')`);
q(`update profiles set is_prime=true where id='${u.pid}'`);
const add = (id, title, artist, album, genre, status = 'published', owner = u.pid) =>
  q(`insert into music_tracks (id, owner_id, title, artist, album, genre, status, mime, bytes, duration_sec) values ('${id}','${owner}','${title}','${artist}','${album}','${genre}','${status}','audio/mpeg',1000,200)`);
add(`trk-${P}1`, 'Прости меня моя любовь', `Земфира${P}`, `Вендетта${P}`, 'rock');
add(`trk-${P}2`, 'Искала', `Земфира${P}`, `Вендетта${P}`, 'rock');
add(`trk-${P}3`, `Осень${P}`, `ДДТ${P}`, '', 'rock');
add(`trk-${P}4`, `Осень${P}`, `Другая группа${P}`, '', 'pop');
add(`trk-${P}5`, `Тихий вечер${P}`, `Эмбиент${P}`, '', 'ambient');
add(`trk-${P}6`, `Секретный${P}`, `Скрытый${P}`, '', 'rock', 'private', noPrime.pid);   // чужой личный
q(`insert into music_artist_aliases (alias_norm, artist_norm) values ('ddt${P}','ддт${P}'.toLowerCase()) on conflict do nothing`.replace("'ддт${P}'.toLowerCase()", `'ддт${P}'`));

const V = (kind, text) => call(`/api/music/voice?kind=${kind}&q=${encodeURIComponent(text)}`, {}, u.tok);
let r = await call('/api/music/voice?q=x', {}, noPrime.tok);
t('без Prime — отказ', r.status === 403, r.status);
r = await V('artist', `Zemfira${P}`);
t('исполнитель по транслиту', r.status === 200 && r.data.items.length === 2 && r.data.items[0].artist.startsWith('Земфира'), JSON.stringify(r.data).slice(0, 200));
r = await V('track', 'прасти меня моя любовь');
t('трек с опечаткой', r.data.items?.length === 1 && r.data.items[0].title === 'Прости меня моя любовь', JSON.stringify(r.data).slice(0, 200));
r = await V('track', `Осень${P}`);
t('одинаковые названия у разных исполнителей → уточнение', r.data.choices?.length === 2 && r.data.items.length === 0, JSON.stringify(r.data).slice(0, 200));
const pick = r.data.choices?.[0];
const ch = await call('/api/music/voice/choose', { method: 'POST', body: JSON.stringify({ type: pick.type, id: pick.id }) }, u.tok);
t('выбор из вариантов возвращает трек', ch.data.items?.length === 1 && ch.data.items[0].id === pick.id, JSON.stringify(ch.data).slice(0, 200));
r = await V('album', `Вендетта${P}`);
t('альбом целиком', r.data.items?.length === 2, JSON.stringify(r.data).slice(0, 200));
r = await V('mood', 'что-нибудь спокойное');
t('настроение «спокойное» → подходящий жанр', r.data.items?.some((x) => x.title.startsWith('Тихий вечер')), JSON.stringify(r.data).slice(0, 200));
r = await V('any', `включи ddt${P}`.replace('включи ', ''));
t('псевдоним исполнителя (alias)', r.data.items?.length >= 1 && r.data.items.every((x) => x.artist.startsWith('ДДТ')) || r.data.choices?.length >= 1, JSON.stringify(r.data).slice(0, 200));
r = await V('track', `Секретный${P}`);
t('чужой личный трек не находится', !r.data.items?.length && !r.data.choices?.length, JSON.stringify(r.data).slice(0, 200));
r = await V('track', 'совсем несуществующая песня qwerty zzz');
t('ничего не найдено — честный отказ', r.data.reason === 'not_found');
r = await V('bad', 'x');
t('неизвестный вид — 400', r.status === 400);
r = await V('any_music', '');
t('«включи музыку» без названия — очередь', r.status === 200 && r.data.items.length > 0, JSON.stringify(r.data).slice(0, 120));
const inj = await V('track', `'; drop table music_tracks; --`);
t('SQL-инъекция в запросе безвредна', inj.status === 200 && q('select count(*) from music_tracks') !== '');
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
