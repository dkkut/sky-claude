// Проверка подключения к S3-площадке резервных копий (Sky Storage). Запускается в контейнере api:
//   docker compose run --rm --no-deps -T api node scripts/storage-probe.mjs [path|virtual]
// Читает STORAGE_S3_* из окружения; секреты не печатает. Делает: список → запись → чтение → сверка → удаление тестового объекта
// в пределах префикса. Возвращает код 0 только если всё прошло. Печатает рабочий стиль адреса (path/virtual).
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { createS3, s3Config, S3Error } from '../server/skystorages3.mjs';

const style = process.argv[2];
const base = s3Config();
if (!base.ok) { console.error(`Не заданы: ${base.missing.join(', ')}`); process.exit(2); }

const tryStyle = async (pathStyle) => {
  const cfg = { ...base, pathStyle, timeoutMs: 15000 };
  const s3 = createS3(cfg);
  const out = { style: pathStyle ? 'path' : 'virtual', steps: [] };
  const step = async (name, fn) => { try { const r = await fn(); out.steps.push({ name, ok: true }); return r; } catch (e) { out.steps.push({ name, ok: false, code: e.code ?? e.message, status: e.status ?? 0 }); throw e; } };
  try {
    const h = await s3.health(); out.steps.push({ name: 'доступность и права на список', ok: h.ok, ms: h.ms, code: h.code }); if (!h.ok) throw new S3Error(h.code ?? 'health', h.status);
    const key = `.probe/${crypto.randomBytes(6).toString('hex')}`;
    const data = crypto.randomBytes(64 * 1024);
    await step('запись объекта', () => s3.put(key, Readable.from([data])));
    const back = await step('чтение объекта', async () => s3.readAll(await s3.get(key)));
    out.steps.push({ name: 'сверка содержимого', ok: back.equals(data) }); if (!back.equals(data)) throw new S3Error('mismatch');
    await step('диапазонное чтение (докачка)', async () => { const part = await s3.readAll(await s3.get(key, { start: 10, end: 19 })); if (!part.equals(data.subarray(10, 20))) throw new S3Error('range_mismatch'); });
    await step('удаление объекта', () => s3.del(key));
    out.ok = true;
  } catch (e) { out.ok = false; out.error = e.code ?? e.message; }
  return out;
};

const order = style === 'path' ? [true] : style === 'virtual' ? [false] : [base.pathStyle, !base.pathStyle];
let good = null;
for (const ps of order) {
  const r = await tryStyle(ps);
  console.log(`Стиль адреса «${r.style}»: ${r.ok ? 'РАБОТАЕТ' : `не подошёл (${r.error})`}`);
  for (const s of r.steps) console.log(`   ${s.ok ? '✔' : '✖'} ${s.name}${s.ms ? ` (${s.ms} мс)` : ''}${s.ok ? '' : ` — ${s.code}${s.status ? ` HTTP ${s.status}` : ''}`}`);
  if (r.ok) { good = r; break; }
  if (r.error === 's3_access_denied') { console.log('   Отказ в доступе: проверьте ключ доступа/секрет и права ключа на бакет (чтение и запись).'); break; }
}
if (good) { console.log(`\nSTYLE=${good.style}`); process.exit(0); }
console.log('\nПодключиться не удалось. Проверьте адрес, имя бакета, ключи и что сервер имеет выход в интернет.');
process.exit(1);
