// ELO в Sky Games: лиги, K, история, пол, таблица лидеров, лимит повторных матчей, гонка двойного подтверждения.
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
process.env.DATABASE_URL ||= 'postgres://sky:sky@127.0.0.1/sky';
const E = await import('../../server/gameelo.mjs');
const M = await import('../../server/matchmaking.mjs');

t('лиги по границам', E.tierOf(899).id === 'bronze' && E.tierOf(900).id === 'silver' && E.tierOf(1100).id === 'gold' && E.tierOf(1300).id === 'platinum' && E.tierOf(1500).id === 'diamond' && E.tierOf(1700).id === 'master');
t('K: калибровка / обычный / высокий', E.kFor(0, 1000) === 48 && E.kFor(10, 1000) === 32 && E.kFor(50, 1800) === 24);
t('прогресс до следующей лиги', Math.abs(E.tierOf(1000).progress - 0.5) < 1e-9 && E.tierOf(2000).next === null);

const A = await mkuser(S, 'elA'); const B = await mkuser(S, 'elB');
const G = 'g-cs2';
const game = async (winner) => {
  const id = 'm-' + crypto.randomUUID();
  q(`insert into matches (id, game_id, team_a, team_b, avg_elo, status, reported_by, reported_winner, reported_at) values ('${id}','${G}',ARRAY['${A.pid}'],ARRAY['${B.pid}'],1000,'reported','${A.pid}','${winner}',now())`);
  return id;
};
q(`delete from game_ratings where game_id='${G}' and profile_id in ('${A.pid}','${B.pid}')`);
let id = await game('a');
t('подтверждать должен соперник', (await M.confirmResult(A.pid, id)).error === 'not_opponent');
let r = await M.confirmResult(B.pid, id);
t('победа в калибровке: +24 / −24 (K=48)', r.ok && r.changes[A.pid].delta === 24 && r.changes[B.pid].delta === -24, JSON.stringify(r.changes));
t('повторное подтверждение отклоняется', (await M.confirmResult(B.pid, id)).error === 'not_found');
const rowA = q(`select elo, wins, losses, peak_elo from game_ratings where profile_id='${A.pid}' and game_id='${G}'`);
t('рейтинг и пик записаны', rowA === '1024|1|0|1024', rowA);
t('история записана', q(`select count(*) from game_rating_history where match_id='${id}'`) === '2');

// гонка: два одновременных подтверждения — рейтинг применяется один раз
id = await game('a');
const race = await Promise.all([M.confirmResult(B.pid, id), M.confirmResult(B.pid, id)]);
t('гонка: применено один раз', race.filter((x) => x.ok).length === 1, JSON.stringify(race.map((x) => x.error || 'ok')));

// лимит: за сутки не больше 3 зачётных матчей против тех же соперников (уже 2 зачтено)
id = await game('a'); r = await M.confirmResult(B.pid, id);
t('третий матч зачтён', r.ok && r.changes[A.pid].rated === true);
id = await game('a'); r = await M.confirmResult(B.pid, id);
t('четвёртый матч за сутки не меняет рейтинг', r.ok && r.changes[A.pid].delta === 0 && r.changes[A.pid].rated === false, JSON.stringify(r.changes));
t('матч сыгран (победа записана), но «не зачтён» в истории', q(`select count(*) from game_rating_history where profile_id='${A.pid}' and not rated`) === '1');

// пол рейтинга
q(`update game_ratings set elo=110 where profile_id in ('${A.pid}','${B.pid}') and game_id='${G}'`);
q(`update matches set resolved_at = now() - interval '2 days' where game_id='${G}'`);
id = await game('a'); r = await M.confirmResult(B.pid, id);
t('рейтинг не падает ниже 100', r.ok && r.changes[B.pid].after === 100, JSON.stringify(r.changes));

// API
let res = await call(`/api/games/${G}/rating`, {}, A.tok);
t('GET rating: лига, пик, место', res.status === 200 && res.data.rating.tier?.id && res.data.rating.peak >= res.data.rating.elo && res.data.rating.position >= 1, JSON.stringify(res.data));
res = await call(`/api/games/${G}/leaderboard?limit=5`, {}, A.tok);
t('таблица лидеров: отсортирована, «я» отмечен', res.status === 200 && res.data.top.length >= 1 && res.data.top.every((x, i, a) => !i || a[i - 1].elo >= x.elo) && res.data.top.some((x) => x.me), JSON.stringify(res.data).slice(0, 200));
res = await call(`/api/games/${G}/rating/history`, {}, A.tok);
t('история через API', res.status === 200 && res.data.items.length >= 3);
res = await call(`/api/games/bad!id/rating`, {}, A.tok);
t('неверный id игры → 404', res.status === 404);
res = await call(`/api/games/${G}/rating`, {});
t('без входа нельзя', res.status === 401 || res.status === 403);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
