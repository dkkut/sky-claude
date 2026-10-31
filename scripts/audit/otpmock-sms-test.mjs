// Сквозной вход по SMS: API шлёт код в otpmock, тест читает его оттуда и входит.
//   OTPMOCK_URL=https://api.otpmock.com OTPMOCK_API_KEY=… node scripts/audit/otpmock-sms-test.mjs
// API должен быть запущен с теми же OTPMOCK_URL и OTPMOCK_API_KEY (только тестовое окружение!) и базой/Redis.
// Без этих переменных тест пропускается (код выхода 0).
import { call } from './lib.mjs';
import { OtpMock } from './otpmock.mjs';

if (!process.env.OTPMOCK_URL || !process.env.OTPMOCK_API_KEY) {
  console.log('пропуск: OTPMOCK_URL / OTPMOCK_API_KEY не заданы');
  process.exit(0);
}
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const otp = new OtpMock();
const post = (p, b, ip) => call(p, { method: 'POST', body: JSON.stringify(b), headers: { 'x-real-ip': ip } });

const phone = otp.randomPhone();
try {
  const since = Date.now() - 5_000;
  const st = await post('/api/auth/phone/start', { phone }, '192.0.2.77');
  t('код запрошен (200)', st.status === 200, JSON.stringify(st.data));

  const { code, body } = await otp.waitForCode(phone, { since });
  t('код пришёл в otpmock (6 цифр)', /^\d{6}$/.test(code), code);
  t('текст SMS содержит код', String(body).includes(code));

  const bad1 = await post('/api/auth/phone/verify', { phone, code: code === '000000' ? '111111' : '000000' }, '192.0.2.77');
  t('чужой код отклонён (401)', bad1.status === 401, JSON.stringify(bad1.data));

  const ver = await post('/api/auth/phone/verify', { phone, code }, '192.0.2.77');
  t('вход по коду из otpmock (200, токен)', ver.status === 200 && !!(ver.data.accessToken || ver.data.challenge), JSON.stringify(ver.data).slice(0, 200));
} catch (e) {
  t('сценарий без исключений', false, e.message);
} finally {
  await otp.clear(phone).catch(() => {});
}
console.log(`\n${ok} ok, ${bad} fail`);
process.exit(bad ? 1 : 0);
