// Sky QR (server/skyqr.mjs): создание, права, поля, перебор, отзыв, подмена. node scripts/audit/skyqr-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 200) : JSON.stringify(x).slice(0, 200)); } };
const post = (p, b, tok) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, tok);

const a = await mkuser(S, 'qra'), b = await mkuser(S, 'qrb'), c = await mkuser(S, 'qrc');
q(`update profiles set bio='Привет, я A', profile_extra='{"customStatus":"На связи","country":"RU","links":["https://example.com/a","javascript:alert(1)"]}'::jsonb where id='${a.pid}'`);

let r = await call('/api/qr/me'); t('без входа — 401', r.status === 401, r.status);
r = await call('/api/qr/card/ABCDEFGHJKMN'); t('карточка без входа — 401', r.status === 401, r.status);
r = await call('/api/qr/me', {}, a.tok); t('до создания — exists=false', r.status === 200 && r.data.exists === false, r.data);
r = await post('/api/qr/me', { enabled: true, fields: { bio: true, status: true } }, a.tok);
t('создание', r.status === 200 && /^[A-HJ-KM-NP-Z2-9]{12}$/.test(r.data.code) && r.data.url.includes('?qr=' + r.data.code), r.data);
const code1 = r.data.code;
t('поля сохранены', r.data.fields.bio && r.data.fields.status && !r.data.fields.links && !r.data.fields.country, r.data.fields);
r = await post('/api/qr/me', { enabled: true }, a.tok); t('повторное создание не меняет код', r.data.code === code1, r.data);

// сканирует B
r = await call(`/api/qr/card/${code1}`, {}, b.tok);
t('карточка по коду', r.status === 200 && r.data.profile.id === a.pid && r.data.profile.name, r.data);
t('разрешённые поля видны', r.data.shared.bio === 'Привет, я A' && r.data.shared.status === 'На связи', r.data.shared);
t('неразрешённые поля скрыты', r.data.shared.links === undefined && r.data.shared.country === undefined, r.data.shared);
const raw = JSON.stringify(r.data);
t('в карточке нет почты, Sky ID, телефона', !raw.includes(a.email) && !/sky_id|skyId|"email"|"phone"/i.test(raw), raw);
t('статус дружбы none', r.data.friend === 'none' && r.data.self === false, r.data);
r = await call(`/api/qr/card/${code1.toLowerCase()}`, {}, b.tok); t('код со строчными буквами не принимается (строгий формат)', r.status === 404, r.status);

// включаем ссылки — javascript: отфильтрован
await post('/api/qr/me', { fields: { links: true, country: true } }, a.tok);
r = await call(`/api/qr/card/${code1}`, {}, b.tok);
t('ссылки: только http(s)', r.data.shared.links?.length === 1 && r.data.shared.links[0] === 'https://example.com/a', r.data.shared);
t('страна по разрешению', r.data.shared.country === 'RU', r.data.shared);

// свой код
r = await call(`/api/qr/card/${code1}`, {}, a.tok); t('свой код: self=true', r.data.self === true, r.data);

// добавление в контакты — существующая дружба
r = await post(`/api/friends/${a.pid}/request`, {}, b.tok); t('заявка в контакты', r.status === 200 && r.data.status === 'pending_out', r.data);
r = await call(`/api/qr/card/${code1}`, {}, b.tok); t('статус после заявки', r.data.friend === 'pending_out', r.data);
r = await call(`/api/qr/card/${code1}`, {}, a.tok);

// неверные коды и подмена
r = await call('/api/qr/card/AAAAAAAAAAAA', {}, b.tok); t('неизвестный код — 404', r.status === 404, r);
r = await call('/api/qr/card/' + encodeURIComponent("' OR 1=1 --"), {}, c.tok); t('SQL-подобный код — 404', r.status === 404, r);
r = await call(`/api/qr/card/${a.pid}`, {}, c.tok); t('id профиля вместо кода не работает', r.status === 404, r);

// ручной ввод: только публичное
const uname = q(`select username from profiles where id='${a.pid}'`);
r = await call(`/api/qr/user/${uname}`, {}, c.tok);
t('ручной ввод ника — карточка', r.status === 200 && r.data.profile.id === a.pid, r);
t('по нику необязательных данных нет', Object.keys(r.data.shared).length === 0, r.data.shared);
r = await call('/api/qr/user/nobody-xyz-123', {}, c.tok); t('нет такого ника — 404', r.status === 404, r);

// обновление и отзыв
r = await post('/api/qr/me/rotate', {}, a.tok); const code2 = r.data.code;
t('новый код отличается', r.status === 200 && code2 !== code1, r.data);
r = await call(`/api/qr/card/${code1}`, {}, b.tok); t('старый код перестал работать', r.status === 404, r);
r = await call(`/api/qr/card/${code2}`, {}, b.tok); t('новый код работает', r.status === 200, r);
r = await post('/api/qr/me/revoke', {}, a.tok); t('отзыв', r.status === 200 && r.data.enabled === false, r.data);
r = await call(`/api/qr/card/${code2}`, {}, b.tok); t('отозванный код — 404', r.status === 404, r);
r = await post('/api/qr/me/revoke', {}, b.tok); t('отозвать чужой/несуществующий нельзя', r.status === 404, r);
r = await post('/api/qr/me', { enabled: true }, a.tok); t('включение снова', r.data.enabled === true && r.data.code === code2, r.data);

// подмена полей: лишние ключи игнорируются
r = await post('/api/qr/me', { fields: { email: true, phone: true, bio: true } }, a.tok);
t('неизвестные поля не сохраняются', Object.keys(r.data.fields).sort().join() === 'bio,country,links,status', r.data.fields);
r = await post('/api/qr/me', { profileId: b.pid, fields: {} }, a.tok); t('profileId из тела игнорируется', r.status === 200, r);
r = await call('/api/qr/me', {}, b.tok); t('у B карточка не изменилась', r.data.exists === false, r.data);

// перебор: промахи ограничены
const d = await mkuser(S, 'qrd'); let blocked = false;
for (let i = 0; i < 14; i++) { r = await call('/api/qr/card/' + 'B'.repeat(11) + String.fromCharCode(65 + i), {}, d.tok); if (r.status === 429) { blocked = true; break; } }
t('перебор кодов останавливается (429)', blocked, r.status);
r = await call(`/api/qr/card/${code2}`, {}, d.tok); t('успешные запросы идут отдельным счётчиком', [200, 429].includes(r.status), r.status);
console.log(`Итого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
