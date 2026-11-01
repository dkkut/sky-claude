// Sky Safety: логика обнаружения (без браузера). Запуск: node --experimental-strip-types scripts/audit/safety-detector-test.mjs
import { CrashDetector } from '../../src/safety/detector.ts';
let ok = 0, bad = 0; const t = (n, c) => { if (c) ok++; else { bad++; console.log('✗', n); } };
const run = (fn) => { const d = new CrashDetector(); return fn(d); };
const drive = (d, from, kmh, seconds) => { let r = null; for (let i = 0; i < seconds; i++) r = d.gps(kmh / 3.6, 10, from + i * 1000) ?? r; return r; };

t('обычное торможение у светофора — не событие', run((d) => { drive(d, 0, 60, 10); d.motion(1.2, 20, 10500); return drive(d, 11000, 0, 5); }) === null);
t('резкая остановка по GPS без удара — не событие', run((d) => { drive(d, 0, 90, 8); return drive(d, 9000, 0, 4); }) === null);
t('быстро → стоп → удар = событие', run((d) => { drive(d, 0, 80, 8); d.motion(4.2, 50, 9300); return drive(d, 9000, 0, 3); })?.signals.includes('impact') === true);
t('удар раньше остановки в пределах 5 с тоже связан', run((d) => { drive(d, 0, 80, 8); d.motion(3.0, 0, 8500); return drive(d, 9000, 0, 3); }) !== null);
t('вращение + остановка = событие', run((d) => { drive(d, 0, 70, 8); d.motion(1.0, 450, 9100); return drive(d, 9000, 0, 3); })?.signals.includes('spin') === true);
t('удар без быстрой езды — не событие', run((d) => { drive(d, 0, 10, 8); d.motion(5, 0, 9000); return drive(d, 9000, 0, 4); }) === null);
t('потеря GPS (нет замеров) — не событие', run((d) => { drive(d, 0, 80, 8); d.motion(5, 500, 9000); return d.gps(null, null, 10000); }) === null);
t('один «нулевой» замер не считается', run((d) => { drive(d, 0, 80, 8); d.motion(5, 0, 9000); return d.gps(0, 10, 9000); }) === null);
t('замер с плохой точностью отбрасывается', run((d) => { drive(d, 0, 80, 8); d.motion(5, 0, 9000); return d.gps(0, 500, 9000) ?? d.gps(0, 500, 10000); }) === null);
t('удар за пределами окна — не связан', run((d) => { drive(d, 0, 80, 8); d.motion(5, 0, 1000); return drive(d, 9000, 0, 3); }) === null);
t('скорость в событии — пиковая', run((d) => { drive(d, 0, 100, 6); d.motion(4, 0, 6500); return drive(d, 7000, 0, 3); })?.speedBeforeKmh === 100);
t('повторно не срабатывает в 10 минут', run((d) => { drive(d, 0, 80, 8); d.motion(4, 0, 9100); drive(d, 9000, 0, 3); drive(d, 20000, 80, 8); d.motion(4, 0, 29100); return drive(d, 29000, 0, 3); }) === null);
t('через 10+ минут снова работает', run((d) => { drive(d, 0, 80, 8); d.motion(4, 0, 9100); drive(d, 9000, 0, 3); drive(d, 700000, 80, 8); d.motion(4, 0, 709100); return drive(d, 709000, 0, 3); }) !== null);
console.log(`safety-detector: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
