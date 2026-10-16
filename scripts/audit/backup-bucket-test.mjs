// Отдельный бакет резервных копий: выбор цели и независимость (юнит-проверка конфигурации, без сети).
import assert from 'node:assert/strict';
let ok = 0; const t = (n, f) => { try { f(); ok++; console.log('ok  ', n); } catch (e) { console.log('FAIL', n, e.message); process.exitCode = 1; } };
const env = process.env;
const load = async () => (await import(`../../server/skystoragetarget.mjs?${Math.random()}`));
const set = (o) => { for (const k of Object.keys(env)) if (/^STORAGE_(BACKUP_)?S3_|^STORAGE_PRIMARY$|^STORAGE_BACKUP_TARGET$/.test(k)) delete env[k]; Object.assign(env, o); };
const MAIN = { STORAGE_S3_ENDPOINT: 'https://main.example.com', STORAGE_S3_BUCKET: 'media', STORAGE_S3_ACCESS_KEY: 'ak', STORAGE_S3_SECRET_KEY: 'sk12345678' };
const BK = { STORAGE_BACKUP_S3_ENDPOINT: 'https://backup.example.org', STORAGE_BACKUP_S3_BUCKET: 'sky-backups', STORAGE_BACKUP_S3_ACCESS_KEY: 'bk', STORAGE_BACKUP_S3_SECRET_KEY: 'bksecret123' };

set({ STORAGE_BACKUP_TARGET: 's3', STORAGE_PRIMARY: 's3', ...MAIN });
let m = await load(); let d = m.describeTarget();
t('без отдельного бакета и при основном S3 — не независимая площадка', () => { assert.equal(d.configured, true); assert.equal(d.independent, false); assert.equal(d.dedicated, false); });
set({ STORAGE_BACKUP_TARGET: 's3', STORAGE_PRIMARY: 's3', ...MAIN, ...BK });
m = await load(); d = m.describeTarget();
t('отдельный бакет — независимая площадка, цель именно он', () => { assert.equal(d.dedicated, true); assert.equal(d.independent, true); assert.equal(d.label, 'backup.example.org/sky-backups'); });
set({ STORAGE_BACKUP_TARGET: 's3', STORAGE_PRIMARY: 's3', ...MAIN, STORAGE_BACKUP_S3_ENDPOINT: MAIN.STORAGE_S3_ENDPOINT, STORAGE_BACKUP_S3_BUCKET: 'media', STORAGE_BACKUP_S3_ACCESS_KEY: 'a', STORAGE_BACKUP_S3_SECRET_KEY: 'secret1234' });
m = await load(); d = m.describeTarget();
t('«отдельный» бакет, совпавший с основным, — не независим', () => assert.equal(d.independent, false));
set({ STORAGE_BACKUP_TARGET: 's3', ...BK, STORAGE_BACKUP_S3_SECRET_KEY: '' });
m = await load(); d = m.describeTarget();
t('не хватает ключа — не настроено, названа именно переменная копий', () => { assert.equal(d.configured, false); assert.ok(d.missing.includes('STORAGE_BACKUP_S3_SECRET_KEY'), JSON.stringify(d)); });
set({ STORAGE_BACKUP_TARGET: 's3', ...BK });
m = await load(); d = m.describeTarget();
t('в описании нет секретов', () => assert.ok(!JSON.stringify(d).includes('bksecret123')));
console.log(`ok=${ok}`);
