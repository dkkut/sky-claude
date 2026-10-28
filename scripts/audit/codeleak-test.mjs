// Передача кода подтверждения в чате: node scripts/audit/codeleak-test.mjs <каталог с api.log>
// Нужны DATABASE_URL, REDIS_URL, JWT_SECRET, ENCRYPTION_KEY как у API (проверка вызывается напрямую).
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const { guardOutgoingText, candidates } = await import('../../server/codeleak.mjs');
const { query } = await import('../../server/db.mjs');
t('кандидаты: 123456 / 123 456 / 123-456', candidates('код 123456 или 654 321 и 111-222').length === 3);
t('кандидаты: 7 цифр не берём', candidates('1234567').length === 0);

const u = await mkuser(S, 'Leak');
const getCode = async () => {
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email: u.email, viaMail: true }) });
  await new Promise((r) => setTimeout(r, 1500));
  const log = readFileSync(S + '/api.log', 'utf8');
  return [...log.matchAll(new RegExp(u.email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))].pop()?.[1];
};
t('без действующего кода — не блокируем', (await guardOutgoingText(u.pid, 'мой номер 123456')) === null);
await query(`UPDATE verification_codes SET created_at = created_at - interval '2 minutes' WHERE destination = $1`, [u.email]);
const code = await getCode();
t('код получен', /^\d{6}$/.test(code ?? ''), code);
t('чужие шесть цифр не блокируем', (await guardOutgoingText(u.pid, code === '000000' ? '111111' : '000000')) === null);
t('обычная фраза не блокируем', (await guardOutgoingText(u.pid, 'привет, как дела?')) === null);
const r = await guardOutgoingText(u.pid, `вот код: ${code.slice(0, 3)} ${code.slice(3)}`);
t('код с пробелом ловится', r?.leak === true, JSON.stringify(r));
const left = (await query(`SELECT count(*)::int n FROM verification_codes WHERE destination = $1 AND NOT consumed`, [u.email])).rows[0].n;
t('действующие коды погашены', left === 0);
const fr = (await query(`SELECT login_frozen_until FROM sky_ids s JOIN profiles p ON p.sky_id = s.id WHERE p.id = $1`, [u.pid])).rows[0];
t('новые входы заморожены', fr?.login_frozen_until && fr.login_frozen_until > new Date());
const ev = (await query(`SELECT detail FROM sky_events WHERE type = 'login_code_shared' ORDER BY created_at DESC LIMIT 1`).catch(() => ({ rows: [] }))).rows[0];
t('журнал без самого кода', !ev || !JSON.stringify(ev.detail).includes(code));
const login = await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email: u.email }) });
console.log('вход при заморозке: статус', login.status);
console.log(`${ok} ок, ${bad} провалов`); process.exit(bad ? 1 : 0);
