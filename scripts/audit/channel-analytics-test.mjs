// Аналитика канала Sky Video: /api/skyvideo/analytics и подписчики в карточке канала.
// Запуск: node scripts/audit/channel-analytics-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const a = await mkuser(S, 'chA'); const v1 = await mkuser(S, 'chV1'); const v2 = await mkuser(S, 'chV2');
const U = Date.now().toString(36);
q(`insert into sky_videos(id,owner_id,title,mime,status,privacy,width,height,views,likes,published_at) values ('vid-${U}-1','${a.pid}','Длинное','video/mp4','published','public',1920,1080,2,1,now())`);
q(`insert into sky_videos(id,owner_id,title,mime,status,privacy,width,height,views,likes,published_at) values ('vid-${U}-2','${a.pid}','Шорт','video/mp4','published','public',720,1280,1,0,now())`);
q(`insert into sky_videos(id,owner_id,title,mime,status,privacy,width,height,views,likes) values ('vid-${U}-3','${a.pid}','Черновик','video/mp4','draft','public',1920,1080,9,9)`);
q(`insert into sky_video_views(user_id,video_id) values ('${v1.pid}','vid-${U}-1'),('${v2.pid}','vid-${U}-1'),('${v1.pid}','vid-${U}-2')`);
q(`insert into sky_video_comments(id,video_id,author_id,body) values ('c-${U}','vid-${U}-1','${v1.pid}','x')`);
q(`insert into follows(follower_id,following_id) values ('${v1.pid}','${a.pid}'),('${v2.pid}','${a.pid}')`);

let r = await call('/api/skyvideo/analytics', {}, a.tok);
t('аналитика отвечает', r.status === 200, JSON.stringify(r.data).slice(0, 200));
t('подписчики посчитаны', r.data.subscribers === 2, String(r.data.subscribers));
t('черновики не входят в итоги', r.data.videos === 2 && r.data.views === 3 && r.data.likes === 1, JSON.stringify([r.data.videos, r.data.views, r.data.likes]));
t('комментарии', r.data.comments === 1);
t('график за 28 дней, сегодня 3 новых зрителя', r.data.perDay.length === 28 && r.data.perDay[27].views === 3 && r.data.last7 === 3, JSON.stringify(r.data.perDay.slice(-2)));
t('последнее видео — опубликованное', r.data.lastVideo && r.data.lastVideo.id.startsWith('vid-'), JSON.stringify(r.data.lastVideo?.title));
t('лучшие Shorts — только вертикальные', r.data.topShorts.length === 1 && r.data.topShorts[0].title === 'Шорт');
r = await call('/api/skyvideo/analytics', {}, v1.tok);
t('у чужого — своя аналитика (пустая), а не чужая', r.status === 200 && r.data.videos === 0 && r.data.views === 0);
r = await call(`/api/skyvideo/channel/${a.pid}`, {}, v1.tok);
t('карточка канала: подписчики', r.status === 200 && r.data.channel.subscribers === 2, JSON.stringify(r.data.channel));
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
