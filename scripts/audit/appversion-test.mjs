// Проверка server/appversion.mjs: старые родные приложения отсекаются по MIN_APP_BUILD.
process.env.MIN_APP_BUILD = '50100';
const m = await import('../../server/appversion.mjs');
const r = (h) => ({ headers: h });
const checks = [
  ['старое приложение (без сборки) отсечено', m.isOutdatedApp(r({ 'x-sky-client': 'app' })) === true],
  ['новая сборка проходит', m.isOutdatedApp(r({ 'x-sky-client': 'app', 'x-sky-build': '50100' })) === false],
  ['браузер не затронут', m.isOutdatedApp(r({})) === false],
  ['текст ru', m.outdatedReason(r({})).startsWith('У вас старая версия')],
  ['текст en', m.outdatedReason(r({ 'x-sky-lang': 'en' })).startsWith('Your app')],
];
let bad = 0; for (const [n, ok] of checks) { console.log(ok ? 'ok  ' : 'FAIL', n); if (!ok) bad++; }
process.exit(bad ? 1 : 0);
