// До трёх Sky ID на одном устройстве: слоты кук sky_rt / sky_rt2 / sky_rt3. API, любые переменные. Запуск: . env.sh; node scripts/audit/slots-test.mjs <каталог с api.log>
import { readFileSync } from 'node:fs';
const S = process.argv[2]; const B = 'http://127.0.0.1:8080';
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, String(x).slice(0, 220)); } };
const jar = {};   // имя куки → значение (как браузер: одна банка на устройство)
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const call = async (path, o = {}, slot, tok) => {
  const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(slot ? { 'x-sky-slot': String(slot) } : {}), ...(tok ? { authorization: `Bearer ${tok}` } : {}), cookie: cookieHeader(), 'x-sky-device': 'device-slots-test-0123456789' } });
  const sc = r.headers.getSetCookie?.() ?? [];
  for (const c of sc) { const [nv] = c.split(';'); const i = nv.indexOf('='); const name = nv.slice(0, i); const val = nv.slice(i + 1); if (/Max-Age=0/i.test(c) || !val) delete jar[name]; else jar[name] = val; }
  const text = await r.text(); let d; try { d = JSON.parse(text); } catch { d = text; }
  return { status: r.status, data: d, setCookies: sc };
};
const login = async (tag, slot) => {
  const email = `${tag.toLowerCase()}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }, slot);
  await new Promise((r) => setTimeout(r, 1300));
  const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
  const r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) }, slot);
  let tok = r.data.accessToken;
  const p = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: tag, username: tag + Date.now().toString(36), acceptLegal: true }) }, slot, tok);
  const sel = await call(`/api/skyid/profiles/${p.data.profile.id}/select`, { method: 'POST', body: '{}' }, slot, tok);
  return { email, tok: sel.data.accessToken ?? tok, pid: p.data.profile.id, name: tag, setCookies: r.setCookies };
};

const A = await login('slA', 1);
t('слот 1: кука sky_rt', 'sky_rt' in jar && !('sky_rt2' in jar));
const Bq = await login('slB', 2);
t('слот 2: отдельная кука sky_rt2, первая не тронута', 'sky_rt2' in jar && 'sky_rt' in jar);
const C = await login('slC', 3);
t('слот 3: кука sky_rt3, все три рядом', ['sky_rt', 'sky_rt2', 'sky_rt3'].every((k) => k in jar));

const who = async (slot) => { const r = await call('/api/auth/refresh', { method: 'POST', body: '{}' }, slot); return { r, email: r.data?.skyId?.email, tok: r.data?.accessToken }; };
let w = await who(1); t('refresh слота 1 — Sky ID «A»', w.r.status === 200 && w.email === A.email, JSON.stringify(w.r.data).slice(0, 120));
w = await who(2); t('refresh слота 2 — Sky ID «B»', w.r.status === 200 && w.email === Bq.email, w.email);
w = await who(3); t('refresh слота 3 — Sky ID «C»', w.r.status === 200 && w.email === C.email, w.email);
w = await who(undefined); t('без заголовка слота — первый Sky ID', w.email === A.email);
w = await who(7); t('чужой номер слота приводится к первому (больше трёх нет)', w.email === A.email);
w = await who(4); t('слот 4 → тоже первый, четвёртой куки не бывает', w.email === A.email && !('sky_rt4' in jar));

// куки не смешиваются: токен B видит профиль B
const me = await call('/api/skyid/profiles', {}, 2, (await who(2)).tok);
t('access, полученный по слоту 2, принадлежит Sky ID «B»', me.status === 200 && JSON.stringify(me.data).includes(Bq.name), JSON.stringify(me.data).slice(0, 120));

// выход из слота 2 не трогает остальные
const out = await call('/api/auth/logout', { method: 'POST', body: '{}' }, 2);
t('logout слота 2 сбрасывает только sky_rt2', out.status === 200 && out.setCookies.some((c) => /^sky_rt2=;/.test(c)) && !out.setCookies.some((c) => /^sky_rt=;|^sky_rt3=;/.test(c)), JSON.stringify(out.setCookies));
t('кука слота 2 удалена, 1 и 3 на месте', !('sky_rt2' in jar) && 'sky_rt' in jar && 'sky_rt3' in jar);
w = await who(2); t('слот 2 после выхода — сессии нет', w.r.status === 401, String(w.r.status));
w = await who(1); t('слот 1 после выхода другого слота жив', w.email === A.email);
w = await who(3); t('слот 3 жив', w.email === C.email);

// повторный вход в освободившийся слот
const D = await login('slD', 2);
w = await who(2); t('освободившийся слот занимает новый Sky ID', w.email === D.email);
// устройства: сессия «текущая» определяется по слоту
const dev = await call('/api/auth/devices', {}, 3, (await who(3)).tok);
t('список устройств слота 3 показывает его текущую сессию', dev.status === 200 && dev.data.devices.some((d) => d.isCurrent), JSON.stringify(dev.data).slice(0, 160));
console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
