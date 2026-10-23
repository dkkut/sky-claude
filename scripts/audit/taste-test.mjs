// Вкус слушателя и сборки волны: чистые функции src/music/taste.ts (запуск: node --experimental-strip-types).
import { buildTaste, recommend, moodOf, MOODS } from '../../src/music/taste.ts';
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const T = (id, artist, genre, plays = 0) => ({ id, title: id, artist, genre, plays });
const rock1 = T('r1', 'A', 'Rock'), rock2 = T('r2', 'A', 'Rock'), rock3 = T('r3', 'B', 'Rock'), jazz1 = T('j1', 'C', 'Jazz'), pop1 = T('p1', 'D', 'Pop', 500);

let x = buildTaste([], []);
t('пустая история — нет сигналов', x.total === 0 && x.genres.length === 0);
x = buildTaste([rock1, rock2, rock3, jazz1], []);
t('самый слушаемый жанр первый', x.genres[0].genre === 'rock' && x.genres[0].share > 0.6, JSON.stringify(x.genres));
t('сумма долей ≈ 1', Math.abs(x.genres.reduce((s, y) => s + y.share, 0) - 1) < 1e-9);
t('исполнитель A выше B', x.artists[0].artist === 'A');
x = buildTaste([jazz1], [rock1]);
t('избранное весит больше прослушивания', x.genres[0].genre === 'rock');
const old = buildTaste([jazz1, ...Array(40).fill(rock1)], []);
t('свежее прослушивание весит больше старых', old.genres[0].genre === 'rock' && old.genres.find((y) => y.genre === 'jazz').share > 0.02);

const taste = buildTaste([rock1, rock2], []);
const rock9 = T('r9', 'E', 'Rock');
const rec = recommend([jazz1, pop1, rock3, rock9], taste, new Set(['r9']));
t('рекомендация: жанр вкуса выше чужих жанров', ['r3', 'r9'].includes(rec[0].id) && rec[2].id !== 'r3' && rec[3].id !== 'r3', rec.map((y) => y.id).join());
t('не слышанное выше слышанного того же жанра', rec.findIndex((y) => y.id === 'r3') < rec.findIndex((y) => y.id === 'r9'));
t('любимый исполнитель поднимает трек', recommend([rock9, rock3, T('r4', 'A', 'Rock')], taste, new Set())[0].artist === 'A');
t('limit работает', recommend([rock1, rock2, rock3], taste, new Set(), 2).length === 2);

t('настроение: Rock → энергичное', moodOf(rock1).some((m) => m.id === 'energy'));
t('настроение: Jazz → спокойное', moodOf(jazz1).some((m) => m.id === 'calm'));
t('настроение: неизвестный жанр — пусто', moodOf(T('z', 'Z', 'Другое')).length === 0);
t('рэп по-русски распознаётся', moodOf(T('z', 'Z', 'Рэп')).some((m) => m.id === 'energy'));
t('пять настроений', MOODS.length === 5);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
