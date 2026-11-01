// Оформления шапок и своё HTML-оформление писем: чистая логика, без БД.
import assert from 'node:assert/strict';
import { sanitizeEmailHtml, renderNewsletter, heroStyleIds } from '../../server/emailtpl.mjs';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n += 1; };

const evil = `<html><head><script>alert(1)</script><style>@import url(http://x/y.css);.a{background:url(http://evil/x.png)}.b{color:red}</style></head>
<body onload="x()"><div onclick="x()" style="color:red">Привет</div><a href="javascript:alert(1)">bad</a><a href="https://ok.example/a">good</a>
<img src="http://evil/p.png"><img src="https://ok.example/p.png" onerror="x()"><iframe src="https://x"></iframe><form action="https://x"><input name="p"></form>
<a href="{{cta_url}}">cta</a><!-- комментарий --><svg onload="x()"></svg><meta http-equiv="refresh" content="0;url=http://x"></body></html>`;
const out = sanitizeEmailHtml(evil);
ok(!/<script|alert\(1\)/i.test(out), 'script удалён');
ok(!/onload|onclick|onerror/i.test(out), 'on* удалены');
ok(!/javascript:/i.test(out), 'javascript: удалён');
ok(!/@import/i.test(out), '@import удалён');
ok(!/http:\/\//i.test(out), 'http-ссылки и картинки удалены');
ok(!/<iframe|<form|<input|<svg/i.test(out), 'фреймы, формы, svg удалены');
ok(!/refresh/i.test(out), 'meta refresh удалён');
ok(/href="https:\/\/ok\.example\/a"/.test(out) && /rel="noopener noreferrer"/.test(out), 'https-ссылка осталась');
ok(/href="\{\{cta_url\}\}"/.test(out), 'плейсхолдер в href остался');
ok(/Привет/.test(out) && /color:red/.test(out) && /\.b\{color:red\}/.test(out), 'безопасное оформление осталось');

// шапки
const heroes = heroStyleIds.map((h) => renderNewsletter({ title: 'T', body: 'x', hero: h, emoji: '🎉', align: 'center' }, { appUrl: 'https://sky.test', unsubUrl: 'https://sky.test/u', messageId: 'm1' }).html);
ok(new Set(heroes).size === heroStyleIds.length, 'каждое оформление шапки даёт своё письмо');
ok(heroes.every((h) => h.includes('🎉') && h.includes('text-align:center')), 'эмодзи и выравнивание применяются');
ok(renderNewsletter({ title: 'T', hero: 'nonexistent' }, {}).html.includes('#4f46e5'), 'неизвестный стиль → по умолчанию');

// своё оформление
const design = '<html><body><h1>{{title}}</h1><p>{{subtitle}}</p>{{body}}{{cta}}<p>{{username}}</p></body></html>';
const r = renderNewsletter({ title: 'Привет <b>мир</b>', subtitle: 'под', body: 'Текст\n\nАбзац', cta: { label: 'Открыть', url: 'https://sky.test/x' }, customHtml: design }, { username: 'Аня<script>', appUrl: 'https://sky.test', unsubUrl: 'https://sky.test/unsub?t=1', messageId: 'm2' });
ok(r.html.includes('Привет &lt;b&gt;мир&lt;/b&gt;'), 'переменные экранируются');
ok(!/<script/i.test(r.html) && r.html.includes('Аня&lt;script&gt;'), 'имя экранируется');
ok(r.html.includes('https://sky.test/unsub?t=1'), 'отписка добавляется, даже если дизайн её не содержит');
ok(r.html.includes('href="https://sky.test/x"'), 'кнопка вставлена');
ok(!/\{\{/.test(r.html), 'все плейсхолдеры заменены');
const r2 = renderNewsletter({ title: 'T', customHtml: '<div>{{footer}}</div>' }, { unsubUrl: 'https://sky.test/u' });
ok((r2.html.match(/Отписаться/g) || []).length === 1, 'с {{footer}} отписка стоит ровно один раз');
// названия по теме
import { renderPrime, renderMoney } from '../../server/emailtpl.mjs';
const nl = renderNewsletter({ title: 'T', brand: 'Sky Music' }, {});
ok(nl.brand === 'Sky Music' && nl.html.includes('>Sky Music</td>') && nl.html.includes('>S</td>'), 'логотип рассылки по теме');
ok(renderNewsletter({ title: 'T' }, {}).brand === 'Sky', 'по умолчанию Sky');
ok(renderPrime({ title: 'P', body: 'x' }, { username: 'a' }, {}).brand === 'Sky Prime' && renderPrime({ title: 'P' }, {}, {}).html.includes('>Sky Prime</td>'), 'Prime');
ok(renderMoney({ title: 'M', body: 'x' }, {}, {}).html.includes('>SkyMoney</td>'), 'SkyMoney');
ok(renderNewsletter({ title: 'T', brand: '<b>x</b>' }, {}).html.includes('&lt;b&gt;'), 'название экранируется');
console.log(`Оформления писем: ${n} проверок пройдено`);
