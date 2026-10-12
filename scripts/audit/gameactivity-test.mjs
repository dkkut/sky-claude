// Активность в играх: пульс Blox/«известных» игр/своей игры, итоги, показ другим только с согласия.
//   (. env.sh; node scripts/audit/gameactivity-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x : JSON.stringify(x)); } };
const P = (path, o, tok) => call('/api/games/activity' + path, o, tok);
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });

const A = await mkuser(S, 'gaA'); const B = await mkuser(S, 'gaB');
let r = await call('/api/games/activity/ping', J({ kind: 'game', refId: 'cs2' }));
t('без входа — 401', r.status === 401);
r = await P('/ping', J({ kind: 'nope', refId: 'x' }), A.tok);
t('неизвестный вид отклонён', r.status === 400 && r.data.error === 'bad_kind');
r = await P('/ping', J({ kind: 'blox', refId: 'нет-такой' }), A.tok);
t('несуществующая игра Blox → 404', r.status === 404);
r = await P('/ping', J({ kind: 'game', refId: 'не-из-списка' }), A.tok);
t('«своя игра» без названия отклонена', r.status === 400 && r.data.error === 'bad_title');
r = await P('/ping', J({ kind: 'game', refId: 'cs2', title: 'ПОДДЕЛКА' }), A.tok);
t('известная игра: название берёт сервер, не клиент', r.status === 200 && r.data.title === 'Counter-Strike 2', JSON.stringify(r.data));
r = await P('/ping', J({ kind: 'game', refId: 'cs2' }), A.tok);
t('повторный пульс — та же сессия', Number(q(`select count(*) from game_sessions where user_id='${A.pid}'`)) === 1);

// сессия «идёт уже 40 минут»
q(`update game_sessions set started_at = now() - interval '40 minutes' where user_id='${A.pid}'`);
r = await P('/summary', {}, A.tok);
t('итоги: игра, ~40 минут, идёт сейчас', r.data.playing?.refId === 'cs2' && r.data.games[0].totalSec >= 2390 && r.data.games[0].totalSec <= 2410, JSON.stringify(r.data.games[0]));
t('в итогах есть список известных игр', r.data.known.length > 10 && r.data.known.every((g) => g.id && g.title));
r = await call('/api/media/activity', {}, A.tok);
t('активность Sky Media включает игры за сегодня/неделю', r.data.data.today.games >= 2390 && r.data.data.week.games >= 2390 && r.data.data.playing?.title === 'Counter-Strike 2', JSON.stringify(r.data.data));

// другим — только с согласия
r = await P(`/of?ids=${A.pid}`, {}, B.tok);
t('показ выключен по умолчанию: другим не видно', !r.data.playing[A.pid], JSON.stringify(r.data));
r = await P('/share', { method: 'PUT', body: JSON.stringify({ share: true }) }, A.tok);
r = await P(`/of?ids=${A.pid},${B.pid}`, {}, B.tok);
t('после согласия видно: во что играет', r.data.playing[A.pid]?.title === 'Counter-Strike 2' && !r.data.playing[B.pid], JSON.stringify(r.data));

// своя игра закрывает предыдущую
r = await P('/ping', J({ kind: 'game', refId: 'custom', title: 'Моя настолка' }), A.tok);
t('своя игра: название от человека', r.status === 200 && r.data.title === 'Моя настолка');
r = await P('/summary', {}, A.tok);
t('одновременно одна игра: прежняя закрыта', r.data.playing.title === 'Моя настолка' && Number(q(`select count(*) from game_sessions where user_id='${A.pid}' and ended_at is null`)) === 1);

// разрыв пульса > 150 с — игра «не играет»
q(`update game_sessions set last_seen_at = now() - interval '5 minutes' where user_id='${A.pid}' and ended_at is null`);
r = await P(`/of?ids=${A.pid}`, {}, B.tok);
t('нет пульса дольше 150 с: больше не «играет»', !r.data.playing[A.pid]);
r = await P('/ping', J({ kind: 'game', refId: 'custom', title: 'Моя настолка' }), A.tok);
t('после долгого разрыва начинается новая сессия', Number(q(`select count(*) from game_sessions where user_id='${A.pid}' and ref_id like 'custom:%'`)) === 2);
await P('/stop', J({}), A.tok);
r = await P('/summary', {}, A.tok);
t('«закончил играть»: сейчас не играет', r.data.playing === null);

// Blox: настоящая игра из базы
const gid = q(`select id from blox_games limit 1`);
if (gid) {
  r = await P('/ping', J({ kind: 'blox', refId: gid }), B.tok);
  t('Blox: пульс по существующей игре, название из базы', r.status === 200 && r.data.title === q(`select title from blox_games where id='${gid}'`), JSON.stringify(r.data));
} else console.log('пропуск Blox: игр нет в базе');
r = await P(`/of?ids=${'x,'.repeat(100)}`, {}, B.tok);
t('запрос чужого присутствия ограничен (не падает на 100 ids)', r.status === 200);
q(`delete from game_sessions where user_id in ('${A.pid}','${B.pid}')`);
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
