// SkyKassa Business: адрес провайдера не должен вести во внутреннюю сеть (без BLOX_ALLOW_PRIVATE).  (. env.sh; node scripts/audit/kbiz4-ssrf-test.mjs)
import { query } from '../../server/db.mjs';
import { setProvider } from '../../server/kbprovider.mjs';
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const { rows } = await query(`SELECT b.owner_id, p.sky_id FROM kb_businesses b JOIN profiles p ON p.id = b.owner_id WHERE p.sky_id IS NOT NULL LIMIT 1`);
if (!rows[0]) { console.log('нет бизнеса в базе — сначала kbiz-test'); process.exit(2); }
const { owner_id: o, sky_id: sk } = rows[0];
const SECRET = 'ssrf-secret-0123456789abcdef';
for (const u of ['http://127.0.0.1:9977', 'https://127.0.0.1', 'https://localhost', 'https://10.0.0.5', 'https://192.168.1.10', 'https://169.254.169.254/latest', 'https://[::1]', 'https://0.0.0.0', 'http://example.com', 'https://user:pw@example.com', 'file:///etc/passwd', 'gopher://example.com']) {
  const r = await setProvider(o, sk, { baseUrl: u, merchant: 'mm', secret: SECRET });
  t(`отклонён: ${u}`, r.error === 'bad_field' || r.error === 'two_factor_required' && false, JSON.stringify(r));
}
console.log(`\nитого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
