// Проверки чистой логики Media Home (без БД): валидация раскладки.
import assert from 'node:assert/strict';
const { cleanLayout, defaultLayout, WIDGETS, MAX_WIDGETS } = await import('../../server/mediahome.mjs');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n += 1; };

const d = defaultLayout(); ok(d.widgets.length > 0 && d.widgets.every((w) => WIDGETS[w.type]), 'раскладка по умолчанию из реестра');
const c = cleanLayout({ widgets: [{ type: 'evil' }, { type: 'clock', size: 'giant' }, { type: 'custom', cfg: { url: 'javascript:alert(1)', title: '<script>x</script>' } }, { type: 'custom', cfg: { url: 'https://a.b/c' } }] });
ok(c.widgets.length === 3, 'неизвестный тип отброшен');
ok(c.widgets[0].size === 'standard', 'неверный размер заменён');
ok(!c.widgets[1].cfg.url, 'javascript: в ссылке отклонён'); ok(!/[<>]/.test(c.widgets[1].cfg.title), 'теги вычищены');
ok(c.widgets[2].cfg.url === 'https://a.b/c', 'https принят');
ok(cleanLayout({ widgets: Array(100).fill({ type: 'clock' }) }).widgets.length === MAX_WIDGETS, 'предел числа виджетов');
ok(new Set(cleanLayout({ widgets: [{ id: 'a', type: 'clock' }, { id: 'a', type: 'clock' }] }).widgets.map((w) => w.id)).size === 2, 'id уникальны');
ok(cleanLayout({ widgets: Array(30).fill({ type: 'custom' }) }).widgets.length === 12, 'предел своих виджетов');
ok(cleanLayout(null).widgets.length === 0 && cleanLayout('x').density === 'normal', 'мусор на входе безопасен');
ok(cleanLayout({ widgets: [{ type: 'quick', cfg: { actions: ['music', 'rm -rf'] } }] }).widgets[0].cfg.actions.join() === 'music', 'действия — из закрытого списка');
ok(cleanLayout({ accent: 'red; x' }).accent === null && cleanLayout({ accent: '#a1b2c3' }).accent === '#a1b2c3', 'акцент только hex');
console.log(`mediahome-test: ${n} проверок пройдено`);
